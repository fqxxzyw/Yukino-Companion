# 账号系统安全说明

本文档描述已实现的防护、威胁边界和尚未实测/需操作的事项。不要把它理解为“绝对安全”的承诺。

## 1. 凭据保存

### 密码

- 算法：PBKDF2-HMAC-SHA256，随机 16 字节盐，32 字节派生值。
- 参数：新密码候选为 10,000 次迭代，编码为 `pbkdf2-sha256$v=1$10000$<salt>$<hash>`；经用户明确同意降低，仅为 OWASP 对 PBKDF2-SHA256 的 600,000 次建议的 1/60，哈希泄露时抵抗离线猜测的能力显著降低。
- 比较使用时序安全比较。
- 旧参数密码在成功登录后可透明升级（`needsRehash`），不会自动降低更强哈希的迭代次数。Cloudflare 运行时不能直接验证 600,000 次旧哈希，需通过可信旧环境迁移或邮箱重置；已核验的远端用户数为 0。
- 密码允许空格与 Unicode，长度 15–128 个字符；不 trim、不截断。
- 未知邮箱登录也执行同等开销的 PBKDF2 假校验，降低时序枚举。
- Cloudflare 隔离 Preview 的 GraphQL Analytics 关联 10,000 次 CPU 样本：单次 2.239、2.429 ms，连续两次 6.085、4.452 ms，低于免费计划 10 ms；20,000 次双次为 7.175、9.109 ms，业务余量不足。数据按同 Worker、时间、`isPreview` 和每点 1 请求关联；preview slug 为 `unknown`，并非请求 ID 的直接归因。[Cloudflare 官方说明](https://developers.cloudflare.com/workers/platform/limits/)称偶发超限有弹性但持续超限会终止，因此成功响应不证明完整认证、并发或长期可靠性，尚不可宣布生产兼容。未经用户单独同意不得启用付费服务。

### 桌面端

- refresh token 只在主进程内存中，以及用 Electron `safeStorage` 加密后的 `userData/account/credentials.json` 中。
- `safeStorage` 不可用时不写明文、不删除已有数据；本次会话只在内存中保持，界面提示无法恢复云端会话。
- access token 只存在主进程内存，不通过 IPC 暴露给 renderer、URL、日志或错误上报。
- “保持登录”关闭时不落盘 refresh token；重启后进入 `reauth-required`，本地档案仍可用。
- 渲染进程通过 preload 白名单 IPC 调用账号操作；`handle` 校验来源窗口与 main frame。

### 网页端

- refresh token 放 `HttpOnly`、`SameSite=Lax` Cookie；生产 `Secure`；路径限制为 `/api/v1/auth`。
- access token 只在页面内存中，不写 `localStorage`。
- “保持登录”关闭时使用浏览器会话 Cookie（不设置 `Max-Age`）。
- 状态变更接口使用 Bearer access token；Cookie 鉴权的 refresh 端点额外检查 Origin。

## 2. 会话

- access token：JWT HS256，15 分钟；校验算法、`iss`、`aud`、`exp`、`iat`、用户安全版本 `sv`。
- refresh token：48 字节 CSPRNG 随机值，数据库只存 SHA-256 摘要。
- 会话有 30 天滚动空闲期与 180 天绝对上限。
- 刷新轮换：每次刷新生成新 token 并标记旧会话 `replaced_by`。
  - 旧 token 在 45 秒宽限内重放 → `409 refresh_in_progress`（正常多标签并发不踢全部设备）。
  - 超过宽限重放 → 撤销整个会话家族。
- 修改密码/重置密码会递增 `security_version`，并撤销旧会话；旧 access token 在 15 分钟内也会因 `sv` 不匹配立即失效。
- 修改密码成功后发送安全通知邮件；通知失败不回滚改密，写入 `mail_outbox` 待重试。
- 会话列表/撤销接口校验资源归属，不能操作其他用户的会话。

## 3. 验证码

- 6 位数字由 CSPRNG 生成，拒绝取模偏差。
- 服务端只保存 `HMAC-SHA256(OTP_SECRET, challengeId:email:purpose:code)`，不保存明文验证码。
- 绑定邮箱、用途（register/reset）、challenge ID；注册码不能用于重置密码。
- 10 分钟有效；60 秒重发间隔；最多 5 次错误尝试；重发使旧 challenge 失效。
- 消费使用条件 UPDATE，保证只能成功一次；错误尝试计数原子递增。
- 限流维度：IP、邮箱+用途、重发锁、每日邮件预算、全局邮件预算。
- 邮件内容由服务端模板生成；没有用户自定义标题/收件人/正文的接口，不构成开放邮件中继。
- 发送失败会作废 challenge 并返回 503，不显示“发送成功”。
- Gmail 接受请求不等于进入收件箱；界面文案只承诺“邮件服务已接受请求”。

## 4. 网页与 API

- 所有 API 响应：`Cache-Control: no-store`（公开下载信息例外，短缓存）、`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy`、`Permissions-Policy`。
- 官网 HTML：严格 CSP，仅 `'self'` 脚本/样式/图片/连接；不使用 Google Fonts 或境外图标 CDN。
- CORS：只回显 `ALLOWED_ORIGINS` 中的来源，携带凭据时绝不使用 `*`；未知 Origin 返回 403。
- Origin 检查对所有 API 请求生效；refresh/logout 的 Cookie 请求也受保护。
- 请求体大小限制 64 KiB；JSON content-type 校验；字段类型、长度、枚举校验。
- SQL 全部参数化；D1 绑定。
- 用户 ID 只来自会话，不读取请求体中的 `user_id`。
- 服务端拒绝修改好感度、天数、皮肤、管理员字段；没有默认管理员、万能验证码或隐藏后门。
- 错误响应不返回 SQL、堆栈、环境绑定或秘密；服务端日志不记录密码、OTP、完整 token、OAuth secret 或原始敏感请求体。
- 审计记录只保存必要事件类型和截断的标识。

## 5. 下载

- 下载信息来自 GitHub Releases API。
- 只接受 `https://github.com/fqxxzyw/Yukino-Companion/releases/download/<tag>/<name>` 形式、名称匹配 Windows 安装器、大小在 0–2 GiB 的资产。
- 不向浏览器暴露 GitHub token；不代理整包。
- GitHub API 失败时使用最近一次有效缓存或退回 Releases 页面，不构造不存在的 EXE 地址。
- `prerelease` 或 tag 含 test/beta/preview/rc 的版本标记为测试版，不伪装成稳定版。

## 6. Electron 边界

- `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。
- preload 只暴露固定方法；账号相关参数在 main 进程再次校验类型和长度。
- 外部链接使用 `shell.openExternal`，账号网页只允许固定路径和 HTTPS（本机开发除外）。
- 不关闭证书校验、`webSecurity` 或 TLS 检查。
- 不把长期 token 暴露给 renderer。
- 本地账号凭据与档案文件使用原子写入；损坏的 `account.json` 会改名为 `.corrupt-<时间>` 而不是删除。

## 7. 已知残余风险

- 本地 `state.json`、GLB、语音和资源可被本机用户修改/提取；客户端校验不是不可绕过的 DRM。
- 离线设备无法即时感知远端会话撤销。
- 客户端上报的“使用事件”不能证明真实互动；只能防重放、防重复领取、限制收益。
- 恶意软件若已控制当前用户会话，可读取 Electron 解密后的凭据；`safeStorage` 依赖操作系统账户安全。
- 未验证真实 Gmail 送达、OAuth Testing 7 天过期、Cloudflare 生产运行时、Workers CPU 限额和中国大陆网络。
- 没有实现 MFA；密码仍是主要认证因素。
- 没有实现邮箱变更流程；账号邮箱不可在网页/桌面自助修改。
- 没有分布式会话黑名单缓存；每次私有请求校验 D1 中的会话与安全版本，成本换一致性。
- 公开下载缓存依赖 D1；若 D1 不可用，API 健康检查会失败，但官网静态页面仍可加载。

## 8. 安全上线检查清单

- [ ] 在 Workers 免费套餐实测真实认证请求的 PBKDF2 10,000 次迭代、ECDSA 签名及并发路径的 CPU/内存。
- [ ] 生产 D1 迁移前导出备份。
- [ ] 所有 Secrets 通过 `wrangler secret put` 写入，仓库/构建产物/日志无明文。
- [ ] Gmail OAuth 仅 `gmail.send`，发件账号正确，Testing 过期策略已知。
- [ ] 生产 `ALLOWED_ORIGINS` 精确，无 `*`。
- [ ] HTTPS 证书、HSTS（如适用）、Cookie Secure/HttpOnly/SameSite 实测。
- [ ] 真实注册、登录、刷新、改密、找回、撤销会话、离线恢复、并发签到实测。
- [ ] 中国大陆 Wi-Fi/移动网络实测；不以关闭 TLS 或强制 VPN 作为前提。
- [ ] 正式安装版验证 `safeStorage` 可用/不可用两条路径。
