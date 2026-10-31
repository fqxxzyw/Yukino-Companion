# 本地开发与验证

## 源码基线

- 仓库：<https://github.com/fqxxzyw/Yukino-Companion>
- 基线标签：`v0.4.0-test.41029585625`
- 基线提交：`a60bd0581bc93904b6d7f3f968ca1f508496fe6e`
- 开发分支：`feat/yukino-ui-live-preview`
- 根目录：`E:\JAVA\yukino-companion`（源码直接在此目录，不再嵌套仓库）。

不要用较旧的 `main` 覆盖此 Release 的多模态、人物和资源模块。不要解包安装版 EXE 作为开发源码。

## 启动

使用当前项目锁文件：`npm ci`。固定的新增开发依赖是 `@vitejs/plugin-react@6.1.2` 与 `playwright-core@1.64.1`；不需要全局升级 Node/npm。

```sh
npm run dev:web
npm run dev:desktop
```

| 入口 | 默认地址 | 能力边界 |
| --- | --- | --- |
| 浏览器 | http://127.0.0.1:5173/ | React/CSS UI 预览，无 Electron IPC，不执行真实聊天、语音或视觉能力 |
| Electron | http://127.0.0.1:5174/ | 真 Electron 窗口，保留原 preload IPC；推理资源和服务仍需另行准备、实测 |

两个入口可同时运行。端口被占用会报错，不会悄悄换端口或复用未知服务。可显式覆盖：

```sh
npm run dev:web -- --port 5273
npm run dev:desktop -- --port 5274
```

React/CSS 通过 Vite Fast Refresh/HMR 更新；`electron/` 下的 JS/CJS/JSON/HTML/CSS 变化会防抖后先保存并退出当前 Electron，再启动新实例。终端输入 `r` + Enter 可手动重启，`q` + Enter 或 Ctrl+C 正常停止。只管理本命令创建的 Electron PID，不按程序名称批量结束其他进程。

显式加 `--inspect-renderer 9334` 才开启本机回环调试端口。不要把调试服务暴露到局域网或公网。

## VS Code

打开项目根目录即可使用 `.vscode/tasks.json` 和 `.vscode/launch.json`：

- Ctrl+Shift+B：运行默认的 Electron 实时预览任务。
- “终端 → 运行任务”：可选浏览器 UI 预览。
- “运行和调试”：提供 Electron、Edge 浏览器及 VS Code 内嵌浏览器入口。

不要对正在运行的同一任务重复启动。由工具后台启动的服务不等同于 VS Code 集成终端任务；端口冲突时应在原服务终端正常停止，不要批量结束 Node/Electron/VS Code。

## 数据隔离

所有未打包启动（包括 `npm start`）在 Electron ready、单实例锁及业务服务导入之前设置：

- `userData`：`%APPDATA%\yukino-companion-development`
- `sessionData`：`%APPDATA%\yukino-companion-development\chromium`

正式安装版不会使用此开发路径。开发启动不自动导入旧 `YukinoPet/settings.ini`。不要删除或修改正式版聊天、密钥、角色偏好、资源配置和下载状态。

浏览器 DEV 模式只在自己的 localStorage 保存 UI 偏好；不会创建伪造 IPC，也不保存 API Key。开发草稿用于预览恢复，不写入正式版配置。

## 前端静态资源与推理资源的区别

全新 checkout 中桌宠 UI 图集未跟踪。`dev:web` / `dev:desktop` 的前置钩子与 VS Code 调试前置任务会通过 `prepare:ui` 准备官方摘要固定的 UI 图片和壁纸，不准备推理模型；也可以手动执行：

```sh
node scripts/prepare-companion-assets.cjs --artwork-only
node scripts/prepare-wallpapers.cjs
```

务必保留 `--artwork-only`：不加该参数会准备桌宠预录语音，不是单纯 UI 图集。壁纸从仓库现有编码数据还原，不需要下载模型。

角色 GLB 原始二进制并非本标签公开 checkout 的完整内容。本地已从现有安装资源的 `app.asar` 使用仓库恢复脚本提取、按原始清单校验；没有运行安装器，也没有把解包业务代码当源码。

