import type { SiteConfig } from '~/types'

const config: SiteConfig = {
  // Absolute URL to the root of your published site, used for generating links and sitemaps.
  // TODO: 部署后替换为你的真实域名
  site: 'https://pikaqiang-up.github.io',
  // The name of your site, used in the title and for SEO.
  // TODO: 替换为你的站点标题
  title: 'I Love PIKAQIANG',
  // The description of your site, used for SEO and RSS feed.
  // TODO: 替换为你的站点描述
  description: '皮卡强的个人博客，请遵循cc协议。',
  // The author of the site, used in the footer, SEO, and RSS feed.
  // TODO: 替换为你的名字
  author: 'PIKAQIANG',
  // Keywords for SEO, used in the meta tags.
  tags: ['Blog', 'Astro', 'Terminal', 'MultiTerm'],
  // Path to the image used for generating social media previews.
  // Needs to be a square JPEG file due to limitations of the social card generator.
  // Try https://squoosh.app/ to easily convert images to JPEG.
  socialCardAvatarImage: './src/content/avatar.jpg',
  // Font used for the entire site. The @font-face import for this font lives in
  // src/styles/global.css (JetBrains Maple Mono via ZeoSeven, includes CJK glyphs).
  font: 'JetBrains Maple Mono',
  // For pagination, the number of posts to display per page.
  // The homepage will display half this number in the "Latest Posts" section.
  pageSize: 6,
  // Whether Astro should resolve trailing slashes in URLs or not.
  // This value is used in the astro.config.mjs file and in the "Search" component to make sure pagefind links match this setting.
  // It is not recommended to change this, since most links existing in the site currently do not have trailing slashes.
  trailingSlashes: false,
  // The navigation links to display in the header.
  navLinks: [
    {
      name: 'Home',
      url: '/',
    },
    {
      name: 'About',
      url: '/about',
    },
    {
      name: 'Archive',
      url: '/posts',
    },
    {
      // TODO: 替换为你的 GitHub 主页
      name: 'GitHub',
      url: 'https://github.com/pikaqiang-up',
      external: true,
    },
  ],
  // The theming configuration for the site.
  themes: {
    // The theming mode. One of "single" | "select" | "light-dark-auto".
    mode: 'light-dark-auto',
    // The default theme identifier. For "light-dark-auto" mode use "auto" to
    // follow the reader's system preference.
    default: 'auto',
    // Shiki themes to bundle with the site.
    // https://expressive-code.com/guides/themes/#using-bundled-themes
    // These will be used to theme the entire site along with syntax highlighting.
    // For "light-dark-auto" mode, include exactly a light and a dark theme in that order.
    include: ['vitesse-light', 'min-dark'],
    // Optional overrides for specific themes to customize colors.
    // Their values can be either a literal color (hex, rgb, hsl) or another theme key.
    // See themeKeys list in src/types.ts for available keys to override and reference.
    overrides: {
      // OLED-friendly: force the dark theme background to pure black.
      // This drives both the page background (--color-background) and the
      // code block background (--code-background).
      'min-dark': {
        background: '#000000',
      },
    },
  },
  // Social links to display in the footer.
  socialLinks: {
    // TODO: 替换为你的 GitHub 主页
    github: 'https://github.com/pikaqiang-up',
    // TODO: 替换为你的邮箱地址（只写地址，不需要 mailto:）
    email: '791349367@qq.com',
    // TODO: 把 000000 替换为你的 QQ 号
    qq: 'https://wpa.qq.com/msgrd?v=3&uin=791349367&site=qq&menu=yes',
    rss: true, // Set to true to include an RSS feed link in the footer
  },
  // Configuration for Giscus comments.
  // To set up Giscus, follow the instructions at https://giscus.app/
  // You'll need a GitHub repository with discussions enabled and the Giscus app installed.
  // Take the values from the generated script tag at https://giscus.app and fill them in here.
  // IMPORTANT: Update giscus.json in the root of the project with your own website URL
  // If you don't want to use Giscus, set this to undefined.
  //
  // 部署后再启用下方注释块，并把 giscus 设为对应对象：
  giscus: undefined,
  // giscus: {
  //   repo: 'yourname/your-repo',
  //   repoId: 'R_xxxxxxxxxxxx',
  //   category: 'Announcements',
  //   categoryId: 'DIC_xxxxxxxxxxxx',
  //   reactionsEnabled: true, // Enable reactions on post itself
  // },
  // These are characters available for the character chat feature.
  // To add your own character, add an image file to the top-level `/public` directory
  // Make sure to compress the image to a web-friendly size (<100kb)
  // Try using the excellent https://squoosh.app web app for creating small webp files
  characters: {
    owl: '/owl.webp',
    unicorn: '/unicorn.webp',
    duck: '/duck.webp',
  },
}

export default config
