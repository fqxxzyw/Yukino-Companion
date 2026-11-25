# Yukino Companion 账号与官网 · 部署交接说明

> 状态（2026-11-18）：**现有 D1 的 0001/0002 迁移已执行并核验，账号后端已仅 API 部署，官网前端尚未发布。七项生产 Secret 已配置，生产公钥与本地匹配；两封旧版独立邮件已确认收到，新版注册验证码请求被发信服务接受但收件待确认。免费计划冷认证请求 CPU 接近上限，并发与长期兼容性尚未验证。未开通付费服务、push GitHub 或发布 Release。**
> 本文件只列名称、路径和操作说明，不包含真实密码、密钥或令牌。

## 1. 目录

| 内容 | 完整本地路径 |
| --- | --- |
| 项目根目录（桌面端源码） | `E:\JAVA\yukino-companion` |
| 桌面主进程 | `E:\JAVA\yukino-companion\electron` |
| 桌面渲染进程 | `E:\JAVA\yukino-companion\src` |
| 账号后端（Cloudflare Worker + D1） | `E:\JAVA\yukino-companion\server` |
| 官网 / 登录 / 注册 / 账号中心前端 | `E:\JAVA\yukino-companion\website` |
| 前后端共享规则与公开配置 | `E:\JAVA\yukino-companion\shared` |
| 本地截图与测试产物 | `E:\JAVA\yukino-companion\build\account-review` |

官网是 Worker Static Assets 直接托管的静态站点，没有单独的打包目录；`server/wrangler.toml` 的 `assets.directory` 指向 `../website`。

## 2. 配置与迁移文件

| 文件 | 位置 | 用途 |
| --- | --- | --- |
| Wrangler 配置 | `E:\JAVA\yukino-companion\server\wrangler.toml` | Worker 名称、入口、Static Assets、D1 绑定、Cron、公开变量 |
| D1 迁移 0001 | `E:\JAVA\yukino-companion\server\migrations\0001_init.sql` | 账号、会话、验证码、登录天数、进度、奖励流水、皮肤、限流、邮件队列、审计、下载缓存 |
| D1 迁移 0002 | `E:\JAVA\yukino-companion\server\migrations\0002_session_persistent.sql` | “保持登录”关闭时的会话 Cookie 标记 |
| 本地环境变量示例 | `E:\JAVA\yukino-companion\server\.dev.vars.example` | 仅占位符；本地用 `npm run api:secrets` 生成 `.dev.vars`（已被 git 忽略） |
| Worker 入口 | `E:\JAVA\yukino-companion\server\src\worker.js` | `/api/v1/*` 进入 API；其余走 Static Assets |
| API 路由 | `E:\JAVA\yukino-companion\server\src\app.js` | 鉴权、CORS、Origin、错误码 |
| 服务端规则 | `E:\JAVA\yukino-companion\shared\progress-rules.mjs` | 登录天数、好感度、事件额度、皮肤条件（服务端权威） |
| 客户端权益公钥 | `E:\JAVA\yukino-companion\shared\entitlement-public-key.json` | 已配置公钥及 key ID，本机匹配验证通过；私钥只放 Workers Secrets |
| 本地开发服务器 | `E:\JAVA\yukino-companion\server\scripts\dev-server.mjs` | 同一套 API + Node SQLite + 本地测试收件箱 + 官网静态文件 |
| 本地测试收件箱 | `E:\JAVA\yukino-companion\server\.local-mailbox` | 仅本机开发，不代表 Gmail 真实送达；已忽略 git |

## 3. 本地命令（全部在项目根目录执行，PowerShell）

### 3.1 安装依赖

```powershell
Set-Location E:\JAVA\yukino-companion
npm ci
```

### 3.2 启动官网 + 本地账号后端（推荐先运行）

```powershell
Set-Location E:\JAVA\yukino-companion
npm run api:secrets   # 仅首次：生成 server/.dev.vars（本机随机密钥）
npm run api:dev
```

预期：