当前只恢复最初 7 套草稿模型（01–07），不恢复额外 10 个扩展/评审版本。原文件名、摘要、01 hold 和好感/使用日期规则保持不变。模型当前是草稿，按用户要求暂不排查、修复材质；框架验证与美术定稿验收分开。

```sh
# 仅在缺失时从可信安装资源恢复；不执行安装器
npm run restore:characters -- "E:/path/to/resources/app.asar"
npm run prepare:characters
npm run verify:models:base -- --url http://127.0.0.1:5173/
npm run build
npm run verify:models:base -- --dist
npm run qa:models:base
npm run qa:models:dev
```

`npm run build` 默认只校验 7 个基础 GLB 并准备轻量 UI 图片/壁纸，三个前端入口和 `dist/characters/` 都会生成。`build:full` 保留原完整资源流水线，需另行准备扩展输入与桌宠预录语音，不属于本次范围。构建成功不代表 EXE/推理能力全部验收。

开发主进程从 `public/` 读取内置 GLB；生产及无 Vite 地址的本地启动仍从 `dist/` 读取。浏览器通过 Vite HTTP 获取 GLB，不伪装 IPC。

`qa:models:base` 在隔离资产窗口使用真正 Electron/Three/WebGL，依次加载 6 套非 hold 基础模型；保留 01 hold 并跳过渲染。此资产 fixture 不验证用户进度已解锁，不改变产品状态。`qa:models:dev` 另用 5374 / CDP 9434 运行原应用和原 preload，检查真实校服 3D、衣柜限制、模型 IPC 与重启草稿恢复，不伪造好感/日期。

