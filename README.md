# Fluid AI Lab · Lexury

黄怿（Yi Huang）的个人博客。首页以水面和雾气呈现互动背景，正文包括博客、合作和中英文学术履历。

## 更新内容

- 博客文章放在 `content/posts/`，使用现有文章的 Markdown 头部格式。
- 合作页的个人介绍与中英文履历在 `content/spec/`。
- 首页结构、样式与背景资源在 `site/`。

运行 `npm ci` 和 `npm run build` 生成 `docs/`。预览可运行 `python -m http.server --directory docs` 后打开 `http://localhost:8000/`。GitHub Pages 使用 `main` 分支的 `/docs` 目录，更新内容时一并提交生成结果。

访客可移动光标或单指拖动来预览另一种形态，点击画面或使用切换按钮改变背景。本页支持减少动态效果的系统设置，WebGL 不可用时使用 CSS 过渡。

背景图为项目委托方提供的新版素材。Instrument Serif 与 Inter 的许可文本位于 `site/assets/`。
