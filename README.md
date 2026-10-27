# PIKAQIANG 的博客

基于 [Astro](https://astro.build/) 与 **MultiTerm** 主题搭建的个人博客，部署在 GitHub Pages。

- 线上地址：<https://pikaqiang-up.github.io>
- 上游主题：[stelcodes/multiterm-astro](https://github.com/stelcodes/multiterm-astro)（[在线示例](https://multiterm.stelclementine.com/)）

## 本地开发

```bash
npm install        # 安装依赖
npm run dev        # 开发预览 → http://localhost:4321/
npm run build      # 生产构建（会自动运行 pagefind 生成搜索索引）
npm run preview    # 预览构建结果
npm run format     # 用 Prettier 格式化代码
```

## 相比原版 MultiTerm 主题做了哪些修改

> 原版仓库：<https://github.com/stelcodes/multiterm-astro>
> 本仓库在其（MIT 许可）基础上做了以下定制，未列出的大多数功能与目录结构保持与原版一致。

### 1. 站点信息与内容

- 站点信息（标题、作者、描述、导航、社交链接）改为 PIKAQIANG 自己的内容，集中在 `src/site.config.ts`。
- 重写首页欢迎语（`src/content/home.md`）与「关于」页（`src/pages/about.md`）为中文。
- 头像与网站图标换为自己的图片（`src/content/avatar.jpg`、`public/favicon.png`，由 `image.png` 生成）。
- 主题自带的英文示例文章归档到隐藏目录 `.examples/`（**不参与构建**，仅作写法参考），站点只保留一篇中文示例 `src/content/posts/hello-world.md`。

### 2. 配色与主题模式

- 明暗模式改为 `light-dark-auto`：浅色 `vitesse-light`、深色 `min-dark`。
- **OLED 纯黑**：深色背景强制 `#000000`（`themes.overrides`），页面与代码块均为纯黑。
- 为配合 Mermaid 的明暗自动切换，把 `<html data-theme>` 的取值由主题名改为通用值 `light`/`dark`，并额外用 `data-light-scheme`/`data-dark-scheme` 记录真实配色名（`src/layouts/Layout.astro`、`src/components/LightDarkAutoButton.astro`）。

### 3. 字体

- 全站字体改为 **JetBrains Maple Mono**（JetBrains Mono 与 Maple Mono 的融合字体，含中日韩字形），通过 ZeoSeven Fonts 引入（`src/styles/global.css`），避免中文用默认等宽字体发虚。

### 4. 社交链接

- 移除主题默认的 Mastodon / Twitter / LinkedIn / Bluesky，仅保留 GitHub、Email、RSS。
- **新增自定义 QQ 链接**：自绘 `src/icons/qq.svg`，扩展 `SocialLinks` 类型与 `SocialLinks.astro`，点击发起 QQ 临时会话。

### 5. 文章底部许可卡片

- 移除主题自带的「感谢阅读」卡片（`PostAddendum` 组件与 `addendum` 内容集合）。
- 改为 **CC BY-NC-SA 4.0 许可卡片**（`src/components/LicenseCard.astro`）：自动显示文章标题、链接、作者、发布日期与许可协议，并带 CC 水印。

### 6. Markdown 提示块：GitHub 标准告警语法

- 新增 `src/plugins/remark-github-alerts.ts`，支持 GitHub 的引用块告警写法：

  ```markdown
  > [!NOTE]
  > 提示内容
  ```

  支持 `NOTE` / `TIP` / `IMPORTANT` / `WARNING` / `CAUTION`，渲染为与原版 `:::note` **完全相同**的告警块（复用同样的配色与图标），标题按 GitHub 风格首字母大写。

- 原版主题的 `:::note ... :::` 指令仍然可用，两者共存。

### 7. Mermaid 图表支持（原版不支持）

- 接入 [`astro-mermaid`](https://github.com/joesaby/astro-mermaid)：客户端渲染、按需加载、明暗自动重渲染。
- 通过上面的 `data-theme=light/dark` 桥接，让 Mermaid 能跟随站点明暗切换。
- 修复因桥接导致的 **Expressive Code 代码块配色失效**：在 `astro.config.mjs` 用 `themeCssSelector` 让代码块按 `light`/`dark` 生成选择器。
- 新增 **点击放大** 组件 `src/components/DiagramZoom.astro`：点击图表弹出全屏层，支持滚轮缩放、拖动平移、**移动端双指捏合缩放**、放大/缩小/重置、`Esc` 关闭。
- 修复 `GiscusLoader.astro` 与改造后 `data-theme` 的兼容（Giscus 当前未启用）。

### 8. 部署

- 新增 GitHub Pages 部署工作流 `.github/workflows/deploy.yml`（基于 Astro 官方模板），并补充了 **Pagefind 搜索索引** 步骤（官方模板直接执行 `astro build`，不会触发主题的 `postbuild` 脚本）。
- 启用方式：仓库 **Settings → Pages → Source** 选择 **GitHub Actions**。

### 9. 其他清理

- 删除主题开发目录 `dev/` 与上游 `.github` 工作流等无关文件。
- `package.json` 更名为 `pikaqiang-blog`；新增 `.prettierignore`（排除 `dist`、`.astro`、`.examples` 等）。

### 10. 长表格横向滚动

- 新增 `src/plugins/rehype-table-wrapper.ts`，自动把每张 Markdown 表格包进 `.table-wrapper`。
- 长表格只在表格区域内左右滑动，不再把整页撑宽；普通表格外观不变。

## 目录结构

```
src/
├── components/       组件（含自定义 LicenseCard、DiagramZoom 等）
├── content/
│   ├── posts/        文章（hello-world.md）
│   └── home.md       首页内容
├── layouts/          页面布局
├── pages/            页面（关于、归档、标签、RSS、社交卡片等）
├── plugins/          remark / rehype 插件
├── styles/global.css 全局样式与字体
└── site.config.ts    ⭐ 站点主配置
public/               静态资源（favicon 等）
.examples/            归档的主题示例文章（不参与构建）
astro.config.mjs      Astro 配置（集成、主题选择器等）
.github/workflows/    GitHub Pages 部署工作流
```

## 常用配置位置

| 内容                          | 文件                                              |
| ----------------------------- | ------------------------------------------------- |
| 站点信息 / 导航 / 社交 / 配色 | `src/site.config.ts`                              |
| 首页欢迎语、头像、GitHub 日历 | `src/content/home.md`                             |
| 关于页                        | `src/pages/about.md`                              |
| 写文章                        | `src/content/posts/*.md`                          |
| 文章底部许可卡片              | `src/components/LicenseCard.astro`                |
| Mermaid 点击放大              | `src/components/DiagramZoom.astro`                |
| 字体                          | `src/styles/global.css`                           |
| 评论（Giscus，未启用）        | `src/site.config.ts` 的 `giscus` 与 `giscus.json` |

## 许可与致谢

- 本站原创内容采用 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh) 许可。
- 主题来自 [MultiTerm](https://github.com/stelcodes/multiterm-astro)（MIT 许可，作者 [stelcodes](https://github.com/stelcodes)），在此致谢。
