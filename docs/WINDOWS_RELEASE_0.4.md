# Windows 0.4.0 打包与发布

## 资源布局

| 应用安装目录中的资源 | 构建输入 | 用途 |
| --- | --- | --- |
| `resources/app.asar` | `dist/`、`electron/`、`characters/` | 界面、完整角色规范、完整桌宠及 2,391 段语音 |
| `resources/local-model/yukino-1.5b-persona-q4/` | 同名 `resources/local-model/` | 实际训练后合并量化的角色 GGUF 和 manifest |
| `resources/translation-models/hy-mt2-1.8b-q4/` | `translation/models/` | 固定 Hy-MT2 Q4_K_M 及许可 |
| `resources/voice-models/` | `build/bundled-voice/` | 默认 GPT/SoVITS 权重、参考 WAV、预设清单 |
| `resources/local-chat/desktop_worker.py` | `model-service/desktop_worker.py` | 本地对话 JSONL 子进程 |
| `resources/inference/`、`resources/translation/` | 对应源码目录 | 合成／翻译 JSONL 子进程 |
| `resources/runtime-catalog.json` | 合并 CPU、CUDA 清单 | 首次引导下载公共环境 |

主包不包含 `python-runtime/` 或 `inference-engine/`。这两个目录组成独立运行环境 ZIP64，按 flavor 发布并由首次引导校验安装。Python 库自带的 `.onnx`、`.pt` 等资源保留；应用模型权重不复制到运行环境。

## 模型来源与失败条件

模型任务默认从目标 Release 下载 `Yukino-Local-1.5B-Persona-0.4.0.zip`。如果尚未上传真实模型附件，任务明确失败并阻止完整主应用发布；独立的源码、界面和运行环境检查仍可继续。不会自动把模型分片提交到 Git 仓库或创建传输分支。

可通过 workflow `local_model_url` 或仓库 secret/variable `YUKINO_LOCAL_MODEL_ARCHIVE_URL` 覆盖为已完成的 GGUF ZIP。ZIP 根目录或单一目录中必须有 `manifest.json` 和权重。manifest 包含 `name`、`file`、`bytes`、`sha256`、`training`（必须记录 `completed: true`），导入时验证实际 GGUF 文件头、长度与哈希。URL不写入产物或普通日志。

模型 job 将校验后的 GGUF ZIP 上传为 Actions artifact；Windows job 验证导入后再打包。任一真实模型缺失、校验失败或训练未完成都会阻止发布，不生成占位权重。

## GitHub 单文件限制与安装器

翻译约 1.13 GB，加上角色 Q4、默认音色约 240 MB、桌宠语音约 81 MB 和 Electron，不能依赖压缩后恰好低于单资产限制。统一使用完整 `win-unpacked` 的 ZIP64，并分成不超过 **900 MiB** 的连续分卷。使用 ZIP64 避免完整压缩包大于 4 GiB 时的经典 ZIP 限制。

NSIS 生成的小 EXE 内嵌应用清单、PowerShell 安装脚本和 7za。它优先校验同目录分卷，缺少时才下载；显示下载／组合进度和校验／解压状态，并支持取消。逐卷和完整 ZIP 哈希通过后才解压到暂存目录，最后安装。下载缓存与安装目标磁盘分别检查空间，考虑分卷、组合 ZIP 和解压文件同时存在。

安装目录必须为空，或包含本安装器的 appId 标记、EXE、app.asar 和完整文件清单；遇到用户额外保存的文件将拒绝覆盖并要求选择新空目录。卸载按记录清单删除，只删除空目录，保留额外文件与用户数据。0.3 安装目录没有新标记，建议安装到新目录后通过旧卸载器移除旧版。

## 本地构建顺序

在 Windows x64 / Python 3.12 / Node 24 环境准备 NSIS 3.11：

```powershell
npm ci
python scripts/build_windows_runtime.py --flavor cpu
python scripts/package-runtime.py --flavor cpu --tag v0.4.0-local.1
# CUDA 在独立干净构建目录准备，再收集对应 catalog 和分卷。
python scripts/package-runtime.py --merge cpu/runtime-catalog-cpu.json cuda/runtime-catalog-cu124.json --output build/runtime-distribution
python scripts/prepare-local-model.py --archive Yukino-Local-1.5B-Persona-0.4.0.zip
npm run prepare:translation
npm run prepare:voice
npm run dist:win
npm run verify:characters
npm run verify:offline
python scripts/package-app-payload.py --tag v0.4.0-local.1
npm run package:bootstrap
node scripts/verify-release-assets.cjs
```

`npm run dist:win` 生成完整应用目录，后两步生成分卷和 EXE；不能只上传目录构建的中间结果。保留 `yauzl` 依赖用于应用内运行环境 ZIP64 流式解压。

## 工作流与验证

`.github/workflows/windows.yml` 仅在手动确认或 `release/0.4.0-local` 分支 push 时发布。metadata、实际模型导入及 CPU/CUDA 运行环境矩阵完成后进入 Windows 打包。安装前基础资源／哈希检查通过即可先上传 EXE、主包分卷、环境分卷、独立 GGUF 模型包和校验清单，并标记未完成验证。

上传后执行 `npm test`、Python unittest、模型 worker pytest、`qa:ui`、`qa:pet`、安装器本地分卷安装、运行环境重构、真实本地角色加载／生成、CPU 翻译及 `scripts/smoke_bundled_voice.py --download-core`。任何失败保留 prerelease 并明确标为未通过；通过才更新验证说明。CUDA 只有无 GPU 的构建/导入检查，不写成实际显卡推理验收。

模型质量仍需查看训练报告和真实回复，合成音质仍需人工听校。工作流截图、有效 WAV 或 loss 下降均不能单独证明人格、翻译或音质完美。

`build-release-local-model.py` 保留为维护者本地转换工具，只读取已获授权的本地适配器分卷，固定基础模型和量化工具版本；当前发布工作流不自动执行传输分支方案。独立 LoRA 附件通过已授权 Release 上传渠道另行提供。

独立 `source_checks` 任务还会用很小的虚构文件编译真实 NSIS EXE，检查中文安装路径、离线分卷校验、未知目录保护和卸载保留用户文件。该测试安装器及假模型在测试后删除，绝不作为发布附件。
