"""Build the Drive-first A100 continuation notebook from reviewed source cells."""
import argparse
import json
from pathlib import Path
from textwrap import dedent

import nbformat as nbf

A100_PREFLIGHT = '''# 实际 CUDA 设备决定能否训练；笔记本名称或元数据不会分配 GPU。
def require_a100():
    import shutil
    import subprocess
    from pathlib import Path

    help_text = ("请打开「代码执行程序（Runtime）→ 更改运行时类型 → A100 GPU」，"
                 "保存并重新连接，然后从第 1 节运行。只写 A100 配置不会自动获得 GPU。")
    smi = shutil.which("nvidia-smi") or next(
        (p for p in ("/usr/bin/nvidia-smi", "/usr/local/nvidia/bin/nvidia-smi") if Path(p).is_file()), None)
    if smi:
        try:
            print(subprocess.check_output([smi, "--query-gpu=name,memory.total", "--format=csv,noheader"],
                                          text=True, stderr=subprocess.STDOUT, timeout=15).strip())
        except (OSError, subprocess.SubprocessError) as error:
            print("nvidia-smi 诊断不可用，将使用 PyTorch 检查实际 GPU：", type(error).__name__)
    else:
        print("未找到 nvidia-smi，正在检查 PyTorch 是否能访问 CUDA GPU。")
    try:
        import torch
        if not torch.cuda.is_available():
            raise SystemExit("当前没有可用的 CUDA GPU，训练尚未开始。" + help_text)
        name = torch.cuda.get_device_name(0)
        if "A100" not in name.upper():
            raise SystemExit(f"当前实际分配的是 {name}，本笔记本要求 A100。" + help_text)
        if not torch.cuda.is_bf16_supported():
            raise SystemExit("当前 CUDA 环境不支持本训练所需的 BF16。" + help_text)
        print("CUDA 检查通过：", name)
        return name
    except Exception as error:
        raise SystemExit("无法初始化当前运行时的 CUDA/PyTorch：" + str(error) + "。" + help_text) from None

gpu = require_a100()
'''


