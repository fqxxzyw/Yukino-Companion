# 本地中日翻译与语音连接

内置模型选用腾讯官方 **Hy-MT2-1.8B-GGUF / Q4_K_M**，负责中文到日语翻译。模型不是人物对话模型，也不会替代角色设定。API 能直接返回可靠的中文、日文时优先保留它们；API 缺少日文时才调用本地翻译。显示语言与朗读语言独立：气泡可显示中文、日文或双语，语音只接收通过日文校验的内容。翻译失败、取消或内容不完整时保留中文，明确报错，不把中文当成日文送进 GPT-SoVITS。

## 固定模型与许可

| 内容 | 值 |
|---|---|
| 官方来源 | https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF |
| revision | `a0c709d9fac510f2c807aa3af52872340dc37a4a` |
| 量化 | Q4_K_M，官方提供，应用没有再次量化或微调 |
| 参数级别 | 1.8B |
| GGUF 大小 | 1,133,080,448 字节 |
| 包含 README、LICENSE 的总下载量 | 1,133,107,392 字节 |
| 权重 SHA-256 | `dc5f44fcf1fa496ee7ad725982c0c8c553a4de00259b53af84c4b89fb0c06699` |
| 许可 | Apache-2.0；保留腾讯版权说明、原始 README 与 LICENSE |
| 本地目录标识 | `hy-mt2-1.8b-q4` |

所有资源的固定 URL、长度与 SHA-256 均在 `translation/model-manifest.json`；界面目录在 `resources/translation-models.json`。模型权重被 git 忽略，不提交到源码仓库。最终 EXE 构建复制清单中的模型目录到 `extraResources/translation-models/`，不放入 asar。

曾实际试过 OPUS-MT tc-big-zh-ja 的官方现版和 M2M100-418M：前者实测译文严重跑偏，后者在专名、货币和条件语气上出现明显错误，均未列入可安装模型。官方 OPUS 相关讨论：https://huggingface.co/Helsinki-NLP/opus-mt-tc-big-zh-ja/discussions/4 。

## 运行库与资源准备

推理使用 `llama-cpp-python==0.3.36`，独立 JSONL 子进程，无本地 HTTP 监听端口，不修改 GPT-SoVITS 的 Torch/Transformers 版本。CPU 版安装官方 release 预编译 wheel；每个平台的 SHA-256 固定在 `translation/prepare_runtime.py`。它只供开发/构建使用，不在用户聊天时执行 pip。

```bash
python translation/prepare_runtime.py --flavor cpu
python translation/prepare.py
python translation/prepare.py --verify-only
python translation/smoke.py --model-dir translation/models/hy-mt2-1.8b-q4 --device cpu
```

可使用 `--python` 指向打包运行环境的 Python。`prepare.py --output PATH` 可将权重准备在自定义构建目录；中断下载保留 `.part` 并续传，完成后核验整文件 SHA-256，再原子替换正式文件。

应用内“安装翻译模型”使用 Electron 网络层，下载到用户数据目录而非 Program Files，支持进度、取消、断点续传、磁盘空间检查和 SHA-256 校验。安装完成保存返回的 `config.modelDir`。完整权重已随安装包提供时可直接离线运行。安装运行库和安装模型是不同步骤：模型下载不会凭空为任意 Python 安装运行库。

### Windows CUDA 构建

CPU 构建通过官方 Windows x64 wheel，无需在构建机安装 CUDA Toolkit。需要 GPU 版时，`prepare_runtime.py --flavor cu124` 从同一官方 release 下载并校验源码，设置 `GGML_CUDA=ON`，使用构建机现有 CUDA Toolkit 和 C++ 工具链编译。该选项不会下载未知第三方 CUDA wheel，也不会假设 CPU wheel 能调用 NVIDIA GPU。

以下命令在具备 CUDA 12.4、Visual Studio 2022 C++ 工具、CMake/Ninja 的 Windows x64 开发者终端执行；应按 NVIDIA 的 CUDA 12.4 Windows 安装文档选择兼容 MSVC 工具集，不使用跳过编译器兼容检查的参数。构建机没有 CUDA Toolkit 时应选择 CPU 版。

```powershell
nvcc --version
cmake --version
& .\build\runtime-venv\Scripts\python.exe translation\prepare_runtime.py --flavor cu124
& .\build\runtime-venv\Scripts\python.exe translation\smoke.py --model-dir translation\models\hy-mt2-1.8b-q4 --device cuda
```

