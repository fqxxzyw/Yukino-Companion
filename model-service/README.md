# Yukino 本地文本模型服务

独立于桌面 UI、GPT-SoVITS 和形象渲染的文本后端。默认模型为 **Qwen2.5-1.5B-Instruct + 本项目 LoRA**，同一套权重自动优先 CUDA，其次 macOS MPS，最后 CPU。没有按硬件另训两套模型。默认监听 `127.0.0.1:8765`，为桌面程序提供流式聊天接口。

## 本次训练的范围

- 20 本用户提供的 EPUB，清理后 209 个章节/文件、2,177,905 个字符、3,011 个文本块，加入人物卡后索引共 3,039 项。
- 从明确的人物介绍整理 16 个人物、113 条训练样本和 29 条验证样本，进行 3 个 epoch 的 assistant-only LoRA SFT。训练涉及人物知识、依据资料回答和资料不足时拒绝编造。
- 全文用于本地检索（RAG），**不是将全部小说逐句训练进参数**。此版本尚未完成雪乃说话风格的专项对话微调。
- 验证集包含已知事实的不同问法，不能作为陌生知识准确率。最终指标见 `reports/validation.md`；不要把小样本关键词检查当成通用能力评测。
- 小说、索引、训练数据、权重不进入 Git。代码仓库本身不含可直接回答的模型文件。

## Windows 安装与启动

需要 Python 3.11、足够磁盘和内存；首次安装和下载基础模型需要网络。命令均在 `model-service` 目录执行。

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup_windows.ps1
.\.venv\Scripts\python.exe -m yuki_model download
```

安装脚本检测 NVIDIA 驱动并安装 CUDA 版 PyTorch；计算能力 10 及以上选择 PyTorch 2.8 / CUDA 12.8，其余默认 2.6 / CUDA 12.4，可用 `-CudaBuild cu128` 显式指定（需要相应驱动）。这些 Windows 安装路径尚未进行真实显卡测试；也可以传 `-Device cpu` / `-Device cuda`。仅安装 CPU 版 PyTorch 时，即使有显卡也不能使用 CUDA；`doctor` 会分别显示驱动和运行时状态。

将私下交付的模型包按内部目录解压到 `model-service`，使以下文件存在：

```text
models/base/config.json
outputs/yukino-1.5b-knowledge-v1/adapter/adapter_model.safetensors
data/processed/knowledge.sqlite
```

可先运行 `python scripts/verify_package.py` 校验模型包，再双击 `scripts/start_windows.bat`，或运行：

```powershell
.\.venv\Scripts\python.exe -m yuki_model doctor
.\.venv\Scripts\python.exe -m yuki_model serve --config configs/serve.json
```

Linux/macOS 安装：创建 Python 3.11/3.12 venv，安装对应平台 PyTorch 2.6–2.8（本轮 CPU 路径使用 2.6），再执行 `pip install -e '.[train]'` 和上述 `python -m yuki_model` 命令。GPU 显存不足且尚未输出内容时，默认 Transformers 后端会尝试 CPU 回退；部分回答已输出后则返回错误，避免重复回答。CPU 速度取决于硬件，无法承诺实时。CUDA/MPS 的真实硬件运行仍需目标机器验证。

AMD/Intel Windows GPU 可使用具有 Vulkan 支持的 llama.cpp + GGUF；普通 PyTorch CUDA 包不会支持这些 GPU。GGUF 启动器检测实际 llama-server 可用设备，优先 offload 到 GPU，启动失败时逐步降低 offload 层数并最终尝试 CPU。它不会另外下载或训练一个不同模型。

## 从自己的 EPUB 重建

文件名使用 `[卷号]名称.epub`，例如 `[1]第一卷.epub`、`[6.5]短篇.epub`。只有自行拥有使用权限的数据才适合公开分发；本项目未公开小说内容。

```bash
python -m yuki_model prepare --input /path/to/epubs
python -m yuki_model index
python scripts/build_sft.py
python -m yuki_model download
python -m yuki_model train --config configs/train-sft.json
```

`build_sft.py` 面向这套中文 EPUB 人物介绍格式；换其他版本时应审阅生成结果，不能假定自动识别了小说对话的说话人。训练默认不覆盖非空输出目录，可用 `--output` 指定新目录或 `--resume outputs/.../checkpoint-N` 恢复。CUDA 训练可在配置中设 `quantize_4bit:true` 并安装 `.[qlora]`，CPU 不支持本项目这条 QLoRA 路径。

章节先分组再切块，减少相邻窗口跨集合泄漏；目前仅精确去重，没有消除不同译本或近似段落造成的泄漏。生产 RAG 索引含全部章节，不能用它声称无泄漏的闭卷测试结果。

## 可选：导出一个 GGUF 文件

默认交付可直接使用的 LoRA，无须用户重新训练。需要独立量化文件时，先合并相同基础模型与 LoRA，然后使用官方 llama.cpp 工具转换：

```bash
python -m yuki_model merge --adapter outputs/yukino-1.5b-knowledge-v1/adapter --output outputs/merged
python scripts/export_gguf.py --llama-cpp /path/to/llama.cpp --merged outputs/merged --quantizer /path/to/llama-quantize --output outputs/gguf
python scripts/launch_local.py --llama-server /path/to/llama-server --model outputs/gguf/yukino-q4_k_m.gguf
```

转换脚本要求自行安装 llama.cpp 转换器依赖，输出包含 llama.cpp commit 和模型 SHA256 的清单。量化可能改变回答，需要重新执行集成检查。本次默认交付与实测对象是 Transformers + LoRA；GGUF 导出及 GPU 启动器不是已经完成的硬件验证。

## 基础事实的回答方式

默认 `profile_answers:true`：对短且明确的人物身份、亲属、社团或职业问题，若检索到匹配人物卡，服务直接返回第一张人物卡原文，并标记 `answer_mode:"source_excerpt"`。这是来源摘录，不是模型闭卷生成，更不能把这类问题通过当成微调后的准确率。没有符合条件的人物卡、年份问题、分析类问题和普通闲聊仍走原有模型/资料不足路径。设为 `false` 可关闭摘录，改由训练模型生成；模型可能把正确资料改写错。

## 配置与接口

接入说明见 [docs/integration.md](docs/integration.md)。参数在 `configs/serve.json`：`device`、`cuda_index`（可选，默认选择空闲显存最多的卡）、`persona`、`top_k`、`context_tokens`、`max_new_tokens`、`threads`。人格提示词可修改，但模型不应把角色扮演内容说成原作事实。用户长期记忆由桌面端管理，并通过消息提供，本服务不上传或自动写入个人记忆。

基础模型固定为 `Qwen/Qwen2.5-1.5B-Instruct` 的 `989aa7980e4cf806f80c7fef2b1adb7bc71aa306`，以免 LoRA 加载到错误版本。基础模型许可证见其下载目录中的 LICENSE。

## 测试

```bash
pip install -e '.[test]'
python -m pytest -q
python scripts/smoke_api.py
```

单元测试使用合成内容与模拟后端，不下载权重。真实集成测试需要交付的模型与索引，验证 SSE、资料来源、生成取消及恢复空闲；结果写入 `reports/integration.json`。