- 官网：<http://127.0.0.1:8787/>
- 本地测试收件箱：<http://127.0.0.1:8787/dev/mailbox>
- 健康检查：<http://127.0.0.1:8787/api/v1/health>
- 数据文件：`E:\JAVA\yukino-companion\server\.data\dev.db`

`api:dev` 只绑定 `127.0.0.1`，使用 Node 24+ 内置 SQLite；不会访问生产 Worker，也不会调用真实 Gmail。`server/wrangler.toml` 是生产配置，本地不要直接把 `wrangler dev` 当作生产/本地混合环境。需要清空本地测试数据时：

```powershell
npm run api:dev:reset
```

### 3.3 启动桌面端

仅浏览器 UI 预览（没有 Electron IPC，不执行真实聊天/语音）：

```powershell
Set-Location E:\JAVA\yukino-companion
npm run dev:web
```

真实 Electron 开发窗口（默认 Vite 端口 5174，开发 userData 与正式安装隔离）：

```powershell
Set-Location E:\JAVA\yukino-companion
npm run dev:desktop
```

让桌面端连接本地账号服务（另开一个 PowerShell 窗口先运行 `npm run api:dev`）：

```powershell
Set-Location E:\JAVA\yukino-companion
$env:YUKINO_API_BASE = "http://127.0.0.1:8787"
npm run dev:desktop
```

开发数据目录：`%APPDATA%\yukino-companion-development`。账号档案位于该目录下的 `account/`、`profiles/` 和原有 `state.json`（游客档案保持原路径）。

### 3.4 测试

```powershell
Set-Location E:\JAVA\yukino-companion
npm run api:test        # 后端：注册/登录/刷新/改密/找回/进度/安全/下载（Node + 内存 SQLite）
npm run test:account    # 桌面账号存储、客户端、云端皮肤解锁
npm test                # 项目原有回归 + 新增账号测试（会先执行 prepare 脚本）
npm run qa:account      # 真实 React 界面 + 内存 IPC：登录门、游客入口、离线错误、账号中心，并输出截图
npm run qa:site         # 需要先运行 npm run api:dev；官网真实注册/登录/重置/深链接/移动端
```

截图输出到 `build\account-review`。`qa:account` 使用 Edge/Chromium 和测试夹具，不启动你的正式 Electron 实例，也不访问网络。

### 3.5 官网构建 / 部署（前端完成且用户要求后执行）

官网是静态文件，无需前端打包。若使用 Wrangler 部署静态资源与 API：

后端目前已通过 `wrangler.backend.toml` 单独发布；前端尚在修改，请勿把下面的检查当成已获准发布前端。完整网站发布使用原 `wrangler.toml`，会更新同一个 Worker。

```powershell
Set-Location E:\JAVA\yukino-companion\server
npx wrangler --version
npx wrangler d1 migrations apply yukino-account --local   # 本地 D1（可选）
npx wrangler deploy --dry-run                            # 不发布的构建检查
```

生产远端迁移 `0001`、`0002` 已执行。用户已授权使用现有免费资源和非破坏性迁移；完整认证请求的 CPU 和并发尚待验证。未来新迁移先审查及备份，破坏性操作需要用户另行确认。详见 `docs/DEPLOY_CLOUDFLARE.md`。

## 4. 环境变量与 Secrets（只列名称和用途）

### 4.1 Worker Secrets（不得写进网页 bundle、Electron 安装包或 Git）

