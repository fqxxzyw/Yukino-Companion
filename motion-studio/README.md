# 动作编辑器 · Motion Editor

在本机编辑角色骨骼和表情，实时录制，在时间线组合、剪辑和调速。工作台可从 Yukino Companion 打开，也可独立启动。

## 启动

- **Yukino Companion** 从主界面侧栏点击「动作编辑器」，打开独立的编辑窗口。
- **Windows 便携版**运行 `artifacts/MotionEditor-win/Motion Editor.exe`。保持便携版目录完整。程序会向上查找仓库中的 `public/characters`，也可用环境变量 `YUKINO_MOTION_MODELS` 指定本机模型目录。
- **浏览器版**双击 `start.cmd`，或在本目录执行以下命令，再打开 `http://127.0.0.1:5197/`。需要 Node.js 24 和支持 WebGL 2 的浏览器。

```powershell
npm ci
npm run build
npm start
```

开发时执行 `npm run dev`。重新打包 Windows 便携版执行 `npm run build:desktop`。

「文件」菜单可以新建、打开、导入和导出。拖动面板标题时，面板会连同内容一起移动。放到另一个面板上会交换位置，放到工作区边缘会停靠成整行或整列。

## 录制一个动作

1. 在属性面板的「身体姿势」图上点击关节点选中，拖动关节点粗调，或用 X、Y、Z 滑杆细调。图上的头颈、躯干、手脚轮廓会随已绑定的关节更新。也可以在三维预览开启骨架后点选关节。
2. 把播放头放到希望插入动作的位置，点「开始录制」。拖动关节或滑杆，也可以在「表情」点选双眼、左眼或右眼的睁开与闭上。每次拖动中从首次变化到末次变化的节奏会保留，松手后等待下一次操作的间隔会自动跳过。
3. 点「停止录制」。录制生成可复用的动作模块和时间线片段。选中片段，在右侧输入播放速度，例如 `0.5` 或 `2`，按 Enter 应用。
4. 点时间线播放，或拖动播放头检查单帧。可以调源入点、源出点、循环、淡入淡出和混合方式。
5. 在「文件」中保存 `.motionproject.json` 工程，或导出供独立播放器使用的 `.motion.json`。GLB/glTF 角色还可导出带烘焙动画的 `.glb`。VRM 请保留原始模型并导出动作 JSON。

录制的输入来自你在界面上操控的关节和表情。也可以逐帧制作姿势，见 [使用指南](docs/USER_GUIDE.md)。

可以打开 [校服示例工程](examples/school-wave.yukinomotion)，检查挥手、歪头、微笑和张嘴如何分轨组合。[对应的动作包](examples/school-wave.motion.json) 可直接交给独立播放器。

## 模型与后续接入

可选本机和服、泳装、季节未标注的校服及其他已核对服装，也可导入自带的 VRM 0.x、VRM 1.0、GLB 或 glTF 2.0。眼部闭合、微笑和口型取决于模型的真实通道。原内置和服只有张嘴通道，两个新交付的本地和服样例（GLB、VRM）均有双眼和左右眼的闭合通道。样例未随应用打包，使用时请手动导入。原地慢走来自校服评审 GLB。夏季校服、冬季校服和黑色旗袍缺少可确认的本地模型资源。参见 [模型适配](docs/MODEL_ADAPTER_GUIDE.md) 和 [内置资源审计](docs/ASSET_AUDIT.md)。

编辑器和独立播放器共享 `src/motion/index.ts`。后续接入时使用 `readRuntime` 解析包，再用 `evaluateProject(project, seconds)` 获得语义关节与表情数据。接收端用角色适配器应用求值结果。参考 [运行时动作包格式](docs/RUNTIME_PACKAGE_FORMAT.md) 和 [模型适配](docs/MODEL_ADAPTER_GUIDE.md)。

## 验证

```powershell
npm run typecheck
npm run lint
npm test
npm run build
node scripts/audit-assets.mjs --verify
```

本机实际验收及覆盖范围见 [测试报告](docs/TEST_REPORT.md)。
