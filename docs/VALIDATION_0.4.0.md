# 0.4.0 验证记录 · 2026-10-25

源码已合并，完整 0.4.0 测试安装包已发布到 [v0.4.0-local.13](https://github.com/fqxxzyw/Yukino-Companion/releases/tag/v0.4.0-local.13)，构建提交 `6560be244c1f89e7c2704e05ca71b7b083e77ec3`。EXE、三个完整应用分卷、独立 LoRA/GGUF 和 CPU 公共环境均已上传，发布任务已逐项核对 GitHub 返回的大小和 SHA-256。完整发布后检查独立进行，用户验收尚未完成。

安装器 542,289 字节；三个应用分卷合计 2,541,470,451 字节，主应用不带公共环境。独立 LoRA 为 38,114,354 字节、SHA-256 `fff8bdcb2df7f0bfa1a30d2983ca1e7498f241ee978d41a206db54ba456989e5`；实际发布的 GGUF ZIP 为 964,897,463 字节、SHA-256 `1348039add1d3a2715cc81946703d4bd48f05fa7246bca0b26ea165da508a425`。全部附件记录见[发布清单](releases/v0.4.0-local.13-assets.json)。获授权的临时传输分支已在发布校验成功后删除；这不表示历史 Git 对象已清除。

按本次交付要求，主应用包含训练模型、翻译模型、默认音色及桌宠资源，Python/PyTorch/CUDA 环境独立下载，不进入主应用资源分卷。测试版完成必要完整性检查后先发布供用户验收；CPU 环境先提供，CUDA 构建和完整发布后检查不应拖住首批 EXE。没有成功生成的附件不会写成已发布。

## 已通过的检查

- Node：168 项；Python 打包/推理工具 unittest：22 项；模型服务 Python 测试：61 项。
- [Windows 源码与界面验证](https://github.com/fqxxzyw/Yukino-Companion/actions/runs/40176955172)：commit `924c35fae9b058f75a1a56d4a9abeb98d016c024` 的 `source_checks` 通过。真实 Windows Electron 主界面 27 张截图、67 项检查；桌宠 5 张截图、9 项检查，包含实际桌面窗口移动。对话、设备与资源状态使用隔离的演示夹具，没有调用真实供应商。
- 同一 Windows 任务的安装器 7 项检查通过：真实 NSIS PE 编译、中文路径离线分卷安装、未知目录保护、用户新增文件保护、损坏分卷拒绝和安全卸载。此项使用微小虚构文件，不是完整应用安装验收，测试 EXE 不发布。
- [Windows CPU 实际翻译与语音](https://github.com/fqxxzyw/Yukino-Companion/actions/runs/40176123249)：Hy-MT2 Q4 实际生成四句日文，每句约 1.06–2.14 秒。GPT-SoVITS 实际加载默认 GPT e2、SoVITS e1、BERT/HuBERT 与参考声音，合成 `こんにちは。今日は何を話しましょうか。`，输出 32 kHz、3.2 秒、204,844 字节的非静音 WAV。没有使用模拟音频。
- 上述 WAV SHA-256：`6c8bd27cb85729e9626e6a832818779b640a9f83ba2d0b19d94cc3a86c37b9ec`。Whisper small 与 medium 离线复核都识别出了问候和后半句，但对“今日は”的转写不一致，不能认定整句发音完全正确，也没有人工音质验收。

首次语音实测发现参考声音重采样缺少 `resampy`，已固定到 `0.4.3`，并在公共环境构建时实际测试重采样及日语前端，随后 Windows 全链合成通过。桌宠 QA 的 Windows 临时文件锁退出问题和安装器缺少 `7zip-bin` 也已通过真实 Windows 检查修复。

本轮发布工具、CPU-only 引导与 DLL 搜索修复后，本地 Node 172 项、Python 分发/推理工具 unittest 41 项、桌面对话 worker pytest 9 项通过，Vite 构建通过；这与上面的已完成 Windows 任务分开记录，不能视为新补丁已通过 Windows CI。

## 本地角色模型

Qwen2.5-1.5B 从已有知识 LoRA 继续进行完整人格训练：186 条训练样本、1 个 epoch、47 个优化步骤，24 条验证集 loss 从 3.63267 降至 3.24914。Q4_K_M 权重为 986,048,192 字节。训练、导出及真实离线生成在云端 Linux CPU 上完成，没有用远程对话 API 代替模型。

30 条实际请求均能返回，但出现同班关系错误、虚构剧情、未收到图片却声称收到、个别普通称赞触发身份说明等问题。后续提示词回归也保留了失败结果，当前模型仅适合试用和继续改进。loss 下降不是人格准确率。详见[完整训练及质量记录](../model-service/reports/persona-continued-validation.md)。

发布前初次本地归档的 LoRA ZIP 为 38,114,354 字节，SHA-256 `fff8bdcb2df7f0bfa1a30d2983ca1e7498f241ee978d41a206db54ba456989e5`；当时的 GGUF ZIP 为 966,193,438 字节，SHA-256 `dafe1706bd01b2fe1ac99163553bbdbacc5d4f27a0dc1c234a3925094689784f`。这是初次本地导出记录，实际发布的模型以本文开头的 CI 产物清单为准。LoRA 后经用户授权的临时分支传输，未合并进主分支。

随后在独立的 Python 3.12 环境中实际重建了发布链：安装固定依赖、编译原生量化器、加载同一 47 步适配器、合并、导出 Q4 并通过桌面 JSONL worker 离线回复。合并前后首层 q_proj 有 792,049 个元素改变，确认并非输出未经微调的基础权重。此次原生量化器导出为 986,048,160 字节，SHA-256 `d8ebc7c6b27743400b600a984736c1b9882c1b06e8d519ebd583d7f0bb858268`；它和前一量化器的文件哈希不同，最终发布必须以实际产物清单为准。基础权重使用已校验的本地快照，这次执行不涵盖 GitHub runner 全量下载。详见[重建审计](../model-service/reports/ci-rebuild-audit.json)。

## 尚未完成的验证

- [发布后独立验证任务](https://github.com/fqxxzyw/Yukino-Companion/actions/runs/40181796509)继续检查完整安装后的 Windows 本地角色推理、翻译和合成；本记录不提前宣称该任务通过，实时结果以 Release 说明为准。新版源码检查、真实 Windows UI/桌宠及安装器基础检查已通过。
- CUDA 工具链安装与原生 wheel 编译已完成，但首次 Windows DLL 导入失败。已加入避免直接驱动链接的构建选项、逐 DLL 依赖诊断及私有 DLL 搜索路径修复，仍待新 Windows 构建验证；没有 NVIDIA 实机推理证据。首批只提供已验证的 CPU 路径，不能宣称 CUDA 可下载或已通过。
- 真实用户 API Key、不同服务商账号权限、Windows 多屏/DPI、长期运行和人工听音尚未完整验收。
- 3D/Live2D、动作、换装、口型、桌面视觉仍是后续功能，不以占位界面充数。