| 名称 | 用途 | 获取/生成方式 |
| --- | --- | --- |
| `ACCESS_TOKEN_SECRET` | 签发和校验 15 分钟访问令牌（HS256） | `npm run secrets:prod` 生成至少 32 字节随机值 |
| `OTP_SECRET` | 对邮箱验证码做 HMAC 摘要（服务端只存摘要） | 同上 |
| `SNAPSHOT_PRIVATE_JWK` | ECDSA P-256 私钥 JWK，签“已确认进度/永久皮肤”快照 | 同上；只写入 Workers Secret |
| `SNAPSHOT_PUBLIC_JWK` | 对应的公钥 JWK（公开，不是秘密） | 写入 `shared/entitlement-public-key.json` 的 `publicJwk` |
| `SNAPSHOT_KEY_ID` | 公钥轮换时的标识 | 自定义，例如 `prod-2026-11` |
| `GMAIL_CLIENT_ID` | Google OAuth 客户端 ID（发件账号 `fqxxzyw@gmail.com`） | Google Cloud Console → API 和服务 → 凭据 |
| `GMAIL_CLIENT_SECRET` | Google OAuth 客户端密钥 | 同上；只存 Worker Secret |
| `GMAIL_REFRESH_TOKEN` | 你本人授权 `gmail.send` 后得到的刷新令牌 | 本机 OAuth 授权流程；Testing 模式可能七天后失效；不要发到聊天、截图或日志 |

### 4.2 Worker 公开变量（`wrangler.toml [vars]`）

| 名称 | 用途 |
| --- | --- |
| `APP_ENV` | 生产设为 `production`；设置为非 local/test 时强制拒绝本地测试发件器 |
| `MAIL_PROVIDER` | `gmail`（生产）；本地为 `local` |
| `MAIL_FROM_EMAIL` | 发件地址 `fqxxzyw@gmail.com` |
| `MAIL_FROM_NAME` | 邮件显示名 `Yukino Companion` |
| `ALLOWED_ORIGINS` | 允许的网页来源，逗号分隔；不得使用 `*` |

### 4.3 绑定与客户端配置

| 名称 | 位置 | 用途 |
| --- | --- | --- |
| `DB` | `server/wrangler.toml` 的 `[[d1_databases]]` | 现有 D1 数据库绑定；不得重复创建或删除重建 |
| `ASSETS` | `server/wrangler.toml` 的 `[assets]` | 官网静态资源绑定，目录 `../website` |
| `YUKINO_API_BASE` | 桌面端进程环境变量（可选） | 覆盖账号 API 地址；生产默认 `https://yukino.fqxxzyw.cn`。本地可设为 `http://127.0.0.1:8787` |
| `YUKINO_WEB_BASE` | 桌面端进程环境变量（可选） | “打开网页账号中心/找回密码”使用的站点地址；默认同 API 地址 |
| `shared/entitlement-public-key.json` | 桌面安装包 `shared/` | 客户端只持公钥；本地开发自动从 loopback 端点读取 |
| `website/assets/config.js` 的 `apiBase` | 官网静态资源 | 默认空字符串（同源）；只有官网与 API 跨域时才填写，并同步更新 Worker `ALLOWED_ORIGINS` |

本地生成的 `server/.dev.vars`、`server/.data/`、`server/.local-mailbox/`、`server/.secrets.production.txt` 均已加入 `.gitignore`。

## 5. 完成情况

### 5.1 已完成并在本地验证

