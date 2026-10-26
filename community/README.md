# Yukino 社区网页

这是独立于桌面 EXE 的静态社区前端。页面由 GitHub Pages 托管，社区文章、音色资源信息、功能建议、Bug 与评论来自本仓库的真实 GitHub Issues。

## 使用与账号

- 浏览不要求登录；页面读取公开 GitHub REST API。
- “前往 GitHub 登录并发布”会打开官方 GitHub Issue 表单，在 GitHub 登录后确认发布。评论、编辑、删除和举报也由 GitHub 完成。
- 网页不声称自己维护登录会话，不收集密码、个人访问令牌或 API Key，也没有将 Client Secret 放进前端。
- 发布后返回社区刷新。网页不创建演示文章，不将本地草稿冒充已公开的帖子。
- 本版没有网页内 OAuth 会话；若需要全程留在本站投稿，必须另行配置 OAuth 应用和服务端令牌交换。

## 数据规则

四类 Issue 表单分别使用 `[二创]`、`[音色]`、`[建议]`、`[Bug]` 标题前缀。也支持维护者添加 `community:fiction`、`community:voice`、`community:idea`、`community:bug` 标签。普通仓库 Issue 与 Pull Request 不混入社区；维护者可用 `community:hidden` 标签从社区展示中隐藏条目（原始 GitHub 内容仍然存在）。

音色资源通过作者提供的 HTTPS 链接分享。网页显示作者填写的 SHA-256、模型版本、参考声音和授权范围，但不宣称已替作者验证。较大文件放作者自己的 Release、模型托管或网盘；不会写入本仓库源码。

Markdown 使用本地安全子集，原始 HTML 按文字显示，不加载用户正文里的远程图片；链接仅接受无账号密码的 HTTPS。API 限流和断网会显示可恢复状态及 GitHub 入口。搜索范围为当前已载入内容；可以继续分页加载。

## 构建与发布

```sh
node --test community/tests/*.test.mjs
node community/build.mjs
```

输出为 `build/community`。`.github/workflows/community-pages.yml` 在相关内容推送至 `main` 后运行检查与 GitHub Pages 部署。仓库 Pages 来源需设置为 GitHub Actions。

帮助正文位于 `community/help-content.json`，格式 `{title, updatedAt, sections:[{id,title,summary,body}]}`，路由为 `#help/<id>`。桌面下载帮助深链固定为 `#help/download`。个人广告未经确认，不出现在公开帮助正文中。
