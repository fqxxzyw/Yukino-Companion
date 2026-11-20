# Yukino Account API v1

Base URL（生产）：`https://yukino-api.fqxxzyw.workers.dev`
本地：`http://127.0.0.1:8787`（`npm run api:dev`）

所有接口使用 JSON；请求体上限 64 KiB。桌面端发送 `X-Client: desktop`，网页端发送 `X-Client: web`（或 body `client`）。网页端 refresh token 在 HttpOnly Cookie，桌面端在响应 JSON 中返回并由主进程安全保存。

密码规则：至少 6 个字符，并同时包含大写字母、小写字母、数字和符号；不要求 15 位。登录只校验已有密码哈希，不把新规则套用到旧账号。昵称用于展示，注册选填，邮箱仍是登录和验证码渠道。

## 约定

### 错误格式

```json
{"error":{"code":"rate_limited","message":"操作太频繁，请稍后再试。","retryAfter":42}}
```

- `message` 可直接展示；`retryAfter` 是秒数（存在时才返回）。
- 服务端错误不包含 SQL、堆栈、秘密或完整请求体。

### 状态码

| 状态 | 含义 |
| --- | --- |
| 200/201 | 成功 |
| 400 | 字段/验证码/密码格式错误 |
| 401 | 缺少/过期/被撤销的凭据；不表示本地数据失效 |
| 403 | Origin 不允许、账号不可用 |
| 404 | 资源不存在 / 未知 API |
| 409 | 邮箱已占用、刷新并发宽限 |
| 413 | 请求体过大 |
| 415 | 非 JSON |
| 429 | 限流/验证码锁定 |
| 503 | 邮件未配置、服务端配置缺失、D1 不可用 |

### 鉴权

私有接口：`Authorization: Bearer <accessToken>`。
- access token：HS256 JWT，15 分钟，`iss=yukino-api`、`aud=yukino-client`。
- 服务端校验会话未撤销、未过期、`sv` 与用户 `security_version` 一致。
- 过期 access token 只影响云操作；桌面端继续本地使用，并在后台刷新。

### Cookie / CSRF

- 网页 refresh：`yk_refresh`（HttpOnly、SameSite=Lax、生产 Secure、Path=/api/v1/auth）。
- 关闭“保持登录”时不设置 `Max-Age`，为浏览器会话 Cookie。
- 状态变更请求若带 `Origin`，必须属于 `ALLOWED_ORIGINS` 或与请求同源。
- Bearer 接口不依赖 Cookie；CORS 只回显允许来源，携带凭据时不使用 `*`。

### 幂等与重试

- 验证码 challenge、注册、签到、进度事件都有服务端唯一约束。
- `progress_events` 的 `(user_id,event_id)` 唯一；重复提交返回 `duplicate`。
- 刷新使用轮换与 45 秒并发宽限；客户端应对 `409 refresh_in_progress` 延迟 1 秒后重试，不要并行刷新。
- 网络失败、超时、429、5xx：保留本地数据；指数退避 + 抖动，不要无限重试验证码发送。
- 所有响应 `Cache-Control: no-store`（公开下载端点除外）。

## 公开接口

### `GET /api/v1/health`

```json
{"ok":true,"service":"yukino-api","database":"ok","mail":"configured","time":1794902660539}
```

不返回 secrets、绑定值、账号数量或环境信息。D1 不可用时 503。

### `GET /api/v1/public/downloads`

从 GitHub Releases 读取并筛选 Windows 安装器；缓存 15 分钟。

```json
{
  "ok": true,
  "source": "github-api",
  "updatedAt": 1794902660539,
  "releaseUrl": "https://github.com/fqxxzyw/Yukino-Companion/releases",
  "repositoryUrl": "https://github.com/fqxxzyw/Yukino-Companion",
  "authorUrl": "https://github.com/fqxxzyw",
  "latest": {
    "version": "0.4.0-test.20261110.2",
    "tag": "v0.4.0-test.20261110.2",
    "channel": "prerelease",
    "name": "Yukino Companion",
    "publishedAt": "2026-11-10T...",
    "releaseUrl": "https://github.com/fqxxzyw/Yukino-Companion/releases/tag/...",
    "asset": {
      "name": "Yukino-Companion-0.4.0-Base-Setup.exe",
      "size": 362000000,
      "url": "https://github.com/fqxxzyw/Yukino-Companion/releases/download/...",
      "contentType": "application/octet-stream",
      "platform": "windows-x64"
    },
    "systemRequirements": ["Windows 10/11 x64", "..."]
  }
}
```