本次流程最初附带提取的 10 个扩展文件已校验后移到项目外 `E:\JAVA\yukino-character-review-backup-20261031\`，保留摘要清单；不要自动移回或删除。`public/characters/` 和本次 `dist/characters/` 应各恰好有 7 个 GLB。

## 开发验证

```sh
npm run test:dev
npm run qa:dev
node --test tests/*.test.cjs
```

`qa:dev` 使用已有 Edge（通过 playwright-core，不另下载浏览器），在 5273/5274 及显式 CDP 9334 上启动自己的测试实例，避免占用用户 5173 的预览。会短暂编辑 UI / main / preload 作热更新与重启验证，并在 finally 恢复；测试期间不要同时编辑这些文件。

开发热更新截图、进程日志、`report.json` 在 `build/dev-verification/`；7 模型文件/HTTP/产物报告在 `build/base-model-verification/`，真实模型资产截图在 `build/base-model-ui-review/`，原应用开发验收在 `build/base-model-development/`（均为忽略目录）。验证结果应以当次报告为准，不能把单元测试或终端 ready 文本当成真实窗口验收。

已验证：7 个 public 文件及 HTTP 响应、7 个 dist 文件的固定大小/SHA、GLB 结构、内嵌纹理、55 骨骼与 6 个原动画；6 套非 hold 模型在 RTX 3060 的真实 WebGL 中可渲染并已逐张查看截图。01 仅资源完整性通过，未解除 hold 或渲染。资产 QA 有 Windows 临时 Chromium 目录文件占用清理警告，窗口进程正常退出；不把警告隐藏成完全清理成功。

专门恢复/隔离/视觉安全及主进程单测 67/67 通过。原应用开发验收通过：真实校服模型 IPC/渲染、衣柜限制、旋转缩放复位、手动受控重启后的草稿与模型恢复、正常退出释放 5374/9434；这不代替完整 `qa:dev` 的全部热更新/主进程文件变更测试。浏览器真实 3D 和无 IPC 能力提示也已截图检查（`web-preview.json`），没有以缩略图或 Q 版 fallback 冒充 3D。

开发源码监听增加内容摘要判定，过滤 Windows 元数据/重复通知，避免内容未变时误重启窗口。DEV 草稿在 Electron 使用隔离 Chromium localStorage，以跨主进程重启保留；浏览器仍用 sessionStorage。

此前全 17 文件恢复后的一次完整测试为 932 项：914 通过、7 失败、11 跳过（日志 `.git/resources-restored-tests.log`）；失败涉及原有行走/视频行为及 Windows symlink 权限，并非全通过。此结果发生在本次收敛为仅 7 文件之前；当前完整 Release 测试还可能要求用户本次不需要的扩展，不得以专门 7 模型测试代替完整测试结论。

## 需求与保留的工作

需求原件保持在 `yukino_conversation02_v2_1/`，23 个文件；不要删除、移动、覆盖或提交整套截图。已在本地 `.git/info/exclude` 排除需求和 `.local-dev/`。

旧 main 上的开发工作已保留在：

- `E:\JAVA\yukino-local-dev-backup-20261031-before-release\`（文件副本、摘要清单与二进制 diff）
- 旧分支 `feat/local-dev-live-preview`
- Git stash：`Preserve local dev environment before release a60bd058 migration`

不要直接把该 stash 整套套用到新版，也不要清理 stash/备份。

## 后续交付范围（2026-10-31 用户追加）

开发环境不是终点。后续仍需：

1. **UI 设计已获用户确认**：2026-10-31 用户明确表示「UI 设计通过」「拖动的动画很丝滑」。12 个主入口、输入 / 输出分开、角色管理 / 显示分开、真实资源提示与部署入口、角色提示词复制、轻透设置、直接跟手和配对 FLIP 保留；最新去掉顶部「拖动」二字，恢复独立于位移的背景渐模糊 / 渐清晰。用户认可不代替窄窗 / DPI / 原生能力验收，角色提示词深化仍待后续。
2. **场景已暂停，当前先修下载逻辑**：用户最新要求停止场景及人物框场景入口修改，等待他们提供合适 JS。此前改动完整保留，最新场景和菜单未获确认，不继续美术扩展或擅自回滚；[SCENE_DIORAMAS.md](SCENE_DIORAMAS.md) 的场景待办目前冻结。当前优先处理多入口去重、在途任务复用、取消范围与安全重试；不自动下载大型模型、不启动推理或应用服务。下载逻辑记录见 [DOWNLOAD_TASKS.md](DOWNLOAD_TASKS.md)。
3. 随后实现日语增量分句、受控预合成与严格有序播放；明确句子并发、算子线程、背压、显存预算和取消语义的区别。
4. 再做默认音色 / 参考音频分类与自动选择，匹配原文和语言，并保留自定义选择。
5. 最后核查硬件、独立环境与 CPU / GPU 适配；已有资源先校验复用，不改正式资源。模型完整、运行时、实际加载、生成、播放和用户听感分开验收，未测不标成功。
6. Windows Base 安装器已确认使用 Inno Setup 6.7.3，并做原生页面源码增量调整；新安装包编译、隔离安装 / 升级 / 卸载以及新的首次启动流程仍待完成，按用户最新要求后置。

详细对应项、实际改动和未完成门槛见 [UI/UX 改造实施与验收清单](UI_UX_IMPLEMENTATION.md)。场景重做前，拖动与独立侧栏的 24 文件定向回归为 **188/188 通过**；五景整合后的最新 31 文件回归共 **241 项：240 通过、0 失败、1 跳过**（Windows 无符号链接创建权限的既有壁纸用例），日志为 `.local-dev/diorama-regression-final-20261031.log`。三个前端入口构建和七模型 dist 原摘要 / 结构校验通过；仍有 >500 kB 大 chunk 提示，未抬高阈值。这不代表全仓、视觉或真实硬件验收通过。资源提示使用只读 `setupStatus({scope:'all'})`，不将 API-only 的全部跳过当作资源齐全，不改变当前部署选择。浏览器没有 IPC 时只提示需在桌面版检查。预览与 QA 服务此前因系统内存压力被停止，本轮没有擅自重新启动。用户提供的问题截图已查看，端侧更新根因未定位；用户随后已确认 UI 设计通过和拖动顺滑。尚未取得新场景或本轮渐模糊改动的 Electron 验收截图。

资料优先级：`01_MASTER_ISSUES_ZH.md` 与 `02_VISION_VOICE_ADDENDUM_ZH.md` 高于旧规范和概念图。121 条是需求与缺陷报告的混合索引，不是本机已复现或已修复数量。

不自动提交、推送、合并或发布。
