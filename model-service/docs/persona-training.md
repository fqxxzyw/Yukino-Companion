# 完整人格专项训练

这是一套独立于知识训练的 assistant-only LoRA SFT 流程，基础模型仍为 Qwen2.5-1.5B-Instruct，revision 固定为 `989aa7980e4cf806f80c7fef2b1adb7bc71aa306`。目的在于学习完整人格在不同问题、亲疏距离、压力和冲突中的自然表现，不提供前中后时期选择，也不把性格拆成三个模型。角色卡可以先供 EXE/API 使用；训练是否完成是另一件事。

## 数据、提示与标签

`persona-data/scenarios.jsonl` 是原创合成场景种子，不是小说对白摘录。每个 `family_id` 含至少三个有不同自然问法/上下文的 `variants`，每个变体只有一个目标回答。部分场景含多轮历史；模型只计算最后一条 assistant 的损失，system/user/历史 assistant 均掩码为 `-100`，不会教模型复述用户问题或角色说明书。

统一卡定义在 `../characters/yukino/manifest.json`（schema 2）：`runtime_path` 是运行完整版，`compact_path` 是本地/小上下文版本，`training_path` 是约 350–500 字的训练精炼版，`bible_path` 是详细解释文档。三种运行长度来自同一角色规范，没有阶段变量。构建记录所用提示 hash、整个包中全部 Markdown/JSON 的 hash、数据源 hash、基础模型 revision 和训练/验证/测试文件 hash。

发布种子标记 `provenance:"synthetic_original"`、`review_status:"assistant-reviewed"`、`human_reviewed:false`；编写代理作过编辑审阅，但没有宣称人工验收。`reviewed:true` 是现有 SFT 编码器的兼容字段，仅承认所声明的审核方式。`allow_synthetic_persona:true` 显式允许训练这种合成数据。若后来真正由人审阅，成对更新为 `human-reviewed` / `true`，记录审阅者、时间及结论，保留合成来源；构建器允许人工与代理审阅样例共存，但拒绝互相矛盾的标记。

当前种子共 66 个场景族、198 条变体，23 个场景族含多轮历史。实际 Qwen tokenizer 检查：最大 398 token，平均 362.37 token（训练精炼卡版本）。按场景族的稳定 hash 顺序切分约 80% 训练、10% 验证、10% 测试；同一族的所有变体和多轮历史留在同一集合。验证/测试各向上取整，训练取剩余，因此少量样例时比例不恰好为 80/10/10。本次为训练 52 族/156 条、验证 7 族/21 条、测试 7 族/21 条。归一化的完全重复问题跨族会被拒绝。没有声称消除了所有语义相似性；人工还要检查相近场景。`test-prompts.jsonl` 不含最终目标答案，供独立生成评估使用；`test.jsonl` 仅作后续参考审阅。

## 构建与训练

以下命令在 `model-service` 执行，已安装本项目及 `.[train]` 依赖并下载基础模型：

```bash
python -m yuki_model download
python scripts/build_persona_sft.py --tokenizer models/base --character-pack ../characters/yukino
python -m yuki_model train --config configs/train-persona.json
```

构建器默认 1024 token 上限，使用真实 tokenizer 检查每条完整样例，拒绝截断系统卡或答案；token 不够时增大构建与训练配置中的 `sequence_length`。训练器在分配模型前检查文件 hash、完整族/变体、集合隔离、基础 revision、人工/代理审核标记和是否真正执行过 token 检查。`--schema-only` 只作数据结构开发检查，其输出不能通过正式训练预检。更换角色卡、种子或拆分策略后必须重新构建。

默认 `adapter_mode:"fresh"` 创建独立性格 LoRA，输出 `outputs/yukino-persona-v1`，不改旧知识适配器。若要从已完成的知识 LoRA 继续训练，复制配置、换新的输出目录，再显式改为：

```json
{
  "adapter_mode": "continue",
  "initial_adapter": "outputs/yukino-1.5b-knowledge-v1/adapter",
  "output_dir": "outputs/yukino-persona-from-knowledge-v1"
}
```

保留原配置的其他字段。继续模式加载同一个适配器为可训练状态，不是把两个不相关 LoRA 自动相加；要求初始适配器旁的 `training_report.json` 能确认相同 base revision。它可能遗忘知识，需额外做知识回归。未知来源适配器默认拒绝；仅明确理解风险后才可设 `allow_unverified_initial_adapter:true`，这不构成兼容证明。fresh 配置不能携带 `initial_adapter`。`--resume checkpoint-...` 只恢复该次训练，不能和 `initial_adapter` 混用。

训练输出包括适配器、配置、数据来源清单、基础版本、硬件、训练/验证损失和训练完成标记；这些记录不代表人格通过验收。默认不覆盖非空输出目录，使用新目录或明确恢复检查点。

## GPU、CPU 与资源