- `source`：`github-api` / `cache` / `fallback`。
- GitHub 失败时使用最近有效缓存；没有缓存则 `latest:null`，只给 Releases 页面，不构造 EXE 地址。
- 只接受 `https://github.com/fqxxzyw/Yukino-Companion/releases/download/<tag>/<name>`。
- `channel=prerelease` 包括 GitHub prerelease 或 tag 含 test/beta/preview/rc 的版本。

### `GET /api/v1/public/entitlement-key`

返回当前快照验签公钥（公开，不是秘密）：

```json
{"alg":"ES256","keyId":"prod-2026-11","publicJwk":{"kty":"EC","crv":"P-256","x":"...","y":"..."}}
```

## 注册与验证码

### `POST /api/v1/auth/register/request-code`

```json
{"email":"user@example.com","client":"web"}
```

成功：

```json
{"ok":true,"challengeId":"...","expiresIn":600,"retryAfter":60,"delivery":"accepted-by-provider"}
```

- 验证码 10 分钟、重发 60 秒、最多 5 次错误。
- 新验证码使旧 challenge 失效。
- 已存在邮箱会收到“账号已存在”通知；响应仍保持统一形状。
- 邮件服务失败返回 503，不显示发送成功。
- 限流：IP 10/小时；邮箱+用途 4/小时；重发 1/60 秒；每日全局邮件预算 90。

### `POST /api/v1/auth/register`

```json
{"email":"user@example.com","password":"至少十五个字符","code":"123456","challengeId":"...","client":"desktop"}
```

- 成功 201：创建账号、初始进度、会话；`autoLogin:true`；桌面端返回 `refreshToken`；网页端设置 Cookie。
- 密码至少 6 个字符，同时包含大写、小写、数字和符号；技术上限制 512 字符，允许 Unicode 和空格。
- 昵称可省略。服务端按 NFKC、空白和大小写折叠去重，数据库有唯一索引。重复时返回 `409 nickname_unavailable`，文案为“昵称不可用，请换一个。”。
- 缺少昵称的新旧账号会获分配唯一的「旅人·…」。登录后可用 PATCH /api/v1/me 提交昵称，重复昵称返回 409。
- 并发/重复注册同一邮箱：唯一约束，最多一个成功；其他返回 400/409。
- 限流：注册 IP 10/小时。

## 登录、刷新、退出

### `POST /api/v1/auth/login`

```json
{"email":"user@example.com","password":"...","remember":true,"client":"web"}
```

```json
{
  "ok": true,
  "user": {"id":"...","email":"us***@example.com","emailHint":"user@example.com","nickname":"雪乃","createdAt":179...},
  "accessToken": "...",
  "expiresIn": 900,
  "refreshToken": "仅桌面端",
  "persistent": true,
  "sessionId": "..."
}
```

- 错误统一为 `401 invalid_credentials`，不区分邮箱不存在/密码错误。
- 未知邮箱仍执行 PBKDF2 假校验。
- `remember:false`：桌面端不落盘 refresh token；网页端使用会话 Cookie。
- 限流：IP 20/15 分钟；邮箱 10/15 分钟。

### `POST /api/v1/auth/refresh`

桌面端：`{"refreshToken":"...","client":"desktop"}`。
网页端：`{"client":"web"}` + Cookie。

- 成功轮换 refresh token，返回新 access token。
- 45 秒内旧 token 重放：`409 refresh_in_progress`，不撤销家族。
- 超过宽限重放、会话过期/撤销：`401`。
- 刷新令牌摘要只存 SHA-256。

### `POST /api/v1/auth/logout`

Bearer。撤销当前会话；网页端清除 Cookie。离线时桌面端仍清除本机凭据，界面显示远端撤销未完成。

### `POST /api/v1/auth/logout-all`