def build(source_hash):
    root = Path(__file__).resolve().parents[2]
    previous = nbf.read(root / "model-service/notebooks/yukino-a100-multiepoch.ipynb", as_version=4)
    old_cells = {c.id: c.source for c in previous.cells if c.cell_type == "code"}
    cells = []

    def md(id, text):
        cells.append(nbf.v4.new_markdown_cell(dedent(text).strip(), id=id))

    def code(id, text):
        text = dedent(text).strip().replace("__A100_PREFLIGHT__", A100_PREFLIGHT.strip())
        cells.append(nbf.v4.new_code_cell(text + "\n", id=id))

    md("intro", """
    # 雪乃 · A100 纠错硬标签续训 v3

    从云盘中已经完成的 v1 人格 LoRA 继续训练同一 **Qwen2.5-1.5B-Instruct**。
    本次由 Codex 依据小说和角色档案编写 192 组原创标准回答，明确标记为合成数据：
    144 组用于训练、24 组验证、24 组最终检查。混入原来仅训练划分的 186 组人格问答，减轻遗忘。
    不需要教师 API key，也不会假称已经调用其他在线模型。

    例如：阳乃是姐姐，雪乃还有父亲和母亲；独居不能推出没有其他家人。
    每个事实场景有来源编号，训练只计算最后一条正确回答的损失。

    **顺序运行 1–5；第 6 节导出 GGUF；第 7 节是可连续/批量提问的并排界面。**
    上限 12 轮，每轮完整保存；连续 3 轮改善不足 0.001 时早停，最终选择最低验证损失的断点。
    最终测试不用于早停或选择模型。轮次和损失无法保证没有幻觉，最后仍要读实际回答。

    所有代码快照、原始资料、标签、配置、基座、断点、日志和最终模型都在 Drive。
    `/content/yukino-distill-v3-runtime` 只放可重建依赖与编译缓存。
    """)
    md("guide-drive", """
    ## 1. 挂载云盘与固定路径

    先在「更改运行时类型」选择 A100。`RUN_ID` 固定一个实验；断线后保持相同值并从第 1 节重跑。
    如果提示找不到 `nvidia-smi`，先检查「代码执行程序 → 更改运行时类型 → A100 GPU」，保存并重新连接。
    代码会用 PyTorch 再确认实际 GPU；无需在 CPU 运行时安装 NVIDIA 驱动。云盘资料不受本检测影响。
    改标签、学习率或总轮数必须使用新 `RUN_ID`，防止新旧训练状态混用。
    `ATTEMPT` 只用于第一次保存前中断、没有可恢复断点时重新开一个训练目录。
    """)
    code("drive-a100", """
    import json, os, re, shutil, subprocess, sys, tempfile
    from pathlib import Path
    from hashlib import sha256
    from zipfile import ZipFile
    from google.colab import drive

    __A100_PREFLIGHT__
    drive.mount("/content/drive")
    RUN_ID = "epub-a100-v3-distill"
    MAX_EPOCHS = 12
    EARLY_STOP_PATIENCE = 3
    ATTEMPT = 1
    INITIAL_RUN = "epub-a100-v1"
    INITIAL_STAGE = "persona-01"
    for value in (RUN_ID, INITIAL_RUN, INITIAL_STAGE):
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}", value):
            raise ValueError("实验和阶段名只能使用英文字母、数字、横线和下划线。")
    if type(MAX_EPOCHS) is not int or not 2 <= MAX_EPOCHS <= 50 or type(EARLY_STOP_PATIENCE) is not int or not 1 <= EARLY_STOP_PATIENCE <= MAX_EPOCHS:
        raise ValueError("轮次范围 2–50，早停耐心值必须在 1 到总轮次之间。")
    if type(ATTEMPT) is not int or ATTEMPT < 1:
        raise ValueError("ATTEMPT 必须为正整数。")
    project = Path("/content/drive/MyDrive/Yukino-Companion")
    if not project.is_dir():
        raise FileNotFoundError("未找到已上传的 Yukino-Companion 云盘目录。")
    root = Path("/content/yukino-distill-v3-runtime")
    root.mkdir(exist_ok=True)
    drive_runs = project / "retrain" / RUN_ID
    drive_runs.mkdir(parents=True, exist_ok=True)
    epubs = project / "data/epubs"
    if not list(epubs.glob("*.epub")):
        raise FileNotFoundError(epubs)
    initial_source = project / "retrain" / INITIAL_RUN / INITIAL_STAGE
    persona_output = drive_runs / f"distill-{ATTEMPT:02d}"
    base_revision = "989aa7980e4cf806f80c7fef2b1adb7bc71aa306"

    def digest(path):
        h = sha256()
        with Path(path).open("rb") as f:
            for block in iter(lambda: f.read(8 * 1024**2), b""):
                h.update(block)
        return h.hexdigest()

    def load_json(path):
        return json.loads(Path(path).read_text(encoding="utf-8"))

    def save_json(path, value):
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\\n", encoding="utf-8")
        temporary.replace(path)

    def inventory(directory):
        return {p.relative_to(directory).as_posix(): digest(p) for p in sorted(Path(directory).rglob("*")) if p.is_file() and p.name != "artifacts.json"}

    def publish_directory(local, final):
        final.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix=".publish-", dir=final.parent) as staging:
            candidate = Path(staging) / final.name
            shutil.copytree(local, candidate)
            if inventory(candidate) != inventory(local):
                raise RuntimeError("复制后的 Drive 文件校验失败。")
            candidate.rename(final)

    def verify_run(output, task):
        report = load_json(output / "training_report.json")
        if not (report.get("completed") and report.get("run_purpose") == "training"
                and report.get("task") == task and report.get("base_revision") == base_revision
                and report.get("device") == "cuda" and report.get("dtype") == "torch.bfloat16"
                and report.get("steps", 0) > 1
                and report.get("adapter_sha256") == digest(output / "adapter/adapter_model.safetensors")):
            raise RuntimeError(f"模型报告或权重校验失败：{output}")
        return report

    initial_report = verify_run(initial_source, "complete_persona")
    print("继续训练来源", initial_source, initial_report["adapter_sha256"])
    print("持久化输出", drive_runs)
    """)
    md("guide-setup", """
    ## 2. 从云盘恢复代码与依赖

    源码 ZIP 和解压后的代码都保存在 `Yukino-Companion/source/`。
    依赖环境借用 Colab 已有 CUDA Torch，不再安装容易失败的旧 Torch wheel。
    基础模型保存到 `Yukino-Companion/models/`；可从同一运行时的旧缓存复制，缺失时由 Colab 服务器直接下载。
    """)
    code("setup", """
    import tomllib
    source_archive = project / "source/training-source-distill-v3.zip"
    source_hash = "__SOURCE_HASH__"
    if not source_archive.is_file() or digest(source_archive) != source_hash:
        raise RuntimeError(f"源码归档缺失或 SHA 不符：{source_archive}")
    repo = project / "source" / ("distill-v3-" + source_hash[:12])
    with ZipFile(source_archive) as archive:
        for item in archive.infolist():
            if item.filename.startswith("/") or ".." in Path(item.filename).parts:
                raise ValueError("源码归档存在不安全路径。")
        if not repo.exists():
            with tempfile.TemporaryDirectory(prefix=".source-", dir=repo.parent) as stage:
                candidate = Path(stage) / "source"
                archive.extractall(candidate)
                candidate.rename(repo)
        for item in archive.infolist():
            if not item.is_dir() and (repo / item.filename).read_bytes() != archive.read(item):
                raise RuntimeError("云盘源码快照被改动：" + item.filename)
    service = repo / "model-service"
    venv = root / "venv"
    python = venv / "bin/python"
    if not python.exists():
        subprocess.run([sys.executable, "-m", "venv", "--system-site-packages", str(venv)], check=True)
    def run(*args, cwd=service, log=None):
        command = [str(python), *(str(a) for a in args)]
        env = dict(os.environ, USE_TF="0", USE_TORCH="1", PYTHONPATH=str(service), PYTHONUNBUFFERED="1")
        log = Path(log or drive_runs / "operations.log")
        with log.open("a", encoding="utf-8", buffering=1) as stream:
            with subprocess.Popen(command, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                  text=True, encoding="utf-8", errors="replace", bufsize=1) as process:
                for line in process.stdout:
                    print(line, end="", flush=True)
                    stream.write(line)
                if process.wait():
                    raise subprocess.CalledProcessError(process.returncode, command)
    run("-c", "import torch; print(torch.__version__, torch.version.cuda); assert tuple(map(int,torch.__version__.split('.')[:2])) >= (2,6); assert 'A100' in torch.cuda.get_device_name(0) and torch.cuda.is_bf16_supported(); print(torch.ones(1,device='cuda',dtype=torch.bfloat16))")
    config = tomllib.loads((service / "pyproject.toml").read_text(encoding="utf-8"))["project"]
    dependencies = config["dependencies"] + [s for s in config["optional-dependencies"]["train"] if not s.startswith("torch")]
    ready = venv / "deps-ready"
    if not ready.exists():
        run("-m", "pip", "install", "--disable-pip-version-check", "--retries", "3", "--timeout", "60", *dependencies)
    run("-c", "from transformers import Trainer; from peft import PeftModel; from yuki_model.distillation import build_distillation")
    ready.touch()
    run("-m", "pip", "list", "--format=json", log=drive_runs / "environment.log")
    base = project / "models/qwen2.5-1.5b-instruct-989aa798"
    if not (base / "BASE_PROVENANCE.json").is_file():
        old_cache = Path("/content/yukino-a100/source/model-service/models/base")
        if not base.exists() and (old_cache / "BASE_PROVENANCE.json").is_file():
            publish_directory(old_cache, base)
        else:
            run("-m", "yuki_model", "download", "--output", base)
    base_proof = load_json(base / "BASE_PROVENANCE.json")
    if base_proof["base_revision"] != base_revision:
        raise RuntimeError("基座版本不匹配。")
    for name, expected in base_proof["files"].items():
        if Path(name).name != name or digest(base / name) != expected:
            raise RuntimeError("基座文件校验失败：" + name)
    if digest(base / "model.safetensors") != "dd924a11b4c220f385b51ffa522daea7c9f3d850e31b162bb5661df483c6d3ee":
        raise RuntimeError("基座权重不符合固定版本。")
    print("代码路径", repo)
    print("基座路径", base)
    """.replace("__SOURCE_HASH__", source_hash))
    md("guide-data", """
    ## 3. 核验小说证据，保存标签与旧权重快照

    核验 26 条出处的文件 SHA 和原文段落；生成 330 组训练、24 组验证和 24 组最终检查。
    训练仅使用旧人格数据的训练部分；本次测试题的答案不会放入评测提示。
    12 道已训练的纠错题另存为回归检查，不能把这些成绩当成未见题表现。
    新问法仍围绕熟悉事实，不代表模型掌握所有原作内容。
    """)
    code("prepare", """
    inputs = {
        "source_archive_sha256": source_hash, "base_revision": base_revision,
        "initial_path": str(initial_source), "initial_sha256": initial_report["adapter_sha256"],
        "initial_config_sha256": digest(initial_source / "adapter/adapter_config.json"),
        "epochs": MAX_EPOCHS, "patience": EARLY_STOP_PATIENCE,
        "epubs": {p.name: digest(p) for p in sorted(epubs.glob("*.epub"))},
    }
    input_file = drive_runs / "inputs.json"
    if input_file.exists() and load_json(input_file) != inputs:
        raise RuntimeError("该 RUN_ID 已绑定另一份输入或参数，请换新 RUN_ID。")
    save_json(input_file, inputs)
    initial_snapshot = drive_runs / "initial"
    if not initial_snapshot.exists():
        with tempfile.TemporaryDirectory(prefix=".initial-", dir=drive_runs) as stage:
            candidate = Path(stage) / "initial"
            candidate.mkdir()
            shutil.copytree(initial_source / "adapter", candidate / "adapter")
            shutil.copyfile(initial_source / "training_report.json", candidate / "training_report.json")
            if digest(candidate / "adapter/adapter_model.safetensors") != inputs["initial_sha256"]:
                raise RuntimeError("旧权重快照复制校验失败。")
            candidate.rename(initial_snapshot)
    verify_run(initial_snapshot, "complete_persona")
    if digest(initial_snapshot / "adapter/adapter_config.json") != inputs["initial_config_sha256"]:
        raise RuntimeError("旧适配器配置与快照不符。")
    prepared = drive_runs / "prepared"
    if not prepared.exists():
        with tempfile.TemporaryDirectory(prefix=".prepare-", dir=drive_runs) as stage:
            candidate = Path(stage) / "data"
            run("scripts/build_distillation_sft.py", "--epubs", epubs, "--tokenizer", base,
                "--output", candidate, "--sequence-length", "1536", log=drive_runs / "prepare.log")
            candidate.rename(prepared)
    data_manifest = load_json(prepared / "manifest.json")
    for name, expected in data_manifest["artifacts"].items():
        if Path(name).name != name or digest(prepared / name) != expected:
            raise RuntimeError("生成数据被修改，请新建实验：" + name)
    if data_manifest["source_sha256"] != digest(service / "distill-data/seeds.jsonl") or data_manifest["evidence_sha256"] != digest(service / "distill-data/evidence.jsonl"):
        raise RuntimeError("数据与源码快照中的标签或证据不一致。")
    print("问答数量", data_manifest["examples"])
    print("训练来源", data_manifest["origin_counts"]["train"])
    print("最大 tokens", data_manifest["max_tokens"])
    print("待人工检查的近似问法", data_manifest["near_prompt_pairs_for_review"])
    """)
    md("guide-train", """
    ## 4. 继续微调：最多 12 轮，每轮保存，自动续接

    从第 3 节冻结的旧人格 LoRA 继续更新，不重新训练旧阶段。
    每轮保存适配器、优化器、调度器、随机状态、早停状态和 SHA 完成标记；
    中断时跳过未写完的断点，续接最近一份完整状态。
    保存全部已完成轮次，最终 `adapter/` 是验证损失最小的一轮。
    第一次保存前中断时会明确要求增加 `ATTEMPT`，不会悄悄覆盖数据。
    """)
    code("train", """
    if "stop_comparison_worker" in globals():
        stop_comparison_worker()
    config = load_json(service / "configs/train-distill.json")
    config.update(model=str(base), initial_adapter=str(initial_snapshot / "adapter"),
                  train_file=str(prepared / "train.jsonl"), eval_file=str(prepared / "val.jsonl"),
                  data_manifest=str(prepared / "manifest.json"), output_dir=str(persona_output),
                  epochs=MAX_EPOCHS, save_total_limit=MAX_EPOCHS,
                  early_stopping_patience=EARLY_STOP_PATIENCE)
    config_file = drive_runs / f"{persona_output.name}-config.json"
    if config_file.exists() and load_json(config_file) != config:
        raise RuntimeError("已有训练参数不同，请使用新的 RUN_ID。")
    save_json(config_file, config)
    if (persona_output / "training_report.json").is_file():
        report = verify_run(persona_output, "distill_sft")
        if report["data"]["data_manifest_sha256"] != digest(prepared / "manifest.json"):
            raise RuntimeError("已完成模型与当前数据不一致。")
        print("此阶段已经完成，读取保存结果。")
    else:
        resume = persona_output.exists() and any(persona_output.iterdir())
        runner = """ + "'''" + """
    import json, sys
    from pathlib import Path
    from yuki_model.training import train, validate_resume, validate_training_spec
    from yuki_model.io import file_sha
    c = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    if sys.argv[2] == "resume":
        c["resume"] = True
        try:
            selected = validate_resume(Path(c["output_dir"]), c, {
                "train_sha256": file_sha(c["train_file"]), "eval_sha256": file_sha(c["eval_file"]),
                **validate_training_spec(c)})
        except (ValueError, OSError) as error:
            raise RuntimeError("没有可恢复的完整断点；保留原目录，增加第1节 ATTEMPT 后重跑。详情：" + str(error)) from error
        print("恢复断点", selected, flush=True)
    print(json.dumps(train(c), ensure_ascii=False, indent=2))
    """ + "'''" + """
        run("-c", runner, config_file, "resume" if resume else "fresh", log=drive_runs / f"{persona_output.name}.log")
        report = verify_run(persona_output, "distill_sft")
    print("实际完成轮次", report["actual_epoch"], "上限", report["configured_epochs"], "早停", report["stopped_early"])
    print("导出权重来源", report["selected_weights"], report["best_checkpoint"])
    print("训练前/后验证损失", (report["before"] or {}).get("eval_loss"), report["after"]["eval_loss"])
    print("模型已保存在 Drive", persona_output / "adapter")
    """)
    md("guide-evaluate", """
    ## 5. 同题比较继续训练前后：回归题与保留题

    同一基座、同一角色提示和确定性解码，不注入参考答案。
    每生成一条回答就保存；中断后运行本节只补完缺失部分。
    `regression` 是 12 道训练内纠错题，`held-out` 是 24 道未参加本轮训练和选模的题。
    报告没有自动宣称准确率；展开参考答案并结合来源读回答，CSV 可记录事实错误和偏好。
    """)
    code("evaluate", """
    from IPython.display import HTML, display
    if "stop_comparison_worker" in globals():
        stop_comparison_worker()
    verify_run(persona_output, "distill_sft")
    for label, name in (("regression", "regression"), ("held-out", "test")):
        output = drive_runs / "evaluation" / persona_output.name / label
        run("scripts/evaluate_distillation.py", "--model", base, "--device", "cuda",
            "--before-adapter", initial_snapshot / "adapter", "--after-adapter", persona_output / "adapter",
            "--prompts", prepared / f"{name}-prompts.jsonl", "--references", prepared / f"{name}.jsonl",
            "--evaluation-kind", label, "--output", output, log=drive_runs / "evaluation.log")
        display(HTML((output / "comparison.html").read_text(encoding="utf-8")))
        print("云盘报告", output)
    """)
    md("guide-export", """
    ## 6. 导出候选离线 GGUF 模型

    导出最佳验证轮次的 LoRA 为 Q4_K_M；合并 FP16 及转换中间文件也放在 Drive，
    成功后仅清理本节创建的临时中间目录，最终 GGUF、来源报告与训练断点仍保留。
    这是候选模型，文件完整性验证不代表回答质量合格。
    """)
    export = old_cells["export"].replace('verify_run(persona_output, "complete_persona")', 'verify_run(persona_output, "distill_sft")')
    export = export.replace('with tempfile.TemporaryDirectory(prefix="export-", dir=root)', 'with tempfile.TemporaryDirectory(prefix=".export-", dir=drive_runs)')
    export = export.replace('if shutil.disk_usage(root).free < 8 * 1024**3:', 'if shutil.disk_usage(drive_runs).free < 12 * 1024**3:')
    export = export.replace('至少需要 8 GiB 本地可用空间', '至少需要 12 GiB 云盘可用空间')
    export = 'if "stop_comparison_worker" in globals():\n    stop_comparison_worker()\n' + export
    code("export", export)
    md("guide-compare", """
    ## 7. 双模型问答前端

    左边默认为本次继续训练前的 v1，右边为纠错续训后的模型。
    每行一题，最多 12 道；也可以选择连续对话，两个模型各自保留最近四轮。
    输入问题时才加载 GPU 模型；开始新训练前点击释放模型。
    勾选保存即可把问题、回答和权重 SHA 留在本实验的 `comparison/`。
    """)
    md("guide-compare-setup", "## 7.1. 加载两份 LoRA 的推理接口")
    original_setup = old_cells["compare-setup"]
    worker_tail = original_setup[original_setup.index("COMPARE_WORKER ="):]
    code("compare-setup", dedent("""
    import select
    verify_run(persona_output, "distill_sft")
    before_report = verify_run(initial_snapshot, "complete_persona")
    after_report = verify_run(persona_output, "distill_sft")
    comparison_models = {
        "before": {"label": "继续训练前 · " + INITIAL_RUN, "path": str(initial_snapshot / "adapter"), "sha256": before_report["adapter_sha256"]},
        "current": {"label": "纠错续训后 · " + RUN_ID, "path": str(persona_output / "adapter"), "sha256": after_report["adapter_sha256"]},
    }
    """).strip() + "\n\n" + worker_tail)
    md("guide-compare-ui", "## 7.2. 打开批量与连续问答界面")
    ui = old_cells["compare-ui"].replace('value="release" if "release" in comparison_models else "knowledge"', 'value="before"')
    code("compare-ui", ui)
    md("paths", """
    ## 文件位置与恢复

    ```text
    MyDrive/Yukino-Companion/
      source/training-source-distill-v3.zip       # 固定代码+原创标签+出处
      source/distill-v3-<SHA>/                   # 可直接查看的完整源码
      data/epubs/                               # 已上传小说
      models/qwen2.5-1.5b-instruct-989aa798/      # 固定基座与分词器
      retrain/epub-a100-v3-distill/
        inputs.json                             # 本轮输入/参数锁定
        initial/                                # 继续训练前的权重快照
        prepared/                               # train/val/test/出处/清单
        distill-01-config.json
        distill-01/
          checkpoint-*/                         # 每轮完整断点及完成标记
          adapter/                              # 最佳验证轮次 LoRA
          baseline.json
          training_report.json
        evaluation/distill-01/                  # 回归和保留题对照报告
        distill-01-gguf/                        # 最终候选离线文件
        comparison/                             # 用户勾选保存的问答
        *.log
    ```

    断线：相同 A100 环境运行 1–4，自动恢复或读取已完成结果；5 会补完评测。
    如想追加新的失败案例，在源码 `distill-data/seeds.jsonl` 中编写有出处的正确答案，
    人工检查后重新打包并使用新 RUN_ID。不要把待改正的模型回答直接当训练目标。
    """)
    notebook = nbf.v4.new_notebook(cells=cells, metadata={
        "accelerator": "GPU", "colab": {"provenance": [], "gpuType": "A100", "toc_visible": True},
        "kernelspec": {"name": "python3", "display_name": "Python 3"}, "language_info": {"name": "python"},
    })
    nbf.validate(notebook)
    for cell in notebook.cells:
        if cell.cell_type == "code":
            compile(cell.source, cell.id, "exec")
    output = root / "model-service/notebooks/yukino-a100-distill-v3.ipynb"
    nbf.write(notebook, output)
    guide = root / "model-service/notebooks/A100-纠错续训v3说明.md"
    guide.write_text("\n\n".join(c.source for c in cells if c.cell_type == "markdown") + "\n", encoding="utf-8")
    print(output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-sha256", required=True)
    args = parser.parse_args()
    if len(args.source_sha256) != 64 or any(c not in "0123456789abcdef" for c in args.source_sha256):
        parser.error("Need a SHA-256 digest")
    build(args.source_sha256)
