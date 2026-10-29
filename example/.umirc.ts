import { defineConfig } from 'umi';

export default defineConfig({
  plugins: [require.resolve('../lib')],

  extensions: {
    name: '纸间 · 本地电子书',
    description: '在浏览器中阅读本地电子书，并自动保存阅读进度',
    icons: {
      16: 'logo/logo@16.png',
      32: 'logo/logo@32.png',
      48: 'logo/logo@48.png',
      128: 'logo/logo@128.png',
    },
    // optionsUI: '@/pages/options',
    optionsUI: {
      page: '@/pages/options',
      openInTab: true,
    },
    popupUI: {
      page: '@/pages/popup',
      title: '纸间阅读器',
    },
  },
});
