# 官方 CUDA 依赖与多镜像安装路径

> 更新日期：2026-11-26（对应实现：[electron/official-runtime.cjs](../electron/official-runtime.cjs)、[electron/runtime-manager.cjs](../electron/runtime-manager.cjs)、[src/ui/SetupWizard.jsx](../src/ui/SetupWizard.jsx)）。

应用的 GGUF 本地对话与中日翻译使用 `llama-cpp-python`（Qwen 官方也记录了 `llama.cpp` / GGUF 本地部署方式，因此不另装 Transformers 版 Qwen 或重复下载模型）。

## 一、两阶段安装流程

1. **基础 Python / GPT-SoVITS 运行包（`649.8 MiB`）**
   - 优先从自有 Cloudflare R2 节点 `https://dl.yukino.fqxxzyw.cn/resources/v0.4.0-resources.1/runtime__Yukino-Runtime-0.4.0-windows-x64-cpu.zip.part001` 通过 `aria2` 8 连接断点续传下载；
   - 若 R2 不可达，自动回退至 GitHub 64 MiB 并行分卷（`v0.4.0-resource-parts.1`）→ GitHub 单文件镜像（`v0.4.0-resources.1`）→ 原始发行包（`v0.4.0-local.13`）。
   - 完整校验 SHA-256 后，解压到所选资源目录下一个独立的随机暂存目录 `<资源目录>\runtime\runtime-<UUID>`。
2. **CUDA 12.4 二进制依赖安装（仅 `cu124` / 自动检测到 NVIDIA 显卡时）**
   - 使用暂存目录内隔离的 Python 3.12（`pip --isolated --only-binary=:all:`），不修改系统全局 Python，不需要安装 CUDA Toolkit 或本地编译。
   - **支持多路线自动回退**：任一路线超时或连接失败时自动记录日志并切换下一路线；只有当前步骤全部路线均失败时才中止，且绝不会覆盖已有可用运行环境。

---

## 二、内置下载路线清单（官方源 + 国内镜像）

### 步骤 1：PyTorch CUDA 12.4（`torch==2.5.1`、`torchaudio==2.5.1`）

| 路线 ID | 类型 | 源地址 |
| --- | --- | --- |
| `pytorch-official` | 官方源 | `--index-url https://download.pytorch.org/whl/cu124` |
| `nju-mirror` | 国内镜像 | `--index-url https://mirror.nju.edu.cn/pytorch/whl/cu124 --extra-index-url https://mirror.nju.edu.cn/pypi/web/simple` |
| `aliyun-mirror` | 国内镜像 | `-f https://mirrors.aliyun.com/pytorch-wheels/cu124/ --index-url https://mirrors.aliyun.com/pypi/simple` |
| `tencent-aliyun-mirror` | 国内镜像 | `-f https://mirrors.aliyun.com/pytorch-wheels/cu124/ --index-url https://mirrors.cloud.tencent.com/pypi/simple` |
| `ustc-aliyun-mirror` | 国内镜像 | `-f https://mirrors.aliyun.com/pytorch-wheels/cu124/ --index-url https://pypi.mirrors.ustc.edu.cn/simple` |

### 步骤 2：llama.cpp CUDA 12.4（`llama-cpp-python==0.3.36`，对话与翻译）

| 路线 ID | 类型 | 源地址 |
| --- | --- | --- |
| `yukino-r2-mirror` | 国内加速镜像（R2） | `--no-index -f https://dl.yukino.fqxxzyw.cn/wheels/cu124/llama-cpp-python/index.html`（直连 `511.4 MB` 固定 SHA-256 轮子） |
| `abetlen-official` | 官方源 | `--index-url https://abetlen.github.io/llama-cpp-python/whl/cu124` |

### 路线策略（`sourceMode`）

首次配置向导与 `RuntimeManager.install(flavor, { sourceMode })` 支持三种策略：

- **`auto`（默认，智能优选）**：PyTorch 优先走官方源（其本身托管于全球 Cloudflare R2）→ 失败依次切 4 条国内镜像；`llama-cpp-python` 优先走自有 R2 镜像（避开 GitHub Releases 在国内断流）→ 失败切 `abetlen.github.io` 官方源。
- **`official`（官方源优先）**：两步均先尝试官方源，失败后自动回退至全部镜像路线。
- **`mirror`（国内镜像优先）**：两步均先尝试国内镜像 / 自有 R2，全部失败后再回退官方源。

---

## 三、日志、校验与验证边界

- 安装日志位于 `<资源目录>\runtime\official-install.log`，完整记录每步尝试的路线、命令、切源提示与输出；下载缓存与临时目录固定在 `<资源目录>\runtime\pip-cache` 与 `pip-temp`。
- 实际命中的路线 ID 与类型会写入 `python-runtime/yukino-runtime-build.json`。
- 安装完成后会实际启动暂存 Python，导入 `torch`、`torchaudio`、`llama_cpp` 并执行 CPU 张量测试；CUDA 模式额外校验 `torch.version.cuda` 与 `llama_cpp` 的 CUDA 动态库，并在有物理 NVIDIA 设备时执行 GPU 张量同步（`gpuTensor` 独立记录）。
- 若系统缺少 NVIDIA 显卡驱动（`nvcuda.dll`），会给出明确报错提示；应用不会下载未知 DLL 冒充驱动，用户仍可独立切换为 CPU 运行环境。

真实 Windows 安装验证入口：

```powershell
node scripts/verify-official-runtime.cjs --directory D:\Yukino-Runtime-QA --catalog resources/runtime-catalog.json --flavor cu124
```

### 上游官方参考

- PyTorch 2.5.1 官方安装表：<https://pytorch.org/get-started/previous-versions/#v251>
- llama-cpp-python 官方说明：<https://github.com/abetlen/llama-cpp-python#installation>
- llama-cpp-python CUDA 12.4 官方轮子目录：<https://abetlen.github.io/llama-cpp-python/whl/cu124/llama-cpp-python/>
- Qwen 官方 llama.cpp / GGUF 部署文档：<https://qwen.readthedocs.io/en/v2.5/run_locally/llama.cpp.html>
- GPT-SoVITS 官方说明：<https://github.com/RVC-Boss/GPT-SoVITS/blob/main/README.md>

## 四、CPU 环境与指令集兼容回退

「CPU 通用环境」自检若报 `0xc000001d`（`STATUS_ILLEGAL_INSTRUCTION`），说明内置 `llama.cpp` 使用了当前 CPU 不支持的指令集。客户端按以下顺序自动修复并重新自检：

1. **安装包内置 wheel（离线）**：`resources/cpu-wheels/avx2` 与 `resources/cpu-wheels/compat`，分别对应 AVX2 版和通用兼容版（无 AVX/AVX2/AVX-512）。未知电脑无需联网即可完成第一次修复。
2. **R2 镜像**：`https://dl.yukino.fqxxzyw.cn/wheels/cpu/avx2/llama-cpp-python/index.html` 与 `.../compat/...`。
3. **官方源**（仅 AVX2 路线）：`https://abetlen.github.io/llama-cpp-python/whl/cpu`。

CUDA 环境若因同一错误无法 `import llama_cpp`，也会回退到 CPU 兼容 wheel，应用仍可运行（该次会话不再启用 GPU 卸载）；`validateProbe` 通过 `cpuFallback` 标记允许这种降级。每次安装后重新自检；全部失败才提示 CPU 过旧。实现见 `electron/official-runtime.cjs`（`cpuLlamaCommands` / `installCpuLlamaCompat`）与 `electron/runtime-manager.cjs`。
