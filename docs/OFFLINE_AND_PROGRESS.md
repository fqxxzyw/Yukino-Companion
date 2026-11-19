# 离线使用与进度规则

本文件描述桌面端账号、游客档案、离线状态和云端进度的实际实现边界。

## 1. 四个独立状态

桌面端不把“是否登录”当成唯一开关。账号 IPC 返回：

- `mode`：`guest` 或 `account`，表示当前本机档案。
- `status`：`guest`、`authenticated-online`、`authenticated-offline`、`reauth-required`。
- `reachable`：`true` / `false` / `null`（尚未检测）。
- `sync`：`synced`、`pending`、`waiting`（离线待同步）。

对应行为：

| 状态 | 本地功能 | 云端操作 | 本地数据 |
| --- | --- | --- | --- |
| `guest` | 全部可用 | 不调用 | 保存到原有 `userData/state.json` |
| `authenticated-online` | 全部可用 | 可用 | 保存到 `userData/profiles/<hash>/state.json` |
| `authenticated-offline` | 全部可用 | 暂不可用 | 保留；待同步事件留在本机 |
| `reauth-required` | 全部可用 | 需重新登录 | 保留；只清除不可用的 refresh token |

`navigator.onLine` 不参与账号可达性判断。只有服务器返回可解释的 401/403 才进入 `reauth-required`；超时、DNS/TLS 失败、429、5xx、刷新并发冲突都只进入/保持离线状态。

## 2. 启动流程

1. 主进程先初始化 `AccountStore`，读取 `userData/account/account.json`、加密凭据和当前档案。
2. 渲染进程调用 `load`，从当前档案读取 `state.json`，直接打开主界面。
3. 浏览器/桌面首次安装没有账号选择时显示登录门；“暂不登录，本地使用”始终可见。
4. 有 refresh token 时，1.5 秒后在后台刷新；不阻塞主界面。
5. 成功后拉取云端进度、同步待提交事件、执行当日确认。
6. 失败时按 30s → 60s → 120s → 300s 上限指数退避并加抖动；恢复后回到 5 分钟心跳。
7. 刷新请求在单个进程内单飞（single-flight），不会因多页面/多窗口重复刷新。

桌面端没有“离线若干天后必须登录”的期限。

## 3. 档案隔离

- 游客：继续使用原有 `userData\state.json`，升级时不会移动或重写；首次启用账号功能时会复制一份到 `userData\account\backups\state-guest-<时间>.json`。
- 账号：`userData\profiles\<sha256(userId) 前 24 位>\state.json`。
- 待同步事件：`userData\account\queue\<sha256(userId) 前 24 位>.json`，绑定用户 ID。
- `keys.json`、语音/翻译/资源设置仍为设备级配置，不随游客/账号切换；聊天、记忆、角色与好感度进度位于档案级 `state.json`。
- 切换账号时先 flush 当前渲染状态，再切换；`write()` 在调用时解析目标路径，避免旧档案的延迟保存写到新档案。
- 登录不会把游客数值合并到账号，也不会把账号数值写回游客；退出账号回到游客档案，不删除任一档案。

## 4. 登录天数

- 业务时区固定为 `Asia/Shanghai`，数据库时间戳统一为 UTC 毫秒。
- `login_days` 主键为 `(user_id, business_date)`；同一用户同一业务日只计一次。
- 每日确认由服务端把当前时间换算成上海自然日，客户端时间不可信。
- 在线会话刷新成功后可自动触发当日确认；离线期间不补造历史签到。
- 多设备、多窗口并发签到：唯一约束保证只有一条插入成功。
- 连续登录可以展示，但断网不会扣除已有好感度或收回皮肤。

## 5. 好感度与奖励

服务端规则在 `shared/progress-rules.mjs`：

- 初始值 35，范围 35–100。
- 每日确认 +2。
- 白名单事件：`message` 每天最多 8 次、每次 +1；`pet-interaction` 每天最多 6 次、每次 +1；`manual-voice` 每天最多 3 次、每次 +1。
- 全局每日好感度奖励上限 12（含每日确认）。
- 客户端只提交 `{eventId, type}`；**不能**提交加分数值、用户 ID、登录天数或皮肤 ID。
- `progress_events(user_id, event_id)` 唯一；重复事件返回 `duplicate`，不会重复加分。
- `reward_ledger(user_id, event_id, event_type)` 唯一；D1 batch 内完成“插入流水 → 条件更新进度 → 标记 applied”，避免“先查再加”的竞态。
- 事件类型、每日上限、最终数值都由服务器决定，规则版本写入流水和服装记录。

