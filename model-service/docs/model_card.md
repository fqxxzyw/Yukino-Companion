# Yukino Knowledge v1 模型说明

基础模型：Qwen/Qwen2.5-1.5B-Instruct，revision `989aa7980e4cf806f80c7fef2b1adb7bc71aa306`。

训练配置：对 all-linear 模块进行 rank 8、alpha 16 的 LoRA 有监督微调，仅计算最后一条 assistant 回复的损失。训练样本来自用户提供的中文 EPUB 人物介绍及整理的关系事实，并包含资料不足时回答“无法确认”的示例。这不是从零预训练，也不是完整小说的持续预训练。训练是否完成以交付包中的 `training_report.json` 为准，运行中日志不能证明训练完成。

用途：本地《春物》人物知识问答，配合附带检索库使用。后续可以添加经过审阅的多轮角色对话数据，但需要单独评估，不能保证知识微调已经还原雪乃人格。

分发：基础模型单独下载，LoRA、tokenizer 与私人知识库另行交付。LoRA 不是完整独立模型，须配套固定 revision 的底座。CPU、CUDA 和 MPS 使用同一份 LoRA；硬件选择不需要重新训练。GGUF 是可选合并量化导出格式，本次尚未验证导出模型。

基础模型与 tokenizer 的许可证副本见 [Qwen-Apache-2.0.txt](Qwen-Apache-2.0.txt)；[官方模型卡](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct) 提供原始信息。本模型是项目微调的派生版本，并非 Qwen 官方发布的角色模型。小说语料与角色素材的权利不因基础模型许可证而改变。

限制：人物事实样本很少，验证集是已知事实的改写，不代表全面剧情掌握。模型可能产生幻觉；检索命中不等于答案被核实；卷数过滤不能严格控制模型自身的剧透。不要把角色生成内容当作原作新增设定。GPU 和 Windows 路径尚未在真实硬件验证。
