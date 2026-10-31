# 统一按钮动效与桌面伴侣样式

日期：2026-10-31。

## 设计与实现

- 主窗口的按钮、链接、折叠入口和文件选择入口使用统一的触觉反馈：鼠标悬停轻抬 1px，按下轻微压缩，松开以柔和曲线恢复。分段选择与设置导航的文字保持稳定，由背后的选中面移动。
- 「中文 / 日本語 / 双语」「本地 / API」、API 页签、设置侧栏及同组子导航使用各自隔离的 CSS anchor 选中面；位置和宽度平滑过渡。没有逐按钮注册全局事件、没有每帧 JS 布局读取、没有新增常驻动画或全局 will-change。
- CSS anchor 被 `@supports` 保护；旧浏览器保留原有明确的静态选中背景，而不是变成无选中态。当前 Electron 已实测支持。
- 动效样式为 `src/ui/control-motion.css`，主窗口和桌面 3D 共用；只更改样式及 Select 浮层的减少动态标记，不改变按钮的现有业务 handler 或 IPC。
- 桌宠气泡、桌宠 / 3D 复用的独立设置菜单，以及 3D 气泡 / 工具栏 / 输入条，统一为冷蓝主色、柔和圆角、半透明渐变、内高光和克制阴影。它们是轻玻璃视觉，不宣称真实光学折射或能采样另一个原生窗口背后的内容。
- 气泡当前语言使用浅蓝胶囊，操作按钮与菜单项提供相同 hover / press 反馈；菜单原生 select、开关、分组和数值也统一样式。输入条展开手柄和原生窗口控制不改变命中位置，禁用按钮没有 hover / press 位移。
- 不改变已验收的气泡高度预算、正文独立滚动、人物锚点、输入条位置、透明度仅作用于人物、可见气泡的边缘保护、双窗口默认间距或 HOLD 规则。

## 无障碍与主题

- 保留原有可见键盘焦点、按钮名称、pressed / selected / current 语义和键盘操作。
- 系统减少动态、应用减少动态，以及桌面伴侣关闭动画时，都取消动画和按钮位移，而不只是将动画时间设为 0。
- Select 浮层渲染在 body 下，通过 `data-reduced-motion` 显式继承应用偏好。
- 高对比度使用系统色及边框保留选中状态；减少透明度时使用不透明表面。
- 主窗口选中面继承实际强调色 / 表面变量，不锁死为蓝色；桌面 companion 延续其既有冷蓝配色。

## 可重复验收

```sh
node scripts/verify-control-motion.mjs
node scripts/verify-companion-windows.mjs
```

两个驱动均启动真正的 Electron main / preload，使用新建隔离 profile、当前源码 Vite 和真实业务 IPC，阻止外部网络。不要用普通浏览器窗口或仅有按钮组件的替身测试冒充原生窗口验收。

- 主窗口驱动逐帧采样真实 CSS 选中面的中间位置与终点，确认不是只改变一个最终颜色；操作真实语言、来源、导航、API 页签、主题、减少动态、搜索与键盘按键。检查真实独立 state.json 的最终选择，并拒绝页面上出现的应用错误。
- companion 驱动沿用之前的完整几何 / 菜单 / 持久化验收，新增桌宠与 3D 语言胶囊的真实 hover / press 及两种减少动态断言。07 校服 GLB 真实渲染；布局文本为明确的测试输入，不是 AI 生成。
- 每次在新的 `build/control-motion-*` 或 `build/companion-windows-*` 保存报告和截图，不覆盖失败证据。只退出自己启动的应用与 Vite，不清除原有用户数据。

## 回归与构建

- 8 个定向测试文件共 96 项通过；另有实际 ModelWindow 相关 6 项通过，共 **102 项，0 失败**。
- 日志：`.local-dev/control-motion-regression-final-20261031.log`、`.local-dev/control-motion-model-final-20261031.log`。
- 独立 Vite 生产构建成功：`build/control-motion-build-6gvews/`。未覆盖 dist；仍保留 >500 kB chunk 提示，未升级依赖或调整阈值隐藏它。
- 本次修改文件的语法和定向空白检查通过。没有运行全仓测试；此前暂停场景相关的旧断言问题见 `COMPANION_WINDOWS_ACCEPTANCE.md`。

## 验收中发现的额外情况

1. 首次主窗口动效日志 13 项通过，但实际查看截图时看到了 Windows `EPERM rename state.json.tmp -> state.json` 保存错误，证据 `build/control-motion-UxfC32/` 保留。该原始报告未检查应用内错误，**不能把它当作完整通过**。随后加上应用错误检查，`build/control-motion-XdZtoV/` 的 13 项复验无应用错误；目前未定位这一次保存失败的原因，不宣称修复了底层文件系统问题。最终驱动进一步要求实际选择落盘。
2. 更新样式后的 companion 运行通过前 20 项，但重启后 `firstWindow()` 可能先取到加载更快的桌宠而非主窗口，导致等待主 preload 超时，证据 `build/companion-windows-9sZQaO/` 保留。驱动改按真实主窗口 URL 选择，不改业务窗口或 preload。

本次未验证真实 AI 聊天、音频、摄像头、下载或安装器；未恢复暂停的场景开发、修材质、升级依赖、提交、推送或发布。
