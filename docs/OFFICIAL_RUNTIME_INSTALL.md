# 官方 CUDA 依赖安装路径

应用的 GGUF 本地对话与中日翻译使用 llama-cpp-python。Qwen 官方也记录了 llama.cpp/GGUF 的本地部署方式；因此这里不另装 Transformers 版 Qwen 或同时下载第二份模型。

首次安装先把已校验的基础 Python/GPT-SoVITS 运行包解到所选资源目录下一个新的暂存子目录。检测到 NVIDIA 时，自动执行以下对应当前固定后端版本的官方二进制安装命令，不再等待本项目的 CUDA 分卷包：

```powershell
& '<资源目录>\runtime\runtime-<新ID>\python-runtime\python.exe' -X utf8 -m pip --isolated --disable-pip-version-check install --no-input --retries 3 --timeout 60 --cache-dir '<资源目录>\runtime\pip-cache' --upgrade --force-reinstall --only-binary=:all: torch==2.5.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cu124
& '<资源目录>\runtime\runtime-<新ID>\python-runtime\python.exe' -X utf8 -m pip --isolated --disable-pip-version-check install --no-input --retries 3 --timeout 60 --cache-dir '<资源目录>\runtime\pip-cache' --upgrade --force-reinstall --no-deps --only-binary=:all: llama-cpp-python==0.3.36 --index-url https://abetlen.github.io/llama-cpp-python/whl/cu124
```

安装日志为 `<资源目录>\runtime\official-install.log`，下载缓存和临时目录也位于该资源目录。失败或取消不更改已选运行环境；已下载的官方 wheel 保存在 pip 缓存中供重试。应用不修改全局 Python，也不安装 CUDA Toolkit 或编译 llama.cpp。NVIDIA 显卡仍需要系统驱动。

安装检查实际启动暂存 Python，导入 torch、torchaudio、llama_cpp 并执行 CPU 张量。CUDA 环境还要求 PyTorch 报告 CUDA 构建且存在 llama.cpp 的 CUDA 动态库。有物理 NVIDIA 设备时再执行 CUDA 张量并同步；`gpuTensor` 的真假独立记录。无显卡的 CI 可以证明下载、安装、导入与 CPU 张量成功，不能据此声称模型的 GPU 推理成功。

状态页面会重新验证依赖，不再仅因 Python 可执行文件和旧 metadata 存在就显示可用。旧资源目录中的运行包不会被当成新选择目录已经安装。

真实 Windows 安装验证入口（执行生产安装逻辑）：

```powershell
node scripts/verify-official-runtime.cjs --directory D:\Yukino-Runtime-QA --catalog build/runtime-distribution/runtime-catalog.json --flavor cu124
```

官方依据（2026-10-30 核对）：

- PyTorch 2.5.1 Windows/Linux 官方安装表：https://pytorch.org/get-started/previous-versions/#v251
- llama-cpp-python 官方安装说明：https://github.com/abetlen/llama-cpp-python#installation
- 对应版本官方 CUDA 12.4 wheel 目录：https://abetlen.github.io/llama-cpp-python/whl/cu124/llama-cpp-python/
- Qwen 官方 llama.cpp/GGUF 部署文档：https://qwen.readthedocs.io/en/v2.5/run_locally/llama.cpp.html
- GPT-SoVITS 官方安装文档：https://github.com/RVC-Boss/GPT-SoVITS/blob/main/README.md

基础包仍固定在本项目已适配的 GPT-SoVITS 版本；上述官方 PyTorch/llama.cpp 升级不等于把 GPT-SoVITS 源码切到未验证的最新版本。

Windows 实测（2026-10-30）：运行 41021263600 和诊断 41022054253 中，官方 torch/torchaudio 及 511.4 MB llama-cpp-python CUDA wheel 下载、pip 安装成功。后续导入失败；PE 导入表确认 ggml-cuda.dll 直接依赖 nvcuda.dll，而托管 runner 未安装 NVIDIA 显示驱动。至少这一必需依赖缺失，不能据此判定完整环境或实体 GPU 推理通过。应用会为缺失驱动给出明确错误；CPU 选项仍独立可用。驱动须来自 NVIDIA/设备厂商官方安装渠道，应用不会下载未知 DLL 冒充驱动。
