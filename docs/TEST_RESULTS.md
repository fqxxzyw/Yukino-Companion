# 本地测试结果（2026-11-18）

环境：Windows 11，Node 24.18，Electron 45，Vite 8；本地 API 使用 Node `node:sqlite`，未连接生产 D1、未发送真实邮件。

## 通过

| 命令 | 结果 |
| --- | --- |
| `npm run api:test` | 41 passed / 0 failed |
| `npm run test:account` | 15 passed / 0 failed |
| `npm run qa:account` | PASS：登录门、跳过、离线错误、自动登录、账号中心、会话列表 |
| `npm run qa:site` | PASS：真实下载链接、注册+自动登录、重置密码、登录、深链接、移动端导航 |
| 官网视觉与交互回归 | PASS：恢复原首页壁纸；形象/服装区在场景之前；场景改为白色版面，5 个主场景从早晨→正午→傍晚一次过渡后停住；全部 10 个场景缩略图可切换；教室场景为 360° 旋转 WebP；衣橱点击联动、360° 人物旋转、原始/赛璐璐切换、关闭窗口后人物留在原位均可用 |
| `npx vite build` | 成功（仅有既有的大 chunk 警告） |
| 桌面 AccountStore 连接本地 API 的手工端到端 | 注册、事件同步、ECDSA 快照验签、游客/账号切换、在线退出均成功 |
| `npm start` Electron 冒烟 | 主进程启动，`account.json` 初始化到开发 userData；无账号初始化异常。应用更新检查因本机网络超时，属于非账号路径 |

关键截图（均为本地 2026-11-18 重新生成）：

- 首页原壁纸：`build/account-review/final2-hero.png`、`final2-mobile-hero2.png`
- 形象与衣橱（已移到场景之前）：`final2-characters.png`
- 场景早晨 / 正午 / 傍晚：`final2-scene-start.png`、`final2-scene-noon.png`、`final2-scene-evening.png`
- 单场景完整构图：`scene-anim-0.png`、`scene-anim-13.png`
- 十个场景缩略图与大图：`final2-gallery.png`、`final2-thumbs.png`
- 关闭窗口演示：`site-final-close-before.png`、`site-final-close-after.png`
- 登录页：`site-final-login.png`
- 账号区/下载区：`site-final-account.png`、`site-final-download.png`
- 桌面账号门：`build/account-review/desktop-account-gate.png`、`desktop-account-center.png`、`desktop-account-guest.png`

首页已恢复用户指定的原壁纸；形象区在场景区之前。场景区使用白色版面，主场景图片按原始宽高完整显示，并在进入视口后从早晨、正午过渡到傍晚，动画结束后停住。`#scene-gallery` 收录 10 个场景，缩略图切换完整大图，教室场景使用 `classroom-orbit.webp` 展示 360° 旋转；大图可拖动查看。登录页仍为左侧冬季制服深色面板、右侧表单。

## 全量回归

命令：

```powershell
node --test --test-force-exit tests/*.test.cjs
```

结果（上次全量回归，2026-11-17；本轮未重跑）：1542 tests / 1505 passed / 24 failed / 13 skipped / 0 cancelled。

失败集中在当前工作区**本次任务之前就存在**的未提交场景、面板、设置 CSS、翻译路由和 Windows 发布脚本测试；账号相关新增测试不在失败列表中。未通过删除或放宽这些既有测试来制造“全绿”，也没有覆盖用户的未提交修改。

其中：

- `settings routes...` 仍按旧的角色子页面断言，未包含当前工作区的 `character-guide`。
- `settings CSS...` 仍期待未提交改动前的选择器。
- `chat-voice-prewarm` 测试夹具缺少当前 `main.jsx` 的 `boardContext`。
- 3 个 CharacterPanel 拖拽测试在虚拟 DOM 中报 `element.closest is not a function`。
- `tests/account-client.test.cjs` 在并发全量运行中出现过文件级失败；已修复超时用例的测试服务器生命周期（不再留下延迟写响应），单独运行 3 项通过。建议下次全量回归再确认一次。
- `tests/account-cloud-skins.test.cjs` 的 V1 云皮肤用例原先直接读取目录中的 `ready`；V2 目录把 V1 标为退役后该断言失效。测试改为在用例内把同一模型视为已就绪资产，只验证“云端已确认 + 离线缓存”的规则，不改变目录或运行时行为。

## 未验证

- 官网仍使用仓库内的程序化场景截图与真实界面截图；没有执行生产部署、GitHub push 或 Release 发布。

- 真实 Gmail 收件箱送达、OAuth Testing 7 天过期、退信/垃圾邮件归类。
- Cloudflare 生产 Worker、生产 D1 迁移、Static Assets 真实路由、Workers CPU/内存限额。
- Windows 正式安装包运行、Electron `safeStorage` 在安装版可用/不可用两条路径。
- 中国大陆 Wi-Fi/移动网络。
- 真实密码管理器、移动端浏览器、真实用户邮件客户端。
