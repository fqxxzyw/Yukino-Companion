"""Build a source-only inference component from an audited upstream revision.

python inference/prepare_runtime.py --source D:/GPT-SoVITS --output D:/YukinoInference
Weights, Python, CUDA and FFmpeg are deliberately not copied or downloaded.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

UPSTREAM = "https://github.com/RVC-Boss/GPT-SoVITS"
REVISION = "b4570b876f5c086819ba84e3215472733c6a7b70"
INCLUDE = [
    "LICENSE", "GPT_SoVITS/TTS_infer_pack", "GPT_SoVITS/AR", "GPT_SoVITS/BigVGAN",
    "GPT_SoVITS/feature_extractor", "GPT_SoVITS/module", "GPT_SoVITS/text", "GPT_SoVITS/f5_tts",
    "GPT_SoVITS/eres2net", "GPT_SoVITS/Accel", "GPT_SoVITS/process_ckpt.py", "GPT_SoVITS/utils.py",
    "GPT_SoVITS/sv.py", "tools/__init__.py", "tools/i18n", "tools/portable_runtime.py",
    "tools/acceleration.py", "tools/audio_sr.py", "tools/AP_BWE_main", "tools/my_utils.py",
]
EXCLUDED = {".git", "__pycache__", "vendor", "pretrained_models", "runtime"}
WEIGHTS = {".pth", ".pt", ".ckpt", ".onnx", ".safetensors", ".dll", ".exe", ".zip", ".pyc"}


def prepare(source, output):
    source = Path(source).resolve(); output = Path(output).resolve()
    if source == output or source in output.parents or output in source.parents:
        raise ValueError("输出目录必须独立于原工程")
    if output.exists():
        raise ValueError("输出目录已存在；请选择新的目录，避免覆盖资源")
    revision = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
    if revision != REVISION:
        raise ValueError(f"请先 checkout 已核对的上游版本 {REVISION}；当前为 {revision}")
    dirty = subprocess.check_output(["git", "-C", str(source), "status", "--porcelain", "--untracked-files=no"], text=True)
    if dirty.strip():
        raise ValueError("上游源码存在已跟踪文件修改，请使用干净的固定版本副本")
    missing = [item for item in INCLUDE if not (source / item).exists()]
    if missing:
        raise ValueError(f"上游目录不完整：{missing}")
    output.mkdir(parents=True)
    copied = []
    for item in INCLUDE:
        entry = source / item
        for file in sorted(entry.rglob('*')) if entry.is_dir() else [entry]:
            rel = file.relative_to(source)
            if not file.is_file() or file.is_symlink() or EXCLUDED.intersection(rel.parts) or file.suffix.lower() in WEIGHTS:
                continue
            dest = output / rel; dest.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(file, dest)
            copied.append({"path": rel.as_posix(), "sha256": hashlib.sha256(dest.read_bytes()).hexdigest(), "bytes": dest.stat().st_size})
    (output / 'GPT_SoVITS/configs').mkdir(exist_ok=True)
    manifest = {"upstream": UPSTREAM, "revision": revision, "kind": "inference-source-only", "files": copied}
    (output / 'yukino-runtime.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True); parser.add_argument('--output', required=True)
    args = parser.parse_args()
    result = prepare(args.source, args.output)
    print(f"Prepared {len(result['files'])} source files; no training entrypoints or weights copied.")
