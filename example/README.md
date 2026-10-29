# 纸间 · 本地电子书

基于本仓库 Umi Chrome 扩展模板构建的本地阅读器示例。

## 功能

- 导入 TXT、Markdown 和 HTML 文件，书籍保存在浏览器本地 IndexedDB。
- 书架支持搜索、最近阅读和删除书籍。
- 阅读时自动保存滚动位置，重新打开后可继续阅读。
- 支持字号调整以及浅色、羊皮纸和深色阅读主题。
- HTML 文件按纯文本导入，不会执行其中的脚本。

## 构建和安装

在仓库根目录安装依赖并构建插件，再构建示例扩展：

```bash
pnpm install
npm run build
npm run example:build
```

在 Chrome 打开 `chrome://extensions`，启用“开发者模式”，选择“加载已解压的扩展程序”，并选中 `example/dist` 目录。
