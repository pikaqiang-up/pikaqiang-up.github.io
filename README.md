# PIKAQIANG 的博客

基于 [Astro](https://astro.build/) + **MultiTerm** 主题搭建的个人博客，部署在 GitHub Pages（`https://pikaqiang-up.github.io`）。

## 本地开发

```bash
npm install        # 首次安装依赖
npm run dev        # 开发预览 → http://localhost:4321/
npm run build      # 生产构建（会自动运行 pagefind 生成搜索索引）
npm run preview    # 预览构建结果 → http://localhost:4321/
```

## 常用配置

- **站点信息 / 导航 / 社交 / 配色**：`src/site.config.ts`
- **首页欢迎语与头像、GitHub 日历**：`src/content/home.md`
- **关于页**：`src/pages/about.md`
- **文章**：`src/content/posts/*.md`（新文章放这里）
- **文章底部许可卡片**：`src/components/LicenseCard.astro`（自动显示标题、链接、作者、发布日期与 CC BY-NC-SA 4.0 协议）
- **头像 / 社交卡片图**：`src/content/avatar.jpg`（正方形 JPEG）
- **网站图标**：`public/favicon.png`
- **字体**：`src/styles/global.css` 顶部 `@import` + `body`，并同步 `site.config.ts` 的 `font`

## 目录说明

```
src/content/posts/     博客文章（只保留你自己的文章）
src/content/*.md       首页 / 页脚等站点内容
src/pages/             页面（关于、归档、标签等）
src/components/        主题组件
src/styles/global.css  全局样式与字体
public/                静态资源（图标、RSS 样式、角色图片）
.examples/             已归档的主题示例文章，不参与构建，可作写法参考
```

## 待部署后配置

- **评论（Giscus）**：在 `src/site.config.ts` 中取消 `giscus` 注释并填入参数，同时更新 `giscus.json` 的 `origins` 为你的域名。
- 若部署到**项目页**（如 `pikaqiang-up.github.io/Blog`）而非用户主页，需要在 `astro.config.mjs` 中额外设置 `base: '/Blog'`；当前配置按用户主页（根路径）设置。
