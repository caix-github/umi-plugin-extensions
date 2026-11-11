# umi-plugin-extensions 文件作用分析

> 本文档对项目中所有文件逐一说明作用，按目录组织。

---

## 根目录配置文件

| 文件 | 作用 |
| --- | --- |
| `package.json` | 项目配置入口。定义了 npm 包名 `umi-plugin-extensions`，入口 `lib/index.js`，类型 `types/index.d.ts`。包含完整 scripts（构建、测试、示例、文档、发布）、依赖（fs-extra、got、webpack 等）和 devDependencies（father、jest、umi4、husky 等）。配置了 lint-staged 和 prettier 规则。 |
| `pnpm-workspace.yaml` | pnpm 工作空间配置。根包 + `example` + `document` 三个子包。 |
| `pnpm-lock.yaml` | pnpm 依赖锁文件，保证团队安装依赖版本一致。 |
| `tsconfig.json` | 根 TypeScript 配置。target ESNext，strict 模式，JSX react，declaration 生成类型声明。include `src/test/types`，exclude `node_modules/dist/lib/fixtures/examples`。 |
| `tsconfig-check.json` | 纯类型检查配置。继承根 tsconfig，加 `noEmit: true` + `skipLibCheck: true`，include `src/types`。供 `npm run tsc` 使用。 |
| `tsconfig-typedoc.json` | TypeDoc 专用 TS 配置。include `types`，放宽检查（`skipLibCheck`、`noStrictGenericChecks`），供 `typedoc` 生成 API 文档时使用。 |
| `jest.config.ts` | Jest 测试配置。基于 `@umijs/max/test`，target browser，esbuild 转换，JSX automatic。覆盖率从 `src/**/*.ts` 收集，排除 umi 临时目录。setup 文件指向 `tests/jest-setup.ts`。 |
| `typedoc.js` | TypeDoc 文档生成配置。入口 `types/index.d.ts`，输出到 `document/docs/api`。使用 markdown 插件，隐藏面包屑和源码来源。 |
| `codecov.yml` | Codecov 覆盖率配置。修正 GitHub CI 的路径映射问题。 |
| `.gitignore` | Git 忽略规则。 |
| `.gitattributes` | Git 文件属性。 |
| `LICENSE` | MIT 许可证，Copyright (c) 2021 Arvin Xu。 |
| `README.md` | 项目说明文档。介绍安装、使用方式、开发指引和 TODO List。 |
| `CONTRIBUTING.md` | 贡献指南。说明如何 clone、安装依赖（yarn）、构建和测试。内容较简略，Debug 部分标注 TODO。 |
| `CHANGELOG.md` | 版本变更日志。记录了从 v0.6.2 到 v1.0.1 的变更，包括 Manifest V3 适配、umi4 支持等。 |

---

## src/ — 核心源码

### src/index.ts

**插件入口文件。** 导出一个接收 `IApi` 的函数，按固定顺序编排 7 个功能子模块：Base → ConfigSchema → onStart → ManifestGenerator → Background → ContentScripts → HotReload。

### src/index.test.ts

**入口模块测试。** 使用 umi Service 启动 normal fixture 测试插件，验证生成的 HTML 是否包含 root 节点。当前标记为 `test.skip`（跳过状态）。

### src/functions/ — 功能模块