## 6. 服装

云端服装规则（唯一配置：`shared/outfit-rules.json`）：

| 服装 | 条件 |
| --- | --- |
| `summer-uniform-v2` | 默认开放 |
| `winter-uniform-v2` | 默认开放 |
| `swimsuit-v2` | 云端累计登录 2 天 |
| `twin-tail-v2` | 云端累计登录 3 天 |
| `beret-v2` | 好感度 45 |
| `kimono-v2` | 好感度 55 |
| `qipao-v2` | 好感度 65 |
| `ivory-coat-v2` | 好感度 75 |
| `ice-hooded-winter-v2` | 好感度 85 |

- `skin_unlocks` 以 `(user_id, skin_id)` 为主键，永久保留；不会因为短期 token 过期或断网删除。
- 服务端在进度响应中附带 ECDSA P-256 签名快照：`{v, uid, affection, loginDays, skinIds, rulesVersion, issuedAt}`。
- 桌面端只保存公钥（`shared/entitlement-public-key.json`）；本地开发从 loopback 端点读取临时公钥。签名不匹配、keyId 不匹配或用户不匹配时忽略快照，保留上一次已验证的服装列表。
- 本地已有的好评度/使用日期规则继续用于游客档案；账号档案的云端服装通过 `relationship.cloudUnlocked` 合并到服装选择，主进程 `canUseSkin` 同样检查此列表。
- “无限期离线可用”和“离线设备即时撤销”不能同时保证：服务端撤销立即作用于云端权限，离线副本只能在恢复联网后得知。客户端签名校验不是 DRM，不承诺绝对防破解。

## 7. 待同步队列

- 仅账号档案产生；游客不排队、不上报。
- 每账号独立文件，最大 40 条；同一类型在同一上海自然日只生成一个事件（避免消息刷屏）。
- 启动/心跳/手动同步时按 10 条一批提交；服务端返回 `accepted/duplicate/capped/rejected` 后，客户端才从队列移除。
- 网络失败保留队列；结果不会无限重试（已结算事件立即移除）。
- 离线分数不解锁新的云端永久服装；已确认服装继续可用。
- 账号切换后只会读取当前账号的队列，A 的待提交事件不会上传给 B。

## 8. 退出与切换

- “切换到游客档案”：保留账号 refresh token，便于切回；回到游客原有进度。
- “退出当前账号”：尝试在线撤销会话；若网络失败，仍立即清除本机 refresh token，并如实返回 `remoteRevoked:false`，不保留完整可复用凭据。
- “退出所有设备”：在线撤销全部会话；本机同样回到游客。
- 不删除聊天、模型、下载资源、本地皮肤或账号档案。

## 9. 第三方 API 与离线

- 用户自行配置的第三方 API 不受账号服务状态影响；真正断网时第三方云服务不可用，应用如实报错，不伪造响应。
- 本地模型、语音、桌宠、场景、已下载资源和本地设置继续可用。
- 账号服务不可达不会阻止关闭应用、切换角色或进入设置。

## 10. 已知边界

- 客户端上报的互动事件不是强反作弊证明；目标是防重放、防重复领取、限制异常收益。
- 离线历史签到不能凭客户端时间补造；第一版不提供任意历史日期补签。
- 本地 `state.json` 可被本机用户修改；本地皮肤资格不是云端权益。
- 远端撤销无法即时作用于长期离线设备。
- 用户已同意新密码候选采用 PBKDF2 10,000 次，仅为 OWASP 的 600,000 次建议的 1/60，哈希泄露时离线猜测风险显著更高。Cloudflare Preview 的 GraphQL Analytics 关联 CPU 样本在 10,000 次单次为 2.239、2.429 ms，双次为 6.085、4.452 ms；20,000 次双次为 7.175、9.109 ms，留给业务的余量不足。数据按同 Worker、时间、`isPreview` 和每点 1 请求关联；preview slug 为 `unknown`，不是按请求 ID 的直接归因。[Cloudflare 官方说明](https://developers.cloudflare.com/workers/platform/limits/)偶发超限有弹性，但持续超限会终止；探针成功不证明完整认证、长期或并发可靠，尚不可宣布生产兼容。Cloudflare 无法直接验证 600,000 次旧哈希，已核验的远端用户数为 0；其他环境的旧账户需可信迁移或邮箱重置。未经同意不得开通付费服务。
