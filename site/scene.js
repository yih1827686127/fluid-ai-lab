"use strict";

const exhibit = document.querySelector("#exhibit");
const scene = document.querySelector("#scene");
const canvas = document.querySelector("#phase-canvas");
const images = [
  document.querySelector("#water-image"),
  document.querySelector("#vapor-image"),
];
const phaseButtons = [...document.querySelectorAll("[data-select]")];
const playButton = document.querySelector("#play-button");
const status = document.querySelector("#phase-status");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

const vertexSource = `
  attribute vec2 position;
  varying vec2 uv;

  void main() {
    uv = vec2(position.x + 1.0, 1.0 - position.y) * 0.5;
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

const fragmentSource = `
  precision mediump float;

  varying vec2 uv;
  uniform sampler2D water;
  uniform sampler2D vapor;
  uniform vec2 focus;
  uniform float aspect;
  uniform float imageAspect;
  uniform float progress;
  uniform float preview;
  uniform float time;

  float hash(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }

  float noise(vec2 p) {
    vec2 cell = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(cell), hash(cell + vec2(1.0, 0.0)), f.x),
      mix(hash(cell + vec2(0.0, 1.0)), hash(cell + 1.0), f.x),
      f.y
    );
  }

  float cloud(vec2 p) {
    return noise(p) * 0.57 + noise(p * 2.12 + 6.2) * 0.29 + noise(p * 4.65) * 0.14;
  }

  void main() {
    vec2 metric = vec2(max(aspect, 1.0), max(1.0 / aspect, 1.0));
    vec2 field = uv * metric;
    float grain = cloud(field * 12.0 + vec2(4.0, -time * 0.08));

    // Evaporation travels up through the image. Condensation reverses it.
    float front = clamp(0.79 - uv.y * 0.6 + (grain - 0.5) * 0.64 + (uv.x - 0.5) * 0.18, 0.03, 0.97);
    float phase = smoothstep(front - 0.11, front + 0.11, progress * 1.26 - 0.13);

    // Inside the pointer's radius, show the other state with a broken, soft edge.
    float radius = length((uv - focus) * metric);
    float lens = (1.0 - smoothstep(0.075, 0.23, radius + (grain - 0.5) * 0.1)) * preview;
    phase = mix(phase, 1.0 - phase, lens);

    vec2 cover = min(vec2(1.0), vec2(aspect / imageAspect, imageAspect / aspect));
    vec2 sampleUV = (uv - 0.5) * cover * 0.99 + 0.5 + ((1.0 - cover) * vec2(0.04, -0.32));
    float edge = sin(uv.x * 3.14159) * sin(uv.y * 3.14159);
    float wave = sin(sampleUV.y * 29.0 + sampleUV.x * 9.0 - time * 0.85);
    float change = phase * (1.0 - phase) * 4.0;

    vec2 refraction = vec2(wave * 0.0032 + (grain - 0.5) * change * 0.018,
                           sin(sampleUV.x * 17.0 + time * 0.7) * 0.002) * edge;
    vec2 drift = vec2((grain - 0.5) * 0.014, grain * 0.017 - 0.0085) * edge;
    vec3 liquid = texture2D(water, sampleUV + refraction).rgb;
    vec3 mist = texture2D(vapor, sampleUV + drift).rgb;
    vec3 color = mix(liquid, mist, phase);
    color += vec3(0.03, 0.09, 0.12) * change * smoothstep(0.31, 0.8, grain);
    gl_FragColor = vec4(color, 1.0);
  }