| 文件 | 作用 |
| --- | --- |
| `functions/index.ts` | 功能模块统一导出桶文件。导出 7 个子模块：ManifestGenerator、Base、ConfigSchema、Background、onStart、ContentScripts、HotReload。 |
| `functions/base.ts` | **基础配置修改。** 通过 `api.modifyConfig` 将 umi 配置改为 MPA 多页打包模式（`mpa: {}`），关闭 mfsu，强制 `writeToDisk: true`，关闭 `codeSplitting`。这是让 umi 产物适配 Chrome 插件的前提。 |
| `functions/configSchema.ts` | **配置 Schema 定义。** 通过 `api.describe` 注册 `extensions` 配置项，定义 Joi 校验器。包含完整的 Chrome 权限白名单（70+ 个权限枚举）、contentScript 结构校验、icons/background/optionsUI/popupUI 类型校验。默认配置包括 manifestVersion 3、minimumChromeVersion 88 等。 |
| `functions/onStart.ts` | **开发模式首次编译处理。** 仅 dev 模式生效。通过 `api.onDevCompileDone` 在首次编译完成后，用 got 请求 dev server 的 manifest.json，等待 500ms 后合并 background、contentScripts、hotReload 的路径修正，写回输出目录。stage 设为 1000（最后执行）。 |
| `functions/manifest.ts` | **Manifest 文件生成。** 通过 `api.chainWebpack` 在 webpack 流程中注入 `GenerateJsonPlugin`，调用 `generateManifestFromConfig` 从插件配置生成 `manifest.json` 并写入输出目录。 |
| `functions/background.ts` | **Background 脚本处理。** 两步：(1) 通过 `chainWebpack` 将 `background.service_worker` 注册为 webpack 入口 `background`；(2) 在 `onDevCompileDone` 和 `onBuildComplete` 回调中读取 manifest.json，将 background.service_worker 路径修正为 `background.js`。 |
| `functions/contentScripts.ts` | **Content Scripts 脚本处理。** 两步：(1) 遍历 contentScripts 配置，处理 `@/` 和 `.` 前缀路径（从 src 下查找）和裸模块名（从 node_modules 查找），每个注册为独立 webpack 入口 `contentScript_N`；(2) 编译完成后读取 manifest.json，将 content_scripts 的 js/css 路径修正为 `contentScript_N.js/css`。 |
| `functions/hotReload.ts` | **热重载处理。** 仅 dev 模式生效。通过 `chainWebpack` 在 CopyPlugin 中追加 `hot-reload.js` 脚本拷贝到输出目录，编译完成后调用 `updateHotLoad` 在 manifest.json 中注入热重载入口。 |
| `functions/base.test.ts` | **Base 模块测试。** 使用 umi Service 启动 base fixture，生成临时文件后用 @testing-library/react 渲染并验证。当前标记为 `test.skip`。 |
| `functions/contentScripts.test.ts` | **ContentScripts 模块测试。** 使用 umi Service 启动 contentScripts fixture，验证生成的 HTML。当前标记为 `test.skip`。 |

### src/utils/ — 工具函数

| 文件 | 作用 |
| --- | --- |
| `utils/index.ts` | 工具模块统一导出桶文件。重新导出 csp、delay、env、manifest 四个模块。 |
| `utils/manifest.ts` | **Manifest 生成与修正核心逻辑。** 包含 5 个函数：<br />• `validateVersion` — 校验版本号格式（支持 X.Y.Z.a 和 X.Y.Z-rc.N 格式）<br />• `generateManifestFromConfig` — 将插件配置（camelCase）转为 Chrome manifest 格式（snake_case），处理 optionsUI、popupUI、background、CSP、contentScripts 映射<br />• `updateBackground` — 将 manifest 中 background.service_worker 修正为 `background.js`<br />• `updateContentScripts` — 将 manifest 中 content_scripts 的 js/css 修正为 `contentScript_N.js/css`<br />• `updateHotLoad` — 在 manifest 中注入 `hot-reload.js` 作为 background |
| `utils/csp.ts` | **CSP（内容安全策略）处理。** 包含 2 个函数：<br />• `extractInlineScript` — 用正则从 HTML 中提取 `<script>` 标签内的内联脚本内容<br />• `getCSPScript` — 根据 nonce、inlineScript、url 配置生成 CSP `script-src` 策略字符串 |
| `utils/env.ts` | **环境变量处理。** 导出 `isDev`（判断 NODE_ENV 是否为 development）和 `baseDevURL`（拼装 protocol://host:port，默认 `http://127.0.0.1:8000`）。 |
| `utils/delay.ts` | **延迟工具。** 导出 `delay(ms)` — 返回一个在指定毫秒后 resolve 的 Promise，用于 onStart 中等待 dev server 就绪。 |
| `utils/hot-reload.js` | **热重载运行时脚本。** 被拷贝到插件输出目录，在 Chrome 中作为 background service worker 运行，监听文件变化触发插件自动重载。 |

---

## types/ — 类型定义

