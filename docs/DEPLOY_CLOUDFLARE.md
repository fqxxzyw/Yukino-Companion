# Cloudflare 部署说明

## 2026-11-17 部署状态快照

以下是当日检查结果，之后可能发生变化；继续操作前应重新检查远端状态：

- 现有 D1 `yukino-account`（`89b0733f-f518-4557-bf69-ff254b80618b`）已应用 `0001_init.sql` 和 `0002_session_persistent.sql`，并已核实 `sessions.persistent` 字段存在。禁止重复创建或删除重建该数据库。
- 现有 Worker `yukino-api` 已仅部署账号后端，当前版本 `113914f4-9008-4eaf-84c0-0f063c7fef86` 接收 100% 流量。官网前端未发布，`/` 仍返回 Hello World；不要在前端尚未完成时执行完整网站部署。
- 线上只读检查：`/api/v1/health` 返回 200、数据库为 `ok`、邮件配置为 `configured`；未知 API 返回 JSON 404；生产权益公钥及 key ID 与本地文件匹配。七项 Secret 名称、`DB` 绑定和 `scheduled` handler 已核验；远端 cron 配置为 `17 * * * *`，尚未观察到实际定时执行结果。
- Gmail OAuth 本人授权已完成，使用 refresh token 换取访问令牌成功。Worker 已配置 `GMAIL_CLIENT_ID`、`GMAIL_CLIENT_SECRET` 和 `GMAIL_REFRESH_TOKEN` 三项 Secret；本次向本人发送的两封注册/找回密码模板测试邮件已获 Gmail API 接受，本人已确认收件。此测试不代表线上账号流程已部署或验证。测试模式的授权可能在七天后到期。
- 已配置 `ACCESS_TOKEN_SECRET`、`OTP_SECRET`、`SNAPSHOT_PRIVATE_JWK`、`SNAPSHOT_KEY_ID`；签名公钥和 key ID 已写入 `shared/entitlement-public-key.json`，本机密钥匹配验证通过。生产密钥临时文件和 refresh token 临时文件已删除。现有 Release 安装包不包含新公钥，后续重新打包、发布和验证仍需用户授权。
- 新版邮件模板已随账号后端部署：线上注册验证码请求一次返回 HTTP 200 且邮件服务接受，真实收件尚待本人确认；官网部署前徽标地址不可读取，邮件客户端屏蔽图片时仍显示品牌文字。之前确认收件的两封独立测试邮件使用的是旧模板。
- 用户已明确同意为免费额度降低密码迭代次数，后端使用 PBKDF2-SHA256 10,000 次，仅为 OWASP 建议的 600,000 次的 1/60；数据库哈希泄露后的离线猜测风险显著更高。隔离 Preview 的 GraphQL Analytics 中，关联 10,000 次单次派生的 CPU 样本为 2.239、2.429 ms，双次为 6.085、4.452 ms；20,000 次双次样本为 7.175、9.109 ms。冷认证请求 CPU 样本接近免费额度，并发与长期可靠性仍未验证，不能宣布生产兼容。
- 先前 100,000 次派生测试的关联 CPU 样本单次为 33.146、22.465 ms、双次约 64.038 ms，均高于免费计划 10 ms。这些 Analytics 数据按同一 Worker、时间窗口、`isPreview` 与每点 1 请求关联；preview slug 为 `unknown`，不是通过请求 ID 的直接归因。[Cloudflare 官方限制说明](https://developers.cloudflare.com/workers/platform/limits/)称偶发超限有弹性，但持续超限会终止，HTTP 200 不能保证长期可用。
- Cloudflare 拒绝 600,000 次派生；现有远端用户数为 0。若其他环境已有 600,000 次哈希，Cloudflare 不能直接验证，需要可信旧环境迁移或邮箱重置，不能自动降级。测试未绑定 D1 或 Secrets，也未切换生产流量；不得擅自开通付费服务。
- 测试 Preview 已清理。当前后端版本为 `113914f4-9008-4eaf-84c0-0f063c7fef86`，先前占位版本 `bf022ec9-3143-4c4d-8770-2d621055e246` 等仍保留；后续操作前应重新查询。版本回滚不会撤销已应用的 D1 迁移，且可能恢复旧版本的 Secrets 配置，回滚前应核查。
- 本地验证：API 测试 41 项、account 测试 15 项，以及 `qa:site` 和 `qa:account` 通过。这些结果不代表全部生产功能已验证。
- 用户已明确授权使用现有 Cloudflare 免费资源部署及执行非破坏性 D1 迁移；不要重复创建数据库或 Worker。

---

## 操作说明

> 当前状态见上方快照；继续操作前重新检查远端状态。后端已经上线，官网仍在修改；生产账号流程、CPU、并发及 Gmail 真实收件仍需验证。
> 不要把密码、OAuth 授权码、refresh token 粘贴到聊天、截图、Issue 或 Git。

## 0. 先确认目标和版本

- 现有 Worker：`yukino-api`
- 现有地址：<https://yukino-api.fqxxzyw.workers.dev>
- 发件邮箱：`fqxxzyw@gmail.com`（只作为发件人；注册用户可用自己的任意邮箱）
- 仓库：<https://github.com/fqxxzyw/Yukino-Companion>
- 本地配置：`E:\JAVA\yukino-companion\server\wrangler.toml`
- 迁移：`E:\JAVA\yukino-companion\server\migrations\0001_init.sql`、`0002_session_persistent.sql`

**不要新建一个同名或相似 Worker 覆盖其他服务。** 先执行：

```powershell
Set-Location E:\JAVA\yukino-companion\server
npx wrangler --version
npx wrangler whoami
npx wrangler deployments list --name yukino-api
```

预期：`whoami` 显示你本人的 Cloudflare 账号；`deployments list` 显示现有 `yukino-api` 的历史部署。若账号不对，先 `npx wrangler logout` 再登录正确账号。记下当前 deployment id，回滚时使用。

## 1. 确认现有 D1

### 1.1 查看已有数据库

```powershell
Set-Location E:\JAVA\yukino-companion\server
npx wrangler d1 list
```

核对现有数据库名称和 ID：`yukino-account`、`89b0733f-f518-4557-bf69-ff254b80618b`，并与 `server/wrangler.toml` 一致；绑定名必须是 `DB`。如果列表中找不到该数据库，先检查登录账号、权限和网络，不要创建同名数据库或删除重建资源。

### 1.2 本地迁移（安全、不碰远端）

```powershell
Set-Location E:\JAVA\yukino-companion\server
npx wrangler d1 migrations apply yukino-account --local
```

预期：本地 `.wrangler/state` 下创建 D1 SQLite，迁移依次应用。排错：确认当前目录是 `server`；确认 `wrangler.toml` 的 `migrations_dir = "migrations"`。

### 1.3 远端迁移（先确认状态并备份）

`0001`、`0002` 已执行。以后如有新迁移，先检查远端迁移记录及 SQL 内容，备份并确认属于已授权的非破坏性操作；破坏性迁移仍须另行获得用户确认。不要重复执行已完成的迁移。

```powershell
Set-Location E:\JAVA\yukino-companion\server
npx wrangler d1 export yukino-account --remote --output yukino-account-backup.sql
npx wrangler d1 migrations list yukino-account --remote
npx wrangler d1 migrations apply yukino-account --remote
```

预期：备份文件生成；迁移列表显示 `0001_init`、`0002_session_persistent` 已应用。
排错：`--remote` 需要正确账号与 D1 权限；迁移失败时不要重复执行 `ALTER TABLE`，先查看 `npx wrangler d1 migrations list yukino-account --remote`。

## 2. 生成并写入 Secrets

### 2.1 生成生产密钥

当前生产密钥已配置，客户端公钥已写入并完成本机匹配验证。以下命令仅供在确认无已有密钥时使用；不要重新生成或覆盖已投入使用的签名密钥，轮换须先获得用户单独授权。不要将签名私钥写进客户端或 Git。

```powershell
Set-Location E:\JAVA\yukino-companion
npm run secrets:prod
```

脚本会写入 `server\.secrets.production.txt`（已被 git 忽略），包含：

- `ACCESS_TOKEN_SECRET`
- `OTP_SECRET`
- `SNAPSHOT_PRIVATE_JWK`
- `SNAPSHOT_PUBLIC_JWK`
- `SNAPSHOT_KEY_ID`

**不要打印到聊天。** 把文件中的值逐项写入 Workers Secrets：

```powershell
Set-Location E:\JAVA\yukino-companion\server
npx wrangler secret put ACCESS_TOKEN_SECRET
npx wrangler secret put OTP_SECRET
npx wrangler secret put SNAPSHOT_PRIVATE_JWK
npx wrangler secret put SNAPSHOT_KEY_ID
```

每次命令会提示输入值；可直接粘贴，终端不会回显。`SNAPSHOT_PUBLIC_JWK` 不是秘密：把它填入 `E:\JAVA\yukino-companion\shared\entitlement-public-key.json` 的 `publicJwk`，并把 `keyId` 填成同一个值。

完成后删除临时文件：

```powershell
Remove-Item E:\JAVA\yukino-companion\server\.secrets.production.txt
```

预期：`npx wrangler secret list` 只显示名称，不显示值。

### 2.2 Gmail OAuth（发件账号 `fqxxzyw@gmail.com`）

Gmail 官方 API + OAuth 2.0，只申请 `https://www.googleapis.com/auth/gmail.send`，不申请读取/删除邮件。

#### Google Cloud 点击路径

1. 打开 <https://console.cloud.google.com/>，右上角确认是**你自己的**项目（可新建 `yukino-companion-mail`）。
2. 左侧「API 和服务」→「库」→ 搜索 `Gmail API` → 打开 →「启用」。
3. 左侧「API 和服务」→「OAuth 同意屏幕」：
   - User Type：External（个人 Gmail 没有 Workspace Internal 选项时只能 External）。
   - 应用名称：`Yukino Companion`；支持邮箱：`fqxxzyw@gmail.com`。
   - 范围：添加 `.../auth/gmail.send`。
   - 测试用户：添加 `fqxxzyw@gmail.com`。
4. 左侧「凭据」→「创建凭据」→「OAuth 客户端 ID」：
   - 应用类型：**桌面应用**（Desktop app）。
   - 如果控制台要求填写重定向 URI，添加 `http://127.0.0.1:8765/oauth2callback`（Desktop 客户端通常允许 loopback；不允许时按控制台提示添加）。
   - 名称：`Yukino Gmail Sender`。
   - 创建后下载 JSON；其中 `client_id`、`client_secret` 填入 Secrets。
5. 保持 OAuth 同意屏幕为 **Testing** 时，Google 文档说明 refresh token 通常 **7 天后失效**；每次失效都要重新授权。要长期使用，需要把应用发布到 Production（可能触发 Google 验证）。这是**上线阻塞项**，请按你的使用范围决定；不要假装已长期可用。

#### 本机授权并写入 secret

在受信任的本机终端（不要让脚本读取无关账号）：

```powershell
Set-Location E:\JAVA\yukino-companion
$env:GMAIL_CLIENT_ID = "<OAuth 客户端 ID>"
$env:GMAIL_CLIENT_SECRET = "<OAuth 客户端密钥>"
node --use-env-proxy server/scripts/gmail-authorize.mjs
```

此命令仅让该 Node 进程使用当前 `HTTP_PROXY`、`HTTPS_PROXY` 和 `NO_PROXY` 配置，不更改系统代理，也不关闭 TLS 验证。本机 Node 24 已验证可以通过当前代理访问 Google OAuth 端点；如果之后不使用代理，可改为 `node server/scripts/gmail-authorize.mjs`。

脚本会：

- 在 `127.0.0.1:8765` 启动一次性回调；
- 打开 Google 授权页；
- 你登录 `fqxxzyw@gmail.com` 并勾选 `gmail.send`；
- 把 refresh token 写入 `server\.gmail-refresh-token.txt`（仅本机、git 忽略）。

然后：

```powershell
Set-Location E:\JAVA\yukino-companion\server
Get-Content .\.gmail-refresh-token.txt | npx wrangler secret put GMAIL_REFRESH_TOKEN
npx wrangler secret put GMAIL_CLIENT_ID
npx wrangler secret put GMAIL_CLIENT_SECRET
```

最后删除临时 token 文件：

```powershell
Remove-Item E:\JAVA\yukino-companion\server\.gmail-refresh-token.txt
```

本次本人授权及三项 Gmail Secret 的配置已完成；两封独立模板测试邮件已被 Gmail 接受，本人已确认收件；部署后通过账号接口发送仍待验证。以上步骤可供将来重新授权时参考。若授权页提示“应用未验证”，在 Testing 模式下使用已添加的测试账号；不要把测试授权说成永久可用。

## 3. 部署 Worker 与官网

当前只发布后端。若需要更新后端且官网仍未完成，使用 `npx wrangler deploy --config wrangler.backend.toml`；该配置不上传静态资源，非 API 请求仍返回占位内容。`server/wrangler.toml` 保留完整网站与 API 配置，只有在用户要求发布前端、确认文件和部署前检查后才使用它。两种方式都会更新同一个 `yukino-api`，先核对当前版本、绑定、Secrets 和回滚影响。

`server/wrangler.toml` 已配置：

```toml
[assets]
directory = "../website"
binding = "ASSETS"
not_found_handling = "none"
```

Worker 先处理 `/api/*`；静态资源未命中时进入 Worker，Worker 只对 HTML 导航深链接回退 `index.html`，未知 API 保持 JSON 404。

部署前先做一次不发布检查：

```powershell
Set-Location E:\JAVA\yukino-companion\server
npx wrangler deploy --dry-run
```

预期：显示将要上传的 `website` 静态文件和 `src/worker.js`。当前配置使用 `not_found_handling = "none"`，并通过 `run_worker_first` 将 `/api` 和 `/api/*` 交给 Worker；未知 API 返回 JSON 404，HTML 深链接由 Worker 回退 `index.html`。静态资源的安全响应头由 `website/_headers` 设置。部署后逐项验证。

完成上方 PBKDF2 真实请求 CPU 与并发验证及其他部署前检查后，使用已授权的现有 Worker 部署：

```powershell
Set-Location E:\JAVA\yukino-companion\server
npx wrangler deploy
```

预期输出包含 Worker URL `https://yukino-api.fqxxzyw.workers.dev` 和 Static Assets 上传数量。

## 4. 部署后验证

```powershell
curl.exe -i https://yukino-api.fqxxzyw.workers.dev/api/v1/health
curl.exe -i https://yukino-api.fqxxzyw.workers.dev/
curl.exe -i https://yukino-api.fqxxzyw.workers.dev/login
curl.exe -i https://yukino-api.fqxxzyw.workers.dev/register
curl.exe -i https://yukino-api.fqxxzyw.workers.dev/account
curl.exe -i https://yukino-api.fqxxzyw.workers.dev/api/v1/does-not-exist
```

逐项确认：

- 健康检查：200，JSON 含 `database:"ok"`、`mail:"configured"`，不含任何 secret。
- `/login`、`/register`、`/account`：200 HTML；直接刷新深链接仍正常。
- 未知 API：`404` + `application/json`，不是 SPA HTML。
- 响应头：`cache-control: no-store`（API）；`x-frame-options: DENY`；`x-content-type-options: nosniff`。
- 安全头：`content-security-policy` 存在；不加载 Google Fonts 或境外图标 CDN。

### 真实注册/登录

1. 打开 <https://yukino-api.fqxxzyw.workers.dev/register>。
2. 输入你自己的收件邮箱（可以是任意邮箱，不要求 Gmail）。
3. 点击“发送验证码”，检查收件箱与垃圾邮件。
4. 输入验证码和至少 15 字符密码，注册后应自动进入账号中心。
5. 查看账号中心：确认登录天数、好感度、皮肤条件、设备会话。
6. 修改密码：确认其他设备会话被撤销、收到安全通知邮件。
7. 退出后尝试“忘记密码”完整流程。

排错：

- 验证码未收到：查看 `wrangler tail yukino-api`；确认 Gmail OAuth 是否过期（Testing 模式 7 天）；确认 `MailProvider` 为 `gmail`；检查 Google 账号发信限制。
- 502/500：`wrangler tail` 查看异常；不要把用户密码/验证码贴进日志；确认 D1 迁移已完成。
- 429：检查 IP/邮箱限流；确认不是反复重发。
- 登录后刷新失败：检查 `ACCESS_TOKEN_SECRET`、系统时间、Worker 版本；桌面端应进入离线状态而不是清空数据。

### 桌面端连接生产 API

默认地址已经是 `https://yukino-api.fqxxzyw.workers.dev`。如果使用自定义域名或其他地址，可在**正式安装**的 userData 目录创建：

`%APPDATA%\Yukino Companion\account\config.json`

```json
{"apiBase": "https://你的-账号服务地址"}
```

或在启动进程时设置环境变量 `YUKINO_API_BASE`。不要关闭 TLS 校验，也不要把地址写死到渲染进程或网页 bundle。

## 5. 回滚

### Worker / 静态资源

```powershell
Set-Location E:\JAVA\yukino-companion\server
npx wrangler deployments list --name yukino-api
npx wrangler rollback <上一个-deployment-id>
```

或重新部署上一个已确认的版本。回滚会同时回滚 Worker 与 Static Assets，也可能恢复该版本对应的 Secrets 配置；回滚前后均应检查 Secret 名称和服务配置，不输出 Secret 值。Gmail Secret 修改前的占位版本没有这三项 Gmail Secret。

### D1

- 迁移是**前向**的。`0002_session_persistent` 只是新增列，无法“简单逆向”回滚；回滚需要用备份恢复或写补偿 SQL。
- 远端迁移前必须：`npx wrangler d1 export yukino-account --remote --output yukino-account-backup.sql`。
- 恢复方案应先经用户单独确认；不要直接覆盖生产库，也不要擅自创建、删除或重建数据库。
- `DROP TABLE`/删除账号数据属于不可逆操作，未经你确认不要执行。

### Secrets

在确认影响后可以用 `wrangler secret put` 恢复所需值；替换已投入使用的关键签名密钥须先获得用户单独确认。`SNAPSHOT_PRIVATE_JWK` 轮换需要设计旧客户端兼容方案，并同步更新 `shared/entitlement-public-key.json` 和 `SNAPSHOT_KEY_ID`；当前客户端只内置一组公钥，不能假设旧客户端可以验证新签名。

## 6. 中国大陆网络与性能

- 不保证 `workers.dev` 在中国大陆 Wi-Fi/移动网络可直连。
- 应用必须能在账号服务不可达时继续使用本地功能；不要以 Force VPN、关闭证书校验或跳过 TLS 作为运行前提。
- 请在 Wi-Fi、手机热点、移动网络分别测试首次注册、已有会话刷新、断网恢复。
- 10,000 次 PBKDF2 已经采用，低于 OWASP 建议 60 倍，密码哈希泄露后的离线猜测风险显著更高。冷认证请求 CPU 接近免费计划 10 ms 上限，并发与长期稳定性尚未验证；参见顶部快照中的探针样本、归因限制和 Cloudflare 弹性说明。未经用户同意不得开通付费服务。

## 7. 状态与操作边界

- 已对现有 D1 执行并验证 `0001`、`0002`；账号后端已部署，官网前端未发布。Gmail 三项和认证/签名四项 Secret 已配置，后续以实际查询为准。
- 未开通任何付费服务。
- 未 push GitHub、未创建 Release、未上传安装包。
- 已向本人发送两封旧版 Gmail 模板测试邮件并确认收件；一次新版线上注册验证码请求已被发信服务接受，实际收件待确认。注册完成及重置流程仍未验证。
