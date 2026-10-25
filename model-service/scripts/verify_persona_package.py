"""Run from model-service after extracting a persona package next to characters/."""

import json
from pathlib import Path

from yuki_model.io import file_sha

root = Path.cwd().resolve().parent
manifest = json.loads((root / "PERSONA_MANIFEST.json").read_text(encoding="utf-8"))
for name, digest in manifest["files"].items():
    target = (root / name).resolve()
    if (
        not target.is_relative_to(root)
        or not target.is_file()
        or file_sha(target) != digest
    ):
        raise ValueError("Missing, unsafe or damaged persona package file: " + name)
print("Persona package integrity verified. This does not certify model personality.")
