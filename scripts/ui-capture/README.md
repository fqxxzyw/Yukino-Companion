# Electron 界面截图验证

在 Windows 构建机执行：

```powershell
npm ci
npm run build
npx electron scripts/capture-ui.cjs --output build/ui-review
```

脚本运行真正的 Electron 和 `dist/index.html`，并使用 `webContents.capturePage()` 保存首页、双语与日语聊天、设置、自绘下拉菜单、颜色面板、关闭选择、确认弹窗、收起侧栏与窄窗口截图。`report.json` 记录截图尺寸、SHA-256、交互检查和错误；渲染错误、非预期网络访问、布局横向溢出、弹窗裁切或交互失败会使进程以非零状态退出。每张截图还验证可见主要/次要按钮的尺寸、圆角、留白和内容裁切（含禁用按钮及导入标签），防止退回浏览器原生方框。滚动区域边缘正常的纵向遮挡不判为失败。颜色面板验证 HEX 输入、键盘滑杆与非法值回退。

`preload.cjs` 的对话、模型状态和陪伴时间均为**仅供 UI 验证的合成数据**。只使用内存状态及临时 Electron 用户目录，不读取真实密钥、对话或设置；网络请求被阻止，不下载模型，也不验证或执行真实语音/翻译推理。它不会进入生产应用的默认会话，也不包含在 `build.files` 中。

CI 应始终上传 `build/ui-review`（包括失败时已有的截图与报告），供发布前人工审阅。自动检查不能替代截图的视觉审阅。Linux 执行还需要 Electron 的系统依赖和可用的 X 显示服务，例如 `xvfb-run -a npx electron scripts/capture-ui.cjs`。
