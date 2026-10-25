import argparse
import json
import sys
from pathlib import Path


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="command", required=True)
    sub.add_parser("doctor")
    d = sub.add_parser("download")
    d.add_argument("--output", default="models/base")
    e = sub.add_parser("prepare")
    e.add_argument("--input", required=True)
    e.add_argument("--output", default="data/processed")
    i = sub.add_parser("index")
    i.add_argument("--input", default="data/processed/chunks.jsonl")
    i.add_argument("--output", default="data/processed/knowledge.sqlite")
    i.add_argument("--splits", nargs="+", choices=["train", "val", "test"])
    t = sub.add_parser("train")
    t.add_argument("--config", default="configs/train-sft.json")
    t.add_argument("--resume")
    t.add_argument("--output")
    s = sub.add_parser("serve")
    s.add_argument("--config", default="configs/serve.json")
    m = sub.add_parser("merge")
    m.add_argument("--base", default="models/base")
    m.add_argument("--adapter", required=True)
    m.add_argument("--output", default="outputs/merged")
    a = p.parse_args()
    try:
        if a.command == "doctor":
            from .hardware import detect

            print(json.dumps(detect(), ensure_ascii=False, indent=2))
        elif a.command == "download":
            from huggingface_hub import snapshot_download

            from .training import BASE, REVISION
            from .io import file_sha, save_json

            downloaded = Path(
                snapshot_download(
                    BASE,
                    revision=REVISION,
                    local_dir=a.output,
                    allow_patterns=[
                        "*.json",
                        "*.safetensors",
                        "*.txt",
                        "LICENSE",
                        "README.md",
                    ],
                    max_workers=3,
                )
            )
            save_json(
                downloaded / "BASE_PROVENANCE.json",
                {
                    "base_model": BASE,
                    "base_revision": REVISION,
                    "created_by": "yuki-model download (pinned snapshot)",
                    "files": {
                        file.name: file_sha(file)
                        for file in sorted(downloaded.iterdir())
                        if file.is_file()
                        and file.name != "BASE_PROVENANCE.json"
                        and (
                            file.suffix in {".json", ".safetensors", ".txt", ".md"}
                            or file.name == "LICENSE"
                        )
                    },
                },
            )
            print(downloaded)
        elif a.command == "prepare":
            from .corpus import prepare

            print(json.dumps(prepare(a.input, a.output), ensure_ascii=False, indent=2))
        elif a.command == "index":
            from .retrieval import index

            print(index(a.input, a.output, a.splits))
        elif a.command == "train":
            from .training import train

            c = json.loads(Path(a.config).read_text(encoding="utf-8-sig"))
            if a.resume:
                c["resume"] = a.resume
            if a.output:
                c["output_dir"] = a.output
            print(json.dumps(train(c), ensure_ascii=False, indent=2))
        elif a.command == "merge":
            from .training import merge

            merge(a.base, a.adapter, a.output)
            print(a.output)
        elif a.command == "serve":
            import uvicorn

            from .server import create_app

            c = json.loads(Path(a.config).read_text(encoding="utf-8-sig"))
            uvicorn.run(
                create_app(c),
                host=c.get("host", "127.0.0.1"),
                port=c.get("port", 8765),
                workers=1,
            )
    except (ValueError, RuntimeError, FileNotFoundError, ImportError) as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    return 0
