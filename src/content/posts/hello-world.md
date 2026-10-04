---
title: '你好，世界'
published: 2026-10-04
description: '我的博客第一篇文章：介绍这个站点、使用的主题、支持的写法，并附一张复杂的 Mermaid 图表。'
tags: ['随笔', '公告', 'Mermaid']
---

欢迎来到我的博客！这是第一篇文章，用来展示站点的排版效果，也顺便记录一下这个站点是怎么搭起来的。

## 这个博客用什么搭建的

站点基于 [Astro](https://astro.build/) 与 MultiTerm 主题，整体配置集中在 `src/site.config.ts` 一个文件里。写作只需要在 `src/content/posts/` 目录下新建 Markdown 文件。

## 一段示例代码

代码块会自动使用当前配色主题高亮：

```ts
export function greet(name: string): string {
  return `你好，${name}！`
}

console.log(greet('世界'))
```

## 支持的写法

- 标题、列表、引用、表格、图片等标准 Markdown
- KaTeX 数学公式：$E = mc^2$
- 提示块（admonition）
- 代码高亮、行号
- 自动生成目录（大屏显示在右侧）
- Mermaid 图表（自动跟随明暗主题切换，**点击图表可放大查看**）

下面这张图故意画得又长又复杂，用来测试多子图、跨子图连线、节点自定义样式，以及窄屏下的横向滚动：

```mermaid
flowchart TD
    REQ(["用户请求进入"]) --> GW["接入网关"]

    subgraph GATE["接入层"]
        direction TB
        GW --> CDN{"CDN 缓存命中?"}
        CDN -->|"命中"| HIT["直接返回缓存"]
        CDN -->|"未命中"| SSR["交给构建产物 / SSR"]
    end

    subgraph BUILD["构建流水线"]
        direction TB
        CI["npm ci 安装依赖"] --> ASTRO["Astro 构建"]
        ASTRO --> OG["Satori 生成社交卡片"]
        ASTRO --> PF["Pagefind 生成搜索索引"]
        ASTRO --> SM["生成 sitemap / RSS"]
        OG --> DIST["产出 dist/"]
        PF --> DIST
        SM --> DIST
    end

    subgraph THEME["主题系统"]
        direction TB
        CFG["读取 site.config.ts"] --> MODE{"主题模式?"}
        MODE -->|"single"| S1["单一配色"]
        MODE -->|"light-dark-auto"| S2["浅色 / 深色 / 跟随系统"]
        MODE -->|"select"| S3["读者自选配色"]
        S1 --> VAR["注入 CSS 变量"]
        S2 --> VAR
        S3 --> VAR
        VAR --> MM["mermaid 跟随明暗重渲染"]
    end

    subgraph CONTENT["内容管线"]
        direction TB
        RM["remark 插件"] --> RH["rehype 插件"]
        RH --> EC["Expressive Code 代码高亮"]
        RH --> KTX["KaTeX 数学公式"]
        RH --> ADM["Admonition 提示块"]
        RH --> MRM["astro-mermaid 图表"]
        RH --> TOC["目录 / 锚点"]
    end

    subgraph SEARCH["搜索与发现"]
        direction LR
        Q["关键词"] --> IDX["Pagefind 索引"]
        IDX --> RES["结果列表"]
        TAGN["标签云"] --> RES
        RSSF["RSS 订阅"] --> RES
    end

    subgraph DEPLOY["部署目标"]
        direction TB
        GHP["GitHub Pages"] --> LIVE["线上站点"]
        CFP["Cloudflare Pages"] --> LIVE
    end

    SSR --> BUILD
    BUILD --> THEME
    THEME --> CONTENT
    DIST --> DEPLOY
    DEPLOY --> LIVE
    CONTENT --> SEARCH
    SEARCH --> DONE(["完成"])
    LIVE --> DONE
    HIT --> DONE

    classDef entry fill:#6366f1,stroke:#4338ca,color:#fff,stroke-width:2px;
    classDef decision fill:#f59e0b,stroke:#b45309,color:#111,stroke-width:2px;
    classDef build fill:#0ea5e9,stroke:#0369a1,color:#fff;
    classDef theme fill:#a855f7,stroke:#7e22ce,color:#fff;
    classDef content fill:#22c55e,stroke:#15803d,color:#fff;
    classDef deploy fill:#ef4444,stroke:#b91c1c,color:#fff;
    classDef done fill:#111827,stroke:#374151,color:#fff,stroke-width:2px;

    class REQ,HIT entry;
    class CDN,MODE decision;
    class CI,ASTRO,OG,PF,SM,DIST build;
    class CFG,S1,S2,S3,VAR,MM theme;
    class RM,RH,EC,KTX,ADM,MRM,TOC content;
    class GHP,CFP,LIVE deploy;
    class DONE done;
```

:::note
这是一条 note 提示块。把 `note` 换成 `tip`、`important`、`caution`、`warning` 可以切换样式。
:::

## 下一步

编辑 `src/site.config.ts` 里的站点标题、作者、社交链接和配色，然后就可以开始写自己的文章了。
