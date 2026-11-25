import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import MarkdownIt from "markdown-it";
import { parse } from "yaml";

const root = fileURLToPath(new URL("../", import.meta.url));
const site = join(root, "site");
const content = join(root, "content");
const output = resolve(root, "docs");

const blogName = "Lexury";
const owner = "黄怿（Yi Huang）";
const github = "https://github.com/yih1827686127";
const description = "黄怿（Yi Huang，Lexury）的个人博客，记录波浪能、流体力学与人工智能的研究问题、论文阅读与项目进展。";
const nav = [
  ["主页", ""],
  ["博客", "archive/"],
  ["合作", "cooperation/"],
  ["学术履历", "cv/"],
];

const md = new MarkdownIt();
const defaultLink = md.renderer.rules.link_open ?? ((tokens, index, options, _env, renderer) =>
  renderer.renderToken(tokens, index, options));
md.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
  const token = tokens[index];
  const href = token.attrGet("href");
  if (href?.startsWith("/") && !href.startsWith("//")) {
    token.attrSet("href", env.base + href.slice(1));
  }
  return defaultLink(tokens, index, options, env, renderer);
};

function escape(value) {
  const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(value).replace(/[&<>"']/g, char => entities[char]);
}

function header(base, active) {
  const links = nav.map(([label, path]) =>
    `<a href="${base}${path}"${path === active ? ' aria-current="page"' : ""}>${label}</a>`
  ).join("\n        ");

  return `<header class="site-header">
      <a class="brand" href="${base}" aria-label="Lexury 主页" lang="en">
        <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
        Lexury
      </a>
      <nav class="site-nav" aria-label="主导航">
        ${links}
      </nav>
    </header>`;
}

function document({ base, title, summary = description, home = false, body }) {
  return `<!doctype html>
<html lang="zh-Hans">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#070a0d">
  <meta name="description" content="${escape(summary)}">
  <title>${escape(title)}</title>
  <link rel="icon" href="${base}assets/favicon.png" type="image/png">
  <link rel="stylesheet" href="${base}styles.css">
${home ? '  <link rel="preload" href="./assets/instrument-italic.woff2" as="font" type="font/woff2" crossorigin>\n  <script src="./scene.js" defer></script>\n' : ""}</head>
<body>
  ${body}
  <footer class="site-footer reading-width">
    <span>${owner} · Fluid AI Lab</span>
    <a href="${github}" lang="en">GitHub</a>
  </footer>
</body>
</html>
`;
}

function readingPage({ base, active, heading, summary, body, metadata = "" }) {
  return document({
    base,
    title: `${heading} · ${blogName}`,
    summary,
    body: `<div class="interior-header">${header(base, active)}</div>
    <main class="reading reading-width">
      <h1>${escape(heading)}</h1>
${metadata ? `      ${metadata}\n` : ""}      ${body}
    </main>`,
  });
}

async function readPosts() {
  const directory = join(content, "posts");
  const names = (await readdir(directory)).filter(name => name.endsWith(".md"));
  const posts = await Promise.all(names.map(async name => {
    const text = await readFile(join(directory, name), "utf8");
    const parts = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
    if (!parts) throw new Error(`Missing front matter in ${name}`);
    const [, properties, body] = parts;
    return { ...parse(properties), body, slug: basename(name, ".md") };
  }));

  return posts.filter(post => !post.draft).sort((a, b) =>
    String(b.published).localeCompare(String(a.published))
  );
}

function postList(posts, base) {
  if (posts.length === 0) return "<p>暂无文章。</p>";
  return `<ul class="post-list">
      ${posts.map(post => `<li>
        <a class="post-link" href="${base}posts/${encodeURIComponent(post.slug)}/">
          <span class="post-title">${escape(post.title)}</span>
          <time datetime="${escape(post.published)}">${escape(post.published)}</time>
          ${post.description ? `<p>${escape(post.description)}</p>` : ""}
        </a>
      </li>`).join("\n      ")}
    </ul>`;
}

async function writePage(url, html) {
  const folder = join(output, url);
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "index.html"), html);
}

