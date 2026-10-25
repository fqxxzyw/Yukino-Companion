# 语音接入检查记录

日期：2026-10-25。受检代码为 PR #3 `feat/gpt-sovits-inference`，提交 `ce4249675daa4f9d6afe27be2375f995f7f3cdbc`。用户正在上传语音权重，已明确要求先不要打包。本次仅做检查、文本过滤修复和测试；不合入主分支，不构建或发布新的 EXE。

## 结论

推理接口、配置、分句、队列、停止与错误隔离的代码检查及测试可通过；还没有完成用户音色的真实发声验证。当前主分支及 `v0.2.0-persona.4` EXE 尚未合入语音 PR。不能将已有的构建成功或模拟音频测试描述成用户音色已经正常。

## 已修复的问题

1. 裸 URL 后直接跟中文句号和正文时，旧正则会把后续正文一起删掉。现在按中文句读结束 URL，保留其后的文字。
2. 流式输入中 `!` 与后续 Markdown 图片标记分批到达时，旧输出游标会提前读出叹号并漏掉图片后的字。现在等待未完成标记，同时处理未完整的 HTTP 方案，保证不同分片大小与一次性输入结果一致。

修改仅涉及 `src/speech/text.mjs` 与 `tests/speech.test.cjs`。新增回归覆盖不同流式分片、中文后缀、英文 query/fragment、中文 URL 路径、图片、普通叹号与长句边界。Node 测试 24/24 通过；Python worker 测试 5/5 通过。本地未安装此工作树的 Vite，未运行新的前端构建，也未做安装器打包。

## 已上传权重的实际检查

在 `v0.1.0-framework.1` Release 上检查到 `SoVITS_weights.zip` 与 GPT `-e1.ckpt` / `-e2.ckpt`。此记录仅检查其中 SoVITS 及 GPT e2 的结构，不把最高 epoch 自动当成最佳音质。

- ZIP 为 78,568,088 字节，SHA256 `1b4761af82ac6c383ce90983c91d2a853c4f3c8d4a3a6a3eae197823ed2072c9`；其中只有 `SoVITS_weights/雪乃_e1_s3561.pth`，大小 84,932,096 字节，没有参考音频。
- SoVITS：673 个权重张量，`enc_p.text_embedding.weight` 为 `[322,192]`，采样率配置 32,000 Hz。固定上游按 322 个文本嵌入判定为 v1，并自动更新版本/语言，不会仅因 UI 默认 v2 就必然加载失败。
- GPT e2：155,087,158 字节、295 个权重张量；embedding_dim 512、24 层、16 heads、phoneme_vocab_size 512、vocab_size 1025。文件可解析，音素容量可容纳 v1；仅凭这些信息不能证明它与 SoVITS 来自同一音色训练，也不能判断听感。
- 检查使用受限权重读取。SoVITS 内含 `utils.HParams`，检查时仅映射到不执行自定义逻辑的数据容器读取配置；没有因此绕过验证并直接执行权重携带的代码。正常推理依赖固定上游提供的相应类。

## 仍需确认的事项

- 真实试听需要 3–10 秒 WAV/FLAC、与音频一致的文字及语言，并补齐 BERT/HuBERT。上传到 Release 不会自动选中权重；当前应用按本机路径引用 `.ckpt` 和解压后的 `.pth`，公共下载目录只登记 BERT/HuBERT。
- 普通 Windows 构建采用 CPU PyTorch，有 NVIDIA 显卡也仍走 CPU。需要 GPU 时使用 CUDA 运行环境（现有手动构建选项为 cu124），或在高级设置选本机兼容的 CUDA Python。实际显卡/驱动适配仍需实测。
- 当前流程为逐句合成、播放完成后再合成下一句，没有下一句预取，句间会等待推理；未测量真实延迟。
- 后续若扩展到支持韩语的模型，Windows 缺少 `eunjeon` 依赖会使韩语文本路径尝试隐式安装并可能失败。当前实际 v1 模型及中文、日文路径不受此项影响；不要把所有模型家族与语言都标成已验证。

## 后续统一合并的注意点

与人物审阅提交 `5a5339394eb8753acfa872d80712f9d4638d2c1c` 的 `git merge-tree` 模拟发现 8 处冲突：Windows workflow、README、Electron main/preload、package.json、package-lock.json、React main、CSS。没有实际合并。

合并时必须同时保留主进程人格注入、角色文档 IPC/资源，以及语音 IPC/运行环境/播放流程；不能直接用语音分支覆盖主分支，也不能把 renderer 的旧简短 system 提示词恢复成最终人设。最终打包仍等待用户新的指令。