`;

function makeRenderer() {
  const gl = canvas.getContext("webgl", { alpha: false, antialias: false });
  if (!gl) return null;

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader));
    }
    return shader;
  }

  const program = gl.createProgram();
  const vertex = compile(gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program));
  }
  gl.useProgram(program);

  const vertices = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "position");
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(position);

  images.forEach((image, index) => {
    gl.activeTexture(gl.TEXTURE0 + index);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);
    gl.uniform1i(gl.getUniformLocation(program, index === 0 ? "water" : "vapor"), index);
  });

  const uniforms = Object.fromEntries(
    ["aspect", "imageAspect", "progress", "preview", "focus", "time"]
      .map(name => [name, gl.getUniformLocation(program, name)])
  );
  gl.uniform1f(uniforms.imageAspect, images[0].naturalWidth / images[0].naturalHeight);

  return {
    draw(width, height, phase, lens, x, y, time) {
      const density = Math.min(devicePixelRatio || 1, 1.5, Math.sqrt(1550000 / (width * height)));
      const pixelWidth = Math.max(1, Math.round(width * density));
      const pixelHeight = Math.max(1, Math.round(height * density));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      gl.viewport(0, 0, pixelWidth, pixelHeight);
      gl.uniform1f(uniforms.aspect, width / height);
      gl.uniform1f(uniforms.progress, phase);
      gl.uniform1f(uniforms.preview, lens);
      gl.uniform2f(uniforms.focus, x, y);
      gl.uniform1f(uniforms.time, time % 240);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}

let renderer = null;
let phase = "water";
let progress = 0;
let timer = null;
let frame = null;
let previousFrame = 0;
let sceneTime = 0;
let sceneVisible = true;
let pointerLevel = 0;
let press = null;
let dimensions = scene.getBoundingClientRect();

const pointer = { x: 0.5, y: 0.5, wantedX: 0.5, wantedY: 0.5, inside: false };

function queueFrame() {
  if (frame === null) frame = requestAnimationFrame(drawFrame);
}

function approach(value, target, factor) {
  return Math.abs(value - target) < 0.002 ? target : value + (target - value) * factor;
}

function drawFrame(now) {
  frame = null;
  const dt = previousFrame ? Math.min(now - previousFrame, 45) : 16;
  const motion = !reducedMotion.matches;
  const phaseTarget = Number(phase === "vapor");
  const pointerTarget = Number(pointer.inside);

  progress = approach(progress, phaseTarget, motion ? 1 - Math.exp(-dt / 150) : 1);
  pointerLevel = approach(pointerLevel, pointerTarget, motion ? 1 - Math.exp(-dt / 95) : 1);
  pointer.x = approach(pointer.x, pointer.wantedX, motion ? 1 - Math.exp(-dt / 48) : 1);
  pointer.y = approach(pointer.y, pointer.wantedY, motion ? 1 - Math.exp(-dt / 48) : 1);
  if (motion) sceneTime += dt / 1000;

  if (renderer) {
    renderer.draw(dimensions.width, dimensions.height, progress, pointerLevel,
      pointer.x, pointer.y, sceneTime);
  } else {
    scene.style.setProperty("--focus-x", `${pointer.x * 100}%`);
    scene.style.setProperty("--focus-y", `${pointer.y * 100}%`);
    scene.style.setProperty("--lens-opacity", pointerLevel);
  }

  const isAnimating = progress !== phaseTarget || pointerLevel !== pointerTarget
    || pointer.x !== pointer.wantedX || pointer.y !== pointer.wantedY;
  if (sceneVisible && ((motion && renderer) || isAnimating)) {
    previousFrame = now;
    queueFrame();
  } else {
    previousFrame = 0;
  }
}

function setPhase(next) {
  if (phase === next) return;
  phase = next;
  exhibit.dataset.phase = next;
  for (const button of phaseButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.select === next));
  }
  status.textContent = next === "water" ? "当前形态为液态水" : "当前形态为水蒸气";
  queueFrame();
}

function setLoop(enabled) {
  if (timer !== null) clearInterval(timer);
  timer = null;
  playButton.setAttribute("aria-pressed", String(enabled));
  if (!enabled) return;
  togglePhase();
  timer = setInterval(() => {
    if (!document.hidden) togglePhase();
  }, 5000);
}

function togglePhase() {
  setPhase(phase === "water" ? "vapor" : "water");
}

function selectManually(next) {
  setLoop(false);
  pointer.inside = false;
  queueFrame();
  setPhase(next);
}

function trackPointer(event) {
  const x = (event.clientX - dimensions.left) / dimensions.width;
  const y = (event.clientY - dimensions.top) / dimensions.height;
  if (!pointer.inside && pointerLevel === 0) {
    pointer.x = x;
    pointer.y = y;
  }
  pointer.wantedX = x;
  pointer.wantedY = y;
  pointer.inside = true;
  queueFrame();
}

scene.addEventListener("pointermove", event => {
  if (!event.isPrimary || (event.pointerType === "touch" && press?.id !== event.pointerId)) return;
  if (press && press.id === event.pointerId) {
    press.moved ||= Math.hypot(event.clientX - press.x, event.clientY - press.y) > 9;
  }
  trackPointer(event);
});

scene.addEventListener("pointerdown", event => {
  if (!event.isPrimary || event.button !== 0) return;
  dimensions = scene.getBoundingClientRect();
  press = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  if (event.pointerType !== "mouse") scene.setPointerCapture(event.pointerId);
  trackPointer(event);
});

scene.addEventListener("pointerup", event => {
  if (press?.id !== event.pointerId) return;
  if (!press.moved) selectManually(phase === "water" ? "vapor" : "water");
  press = null;
  if (event.pointerType !== "mouse") {
    pointer.inside = false;
    queueFrame();
  }
});

function clearPointer(event) {
  if (!event.isPrimary) return;
  pointer.inside = false;
  press = null;
  queueFrame();
}

scene.addEventListener("pointerleave", clearPointer);
scene.addEventListener("pointercancel", clearPointer);

for (const button of phaseButtons) {
  button.addEventListener("click", () => selectManually(button.dataset.select));
}

playButton.addEventListener("click", () => setLoop(timer === null));

document.addEventListener("keydown", event => {
  if (event.code !== "Space" || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (event.target !== document.body && event.target !== exhibit) return;
  event.preventDefault();
  if (!event.repeat) selectManually(phase === "water" ? "vapor" : "water");
});

function updateDimensions() {
  dimensions = scene.getBoundingClientRect();
  queueFrame();
}

new ResizeObserver(updateDimensions).observe(scene);
new IntersectionObserver(([entry]) => {
  sceneVisible = entry.isIntersecting;
  if (sceneVisible) queueFrame();
}).observe(scene);
window.addEventListener("scroll", updateDimensions, { passive: true });
reducedMotion.addEventListener("change", queueFrame);

canvas.addEventListener("webglcontextlost", event => {
  event.preventDefault();
  renderer = null;
  scene.classList.remove("has-shader");
  queueFrame();
});

function startShader() {
  try {
    renderer = makeRenderer();
    if (renderer) {
      scene.classList.add("has-shader");
      queueFrame();
    }
  } catch {
    // The same artwork and controls remain available through CSS.
  }
}

Promise.all(images.map(image => image.decode())).then(() => {
  startShader();
  canvas.addEventListener("webglcontextrestored", startShader);
}).catch(() => {});
