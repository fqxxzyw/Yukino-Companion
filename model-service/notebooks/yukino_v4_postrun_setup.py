"""Paste into a Colab cell to restore the finished v4 run for sections 6 and 7."""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import tomllib
from hashlib import sha256
from importlib.metadata import version
from pathlib import Path
from zipfile import ZipFile

from google.colab import drive


RUN_ID = "epub-a100-v4-chapters"
INITIAL_RUN = "epub-a100-v1"
INITIAL_TASK = "complete_persona"
base_revision = "989aa7980e4cf806f80c7fef2b1adb7bc71aa306"
source_hash = "034ae00d84037a9baf54f7b46e25d53ba421be094fa18ec44a1e384e6ac31b13"


def digest(path):
    value = sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(8 * 1024**2), b""):
            value.update(block)
    return value.hexdigest()


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def save_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def inventory(directory):
    return {p.relative_to(directory).as_posix(): digest(p) for p in sorted(directory.rglob("*"))
            if p.is_file() and p.name != "artifacts.json"}


def publish_directory(local, final):
    final.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".publish-", dir=final.parent) as staging:
        candidate = Path(staging) / final.name
        shutil.copytree(local, candidate)
        if inventory(candidate) != inventory(local):
            raise RuntimeError("复制后的 Drive 文件校验失败。")
        candidate.rename(final)


def verify_run(output, task):
    report_path = output / "training_report.json"
    adapter = output / "adapter/adapter_model.safetensors"
    if not report_path.is_file() or not adapter.is_file():
        raise FileNotFoundError(f"在 Drive 找不到训练报告或已保存的 LoRA：{output}")
    report = load_json(report_path)
    if not (report.get("completed") is True and report.get("run_purpose") == "training"
            and report.get("task") == task and report.get("base_revision") == base_revision
            and report.get("device") == "cuda" and report.get("dtype") == "torch.bfloat16"
            and report.get("steps", 0) > 1 and report.get("adapter_sha256") == digest(adapter)):
        raise RuntimeError(f"训练报告或 LoRA 权重校验失败：{output}")
    return report


if not Path("/content/drive/MyDrive").is_dir():
    drive.mount("/content/drive")
project = Path("/content/drive/MyDrive/Yukino-Companion")
drive_runs = project / "retrain" / RUN_ID
initial_snapshot = drive_runs / "initial"
persona_output = drive_runs / "distill-01"
prepared = drive_runs / "prepared"
base = project / "models/qwen2.5-1.5b-instruct-989aa798"
root = Path("/content/yukino-chapter-v4-runtime")
root.mkdir(exist_ok=True)

for output, task, weight_sha, config_sha in (
    (initial_snapshot, INITIAL_TASK,
     "5e29fa283d26105a9eed055fd2049b17a94e72dfe35c0c1d4db79a3b3a014c28",
     "5a7d6ef743fc46893c530cbb30749eb160aab4d5d8cc53b4970fc0d4b600a60e"),
    (persona_output, "distill_sft",
     "dec8de19e23531b959fde4e5ab8c9567d8a682afda682faae0130f2c6b1c9229",
     "371fb4a4304ca81d74f1f18af8bd095231b25b74c164b342bc0cb27062322ed5"),
):
    report = verify_run(output, task)
    if report["adapter_sha256"] != weight_sha or digest(output / "adapter/adapter_config.json") != config_sha:
        raise RuntimeError(f"LoRA 与本轮完成训练时记录的 SHA-256 不符：{output}")

base_proof = load_json(base / "BASE_PROVENANCE.json")
if (base_proof.get("base_revision") != base_revision
        or base_proof["files"].get("model.safetensors") != "dd924a11b4c220f385b51ffa522daea7c9f3d850e31b162bb5661df483c6d3ee"):
    raise RuntimeError("Drive 上的底座与训练时使用的固定版本不符。")
for name, expected in base_proof["files"].items():
    if Path(name).name != name or digest(base / name) != expected:
        raise RuntimeError(f"底座文件 SHA-256 不符：{name}")

source_archive = project / "source/training-source-chapter-v4.zip"
if digest(source_archive) != source_hash:
    raise RuntimeError("Drive 源码归档的 SHA-256 不符。")
repo = root / ("chapter-v4-" + source_hash[:12])
with ZipFile(source_archive) as archive:
    entries = archive.infolist()
    for item in entries:
        path = Path(item.filename)
        if path.is_absolute() or ".." in path.parts:
            raise ValueError("源码归档含有不安全路径。")
    if not repo.exists():
        with tempfile.TemporaryDirectory(prefix=".source-", dir=root) as stage:
            candidate = Path(stage) / "source"
            archive.extractall(candidate)
            candidate.rename(repo)
    for item in entries:
        if not item.is_dir() and (repo / item.filename).read_bytes() != archive.read(item):
            raise RuntimeError(f"运行时源码副本与归档不符：{item.filename}")
service = repo / "model-service"

venv = root / "venv-no-ensurepip"
python = venv / "bin/python"


def run(*args, cwd=service, log=None, interpreter=None):
    command = [str(interpreter or python), *(str(a) for a in args)]
    env = dict(os.environ, USE_TF="0", USE_TORCH="1", PYTHONPATH=str(service), PYTHONUNBUFFERED="1")
    log_path = Path(log or drive_runs / "postrun-environment.log")
    with log_path.open("a", encoding="utf-8", buffering=1) as stream:
        with subprocess.Popen(command, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                              text=True, encoding="utf-8", errors="replace", bufsize=1) as process:
            for line in process.stdout:
                print(line, end="", flush=True)
                stream.write(line)
            if process.wait():
                raise subprocess.CalledProcessError(process.returncode, command)


if not python.is_file():
    run("-m", "venv", "--system-site-packages", "--without-pip", venv, interpreter=sys.executable)
ready = venv / "deps-ready"
if not ready.exists():
    config = tomllib.loads((service / "pyproject.toml").read_text(encoding="utf-8"))["project"]
    dependencies = config["dependencies"] + [p for p in config["optional-dependencies"]["train"]
                                               if not p.startswith("torch")]
    constraints = root / "colab-torch-constraint.txt"
    constraints.write_text("torch==" + version("torch") + "\n", encoding="utf-8")
    run("-m", "pip", "--python", python, "install", "--disable-pip-version-check", "--retries", "3",
        "--timeout", "60", "--constraint", constraints, *dependencies, interpreter=sys.executable)

run("-c", "import torch; from transformers import AutoModelForCausalLM; from peft import PeftModel; "
    "from yuki_model.persona import load_character; from yuki_model.training import merge; "
    "print('推理设备', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU')")
ready.touch()
print("已校验 Drive 上训练前后的 LoRA，可以运行第 6 节导出或第 7.1、7.2 节对比。")
