# 桌面形象与陪伴时长

## 已实现

- 关闭主窗口默认显示选择，可记住「完全退出 / 只留人物模型位置 / 只留 Q 版桌宠 / 两者都留」。留下形象时，应用进程仍在系统托盘运行；托盘的「完全退出」结束整个应用。
- 两种独立透明窗口可同时打开，可拖动、置顶，支持左/右初始位置和 0.65–2 倍缩放。断开显示器后把窗口移回可用屏幕。
- Q 版桌宠采用用户指定的 `fqxxzyw/yukino_desktop_pet` 的真实逐帧素材，支持待机眨眼、挥手、连续点击反应、提起/落地与慢走。点击交互不调用 API；双击或右键可打开对话。
- 桌面气泡显示同一回复的中文、日文或双语。通过 `showReply({id,zh,ja})` 接收已经完成的回复；显示语言不改变语音合成目标语言。日文尚未就绪时显示状态文字，不把中文冒充日文。
- 人物模型窗口目前明确显示「3D 模型与动作正在准备」，只有位置与窗口基础设施，未声称导入了模型或完成动作。后续模型渲染器替换该窗口中的占位内容即可保留关闭策略、消息气泡和计时逻辑。
- 总使用时间包括可见主窗口或至少一个可见陪伴窗口；陪伴时间单独记录有陪伴窗口的时段。两个形象同时打开只计一次。最小化主窗且没有桌面形象时暂停，隐藏托盘本身不累计。
- 系统休眠、锁屏暂停；解除对应全部状态后恢复。单调时钟防止修改系统时间导致时长膨胀；按本机当地日期拆分跨午夜时段，正常记录每 15 秒原子落盘，退出时再保存。
- 只保存本地统计与窗口位置，不记录桌面内容、键盘、屏幕截图或上传用户活动。

## 源码与资源

素材来自：<https://github.com/fqxxzyw/yukino_desktop_pet>。
固定提交：`70269cfc0a82756d7730425a38e53233bdf90aed`。

原工程为 C# WPF。此处以 Electron 窗口重新实现基础交互，复用三张 PNG（3,507,657 字节）及 192×208 格子的动画映射，不需要 .NET 安装。此集成没有把原工程的全部功能搬过来：原独立应用的 2391 条预录语音、专注计时、开机启动和完整情绪/语录规则不在本次适配范围。API 日语合成通过 Companion 的统一 GPT-SoVITS 链路处理，避免额外预录语音叠音。

原仓库没有独立的整体开源 LICENSE；README 写明仅供个人桌面使用、角色和原作等权利归各自权利人、不得商业发布。此集成按仓库所有者本次请求使用其素材，不扩张成商业授权。已保留上游 `THIRD-PARTY-NOTICES.txt`，其中描述的 NAudio 等 DLL **未被本次 Electron 适配包包含**。

运行或前端构建前执行：

```sh
node scripts/prepare-companion-assets.cjs
```

脚本先验证本地素材；存在且哈希正确时完全离线。缺失时只下载固定提交的 PNG，校验精确字节数和 SHA-256，校验失败不替换现有文件。PNG 为可重建资源，不提交到本仓库；`electron/**/*` 的安装包文件规则会在最终打包时包含已准备素材。运行时不从网络加载形象。

## 主进程接口

```js
const { CompanionManager } = require('./companions.cjs');
const manager = new CompanionManager({
  electron: require('electron'),
  dataDir: app.getPath('userData'),
  onOpenMain: () => {},
  onQuit: () => app.quit(),
  onChange: state => win.webContents.send('companion-state', state),
  onCloseRequested: () => win.webContents.send('close-requested'),
  onError: error => report(error.message),
});
await manager.initialize();
manager.attachMainWindow(win);
```

- `getState()`：扁平 `mode/closeAction/bubbleLanguage/position/scale`，`preferences` 完整设置，`usage.totalMs/todayMs/sessionMs` 以及 `usage.companionshipMs/days` 明细、`modelReady:false`。
- `updatePrefs(patch)` / `setPreferences(patch)`：校验、应用并保存设置。
- `setMode('none'|'model'|'pet'|'both')`：保留主窗状态，仅改变桌面形象。
- `closeChoice('quit'|'none'|'model'|'pet'|'both')`：完全退出或隐藏主窗并选择留在桌面的形象。
- `showReply({id,zh,ja})` / `clearReply()`：更新或清除所有桌面气泡。
- `dispose()`：异步保存后销毁窗口/托盘/监听器，主进程退出流程应等待它完成。主进程必须先完成 renderer 中待保存的聊天/设置刷新，再正式退出。

透明窗口使用单独的最小权限 preload，只允许本窗口主 frame 的拖拽、菜单、打开主窗、有限距离漫步与点击穿透请求；无 Node、无网络、无任意路径/命令执行入口。

## 数据与异常

`companions.json` 保存显示偏好和位置；`companionship.json` 保存累计、按日使用/陪伴时长。每次写入通过同目录临时文件和重命名替换，写入串行。

陪伴历史损坏时保留原文件并报告错误，本次只在内存记录，不写回损坏历史；`usage.available:false` 和 `warning` 让设置界面可以提示恢复。设置文件损坏时采用默认设置，原文件在用户第一次主动修改设置前保留。关闭前的崩溃最多损失上次 15 秒检查点之后的时长，不把应用退出到下次启动之间计算在内。

## 验证边界

Node 测试覆盖并发形象不重复计时、休眠/锁屏、跨日、改系统时间、原子保存与重启、损坏历史、显示边界、关闭选择、完全退出及外来 IPC 拒绝。三张原素材下载后验证了全部哈希。

尚未验证真实 Windows 的透明窗口、系统托盘、任务栏和多显示器缩放；这些需最终统一 EXE 包准备好后做桌面验收。本轮没有生成或发布 EXE。
