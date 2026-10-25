# 桌面端本地回复

桌面程序的“本地回复”使用随发行资源提供的 `GGUF` 角色权重。主进程启动自己管理的 `desktop_worker.py`，通过标准输入/输出 JSONL 通信，没有 HTTP 端口，不需要 API key，也不连接远程模型服务。旧的 `yuki_model serve` 是开发者可选服务，与这一条桌面离线路径独立。

## 资源和状态

- 角色权重：`manifest.json`、清单指定的 `.gguf`、`BASE_LICENSE.txt`、`training_report.json`。加载前验证文件大小和 SHA-256；缺失、截断或损坏的权重不能显示为已加载。
- 公共运行环境：Python 和 `llama-cpp-python`，由首次配置引导准备。用户不必先手动安装 Python。运行环境与角色权重是不同资源；下载运行环境不是重新下载或训练角色模型。
- 已安装但未加载：权重在磁盘，尚未占用生成内存；首次发送自动加载。
- 正在加载 / 本机生成 / 已就绪：对应实际 worker 生命周期。
- 释放内存：关闭受管 worker；下一次发送重新加载。

“自动”优先使用支持 GPU 的运行库，并根据实际 offload 日志报告设备；仅检测到 GPU 编译支持不会显示“正在用 GPU”。GPU 不可用或内存不足时可回退 CPU，设置中可关闭回退。GPU 硬件兼容性仍须在目标机器实测；没有显卡也可以用同一份权重进行 CPU 推理。

## 对话和语音衔接

桌面端传入同源人物规范、必要的用户记忆和对话历史，本地模型生成中文正文。中文正文交给日语翻译，再交给 GPT-SoVITS 合成日语。角色模型、翻译模型、语音权重分别加载和报告状态，不能把某一个模型的“未加载”显示成整个应用不可用。

默认上下文 8192 token、最长回复 256 token。超过上下文时丢弃最旧的完整历史轮次，保留人物规范和最新问题；这两部分仍然过长则明确提示，不能悄悄截掉角色规则。桌面内置 1.5B 模式复用 `characters/yukino/training.md` 的同源短人格提示，并追加当前输入事实与自然中文输出要求，不使用远程双语 JSON 协议。完整人物文档仍在软件中，API 继续使用详细或精简角色卡。

同时只执行一个加载/生成请求，排队上限 4。停止生成会终止专属 worker，并丢弃停止前产生的迟到结果；下次请求重新加载。当前 JSONL 协议在完整回复生成后发送一个正文片段，尚非逐 token 流式输出。

## 继续训练与打包

在 `model-service` 目录执行：

```bash
python scripts/build_persona_sft.py --help
python -m yuki_model train --config configs/train-persona-continued.json
python -m yuki_model merge --base models/base --adapter outputs/yukino-persona-v1.2-continued/adapter --output outputs/persona-merged
python scripts/export_gguf.py --llama-cpp /path/to/llama.cpp --merged outputs/persona-merged --training-report outputs/yukino-persona-v1.2-continued/training_report.json --base-license models/base/LICENSE --output outputs/persona-gguf
```

续训配置明确继承上一轮知识 LoRA；不是在随机初始化的小模型上从零训练。需要先生成与配置路径一致的 `data/persona-1.2` 数据，并提供固定版本的基础模型、旧适配器。导出脚本要求训练完成的报告，拒绝将单步 smoke 检查当作可发布训练。转换器需自行安装依赖；量化默认复用已安装的 `llama-cpp-python`，也可传 `--quantizer` 使用指定可执行文件。FP16 中间文件位于发行目录之外，防止误塞进安装包。

验证实际发行权重，而不是只检查占位清单：

```bash
node scripts/evaluate_desktop.cjs --python /absolute/path/to/python --model /absolute/path/to/persona-gguf --prompts data/persona-1.2/test-prompts.jsonl --output reports/desktop-evaluation.json
```

六个开发回归问题与 24 条保留测试分别记录。开发问题可能在训练中出现，验证损失也不是人格真实性分数；报告保留完整回答与人工审核未完成标记。小模型仍可能说错事实、重复或处理复杂任务失误。
