"""Create an atomic, verified private handoff ZIP. Do not publish it to GitHub."""

import argparse
import json
import os
import tempfile
import zipfile
from pathlib import Path

from yuki_model.io import file_sha, save_json
from yuki_model.training import BASE, REVISION


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root = Path.cwd().resolve()
    run = root / "outputs/yukino-1.5b-knowledge-v1"
    report = json.loads((run / "training_report.json").read_text())
    if not report.get("completed"):
        raise RuntimeError("Training has not completed")
    selected = list((run / "adapter").glob("*")) + [
        root / "data/processed/knowledge.sqlite"
    ]
    save_json(
        root / "MODEL_MANIFEST.json",
        {
            "base_model": BASE,
            "base_revision": REVISION,
            "weights": "One adapter for CPU/CUDA/MPS; no retraining per device.",
            "files": {
                str(f.relative_to(root)): file_sha(f) for f in selected if f.is_file()
            },
        },
    )
    output = args.output.resolve()
    if output.is_relative_to(root):
        raise ValueError("Place ZIP outside model-service")
    output.parent.mkdir(parents=True, exist_ok=True)
    excluded = {
        "models",
        ".venv",
        ".pytest_cache",
        ".ruff_cache",
        "__pycache__",
        "yukino_model_service.egg-info",
        "logs",
    }
    files = []
    for file in root.rglob("*"):
        rel = file.relative_to(root)
        if (
            not file.is_file()
            or any(x in rel.parts for x in excluded)
            or file.suffix in {".log", ".epub", ".pyc"}
        ):
            continue
        if rel.parts[0] == "outputs" and (
            not file.is_relative_to(run)
            or any(x.startswith("checkpoint-") for x in rel.parts)
        ):
            continue
        files.append(file)
    fd, temporary = tempfile.mkstemp(
        prefix="model-package-", suffix=".partial", dir=output.parent
    )
    try:
        with os.fdopen(fd, "w+b") as stream:
            with zipfile.ZipFile(
                stream, "w", zipfile.ZIP_DEFLATED, compresslevel=6
            ) as archive:
                for file in sorted(files):
                    archive.write(file, "model-service/" + str(file.relative_to(root)))
            stream.flush()
            os.fsync(stream.fileno())
        with zipfile.ZipFile(temporary) as archive:
            bad = archive.testzip()
            if bad:
                raise RuntimeError("ZIP CRC failed: " + bad)
        os.replace(temporary, output)
    finally:
        Path(temporary).unlink(missing_ok=True)
    print(
        json.dumps(
            {
                "path": str(output),
                "bytes": output.stat().st_size,
                "sha256": file_sha(output),
            }
        )
    )


if __name__ == "__main__":
    main()