| 文件 | 作用 |
| --- | --- |
| `types/index.d.ts` | **类型入口文件。** 声明两个全局命名空间：`chromeManifest` 和 `extensionsPlugin`。 |
| `types/extensionsPlugin/index.d.ts` | **插件配置类型定义。** 定义 `extensionsPlugin.Config` 接口（继承 BaseManifest），包含 contentSecurityPolicy、manifestVersion、minimumChromeVersion、optionsUI、popupUI、contentScripts、extends 等字段。同时定义 `ContentSecurityPolicy`、`PopupUI`、`OptionsUI`、`ContentScript` 子接口。 |
| `types/chromeManifest/Manifest.d.ts` | **Chrome Manifest 完整类型定义。** 定义 `chromeManifest.Manifest` 主接口（50+ 字段），以及相关类型：`ManifestVersion`、`IconType`、`BrowserAction`、`Background`、`OptionsUI`、`Permissions`（70+ 权限枚举）、`KnownPermissions`、`SpecialPermissions` 等。带详细中文注释和 Chrome 官方文档链接。 |
| `types/chromeManifest/Command.d.ts` | Chrome Manifest 中 commands（键盘快捷键）的类型定义。 |
| `types/chromeManifest/ContentScripts.d.ts` | Chrome Manifest 中 content_scripts 的类型定义。 |
| `types/chromeManifest/EventRules.d.ts` | Chrome Manifest 中 event_rules 的类型定义。 |
| `types/chromeManifest/ExternallyConnectable.d.ts` | Chrome Manifest 中 externally_connectable（外部连接）的类型定义。 |
| `types/chromeManifest/FileBrowserHandler.d.ts` | Chrome Manifest 中 file_browser_handlers 的类型定义。 |
| `types/chromeManifest/FileSystemProvider.d.ts` | Chrome Manifest 中 file_system_provider 的类型定义。 |
| `types/chromeManifest/NativeClientModule.d.ts` | Chrome Manifest 中 nacl_modules 的类型定义。 |
| `types/chromeManifest/Requirement.d.ts` | Chrome Manifest 中 requirements 的类型定义。 |
| `types/chromeManifest/Sandbox.d.ts` | Chrome Manifest 中 sandbox 的类型定义。 |
| `types/chromeManifest/SettingsOverrides.d.ts` | Chrome Manifest 中 chrome_settings_overrides 的类型定义。 |
| `types/chromeManifest/SharedModules.d.ts` | Chrome Manifest 中 import（共享模块）的类型定义。 |
| `types/chromeManifest/TTSEngine.d.ts` | Chrome Manifest 中 tts_engine 的类型定义。 |

---

## lib/ — 构建产物

`lib/` 目录是 `father build` 的产物（编译后的 JS 文件），结构镜像 `src/`。发布到 npm 时包含 `lib/` 和 `types/` 两个目录。包含 15 个 `.js` 文件：

| 文件 | 对应源码 |
| --- | --- |
| `lib/index.js` | `src/index.ts` 编译产物 |
| `lib/functions/index.js` | `src/functions/index.ts` 编译产物 |
| `lib/functions/base.js` | `src/functions/base.ts` 编译产物 |
| `lib/functions/configSchema.js` | `src/functions/configSchema.ts` 编译产物 |
| `lib/functions/onStart.js` | `src/functions/onStart.ts` 编译产物 |
| `lib/functions/manifest.js` | `src/functions/manifest.ts` 编译产物 |
| `lib/functions/background.js` | `src/functions/background.ts` 编译产物 |
| `lib/functions/contentScripts.js` | `src/functions/contentScripts.ts` 编译产物 |
| `lib/functions/hotReload.js` | `src/functions/hotReload.ts` 编译产物 |
| `lib/utils/index.js` | `src/utils/index.ts` 编译产物 |
| `lib/utils/manifest.js` | `src/utils/manifest.ts` 编译产物 |
| `lib/utils/csp.js` | `src/utils/csp.ts` 编译产物 |
| `lib/utils/env.js` | `src/utils/env.ts` 编译产物 |
| `lib/utils/delay.js` | `src/utils/delay.ts` 编译产物 |
| `lib/utils/hot-reload.js` | `src/utils/hot-reload.js` 运行时脚本（直接拷贝） |

---

## tests/ — 测试