Bearer。撤销该用户全部会话。桌面端清除当前账号本机 refresh token 并回到游客。

## 当前账号与会话

### `GET /api/v1/me`

```json
{"user":{"id":"...","email":"us***@example.com","emailHint":"...","createdAt":179...,"passwordChangedAt":179...},"session":{"id":"...","client":"desktop"}}
```

### `GET /api/v1/sessions`

```json
{"sessions":[{"id":"...","client":"desktop","deviceLabel":"桌面端","createdAt":...,"lastUsedAt":...,"expiresAt":...,"revoked":false,"current":true}]}
```

最多 50 条，按最近使用排序，只包含当前用户。

### `DELETE /api/v1/sessions/:id`

撤销自己的其他会话；不能撤销当前会话（请用 logout）；他人会话返回 404。

## 密码

### `POST /api/v1/auth/password/change`

```json
{"currentPassword":"...","newPassword":"...","client":"desktop"}
```

- 需要当前密码；新密码不能与当前相同。
- 递增 `security_version`，撤销全部旧会话，并为当前设备签发新会话。
- 发送安全通知邮件；失败不回滚改密。
- 返回新 access/refresh token、`otherSessionsRevoked:true`。

### `POST /api/v1/auth/password/forgot`

```json
{"email":"user@example.com"}
```

响应与注册验证码相同形状。未知邮箱不会收到验证码，但响应不暴露是否存在。限流：IP 6/小时；邮箱 4/小时。

### `POST /api/v1/auth/password/verify-reset`

```json
{"email":"user@example.com","code":"123456","challengeId":"..."}
```

成功后返回短时、一次性 `resetToken`（10 分钟）。注册用途验证码不能用于此接口。

### `POST /api/v1/auth/password/reset`

```json
{"resetToken":"...","newPassword":"..."}
```

- 一次性；成功后撤销旧会话、安全版本递增、发送通知。
- **不会**自动登录；返回 `{"ok":true,"loginRequired":true}`。
- 旧 resetToken/其他 reset challenge 失效。

## 云端长期记忆（可选）

默认关闭。只保存文字，不保存语音、图片、附件或完整 `state.json`。D1 中为明文 UTF-8，不宣称端到端加密。

### `GET /api/v1/memory/settings`

返回 `{settings:{syncMemory:boolean,syncChat:boolean,updatedAt:number}}`。

### `PUT /api/v1/memory/settings`

```json
{"syncMemory":true,"syncChat":false}
```

### `GET /api/v1/memory`

分页列出当前账号的文字记忆摘要（每角色一条），最多 50 条；`before` 为上一页 `nextBefore`。

### `GET /api/v1/memory/:characterId`

返回 `{characterId,memory:{text,version,updatedAt,deleted}}`。只允许当前登录用户读取。

### `PUT /api/v1/memory/:characterId`

```json
{"text":"喜欢蓝色，正在学习 NLP。","baseVersion":1}
```

`baseVersion` 与云端当前版本不一致时返回 `409 memory_conflict`，并在 `error.remote` 返回云端版本，不静默覆盖。未开启 `syncMemory` 返回 `403 memory_sync_disabled`。

### `DELETE /api/v1/memory/:characterId`

软删除云端文字记忆，本地记忆不受影响。

### `GET /api/v1/memory/:characterId/chat?conversationId=&before=`

分页读取云端纯文字对话，最多 50 条。

### `POST /api/v1/memory/:characterId/chat`

```json
{"conversationId":"...","messages":[{"id":"...","role":"user","text":"你好","createdAt":179...}]}
```

一次最多 50 条，单条最多 4000 字符；只接受 `user` / `assistant` 的文字。需要先开启 `syncChat`。按 `(user_id,id)` 幂等去重。每个账号最多 2000 条，超限返回 `413 chat_quota_exceeded`，不删除本地数据。

### `DELETE /api/v1/memory/:characterId/chat`

软删除当前角色的云端文字对话；可带 `conversationId` 只删除一个会话。

所有记忆接口必须携带 Bearer access token；服务端只使用会话里的 `user.id`，不接受客户端传入的 owner id。字符角色数据按 `user_id + character_id` 隔离。

