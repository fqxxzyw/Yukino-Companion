# Yukino Companion 官网前端

这是确认过的 v31 官网：`/` 官网，`/community/` 社区，`/help/` 帮助，`/login` 登录和 `/register` 注册。和公开仓库的 `community/` 原始站及现有 GitHub Pages 工作流分开。

## 三条路径

- 官网注册和登录走同源 `/api/v1/auth/*`。账号使用邮箱，注册邮箱验证码，登录邮箱加密码；不走 GitHub OAuth。前端 Worker 只把允许的接口请求转给现有 `yukino-api`，保留 HttpOnly、Secure、SameSite=Lax 的会话 Cookie。用户数据库和凭据不在本仓库前端目录。
- 社区通过 GitHub API 读取本仓库公开 Issues。二创、音色、建议、反馈的正文与评论均在 GitHub 上确认提交和存储。官网邮箱账号不会被用来发帖。
- 帮助是同域静态页面，章节链接（如 `/help/#api`）直接可达。首页、社区、帮助的页首与页尾由同一份模板同步：改完首页的页首/页尾，运行 `node website/scripts/sync-site-shell.mjs`。

## 预览与部署

- 从仓库根目录运行 `python -m http.server 8899 --directory website/public` 可看静态页面；不能测试邮箱注册、登录、刷新会话或退出。
- 用 Cloudflare **官网前端** Worker 才能保留邮箱登录。检查已有 Worker 的名称、域名、routes、bindings、环境和变量，只合并 `wrangler.example.jsonc` 的入口与静态资源配置。不得把这个前端部署到账号后端 `yukino-api` 或创建/重建 D1。
- 从 `website/` 先运行 `npx wrangler deploy --dry-run --config wrangler.jsonc`（使用合并过的真实前端配置）。确认目标与差异以后再执行 `npx wrangler deploy --config wrangler.jsonc --keep-vars`。Cloudflare 发布后需验证首页、导航、登录注册页、GitHub 投稿模板、同源 `GET /api/v1/health`，以及用本人批准的邮箱实测验证码、登录保持与退出。
- GitHub Pages 纯静态托管不运行此代理，不能取代上述生产前端 Worker。