| 文件 | 作用 |
| --- | --- |
| `tests/jest-setup.ts` | Jest setup 文件。引入 `@testing-library/jest-dom`（DOM 断言扩展）和 `@umijs/max/test-setup`（umi 测试环境）。 |
| `tests/utils/csp.test.ts` | **CSP 工具函数测试。** 测试 `extractInlineScript`（从 test.html 提取内联脚本）和 `getCSPScript`（空对象、单项、多项三种场景的 CSP 字符串生成）。 |
| `tests/utils/manifest.test.ts` | **Manifest 工具函数测试。** 测试 `generateManifestFromConfig`（基础配置、optionsUI+popupUI+background 组合、popupUI 单独）、`validateVersion`（正确格式 X/X.Y/X.Y.Z/X.Y.Z.a/X.Y.Z-rc.N，错误格式）、`updateBackground`、`updateHotLoad`、`updateContentScripts`。 |
| `tests/utils/test.html` | CSP 测试用 HTML 文件。包含两个 `<script>` 标签（routerBase 和 umi version），供 `extractInlineScript` 测试用。 |
| `tests/fixtures/package.json` | 测试 fixture 的公共 package.json，name 为 "normal"。 |
| `tests/fixtures/base/index.tsx` | base fixture 的入口 React 组件，渲染一个 div。 |
| `tests/fixtures/normal/index.tsx` | normal fixture 的入口 React 组件，渲染一个 div。 |
| `tests/fixtures/normal/background/index.ts` | normal fixture 的 background 脚本，输出 `hello,extension.`。 |
| `tests/fixtures/normal/contentScripts/index.ts` | normal fixture 的 contentScript，引入样式并输出日志。 |
| `tests/fixtures/contentScripts/index.tsx` | contentScripts fixture 的入口 React 组件。 |
| `tests/fixtures/contentScripts/contentScripts/index.ts` | contentScripts fixture 的 contentScript 脚本。 |

---

## example/ — 示例 Chrome 插件项目

pnpm workspace 子包，一个完整的 Chrome 插件示例（名为"纸间 · 本地电子书"）。

| 文件 | 作用 |
| --- | --- |
| `example/package.json` | 示例项目配置。依赖 epubjs（EPUB 阅读器库）、pdfjs-dist（PDF 渲染库）、jquery。 |
| `example/tsconfig.json` | 示例项目 TS 配置。配置路径别名 `@/*` 和 `@@/*`，strict 模式。 |
| `example/typing.d.ts` | CSS/Less 模块类型声明。让 TypeScript 能识别 `import styles from '*.css'`。 |
| `example/README.md` | 示例项目说明。描述"纸间"阅读器的功能和构建安装步骤。 |
| `example/.gitignore` | 忽略 `.umi`、`.umi-production`、`dist`、`node_modules`。 |
| `example/src/app.tsx` | umi 运行时入口。导出 `render` 函数，直接调用 `oldRender()`，无自定义逻辑。 |
| `example/src/background/index.ts` | 插件 background service worker。输出 `hello,extension.`。 |
| `example/src/utils/library.ts` | **书架数据层。** 基于 IndexedDB 的 CRUD 操作。定义 `Book`、`BookMark`、`BookPosition` 类型，`listBooks`/`addBook`/`updateBook`/`removeBook`/`updateBookPosition` 函数。数据库名 `paperbound-library`，store 名 `books`。 |
| `example/src/pages/popup/index.tsx` | **Popup 弹窗页面。** 320px 宽的小窗口，展示品牌标识和"打开书架"链接。最简单的 React 组件（20 行）。 |
| `example/src/pages/popup/index.css` | Popup 页面样式。定义 320px 宽度、品牌标识、按钮等样式。 |
| `example/src/pages/options/index.tsx` | **Options 选项页主组件。** 完整的电子书阅读器界面（约 1800 行）。管理书架列表、阅读器状态、搜索过滤、偏好设置、文件导入。使用 useState/useEffect/useRef/useCallback/useMemo 等全部核心 React Hook。 |
| `example/src/pages/options/index.css` | Options 页面样式。定义布局、侧边栏、工具栏、书架网格等样式。 |
| `example/src/pages/options/Readers.tsx` | **阅读器组件。** 导出 `EpubReader`（EPUB 阅读，基于 epubjs）、`PdfReader`（PDF 阅读，基于 pdfjs-dist）、`PdfPageThumbnail`（PDF 缩略图）。包含主题系统（6 种主题）、布局模式（滚动/单页）、书签高亮、目录导航、缩放控制等功能。约 840 行。 |
| `example/src/contentScripts/github/index.tsx` | **GitHub 页面注入脚本。** 在 github.com 页面注入一个 React 组件（蓝底圆角浮标），使用 ReactDOM.createRoot 手动挂载到动态创建的 div。 |
| `example/src/contentScripts/github/style.less` | GitHub contentScript 样式。修改 GitHub header 背景色，定义浮标样式。 |
| `example/src/contentScripts/baidu/index.ts` | **百度页面注入脚本。** 引入样式，输出日志。 |
| `example/src/contentScripts/baidu/style.less` | 百度 contentScript 样式。将 `#su` 元素背景改为红色。 |
| `example/public/logo/logo@16.png` | 插件图标 16x16。 |
| `example/public/logo/logo@32.png` | 插件图标 32x32。 |
| `example/public/logo/logo@48.png` | 插件图标 48x48。 |
| `example/public/logo/logo@128.png` | 插件图标 128x128。 |

