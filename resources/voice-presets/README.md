# 内置参考声音

默认声音使用项目发布的 GPT e2 / SoVITS e1（v1）。大权重由 `scripts/prepare-bundled-voice.py` 按 `resources/voice-models.json` 的固定长度和 SHA256 下载、解包到构建目录，随后作为安装包资源提供。Git 中仅保留这份短参考音频及其可复查的记录，不存储全部训练权重或整份素材包。

`yukino-reference.wav` 来自用户提供的 `YUKINO.zip` 中 `YUKINO/A010ESS0_YUK039.ogg`。原始片段为 48 kHz 单声道；转换为 32 kHz / PCM16 / 单声道 WAV，约 3.083 秒，不拼接、不补静音。原素材和转换后音频的哈希、时长保存在 `yukino-default.json`。

参考原文为：

> 一つ思うところがあるのだけれど、いいかしら。

原压缩包没有字幕。本次在本机分别使用固定版本的 Whisper small 和 medium 转写，二者内容一致，仅统一汉字、假名写法和标点。`transcription-review.json` 记录两份实际结果、模型版本和信心指标。**没有把双模型一致冒称为人工听校**；同样，这份记录不构成对发音、音色相似度或原作出处的保证。默认参考可以在应用内替换，用户自选文件及原文不会被升级自动覆盖。

发布前可运行 `python scripts/smoke_bundled_voice.py --download-core`，使用完整推理组件与本组实际权重合成一段日语，输出 WAV 和校验报告。该检查验证加载与非静音 PCM 输出，不能替代主观试听。
