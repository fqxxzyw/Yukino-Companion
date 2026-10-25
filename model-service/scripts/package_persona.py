"""Package one completed persona adapter, shared card and optional base weights.

This does not approve model quality or publish anything. Novel files, indexes,
checkpoints, credentials and previous adapters are intentionally outside the
explicit package inventory.
"""

import argparse
import hashlib
import json
import os
import tempfile
import zipfile
from pathlib import Path

from yuki_model.io import file_sha
from yuki_model.persona import load_character
from yuki_model.training import BASE, REVISION


def package_persona(root, adapter, character_pack, output, base=None):
    root, adapter, character_pack, output = map(
        lambda p: Path(p).resolve(), (root, adapter, character_pack, output)
    )
    if output.exists():
        raise ValueError("Output exists; choose a new package name")
    if (
        output.is_relative_to(root)
        or output.is_relative_to(adapter)
        or output.is_relative_to(character_pack)
    ):
        raise ValueError("Package output must be outside source directories")
    run = adapter.parent
    required = [
        adapter / "adapter_model.safetensors",
        adapter / "adapter_config.json",
        run / "training_report.json",
        run / "run_config.json",
        run / "data_provenance.json",
    ]
    if any(not file.is_file() for file in required):
        raise ValueError(
            "A completed persona run with actual adapter weights and provenance is required"
        )
    report = json.loads((run / "training_report.json").read_text())
    config = json.loads((run / "run_config.json").read_text())
    provenance = json.loads((run / "data_provenance.json").read_text())
    if (
        not report.get("completed")
        or report.get("base_revision") != REVISION
        or config.get("task") != "complete_persona"
        or report.get("task") != "complete_persona"
        or config.get("run_purpose", "training") != "training"
        or report.get("run_purpose", "training") != "training"
    ):
        raise ValueError(
            "Run is not a completed compatible persona training run; smoke weights cannot be packaged"
        )
    if report.get("adapter_sha256") != file_sha(adapter / "adapter_model.safetensors"):
        raise ValueError("Adapter weights do not match the completed training report")
    _, card = load_character(character_pack)
    if (
        provenance.get("persona_manifest", {}).get("character", {}).get("pack_sha256")
        != card["pack_sha256"]
    ):
        raise ValueError(
            "Character pack changed since training; rebuild/review explicitly before packaging"
        )
    inventory = {}
    for directory in ("yuki_model", "scripts", "configs", "docs"):
        for file in (root / directory).rglob("*"):
            if (
                file.is_file()
                and file.suffix in {".py", ".ps1", ".bat", ".json", ".md", ".txt"}
                and "__pycache__" not in file.parts
            ):
                inventory["model-service/" + file.relative_to(root).as_posix()] = file
    for name in ("pyproject.toml", "README.md"):
        inventory["model-service/" + name] = root / name
    for file in adapter.iterdir():
        if file.is_file() and file.suffix in {".json", ".safetensors", ".txt", ".md"}:
            inventory[
                "model-service/outputs/yukino-persona-v1/adapter/" + file.name
            ] = file
    for name in ("training_report.json", "run_config.json", "data_provenance.json"):
        inventory["model-service/outputs/yukino-persona-v1/" + name] = run / name
    for file in character_pack.rglob("*"):
        if file.is_file() and file.suffix in {".md", ".json"}:
            inventory[
                "characters/yukino/" + file.relative_to(character_pack).as_posix()
            ] = file
    if base:
        base = Path(base).resolve()
        if output.is_relative_to(base):
            raise ValueError("Package output must be outside base model directory")
        proof_path = base / "BASE_PROVENANCE.json"
        if not proof_path.is_file():
            raise ValueError(
                "Base snapshot needs BASE_PROVENANCE.json; rerun the pinned yuki-model download command"
            )
        proof = json.loads(proof_path.read_text())
        if proof.get("base_model") != BASE or proof.get("base_revision") != REVISION:
            raise ValueError(
                "Base snapshot provenance does not match the adapter base revision"
            )
        base_files = {
            file.name: file
            for file in base.iterdir()
            if file.is_file()
            and file.name != "BASE_PROVENANCE.json"
            and (
                file.suffix in {".json", ".safetensors", ".txt", ".md"}
                or file.name == "LICENSE"
            )
        }
        if set(base_files) != set(proof.get("files", {})) or any(
            file_sha(file) != proof["files"][name] for name, file in base_files.items()
        ):
            raise ValueError(
                "Base snapshot files differ from pinned download provenance"
            )
        for name in (
            "config.json",
            "tokenizer.json",
            "tokenizer_config.json",
            "LICENSE",
        ):
            if not (base / name).is_file():
                raise ValueError("Base snapshot is missing " + name)
        if not list(base.glob("*.safetensors")):
            raise ValueError("Base snapshot has no model weights")
        for file in base.iterdir():
            if file.is_file() and (
                file.suffix in {".json", ".safetensors", ".txt", ".md"}
                or file.name == "LICENSE"
            ):
                inventory["model-service/models/base/" + file.name] = file
    serve = json.loads((root / "configs/serve-persona.json").read_text())
    serve.update(
        model="models/base",
        adapter="outputs/yukino-persona-v1/adapter",
        character_pack="../characters/yukino",
        index=None,
        default_use_knowledge=False,
    )
    generated = {
        "model-service/configs/serve-persona.json": json.dumps(
            serve, ensure_ascii=False, indent=2
        ).encode()
    }
    generated["model-service/scripts/start_persona.bat"] = (
        b'@echo off\r\ncd /d "%~dp0\\.."\r\n.venv\\Scripts\\python.exe -m yuki_model serve --config configs/serve-persona.json\r\nif errorlevel 1 pause\r\n'
    )
    for name in generated:
        inventory.pop(name, None)
    manifest = {
        "schema_version": 1,
        "task": "complete_persona",
        "base_model": BASE,
        "base_revision": REVISION,
        "base_included": bool(base),
        "character": card,
        "training_completed": True,
        "personality_accepted": False,
        "quality_notice": "Training completion is not human character-fidelity acceptance. Review separate paired evaluation outputs.",
        "files": {name: file_sha(file) for name, file in sorted(inventory.items())},
    }
    manifest["files"].update(
        {name: hashlib.sha256(data).hexdigest() for name, data in generated.items()}
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(
        prefix="persona-package-", suffix=".partial", dir=output.parent
    )
    try:
        with os.fdopen(fd, "w+b") as stream:
            with zipfile.ZipFile(
                stream, "w", zipfile.ZIP_DEFLATED, compresslevel=1
            ) as archive:
                for name, file in sorted(inventory.items()):
                    archive.write(file, name)
                for name, data in generated.items():
                    archive.writestr(name, data)
                archive.writestr(
                    "PERSONA_MANIFEST.json",
                    json.dumps(manifest, ensure_ascii=False, indent=2),
                )
            stream.flush()
            os.fsync(stream.fileno())
        with zipfile.ZipFile(temporary) as archive:
            if archive.testzip():
                raise RuntimeError("Package CRC verification failed")
        os.replace(temporary, output)
    finally:
        Path(temporary).unlink(missing_ok=True)
    return {
        "path": str(output),
        "bytes": output.stat().st_size,
        "sha256": file_sha(output),
        "base_included": bool(base),
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--adapter", default="outputs/yukino-persona-v1/adapter")
    p.add_argument("--character-pack", default="../characters/yukino")
    p.add_argument(
        "--base",
        help="Optional complete local base snapshot. Omit to download the pinned base after installation.",
    )
    p.add_argument("--output", required=True)
    a = p.parse_args()
    print(
        json.dumps(
            package_persona(Path.cwd(), a.adapter, a.character_pack, a.output, a.base),
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