worker 在 Windows 导入 llama.cpp 前，将打包 Python 的 `Lib/site-packages/torch/lib` 加入 DLL 搜索目录并保持目录句柄存活，以复用语音 CUDA Torch 自带的 cudart/cuBLAS DLL，不依赖用户的 `CUDA_PATH`。这是静态集成修复；仍需在清空 `CUDA_PATH`、没有开发工具的干净 Windows 机器上验证加载与真实翻译，才能作为 GPU 安装包发布。当前 **没有完成 Windows/CUDA 实机验证**，不能把 Linux CPU 成功当作已验证 Windows GPU 包。最终 CI 应在 CUDA 构建 job 前置官方 CUDA Toolkit 和兼容 MSVC，随后运行上面的真实模型 smoke；本轮未触发 EXE 打包。

运行时 `auto` 先检查 llama.cpp GPU 后端可用性，有则尝试 GPU layers；模型加载后还检查原生引擎日志中实际 offload 的层数，只有大于零才报告 `device=gpu`，静默回落时报告 CPU。指定 `cpu` 强制 CPU；指定 `cuda` 而无可用 GPU 时明确失败。GPU 加载失败或推理显存不足且 `cpuFallback=true` 时重新加载 CPU。CPU 版运行库在有显卡的机器上仍会用 CPU；需要选择 GPU 版运行库。

官方运行库来源：https://github.com/abetlen/llama-cpp-python/releases/tag/v0.3.36 。模型与绑定的许可分别保留在 `translation/LICENSE-HY-MT2.txt`、`translation/LICENSE-LLAMA-CPP-PYTHON.txt`。

## 主进程接口

```js
const { TranslationService, validateConfig } = require('./translation.cjs');
const service = new TranslationService({
  script, stateDir, modelDir, python,
  fetcher: net.fetch.bind(net),
  notify: status => sendStatus(status),
});
service.configure({ device: 'auto', cpuThreads: 4, cpuFallback: true });
const result = await service.translate(
  { requestId, text: chineseText, source: 'zh', target: 'ja' },
  { signal },
);
// result.text 为日文；result.segments 对应源片段与日文片段。
const status = await service.status();
const installed = await service.install();
service.cancel(requestId); // 取消指定请求；省略编号同时取消下载和所有翻译
service.dispose();
```

请求串行执行，最多排队 16 个，拒绝重复编号。取消正在推理的请求时只结束本服务创建的 Python 进程；随后重新加载模型。取消排队请求不会打断其他请求。每次返回前核对取消状态，迟到的译文不会进入语音队列。

worker 逐句拆分，过长句子按 Unicode 字符进一步拆分，使用 tokenizer 检查长度，禁止静默截断。每片有生成上限，达到上限的未完成译文会失败。提示包含相关角色专名词表，保留否定、条件、数字和单位；专名词表不修改中文原文。输出必须包含可确认日文的假名且不含控制标记；这只能过滤明显错误类型，不能证明语义完全等价。

## 实测与限制

完整原文、译文和计时在 [`reports/translation-cpu-smoke-20261025.json`](reports/translation-cpu-smoke-20261025.json)。2026-10-25，Linux x64 CPU、4 线程、官方 0.3.36 CPU wheel：15 条原创样例，首次模型校验与加载 **3.217 秒**，每条 **0.428–1.279 秒**。Node → JSONL worker → 真实 GGUF 的额外端到端请求也成功：

> 雪之下雪乃喜欢猫，但她现在并没有养猫。
>
> 雪ノ下雪乃は猫が好きですが、今は猫を飼っていません。

专名、250 元、未养猫的否定、准备去图书馆的将来语义以及“如果不下雨”的条件在本组样例中得到保留。但一条输出使用了不自然的「でたらけ」，不是全面质量验收；自然程度与角色口吻仍需日语使用者评估。内置模型负责翻译已有回复，API 的人物提示仍负责塑造雪乃的说话方式。

Node 测试覆盖队列顺序、加载复用、重复编号、取消、迟到结果丢弃、错误语言拒绝和安装校验；Python 测试覆盖完整分片、校验失败、CPU/GPU 选择、术语提示和不完整输出。未在本次翻译测试中验证真实语音音质。
