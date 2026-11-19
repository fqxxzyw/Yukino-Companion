# 本地测试结果（2026-11-19）

环境：Windows 11，Node 24.18，Electron 45，Vite 8；本地 API 测试使用 Node `node:sqlite`，未发送真实邮件。另对生产 `yukino-api` 做了只读部署验证，未创建测试账号。

## 通过

| 命令 | 结果 |
| --- | --- |
| `npm run api:test` | 48 passed / 0 failed（含密码规则、昵称唯一、云端记忆/聊天、额度边界幂等） |
| `npm run test:account` | 16 passed / 0 failed（新增云端记忆路由与角色 ID 校验） |
| `npm run qa:account` | PASS：登录门、跳过、离线错误、自动登录、账号中心、会话列表、云端记忆面板（开关、恢复、上传、查看云端对话） |
| `npm run qa:site` | PASS：真实下载链接（0.4.2 已发布）、注册+自动登录、重置密码、登录、深链接、移动端导航 |
| `npx wrangler deploy --dry-run` | PASS：读取 542 个静态文件，Total Upload 118.46 KiB / gzip 28.30 KiB；绑定 D1 `yukino-account`、ASSETS、环境变量；未上传密钥 |
| 生产 D1 备份 + 迁移彩排 | PASS：导出生产库到 `.local-dev/db-backups/`；在副本上执行 0003/0004 后行数不变，昵称列/索引和 3 张云端记忆表存在 |
| 生产 D1 迁移 | PASS：`yukino-account` 已应用 0003/0004；迁移列表显示无待应用项，昵称唯一索引和云端表/索引均已核实 |
| 线上部署验证（2026-11-19） | PASS：最终 Worker 版本 `040637b8`；官网 `/`、`/community/`、`/help/`、`/login/`、`/register/`、`/forgot/`、`/reset/` 可打开；`/register/` 含昵称字段和四位规则提示；账号中心 CSS 200；health 200；未登录记忆接口和 `PATCH /me` 返回 401；未知 API 返回 JSON 404；移动端无横向溢出；无 JS 异常 |
| 官网视觉与交互回归 | PASS：恢复原首页壁纸；形象/服装区在场景之前；场景改为白色版面，5 个主场景从早晨→正午→傍晚一次过渡后停住；全部 10 个场景缩略图可切换；教室场景为 360° 旋转 WebP；衣橱点击联动、360° 人物旋转、原始/赛璐璐切换、关闭窗口后人物留在原位均可用 |
| `node --test tests/app-update.test.cjs` | 5 passed / 0 failed：Legacy 全量回退、原生 electron-updater 差分参数、重启安装、全量回退上报 |
| `npx vite build` | 成功（仅有既有的大 chunk 警告） |
| 桌面 AccountStore 连接本地 API 的手工端到端 | 注册、事件同步、ECDSA 快照验签、游客/账号切换、在线退出均成功 |
| `npm start` Electron 冒烟 | 主进程启动，`account.json` 初始化到开发 userData；无账号初始化异常。应用更新检查因本机网络超时，属于非账号路径 |

本轮账号与云端记忆相关验证：

- 密码规则前后端一致：最少 6 位，必须同时包含大写、小写、数字和符号；旧密码哈希仍可登录，登录成功后不会降级已有更强哈希。
- 注册必须填写昵称；NFKC、大小写和首尾/连续空格折叠后唯一；重复返回 `409 nickname_unavailable`，页面提示“昵称不可用，请换一个。”；老账号可在账号中心补填昵称。
- 官网账号中心已重做为头像/昵称/邮箱/状态、进度、皮肤、安全、昵称编辑、设备和退出分区；桌面端账号中心同步显示昵称；1440 与 390 宽度均无横向溢出。
- 云端长期记忆为默认关闭的账号功能：只同步文字，版本冲突返回 `409 memory_conflict` 并带云端版本，聊天按 `(user_id,id)` 幂等；服务端测试覆盖未开启拒绝、版本冲突、账号隔离、软删除、聊天幂等和上限。
- 桌面端新增“云端长期记忆”面板（开关、上传/恢复/查看/删除当前角色记忆、最近纯文字对话），已通过 `qa:account` 在真实 React 页面中使用确定性桌面桥完成开关、恢复、上传和查看云端对话；另通过 Vite 构建和 AccountStore 路由测试。**尚未使用真实 Electron IPC 连接生产 API 完成双设备端到端同步**。

关键截图（账号中心为 2026-11-19 重新生成）：

- 线上注册页与移动端首页：`build/account-review/live-register-20261119.png`、`live-mobile-home-20261119.png`
- 新版账号中心：`build/account-review/account-center-new-1440.png`、`account-center-new-390.png`、`site-account-1440.png`
- 桌面账号中心与响应式：`build/account-review/desktop-account-center.png`、`desktop-account-820.png`、`desktop-account-390.png`、`desktop-account-outfits.png`、`desktop-account-security.png`
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

## 0.4.3 更新验证

- 打包后的 0.4.3 主进程通过检查器把 `autoUpdater.currentVersion` 临时设为 0.4.2，再走真实 `appUpdateCheck()`，返回 `v0.4.3 / downloadable / native / differential`，证明 GitHub Release、`latest.yml` 和 electron-updater provider 可以连通。
- 使用隔离的本地更新缓存放入 0.4.2 安装器和 blockmap 后，electron-updater 已进入差分路径：读取旧块图、下载新的 `current.blockmap` 并开始从旧安装器复制/下载区块。本机代理网络在重建到约 55 MB 时长时间停滞，因此没有完成整包重建和 SHA-512 最终校验；这不是代码路径未启动。
- 0.4.3 的安装器/便携版、`latest.yml`、blockmap、SHA256SUMS 已上传并核对。

## 未验证

- 生产环境的完整注册/登录未执行：没有发送真实验证码，也没有创建测试账号；只验证了昵称必填、密码规则和假验证码被拒绝。
- 云端记忆面板只在浏览器中使用确定性桌面桥验证，未通过真实 Electron IPC 连接生产 API；两台设备之间的实际上传/恢复、生产 D1 写入和网络中断后的重试未验证。
- 检查时线上有 4 个账号，昵称列均为空；老账号补填昵称的线上流程未实际执行。
- 0.4.1 桌面端注册表单不发送昵称，新后端会拒绝旧客户端的新注册；已有账号登录不受影响。0.4.2 已包含昵称输入并已发布。
- 官网仍使用仓库内的程序化场景截图与真实界面截图。
- 真实 Gmail 收件箱送达、OAuth Testing 7 天过期、退信/垃圾邮件归类。
- Cloudflare Workers CPU/内存限额、长时间运行和并发稳定性；生产 Static Assets 已做页面/CSS 只读检查，但未做完整资源遍历。
- Windows 正式安装包运行、Electron `safeStorage` 在安装版可用/不可用两条路径。
- 中国大陆 Wi-Fi/移动网络。
- 真实密码管理器、移动端浏览器、真实用户邮件客户端。
