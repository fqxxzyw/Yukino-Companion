# Live2D 雪乃随包资源

这里是 Live2D 雪乃的完整本地运行资源。安装版和便携版会把整个目录放到应用的 `resources/live2d`，主窗口与桌面人物窗通过 `yukino-live2d://local/` 读取，不需要联网。

资源内容：

- `index.html`、`viewer-bridge.js`：应用内查看器与消息桥。
- `model/`：`Yukino.model3.json`、`Yukino.moc3`、纹理、物理、表情与参数显示信息。
- `runtime/`：渲染器、着色器与 Live2D Cubism Core。
- `parameters.json`：应用使用的取景与参数/表情映射。

## 覆盖资源（开发或调试）

设置了绝对路径的 `YUKINO_LIVE2D_DIR` 时，应用只使用该目录：

```powershell
$env:YUKINO_LIVE2D_DIR = 'C:\path\to\live2d'
npm run dev:desktop
```

未设置时，安装版优先使用随包的 `resources/live2d`；旧安装留下的
`%APPDATA%\yukino-companion\live2d` 只作为回退。开发模式优先使用本仓库的
`resources/live2d`。

## 许可

Live2D Cubism Core 是 Live2D Inc. 的 “Redistributable Code”，适用
[Live2D Proprietary Software License](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html)。
Cubism Web Framework 适用 Live2D Open Software License，完整说明见
`runtime/Framework-LICENSE.md`。模型素材仅用于 Yukino Companion。