同一组 LoRA/基础权重供 CPU 和 GPU 加载。训练 `device:auto` 优先可用 CUDA，否则 CPU；当前项目没有验证 MPS 训练，会要求改选 CPU/CUDA，推理另支持 MPS。CPU 训练需 `allow_cpu:true`，原生支持 BF16 时才能启用 CPU BF16；否则会用 FP32，内存与耗时增加。GPU 训练可选 `quantize_4bit:true` 并安装 `.[qlora]`，此路径仅支持 CUDA。训练 OOM 会明确停止，不在后台悄悄重跑另一训练。

1.5B 基础权重约需 3 GB 的 BF16 张量存储或 6 GB 的 FP32 张量存储，实际训练还需要激活、梯度和 LoRA 优化器状态。建议先在可用 RAM 至少约 10–12 GB 或具有足够可用显存的 CUDA 环境做 1 步烟雾测试，再决定批量/序列长度；这只是容量估算，不是显卡兼容保证。批量 1、梯度累积 4、rank 8、梯度检查点是默认配置。真实时长取决于硬件、token 长度与注意力实现，不承诺固定分钟数。应先记录真实短运行的每步时间，再估算完整运行；短测不是完成训练。

推理配置的最大上下文为 8192 token，实际显存/内存可能更紧张。系统角色卡始终保留，必要时删除较早的完整历史轮次；若系统卡加当前问题仍放不下，会返回明确的长度错误，不静默截掉性格规则。服务的单条输入上限为 6000 字符、30 条消息、总计 20000 字符。EXE 使用 compact 卡给本地模型，完整 API 卡由桌面端提供。

## 评估与启动

```bash
python scripts/evaluate_persona.py --output reports/persona-base
python scripts/evaluate_persona.py --adapter outputs/yukino-persona-v1/adapter --output reports/persona-adapter
python -m yuki_model serve --config configs/serve-persona.json
```

前两个命令对同一未见场景比较基础模型与性格 LoRA，直接调用生成模型，禁用 RAG 和原文摘录，输出原始生成、角色包 hash、规则提示及空的人工评分 CSV。按照 [EVALUATION.md](../persona-data/EVALUATION.md) 评估完整人格、独立判断、克制温柔、语言、身份边界、事实诚实、上下文与非强迫关系。自动规则没有报警、验证 loss 降低，都不能替代人工体验。`--dry-run` 不加载权重，仅检查输入契约。用于正式验收时不要用 `--max-families` 缩小测试集。

服务默认 `use_knowledge:false`，无需私人小说索引；若需要检索，另在配置填写已有索引路径并在请求中设 `use_knowledge:true`。未配置索引时，显式知识请求和搜索接口返回 503 并说明未配置知识库；已有索引但无命中时才返回没有证据，不能当成知识回答。客户端已有完整 system 时保留客户端内容；仅在未提供 system 时加载服务端统一 compact 卡，避免重复注入相冲突的提示。

## 独立性格模型包

旧 `package_private.py` 仅用于旧知识包。性格包使用独立脚本，不收录小说、知识索引、旧适配器、检查点或账户配置。先完成真实训练并保留报告（`run_purpose:"smoke"` 的检查权重会被拒绝打包）；脚本要求训练报告本身的 task 为 complete_persona、实际权重 hash 与该报告一致，并且角色包与训练时的包 hash 一致，不会凭空造出权重或把旧知识权重命名成性格模型。

```bash
python scripts/package_persona.py --adapter outputs/yukino-persona-v1/adapter --output /outside/project/yukino-persona.zip
# 需要离线完整包时才加上本地基础模型，ZIP 会显著增大；需先由新版 download 命令生成并验证 BASE_PROVENANCE.json：
python scripts/package_persona.py --adapter outputs/yukino-persona-v1/adapter --base models/base --output /outside/project/yukino-persona-offline.zip
```

解压后 `model-service/` 与 `characters/` 是相邻目录，根目录有 `PERSONA_MANIFEST.json`。在解压后的 `model-service` 运行安装脚本；不含基础模型的包还需 `python -m yuki_model download`。随后运行 `python scripts/verify_persona_package.py` 校验，最后使用包内生成的 `scripts/start_persona.bat`（该启动文件在打包时生成，不是源码目录中的现成文件） 或上面的 `serve-persona.json` 命令启动。包中统一使用 `outputs/yukino-persona-v1/adapter`，不依赖原训练目录名称。包只证明文件完整与训练报告存在，默认 `personality_accepted:false`，需另附真正的人工评审记录才能声明效果。

## 本次提交的状态

本次交付的是合成种子、角色卡衔接、可运行训练/评估/打包流程及测试。任何短训练检查都仅证明流程可以执行；没有完成完整多 epoch 性格训练，没有人工验收的新性格权重，也没有生成可宣称已通过人格验收的模型包。既有知识模型的闭卷局限没有因这次代码更新而自动消失。
