"""Verify the delivered adapter and index against the package manifest."""

import json
from pathlib import Path

from yuki_model.io import file_sha

root = Path.cwd().resolve()
manifest = json.loads((root / "MODEL_MANIFEST.json").read_text())
for name, digest in manifest["files"].items():
    target = (root / name).resolve()
    if not target.is_relative_to(root):
        raise ValueError("Unsafe manifest path")
    if not target.is_file() or file_sha(target) != digest:
        raise RuntimeError("Missing or damaged file: " + name)
print("Adapter and knowledge index checksums verified.")
