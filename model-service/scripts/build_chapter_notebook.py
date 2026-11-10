"""Generate the A100 chapter QA / continued LoRA notebook from the v3 runner."""
import argparse
import re
from hashlib import sha256
from pathlib import Path
from textwrap import dedent

import nbformat as nbf


def build(source_hash, corpus_hash):
    root = Path(__file__).resolve().parents[2]
    notebooks = root / "model-service/notebooks"
    nb = nbf.read(notebooks / "yukino-a100-distill-v3.ipynb", as_version=4)
    cells = {c.id: c for c in nb.cells}
    recovery_hash = sha256((root / "model-service/scripts/recover_chapter_teacher.py").read_bytes()).hexdigest()

    def put(id, body):
        cells[id].source = dedent(body).strip() + "\n"

    def insert(before, id, kind, body):
        make = getattr(nbf.v4, "new_" + kind + "_cell")
        nb.cells.insert(nb.cells.index(cells[before]), make(dedent(body).strip() + "\n", id=id))

    put("intro", """
    # 雪乃 A100 · 原作章节问答续训 v4

    从 20 本 EPUB 的章节和带编号的段落出发，由 **Qwen2.5-14B-Instruct**
    在同一台 A100 上生成剧情、人物关系、前因后果问答并自动复核。
    每条录用问答有原文段落编号和可核对的短证据；自动核验结果仍需人工抽查。
    问答整理完成后，用它们和既有人格样本继续微调 Qwen2.5-1.5B 的 LoRA。
    源码、章节数据、问答、日志、训练断点和最终 LoRA 都保存在 Drive。

    先运行 **1 → 2 → 3 → 3.1**。第 3.1 节可能跨多个 Colab 会话；重连后按原顺序重跑，
    会保留已完成的片段，进度见 `teacher/manifest.json`。全部通过后运行 **4** 续训，
    **5** 对比训练前后，**6** 可选导出 GGUF，**7** 可手动并排提问。
    """)
    put("guide-drive", """
    ## 1. 检查 A100，挂载云盘

    在「代码执行程序 → 更改运行时类型」选择 A100 GPU，保存并连接。
    续跑保持 `RUN_ID`、起始适配器和训练参数一致。`ATTEMPT` 仅用于首次保存前中断、没有可恢复断点时。
    默认使用已经完成的 v1 人格适配器；如 v3 已完成，可在第一次运行前把 `INITIAL_RUN`、`INITIAL_STAGE` 和 `INITIAL_TASK` 改为对应值。
    """)
    cells["drive-a100"].source = (cells["drive-a100"].source
        .replace('"epub-a100-v3-distill"', '"epub-a100-v4-chapters"')
        .replace('MAX_EPOCHS = 12', 'MAX_EPOCHS = 6')
        .replace('INITIAL_STAGE = "persona-01"', 'INITIAL_STAGE = "persona-01"\nINITIAL_TASK = "complete_persona"  # v3 已完成时可选 distill_sft')
        .replace('"/content/yukino-distill-v3-runtime"', '"/content/yukino-chapter-v4-runtime"')
        .replace('verify_run(initial_source, "complete_persona")', 'verify_run(initial_source, INITIAL_TASK)'))
    put("guide-setup", """
    ## 2. 恢复代码和训练底座

    从 Drive 校验并解包固定源码。保留 Colab 自带 CUDA Torch，安装其余固定版本依赖。
    隔离环境跳过 Python 自带的 pip 初始化，使用 Colab 的 pip 安装依赖，安装日志保存在云盘 `environment.log`。
    1.5B 学生底座和最终 LoRA 保存在 Drive。14B 教师的公开权重可随时重新下载，默认用 Colab 本地缓存；原文和问答不提交给在线模型 API。
    """)
    cells["setup"].source = (cells["setup"].source
        .replace("training-source-distill-v3.zip", "training-source-chapter-v4.zip")
        .replace('("distill-v3-"', '("chapter-v4-"')
        .replace('2c31dae156f74497a7a5fa8a60341baa1b12b4d5aeb7d944fd09461ca82403ea', source_hash))
    setup = cells["setup"].source
    start = setup.index('venv = root / "venv"')
    log_runner = setup.index('def run(*args, cwd=service, log=None):', start)
    setup = (setup[:start] + 'venv = root / "venv-no-ensurepip"\npython = venv / "bin/python"\n' + setup[log_runner:])
    setup = setup.replace('def run(*args, cwd=service, log=None):\n    command = [str(python),',
                          'def run(*args, cwd=service, log=None, interpreter=None):\n    command = [str(interpreter or python),', 1)
    start = setup.index('run("-c", "import torch;')
    end = setup.index('base = project /', start)
    setup = setup[:start] + dedent('''
    env_log = drive_runs / "environment.log"
    ready = venv / "deps-ready"
    if not python.is_file():
        run("-m", "venv", "--system-site-packages", "--without-pip", venv,
            interpreter=sys.executable, log=env_log)
    cuda_check = ("import torch; print(torch.__version__, torch.version.cuda, torch.__file__); "
                  "assert tuple(map(int,torch.__version__.split('.')[:2])) >= (2,6); "
                  "assert torch.cuda.is_available() and 'A100' in torch.cuda.get_device_name(0) "
                  "and torch.cuda.is_bf16_supported(); print(torch.ones(1,device='cuda',dtype=torch.bfloat16))")
    run("-c", cuda_check, log=env_log)
    config = tomllib.loads((service / "pyproject.toml").read_text(encoding="utf-8"))["project"]
    dependencies = config["dependencies"] + [s for s in config["optional-dependencies"]["train"] if not s.startswith("torch")]
    if not ready.exists():
        from importlib.metadata import version
        constraints = root / "colab-torch-constraint.txt"
        constraints.write_text("torch==" + version("torch") + "\\n", encoding="utf-8")
        run("-m", "pip", "--python", python, "install", "--disable-pip-version-check",
            "--retries", "3", "--timeout", "60", "--constraint", constraints, *dependencies,
            interpreter=sys.executable, log=env_log)
        run("-c", cuda_check, log=env_log)
    run("-c", "from transformers import Trainer; from peft import PeftModel; from yuki_model.distillation import build_distillation", log=env_log)
    ready.touch()
    run("-m", "pip", "--python", python, "list", "--format=json", interpreter=sys.executable, log=env_log)
    ''').lstrip() + setup[end:]
    cells["setup"].source = setup
    if source_hash not in cells["setup"].source:
        raise ValueError("v3 source-hash marker changed; update the template adapter")
    put("guide-data", """
    ## 3. 验证章节、原文来源与续训起点

    逐卷核对 EPUB 的 SHA-256，加载预先整理的章节与片段。此步只整理和验证，不生成问答。
    输出卷数、章数、字符数和仍需补录的覆盖缺口；段落编号用于之后回查证据。
    """)
    # Reuse v3's immutable input ledger and staged initial adapter snapshot.
    prior_prepare = cells["prepare"].source.split('prepared = drive_runs / "prepared"', 1)[0]
    prior_prepare = prior_prepare.replace('"epochs": MAX_EPOCHS,',
        '"corpus_archive_sha256": "' + corpus_hash + '", "initial_task": INITIAL_TASK,\n    "epochs": MAX_EPOCHS,')
    prior_prepare = prior_prepare.replace('verify_run(initial_snapshot, "complete_persona")', 'verify_run(initial_snapshot, INITIAL_TASK)')
    cells["prepare"].source = prior_prepare + dedent("""
    corpus_archive = project / "data/chapter-corpus-v4.zip"
    if digest(corpus_archive) != inputs["corpus_archive_sha256"]:
        raise RuntimeError("章节档案的 SHA-256 不符。")
    corpus = drive_runs / "corpus"
    expected_files = {"manifest.json", "chapters.jsonl", "passages.jsonl", "vol11-interlude-supplement.jsonl"}
    with ZipFile(corpus_archive) as archive:
        if set(archive.namelist()) != expected_files or len(archive.namelist()) != len(expected_files):
            raise RuntimeError("章节档案的文件列表不符。")
        if not corpus.exists():
            with tempfile.TemporaryDirectory(prefix=".corpus-", dir=drive_runs) as stage:
                candidate = Path(stage) / "data"
                archive.extractall(candidate)
                candidate.rename(corpus)
        for name in expected_files:
            if digest(corpus / name) != sha256(archive.read(name)).hexdigest():
                raise RuntimeError("章节档案与运行目录不一致：" + name)
    corpus_manifest = load_json(corpus / "manifest.json")
    if digest(corpus / "vol11-interlude-supplement.jsonl") != corpus_manifest["supplement_sha256"]:
        raise RuntimeError("图片插叙补录的 SHA-256 不符。")
    if corpus_manifest["book_count"] != 20 or {b["book"]: b["source_sha256"] for b in corpus_manifest["books"]} != inputs["epubs"]:
        raise RuntimeError("云盘 EPUB 与整理章节时使用的 20 本原作不一致。")
    print(json.dumps({k: v for k, v in corpus_manifest.items() if k not in {"books", "files", "artifacts"}}, ensure_ascii=False, indent=2))
    prepared = drive_runs / "prepared"
    """)
    insert("guide-train", "guide-teacher", "markdown", """
    ## 3.1. 在 A100 上逐段生成和核验问答

    教师逐段读取带编号的正文，提问并核对答案能否由证据支持，依次写入 `teacher/jobs/`。
    可设置 `PASSAGES_THIS_SESSION = 30` 分批完成；每次重新运行此节继续剩余片段。
    首次下载 14B 权重与生成都会花时间。预计时长以实测进度为准。
    首轮全部片段已有记录时，重跑本节会校验已有记录并用短输出格式补跑失败片段。
    默认每次并行生成 2 个片段并批量复核。显存不足会降到单条，已完成记录继续复用。
    本次恢复的总量下限为 850 条有效原文问答，验证集和测试集各至少 30 条，其余核验和覆盖要求沿用原设置。
    所有片段处理完并达到覆盖门槛后才会生成训练文件。
    """)
    insert("guide-train", "teacher", "code", """
    if "stop_comparison_worker" in globals():
        stop_comparison_worker()
    PASSAGES_THIS_SESSION = None  # None = 处理所有剩余片段，整数 = 本次最多处理多少片段
    RECOVERY_BATCH_SIZE = 2
    CACHE_TEACHER_ON_DRIVE = False  # 若要保留 ~30 GB 的公开教师权重，可改为 True
    original_teacher = drive_runs / "teacher"
    first_pass_manifest = original_teacher / "manifest.json"
    first_pass = load_json(first_pass_manifest) if first_pass_manifest.is_file() else {}
    recover_failed = (not first_pass.get("complete") and first_pass.get("passages_total", 0) > 0
                      and first_pass.get("passages_completed", 0) + first_pass.get("passages_failed", 0)
                      == first_pass["passages_total"])
    allow_unfinalized = (not first_pass and (original_teacher / "settings.json").is_file()
                        and sum(1 for _ in (original_teacher / "jobs").glob("*.json"))
                        == load_json(corpus / "manifest.json")["passage_count"])
    recover_failed = recover_failed or allow_unfinalized
    teacher = drive_runs / "teacher-recovered" if recover_failed else original_teacher
    teacher_manifest = teacher / "manifest.json"
    if not teacher_manifest.is_file() or not load_json(teacher_manifest).get("complete"):
        teacher_cache = (project / "models" if CACHE_TEACHER_ON_DRIVE else root) / "teacher-hf"
        download = """ + "'''" + """
    import sys
    from huggingface_hub import snapshot_download
    print(snapshot_download(repo_id="Qwen/Qwen2.5-14B-Instruct",
          revision="cf98f3b3bbb457ad9e2bb7baf9a0125b6b88caa8", cache_dir=sys.argv[1],
          allow_patterns=["*.json", "*.safetensors", "*.txt", "*.jinja", "LICENSE"], max_workers=4))
    """ + "'''" + """
        teacher_weights = (teacher_cache / "models--Qwen--Qwen2.5-14B-Instruct/snapshots/"
                           "cf98f3b3bbb457ad9e2bb7baf9a0125b6b88caa8")
        if not (teacher_weights / "model.safetensors.index.json").is_file() or not all(
            (teacher_weights / name).is_file() for name in set(load_json(teacher_weights / "model.safetensors.index.json")["weight_map"].values())
        ):
            run("-c", download, teacher_cache, log=drive_runs / "teacher-download.log")
        args = [] if PASSAGES_THIS_SESSION is None else ["--limit", str(PASSAGES_THIS_SESSION)]
        if recover_failed:
            recovery_script = project / "source/recover_chapter_teacher_batched.py"
            if digest(recovery_script) != "__RECOVERY_SHA256__":
                raise RuntimeError("恢复脚本的 SHA-256 不一致。")
            if allow_unfinalized:
                args += ["--allow-unfinalized"]
            run(recovery_script, "--passages", corpus / "passages.jsonl", "--original", original_teacher,
                "--model", teacher_weights, "--output", teacher, "--batch-size", RECOVERY_BATCH_SIZE,
                *args, log=drive_runs / "teacher-recovery.log")
        else:
            run("-m", "yuki_model.chapter_teacher", "--passages", corpus / "passages.jsonl",
                "--model", teacher_weights, "--output", teacher, *args, log=drive_runs / "teacher.log")
    if not teacher_manifest.is_file() or not load_json(teacher_manifest).get("complete"):
        raise SystemExit("生成进度已保存。请重新运行第 3.1 节，完成后再运行第 4 节。")

    replay = drive_runs / "rehearsal-v3"
    if not replay.exists():
        with tempfile.TemporaryDirectory(prefix=".rehearsal-", dir=drive_runs) as stage:
            candidate = Path(stage) / "data"
            run("scripts/build_distillation_sft.py", "--epubs", epubs, "--output", candidate,
                "--tokenizer", base, "--sequence-length", "1536", log=drive_runs / "rehearsal.log")
            candidate.rename(replay)
    if not prepared.exists():
        with tempfile.TemporaryDirectory(prefix=".assemble-", dir=drive_runs) as stage:
            candidate = Path(stage) / "data"
            run("-m", "yuki_model.chapter_dataset", "--corpus", corpus, "--teacher", teacher,
                "--replay", replay, "--character-pack", repo / "characters/yukino",
                "--tokenizer", base, "--output", candidate, "--sequence-length", "1536",
                "--min-source-rows", "850",
                log=drive_runs / "assemble.log")
            candidate.rename(prepared)
    data_manifest = load_json(prepared / "manifest.json")
    print("实际训练、验证、测试样本数：", data_manifest["examples"])
    print("数据来源：", data_manifest.get("origin_counts"))
    """.replace("__RECOVERY_SHA256__", recovery_hash))
    put("guide-train", """
    ## 4. 用 A100 续训，按轮保存断点

    第 3.1 节组装完成后才开始。最多 6 轮，保留每轮完整断点并按验证集选择最佳一轮。
    第一次训练按最长样本选择每批 4 条或 8 条。每次权重更新仍使用约 8 条样本，断点续跑沿用已保存的批量设置。
    更换会话后同样从第 1 节开始；参数相同会读取已有生成进度，并从最近完整训练断点继续。
    核验云盘中的最终适配器后，自动生成 15 轮对照报告，再同步云盘并释放当前 Colab 运行时。
    如需接着运行第 5～7 节，可以重新连接，或在第 4 节将 `RELEASE_AFTER_STAGE4` 设为 `False`。
    """)
    cells["train"].source = ('if not (drive_runs / "prepared/manifest.json").is_file():\n'
        '    raise SystemExit("请先完成第 3.1 节的生成和组装。")\n' + cells["train"].source)
    training = cells["train"].source
    config_check = 'if config_file.exists() and load_json(config_file) != config:'
    if config_check not in training:
        raise ValueError("v3 training config check changed; update the template adapter")
    cells["train"].source = training.replace(config_check, dedent('''
    A100_BATCH_SIZE = None  # 按样本长度选择，也可在首次训练前手动设为 2 或 4。
    if config_file.exists():
        saved_config = load_json(config_file)
        config.update(batch_size=saved_config["batch_size"],
                      gradient_accumulation_steps=saved_config["gradient_accumulation_steps"])
    else:
        longest = load_json(prepared / "manifest.json")["max_tokens"]
        batch = (8 if 0 < longest <= 768 else 4) if A100_BATCH_SIZE is None else A100_BATCH_SIZE
        if batch not in (2, 4, 8):
            raise ValueError("A100_BATCH_SIZE 请选择 None、2、4 或 8。")
        config.update(batch_size=batch, gradient_accumulation_steps=8 // batch)
    print("A100 每批样本数", config["batch_size"], "梯度累积次数", config["gradient_accumulation_steps"])
    ''').lstrip() + config_check, 1)
    cells["train"].source += dedent('''

    RELEASE_AFTER_STAGE4 = True
    MULTI_TURN_AFTER_STAGE4 = True
    verified = verify_run(persona_output, "distill_sft")
    final_status = {
        "training_completed": True,
        "adapter_path": str(persona_output / "adapter"),
        "adapter_sha256": verified["adapter_sha256"],
        "multi_turn": "disabled",
        "release_after_flush": RELEASE_AFTER_STAGE4,
    }
    if MULTI_TURN_AFTER_STAGE4:
        eval_archive = project / "source/yukino-v4-multi-turn-eval.zip"
        eval_output = drive_runs / "evaluation" / persona_output.name / "multi-turn"
        final_status["multi_turn_report"] = str(eval_output / "report.json")
        try:
            if digest(eval_archive) != "8ef48d3fafe37f84f013a2061fcd4405290dda796f6c0560a862a0b21e8b69ad":
                raise RuntimeError("多轮测试包的 SHA-256 不一致。")
            with tempfile.TemporaryDirectory(prefix="multi-turn-eval-", dir=root) as temp:
                tools_dir = Path(temp)
                with ZipFile(eval_archive) as archive:
                    if sorted(archive.namelist()) != ["cases.json", "evaluate_distillation.py", "evaluate_multi_turn.py"]:
                        raise RuntimeError("多轮测试包的文件列表不一致。")
                    archive.extractall(tools_dir)
                run(tools_dir / "evaluate_multi_turn.py", "--cases", tools_dir / "cases.json",
                    "--character-pack", repo / "characters/yukino", "--model", base,
                    "--before-adapter", initial_snapshot / "adapter",
                    "--after-adapter", persona_output / "adapter", "--device", "cuda",
                    "--output", eval_output, log=drive_runs / "multi-turn.log")
            evaluation = load_json(eval_output / "report.json")
            if not evaluation.get("generation_completed") or evaluation.get("completed_turn_pairs") != 15:
                raise RuntimeError("多轮评测没有生成全部 15 组回答。")
            if (evaluation["generation_sha256"] != digest(eval_output / "generations.jsonl")
                    or evaluation["configuration_sha256"] != digest(eval_output / "evaluation_config.json")
                    or (eval_output / "comparison.html").stat().st_size == 0):
                raise RuntimeError("多轮评测文件校验失败。")
            final_status["multi_turn"] = "completed"
        except Exception as error:
            final_status["multi_turn"] = "failed"
            final_status["multi_turn_error"] = str(error)
            print("多轮测试中断。模型已保存在云盘，详见 multi-turn.log。", flush=True)
    save_json(persona_output / "finish-status.json", final_status)
    if RELEASE_AFTER_STAGE4:
        from google.colab import drive, runtime
        print("正在同步已验证的模型、断点和报告，然后释放当前 Colab 运行时。", flush=True)
        drive.flush_and_unmount(timeout_ms=300_000)
        runtime.unassign()
    ''')
    put("guide-evaluate", """
    ## 5. 在保留章节上对比续训前后

    用同一基座和角色提示生成两份答案。新生成的第 5 卷问答用于验证，第 10 卷问答只用于最终测试。
    旧模型或复习样本可能已经接触过其中某些事实；原文证据可在数据文件中回查。
    人格回归题另外出报告。请抽查答错、猜错因果、人物混淆的案例。
    """)
    cells["compare-setup"].source = cells["compare-setup"].source.replace(
        'verify_run(initial_snapshot, "complete_persona")', 'verify_run(initial_snapshot, INITIAL_TASK)')
    put("guide-compare", """
    ## 7. 双模型问答前端

    左边是此次续训起点，右边是本轮按章续训后的模型。
    每行一题，最多 12 道。支持连续对话和保存问答至 Drive。
    """)
    put("paths", """
    ## 文件位置与恢复

    `MyDrive/Yukino-Companion/retrain/epub-a100-v4-chapters/`：

    - `corpus/`：章节、分段和提取清单；`teacher/`：逐段生成记录、问答及进度。
    - `initial/`：起始 LoRA；`prepared/`：训练、验证、测试和数据清单。
    - `distill-01/`：完整断点、最佳 `adapter/`、训练报告。
    - `evaluation/`：同题对比；`distill-01-gguf/`：可选导出的离线模型。

    断线后保持 `RUN_ID` 不变，重新运行 1、2、3、3.1，继续没有完成的步骤。
    """)
    nbf.validate(nb)
    for cell in nb.cells:
        if cell.cell_type == "code":
            compile(cell.source, cell.id, "exec")
    output = notebooks / "yukino-a100-chapters-v4.ipynb"
    nbf.write(nb, output)
    (notebooks / "A100-原作章节续训v4说明.md").write_text(
        "\n\n".join(c.source.strip() for c in nb.cells if c.cell_type == "markdown") + "\n", encoding="utf-8")
    print(output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-sha256", required=True)
    parser.add_argument("--corpus-sha256", required=True)
    args = parser.parse_args()
    if not all(re.fullmatch("[a-f0-9]{64}", value) for value in (args.source_sha256, args.corpus_sha256)):
        parser.error("Both archive SHA-256 digests are required")
    build(args.source_sha256, args.corpus_sha256)
