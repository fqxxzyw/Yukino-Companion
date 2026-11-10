"""Colab v4 step 3.1: install the verified 480-passage dataset from Drive."""

import json
import tempfile
from hashlib import sha256
from pathlib import Path
from zipfile import ZipFile


def install_skip_dataset(bundle, project, drive_runs, corpus, prepared):
    if (drive_runs != project / "retrain/epub-a100-v4-chapters"
            or corpus != drive_runs / "corpus" or prepared != drive_runs / "prepared"):
        raise RuntimeError("请先运行 v4 第 1～3 节，并保留原 RUN_ID。")

    # Colab may leave a subprocess alive after the cell is interrupted.
    for entry in Path("/proc").glob("[0-9]*/cmdline"):
        try:
            args = entry.read_bytes().split(b"\0")
        except OSError:
            continue
        if b"yuki_model.chapter_teacher" in args or any(
            Path(arg.decode(errors="replace")).name in {
                "recover_chapter_teacher.py", "recover_chapter_teacher_batched.py",
            } for arg in args
        ):
            raise RuntimeError("旧 3.1 的生成进程还在运行。请先停止旧 3.1，再运行本节。")

    def digest(path):
        return sha256(path.read_bytes()).hexdigest()

    with ZipFile(bundle) as archive:
        manifest_bytes = archive.read("prepared/manifest.json")
        manifest = json.loads(manifest_bytes)
        coverage = manifest["coverage"]
        if (coverage["teacher_passages_completed"], coverage["teacher_passages_omitted"]) != (480, 76):
            raise RuntimeError("数据包不是此轮的 480 片段快照。")
        teacher = drive_runs / "teacher"
        teacher_manifest = json.loads((teacher / "manifest.json").read_bytes())
        if (digest(corpus / "manifest.json") != manifest["input_manifests_sha256"]["corpus"]
                or digest(corpus / "passages.jsonl") != teacher_manifest["passages_sha256"]
                or digest(teacher / "manifest.json") != manifest["input_manifests_sha256"]["teacher"]
                or digest(teacher / "qa.jsonl") != teacher_manifest["qa_sha256"]):
            raise RuntimeError("云盘原文或首轮问答已变动，停止以免使用错误的数据。")

        artifacts = manifest["artifacts"]
        if any(Path(name).name != name for name in artifacts):
            raise RuntimeError("数据包文件名无效。")
        files = {**artifacts, "manifest.json": sha256(manifest_bytes).hexdigest()}
        if prepared.exists():
            if any(not (prepared / name).is_file() or digest(prepared / name) != expected
                   for name, expected in files.items()):
                raise RuntimeError("云盘已有不同的 prepared 数据，已保留原目录。")
        else:
            with tempfile.TemporaryDirectory(prefix=".prepared-skip-", dir=drive_runs) as temp:
                candidate = Path(temp) / "prepared"
                candidate.mkdir()
                for name, expected in files.items():
                    content = archive.read(f"prepared/{name}")
                    if sha256(content).hexdigest() != expected:
                        raise RuntimeError(f"数据文件校验失败：{name}")
                    (candidate / name).write_bytes(content)
                if prepared.exists():
                    raise RuntimeError("另一个会话正在写入 prepared。")
                candidate.rename(prepared)
    print("3.1 完成：复用 480 个片段，跳过 76 个失败片段；原文和旧记录仍在云盘。", flush=True)
    print("训练 / 验证 / 测试：", manifest["examples"], flush=True)
    print("数据位置：", prepared, flush=True)
    return manifest


data_manifest = install_skip_dataset(bundle, project, drive_runs, corpus, prepared)
