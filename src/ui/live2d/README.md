# Windows 本地 Live2D 雪乃

Live2D 在 Windows 桌面版中可选。模型和 Cubism Core 不随应用发布，也不需要放进仓库。在取得合适的 Cubism 授权和源模型后，用已有的 `dist/live2d` 查看器生成本机资源目录：

```powershell
$source = 'C:\path\to\YukinoPet\dist\live2d'
$target = Join-Path $env:LOCALAPPDATA 'Yukino-Live2D'
node src/ui/live2d/prepare-viewer.mjs $source $target
$env:YUKINO_LIVE2D_DIR = $target
npm run dev:desktop
```

安装版也读取 `YUKINO_LIVE2D_DIR`；从设有该变量的 PowerShell 启动已安装的应用，或将生成目录放在该安装版的 Electron 用户数据目录下并命名为 `live2d`。资源目录应包含 `index.html`、`viewer-bridge.js`、`parameters.json`、`model/` 和 `runtime/`。不要把资源放到本项目的 `public/` 或 `dist/` 下。

在聊天页面的「人物场景选项 → 雪乃形象」选择「Live2D 雪乃」。桌面人物窗使用同一设置。切回「3D 服装」会继续使用之前选中的服装。