- 登录可跳过；首次启动无网络也可进入游客模式；游客进度保存在原有 `state.json`。
- 注册验证码、注册成功后自动登录、重复注册、密码错误、忘记密码、重置密码、修改密码。
- 游客/账号/不同账号的 `state.json` 逻辑分区；账号 A 的待同步事件不会进入账号 B；旧游客数据有一次性备份。
- 本地档案优先启动；断网、超时、5xx、令牌刷新失败只进入离线状态，不删除档案、不阻止本地使用。
- 刷新令牌轮换、并发刷新宽限、复用检测、服务端安全版本、撤销会话、退出全部设备。
- 每日确认按 `Asia/Shanghai` 业务日由服务器计一次；D1 唯一约束；并发签到只计一天。
- 好感度只接受白名单事件类型；客户端不能指定加多少分；按事件类型和全局每日额度封顶；事件幂等。
- 皮肤解锁由服务端规则和永久 `skin_unlocks` 记录决定；客户端用 ECDSA 公钥验证签名快照，离线保留已确认皮肤。
- Gmail `MailProvider` 真实发送代码路径、OAuth 刷新、发送失败不谎报成功；本地开发使用 loopback 测试收件箱。
- 注册、找回密码和安全通知新版邮件模板已部署，包含纯文本、脱敏邮箱和项目徽标；线上一次注册验证码已被发信服务接受，收件待确认。官网部署前徽标 URL 不可读取，屏蔽图片时品牌文字仍可见。
- 官网登录/注册/找回密码/账号中心真实调用 API；下载信息从 GitHub Releases API 读取并筛选 Windows 安装器；失败时保留最近缓存或退回 Releases 页面。
- Worker 的 `/api/*` 未知路径返回 JSON 404，不发生 SPA fallback；`/login`、`/register`、`/account` 深链接可刷新。
- 官网响应式截图：1440、768、390 宽度；桌面账号门/游客入口/账号中心截图。
- 自动化结果：`npm run api:test` 41 项通过；`npm run test:account` 15 项通过（档案隔离、离线、刷新撤销、安全存储、签名快照、队列、客户端网络错误）；`npm run qa:account` 通过；`npm run qa:site` 通过（官网本地注册/自动登录/重置密码/登录/深链接/移动端导航/下载链接）；此前本地 `vite build` 和账号存储端到端测试通过；这些结果不代替正式安装版或生产服务验证。

### 5.1.1 已生成截图

| 内容 | 文件 |
| --- | --- |
| 官网首页 1440 / 移动端 | `build/account-reviewinal2-hero.png`、`final2-mobile-hero2.png` |
| 官网形象与场景 | `final2-characters.png`、`final2-scene-start.png`、`final2-scene-noon.png`、`final2-scene-evening.png` |
| 十个场景与关闭/登录/下载 | `final2-gallery.png`、`final2-thumbs.png`、`site-final-close-before.png`、`site-final-close-after.png`、`site-final-login.png`、`site-final-download.png` |
| 官网注册 | `build/account-review\site-register-1440.png` |
| 官网账号中心 | `build/account-review\site-account-1440.png` |
| 桌面登录门 / 游客状态 / 账号中心 | `build/account-review\desktop-account-gate.png`、`desktop-account-guest.png`、`desktop-account-center.png` |
| 桌面游客主界面 | `build/account-review\desktop-guest-app.png` |

桌面截图使用生产 React 渲染代码 + 测试 IPC 夹具（`tests/account-browser.mjs`），不是正式安装版窗口；仅用于界面回归。

### 5.2 尚未验证 / 需要你操作