async function renderSpec(name, base) {
  const text = await readFile(join(content, "spec", `${name}.md`), "utf8");
  return md.render(text, { base });
}

const [posts, homeTemplate, about, chineseCV, englishCV] = await Promise.all([
  readPosts(),
  readFile(join(site, "index.html"), "utf8"),
  readFile(join(content, "spec", "about.md"), "utf8"),
  renderSpec("cv-zh", "../"),
  renderSpec("cv-en", "../"),
]);

// The Pages directory is regenerated so deleted articles also disappear from the site.
if (relative(root, output) !== "docs" || dirname(output) !== resolve(root)) {
  throw new Error("Unexpected Pages output path");
}
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await Promise.all([
  cp(join(site, "assets"), join(output, "assets"), { recursive: true }),
  cp(join(site, "styles.css"), join(output, "styles.css")),
  cp(join(site, "scene.js"), join(output, "scene.js")),
  writeFile(join(output, ".nojekyll"), ""),
]);

const home = homeTemplate.replace("{{navigation}}", () => header("./", ""))
  .replace("{{latest}}", () => postList(posts.slice(0, 3), "./"));

const aboutBody = about.replace(/^# .+\r?\n/, "").trim();

await Promise.all([
  writePage("", document({
    base: "./",
    title: `${blogName} · Fluid AI Lab`,
    home: true,
    body: `<main>${home}</main>`,
  })),
  writePage("archive", readingPage({
    base: "../",
    active: "archive/",
    heading: "博客",
    body: postList(posts, "../"),
  })),
  writePage("cooperation", readingPage({
    base: "../",
    active: "cooperation/",
    heading: "合作",
    body: `<article class="prose">
      ${md.render(aboutBody, { base: "../" })}
      <h2>欢迎交流</h2>
      <p>如果你也在做波浪能、流体力学或人工智能相关研究，欢迎交流研究问题、方法和项目想法。</p>
      <p><a href="${github}">查看我的 GitHub 项目</a></p>
    </article>`,
  })),
  writePage("cv", readingPage({
    base: "../",
    active: "cv/",
    heading: `${owner}｜学术履历`,
    summary: "黄怿（Yi Huang）的中英文学术履历，包含教育经历、研究项目及学术成果。",
    body: `<article class="prose">
      <p>常用昵称 Lexury，校方名录署名 HUANG, Yi。</p>
      <p>香港科技大学（广州）数据科学与分析（DSA）博士生，在港科广开展波浪能、流体力学与人工智能交叉研究。本科就读于中山大学物理学专业（2022–2026）。</p>
      <nav class="cv-nav" aria-label="履历语言">
        <a href="#cv-zh">中文履历</a>
        <a href="#cv-en" lang="en">English CV</a>
        <a href="https://dsa.hkust-gz.edu.cn/people/students/doctor-of-philosophy/">校方博士生名录</a>
      </nav>
      <section class="cv-version" aria-labelledby="cv-zh">
        <h2 id="cv-zh">中文履历</h2>
        ${chineseCV}
      </section>
      <section class="cv-version" lang="en" aria-labelledby="cv-en">
        <h2 id="cv-en">English CV</h2>
        ${englishCV}
      </section>
    </article>`,
  })),
  ...posts.map(post => {
    const date = escape(post.published);
    const topics = [post.category, ...(post.tags ?? [])].filter(Boolean).map(escape);
    return writePage(`posts/${post.slug}`, readingPage({
      base: "../../",
      active: "archive/",
      heading: post.title,
      summary: post.description,
      metadata: `<p class="post-meta"><time datetime="${date}">${date}</time>${topics.length ? ` · ${topics.join(" · ")}` : ""}</p>`,
      body: `<article class="prose">${md.render(post.body, { base: "../../" })}</article>`,
    }));
  }),
]);