## 进度与皮肤

### `GET /api/v1/progress`

```json
{
  "affection": 37,
  "loginDays": 1,
  "businessDate": "2026-11-17",
  "checkedInToday": true,
  "rulesVersion": "2026-11-17.1",
  "skins": [{"id":"yukino-02-v1","kind":"affection","target":40,"current":37,"eligible":false,"unlocked":false,"rulesVersion":"..."}],
  "unlocks": [{"id":"...","reason":"server-confirmed","rulesVersion":"...","unlockedAt":...}],
  "entitlement": {"alg":"ES256","keyId":"...","snapshot":{...},"signature":"..."}
}
```

`entitlement` 可能为 `null`（签名未配置）；客户端应保留上次已验证的快照，而不是把进度当 0。

### `POST /api/v1/progress/check-in`

空 JSON `{}`。服务端换算 `Asia/Shanghai` 业务日；唯一约束保证同一天只计一次。返回同 `GET /progress`，额外 `{ok:true,counted:true|false,date}`。

### `POST /api/v1/progress/events`

```json
{"events":[{"eventId":"uuid-or-8-80-safe-chars","type":"message"}]}
```

- 每批最多 20 条；客户端实际每批 10 条。
- `eventId`：8–80 个 `[A-Za-z0-9_-]`。
- `type`：`message` / `pet-interaction` / `manual-voice`。
- 客户端不能提交加分数值、登录天数、用户 ID、皮肤 ID。
- 响应：

```json
{"ok":true,"outcomes":[{"eventId":"...","status":"accepted|duplicate|capped|rejected","type":"message","message":"..."}],"affection":...,"loginDays":...,"skins":[...],"entitlement":{...}}
```

- 服务端每日额度：message 8、pet-interaction 6、manual-voice 3；全局每日好感奖励 12（含签到）。
- 重复 `eventId` 返回 `duplicate`；超额返回 `capped`，不会减少已确认好感度。
- 不接收历史日期；业务日期由服务器决定。

### `GET /api/v1/skins`

返回规则版本、皮肤目录和当前签名快照：

```json
{"rulesVersion":"...","skins":[...],"entitlement":{...}}
```

## 数据表（D1）

| 表 | 作用 |
| --- | --- |
| `users` | 邮箱、密码散列、状态、安全版本、时间 |
| `sessions` | 用户、客户端、refresh 摘要、家族、轮换、有效期、撤销、persistent |
| `email_challenges` | 用途、邮箱、验证码 HMAC、过期、尝试、消费、发送状态 |
| `password_resets` | 一次性重置授权摘要 |
| `login_days` | `(user_id,business_date)` 唯一 |
| `user_progress` | 已确认好感度、规则版本、更新时间 |
| `progress_events` | 事件幂等与拒绝原因 |
| `reward_ledger` | 奖励流水、幂等键、applied 标记 |
| `skin_unlocks` | `(user_id,skin_id)` 永久权益 |
| `rate_limits` | 持久化限流窗口 |
| `mail_outbox` | 安全通知失败重试；不存 OTP |
| `audit_events` | 必要认证/奖励审计，清理策略见部署文档 |
| `app_cache` | 下载信息的最近有效缓存 |

## 客户端重试建议

1. 网络错误/超时：标记离线，保留本地数据；指数退避（30s 起，最大 5 分钟，加抖动）。
2. 429：读取 `retryAfter`，禁用发送按钮；不要自动狂重试。
3. 401：先单飞刷新一次；刷新明确 401 才进入 `reauth-required`，不删除本地档案。
4. 409 `refresh_in_progress`：延迟 1 秒重试；不要让多个标签同时刷新。
5. 5xx：按离线处理；恢复后重试待同步队列。
6. 事件提交：以响应 `outcomes` 移除队列，不要凭本地“已发送”标记删除。

## 自定义角色文字备份

登录后，`GET /api/v1/characters` 读取当前账号的文字备份。`PUT /api/v1/characters/<id>` 接受 `name` 和 `persona` 两个字段，按账号和角色编号更新。新建角色会备份名字和文字设定，角色管理页可重新备份或恢复本机缺少的角色。模型、密钥和本机资源路径保存在本地。
