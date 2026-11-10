"""Package the exact reviewed training source (no weights or private EPUBs)."""
import argparse
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED


def package(destination, purpose="yukino-distillation-v3"):
    root = Path(__file__).resolve().parents[2]
    paths = []
    for directory in ("model-service/yuki_model", "model-service/scripts", "model-service/configs",
                      "model-service/persona-data", "model-service/distill-data", "model-service/tests",
                      "model-service/docs", "characters/yukino"):
        paths.extend(p for p in (root / directory).rglob("*") if p.is_file()
                     and p.suffix in {".py", ".json", ".jsonl", ".md", ".txt", ".cjs", ".ps1", ".bat"}
                     and "__pycache__" not in p.parts)
    paths.extend([root / "model-service/pyproject.toml", root / "model-service/README.md",
                  root / "model-service/notebooks/yukino-a100-multiepoch.ipynb"])
    if purpose == "yukino-chapter-distillation-v4":
        paths.append(root / "model-service/notebooks/yukino-a100-distill-v3.ipynb")
    payload = {p.relative_to(root).as_posix(): p.read_bytes() for p in sorted(set(paths))}
    manifest = {
        "format": 1, "purpose": purpose, "original_base_commit": "e846aa4c32cc2cc657e05ddc839372690bdbf18b",
        "source": "Working-tree snapshot including continued-training checkpoint support and hard labels",
        "files": {name: hashlib.sha256(data).hexdigest() for name, data in payload.items()},
        "private_epubs_included": False, "weights_included": False,
    }
    payload["SOURCE_MANIFEST.json"] = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(destination, "w", compression=ZIP_DEFLATED, compresslevel=9) as z:
        for name, data in sorted(payload.items()):
            entry = ZipInfo(name, date_time=(2026, 11, 4, 0, 0, 0))
            entry.compress_type = ZIP_DEFLATED
            z.writestr(entry, data)
    with ZipFile(destination) as z:
        assert z.testzip() is None
        assert all(z.read(name) == data for name, data in payload.items())
    print(json.dumps({"path": str(destination.resolve()), "files": len(payload), "bytes": destination.stat().st_size,
                      "sha256": hashlib.sha256(destination.read_bytes()).hexdigest()}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--purpose", choices=("yukino-distillation-v3", "yukino-chapter-distillation-v4"), default="yukino-distillation-v3")
    args = parser.parse_args()
    package(args.output, args.purpose)
