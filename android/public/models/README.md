# 人物模型与服装

应用从本目录加载人物，不把模型路径写死在界面代码里。

已提交的是加载清单和动作包：

- `character-model.json`：安卓端使用的服装索引（含中文名称、默认服装、相机）。
- `local-yukino-outfits/catalog.json`：上游加载清单。
- `local-yukino-outfits/*.actions.json`：与各套 VRM 绑定的 `yukino.local-actions.v1` 动作包。

六套已接入 VRM（和服、夏日制服、泳装、黑色旗袍、双马尾、贝雷帽）体积较大，且已随预发行版 [yukino-models-20261114](https://github.com/fqxxzyw/Yukino-Companion/releases/tag/yukino-models-20261114) 发布，**不要提交进 Git**。打包前在 `android/` 目录运行：

```bash
npm run models
```

脚本会下载 `Yukino-3D-Models-20261114.zip`，校验压缩包及每个 VRM 的 SHA-256，并将模型放到 `local-yukino-outfits/`。缺失模型时，陪伴页会改用占位形象。

冬季制服仍是未接入的候选，口型待补，不要放进本目录或清单。
