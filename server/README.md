# Yukino account API

Cloudflare Workers + D1 兼容的账号后端，同时托管 `../website` 的静态资源。没有引入 Hono 等额外运行时依赖：路由、鉴权、密码散列、验证码、邮件、D1 访问均在 `src/` 内实现。

## 目录

```text
server/
  src/
    worker.js       Worker 入口：/api/* + Static Assets + Cron
    app.js          路由、CORS、Origin、安全头
    auth.js         注册/登录/刷新/退出/改密/找回
    session.js      短期 JWT、refresh 轮换、会话撤销
    password.js     PBKDF2-SHA256（10,000 次，Cloudflare Free CPU 折衷）
    progress.js     签到、事件、奖励流水、皮肤
    entitlement.js  ECDSA P-256 快照签名
    mail.js         MailProvider：Gmail / 本地测试 / 未配置
    downloads.js    GitHub Releases 安装器筛选与缓存
    db.js           D1 helpers、持久化限流
    validation.js / util.js
  migrations/
    0001_init.sql
    0002_session_persistent.sql
    0003_nickname.sql
    0004_cloud_memory.sql
  dev/
    node-d1.mjs     Node 24 node:sqlite → D1 适配器（仅本地/测试）
  scripts/
    dev-server.mjs        本地 API + SQLite + 测试收件箱 + 官网
    generate-secrets.mjs  本地/生产密钥生成
    gmail-authorize.mjs   本机 Gmail OAuth 授权
  test/                    Node test（内存 SQLite）
  wrangler.toml
  .dev.vars.example
```

## 本地开发

需要 Node.js 24+（`node:sqlite`）。本目录的 `wrangler.toml` 是**生产**配置；本地请用 `npm run api:dev`，不要直接把 `wrangler dev` 当成生产变量环境。

在仓库根目录：

```powershell
npm run api:secrets   # 首次生成 server/.dev.vars（git 忽略）
npm run api:dev       # http://127.0.0.1:8787 + /dev/mailbox
npm run api:test      # 后端测试
```

- 本地测试邮箱：<http://127.0.0.1:8787/dev/mailbox>。只绑定 loopback，不发送真实邮件，不代表生产送达。
- 本地数据库：`server/.data/dev.db`；`npm run api:dev:reset` 清空。
- `server/.dev.vars`、`.data/`、`.local-mailbox/`、`.secrets.production.txt`、`.gmail-refresh-token.txt` 均被忽略。
- 生产环境（`APP_ENV` 不是 `local`/`test`）拒绝本地/模拟发件器。

## 迁移

```powershell
Set-Location server
npx wrangler d1 migrations apply yukino-account --local
```

远端迁移是生产操作，先看 `docs/DEPLOY_CLOUDFLARE.md`，未经确认不要执行。

## 测试覆盖

`server/test/*.test.mjs` 覆盖：

- 注册验证码、验证码错用/过期/重发/尝试次数、重复/并发注册。
- 登录错误统一、刷新轮换、并发宽限、复用检测、Web Cookie、桌面 refresh token。
- 改密撤销旧会话/旧 access token、找回密码一次性 token、无自动登录。
- 会话列表与越权撤销。
- 每日签到唯一、上海业务日、并发签到。
- 事件幂等、类型/全局额度、伪造字段、未知类型。
- 皮肤永久解锁、ECDSA 快照验签/篡改拒绝。
- CORS/Origin、SQL 注入形状、请求大小、no-store/安全头、生产拒绝本地发件器。
- GitHub 安装器筛选、测试版标记、缓存/回退。

## 安全提醒

- PBKDF2 使用 10,000 次迭代以适配 Cloudflare Free CPU 预算；这低于 OWASP 建议，弱化离线猜测防护，属于已知安全边界。
- `SNAPSHOT_PRIVATE_JWK` 只放 Workers Secrets；公钥写入 `shared/entitlement-public-key.json`。
- 不要在日志、Issue、截图或聊天中输出 OTP、refresh token、OAuth secret。
- 生产 `ALLOWED_ORIGINS` 不能是 `*`。

## 文档

- `docs/API.md`
- `docs/DEPLOY_CLOUDFLARE.md`
- `docs/DEPLOYMENT_HANDOFF.md`
- `docs/OFFLINE_AND_PROGRESS.md`
- `docs/SECURITY.md`