- **全量回归状态**：`node --test --test-force-exit tests/*.test.cjs` 在当前工作区为 1505 / 1542 通过、24 失败、13 跳过。24 个失败集中在本次任务之前就存在的未提交场景/面板/设置 CSS/翻译/Windows 发布测试（例如 `settings` 的角色子页面 `character-guide` 尚未纳入旧断言、`settings CSS` 仍期待未提交改动前的选择器、`chat-voice-prewarm` 测试夹具缺少当前 `boardContext`），账号新增测试与相关回归全部通过。没有为了“全绿”去修改这些既有测试或覆盖你的未提交修改。`tests/account-client.test.cjs` 在并发全量运行中曾出现文件级失败，已修复超时用例的测试服务器生命周期，单独运行 3 项通过。
- **真实 Gmail 发信**：OAuth 授权已完成，refresh token 换取访问令牌成功，三项 Gmail Worker Secret 已配置。旧版注册及找回密码模板测试邮件本人已确认收件；新版线上注册验证码请求 HTTP 200 且邮件服务接受，真实收件待确认，其他账号流程尚未验证。
- **Cloudflare 生产部署**：现有 D1 的 `0001`、`0002` 已迁移并核验。API-only Worker 版本 `113914f4-9008-4eaf-84c0-0f063c7fef86` 100% 接收流量，`/` 仍为 Hello World；官网前端尚未部署。健康检查、JSON 404、生产公钥/本地公钥匹配、D1 与七项 Secret 名称已核验；cron `17 * * * *` 已配置，实际执行待观察。回滚可能恢复旧版本 Secret 配置，回滚前后应核验；不应重复创建或删除重建现有资源。
- **生产认证及权益密钥**：`ACCESS_TOKEN_SECRET`、`OTP_SECRET`、`SNAPSHOT_PRIVATE_JWK` 和 `SNAPSHOT_KEY_ID` 已配置；本地公钥及 key ID 已写入并匹配验证通过，临时密钥及 refresh token 文件已删除。现有 Release 尚未包含新公钥，重新打包、发布及安装版验证仍需用户授权。
- **Workers 运行时安全参数**：用户明确同意将新密码 PBKDF2-SHA256 降至候选 10,000 次，仅为 OWASP 建议的 600,000 次的 1/60，哈希泄露时离线猜测风险显著更高。Cloudflare 隔离 Preview 的 GraphQL Analytics 关联 CPU 样本在 10,000 次单次为 2.239、2.429 ms，双次为 6.085、4.452 ms；20,000 次双次为 7.175、9.109 ms，业务余量不足。数据按同 Worker、时间、`isPreview` 和每点 1 请求关联；preview slug 为 `unknown`，不是通过请求 ID 的直接归因。[Cloudflare 官方说明](https://developers.cloudflare.com/workers/platform/limits/)允许偶发超限有弹性但持续超限会终止；合成探针成功不证明完整认证、并发或长期可靠性，尚不可宣布生产兼容。Cloudflare 拒绝 600,000 次派生；现有远端用户数为 0，其他环境的旧 600,000 次哈希需可信迁移或邮箱重置。不得擅自开通付费服务。
- **真实 Worker WebCrypto/Ed25519→ECDSA 行为**：本地 Node 已测试 ECDSA P-256 签名/验签；Workers 运行时需部署后验证。
- **Static Assets + `/api` 优先级**：本地 dev server 已验证（`not_found_handling = "none"`，未命中静态资源的请求进入 Worker）；真实 Wrangler 部署后的深链接与未知 API 行为仍需按 `docs/DEPLOY_CLOUDFLARE.md` 验证。
- **中国大陆网络**：未实测 workers.dev 直连、Wi-Fi/移动网络。
- **Windows 安装包**：未运行真实安装器；桌面截图使用生产 React 代码 + 测试 IPC 夹具，不是正式安装后的窗口。
- **Electron `safeStorage`**：本地单元测试使用可控加密替身；需在真实 Windows 安装版验证系统凭据可用/不可用两条路径。
- **Gmail 配额、退信、垃圾邮件归类**：未实测。
- **密码管理器和真实移动端浏览器**：未实机测试；表单已禁用自动截断、支持粘贴和显示/隐藏。

### 5.3 需要你手动授权的项目

1. Testing 模式 Gmail 授权可能七天后失效，长期发信仍需处理；本人已确认收到两封模板测试邮件。
2. 验证 Workers 免费额度下真实认证请求的 CPU 与并发；未经你同意不会开通付费服务。
3. 完成账号业务线上验收；前端仍在修改，待用户要求后再发布；重新打包、发布及验证含生产公钥的安装包需用户授权。
4. GitHub push 或 Release 发布仍须用户单独授权。

## 6. 相关文档

- `docs/DEPLOY_CLOUDFLARE.md`：逐步部署、验证、回滚、Gmail OAuth、D1、Secrets 和故障排查。
- `docs/OFFLINE_AND_PROGRESS.md`：离线规则、档案隔离、奖励审核、反作弊边界。
- `docs/SECURITY.md`：凭据保存、会话撤销、验证码、密码安全、威胁边界与残余风险。
- `docs/API.md`：接口、错误码、鉴权、Cookie/CSRF、限流与重试约定。
- `server/README.md`：后端目录、迁移、本地开发与测试入口。
- `docs/TEST_RESULTS.md`：本轮实际测试结果、全量回归失败范围和未验证项。
