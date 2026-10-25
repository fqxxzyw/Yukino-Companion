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
| `resources/runtime-catalog.json` | 当前真实可用的 CPU 清单 | 首次引导下载公共环境，CUDA 随后续更新提供 |

主包不包含 `python-runtime/` 或 `inference-engine/`。这两个目录组成独立运行环境 ZIP64，按 flavor 发布并由首次引导校验安装。Python 库自带的 `.onnx`、`.pt` 等资源保留；应用模型权重不复制到运行环境。

## 模型来源与失败条件

模型任务只有收到明确授权后的 `transfer_commit` 输入，才读取临时 `transfer/persona-0.4.0` 分支对应的固定提交，而非漂移的分支 HEAD。当前提交输入缺省为空，缺少输入且未提供有效模型 URL 时明确失败，不生成残缺安装包。本次唯一允许的输入为 `Yukino-Persona-LoRA-0.4.0.zip`，38,114,354 字节、73 个分片，SHA-256 `fff8bdcb2df7f0bfa1a30d2983ca1e7498f241ee978d41a206db54ba456989e5`。先校验提交、清单和逐片／整包哈希，再调用 `build-release-local-model.py` 核对训练报告、47 步和适配器哈希，固定 Qwen revision 及量化工具生成实际 GGUF。

显式提供 workflow `local_model_url` 或仓库 `YUKINO_LOCAL_MODEL_ARCHIVE_URL` 时，可导入已有的 GGUF ZIP。它必须有 `manifest.json`，包含 `name`、`file`、`bytes`、`sha256`、`training.completed: true`；导入校验真实 GGUF 文件头、大小和哈希。不会用占位权重补齐缺失资源。

模型 job 将真实 LoRA 和 GGUF ZIP 作为独立模型附件交给 Windows 发布任务。主应用、LoRA、GGUF 和公共环境附件全部上传，且 GitHub 报告的大小与 SHA-256 均和本地文件一致后，独立清理任务重新读取临时分支 HEAD；只有仍等于固定传输提交时才删除该分支引用。清理不等待用户验收或后续推理测试；清理失败不会把已完成的发布校验改写为推理失败。

公共运行环境可复用固定 run `40176955172`、commit `924c35fae9b058f75a1a56d4a9abeb98d016c024` 的成功 flavor job。复用前核对仓库、工作流、commit、job、artifact，随后逐卷与整个 ZIP 校验，并比对压缩包内的构建 `inputFingerprint`、GPT-SoVITS revision 和 llama-cpp-python 版本。验证通过后仅将下载 URL 改到新 Release；不从任意 latest 构建获取二进制。来源 job 尚未成功或附件不可用时重新构建，fingerprint 不一致时禁止直接复用。

当前 CUDA 构建已增加上游 `GGML_CUDA_NO_VMM=ON`，避免对 NVIDIA 驱动 DLL 的直接链接阻断无显卡机器上的 CPU 回退。这改变了构建指纹，因此本轮 `RUNTIME_REUSE_ENABLED=false`，两个环境都重新构建。Windows 构建用 `dumpbin /DEPENDENTS` 输出实际 DLL 依赖、拒绝残留的 `nvcuda.dll` 直接导入，并继续执行真实 Python 导入；不能把编译生成 wheel 当作运行环境验收通过。

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
# 当前测试包只登记已提供的 CPU 环境；CUDA 独立构建，不阻塞主包。
python scripts/package-runtime.py --merge build/runtime-distribution/runtime-catalog-cpu.json --output build/runtime-distribution
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

`.github/workflows/windows.yml` 仅在手动确认或 `release/0.4.0-local` 分支 push 时发布。metadata、源码及安装器基础检查、实际模型导入和 CPU 运行环境完成后进入 Windows 打包。CUDA 使用独立任务，失败或耗时不会阻塞 EXE 上传；当前清单没有伪造的 CUDA 分卷，后续小版本携带真实 CUDA 清单后才提供引导安装。安装前基础资源／哈希检查通过即可先上传 EXE、主包分卷、环境分卷、独立 GGUF 模型包和校验清单，并标记待用户验收。

上传完成后由独立 `validation` 任务下载已发布分卷并执行 `npm test`、Python unittest、模型 worker pytest、`qa:ui`、`qa:pet`、安装器本地分卷安装、运行环境重构、真实本地角色加载／生成、CPU 翻译及 `scripts/smoke_bundled_voice.py --download-core`。任何失败保留 prerelease 并明确标为未通过；通过才更新验证说明。CUDA 只有无 GPU 的构建/导入检查，不写成实际显卡推理验收。

模型质量仍需查看训练报告和真实回复，合成音质仍需人工听校。工作流截图、有效 WAV 或 loss 下降均不能单独证明人格、翻译或音质完美。

`build-release-local-model.py` 同时支持维护者对已授权本地适配器进行转换；公开 CI 只消费上述固定授权输入。

独立 `source_checks` 任务还会用很小的虚构文件编译真实 NSIS EXE，检查中文安装路径、离线分卷校验、未知目录保护和卸载保留用户文件。该测试安装器及假模型在测试后删除，绝不作为发布附件。
