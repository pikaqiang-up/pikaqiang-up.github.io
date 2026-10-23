// ==UserScript==
// @name         洛谷 MD3 题面增强
// @namespace    https://github.com/luogu-md3
// @version      1.2.1
// @description  用 Material Design 3 重构洛谷题目页布局：单列题面、常展开推荐、内联原生提交模块，支持 Alt+C / Alt+L / Alt+J / Alt+K 与 J/K、gg/G 滚动。
// @author       you
// @match        https://www.luogu.com.cn/problem/*
// @grant        GM_addStyle
// @grant        GM_addElement
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      esm.run
// @connect      cdn.jsdelivr.net
// @connect      fastly.jsdelivr.net
// @connect      fonts.gstatic.com
// @connect      fontsapi.zeoseven.com
// @run-at       document-idle
// @noframes
// ==/UserScript==

/*
 * 可配置常量都在 CONFIG 里。
 * 设计目标：
 *  1. 不改动洛谷原生 Vue 组件树，只做视觉重排和 DOM 搬迁；
 *  2. Material Web 加载失败时保留一套完整的 MD3 降级样式；
 *  3. 提交优先点击洛谷原生提交按钮，绝不直接请求私有 API。
 */
(function () {
  'use strict';

  const CONFIG = Object.freeze({
    /** 主内容最大宽度（px），建议 900–1100 */
    maxWidth: 1040,
    /** 顶部信息卡最大宽度（px） */
    headerMaxWidth: 1040,
    /** 推荐题目默认是否展开（当前设计始终展开） */
    recommendExpandedByDefault: true,
    /** 存储键前缀 */
    storagePrefix: 'luogu-md3:',
    /** Material Web 版本与入口（题目要求：通过 importmap 从 esm.run 加载） */
    material: {
      importMapBase: 'https://esm.run/@material/web/',
      all: [
        'https://esm.run/@material/web/all.js',
        'https://fastly.jsdelivr.net/npm/@material/web@2.4.0/all.js/+esm',
      ],
      segmentedSet: [
        'https://esm.run/@material/web/labs/segmentedbuttonset/outlined-segmented-button-set.js',
        'https://fastly.jsdelivr.net/npm/@material/web@2.4.0/labs/segmentedbuttonset/outlined-segmented-button-set.js/+esm',
      ],
      segmentedButton: [
        'https://esm.run/@material/web/labs/segmentedbutton/outlined-segmented-button.js',
        'https://fastly.jsdelivr.net/npm/@material/web@2.4.0/labs/segmentedbutton/outlined-segmented-button.js/+esm',
      ],
      typescale: [
        'https://esm.run/@material/web/typography/md-typescale-styles.js',
        'https://fastly.jsdelivr.net/npm/@material/web@2.4.0/typography/md-typescale-styles.js/+esm',
      ],
    },
    shortcuts: Object.freeze({
      copyMarkdown: 'Alt + C',
      submit: 'Alt + L',
      jumpDescription: 'Alt + J',
      jumpSubmit: 'Alt + K',
      scrollDown: 'J',
      scrollUp: 'K',
      close: 'Esc',
    }),
    /** 代码编辑器高度（px），可在设置中实时调整 */
    editor: Object.freeze({
      defaultHeight: 620,
      minHeight: 360,
      maxHeight: 1100,
      step: 20,
    }),
  });

  const SELECTOR = Object.freeze({
    topBar: '.top-bar',
    sideNav: '.sidebar',
    header: '.header-card',
    side: '.sidebar-container .side',
    mainColumn: '.sidebar-container .main',
    problemCard: '.l-card.problem',
    actions: '.problem-block-actions',
    bottomRow: '.header-card .bottom-row',
    menu: '.header-card .menu',
    menuEntry: '.header-card .menu .entry',
    submitButtonText: /^(提交评测|Submit|Submit to Judge)$/i,
  });

  const state = {
    booted: false,
    materialReady: false,
    materialPromise: null,
    materialToastShown: false,
    currentPath: '',
    pageTitle: '',
    initToken: 0,
    header: null,
    infoGrid: null,
    hero: null,
    settings: null,
    settingsOpen: false,
    lastFocus: null,
    routeTimer: null,
    saveTimer: null,
    toastTimer: null,
    submitPrepared: false,
    submitPreparing: false,
    submitCard: null,
    submitObserver: null,
    infoObserver: null,
    infoSyncTimer: null,
    descriptionClone: null,
    scrollSpyBound: false,
    pageData: undefined,
    submitPromise: null,
    allowNativeSubmitClick: false,
    settingsReturnFocus: null,
    themeMedia: null,
    themeObserver: null,
    lastGAt: 0,
  };

  const STORE_PREFIX = CONFIG.storagePrefix;

  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(STORE_PREFIX + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(STORE_PREFIX + key, JSON.stringify(value));
      } catch (e) { /* 隐私模式或容量已满时静默失败 */ }
    },
    remove(key) {
      try { localStorage.removeItem(STORE_PREFIX + key); } catch (e) { /* ignore */ }
    },
  };

  function $(selector, root) {
    try { return (root || document).querySelector(selector); } catch (e) { return null; }
  }

  function $$(selector, root) {
    try { return Array.from((root || document).querySelectorAll(selector)); } catch (e) { return []; }
  }

  function safe(fn, fallback) {
    try { return fn(); } catch (e) {
      console.warn('[luogu-md3]', e);
      return fallback;
    }
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function debounce(fn, wait) {
    let timer = 0;
    return function () {
      const args = arguments;
      const self = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(self, args); }, wait || 150);
    };
  }

  function waitFor(selector, timeout, root) {
    const limit = typeof timeout === 'number' ? timeout : 8000;
    return new Promise(function (resolve) {
      const existing = $(selector, root);
      if (existing) return resolve(existing);
      let done = false;
      let timer = 0;
      let observer = null;
      function finish(el) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (observer) observer.disconnect();
        resolve(el || null);
      }
      function check() {
        const el = $(selector, root);
        if (el) finish(el);
      }
      observer = new MutationObserver(check);
      try {
        observer.observe(document.documentElement, { childList: true, subtree: true });
      } catch (e) { /* ignore */ }
      timer = setTimeout(function () { finish($(selector, root)); }, limit);
      check();
    });
  }

  function getProblemId() {
    // 只接管真正的题面页；/problem/P1001/solution 等子页面保持原生。
    const match = location.pathname.match(/^\/problem\/([^/?#]+)\/?$/i);
    if (!match) return '';
    const id = match[1];
    if (['list', 'solution', 'submit', 'tag', 'filter'].indexOf(id.toLowerCase()) !== -1) return '';
    return id;
  }

  function isProblemPath() {
    return !!getProblemId();
  }

  function getProblemTitle() {
    const title = $('.header-card .title');
    if (title && title.textContent.trim()) return title.textContent.trim();
    return document.title.replace(/\s*-\s*洛谷\s*$/, '').trim();
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 2 && rect.height > 2;
  }

  function deepActiveElement() {
    let el = document.activeElement;
    try {
      while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    } catch (e) { /* ignore */ }
    return el;
  }

  const EDITABLE_SELECTOR = [
    'input', 'textarea', 'select',
    '[contenteditable=""]', '[contenteditable="true"]', '[contenteditable="plaintext-only"]',
    '.cm-editor', '.cm-content', '.monaco-editor', '.ace_editor', '.CodeMirror',
  ].join(',');

  function isEditableTarget(el) {
    if (!el || el.nodeType !== 1) return false;
    try {
      if (el.matches && el.matches(EDITABLE_SELECTOR)) return true;
      if (el.closest && el.closest(EDITABLE_SELECTOR)) return true;
    } catch (e) { /* ignore */ }
    return false;
  }

  function setBodyLock(locked) {
    try {
      document.documentElement.classList.toggle('lgmd3-lock', !!locked);
    } catch (e) { /* ignore */ }
  }

  function colorIsDark(value) {
    if (!value) return null;
    const text = String(value).trim();
    let r = 0, g = 0, b = 0, a = 1;
    if (/^#([0-9a-f]{3,8})$/i.test(text)) {
      let hex = text.slice(1);
      if (hex.length === 3 || hex.length === 4) {
        hex = hex.split('').map(function (ch) { return ch + ch; }).join('');
      }
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
      if (hex.length === 8) a = parseInt(hex.slice(6, 8), 16) / 255;
    } else {
      const match = text.match(/rgba?\(([^)]+)\)/i);
      if (!match) return null;
      const parts = match[1].split(',').map(function (part) { return part.trim(); });
      r = parseFloat(parts[0]) || 0;
      g = parseFloat(parts[1]) || 0;
      b = parseFloat(parts[2]) || 0;
      if (parts[3] !== undefined) a = parseFloat(parts[3]);
    }
    if (!Number.isFinite(r + g + b) || a === 0) return null;
    // 相对亮度近似值，足够判断导航栏/页面底色。
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return lum < 0.46;
  }

  function detectNativeTheme() {
    try {
      const top = $('.top-bar');
      if (top) {
        const navi = getComputedStyle(top).getPropertyValue('--theme-navi-back').trim()
          || top.style.getPropertyValue('--theme-navi-back').trim();
        const dark = colorIsDark(navi);
        if (dark !== null) return dark ? 'dark' : 'light';
      }
      const bodyBg = getComputedStyle(document.body).backgroundColor;
      const dark = colorIsDark(bodyBg);
      if (dark !== null) return dark ? 'dark' : 'light';
    } catch (e) { /* ignore */ }
    return '';
  }

  function applyTheme() {
    const preference = store.get('theme', 'auto');
    const root = document.documentElement;
    try {
      root.removeAttribute('data-lgmd3-theme');
      root.classList.remove('lgmd3-native-dark', 'lgmd3-native-light');
      if (preference === 'light' || preference === 'dark') {
        root.setAttribute('data-lgmd3-theme', preference);
      } else {
        const native = detectNativeTheme();
        if (native === 'dark') root.classList.add('lgmd3-native-dark');
        else if (native === 'light') root.classList.add('lgmd3-native-light');
      }
    } catch (e) { /* ignore */ }
  }

  function watchNativeTheme() {
    if (state.themeObserver) return;
    const top = $('.top-bar');
    if (!top) {
      setTimeout(watchNativeTheme, 1200);
      return;
    }
    try {
      state.themeObserver = new MutationObserver(debounce(applyTheme, 80));
      state.themeObserver.observe(top, { attributes: true, attributeFilter: ['style', 'class'] });
    } catch (e) { /* ignore */ }
  }

  function icon(name, cls) {
    const paths = {
      send: '<path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z"/>',
      copy: '<path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1Zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h11v14Z"/>',
      settings: '<path d="m19.14 12.94.04-.94-.04-.94 2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.58.24-1.12.55-1.62.94l-2.39-.96a.5.5 0 0 0-.61.22L2.71 8.48a.5.5 0 0 0 .12.64l2.03 1.58-.04.94.04.94-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.23.4.32.61.22l2.39-.96c.5.39 1.04.7 1.62.94l.36 2.54c.04.24.25.42.49.42h3.8c.24 0 .45-.18.49-.42l.36-2.54c.58-.24 1.12-.55 1.62-.94l2.39.96c.22.1.48 0 .61-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z"/>',
      close: '<path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z"/>',
      language: '<path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0 0 14.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04ZM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12Zm-2.62 7 1.62-4.33L19.12 17h-3.24Z"/>',
      expandMore: '<path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41Z"/>',
    };
    const body = paths[name] || paths.settings;
    return '<svg class="lgmd3-icon ' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + body + '</svg>';
  }

  function mdButton(tag, label, iconName) {
    const btn = document.createElement(tag);
    btn.className = 'lgmd3-md-button';
    if (iconName) {
      const iconWrap = document.createElement('span');
      iconWrap.setAttribute('slot', 'icon');
      iconWrap.className = 'lgmd3-button-icon';
      iconWrap.innerHTML = icon(iconName);
      btn.appendChild(iconWrap);
    }
    const text = document.createElement('span');
    text.className = 'lgmd3-button-label';
    text.textContent = label;
    btn.appendChild(text);
    btn.setAttribute('aria-label', label);
    return btn;
  }

  function setButtonLabel(btn, label) {
    if (!btn) return;
    const text = btn.querySelector('.lgmd3-button-label');
    if (text) text.textContent = label;
    else btn.textContent = label;
    btn.setAttribute('aria-label', label);
  }

  function showToast(message, options) {
    const opts = options || {};
    let toast = document.getElementById('lgmd3-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'lgmd3-toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      toast.innerHTML = '<span class="lgmd3-toast-text md-typescale-body-medium"></span><button type="button" class="lgmd3-toast-action md-typescale-label-large" hidden></button>';
      document.body.appendChild(toast);
    }
    const text = toast.querySelector('.lgmd3-toast-text');
    const action = toast.querySelector('.lgmd3-toast-action');
    if (text) text.textContent = message;
    if (action) {
      if (opts.actionLabel && typeof opts.onAction === 'function') {
        action.hidden = false;
        action.textContent = opts.actionLabel;
        action.onclick = function () {
          try { opts.onAction(); } catch (e) { /* ignore */ }
          hide();
        };
      } else {
        action.hidden = true;
        action.onclick = null;
      }
    }
    clearTimeout(state.toastTimer);
    toast.dataset.show = 'true';
    function hide() {
      toast.dataset.show = 'false';
      state.toastTimer = setTimeout(function () {
        if (toast && toast.dataset.show !== 'true') toast.remove();
      }, 220);
    }
    state.toastTimer = setTimeout(hide, opts.duration || 3000);
    return toast;
  }
  /* ============================================================
   * 样式
   * ============================================================ */
  const CSS = `
@import url("https://fontsapi.zeoseven.com/521/main/result.css");
@font-face {
  font-family: 'Roboto';
  font-style: normal;
  font-weight: 100 900;
  font-stretch: 100%;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/roboto/v51/KFO7CnqEu92Fr1ME7kSn66aGLdTylUAMa3KUBGEe.woff2) format('woff2');
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF;
}
@font-face {
  font-family: 'Roboto';
  font-style: normal;
  font-weight: 100 900;
  font-stretch: 100%;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/roboto/v51/KFO7CnqEu92Fr1ME7kSn66aGLdTylUAMa3yUBA.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
@font-face {
  font-family: 'Roboto Mono';
  font-style: normal;
  font-weight: 400 500;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/robotomono/v31/L0x5DF4xlVMF-BfR8bXMIjhFq3-OXg.woff2) format('woff2');
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF;
}
@font-face {
  font-family: 'Roboto Mono';
  font-style: normal;
  font-weight: 400 500;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/robotomono/v31/L0x5DF4xlVMF-BfR8bXMIjhLq38.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}

:root {
  --lgmd3-font-brand: 'JetBrains Maple Mono', 'Roboto', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  --lgmd3-font-plain: 'JetBrains Maple Mono', 'Roboto', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  --lgmd3-font-mono: 'JetBrains Maple Mono', 'Roboto Mono', 'JetBrains Mono', 'SFMono-Regular', Consolas, monospace;
  --lgmd3-max-width: ${CONFIG.maxWidth}px;
  --lgmd3-header-max-width: ${CONFIG.headerMaxWidth}px;
  --lgmd3-radius: 28px;
  --lgmd3-editor-line-height: 1.6;
  --md-ref-typeface-brand: var(--lgmd3-font-brand);
  --md-ref-typeface-plain: var(--lgmd3-font-plain);
  --md-ref-typeface-mono: var(--lgmd3-font-mono);
  --md-sys-typescale-body-large-font: var(--lgmd3-font-plain);
  --md-sys-typescale-body-medium-font: var(--lgmd3-font-plain);
  --md-sys-typescale-label-large-font: var(--lgmd3-font-plain);
  --md-sys-typescale-label-medium-font: var(--lgmd3-font-plain);
  --md-sys-typescale-title-large-font: var(--lgmd3-font-brand);
  --md-sys-typescale-headline-large-font: var(--lgmd3-font-brand);
}

html.lgmd3-active {
  color-scheme: light;
  --md-sys-color-primary: #0061a4;
  --md-sys-color-on-primary: #ffffff;
  --md-sys-color-primary-container: #d1e4ff;
  --md-sys-color-on-primary-container: #001d36;
  --md-sys-color-secondary: #535f70;
  --md-sys-color-on-secondary: #ffffff;
  --md-sys-color-secondary-container: #d7e3f7;
  --md-sys-color-on-secondary-container: #101c2b;
  --md-sys-color-tertiary: #6b5778;
  --md-sys-color-on-tertiary: #ffffff;
  --md-sys-color-tertiary-container: #f2daff;
  --md-sys-color-on-tertiary-container: #251431;
  --md-sys-color-error: #ba1a1a;
  --md-sys-color-on-error: #ffffff;
  --md-sys-color-error-container: #ffdad6;
  --md-sys-color-on-error-container: #410002;
  --md-sys-color-background: #f8f9ff;
  --md-sys-color-on-background: #191c20;
  --md-sys-color-surface: #f8f9ff;
  --md-sys-color-on-surface: #191c20;
  --md-sys-color-surface-variant: #dfe2eb;
  --md-sys-color-on-surface-variant: #43474e;
  --md-sys-color-outline: #73777f;
  --md-sys-color-outline-variant: #c3c7cf;
  --md-sys-color-shadow: #000000;
  --md-sys-color-scrim: #000000;
  --md-sys-color-inverse-surface: #2e3135;
  --md-sys-color-inverse-on-surface: #eff0f4;
  --md-sys-color-inverse-primary: #a1c9ff;
  --md-sys-color-surface-dim: #d8dae0;
  --md-sys-color-surface-bright: #f8f9ff;
  --md-sys-color-surface-container-lowest: #ffffff;
  --md-sys-color-surface-container-low: #f2f3fa;
  --md-sys-color-surface-container: #eceef4;
  --md-sys-color-surface-container-high: #e6e8ee;
  --md-sys-color-surface-container-highest: #e0e2e8;
  --md-sys-color-surface-tint: #0061a4;
  --md-sys-color-on-surface-variant: #43474e;
  background: var(--md-sys-color-background) !important;
}

html.lgmd3-active[data-lgmd3-theme="dark"],
html.lgmd3-active.lgmd3-native-dark:not([data-lgmd3-theme="light"]) {
  color-scheme: dark;
  --md-sys-color-primary: #a1c9ff;
  --md-sys-color-on-primary: #003258;
  --md-sys-color-primary-container: #00497d;
  --md-sys-color-on-primary-container: #d1e4ff;
  --md-sys-color-secondary: #bbc7db;
  --md-sys-color-on-secondary: #253140;
  --md-sys-color-secondary-container: #3b4858;
  --md-sys-color-on-secondary-container: #d7e3f7;
  --md-sys-color-tertiary: #d8bde6;
  --md-sys-color-on-tertiary: #3b2948;
  --md-sys-color-tertiary-container: #523f5f;
  --md-sys-color-on-tertiary-container: #f2daff;
  --md-sys-color-error: #ffb4ab;
  --md-sys-color-on-error: #690005;
  --md-sys-color-error-container: #93000a;
  --md-sys-color-on-error-container: #ffdad6;
  --md-sys-color-background: #101418;
  --md-sys-color-on-background: #e1e2e8;
  --md-sys-color-surface: #101418;
  --md-sys-color-on-surface: #e1e2e8;
  --md-sys-color-surface-variant: #43474e;
  --md-sys-color-on-surface-variant: #c3c7cf;
  --md-sys-color-outline: #8d9199;
  --md-sys-color-outline-variant: #43474e;
  --md-sys-color-shadow: #000000;
  --md-sys-color-scrim: #000000;
  --md-sys-color-inverse-surface: #e1e2e8;
  --md-sys-color-inverse-on-surface: #2e3135;
  --md-sys-color-inverse-primary: #0061a4;
  --md-sys-color-surface-dim: #101418;
  --md-sys-color-surface-bright: #36393e;
  --md-sys-color-surface-container-lowest: #0b0e11;
  --md-sys-color-surface-container-low: #191c20;
  --md-sys-color-surface-container: #1d2024;
  --md-sys-color-surface-container-high: #272a2f;
  --md-sys-color-surface-container-highest: #32353a;
  --md-sys-color-surface-tint: #a1c9ff;
}

@media (prefers-color-scheme: dark) {
  html.lgmd3-active:not([data-lgmd3-theme="light"]):not(.lgmd3-native-light):not(.lgmd3-native-dark) {
    color-scheme: dark;
    --md-sys-color-primary: #a1c9ff;
    --md-sys-color-on-primary: #003258;
    --md-sys-color-primary-container: #00497d;
    --md-sys-color-on-primary-container: #d1e4ff;
    --md-sys-color-secondary: #bbc7db;
    --md-sys-color-on-secondary: #253140;
    --md-sys-color-secondary-container: #3b4858;
    --md-sys-color-on-secondary-container: #d7e3f7;
    --md-sys-color-tertiary: #d8bde6;
    --md-sys-color-on-tertiary: #3b2948;
    --md-sys-color-tertiary-container: #523f5f;
    --md-sys-color-on-tertiary-container: #f2daff;
    --md-sys-color-error: #ffb4ab;
    --md-sys-color-on-error: #690005;
    --md-sys-color-error-container: #93000a;
    --md-sys-color-on-error-container: #ffdad6;
    --md-sys-color-background: #101418;
    --md-sys-color-on-background: #e1e2e8;
    --md-sys-color-surface: #101418;
    --md-sys-color-on-surface: #e1e2e8;
    --md-sys-color-surface-variant: #43474e;
    --md-sys-color-on-surface-variant: #c3c7cf;
    --md-sys-color-outline: #8d9199;
    --md-sys-color-outline-variant: #43474e;
    --md-sys-color-inverse-surface: #e1e2e8;
    --md-sys-color-inverse-on-surface: #2e3135;
    --md-sys-color-inverse-primary: #0061a4;
    --md-sys-color-surface-dim: #101418;
    --md-sys-color-surface-bright: #36393e;
    --md-sys-color-surface-container-lowest: #0b0e11;
    --md-sys-color-surface-container-low: #191c20;
    --md-sys-color-surface-container: #1d2024;
    --md-sys-color-surface-container-high: #272a2f;
    --md-sys-color-surface-container-highest: #32353a;
    --md-sys-color-surface-tint: #a1c9ff;
  }
}

html.lgmd3-active,
html.lgmd3-active body {
  background: var(--md-sys-color-background) !important;
  color: var(--md-sys-color-on-surface) !important;
}

html.lgmd3-active body {
  font-family: var(--lgmd3-font-plain) !important;
  padding: 0 !important;
  margin: 0 !important;
}

html.lgmd3-lock,
html.lgmd3-lock body {
  overflow: hidden !important;
}

/* ---------- 顶部导航 / 左侧导航：视觉移除 ---------- */
html.lgmd3-active .top-bar,
html.lgmd3-active .sidebar {
  display: none !important;
}

html.lgmd3-active .main-container.lside-nav {
  width: 100% !important;
  max-width: 100% !important;
  margin: 0 !important;
  padding: 0 !important;
  min-height: 100vh !important;
  --left-side-offset: 0px !important;
  --usable-width: 100vw !important;
}

html.lgmd3-active .theme-page {
  background: transparent !important;
  min-height: 0 !important;
}

/* 洛谷的 theme-frosted 用伪元素铺装饰性背景图，这里一并移除。 */
html.lgmd3-active .theme-page::before,
html.lgmd3-active .theme-page::after {
  display: none !important;
  background: none !important;
  background-image: none !important;
  content: none !important;
}

html.lgmd3-active .columba-content-wrap.header-layout {
  max-width: calc(var(--lgmd3-max-width) + 32px) !important;
  width: 100% !important;
  margin: 0 auto !important;
  padding: 24px 16px 0 !important;
  box-sizing: border-box !important;
}

html.lgmd3-active .columba-content-wrap.main-content {
  max-width: calc(var(--lgmd3-max-width) + 32px) !important;
  width: 100% !important;
  margin: 0 auto !important;
  padding: 0 16px !important;
  box-sizing: border-box !important;
}

/* 洛谷 l-card 的磨砂白遮罩会盖住 MD3 深色背景，统一移除。 */
html.lgmd3-active .l-card::before,
html.lgmd3-active .l-card::after {
  background: transparent !important;
  background-color: transparent !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

/* ---------- 顶部信息卡 ---------- */
html.lgmd3-active .header-card {
  width: 100% !important;
  max-width: var(--lgmd3-header-max-width) !important;
  margin: 0 auto 20px !important;
  padding: 24px !important;
  box-sizing: border-box !important;
  border-radius: var(--lgmd3-radius) !important;
  background: var(--md-sys-color-surface-container-low) !important;
  color: var(--md-sys-color-on-surface) !important;
  border: 1px solid var(--md-sys-color-outline-variant) !important;
  box-shadow: 0 1px 2px rgba(0, 0, 0, .08), 0 8px 24px rgba(0, 0, 0, .06) !important;
}

html.lgmd3-active .header-card .top-row {
  display: flex !important;
  flex-wrap: wrap !important;
  align-items: flex-start !important;
  gap: 16px !important;
}

html.lgmd3-active .header-card .title {
  font: 400 2rem/2.5rem var(--lgmd3-font-brand) !important;
  letter-spacing: 0 !important;
  color: var(--md-sys-color-on-surface) !important;
  margin: 0 0 4px !important;
}

html.lgmd3-active .header-card .stat.stacked {
  display: grid !important;
  grid-template-columns: repeat(4, minmax(64px, 1fr)) !important;
  gap: 8px !important;
  width: 100% !important;
}

html.lgmd3-active .header-card .stat.stacked .field {
  padding: 8px 10px !important;
  border-radius: 12px !important;
  background: var(--md-sys-color-surface-container) !important;
}

html.lgmd3-active .header-card .stat.stacked .field .stat-text.name,
html.lgmd3-active .header-card .stat.stacked .field .key {
  color: var(--md-sys-color-on-surface-variant) !important;
  font: 500 .75rem/1rem var(--lgmd3-font-plain) !important;
}

html.lgmd3-active .header-card .stat.stacked .field .stat-text.value,
html.lgmd3-active .header-card .stat.stacked .field .value {
  color: var(--md-sys-color-on-surface) !important;
  font: 500 .9375rem/1.25rem var(--lgmd3-font-plain) !important;
}

html.lgmd3-active .header-card .stat.stacked .field .stat-text {
  white-space: nowrap !important;
}

html.lgmd3-active .header-card .bottom-row {
  margin-top: 16px !important;
  padding-top: 14px !important;
  border-top: 1px solid var(--md-sys-color-outline-variant) !important;
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  gap: 14px !important;
  flex-wrap: wrap !important;
}

html.lgmd3-active .header-card .bottom-row > .right,
html.lgmd3-active .header-card .bottom-row .btn-actions {
  display: none !important;
}

html.lgmd3-active .header-card .bottom-row > .left {
  margin-left: auto !important;
  min-width: 0 !important;
}

html.lgmd3-active .header-card .menu {
  display: block !important;
}

html.lgmd3-active .header-card .menu .items {
  display: flex !important;
  align-items: center !important;
  justify-content: flex-end !important;
  gap: 4px !important;
  margin: 0 !important;
  padding: 0 !important;
  list-style: none !important;
}

html.lgmd3-active .header-card .menu .items li {
  display: block !important;
  margin: 0 !important;
  padding: 0 !important;
}

/* 「题目描述 / 提交答案」与「进入讨论版」保持同一套 MD3 胶囊按钮视觉。 */
html.lgmd3-active .header-card .menu .entry {
  position: relative !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  min-height: 32px !important;
  padding: 5px 13px !important;
  border: 0 !important;
  border-radius: 999px !important;
  background: var(--md-sys-color-surface-container) !important;
  color: var(--md-sys-color-primary) !important;
  font: 500 .8125rem/1.25rem var(--lgmd3-font-plain) !important;
  text-decoration: none !important;
  white-space: nowrap !important;
  cursor: pointer !important;
  transition: background .15s ease, color .15s ease !important;
}

html.lgmd3-active .header-card .menu .entry::before,
html.lgmd3-active .header-card .menu .entry::after {
  display: none !important;
  content: none !important;
  background: none !important;
  width: 0 !important;
  height: 0 !important;
}

html.lgmd3-active .header-card .menu .entry:hover {
  background: var(--md-sys-color-surface-container-high) !important;
  color: var(--md-sys-color-on-surface) !important;
}

html.lgmd3-active .header-card .menu .entry.selected,
html.lgmd3-active .header-card .menu .entry[data-lgmd3-active="true"] {
  background: var(--md-sys-color-primary-container) !important;
  color: var(--md-sys-color-on-primary-container) !important;
}

html.lgmd3-active .header-card .menu .entry.selected[data-lgmd3-active="false"] {
  background: transparent !important;
  color: var(--md-sys-color-on-surface-variant) !important;
}

/* ---------- 顶部操作区 ---------- */
.lgmd3-hero-actions {
  display: flex !important;
  flex-wrap: wrap !important;
  align-items: center !important;
  gap: 8px !important;
  margin-top: 18px !important;
  padding-top: 16px !important;
  border-top: 1px solid var(--md-sys-color-outline-variant) !important;
}

html.lgmd3-active .header-card .bottom-row > .lgmd3-hero-actions {
  flex: 1 1 auto !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
}

.lgmd3-hero-actions .lgmd3-md-button {
  --md-filled-button-container-height: 40px;
  --md-outlined-button-container-height: 40px;
  --md-text-button-container-height: 40px;
  --md-filled-button-label-text-font: var(--lgmd3-font-plain);
  --md-outlined-button-label-text-font: var(--lgmd3-font-plain);
  --md-text-button-label-text-font: var(--lgmd3-font-plain);
}

.lgmd3-hero-actions md-outlined-button {
  --md-outlined-button-label-text-color: var(--md-sys-color-primary);
  --md-outlined-button-icon-color: var(--md-sys-color-primary);
  --md-outlined-button-with-icon-icon-color: var(--md-sys-color-primary);
  --md-outlined-button-outline-color: var(--md-sys-color-outline);
}

.lgmd3-hero-actions md-text-button {
  --md-text-button-label-text-color: var(--md-sys-color-primary);
  --md-text-button-icon-color: var(--md-sys-color-primary);
  --md-text-button-with-icon-icon-color: var(--md-sys-color-primary);
}

.lgmd3-button-icon {
  display: inline-flex !important;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-right: 8px;
  color: inherit;
}

.lgmd3-icon {
  width: 18px;
  height: 18px;
  fill: currentColor;
  display: block;
}

.lgmd3-md-button:not(:defined) {
  display: inline-flex !important;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-height: 40px;
  padding: 0 20px;
  border: 0;
  border-radius: 999px;
  font: 500 .875rem/1.25rem var(--lgmd3-font-plain);
  cursor: pointer;
  user-select: none;
  transition: background .15s ease, box-shadow .15s ease;
}

md-filled-button.lgmd3-md-button:not(:defined) {
  background: var(--md-sys-color-primary) !important;
  color: var(--md-sys-color-on-primary) !important;
}

md-outlined-button.lgmd3-md-button:not(:defined) {
  background: transparent !important;
  color: var(--md-sys-color-primary) !important;
  border: 1px solid var(--md-sys-color-outline) !important;
}

md-text-button.lgmd3-md-button:not(:defined) {
  background: transparent !important;
  color: var(--md-sys-color-primary) !important;
  padding: 0 12px;
}

md-icon-button:not(:defined) {
  display: inline-flex !important;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  cursor: pointer;
}


/* ---------- 顶部平铺信息区 ---------- */
.lgmd3-info-grid {
  display: grid !important;
  grid-template-columns: minmax(230px, 1.15fr) repeat(2, minmax(170px, 1fr)) minmax(220px, 1.1fr);
  gap: 0 !important;
  width: 100% !important;
  margin-top: 20px !important;
  border-top: 1px solid var(--md-sys-color-outline-variant) !important;
}

.lgmd3-info-section {
  min-width: 0 !important;
  margin: 0 !important;
  padding: 16px 18px 12px !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
  color: var(--md-sys-color-on-surface) !important;
}

.lgmd3-info-section + .lgmd3-info-section {
  border-left: 1px solid var(--md-sys-color-outline-variant) !important;
}

.lgmd3-info-section h3 {
  margin: 0 0 10px !important;
  font: 500 .9375rem/1.25rem var(--lgmd3-font-brand) !important;
  color: var(--md-sys-color-on-surface) !important;
}

.lgmd3-info-section .l-flex-info-row {
  display: flex !important;
  align-items: baseline !important;
  justify-content: space-between !important;
  gap: 12px !important;
  padding: 5px 0 !important;
  font: 400 .875rem/1.25rem var(--lgmd3-font-plain) !important;
  color: var(--md-sys-color-on-surface-variant) !important;
  border-bottom: 1px dotted var(--md-sys-color-outline-variant) !important;
}

.lgmd3-info-section .l-flex-info-row > span:last-child {
  color: var(--md-sys-color-on-surface) !important;
  font-weight: 500 !important;
}

.lgmd3-info-meta > a,
.lgmd3-info-meta .l-flex-info-row + a {
  display: inline-flex !important;
  align-items: center !important;
  margin: 8px 8px 0 0 !important;
  padding: 5px 10px !important;
  border-radius: 999px !important;
  background: var(--md-sys-color-surface-container) !important;
  color: var(--md-sys-color-primary) !important;
  font: 500 .8125rem/1rem var(--lgmd3-font-plain) !important;
  text-decoration: none !important;
}

/* 标签列表：外层只负责布局，真正的 MD3 Chip 只画在单个标签上。 */
.lgmd3-info-tags .tags,
.lgmd3-info-tags ul {
  display: flex !important;
  flex-wrap: wrap !important;
  align-items: center !important;
  gap: 7px !important;
  margin: 2px 0 0 !important;
  padding: 0 !important;
  border: 0 !important;
  background: transparent !important;
  list-style: none !important;
}

.lgmd3-info-tags .tags > *,
.lgmd3-info-tags .tags li {
  display: inline-flex !important;
  align-items: center !important;
  min-height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
  list-style: none !important;
}

.lgmd3-info-tags .tags > *::before,
.lgmd3-info-tags .tags > *::after {
  display: none !important;
  content: none !important;
}

/* 有链接时链接就是唯一的 Chip；没有链接的叶子节点直接作为 Chip。 */
.lgmd3-info-tags .tags a,
.lgmd3-info-tags .tags .lfe-label {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  box-sizing: border-box !important;
  min-height: 32px !important;
  max-width: 100% !important;
  padding: 5px 12px !important;
  border: 1px solid var(--md-sys-color-outline-variant) !important;
  border-radius: 8px !important;
  background: var(--md-sys-color-surface-container-lowest) !important;
  color: var(--md-sys-color-on-surface-variant) !important;
  box-shadow: none !important;
  font: 500 .8125rem/1.15rem var(--lgmd3-font-plain) !important;
  line-height: 1.35 !important;
  text-decoration: none !important;
  white-space: nowrap !important;
  transition: background .15s ease, color .15s ease, border-color .15s ease !important;
}

.lgmd3-info-tags .tags > :not(:has(a)) {
  min-height: 32px !important;
  padding: 5px 12px !important;
  border: 1px solid var(--md-sys-color-outline-variant) !important;
  border-radius: 8px !important;
  background: var(--md-sys-color-surface-container-lowest) !important;
  color: var(--md-sys-color-on-surface-variant) !important;
  box-sizing: border-box !important;
  font: 500 .8125rem/1.15rem var(--lgmd3-font-plain) !important;
  line-height: 1.35 !important;
}

.lgmd3-info-tags .tags a:hover,
.lgmd3-info-tags .tags .lfe-label:hover {
  border-color: var(--md-sys-color-primary) !important;
  background: var(--md-sys-color-primary-container) !important;
  color: var(--md-sys-color-on-primary-container) !important;
}

/* 标签/讨论始终展开，不再提供任何折叠或隐藏入口。 */
.lgmd3-info-tags > .lfe-caption,
.lgmd3-info-discuss > .lfe-caption {
  display: none !important;
}

.lgmd3-info-discuss h3 {
  float: none !important;
  display: inline-block !important;
  margin-right: 8px !important;
}

.lgmd3-info-discuss > a {
  float: right !important;
  display: inline-flex !important;
  align-items: center !important;
  min-height: 30px !important;
  margin: 0 0 6px 8px !important;
  padding: 4px 10px !important;
  border-radius: 999px !important;
  background: var(--md-sys-color-surface-container) !important;
  color: var(--md-sys-color-primary) !important;
  font: 500 .75rem/1rem var(--lgmd3-font-plain) !important;
  text-decoration: none !important;
}

.lgmd3-info-discuss > ul {
  display: block !important;
  clear: both !important;
  margin: 0 !important;
  padding: 6px !important;
  border-radius: 12px !important;
  background: var(--md-sys-color-surface-container-lowest) !important;
  list-style: none !important;
}

.lgmd3-info-discuss > ul li {
  margin: 0 !important;
  padding: 7px 9px !important;
  border-radius: 8px !important;
  font: 400 .8125rem/1.35rem var(--lgmd3-font-plain) !important;
  color: var(--md-sys-color-on-surface-variant) !important;
}

.lgmd3-info-discuss > ul li + li {
  margin-top: 2px !important;
}

.lgmd3-info-discuss > ul li:hover {
  background: var(--md-sys-color-surface-container) !important;
}

.lgmd3-info-discuss > ul a {
  display: block !important;
  overflow: hidden !important;
  color: var(--md-sys-color-on-surface) !important;
  text-decoration: none !important;
  text-overflow: ellipsis !important;
  white-space: nowrap !important;
}

.lgmd3-info-discuss > ul a:hover {
  color: var(--md-sys-color-primary) !important;
}

/* 推荐题目：始终展开，不提供折叠入口 */
.lgmd3-recommend-card {
  padding: 15px 18px !important;
  border-radius: 0 0 16px 0 !important;
}

.lgmd3-recommend-card h3 {
  margin: 0 0 10px !important;
}

.lgmd3-recommend-card > ul {
  display: block !important;
  margin: 0 !important;
  padding: 10px 12px !important;
  border-radius: 12px !important;
  background: var(--md-sys-color-surface-container-lowest) !important;
  list-style: none !important;
}

.lgmd3-recommend-card > ul li {
  padding: 4px 0 !important;
  font: 400 .875rem/1.4rem var(--lgmd3-font-plain) !important;
}

.lgmd3-recommend-card > ul a {
  color: var(--md-sys-color-primary) !important;
  text-decoration: none !important;
}

.lgmd3-recommend-card > ul a:hover {
  text-decoration: underline !important;
}

.lgmd3-recommend-card > .lfe-caption {
  display: none !important;
}

/* ---------- 题面卡片 ---------- */
html.lgmd3-active .sidebar-container.reverse.layout {
  display: block !important;
  margin: 0 0 56px !important;
  padding: 0 !important;
}

html.lgmd3-active .sidebar-container .side {
  display: none !important;
}

html.lgmd3-active .sidebar-container .main {
  width: 100% !important;
  max-width: none !important;
  margin: 0 !important;
}

html.lgmd3-active .l-card.problem,
html.lgmd3-active .lgmd3-description-clone {
  position: relative !important;
  width: 100% !important;
  max-width: var(--lgmd3-max-width) !important;
  margin: 20px auto 0 !important;
  box-sizing: border-box !important;
  padding: clamp(20px, 3.2vw, 40px) !important;
  border-radius: var(--lgmd3-radius) !important;
  background: var(--md-sys-color-surface-container-low) !important;
  color: var(--md-sys-color-on-surface) !important;
  border: 1px solid var(--md-sys-color-outline-variant) !important;
  box-shadow: 0 1px 2px rgba(0, 0, 0, .06) !important;
}

/* 原生工具栏已由 MD3 工具栏替代：复制、语言选择浮动在右上 */
html.lgmd3-active .l-card.problem > .problem-block-actions,
html.lgmd3-active .lgmd3-description-clone > .problem-block-actions,
html.lgmd3-active .l-card.problem > a[href="javascript:void 0"],
html.lgmd3-active .lgmd3-description-clone > a[href="javascript:void 0"] {
  display: none !important;
}

.lgmd3-problem-toolbar {
  display: flex !important;
  flex-wrap: wrap !important;
  align-items: center !important;
  justify-content: flex-end !important;
  gap: 8px !important;
  margin: 0 0 10px !important;
  padding: 0 !important;
}

.lgmd3-problem-toolbar .lgmd3-md-button {
  --md-text-button-container-height: 34px;
  --md-text-button-label-text-size: .8125rem;
  --md-text-button-label-text-color: var(--md-sys-color-primary);
  --md-text-button-icon-color: var(--md-sys-color-primary);
  --md-text-button-with-icon-icon-color: var(--md-sys-color-primary);
  color: var(--md-sys-color-primary) !important;
}

.lgmd3-problem-toolbar .lgmd3-md-button:not(:defined) {
  min-height: 34px !important;
  padding: 0 10px !important;
  font-size: .8125rem !important;
}

.lgmd3-locale-wrap {
  position: relative !important;
  display: inline-flex !important;
  align-items: center !important;
}

.lgmd3-locale-button {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 7px !important;
  box-sizing: border-box !important;
  min-height: 34px !important;
  padding: 0 11px !important;
  border: 1px solid var(--md-sys-color-outline) !important;
  border-radius: 999px !important;
  background: var(--md-sys-color-surface-container) !important;
  color: var(--md-sys-color-on-surface-variant) !important;
  font: 500 .8125rem/1.2rem var(--lgmd3-font-plain) !important;
  cursor: pointer !important;
  transition: background .15s ease, border-color .15s ease, color .15s ease !important;
}

.lgmd3-locale-button:hover {
  background: var(--md-sys-color-surface-container-high) !important;
}

.lgmd3-locale-button[aria-expanded="true"] {
  border-color: var(--md-sys-color-primary) !important;
  background: var(--md-sys-color-primary-container) !important;
  color: var(--md-sys-color-on-primary-container) !important;
}

.lgmd3-locale-button:focus-visible {
  outline: 2px solid var(--md-sys-color-primary) !important;
  outline-offset: 2px !important;
}

.lgmd3-locale-button .lgmd3-icon {
  width: 16px !important;
  height: 16px !important;
  color: currentColor !important;
}

.lgmd3-locale-button .lgmd3-locale-label {
  color: var(--md-sys-color-on-surface) !important;
  font: inherit !important;
}

.lgmd3-locale-button[aria-expanded="true"] .lgmd3-locale-label {
  color: var(--md-sys-color-on-primary-container) !important;
}

.lgmd3-locale-button .lgmd3-locale-chevron {
  width: 16px !important;
  height: 16px !important;
  margin-left: 1px !important;
  color: currentColor !important;
  transition: transform .15s ease !important;
}

.lgmd3-locale-button[aria-expanded="true"] .lgmd3-locale-chevron {
  transform: rotate(180deg) !important;
}

/* MD3 菜单浮层，替代浏览器原生 select 的蓝色弹层。 */
.lgmd3-locale-menu {
  position: absolute !important;
  top: calc(100% + 6px) !important;
  right: 0 !important;
  z-index: 10040 !important;
  display: none !important;
  box-sizing: border-box !important;
  min-width: 164px !important;
  max-width: min(240px, calc(100vw - 28px)) !important;
  max-height: min(320px, 52vh) !important;
  margin: 0 !important;
  padding: 6px !important;
  border: 1px solid var(--md-sys-color-outline-variant) !important;
  border-radius: 12px !important;
  background: var(--md-sys-color-surface-container) !important;
  color: var(--md-sys-color-on-surface) !important;
  box-shadow: 0 8px 24px rgba(0, 0, 0, .2) !important;
  overflow: auto !important;
}

.lgmd3-locale-menu[data-open="true"] {
  display: block !important;
}

.lgmd3-locale-option {
  display: flex !important;
  align-items: center !important;
  width: 100% !important;
  box-sizing: border-box !important;
  min-height: 40px !important;
  margin: 0 !important;
  padding: 8px 12px !important;
  border: 0 !important;
  border-radius: 8px !important;
  background: transparent !important;
  color: var(--md-sys-color-on-surface) !important;
  font: 400 .875rem/1.25rem var(--lgmd3-font-plain) !important;
  text-align: left !important;
  cursor: pointer !important;
}

.lgmd3-locale-option + .lgmd3-locale-option {
  margin-top: 2px !important;
}

.lgmd3-locale-option:hover,
.lgmd3-locale-option:focus-visible {
  background: var(--md-sys-color-surface-container-high) !important;
  outline: 0 !important;
}

.lgmd3-locale-option[aria-selected="true"] {
  background: var(--md-sys-color-primary-container) !important;
  color: var(--md-sys-color-on-primary-container) !important;
  font-weight: 500 !important;
}

@media (max-width: 700px) {
  .lgmd3-locale-menu {
    right: 0 !important;
    left: auto !important;
  }
}

html.lgmd3-active .l-card.problem h2,
html.lgmd3-active .l-card.problem .lfe-h2 {
  margin: 28px 0 10px !important;
  padding-top: 22px !important;
  border-top: 1px solid var(--md-sys-color-outline-variant) !important;
  color: var(--md-sys-color-on-surface) !important;
  font: 500 1.375rem/1.75rem var(--lgmd3-font-brand) !important;
}

html.lgmd3-active .l-card.problem h2:first-of-type,
html.lgmd3-active .l-card.problem .lfe-h2:first-of-type {
  margin-top: 0 !important;
  padding-top: 0 !important;
  border-top: 0 !important;
}

html.lgmd3-active .l-card.problem .lfe-marked {
  color: var(--md-sys-color-on-surface) !important;
  font: 400 1rem/1.8 var(--lgmd3-font-plain) !important;
}

html.lgmd3-active .l-card.problem .lfe-marked p {
  margin: .7em 0 !important;
}

html.lgmd3-active .l-card.problem .lfe-marked a {
  color: var(--md-sys-color-primary) !important;
}

html.lgmd3-active .l-card.problem .lfe-marked img,
html.lgmd3-active .l-card.problem img {
  max-width: 100% !important;
  height: auto !important;
  border-radius: 10px;
}

html.lgmd3-active .l-card.problem .lfe-marked blockquote {
  margin: 14px 0 !important;
  padding: 10px 16px !important;
  border-left: 4px solid var(--md-sys-color-primary) !important;
  border-radius: 0 12px 12px 0 !important;
  background: var(--md-sys-color-surface-container) !important;
  color: var(--md-sys-color-on-surface-variant) !important;
}

html.lgmd3-active .l-card.problem .lfe-marked table {
  width: 100% !important;
  border-collapse: collapse !important;
  margin: 12px 0 !important;
  font-size: .9375rem !important;
}

html.lgmd3-active .l-card.problem .lfe-marked th,
html.lgmd3-active .l-card.problem .lfe-marked td {
  padding: 8px 10px !important;
  border: 1px solid var(--md-sys-color-outline-variant) !important;
}

html.lgmd3-active .l-card.problem .lfe-marked th {
  background: var(--md-sys-color-surface-container-high) !important;
  color: var(--md-sys-color-on-surface) !important;
}

html.lgmd3-active .l-card.problem .lfe-marked code {
  padding: 2px 5px !important;
  border-radius: 5px !important;
  background: var(--md-sys-color-surface-container-highest) !important;
  color: var(--md-sys-color-on-surface) !important;
  font-family: var(--lgmd3-font-mono) !important;
  font-size: .9em !important;
}

html.lgmd3-active .l-card.problem .lfe-marked pre,
html.lgmd3-active .l-card.problem .lfe-code,
html.lgmd3-active .l-card.problem .code-container {
  border-radius: 12px !important;
  background: var(--md-sys-color-surface-container-highest) !important;
  color: var(--md-sys-color-on-surface) !important;
  border: 1px solid var(--md-sys-color-outline-variant) !important;
}

html.lgmd3-active .l-card.problem .lfe-marked pre code {
  background: transparent !important;
  padding: 0 !important;
}

html.lgmd3-active .l-card.problem .io-sample {
  display: grid !important;
  grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
  gap: 12px !important;
}

html.lgmd3-active .l-card.problem .io-sample .sample {
  min-width: 0 !important;
  padding: 12px 14px !important;
  border-radius: 14px !important;
  background: var(--md-sys-color-surface-container) !important;
  border: 1px solid var(--md-sys-color-outline-variant) !important;
}

html.lgmd3-active .l-card.problem .io-sample .sample .caption {
  color: var(--md-sys-color-on-surface-variant) !important;
  font: 500 .75rem/1rem var(--lgmd3-font-plain) !important;
}

html.lgmd3-active .l-card.problem .io-sample .sample pre {
  margin: 6px 0 0 !important;
  background: transparent !important;
  border: 0 !important;
  padding: 0 !important;
}

html.lgmd3-active kbd {
  display: inline-block;
  padding: 2px 7px;
  border: 1px solid var(--md-sys-color-outline) !important;
  border-bottom-width: 2px !important;
  border-radius: 6px !important;
  background: var(--md-sys-color-surface-container) !important;
  color: var(--md-sys-color-on-surface) !important;
  font: 500 .75rem/1.2rem var(--lgmd3-font-mono) !important;
}

html.lgmd3-active ::selection {
  background: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
}

/* ---------- 提示条 ---------- */
#lgmd3-toast {
  position: fixed !important;
  bottom: 22px !important;
  left: 50% !important;
  z-index: 4000 !important;
  display: flex !important;
  align-items: center !important;
  gap: 14px !important;
  max-width: min(620px, calc(100vw - 32px)) !important;
  padding: 13px 18px !important;
  border-radius: 14px !important;
  background: var(--md-sys-color-inverse-surface) !important;
  color: var(--md-sys-color-inverse-on-surface) !important;
  box-shadow: 0 8px 28px rgba(0, 0, 0, .26) !important;
  font: 400 .875rem/1.35rem var(--lgmd3-font-plain) !important;
  transform: translate(-50%, 16px) !important;
  opacity: 0 !important;
  pointer-events: none !important;
  transition: opacity .18s ease, transform .18s ease !important;
}

#lgmd3-toast[data-show="true"] {
  opacity: 1 !important;
  transform: translate(-50%, 0) !important;
  pointer-events: auto !important;
}

#lgmd3-toast .lgmd3-toast-action {
  flex: 0 0 auto;
  border: 0;
  background: transparent;
  color: var(--md-sys-color-inverse-primary);
  font: 500 .875rem/1rem var(--lgmd3-font-plain);
  cursor: pointer;
}

/* ---------- 分段按钮 ---------- */
.lgmd3-segment-set {
  --md-outlined-segmented-button-container-height: 36px;
}

md-outlined-segmented-button-set:not(:defined) {
  display: inline-flex !important;
  border: 1px solid var(--md-sys-color-outline) !important;
  border-radius: 999px !important;
  overflow: hidden !important;
}

md-outlined-segmented-button:not(:defined) {
  padding: 7px 13px !important;
  color: var(--md-sys-color-on-surface) !important;
  font: 500 .8125rem/1.2rem var(--lgmd3-font-plain) !important;
  cursor: pointer;
  user-select: none;
}

md-outlined-segmented-button:not(:defined)[selected],
md-outlined-segmented-button:not(:defined)[aria-pressed="true"] {
  background: var(--md-sys-color-secondary-container) !important;
  color: var(--md-sys-color-on-secondary-container) !important;
}

html.lgmd3-active .l-card.problem .lfe-marked,
html.lgmd3-active .l-card.problem .lfe-marked * {
  overflow-wrap: break-word;
}

html.lgmd3-active .l-card.problem .lfe-marked .katex,
html.lgmd3-active .l-card.problem .lfe-marked .katex * {
  color: inherit;
}

/* ---------- 原生提交模块（内联） ---------- */
.lgmd3-description-clone {
  color: var(--md-sys-color-on-surface) !important;
  border: 1px solid var(--md-sys-color-outline-variant) !important;
  box-shadow: 0 1px 2px rgba(0, 0, 0, .06) !important;
  scroll-margin-top: 22px;
}

.lgmd3-description-clone.lgmd3-hidden {
  display: none !important;
}

.lgmd3-submit-heading {
  display: flex !important;
  align-items: center !important;
  gap: 10px !important;
  width: 100% !important;
  max-width: var(--lgmd3-max-width) !important;
  margin: 30px auto 12px !important;
  color: var(--md-sys-color-on-surface) !important;
  font: 500 1.25rem/1.6rem var(--lgmd3-font-brand) !important;
  scroll-margin-top: 22px;
}

.lgmd3-submit-heading::before {
  content: '';
  width: 5px;
  height: 22px;
  border-radius: 999px;
  background: var(--md-sys-color-primary);
}

.lgmd3-submit-card {
  box-sizing: border-box !important;
  width: 100% !important;
  max-width: var(--lgmd3-max-width) !important;
  margin: 0 auto 12px !important;
  border-radius: var(--lgmd3-radius) !important;
  background: var(--md-sys-color-surface-container-low) !important;
  color: var(--md-sys-color-on-surface) !important;
  border: 1px solid var(--md-sys-color-outline-variant) !important;
  box-shadow: 0 1px 2px rgba(0, 0, 0, .06) !important;
  overflow: hidden !important;
  scroll-margin-top: 22px;
  font-family: var(--lgmd3-font-plain) !important;
}

.lgmd3-submit-card > .header {
  padding: 10px 14px !important;
  background: var(--md-sys-color-surface-container) !important;
  border-bottom: 1px solid var(--md-sys-color-outline-variant) !important;
  color: var(--md-sys-color-on-surface-variant) !important;
  font-family: var(--lgmd3-font-plain) !important;
}

/* 原生提交卡内部的标签页 / 分段按钮统一成 MD3 胶囊。 */
.lgmd3-submit-card .header button,
.lgmd3-submit-card .header .l-button,
.lgmd3-submit-card .header [role="button"] {
  appearance: none !important;
  -webkit-appearance: none !important;
  border: 0 !important;
  border-radius: 999px !important;
  background: transparent !important;
  color: var(--md-sys-color-on-surface-variant) !important;
  box-shadow: none !important;
  padding: 7px 14px !important;
  margin: 0 !important;
  font: 500 .8125rem/1.2rem var(--lgmd3-font-plain) !important;
  cursor: pointer !important;
  transition: background .15s ease, color .15s ease !important;
}

.lgmd3-submit-card .header button:hover,
.lgmd3-submit-card .header .l-button:hover,
.lgmd3-submit-card .header [role="button"]:hover {
  background: var(--md-sys-color-surface-container-high) !important;
  color: var(--md-sys-color-on-surface) !important;
}

.lgmd3-submit-card .header button.selected,
.lgmd3-submit-card .header button.active,
.lgmd3-submit-card .header .l-button.selected,
.lgmd3-submit-card .header .l-button.active,
.lgmd3-submit-card .header [role="button"].selected,
.lgmd3-submit-card .header [aria-selected="true"] {
  background: var(--md-sys-color-primary-container) !important;
  color: var(--md-sys-color-on-primary-container) !important;
}

.lgmd3-submit-card .header .mock-seg,
.lgmd3-submit-card .header .tabs,
.lgmd3-submit-card .header .tab-list {
  display: inline-flex !important;
  align-items: center !important;
  gap: 4px !important;
  padding: 3px !important;
  border: 1px solid var(--md-sys-color-outline-variant) !important;
  border-radius: 999px !important;
  background: var(--md-sys-color-surface-container-lowest) !important;
}

.lgmd3-submit-card .header nav ul {
  display: inline-flex !important;
  align-items: center !important;
  gap: 4px !important;
  margin: 0 !important;
  padding: 3px !important;
  border: 1px solid var(--md-sys-color-outline-variant) !important;
  border-radius: 999px !important;
  background: var(--md-sys-color-surface-container-lowest) !important;
  list-style: none !important;
}

.lgmd3-submit-card .header nav li {
  margin: 0 !important;
  padding: 7px 14px !important;
  border-radius: 999px !important;
  color: var(--md-sys-color-on-surface-variant) !important;
  font: 500 .8125rem/1.2rem var(--lgmd3-font-plain) !important;
  cursor: pointer !important;
  list-style: none !important;
  transition: background .15s ease, color .15s ease !important;
}

.lgmd3-submit-card .header nav li:hover {
  background: var(--md-sys-color-surface-container-high) !important;
  color: var(--md-sys-color-on-surface) !important;
}

.lgmd3-submit-card .header nav li.selected,
.lgmd3-submit-card .header nav li.active {
  background: var(--md-sys-color-primary-container) !important;
  color: var(--md-sys-color-on-primary-container) !important;
}

/* 代码语言选择器：单一 MD3 描边，内部只保留文字与箭头。 */
.lgmd3-submit-card .combo-wrapper.lang-select {
  position: relative !important;
  display: inline-flex !important;
  align-items: center !important;
  gap: 6px !important;
  width: auto !important;
  box-sizing: border-box !important;
  min-width: 184px !important;
  min-height: 44px !important;
  padding: 0 10px 0 14px !important;
  border: 1px solid var(--md-sys-color-outline) !important;
  border-radius: 12px !important;
  background: var(--md-sys-color-surface-container-low) !important;
  color: var(--md-sys-color-on-surface) !important;
  box-shadow: none !important;
  outline: 0 !important;
  cursor: pointer !important;
  transition: border-color .15s ease, background .15s ease !important;
}

.lgmd3-submit-card .combo-wrapper.lang-select:hover,
.lgmd3-submit-card .combo-wrapper.lang-select:focus-visible {
  border-color: var(--md-sys-color-primary) !important;
  outline: 0 !important;
}

.lgmd3-submit-card .combo-wrapper.lang-select .text,
.lgmd3-submit-card .combo-wrapper.lang-select .text * {
  display: flex !important;
  flex: 1 1 auto !important;
  align-items: center !important;
  min-height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
  color: var(--md-sys-color-on-surface) !important;
  font: 400 .875rem/1.25rem var(--lgmd3-font-plain) !important;
}

.lgmd3-submit-card .combo-wrapper.lang-select .placeholder {
  color: var(--md-sys-color-on-surface-variant) !important;
}

.lgmd3-submit-card .combo-wrapper.lang-select .arrow {
  display: inline-flex !important;
  flex: 0 0 auto !important;
  align-items: center !important;
  justify-content: center !important;
  width: 22px !important;
  height: 22px !important;
  padding: 0 !important;
  border: 0 !important;
  background: transparent !important;
  color: var(--md-sys-color-on-surface-variant) !important;
}

.lgmd3-submit-card .combo-wrapper.lang-select .arrow svg {
  width: 15px !important;
  height: 15px !important;
}

.lgmd3-submit-card .combo-wrapper.lang-select .ruler {
  position: absolute !important;
  visibility: hidden !important;
  pointer-events: none !important;
  white-space: nowrap !important;
}

.lgmd3-lang-dropdown {
  z-index: 10020 !important;
  box-sizing: border-box !important;
  min-width: 184px !important;
  padding: 6px !important;
  border: 1px solid var(--md-sys-color-outline-variant) !important;
  border-radius: 8px !important;
  background: var(--md-sys-color-surface-container) !important;
  box-shadow: 0 8px 24px rgba(0, 0, 0, .2) !important;
  color: var(--md-sys-color-on-surface) !important;
  font-family: var(--lgmd3-font-plain) !important;
  overflow: hidden !important;
}

.lgmd3-lang-dropdown ul {
  max-height: min(360px, 50vh) !important;
  margin: 0 !important;
  padding: 0 !important;
  overflow: auto !important;
  list-style: none !important;
}

.lgmd3-lang-dropdown li {
  min-height: 40px !important;
  box-sizing: border-box !important;
  padding: 10px 12px !important;
  border-radius: 8px !important;
  color: var(--md-sys-color-on-surface) !important;
  font: 400 .875rem/1.25rem var(--lgmd3-font-plain) !important;
  cursor: pointer !important;
}

.lgmd3-lang-dropdown li + li {
  margin-top: 2px !important;
}

.lgmd3-lang-dropdown li:hover {
  background: var(--md-sys-color-surface-container-high) !important;
}

.lgmd3-submit-card .body {
  padding: clamp(18px, 2.8vw, 28px) !important;
  color: var(--md-sys-color-on-surface) !important;
}

.lgmd3-submit-card .lang-select,
.lgmd3-submit-card .lfe-select,
.lgmd3-submit-card select {
  min-height: 38px !important;
  border: 1px solid var(--md-sys-color-outline) !important;
  border-radius: 10px !important;
  background: var(--md-sys-color-surface-container-lowest) !important;
  color: var(--md-sys-color-on-surface) !important;
  font-family: var(--lgmd3-font-plain) !important;
}

.lgmd3-submit-card .lang-select {
  display: inline-flex !important;
  align-items: center !important;
  width: auto !important;
  min-width: 160px !important;
  padding: 0 8px !important;
}

.lgmd3-submit-card .lang-select select {
  width: 100% !important;
  min-width: 140px !important;
  min-height: 36px !important;
  padding: 0 28px 0 4px !important;
  border: 0 !important;
  border-radius: 8px !important;
  background-color: transparent !important;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%238d9199' d='M7 10l5 5 5-5z'/%3E%3C/svg%3E") !important;
  background-repeat: no-repeat !important;
  background-position: right 6px center !important;
  background-size: 18px 18px !important;
  color: var(--md-sys-color-on-surface) !important;
  font-family: var(--lgmd3-font-plain) !important;
  appearance: none !important;
  -webkit-appearance: none !important;
  cursor: pointer !important;
}

.lgmd3-submit-card .light-black {
  color: var(--md-sys-color-on-surface-variant) !important;
}

.lgmd3-submit-card textarea {
  display: block !important;
  width: 100% !important;
  min-height: var(--lgmd3-editor-height, 620px) !important;
  padding: 12px 14px !important;
  border: 1px solid var(--md-sys-color-outline-variant) !important;
  border-radius: 12px !important;
  background: var(--md-sys-color-surface-container-lowest) !important;
  color: var(--md-sys-color-on-surface) !important;
  font-family: var(--lgmd3-font-mono) !important;
  font-size: .9375rem !important;
  line-height: 1.6 !important;
  box-sizing: border-box !important;
  resize: vertical !important;
  outline: none !important;
}

.lgmd3-submit-card textarea::placeholder {
  color: var(--md-sys-color-on-surface-variant) !important;
  opacity: .86 !important;
}

/* CodeMirror / Monaco：保留语法主题，但外框、底色和高度跟随 MD3。 */
.lgmd3-submit-card .cm-editor,
.lgmd3-submit-card .CodeMirror,
.lgmd3-submit-card .monaco-editor {
  min-height: var(--lgmd3-editor-height, 620px) !important;
  border: 1px solid var(--md-sys-color-outline-variant) !important;
  border-radius: 12px !important;
  background: var(--md-sys-color-surface-container-lowest) !important;
  color: var(--md-sys-color-on-surface) !important;
  overflow: hidden !important;
  font-family: var(--lgmd3-font-mono) !important;
  font-size: .9375rem !important;
  line-height: 1.6 !important;
}

.lgmd3-submit-card .cm-scroller {
  min-height: 0 !important;
  font-family: var(--lgmd3-font-mono) !important;
}

.lgmd3-submit-card .cm-gutters {
  border-right: 1px solid var(--md-sys-color-outline-variant) !important;
  background: var(--md-sys-color-surface-container) !important;
  color: var(--md-sys-color-on-surface-variant) !important;
}

.lgmd3-submit-card .cm-content {
  caret-color: var(--md-sys-color-primary) !important;
}

/* 真实提交卡：编辑器外层是带内联 480px 高度的普通 div，用设置值覆盖。 */
.lgmd3-submit-card .body > div[style*="height"] {
  height: var(--lgmd3-editor-height, 620px) !important;
  min-height: var(--lgmd3-editor-height, 620px) !important;
  border: 1px solid var(--md-sys-color-outline-variant) !important;
  border-radius: 12px !important;
  background: var(--md-sys-color-surface-container-lowest) !important;
  overflow: hidden !important;
}

.lgmd3-submit-card .body > div[style*="height"] .cm-editor,
.lgmd3-submit-card .body > div[style*="height"] .CodeMirror,
.lgmd3-submit-card .body > div[style*="height"] textarea {
  height: 100% !important;
  min-height: 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
}

.lgmd3-submit-card .body > div[style*="height"] .cm-scroller {
  height: 100% !important;
  overflow: auto !important;
}

.lgmd3-submit-card .body > div[style*="height"] textarea {
  resize: none !important;
}

.lgmd3-submit-card .body > button.solid {
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  margin-left: auto !important;
  margin-top: 16px !important;
}

.lgmd3-submit-card .drop {
  border: 2px dashed var(--md-sys-color-outline) !important;
  border-radius: 14px !important;
  background: var(--md-sys-color-surface-container-lowest) !important;
  color: var(--md-sys-color-on-surface-variant) !important;
}

.lgmd3-submit-card button.solid,
.lgmd3-submit-card .l-button.solid {
  border: 0 !important;
  border-radius: 999px !important;
  background: var(--md-sys-color-primary) !important;
  color: var(--md-sys-color-on-primary) !important;
  font: 500 .875rem/1.25rem var(--lgmd3-font-plain) !important;
  padding: 9px 18px !important;
  min-height: 40px !important;
  cursor: pointer !important;
  box-shadow: 0 1px 3px rgba(0, 0, 0, .18) !important;
}

.lgmd3-submit-card .footer,
.lgmd3-submit-card .mock-footer {
  display: flex !important;
  align-items: center !important;
  justify-content: flex-end !important;
  gap: 12px !important;
  margin-top: 14px !important;
}

.lgmd3-submit-card .l-card.burger,
.lgmd3-submit-card .header,
.lgmd3-submit-card .body {
  box-sizing: border-box !important;
}

.lgmd3-submit-card .lfe-caption,
.lgmd3-submit-card p {
  color: var(--md-sys-color-on-surface-variant) !important;
}

.lgmd3-submit-card h3 {
  color: var(--md-sys-color-on-surface) !important;
  font-family: var(--lgmd3-font-brand) !important;
}

/* 深色模式下把原生提交卡里可能残留的浅色底统一收进 MD3 色板。 */
html[data-lgmd3-theme="dark"] .lgmd3-submit-card .body,
html.lgmd3-native-dark .lgmd3-submit-card .body {
  background: transparent !important;
}

html[data-lgmd3-theme="dark"] .lgmd3-submit-card .combo-wrapper.lang-select,
html.lgmd3-native-dark .lgmd3-submit-card .combo-wrapper.lang-select,
html[data-lgmd3-theme="dark"] .lgmd3-submit-card .lang-select,
html.lgmd3-native-dark .lgmd3-submit-card .lang-select,
html[data-lgmd3-theme="dark"] .lgmd3-submit-card select,
html.lgmd3-native-dark .lgmd3-submit-card select {
  border-color: var(--md-sys-color-outline) !important;
  background-color: var(--md-sys-color-surface-container) !important;
  color: var(--md-sys-color-on-surface) !important;
  color-scheme: dark !important;
}

html[data-lgmd3-theme="dark"] .lgmd3-submit-card textarea,
html.lgmd3-native-dark .lgmd3-submit-card textarea,
html[data-lgmd3-theme="dark"] .lgmd3-submit-card .cm-editor,
html.lgmd3-native-dark .lgmd3-submit-card .cm-editor,
html[data-lgmd3-theme="dark"] .lgmd3-submit-card .CodeMirror,
html.lgmd3-native-dark .lgmd3-submit-card .CodeMirror {
  background: var(--md-sys-color-surface-container-lowest) !important;
  color: var(--md-sys-color-on-surface) !important;
  caret-color: var(--md-sys-color-primary) !important;
}

html[data-lgmd3-theme="dark"] .lgmd3-submit-card .cm-gutters,
html.lgmd3-native-dark .lgmd3-submit-card .cm-gutters {
  background: var(--md-sys-color-surface-container) !important;
  color: var(--md-sys-color-on-surface-variant) !important;
}

html[data-lgmd3-theme="dark"] .lgmd3-submit-card .cm-scroller,
html.lgmd3-native-dark .lgmd3-submit-card .cm-scroller,
html[data-lgmd3-theme="dark"] .lgmd3-submit-card .cm-content,
html.lgmd3-native-dark .lgmd3-submit-card .cm-content,
html[data-lgmd3-theme="dark"] .lgmd3-submit-card .CodeMirror-scroll,
html.lgmd3-native-dark .lgmd3-submit-card .CodeMirror-scroll,
html[data-lgmd3-theme="dark"] .lgmd3-submit-card .CodeMirror-lines,
html.lgmd3-native-dark .lgmd3-submit-card .CodeMirror-lines {
  background: var(--md-sys-color-surface-container-lowest) !important;
  color: var(--md-sys-color-on-surface) !important;
}

html[data-lgmd3-theme="dark"] .lgmd3-submit-card .body > div[style*="height"],
html.lgmd3-native-dark .lgmd3-submit-card .body > div[style*="height"] {
  border-color: var(--md-sys-color-outline-variant) !important;
  background: var(--md-sys-color-surface-container-lowest) !important;
}

html.lgmd3-active .sidebar-container .main > .lgmd3-description-clone + .lgmd3-submit-heading,
html.lgmd3-active .sidebar-container .main > .lgmd3-submit-heading + .lgmd3-submit-card {
  margin-top: 12px !important;
}

@media (max-width: 980px) {
  .lgmd3-info-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
  }
  .lgmd3-info-section:nth-child(odd) {
    border-left: 0 !important;
  }
  .lgmd3-info-section:nth-child(n+3) {
    border-top: 1px solid var(--md-sys-color-outline-variant) !important;
  }
}

@media (max-width: 760px) {
  html.lgmd3-active .header-card .bottom-row {
    align-items: stretch !important;
    gap: 10px !important;
  }
  html.lgmd3-active .header-card .bottom-row > .left,
  html.lgmd3-active .header-card .menu {
    width: 100% !important;
    margin-left: 0 !important;
  }
  html.lgmd3-active .header-card .menu .items {
    justify-content: flex-end !important;
    flex-wrap: wrap !important;
  }
}

@media (max-width: 640px) {
  html.lgmd3-active .columba-content-wrap.header-layout {
    padding: 12px 8px 0 !important;
  }
  html.lgmd3-active .columba-content-wrap.main-content {
    padding: 0 8px !important;
  }
  html.lgmd3-active .header-card {
    padding: 18px !important;
    border-radius: 22px !important;
  }
  html.lgmd3-active .header-card .title {
    font-size: 1.5rem !important;
    line-height: 2rem !important;
  }
  .lgmd3-info-grid {
    grid-template-columns: 1fr !important;
  }
  .lgmd3-info-section,
  .lgmd3-info-section + .lgmd3-info-section {
    border-left: 0 !important;
    border-top: 1px solid var(--md-sys-color-outline-variant) !important;
    padding: 14px 4px 10px !important;
  }
  .lgmd3-info-section:first-child {
    border-top: 0 !important;
  }
  html.lgmd3-active .l-card.problem,
  html.lgmd3-active .lgmd3-description-clone {
    padding: 18px !important;
    border-radius: 22px !important;
  }
  .lgmd3-submit-heading,
  .lgmd3-submit-card {
    border-radius: 22px !important;
  }
  .lgmd3-problem-toolbar {
    justify-content: flex-start !important;
  }
  html.lgmd3-active .header-card .bottom-row {
    align-items: stretch !important;
    gap: 10px !important;
  }
  html.lgmd3-active .header-card .bottom-row > .left,
  html.lgmd3-active .header-card .menu {
    width: 100% !important;
    margin-left: 0 !important;
  }
  html.lgmd3-active .header-card .menu .items {
    justify-content: flex-end !important;
    flex-wrap: wrap !important;
  }
  .lgmd3-submit-card {
    border-radius: 22px !important;
  }
  html.lgmd3-active .l-card.problem .io-sample {
    grid-template-columns: 1fr !important;
  }
}
/* ---------- 设置面板 ---------- */
#lgmd3-settings {
  position: fixed !important;
  inset: 0 !important;
  z-index: 2600 !important;
  display: none !important;
  font-family: var(--lgmd3-font-plain);
}

#lgmd3-settings[data-open="true"] {
  display: block !important;
}

#lgmd3-settings .lgmd3-settings-backdrop {
  position: absolute !important;
  inset: 0 !important;
  background: rgba(0, 0, 0, .4) !important;
  backdrop-filter: blur(3px);
}

#lgmd3-settings .lgmd3-settings-panel {
  position: absolute !important;
  left: 50% !important;
  top: 50% !important;
  display: flex !important;
  flex-direction: column !important;
  box-sizing: border-box !important;
  width: min(600px, calc(100vw - 24px)) !important;
  max-height: min(830px, calc(100vh - 24px)) !important;
  border-radius: 26px !important;
  background: var(--md-sys-color-surface-container-lowest) !important;
  color: var(--md-sys-color-on-surface) !important;
  border: 1px solid var(--md-sys-color-outline-variant) !important;
  box-shadow: 0 18px 64px rgba(0, 0, 0, .34) !important;
  transform: translate(-50%, -50%) !important;
  overflow: hidden !important;
}

#lgmd3-settings .lgmd3-settings-head {
  flex: 0 0 auto;
  display: flex !important;
  align-items: center !important;
  gap: 12px !important;
  padding: 16px 18px !important;
  background: var(--md-sys-color-surface-container) !important;
  border-bottom: 1px solid var(--md-sys-color-outline-variant) !important;
}

#lgmd3-settings .lgmd3-settings-head h2 {
  flex: 1 1 auto;
  margin: 0 !important;
  color: var(--md-sys-color-on-surface) !important;
  font: 500 1.25rem/1.75rem var(--lgmd3-font-brand) !important;
}

#lgmd3-settings .lgmd3-settings-body {
  flex: 1 1 auto;
  min-height: 0 !important;
  overflow: auto !important;
  padding: 16px 18px !important;
}

#lgmd3-settings .lgmd3-settings-section {
  padding: 14px 0 !important;
  border-bottom: 1px solid var(--md-sys-color-outline-variant) !important;
}

#lgmd3-settings .lgmd3-settings-section:last-child {
  border-bottom: 0 !important;
}

#lgmd3-settings .lgmd3-settings-section h3 {
  margin: 0 0 10px !important;
  color: var(--md-sys-color-on-surface-variant) !important;
  font: 500 .8125rem/1.1rem var(--lgmd3-font-plain) !important;
  letter-spacing: .04em;
  text-transform: uppercase;
}

#lgmd3-settings .lgmd3-setting-row {
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  gap: 14px !important;
  padding: 8px 0 !important;
  color: var(--md-sys-color-on-surface) !important;
  font: 400 .9375rem/1.35rem var(--lgmd3-font-plain) !important;
}

#lgmd3-settings .lgmd3-setting-row .lgmd3-setting-desc {
  display: block;
  margin-top: 2px;
  color: var(--md-sys-color-on-surface-variant);
  font: 400 .75rem/1.1rem var(--lgmd3-font-plain);
}

#lgmd3-settings .lgmd3-editor-height-control {
  flex: 0 0 auto;
  display: flex !important;
  align-items: center !important;
  gap: 10px !important;
  min-width: 240px !important;
}

#lgmd3-settings .lgmd3-editor-height-control input[type="range"] {
  flex: 1 1 auto;
  width: 150px;
  height: 20px;
  margin: 0;
  accent-color: var(--md-sys-color-primary);
  cursor: pointer;
}

#lgmd3-settings .lgmd3-editor-height-value {
  flex: 0 0 auto;
  min-width: 64px;
  padding: 4px 8px;
  border-radius: 8px;
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
  font: 500 .75rem/1rem var(--lgmd3-font-plain);
  text-align: center;
  white-space: nowrap;
}

#lgmd3-settings .lgmd3-switch {
  appearance: none !important;
  -webkit-appearance: none !important;
  flex: 0 0 auto;
  position: relative;
  width: 46px !important;
  height: 26px !important;
  margin: 0 !important;
  border: 2px solid var(--md-sys-color-outline) !important;
  border-radius: 999px !important;
  background: var(--md-sys-color-surface-container-highest) !important;
  cursor: pointer !important;
  transition: background .15s ease, border-color .15s ease;
}

#lgmd3-settings .lgmd3-switch::after {
  content: '';
  position: absolute;
  left: 2px;
  top: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--md-sys-color-outline);
  transition: transform .15s ease, background .15s ease;
}

#lgmd3-settings .lgmd3-switch:checked {
  border-color: var(--md-sys-color-primary) !important;
  background: var(--md-sys-color-primary) !important;
}

#lgmd3-settings .lgmd3-switch:checked::after {
  transform: translateX(20px);
  background: var(--md-sys-color-on-primary);
}

#lgmd3-settings .lgmd3-shortcut-grid {
  display: grid !important;
  grid-template-columns: 1fr auto !important;
  gap: 8px 16px !important;
  align-items: center;
  padding: 8px 0 !important;
}

#lgmd3-settings .lgmd3-shortcut-grid > span {
  color: var(--md-sys-color-on-surface) !important;
  font: 400 .875rem/1.3rem var(--lgmd3-font-plain) !important;
}

#lgmd3-settings .lgmd3-shortcut-grid > div {
  text-align: right;
  white-space: nowrap;
}

#lgmd3-settings .lgmd3-hint {
  margin: 8px 0 0 !important;
  padding: 10px 12px !important;
  border-radius: 10px !important;
  background: var(--md-sys-color-surface-container) !important;
  color: var(--md-sys-color-on-surface-variant) !important;
  font: 400 .75rem/1.35rem var(--lgmd3-font-plain) !important;
}

#lgmd3-settings .lgmd3-settings-footer {
  flex: 0 0 auto;
  display: flex !important;
  align-items: center !important;
  gap: 8px !important;
  padding: 12px 16px !important;
  border-top: 1px solid var(--md-sys-color-outline-variant) !important;
  background: var(--md-sys-color-surface-container) !important;
}

#lgmd3-settings .lgmd3-settings-footer .lgmd3-grow {
  flex: 1 1 auto;
}

#lgmd3-settings .lgmd3-settings-section .lgmd3-segment-set {
  margin-top: 2px;
  white-space: nowrap;
}

#lgmd3-settings .lgmd3-segment-set md-outlined-segmented-button {
  white-space: nowrap;
  --md-outlined-segmented-button-label-text-font: var(--lgmd3-font-plain);
}

#lgmd3-settings .lgmd3-theme-slot {
  flex: 0 0 auto;
  display: flex;
  justify-content: flex-end;
  min-width: 240px;
}

@media (max-width: 600px) {
  #lgmd3-settings .lgmd3-setting-row {
    flex-direction: column !important;
    align-items: stretch !important;
  }
  #lgmd3-settings .lgmd3-theme-slot {
    width: 100%;
    min-width: 0;
    justify-content: flex-start;
  }
  #lgmd3-settings .lgmd3-editor-height-control {
    width: 100%;
    min-width: 0;
  }
  #lgmd3-settings .lgmd3-settings-panel {
    width: 100vw !important;
    height: 100vh !important;
    max-height: none !important;
    border-radius: 0 !important;
  }
  #lgmd3-settings .lgmd3-settings-body {
    padding: 12px 14px !important;
  }
}

/* 未定义 Material 组件时的兜底外观 */
md-elevation:not(:defined) {
  display: block !important;
  position: absolute !important;
  inset: 0 !important;
  border-radius: inherit;
  box-shadow: 0 1px 3px rgba(0, 0, 0, .15) !important;
  pointer-events: none;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
  }
  #lgmd3-settings .lgmd3-settings-panel,
  #lgmd3-toast {
    transition: none !important;
  }
}
`;

  function injectStyles() {
    try {
      if (typeof GM_addStyle === 'function') {
        state.styleElement = GM_addStyle(CSS);
        if (state.styleElement) state.styleElement.dataset.lgmd3 = 'style';
        return;
      }
    } catch (e) { /* fall through */ }
    try {
      if (document.adoptedStyleSheets && typeof CSSStyleSheet === 'function') {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(CSS);
        document.adoptedStyleSheets = document.adoptedStyleSheets.concat(sheet);
        state.styleSheet = sheet;
        return;
      }
    } catch (e) { /* fall through */ }
    try {
      const style = document.createElement('style');
      style.id = 'lgmd3-style';
      style.textContent = CSS;
      document.head.appendChild(style);
      state.styleElement = style;
    } catch (e) {
      console.warn('[luogu-md3] 样式注入失败', e);
    }
  }
  /* ============================================================
   * Material Web 加载
   * ============================================================ */
  function addImportMap() {
    try {
      if (document.querySelector('script[type="importmap"]')) return;
      const map = {
        imports: {
          '@material/web/': CONFIG.material.importMapBase,
        },
      };
      const script = document.createElement('script');
      script.type = 'importmap';
      script.dataset.lgmd3 = 'importmap';
      script.textContent = JSON.stringify(map);
      document.head.appendChild(script);
    } catch (e) {
      console.warn('[luogu-md3] importmap 注入失败', e);
    }
  }

  function injectModuleScript(code) {
    const script = document.createElement('script');
    script.type = 'module';
    script.dataset.lgmd3 = 'module';
    script.textContent = code;
    try {
      if (typeof GM_addElement === 'function') {
        GM_addElement('script', { type: 'module', textContent: code });
        return script;
      }
    } catch (e) { /* fall through */ }
    try {
      document.head.appendChild(script);
    } catch (e) {
      console.warn('[luogu-md3] module 注入失败', e);
    }
    return script;
  }

  function materialAlreadyDefined() {
    try { return !!customElements.get('md-filled-button'); } catch (e) { return false; }
  }

  function pageCspAllowsExternal() {
    try {
      const metas = $$('meta[http-equiv]').filter(function (m) {
        return (m.getAttribute('http-equiv') || '').toLowerCase() === 'content-security-policy';
      });
      if (!metas.length) return true;
      const content = metas.map(function (m) { return m.getAttribute('content') || ''; }).join(' ');
      if (!content) return true;
      return /esm\.run|jsdelivr|unpkg/i.test(content);
    } catch (e) {
      return true;
    }
  }

  function waitForMaterial(timeout) {
    const limit = typeof timeout === 'number' ? timeout : 8000;
    return new Promise(function (resolve) {
      if (materialAlreadyDefined()) return resolve(true);
      let done = false;
      let timer = 0;
      function finish(ok) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        window.removeEventListener('lgmd3-material-ready', onReady);
        resolve(!!ok);
      }
      function onReady() { finish(true); }
      window.addEventListener('lgmd3-material-ready', onReady);
      timer = setTimeout(function () { finish(materialAlreadyDefined()); }, limit);
      if (materialAlreadyDefined()) finish(true);
    });
  }

  function loadMaterialViaImportMap() {
    return new Promise(function (resolve) {
      if (materialAlreadyDefined()) return resolve(true);
      let done = false;
      let timer = 0;
      function finish(ok) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        window.removeEventListener('lgmd3-material-ready', onReady);
        window.removeEventListener('lgmd3-material-error', onError);
        resolve(!!ok);
      }
      function onReady() { finish(true); }
      function onError() { finish(false); }
      window.addEventListener('lgmd3-material-ready', onReady);
      window.addEventListener('lgmd3-material-error', onError);

      const code = `
(async function () {
  const ready = function () { window.dispatchEvent(new CustomEvent('lgmd3-material-ready')); };
  const fail = function (e) { window.dispatchEvent(new CustomEvent('lgmd3-material-error', { detail: String(e || '') })); };
  try {
    try {
      await import('@material/web/all.js');
    } catch (e1) {
      await import('https://fastly.jsdelivr.net/npm/@material/web@2.4.0/all.js/+esm');
    }
    try { await import('@material/web/labs/segmentedbuttonset/outlined-segmented-button-set.js'); }
    catch (e2) { await import('https://fastly.jsdelivr.net/npm/@material/web@2.4.0/labs/segmentedbuttonset/outlined-segmented-button-set.js/+esm'); }
    try { await import('@material/web/labs/segmentedbutton/outlined-segmented-button.js'); }
    catch (e3) { await import('https://fastly.jsdelivr.net/npm/@material/web@2.4.0/labs/segmentedbutton/outlined-segmented-button.js/+esm'); }
    try {
      const ts = await import('@material/web/typography/md-typescale-styles.js');
      if (ts && ts.styles) {
        document.adoptedStyleSheets = document.adoptedStyleSheets.concat(ts.styles);
      }
    } catch (e4) {
      try {
        const ts2 = await import('https://fastly.jsdelivr.net/npm/@material/web@2.4.0/typography/md-typescale-styles.js/+esm');
        if (ts2 && ts2.styles) {
          document.adoptedStyleSheets = document.adoptedStyleSheets.concat(ts2.styles);
        }
      } catch (e5) { /* 忽略，使用脚本内置的 typescale 兜底 */ }
    }
    ready();
  } catch (e) {
    fail(e);
  }
})();
`;
      injectModuleScript(code);
      timer = setTimeout(function () { finish(materialAlreadyDefined()); }, 5000);
    });
  }

  function gmFetchText(url) {
    return new Promise(function (resolve, reject) {
      if (typeof GM_xmlhttpRequest !== 'function') {
        return reject(new Error('GM_xmlhttpRequest unavailable'));
      }
      try {
        GM_xmlhttpRequest({
          method: 'GET',
          url: url,
          timeout: 20000,
          headers: { 'Accept': 'text/javascript, application/javascript, */*' },
          onload: function (response) {
            if (response.status >= 200 && response.status < 300) {
              resolve({
                text: response.responseText,
                finalUrl: response.finalUrl || url,
              });
            } else {
              reject(new Error('HTTP ' + response.status + ' ' + url));
            }
          },
          onerror: function (error) { reject(error || new Error('network error')); },
          ontimeout: function () { reject(new Error('timeout ' + url)); },
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  class BlobModuleLoader {
    constructor() {
      this.cache = new Map();
      this.pending = new Map();
      this.urls = [];
    }

    absolute(spec, base) {
      if (spec.indexOf('/npm/') === 0) return 'https://cdn.jsdelivr.net' + spec;
      if (spec.indexOf('//') === 0) return 'https:' + spec;
      if (/^https?:/i.test(spec)) return spec;
      if (spec[0] === '/' || spec[0] === '.') return new URL(spec, base).href;
      return 'https://cdn.jsdelivr.net/npm/' + spec.replace(/^\/+/, '') + '/+esm';
    }

    async loadFirst(urls) {
      let lastError = null;
      for (let i = 0; i < urls.length; i += 1) {
        try {
          return await this.load(urls[i]);
        } catch (e) {
          lastError = e;
          console.warn('[luogu-md3] Material 资源加载失败，尝试下一个地址', urls[i], e);
        }
      }
      throw lastError || new Error('No Material Web URL available');
    }

    async load(url) {
      const key = this.absolute(url, location.href);
      if (this.cache.has(key)) return this.cache.get(key);
      if (this.pending.has(key)) return this.pending.get(key);
      const job = this.loadOne(key).then((blobUrl) => {
        this.cache.set(key, blobUrl);
        this.pending.delete(key);
        return blobUrl;
      }).catch((e) => {
        this.pending.delete(key);
        throw e;
      });
      this.pending.set(key, job);
      return job;
    }

    async loadOne(url) {
      const response = await gmFetchText(url);
      const base = response.finalUrl || url;
      const text = response.text;
      const specRegex = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(["'])([^"']+)\1/g;
      const specs = [];
      let match;
      while ((match = specRegex.exec(text)) !== null) {
        if (specs.indexOf(match[2]) === -1) specs.push(match[2]);
      }
      let output = text;
      for (let i = 0; i < specs.length; i += 1) {
        const spec = specs[i];
        let absolute;
        try {
          absolute = this.absolute(spec, base);
        } catch (e) {
          continue;
        }
        const blobUrl = await this.load(absolute);
        output = output.split('"' + spec + '"').join('"' + blobUrl + '"');
        output = output.split("'" + spec + "'").join("'" + blobUrl + "'");
      }
      const blob = new Blob([output], { type: 'text/javascript' });
      const blobUrl = URL.createObjectURL(blob);
      this.urls.push(blobUrl);
      return blobUrl;
    }
  }

  async function loadMaterialViaBlob() {
    if (typeof GM_xmlhttpRequest !== 'function') return false;
    try {
      const loader = new BlobModuleLoader();
      const allUrl = await loader.loadFirst(CONFIG.material.all);
      const setUrl = await loader.loadFirst(CONFIG.material.segmentedSet);
      const buttonUrl = await loader.loadFirst(CONFIG.material.segmentedButton);
      let typescaleUrl = '';
      try { typescaleUrl = await loader.loadFirst(CONFIG.material.typescale); } catch (e) { /* optional */ }

      let code = 'import ' + JSON.stringify(allUrl) + ';\n';
      code += 'import ' + JSON.stringify(setUrl) + ';\n';
      code += 'import ' + JSON.stringify(buttonUrl) + ';\n';
      if (typescaleUrl) {
        code += 'import { styles as __lgmd3Typescale } from ' + JSON.stringify(typescaleUrl) + ';\n';
        code += 'try { document.adoptedStyleSheets = document.adoptedStyleSheets.concat(__lgmd3Typescale); } catch (e) {}\n';
      }
      code += "window.dispatchEvent(new CustomEvent('lgmd3-material-ready'));\n";
      injectModuleScript(code);
      state.materialBlobUrls = loader.urls;
      return await waitForMaterial(9000);
    } catch (e) {
      console.warn('[luogu-md3] Blob 方式加载 Material Web 失败', e);
      return false;
    }
  }

  function ensureMaterial() {
    if (state.materialReady || materialAlreadyDefined()) {
      state.materialReady = true;
      return Promise.resolve(true);
    }
    if (state.materialPromise) return state.materialPromise;

    addImportMap();

    state.materialPromise = (async function () {
      let ok = false;
      if (pageCspAllowsExternal()) {
        ok = await loadMaterialViaImportMap();
      }
      if (!ok && !materialAlreadyDefined()) {
        ok = await loadMaterialViaBlob();
      }
      if (!ok && !materialAlreadyDefined()) {
        ok = await waitForMaterial(2000);
      }
      state.materialReady = !!ok || materialAlreadyDefined();
      if (!state.materialReady) {
        if (!state.materialToastShown) {
          state.materialToastShown = true;
          setTimeout(function () {
            if (!materialAlreadyDefined()) {
              showToast('Material Web 未能加载，已启用内置 MD3 降级样式。题面、推荐和快捷键仍可使用。', { duration: 6000 });
            }
          }, 600);
        }
      }
      return state.materialReady;
    })();

    return state.materialPromise;
  }

  /* ============================================================
   * 页面数据 / 语言
   * ============================================================ */
  function readPageData() {
    if (state.pageData !== undefined) return state.pageData;
    state.pageData = null;
    try {
      const node = document.getElementById('lentille-context');
      if (!node) return null;
      const parsed = JSON.parse(node.textContent || '{}');
      state.pageData = parsed && parsed.data ? parsed : null;
    } catch (e) { /* ignore */ }
    return state.pageData;
  }

  function localeLabel(code) {
    const map = {
      'zh-CN': '中文', zh: '中文', en: 'English', ja: '日本語', ko: '한국어',
      'zh-TW': '繁體中文', ru: 'Русский', fr: 'Français', de: 'Deutsch', es: 'Español',
    };
    if (map[code]) return map[code];
    try {
      const name = new Intl.DisplayNames(['zh-CN'], { type: 'language' }).of(code);
      if (name && name !== code) return name;
    } catch (e) { /* ignore */ }
    return String(code || '中文');
  }

  function getLocaleInfo() {
    const data = readPageData();
    const current = (data && data.data && ((data.data.problem && data.data.problem.contenu && data.data.problem.contenu.locale) || data.data.locale)) || document.documentElement.lang || 'zh-CN';
    const options = [{ value: 'zh-CN', label: '中文' }];
    const translations = data && data.data && data.data.translations;
    if (translations && typeof translations === 'object') {
      Object.keys(translations).forEach(function (code) {
        if (!code || code === 'zh-CN') return;
        if (options.some(function (item) { return item.value === code; })) return;
        options.push({ value: code, label: localeLabel(code) });
      });
    }
    if (!options.some(function (item) { return item.value === current; })) {
      options.unshift({ value: current, label: localeLabel(current) });
    }
    return { current: current, options: options };
  }

  function changeLocale(code) {
    if (!code) return;
    const info = getLocaleInfo();
    if (code === info.current) return;
    try {
      const url = new URL(location.href);
      if (code === 'zh-CN') url.searchParams.delete('lang');
      else url.searchParams.set('lang', code);
      url.hash = '';
      location.href = url.href;
    } catch (e) {
      showToast('语言切换失败，请刷新页面重试。');
    }
  }

  /* ============================================================
   * 页面重排
   * ============================================================ */
  function isOurElement(el) {
    if (!el || !el.closest) return false;
    return !!el.closest('#lgmd3-settings, .lgmd3-hero-actions, .lgmd3-problem-toolbar, #lgmd3-toast');
  }

  function findHeaderSubmitButton() {
    const header = $(SELECTOR.header);
    if (!header) return null;
    const candidates = $$('button, a', header.querySelector('.btn-actions') || header);
    return candidates.find(function (el) {
      if (isOurElement(el)) return false;
      const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      return /提交|登录/.test(text) || /submit/i.test(el.getAttribute('href') || '');
    }) || null;
  }

  function isLoggedIn() {
    const data = readPageData();
    if (data && Object.prototype.hasOwnProperty.call(data, 'user')) {
      return !!data.user;
    }
    const button = findHeaderSubmitButton();
    if (button && !/登录/.test(button.textContent || '')) return true;
    return $$(SELECTOR.menuEntry).length > 1;
  }

  function findMenuEntry(pattern) {
    const test = pattern instanceof RegExp ? pattern : new RegExp(String(pattern));
    return $$(SELECTOR.menuEntry).find(function (el) {
      return test.test((el.textContent || '').replace(/\s+/g, ' ').trim());
    }) || null;
  }

  // 真实 LMenu 的点击监听绑在 <li> 上，.entry 只是内部文字节点。
  // 直接点击 .entry 在部分 Vue 版本里不会触发 input 事件。
  function clickMenuEntry(entry) {
    if (!entry) return false;
    const li = entry.closest ? entry.closest('li') : null;
    const target = li || entry.parentElement || entry;
    try {
      target.click();
      return true;
    } catch (e) {
      try {
        entry.click();
        return true;
      } catch (e2) {
        return false;
      }
    }
  }

  function buildHeroActions(header) {
    if (!header) return null;
    const old = header.querySelector('.lgmd3-hero-actions');
    if (old) old.remove();

    const loggedIn = isLoggedIn();
    const wrap = document.createElement('div');
    wrap.className = 'lgmd3-hero-actions';
    wrap.dataset.lgmd3 = 'hero-actions';

    const submit = mdButton('md-filled-button', loggedIn ? '提交答案' : '登录后提交', 'send');
    submit.id = 'lgmd3-hero-submit';
    submit.title = loggedIn ? '跳到原生提交模块（' + CONFIG.shortcuts.submit + '）' : '请先登录';
    submit.addEventListener('click', function () {
      if (!isLoggedIn()) {
        showToast('请先登录洛谷后再提交。');
        return;
      }
      ensureSubmitSection().then(function (card) {
        if (card) scrollToSubmit();
      });
    });

    const copy = mdButton('md-text-button', '复制 Markdown', 'copy');
    copy.id = 'lgmd3-hero-copy';
    copy.title = '复制 Markdown 题面（' + CONFIG.shortcuts.copyMarkdown + '）';
    copy.addEventListener('click', function () { copyMarkdown(); });

    const settings = document.createElement('md-icon-button');
    settings.id = 'lgmd3-hero-settings';
    settings.className = 'lgmd3-settings-button';
    settings.innerHTML = icon('settings');
    settings.setAttribute('aria-label', 'MD3 设置与快捷键');
    settings.title = '设置与快捷键';
    settings.addEventListener('click', function () { openSettings(); });

    wrap.append(submit, copy, settings);

    const bottomRow = $(SELECTOR.bottomRow);
    if (bottomRow) {
      bottomRow.insertBefore(wrap, bottomRow.firstChild);
    } else {
      const topRow = header.querySelector('.top-row');
      if (topRow) topRow.insertAdjacentElement('afterend', wrap);
      else header.insertBefore(wrap, header.firstChild);
    }

    state.hero = wrap;
    return wrap;
  }

  function closeLocaleMenus(except) {
    $$('.lgmd3-locale-menu[data-open="true"]').forEach(function (menu) {
      if (menu === except) return;
      menu.dataset.open = 'false';
      const wrap = menu.closest('.lgmd3-locale-wrap');
      const button = wrap && wrap.querySelector('.lgmd3-locale-button');
      if (button) button.setAttribute('aria-expanded', 'false');
    });
  }

  function buildProblemToolbar() {
    const bar = document.createElement('div');
    bar.className = 'lgmd3-problem-toolbar';
    bar.dataset.lgmd3 = 'problem-toolbar';

    const copy = mdButton('md-text-button', '复制 Markdown', 'copy');
    copy.classList.add('lgmd3-toolbar-copy');
    copy.title = '复制 Markdown 题面（' + CONFIG.shortcuts.copyMarkdown + '）';
    copy.addEventListener('click', function () { copyMarkdown(); });

    const locale = getLocaleInfo();
    const wrap = document.createElement('div');
    wrap.className = 'lgmd3-locale-wrap';
    wrap.title = '切换题面语言';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lgmd3-locale-button';
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-label', '题面语言：' + localeLabel(locale.current));
    button.innerHTML = icon('language')
      + '<span class="lgmd3-locale-label"></span>'
      + icon('expandMore', 'lgmd3-locale-chevron');
    button.querySelector('.lgmd3-locale-label').textContent = localeLabel(locale.current);

    const menu = document.createElement('div');
    menu.className = 'lgmd3-locale-menu';
    menu.dataset.open = 'false';
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', '选择题面语言');

    locale.options.forEach(function (item) {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'lgmd3-locale-option';
      option.dataset.value = item.value;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', item.value === locale.current ? 'true' : 'false');
      option.textContent = item.label;
      option.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        closeLocaleMenus();
        changeLocale(item.value);
      });
      menu.appendChild(option);
    });

    button.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      const open = menu.dataset.open === 'true';
      closeLocaleMenus(open ? null : menu);
      menu.dataset.open = open ? 'false' : 'true';
      button.setAttribute('aria-expanded', open ? 'false' : 'true');
      if (!open) {
        const selected = menu.querySelector('.lgmd3-locale-option[aria-selected="true"]')
          || menu.querySelector('.lgmd3-locale-option');
        if (selected) setTimeout(function () { selected.focus(); }, 20);
      }
    });

    button.addEventListener('keydown', function (event) {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      button.click();
    });

    menu.addEventListener('keydown', function (event) {
      const options = Array.from(menu.querySelectorAll('.lgmd3-locale-option'));
      const current = options.indexOf(document.activeElement);
      if (event.key === 'Escape') {
        event.preventDefault();
        closeLocaleMenus();
        button.focus();
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        const next = options[(current < 0 ? 0 : current + delta + options.length) % options.length];
        if (next) next.focus();
      }
    });

    wrap.append(button, menu);
    bar.append(copy, wrap);
    return bar;
  }

  const NATIVE_ACTION_TEXT = /^(展开|收起|进入\s*IDE\s*模式|中文|繁體中文|English|日本語|한국어|Русский|Français|Deutsch|Español)$/i;

  function hideNativeProblemActions(card, isClone) {
    if (!card) return;
    function hide(el) {
      if (!el) return;
      if (isClone) {
        el.remove();
      } else {
        el.dataset.lgmd3NativeHidden = 'true';
        el.style.display = 'none';
      }
    }
    $$(':scope > .problem-block-actions', card).forEach(hide);
    Array.from(card.children).forEach(function (child) {
      if (!child || child.classList.contains('lgmd3-problem-toolbar')) return;
      const text = (child.textContent || '').replace(/\s+/g, ' ').trim();
      if (!NATIVE_ACTION_TEXT.test(text)) return;
      if (child.matches('a, button') || child.querySelector('a, button')) hide(child);
    });
  }

  function enhanceProblemCard(card, isClone) {
    if (!card) return;
    card.classList.add('md-typescale-body-medium');
    card.classList.add(isClone ? 'lgmd3-description-clone' : 'lgmd3-live-problem');

    const oldBar = card.querySelector(':scope > .lgmd3-problem-toolbar');
    if (oldBar) oldBar.remove();
    hideNativeProblemActions(card, isClone);
    const bar = buildProblemToolbar();
    card.insertBefore(bar, card.firstChild);

    $$('.lfe-h2', card).forEach(function (heading) {
      heading.classList.add('md-typescale-headline-small');
    });
    $$('.lfe-marked, .lfe-marked-wrap', card).forEach(function (body) {
      body.classList.add('md-typescale-body-large');
    });
    if (!isClone) card.dataset.lgmd3Enhanced = 'true';
  }

  function ensureProblemEnhancements() {
    const live = $(SELECTOR.problemCard);
    if (live) {
      if (!live.querySelector(':scope > .lgmd3-problem-toolbar')) enhanceProblemCard(live, false);
      else hideNativeProblemActions(live, false);
    }
    const clone = state.descriptionClone;
    if (clone && clone.isConnected && !clone.querySelector(':scope > .lgmd3-problem-toolbar')) {
      enhanceProblemCard(clone, true);
    }
  }

  function getInfoCardType(card) {
    if (!card) return '';
    if (card.classList.contains('lgmd3-recommend-card')) return 'recommend';
    if (card.classList.contains('lgmd3-info-tags')) return 'tags';
    if (card.classList.contains('lgmd3-info-discuss')) return 'discussion';
    const heading = card.querySelector('h3');
    const title = heading ? (heading.textContent || '').trim() : '';
    if (/推荐/.test(title)) return 'recommend';
    if (/标签/.test(title)) return 'tags';
    if (/讨论/.test(title)) return 'discussion';
    return 'meta';
  }

  // 洛谷的标签/讨论/推荐由 ExpandIndicator 控制，点击监听在
  // `.lfe-caption .expand-indicator` 这个 span 上。Vue 延迟渲染时
  // 第一次点击可能还没绑上，因此做有限重试。
  function expandInfoCard(card) {
    if (!card) return;
    const type = getInfoCardType(card);
    if (!type) return;
    card.classList.add('lgmd3-expanded');
    const indicator = card.querySelector('.lfe-caption .expand-indicator');
    if (!indicator) return;
    const text = (indicator.textContent || '').replace(/\s+/g, ' ').trim();
    const expanded = type === 'tags'
      ? /隐藏|收起|Hide|Collapse/i.test(text)
      : !/查看|显示|展开|Show|More/i.test(text);
    if (expanded) {
      card.dataset.lgmd3Expanded = 'true';
      return;
    }
    const attempts = Number(card.dataset.lgmd3ExpandAttempts || 0);
    if (attempts >= 7) return;
    card.dataset.lgmd3ExpandAttempts = String(attempts + 1);
    const before = text;
    try { indicator.click(); } catch (e) { /* ignore */ }
    setTimeout(function () {
      if (!card.isConnected) return;
      const current = (indicator.textContent || '').replace(/\s+/g, ' ').trim();
      // 原生 click 已生效但文字可能异步更新；只要文字变了就不再重复点击，
      // 避免把刚展开的卡片又点回去。
      if (current !== before) return;
      expandInfoCard(card);
    }, 450);
  }

  function decorateInfoCard(card) {
    if (!card || !card.classList) return;
    const heading = card.querySelector('h3');
    if (heading) heading.classList.add('md-typescale-title-small');
    const title = heading ? heading.textContent.trim() : '';
    if (title === '推荐题目' || /推荐/.test(title)) {
      card.classList.add('lgmd3-recommend-card');
    } else if (title === '标签' || /标签/.test(title)) {
      card.classList.add('lgmd3-info-tags');
    } else if (title === '相关讨论' || /讨论/.test(title)) {
      card.classList.add('lgmd3-info-discuss');
    } else {
      card.classList.add('lgmd3-info-meta');
    }
    expandInfoCard(card);
  }

  function moveInfoCards(side, grid) {
    if (!side || !grid) return 0;
    const cards = Array.from(side.children).filter(function (el) {
      return el.classList && el.classList.contains('l-card') && el.dataset.lgmd3Moved !== 'true';
    });
    cards.forEach(function (card, index) {
      card.dataset.lgmd3Moved = 'true';
      card.dataset.lgmd3MovedIndex = String(index);
      card.classList.add('lgmd3-info-section', 'md-typescale-body-medium');
      decorateInfoCard(card);
      grid.appendChild(card);
    });
    return cards.length;
  }

  function syncInfoCards(header) {
    const targetHeader = (header && header.isConnected) ? header : (state.header || $(SELECTOR.header));
    if (!targetHeader || !targetHeader.isConnected) return 0;
    const side = $(SELECTOR.side);
    if (!side) return 0;

    let grid = targetHeader.querySelector('#lgmd3-info-grid');
    if (!grid) {
      const hasCards = Array.from(side.children).some(function (el) {
        return el.classList && el.classList.contains('l-card');
      });
      if (!hasCards) return 0;
      grid = document.createElement('div');
      grid.id = 'lgmd3-info-grid';
      grid.className = 'lgmd3-info-grid';
      targetHeader.appendChild(grid);
    }

    const moved = moveInfoCards(side, grid);
    state.infoGrid = grid;
    $$('.lgmd3-info-section', grid).forEach(decorateInfoCard);
    if (!grid.children.length) {
      grid.remove();
      state.infoGrid = null;
      return 0;
    }
    return moved;
  }

  function watchInfoCards(header, token) {
    if (state.infoObserver) {
      try { state.infoObserver.disconnect(); } catch (e) { /* ignore */ }
      state.infoObserver = null;
    }
    const side = $(SELECTOR.side);
    if (!header || !side) return;
    const run = debounce(function () {
      if (token !== state.initToken) return;
      syncInfoCards(header);
    }, 120);
    const observer = new MutationObserver(run);
    try {
      observer.observe(side, { childList: true });
      observer.observe(header, { childList: true });
    } catch (e) { /* ignore */ }
    state.infoObserver = observer;

    // 真机上卡片可能比 header 晚 1–3 秒渲染，观察器之外再加几次兜底。
    [240, 700, 1400, 2400, 3800].forEach(function (delay) {
      setTimeout(function () {
        if (token !== state.initToken) return;
        const moved = syncInfoCards(header);
        if (moved || !state.infoObserver) watchInfoCards(header, token);
      }, delay);
    });
  }

  function scrollToDescription() {
    const target = state.descriptionClone || $(SELECTOR.problemCard);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function focusSubmitEditor() {
    const card = state.submitCard;
    if (!card || !card.isConnected) return false;
    const candidates = [
      card.querySelector('.cm-content[contenteditable="true"]'),
      card.querySelector('.cm-editor textarea'),
      card.querySelector('.CodeMirror textarea'),
      card.querySelector('textarea'),
      card.querySelector('[contenteditable="true"]'),
    ];
    const editor = candidates.find(function (el) { return el && el.isConnected; });
    if (!editor || !editor.focus) return false;
    try {
      editor.focus({ preventScroll: true });
      return true;
    } catch (e) {
      try { editor.focus(); } catch (e2) { /* ignore */ }
      return false;
    }
  }

  function scrollToSubmit(focusEditor) {
    const target = state.submitCard;
    if (!target) return;
    const heading = document.getElementById('lgmd3-submit-heading');
    (heading || target).scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (focusEditor) {
      // 聚焦放在滚动之后，避免浏览器把滚动位置又拉回编辑器顶部。
      setTimeout(focusSubmitEditor, 320);
    }
  }

  function updateMenuTabs() {
    const entries = $$(SELECTOR.menuEntry);
    if (!entries.length) return;
    if (state.submitPrepared) {
      updateActiveTabByScroll();
      return;
    }
    const submitEntry = findMenuEntry(/^提交(答案)?$/);
    const descEntry = findMenuEntry(/题目描述/);
    if (submitEntry) submitEntry.setAttribute('data-lgmd3-active', 'false');
    if (descEntry) descEntry.setAttribute('data-lgmd3-active', 'true');
  }

  function updateActiveTabByScroll() {
    if (!state.submitPrepared) return;
    const card = state.submitCard;
    if (!card) return;
    const heading = document.getElementById('lgmd3-submit-heading') || card;
    const rect = heading.getBoundingClientRect();
    const activeSubmit = rect.top <= Math.max(180, window.innerHeight * 0.42);
    const submitEntry = findMenuEntry(/^提交(答案)?$/);
    const descEntry = findMenuEntry(/题目描述/);
    if (submitEntry) submitEntry.setAttribute('data-lgmd3-active', activeSubmit ? 'true' : 'false');
    if (descEntry) descEntry.setAttribute('data-lgmd3-active', activeSubmit ? 'false' : 'true');
  }

  function bindScrollSpy() {
    if (state.scrollSpyBound) return;
    state.scrollSpyBound = true;
    window.addEventListener('scroll', debounce(updateActiveTabByScroll, 80), { passive: true });
    window.addEventListener('resize', debounce(updateActiveTabByScroll, 120), { passive: true });
  }

  function cleanupSubmitSection(restoreContent) {
    if (state.submitObserver) {
      try { state.submitObserver.disconnect(); } catch (e) { /* ignore */ }
      state.submitObserver = null;
    }
    const heading = document.getElementById('lgmd3-submit-heading');
    if (heading) heading.remove();
    if (state.descriptionClone) {
      state.descriptionClone.remove();
      state.descriptionClone = null;
    }
    if (state.submitCard) {
      state.submitCard.classList.remove('lgmd3-submit-card');
      state.submitCard.removeAttribute('id');
      state.submitCard = null;
    }
    $$('[data-lgmd3-native-hidden="true"]').forEach(function (el) {
      el.style.removeProperty('display');
      delete el.dataset.lgmd3NativeHidden;
    });
    state.submitPrepared = false;
    state.submitPreparing = false;
    state.allowNativeSubmitClick = false;
    if (restoreContent) {
      const desc = findMenuEntry(/题目描述/);
      if (desc) {
        state.allowNativeSubmitClick = true;
        clickMenuEntry(desc);
        setTimeout(function () { state.allowNativeSubmitClick = false; }, 0);
      }
    }
    updateMenuTabs();
  }

  function isSubmitCard(el) {
    if (!el || el.nodeType !== 1 || !el.classList) return false;
    if (el === state.descriptionClone) return false;
    if (el.classList.contains('problem') || el.classList.contains('lgmd3-description-clone')) return false;
    if (el.classList.contains('lgmd3-info-section')) return false;
    if (el.classList.contains('burger')) return true;
    if (!el.classList.contains('l-card')) return false;
    const text = (el.textContent || '').slice(0, 600);
    return /提交评测|提交代码|选择语言|提交文件|Submit\s*(to\s*Judge|Code)/i.test(text);
  }

  function waitForSubmitCard(main, timeout) {
    const limit = typeof timeout === 'number' ? timeout : 9000;
    return new Promise(function (resolve) {
      let done = false;
      let observer = null;
      let timer = 0;
      function find() {
        // 真实页面会把提交卡直接放进主列；部分版本会多一层包装，
        // 因此在主列子树里找，避免只认 :scope > .l-card 而漏掉。
        const cards = $$('.l-card', main);
        return cards.find(isSubmitCard) || null;
      }
      function finish(card) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (observer) observer.disconnect();
        resolve(card || null);
      }
      function check() {
        // 只有真正找到提交卡才结束等待；未找到时必须让计时器继续等原生异步渲染，
        // 否则第一次 MutationObserver 检查就会以 null 提前 resolve。
        const card = find();
        if (card) finish(card);
      }
      observer = new MutationObserver(check);
      try { observer.observe(main, { childList: true, subtree: true }); } catch (e) { /* ignore */ }
      timer = setTimeout(function () { finish(find()); }, limit);
      check();
    });
  }

  function tagLangDropdown() {
    $$('.dropdown').forEach(function (dropdown) {
      if (!dropdown || !dropdown.isConnected) return;
      if (dropdown.classList.contains('lgmd3-lang-dropdown')) return;
      const list = dropdown.querySelector('ul');
      if (!list || !list.children.length) return;
      if (!dropdown.offsetWidth && !dropdown.offsetHeight) return;
      dropdown.classList.add('lgmd3-lang-dropdown');
    });
  }

  function enhanceSubmitCard(card) {
    if (!card) return;
    card.classList.add('lgmd3-submit-card');
    const lang = card.querySelector('.lang-select');
    if (lang && lang.dataset.lgmd3LangBound !== 'true') {
      lang.dataset.lgmd3LangBound = 'true';
      lang.addEventListener('click', function () {
        setTimeout(tagLangDropdown, 40);
      });
    }
    setTimeout(tagLangDropdown, 80);
  }

  function ensureSubmitSection() {
    if (state.submitPrepared && state.submitCard && state.submitCard.isConnected) {
      return Promise.resolve(state.submitCard);
    }
    if (state.submitPreparing) return state.submitPromise || Promise.resolve(null);
    if (!isProblemPath()) return Promise.resolve(null);
    if (!isLoggedIn()) {
      showToast('请先登录洛谷后再提交。');
      return Promise.resolve(null);
    }

    const main = $(SELECTOR.mainColumn);
    const live = $(SELECTOR.problemCard);
    const submitEntry = findMenuEntry(/^提交(答案)?$/);
    if (!main || !live || !submitEntry) return Promise.resolve(null);

    state.submitPreparing = true;
    const token = state.initToken;
    state.submitPromise = (async function () {
      let clone = null;
      try {
        clone = live.cloneNode(true);
        clone.removeAttribute('id');
        clone.classList.remove('lgmd3-live-problem');
        clone.classList.add('lgmd3-description-clone', 'lgmd3-hidden');
        $$('[id]', clone).forEach(function (el) { el.removeAttribute('id'); });
        $$('.problem-block-actions', clone).forEach(function (el) { el.remove(); });
        clone.id = 'lgmd3-description-section';
        enhanceProblemCard(clone, true);
        main.insertBefore(clone, live);
        state.descriptionClone = clone;

        // Vue 菜单可能在脚本首次点击时还没完成 hydration，点击会被吞掉。
        // 这里重试点击并反复等待，避免一上来就报“加载失败”。
        let card = null;
        for (let attempt = 0; attempt < 4 && !card; attempt++) {
          if (attempt > 0) await sleep(350);
          const entry = findMenuEntry(/^提交(答案)?$/);
          if (!entry) continue;
          state.allowNativeSubmitClick = true;
          clickMenuEntry(entry);
          setTimeout(function () { state.allowNativeSubmitClick = false; }, 0);
          card = await waitForSubmitCard(main, attempt === 0 ? 2800 : 2200);
          if (token !== state.initToken) {
            cleanupSubmitSection(false);
            return null;
          }
        }
        if (token !== state.initToken) {
          cleanupSubmitSection(false);
          return null;
        }
        if (!card) {
          cleanupSubmitSection(true);
          showToast('原生提交模块加载失败，请刷新页面后重试。', { duration: 4500 });
          return null;
        }

        // 若原生框架没有移除题面（测试或局部渲染），隐藏它，避免与静态题面重复。
        if (live && live.isConnected) {
          live.dataset.lgmd3NativeHidden = 'true';
          live.style.display = 'none';
        }

        const parent = card.parentNode || main;
        if (!clone.isConnected) {
          parent.insertBefore(clone, card);
          state.descriptionClone = clone;
          enhanceProblemCard(clone, true);
        }
        clone.classList.remove('lgmd3-hidden');
        clone.classList.add('lgmd3-description-clone');

        let heading = document.getElementById('lgmd3-submit-heading');
        if (!heading) {
          heading = document.createElement('h2');
          heading.id = 'lgmd3-submit-heading';
          heading.className = 'lgmd3-submit-heading';
          heading.textContent = '提交答案';
        }
        parent.insertBefore(heading, card);
        parent.insertBefore(clone, heading);

        enhanceSubmitCard(card);
        card.id = 'lgmd3-submit-section';
        state.submitCard = card;
        state.submitPrepared = true;
        state.submitPreparing = false;
        state.allowNativeSubmitClick = false;

        if (location.hash) {
          try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
        }
        ensureProblemEnhancements();
        updateMenuTabs();
        updateActiveTabByScroll();
        return card;
      } catch (e) {
        if (token !== state.initToken) {
          cleanupSubmitSection(false);
          return null;
        }
        console.warn('[luogu-md3] 原生提交模块整合失败', e);
        cleanupSubmitSection(true);
        showToast('原生提交模块整合失败，请刷新页面后重试。', { duration: 4500 });
        return null;
      }
    })();

    return state.submitPromise;
  }

  // 用题面标题做内容签名，而不是 document.title；切换原生“提交/描述”
  // 标签时 document.title 可能变化，但题面标题不变，避免无谓地整页重排。
  function pageSignature(header) {
    const target = (header && header.isConnected) ? header : (state.header || $(SELECTOR.header));
    const title = target && target.querySelector('.title');
    const text = title ? (title.textContent || '').replace(/\s+/g, ' ').trim() : '';
    return text || (document.title || '').trim();
  }

  async function renderPage(header) {
    const token = state.initToken;
    if (!header || !header.isConnected) return;
    state.header = header;
    state.pageTitle = pageSignature(header);
    try { document.documentElement.classList.add('lgmd3-active'); } catch (e) { /* ignore */ }
    applyTheme();

    buildHeroActions(header);

    const oldGrid = header.querySelector('#lgmd3-info-grid');
    if (oldGrid && !oldGrid.children.length) oldGrid.remove();

    let side = $(SELECTOR.side);
    if (!side) {
      side = await waitFor(SELECTOR.side, 2200);
      if (token !== state.initToken) return;
    }
    syncInfoCards(header);
    watchInfoCards(header, token);

    const title = header.querySelector('.title');
    if (title) title.classList.add('md-typescale-display-small');

    let problem = $(SELECTOR.problemCard);
    if (!problem) {
      problem = await waitFor(SELECTOR.problemCard, 2500);
      if (token !== state.initToken) return;
    }
    if (problem) {
      enhanceProblemCard(problem, false);
    }

    bindScrollSpy();
    state.currentPath = location.pathname;
    updateMenuTabs();

    // 登录后直接把洛谷原生提交模块合并到题面下方。
    // 延迟到 Vue 完成 hydration 之后再点击菜单，避免原生点击被吞掉。
    if (isLoggedIn()) {
      setTimeout(function () {
        if (token !== state.initToken || !isProblemPath()) return;
        if (!state.submitPrepared && !state.submitPreparing) {
          ensureSubmitSection().then(function (card) {
            if (card) updateMenuTabs();
          });
        }
      }, 2200);
    }
  }

  function teardownPage() {
    state.initToken += 1;

    if (state.infoObserver) {
      try { state.infoObserver.disconnect(); } catch (e) { /* ignore */ }
      state.infoObserver = null;
    }
    if (state.infoSyncTimer) {
      clearTimeout(state.infoSyncTimer);
      state.infoSyncTimer = null;
    }

    safe(function () { if (state.settingsOpen) closeSettings(); });

    cleanupSubmitSection(false);

    const grid = document.getElementById('lgmd3-info-grid');
    const side = $(SELECTOR.side);
    if (grid && side) {
      const moved = $$('[data-lgmd3-moved="true"]', grid).sort(function (a, b) {
        return Number(a.dataset.lgmd3MovedIndex || 0) - Number(b.dataset.lgmd3MovedIndex || 0);
      });
      moved.forEach(function (card) {
        side.appendChild(card);
        delete card.dataset.lgmd3Moved;
        delete card.dataset.lgmd3MovedIndex;
        card.classList.remove('lgmd3-info-section', 'lgmd3-info-meta', 'lgmd3-info-tags', 'lgmd3-info-discuss', 'lgmd3-recommend-card', 'lgmd3-expanded', 'md-typescale-body-medium');
        delete card.dataset.lgmd3Expanded;
        delete card.dataset.lgmd3ExpandAttempts;
        const heading = card.querySelector('h3');
        if (heading) heading.classList.remove('md-typescale-title-small');
      });
    }
    if (grid) grid.remove();

    const hero = document.querySelector('.lgmd3-hero-actions');
    if (hero) hero.remove();

    $$('[data-lgmd3-native-hidden="true"]').forEach(function (el) {
      el.style.removeProperty('display');
      delete el.dataset.lgmd3NativeHidden;
    });

    const problem = $(SELECTOR.problemCard);
    if (problem) {
      problem.classList.remove('lgmd3-live-problem', 'md-typescale-body-medium');
      delete problem.dataset.lgmd3Enhanced;
    }

    try {
      document.documentElement.classList.remove('lgmd3-active', 'lgmd3-settings-open', 'lgmd3-lock');
    } catch (e) { /* ignore */ }

    state.header = null;
    state.infoGrid = null;
    state.hero = null;
    state.pageData = undefined;
    state.currentPath = '';
    state.pageTitle = '';
  }
  /* ============================================================
   * 原生提交模块
   * ============================================================ */
  function findJudgeButton() {
    const card = state.submitCard || document.getElementById('lgmd3-submit-section');
    if (!card || !card.isConnected) return null;
    const candidates = $$('button, a, .l-button, [role="button"]', card);
    return candidates.find(function (el) {
      if (!isVisible(el)) return false;
      if (el.disabled === true || el.getAttribute('aria-disabled') === 'true') return false;
      const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      return SELECTOR.submitButtonText.test(text);
    }) || null;
  }

  function triggerNativeSubmit() {
    if (!isProblemPath()) {
      showToast('当前页面不是题目页，无法提交。');
      return false;
    }
    ensureSubmitSection().then(function (card) {
      if (!card) return;
      const button = findJudgeButton();
      if (!button) {
        showToast('未找到洛谷原生「提交评测」按钮，请确认已登录并等待提交模块加载。', { duration: 4500 });
        return;
      }
      try {
        button.click();
        showToast('已触发洛谷原生提交评测。', { duration: 2600 });
      } catch (e) {
        console.warn('[luogu-md3] 原生提交按钮点击失败', e);
        showToast('原生提交按钮点击失败，请手动点击「提交评测」。');
      }
    });
    return true;
  }

  /* ============================================================
   * 复制 Markdown
   * ============================================================ */
  function markdownFromNode(node) {
    if (!node) return '';
    if (node.nodeType === 3) return node.nodeValue || '';
    if (node.nodeType !== 1) return '';
    if (node.hidden || (node.style && node.style.display === 'none')) return '';
    const tag = node.tagName.toLowerCase();
    if (/^(script|style|button|svg|noscript)$/.test(tag)) return '';
    if (node.classList && (
      node.classList.contains('problem-block-actions') ||
      node.classList.contains('lgmd3-problem-toolbar') ||
      node.classList.contains('lgmd3-locale-wrap')
    )) return '';
    if (tag === 'br') return '\n';
    if (tag === 'img') {
      const alt = node.getAttribute('alt') || '';
      const src = node.getAttribute('src') || '';
      return src ? '![' + alt + '](' + src + ')' : '';
    }
    if (tag === 'a') {
      const text = (node.innerText || node.textContent || '').trim();
      const href = node.getAttribute('href') || '';
      if (!text) return '';
      return href && href.indexOf('javascript:') !== 0 ? '[' + text + '](' + href + ')' : text;
    }
    if (tag === 'code' && node.parentElement && node.parentElement.tagName.toLowerCase() !== 'pre') {
      return '`' + (node.textContent || '') + '`';
    }
    if (tag === 'pre') {
      const code = (node.innerText || node.textContent || '').replace(/\s+$/, '');
      return '\n```\n' + code + '\n```\n';
    }
    if (tag === 'h1' || tag === 'h2') {
      return '\n## ' + (node.innerText || '').trim() + '\n\n';
    }
    if (tag === 'h3' || tag === 'h4') {
      return '\n### ' + (node.innerText || '').trim() + '\n\n';
    }
    if (tag === 'li') {
      return '- ' + Array.from(node.childNodes).map(markdownFromNode).join('').trim() + '\n';
    }
    if (tag === 'table') {
      return '\n' + (node.innerText || '').trim() + '\n\n';
    }
    const inner = Array.from(node.childNodes).map(markdownFromNode).join('');
    if (/^(p|div|section|blockquote|ul|ol|tr|figure)$/.test(tag)) return '\n' + inner.trim() + '\n\n';
    return inner;
  }

  function buildMarkdownFallback() {
    const title = getProblemTitle();
    const problem = state.descriptionClone || $(SELECTOR.problemCard);
    let body = '';
    if (problem) {
      const clone = problem.cloneNode(true);
      $$('.problem-block-actions, .lgmd3-problem-toolbar, .lgmd3-locale-wrap, [data-lgmd3-native-hidden="true"]', clone).forEach(function (el) {
        el.remove();
      });
      Array.from(clone.children).forEach(function (child) {
        const text = (child.textContent || '').replace(/\s+/g, ' ').trim();
        if (/^(展开|收起|进入\s*IDE\s*模式|中文|繁體中文|English|日本語|한국어|Русский|Français|Deutsch|Español)$/i.test(text)) {
          child.remove();
        }
      });
      $$('[id]', clone).forEach(function (el) { el.removeAttribute('id'); });
      body = markdownFromNode(clone).replace(/\n{3,}/g, '\n\n').trim();
    }
    return '# ' + title + '\n\n' + body + '\n';
  }

  function copyMarkdown() {
    if (!isProblemPath()) {
      showToast('当前页面不是题目页，无法复制题面。');
      return;
    }
    const actions = $$('.problem-block-actions a, .problem-block-actions button');
    const nativeAction = actions.find(function (el) {
      const text = (el.textContent || '').replace(/\s+/g, ' ');
      return /复制\s*Markdown/i.test(text) || /复制题面/.test(text);
    });
    const disabledAttr = nativeAction ? nativeAction.getAttribute('disabled') : null;
    const disabled = !!nativeAction && (
      nativeAction.disabled === true ||
      nativeAction.getAttribute('aria-disabled') === 'true' ||
      (nativeAction.hasAttribute('disabled') && disabledAttr !== 'false')
    );
    if (nativeAction && !disabled) {
      try {
        nativeAction.click();
        showToast('已调用洛谷原生「复制 Markdown」。');
        return;
      } catch (e) { /* fall through */ }
    }
    const markdown = buildMarkdownFallback();
    writeClipboard(markdown).then(function (ok) {
      showToast(ok ? 'Markdown 题面已复制。' : '复制失败，请手动选择题面复制。', { duration: 3500 });
    });
  }

  function writeClipboard(text) {
    return (async function () {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
          return true;
        }
      } catch (e) { /* fall through */ }
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', 'readonly');
        textarea.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
        document.body.appendChild(textarea);
        textarea.select();
        textarea.setSelectionRange(0, textarea.value.length);
        const ok = document.execCommand('copy');
        textarea.remove();
        return ok;
      } catch (e) {
        return false;
      }
    })();
  }
  /* ============================================================
   * 设置面板
   * ============================================================ */
  function getEditorHeight() {
    const fallback = CONFIG.editor.defaultHeight;
    const stored = Number(store.get('editorHeight', fallback));
    if (!Number.isFinite(stored)) return fallback;
    return Math.min(CONFIG.editor.maxHeight, Math.max(CONFIG.editor.minHeight, Math.round(stored)));
  }

  function applyEditorHeight(value) {
    const height = (typeof value === 'number' && Number.isFinite(value))
      ? Math.min(CONFIG.editor.maxHeight, Math.max(CONFIG.editor.minHeight, Math.round(value)))
      : getEditorHeight();
    try {
      document.documentElement.style.setProperty('--lgmd3-editor-height', height + 'px');
    } catch (e) { /* ignore */ }
    return height;
  }

  function setSegmentedValue(set, value) {
    if (!set) return;
    $$('md-outlined-segmented-button', set).forEach(function (btn) {
      const selected = btn.dataset.value === value;
      try { btn.selected = selected; } catch (e) { /* ignore */ }
      if (selected) btn.setAttribute('selected', '');
      else btn.removeAttribute('selected');
      btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
  }

  function ensureSettings() {
    if (state.settings && state.settings.isConnected) return state.settings;
    const old = document.getElementById('lgmd3-settings');
    if (old) old.remove();

    const root = document.createElement('div');
    root.id = 'lgmd3-settings';
    root.dataset.open = 'false';
    root.innerHTML = `
      <div class="lgmd3-settings-backdrop" data-lgmd3-settings-close></div>
      <section class="lgmd3-settings-panel" role="dialog" aria-modal="true" aria-labelledby="lgmd3-settings-title">
        <header class="lgmd3-settings-head">
          <h2 id="lgmd3-settings-title" class="md-typescale-headline-small">MD3 设置</h2>
          <md-icon-button id="lgmd3-settings-close" aria-label="关闭设置">${icon('close')}</md-icon-button>
        </header>
        <div class="lgmd3-settings-body">
          <section class="lgmd3-settings-section">
            <h3 class="md-typescale-label-large">外观</h3>
            <div class="lgmd3-setting-row md-typescale-body-medium">
              <div>主题
                <span class="lgmd3-setting-desc md-typescale-body-small">自动跟随洛谷页面主题；无法检测时跟随系统的 prefers-color-scheme。字体使用 JetBrains Maple Mono。</span>
              </div>
              <div class="lgmd3-theme-slot"></div>
            </div>
            <div class="lgmd3-setting-row md-typescale-body-medium">
              <div>代码编辑器高度
                <span class="lgmd3-setting-desc md-typescale-body-small">内联提交模块的编辑器高度，范围 360–1100 px。</span>
              </div>
              <div class="lgmd3-editor-height-control">
                <input id="lgmd3-editor-height" type="range" step="20" aria-label="代码编辑器高度">
                <span class="lgmd3-editor-height-value" id="lgmd3-editor-height-value">620 px</span>
              </div>
            </div>
          </section>
          <section class="lgmd3-settings-section">
            <h3 class="md-typescale-label-large">快捷键</h3>
            <div class="lgmd3-shortcut-grid">
              <span class="md-typescale-body-medium">复制 Markdown 题面</span>
              <div><kbd>Alt</kbd> + <kbd>C</kbd></div>
              <span class="md-typescale-body-medium">提交评测（原生按钮）</span>
              <div><kbd>Alt</kbd> + <kbd>L</kbd></div>
              <span class="md-typescale-body-medium">跳转到题目描述</span>
              <div><kbd>Alt</kbd> + <kbd>J</kbd></div>
              <span class="md-typescale-body-medium">跳转到提交答案并聚焦编辑器</span>
              <div><kbd>Alt</kbd> + <kbd>K</kbd></div>
              <span class="md-typescale-body-medium">向下 / 向上滚动页面</span>
              <div><kbd>J</kbd> / <kbd>K</kbd></div>
              <span class="md-typescale-body-medium">回到页面顶部</span>
              <div><kbd>g</kbd><kbd>g</kbd></div>
              <span class="md-typescale-body-medium">跳到页面底部</span>
              <div><kbd>G</kbd></div>
              <span class="md-typescale-body-medium">关闭设置 / 退出编辑器聚焦</span>
              <div><kbd>Esc</kbd></div>
            </div>
            <p class="lgmd3-hint md-typescale-body-small">提交功能直接点击洛谷原生「提交评测」按钮，不会调用私有 API。输入框或代码编辑器聚焦时，J/K、gg、G、Alt+C 复制与 Alt+L 提交不会触发；Alt+J / Alt+K 仍可跳转，Esc 可退出编辑器聚焦。</p>
          </section>
        </div>
        <footer class="lgmd3-settings-footer">
          <md-text-button id="lgmd3-settings-reset">恢复默认</md-text-button>
          <span class="lgmd3-grow"></span>
          <md-filled-button id="lgmd3-settings-done">完成</md-filled-button>
        </footer>
      </section>
    `;
    document.body.appendChild(root);

    const closeBtn = root.querySelector('#lgmd3-settings-close');
    const backdrop = root.querySelector('.lgmd3-settings-backdrop');
    const doneBtn = root.querySelector('#lgmd3-settings-done');
    const resetBtn = root.querySelector('#lgmd3-settings-reset');

    const themeSlot = root.querySelector('.lgmd3-theme-slot');
    const themeSet = document.createElement('md-outlined-segmented-button-set');
    themeSet.className = 'lgmd3-segment-set';
    themeSet.id = 'lgmd3-theme-switch';
    themeSet.setAttribute('aria-label', '主题');
    [['auto', '自动'], ['light', '浅色'], ['dark', '深色']].forEach(function (item) {
      const button = document.createElement('md-outlined-segmented-button');
      button.dataset.value = item[0];
      button.textContent = item[1];
      button.setAttribute('label', item[1]);
      themeSet.appendChild(button);
    });
    themeSlot.appendChild(themeSet);
    themeSet.addEventListener('click', function (event) {
      const button = event.target.closest && event.target.closest('md-outlined-segmented-button');
      if (!button) return;
      store.set('theme', button.dataset.value);
      applyTheme();
      setSegmentedValue(themeSet, button.dataset.value);
    });

    const heightInput = root.querySelector('#lgmd3-editor-height');
    const heightValue = root.querySelector('#lgmd3-editor-height-value');
    if (heightInput) {
      heightInput.min = String(CONFIG.editor.minHeight);
      heightInput.max = String(CONFIG.editor.maxHeight);
      heightInput.step = String(CONFIG.editor.step);
      heightInput.addEventListener('input', function () {
        const height = applyEditorHeight(Number(heightInput.value));
        store.set('editorHeight', height);
        if (heightValue) heightValue.textContent = height + ' px';
      });
    }

    closeBtn.addEventListener('click', function () { closeSettings(); });
    doneBtn.addEventListener('click', function () { closeSettings(); });
    backdrop.addEventListener('click', function () { closeSettings(); });
    resetBtn.addEventListener('click', function () {
      store.remove('theme');
      store.remove('editorHeight');
      applyTheme();
      applyEditorHeight();
      updateSettingsControls();
      showToast('已恢复默认外观设置。');
    });

    state.settings = root;
    updateSettingsControls();
    return root;
  }

  function updateSettingsControls() {
    if (!state.settings) return;
    const themeSet = state.settings.querySelector('#lgmd3-theme-switch');
    setSegmentedValue(themeSet, store.get('theme', 'auto'));
    const heightInput = state.settings.querySelector('#lgmd3-editor-height');
    const heightValue = state.settings.querySelector('#lgmd3-editor-height-value');
    const height = applyEditorHeight();
    if (heightInput) heightInput.value = String(height);
    if (heightValue) heightValue.textContent = height + ' px';
  }

  function refreshBodyLock() {
    setBodyLock(!!state.settingsOpen);
  }

  function openSettings() {
    if (state.settingsOpen) return;
    closeLocaleMenus();
    state.settingsReturnFocus = deepActiveElement();
    ensureSettings();
    updateSettingsControls();
    state.settingsOpen = true;
    state.settings.dataset.open = 'true';
    document.documentElement.classList.add('lgmd3-settings-open');
    refreshBodyLock();
    setTimeout(function () {
      const closeBtn = state.settings && state.settings.querySelector('#lgmd3-settings-close');
      if (closeBtn && closeBtn.focus) closeBtn.focus();
    }, 40);
  }

  function closeSettings() {
    if (!state.settings || !state.settingsOpen) return;
    state.settingsOpen = false;
    state.settings.dataset.open = 'false';
    try { document.documentElement.classList.remove('lgmd3-settings-open'); } catch (e) { /* ignore */ }
    refreshBodyLock();
    const target = state.settingsReturnFocus;
    state.settingsReturnFocus = null;
    setTimeout(function () {
      if (target && target.isConnected && target.focus) {
        try { target.focus(); } catch (e) { /* ignore */ }
      }
    }, 30);
  }

  /* ============================================================
   * 字体兜底加载
   * ============================================================ */
  function injectFontCss(rawCss, baseUrl) {
    if (document.getElementById('lgmd3-font-css')) return;
    let css = rawCss || '';
    if (!css) return;
    css = css.replace(/url\(\s*(['"]?)(?!data:|https?:|\/\/|#)([^)'"\s]+)\1\s*\)/g, function (match, quote, path) {
      try { return 'url(' + quote + new URL(path, baseUrl).href + quote + ')'; } catch (e) { return match; }
    });
    const style = document.createElement('style');
    style.id = 'lgmd3-font-css';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function ensureExternalFont() {
    const url = 'https://fontsapi.zeoseven.com/521/main/result.css';
    if (document.getElementById('lgmd3-font-css')) return;
    if (typeof GM_xmlhttpRequest === 'function') {
      try {
        GM_xmlhttpRequest({
          method: 'GET',
          url: url,
          headers: { Accept: 'text/css,*/*;q=0.1' },
          timeout: 12000,
          onload: function (response) {
            if (!response || response.status < 200 || response.status >= 300) return;
            injectFontCss(response.responseText, url);
          },
          onerror: function () { /* @import 已经尝试过，静默失败 */ },
        });
        return;
      } catch (e) { /* fall through to fetch */ }
    }
    // 本地 fixture / 没有 GM_xmlhttpRequest 时尝试普通 fetch；fontsapi 允许跨域。
    try {
      if (typeof fetch === 'function') {
        fetch(url, { credentials: 'omit', mode: 'cors' })
          .then(function (response) { return response.ok ? response.text() : ''; })
          .then(function (css) { injectFontCss(css, url); })
          .catch(function () { /* ignore */ });
      }
    } catch (e) { /* ignore */ }
  }

  /* ============================================================
   * 快捷键与路由
   * ============================================================ */
  function onShortcutKeydown(event) {
    if (event.defaultPrevented || event.isComposing) return;

    if (event.key === 'Escape') {
      if (state.settingsOpen) {
        event.preventDefault();
        closeSettings();
        return;
      }
      const localeMenu = document.querySelector('.lgmd3-locale-menu[data-open="true"]');
      if (localeMenu) {
        event.preventDefault();
        const wrap = localeMenu.closest('.lgmd3-locale-wrap');
        const localeButton = wrap && wrap.querySelector('.lgmd3-locale-button');
        closeLocaleMenus();
        if (localeButton) localeButton.focus();
        return;
      }
      // Esc 在编辑器/输入框内时退出聚焦，方便随后用 J/K、gg、G 导航。
      const focused = deepActiveElement();
      if (isEditableTarget(focused) && focused.blur) {
        event.preventDefault();
        try { focused.blur(); } catch (e) { /* ignore */ }
      }
      return;
    }

    const active = deepActiveElement();
    const editable = isEditableTarget(event.target) || isEditableTarget(active);
    const menuOpen = !!document.querySelector('.lgmd3-locale-menu[data-open="true"]');

    // 不按修饰键时：J/K 滚动，gg 回顶部，G 到底部。
    if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      if (event.code !== 'KeyG') state.lastGAt = 0;
      if (state.settingsOpen || menuOpen || editable) {
        if (event.code === 'KeyG') state.lastGAt = 0;
        return;
      }
      if (event.code === 'KeyG') {
        const now = Date.now();
        if (state.lastGAt && now - state.lastGAt < 600) {
          state.lastGAt = 0;
          event.preventDefault();
          event.stopPropagation();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
          state.lastGAt = now;
        }
        return;
      }
      if (event.code !== 'KeyJ' && event.code !== 'KeyK') return;
      const step = Math.max(64, Math.round(window.innerHeight * 0.12));
      event.preventDefault();
      event.stopPropagation();
      window.scrollBy({
        top: event.code === 'KeyJ' ? step : -step,
        behavior: 'smooth',
      });
      return;
    }

    // G（Shift+g）跳到底部。
    if (event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey
      && event.code === 'KeyG') {
      state.lastGAt = 0;
      if (state.settingsOpen || menuOpen || editable) return;
      event.preventDefault();
      event.stopPropagation();
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
      return;
    }

    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.code !== 'KeyC' && event.code !== 'KeyL'
      && event.code !== 'KeyJ' && event.code !== 'KeyK') return;
    // 复制/提交可能和编辑器自身的按键冲突；跳转类快捷键在编辑器内也保留。
    if (editable && (event.code === 'KeyC' || event.code === 'KeyL')) return;

    event.preventDefault();
    event.stopPropagation();

    if (event.code === 'KeyC') {
      copyMarkdown();
      return;
    }
    if (event.code === 'KeyL') {
      triggerNativeSubmit();
      return;
    }
    if (event.code === 'KeyJ') {
      if (active && isEditableTarget(active) && active.blur) {
        try { active.blur(); } catch (e) { /* ignore */ }
      }
      if (event.target && isEditableTarget(event.target) && event.target.blur) {
        try { event.target.blur(); } catch (e) { /* ignore */ }
      }
      scrollToDescription();
      return;
    }
    if (event.code === 'KeyK') {
      if (state.submitPrepared && state.submitCard && state.submitCard.isConnected) {
        scrollToSubmit(true);
        return;
      }
      ensureSubmitSection().then(function (card) {
        if (card) scrollToSubmit(true);
      });
    }
  }

  function installGlobalHandlers() {
    window.addEventListener('keydown', onShortcutKeydown, false);

    // 顶部「题目描述 / 提交答案」只做页内锚点，不再切换原生视图。
    document.addEventListener('click', function (event) {
      const target = event.target;
      if (!target || !target.closest) return;

      if (!target.closest('.lgmd3-locale-wrap')) closeLocaleMenus();

      // 克隆题面会丢失 Vue 的代码复制监听，这里给克隆内的代码复制按钮补一个委托处理。
      let copyBtn = target.closest('.copy-button, .code-copy, .copy-btn, .code-container button');
      if (!copyBtn && state.descriptionClone && state.descriptionClone.contains(target)) {
        const plainButton = target.closest('button');
        if (plainButton && /^(复制|复制代码|Copy)$/i.test((plainButton.textContent || '').trim())) {
          copyBtn = plainButton;
        }
      }
      if (copyBtn && state.descriptionClone && state.descriptionClone.contains(copyBtn)) {
        const ioBlock = copyBtn.closest('.io-sample-block');
        const container = copyBtn.closest('.code-container, figure, pre') || copyBtn.parentElement;
        const code = ioBlock
          ? ioBlock.querySelector('pre.lfe-code, pre, code')
          : (container && (container.querySelector('pre code') || container.querySelector('code') || container.querySelector('pre')));
        const text = code ? (code.innerText || code.textContent || '').replace(/\s+$/, '') : '';
        event.preventDefault();
        event.stopPropagation();
        if (!text) {
          showToast('未找到可复制的代码。');
          return;
        }
        writeClipboard(text).then(function (ok) {
          showToast(ok ? '代码已复制。' : '复制失败，请手动选择代码复制。');
        });
        return;
      }

      if (target.closest('.lgmd3-submit-card .lang-select')) {
        setTimeout(tagLangDropdown, 50);
      }

      const entry = target.closest('.header-card .menu .entry');
      if (!entry) return;
      const text = (entry.textContent || '').replace(/\s+/g, ' ').trim();

      if (/^提交(答案)?$/.test(text)) {
        if (state.submitPrepared) {
          event.preventDefault();
          event.stopPropagation();
          scrollToSubmit();
          return;
        }
        if (state.submitPreparing || state.allowNativeSubmitClick) return;
        event.preventDefault();
        event.stopPropagation();
        ensureSubmitSection().then(function (card) {
          if (card) scrollToSubmit();
        });
        return;
      }

      if (/题目描述/.test(text) && state.submitPrepared) {
        event.preventDefault();
        event.stopPropagation();
        scrollToDescription();
      }
    }, true);
  }

  function scheduleRoute() {
    clearTimeout(state.routeTimer);
    state.routeTimer = setTimeout(handleRoute, 120);
  }

  async function normalizeInitialRoute() {
    if (!/^#(submit|ide)$/i.test(location.hash)) return;
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
  }

  async function restoreDescriptionView() {
    if ($(SELECTOR.problemCard)) return true;
    for (let attempt = 0; attempt < 3; attempt++) {
      const desc = findMenuEntry(/题目描述/);
      if (!desc) return false;
      state.allowNativeSubmitClick = true;
      clickMenuEntry(desc);
      setTimeout(function () { state.allowNativeSubmitClick = false; }, 0);
      if (await waitFor(SELECTOR.problemCard, 1800)) return true;
      await sleep(300);
    }
    return false;
  }

  async function initPage() {
    teardownPage();
    const token = ++state.initToken;
    await normalizeInitialRoute();
    const header = await waitFor(SELECTOR.header, 9000);
    if (token !== state.initToken) return;
    if (!isProblemPath()) return;
    if (!header || !header.isConnected) return;
    // pjax 可能保留了原生提交视图；先切回题目描述，避免没有题面可克隆。
    await restoreDescriptionView();
    if (token !== state.initToken) return;
    await renderPage(header);
  }

  function handleRoute() {
    if (!isProblemPath()) {
      if (document.documentElement.classList.contains('lgmd3-active')) teardownPage();
      return;
    }
    const hero = document.querySelector('.lgmd3-hero-actions');
    const side = $(SELECTOR.side);
    const hasSideCards = !!(side && side.querySelector('.l-card'));
    const gridMissing = !document.getElementById('lgmd3-info-grid') && hasSideCards;
    if (state.header && state.header.isConnected && state.currentPath === location.pathname) {
      if (!hero || gridMissing) renderPage(state.header);
      return;
    }
    initPage();
  }

  function watchRoute() {
    state.lastPath = location.pathname + location.search;
    try {
      const pageWindow = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;
      ['pushState', 'replaceState'].forEach(function (name) {
        const original = pageWindow.history[name];
        if (!original || original.__lgmd3Patched) return;
        const patched = function () {
          const result = original.apply(this, arguments);
          scheduleRoute();
          return result;
        };
        patched.__lgmd3Patched = true;
        pageWindow.history[name] = patched;
      });
    } catch (e) { /* 跨沙箱时靠轮询兜底 */ }

    window.addEventListener('popstate', scheduleRoute);
    window.addEventListener('hashchange', scheduleRoute);
    window.addEventListener('pageshow', scheduleRoute);

    setInterval(function () {
      const current = location.pathname + location.search;
      if (current !== state.lastPath) {
        state.lastPath = current;
        scheduleRoute();
        return;
      }
      if (!isProblemPath()) {
        if (document.documentElement.classList.contains('lgmd3-active')) teardownPage();
        return;
      }
      // 部分 pjax 过渡只更新题面内容，不会替换 header。
      // 题面标题变化说明题目已切换，需要完整回收旧卡片后再按新内容重排。
      const pageTitle = pageSignature(state.header);
      if (state.pageTitle && pageTitle && state.pageTitle !== pageTitle) {
        initPage();
        return;
      }
      const hero = document.querySelector('.lgmd3-hero-actions');
      const side = $(SELECTOR.side);
      const hasSideCards = !!(side && side.querySelector('.l-card'));
      if (!state.header || !state.header.isConnected) {
        scheduleRoute();
        return;
      }
      ensureProblemEnhancements();
      updateMenuTabs();
      // 页面局部重渲染可能只移除我们的 hero/grid，而不会触发 pushState。
      if (!hero || (!document.getElementById('lgmd3-info-grid') && hasSideCards)) {
        renderPage(state.header);
        return;
      }
      if (state.submitPrepared && (!state.submitCard || !state.submitCard.isConnected)) {
        cleanupSubmitSection(false);
        if (isLoggedIn()) setTimeout(function () { ensureSubmitSection(); }, 300);
      }
    }, 900);
  }

  function registerMenuCommands() {
    if (typeof GM_registerMenuCommand !== 'function') return;
    try {
      GM_registerMenuCommand('复制 Markdown 题面（Alt+C）', function () { copyMarkdown(); });
      GM_registerMenuCommand('提交评测（Alt+L）', function () { triggerNativeSubmit(); });
      GM_registerMenuCommand('跳转到题目描述（Alt+J）', function () { scrollToDescription(); });
      GM_registerMenuCommand('跳转到提交答案并聚焦（Alt+K）', function () {
        if (state.submitPrepared && state.submitCard) scrollToSubmit(true);
        else ensureSubmitSection().then(function (card) { if (card) scrollToSubmit(true); });
      });
      GM_registerMenuCommand('MD3 设置与快捷键', function () { openSettings(); });
    } catch (e) { /* ignore */ }
  }

  /* ============================================================
   * 启动
   * ============================================================ */
  function boot() {
    if (state.booted) return;
    if (window.__lgmd3Booted) return;
    state.booted = true;
    try { window.__lgmd3Booted = true; } catch (e) { /* ignore */ }
    try { window.__lgmd3Version = '1.1.0'; } catch (e) { /* ignore */ }

    injectStyles();
    applyTheme();
    applyEditorHeight();
    watchNativeTheme();
    setTimeout(applyTheme, 700);
    installGlobalHandlers();
    registerMenuCommands();
    watchRoute();
    ensureExternalFont();

    ensureMaterial().then(function (ok) {
      if (ok) state.materialReady = true;
    });

    if (isProblemPath()) initPage();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