---

## document/ — 文档站

pnpm workspace 子包，基于 dumi 的文档站点。

| 文件 | 作用 |
| --- | --- |
| `document/package.json` | 文档站配置。 |
| `document/.dumirc.ts` | dumi 配置。主题名 `umi-plugin-extensions`，关闭 mfsu，base/path 为 `/`。引入 nav 配置。 |
| `document/config/config.ts` | 文档站导航和侧边栏配置。导航：指南、教程、API、GitHub。侧边栏：API 模块索引 + 插件配置（OptionsUI/PopupUI/ContentScript/CSP）+ Manifest 文件类型。 |
| `document/API.md` | TypeDoc 生成的 API 文档首页。 |
| `document/docs/index.md` | 文档站首页。 |
| `document/docs/guide/index.md` | 指南首页。 |
| `document/docs/guide/migration.md` | 迁移指南。 |
| `document/docs/guide/template.md` | 脚手架模板说明。 |
| `document/docs/guide/reference.md` | 参考资料汇总。 |
| `document/docs/guide/auxiliary/index.md` | 辅助工具概览。 |
| `document/docs/guide/auxiliary/i18n.md` | 国际化指南。 |
| `document/docs/guide/auxiliary/storage.md` | 存储方案指南。 |
| `document/docs/guide/auxiliary/web-request.md` | Web Request 指南。 |
| `document/docs/guide/tips/cookies.md` | Cookie 使用技巧。 |
| `document/docs/guide/tips/csp.md` | CSP 配置技巧。 |
| `document/docs/guide/tips/get-id.md` | 获取插件 ID 技巧。 |
| `document/docs/guide/tips/inject.md` | 脚本注入技巧。 |
| `document/docs/guide/tips/path.md` | 路径处理技巧。 |
| `document/docs/tutorial/index.md` | 教程首页。 |
| `document/docs/tutorial/comparison.md` | Chrome 插件开发方案对比。 |
| `document/docs/tutorial/communication.md` | 组件间通信教程。 |
| `document/docs/tutorial/core/background.md` | Background 核心概念。 |
| `document/docs/tutorial/core/content-scripts.md` | Content Scripts 核心概念。 |
| `document/docs/tutorial/core/homepage.md` | 主页核心概念。 |
| `document/docs/tutorial/core/injected-script.md` | 注入脚本核心概念。 |
| `document/docs/tutorial/core/manifest.md` | Manifest 核心概念。 |
| `document/docs/tutorial/core/popup.md` | Popup 核心概念。 |
| `document/docs/tutorial/display/browserAction.md` | Browser Action 显示教程。 |
| `document/docs/tutorial/display/contextMenu.md` | 右键菜单教程。 |
| `document/docs/tutorial/display/devtools.md` | DevTools 教程。 |
| `document/docs/tutorial/display/notification.md` | 通知教程。 |
| `document/docs/tutorial/display/omnibox.md` | 地址栏（Omnibox）教程。 |
| `document/docs/tutorial/display/options.md` | Options 选项页教程。 |
| `document/docs/tutorial/display/override.md` | 页面覆盖教程。 |
| `document/docs/tutorial/display/pageAction.md` | Page Action 教程。 |
