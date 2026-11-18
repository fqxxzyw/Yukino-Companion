# Windows 本地 Live2D 雪乃

Live2D 是应用完整的一部分。模型、查看器和 Cubism Core 位于
`resources/live2d`，构建时作为 `resources/live2d` 随安装版和便携版发布；
运行时不需要下载，也不放进 `public/` 或 `dist/`。

在聊天页面的「人物场景选项 → 雪乃形象」选择「Live2D 雪乃」。桌面人物窗
使用同一设置；切回「3D 服装」会继续使用之前选中的服装。

## 资源解析顺序

1. 设置了绝对路径的 `YUKINO_LIVE2D_DIR`：只使用该目录（开发或调试覆盖）。
2. 安装版：应用自己的 `resources/live2d`。
3. 用户数据目录下的旧版 `live2d` 副本（仅为兼容以前的手工安装）。
4. 开发模式：优先使用仓库内的 `resources/live2d`，再回退用户数据目录。

如果资源缺少查看器桥、模型或 Cubism Core，应用会报告 Live2D 不可用并允许
切回 3D 服装，不会用空白窗口替代。

## 重新生成查看器

`prepare-viewer.mjs` 仍可用于从外部 `dist/live2d` 生成一份本地调试副本：

```powershell
node src/ui/live2d/prepare-viewer.mjs C:\path\to\YukinoPet\dist\live2d C:\path\to\candidate
$env:YUKINO_LIVE2D_DIR = 'C:\path\to\candidate'
npm run dev:desktop
```

确需更新随包资源时，把验证过的查看器内容同步到 `resources/live2d`，然后运行
`npm test` 和打包校验。
