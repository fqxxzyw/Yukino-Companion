"""Shared complete character card, grouped synthetic SFT and review signals.

Build/check success is not canon verification, human acceptance, or proof that
trained weights reproduce a fictional personality.
"""

import json
import math
import re
from collections import Counter
from pathlib import Path

from .io import file_sha, read_jsonl, save_json, save_jsonl, sha


def _resource(root, relative):
    if not isinstance(relative, str):
        raise ValueError("Character resource path must be text")
    path = (root / relative).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise ValueError("Missing or unsafe character-pack resource: " + relative)
    return path


def load_character(pack, mode="compact"):
    root = Path(pack).resolve()
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("schema_version") != 2 or manifest.get("id") != "yukino":
        raise ValueError("Unsupported unified character-pack schema/id")
    keys = {
        "compact": "compact_path",
        "detailed": "runtime_path",
        "training": "training_path",
    }
    if mode not in keys:
        raise ValueError("Unknown character prompt mode")
    text = _resource(root, manifest[keys[mode]]).read_text(encoding="utf-8").strip()
    if not text:
        raise ValueError("Empty character instructions")
    resources = sorted(
        p for p in root.rglob("*") if p.is_file() and p.suffix in {".md", ".json"}
    )
    hashes = {str(p.relative_to(root)): file_sha(p) for p in resources}
    provenance = {
        "character_id": manifest["id"],
        "character_version": manifest["version"],
        "prompt_mode": mode,
        "prompt_sha256": sha(text),
        "pack_sha256": sha(json.dumps(hashes, sort_keys=True)),
        "resources": hashes,
    }
    return text, provenance


def normalize_prompt(value):
    return re.sub(r"[^\w\u3400-\u9fff]", "", value.casefold())


def valid_review(row):
    return (
        row.get("review_status") == "assistant-reviewed"
        and row.get("human_reviewed") is False
    ) or (
        row.get("review_status") == "human-reviewed"
        and row.get("human_reviewed") is True
    )


def build_persona(
    source,
    pack,
    dest,
    *,
    seed=42,
    mode="training",
    tokenizer=None,
    sequence_length=1024,
):
    rows = list(read_jsonl(source))
    if len(rows) < 10:
        raise ValueError("At least ten independent scenario families are required")
    families = set()
    prompts = {}
    for row in rows:
        family = row["family_id"]
        if not isinstance(family, str) or not family or family in families:
            raise ValueError("Duplicate/invalid scenario family")
        families.add(family)
        if row.get("provenance") != "synthetic_original" or not valid_review(row):
            raise ValueError(
                "Seed provenance and review status must honestly identify synthetic examples"
            )
        variants = row["variants"]
        if len(variants) < 3 or len({v["variant_id"] for v in variants}) != len(
            variants
        ):
            raise ValueError("Each family requires at least three distinct variants")
        answers = []
        for variant in variants:
            user = normalize_prompt(variant["user"])
            if not user or user in prompts and prompts[user] != family:
                raise ValueError("Duplicate normalized user scenario across families")
            prompts[user] = family
            answer = variant["response"]
            if not isinstance(answer, str) or not answer.strip():
                raise ValueError("Empty variant response")
            answers.append(answer)
        if len(set(answers)) != len(variants):
            raise ValueError("Variants need distinct responses, not copies")
    ordered = sorted(families, key=lambda key: sha(f"{seed}|{key}"))
    heldout = max(1, math.ceil(len(ordered) * 0.1))
    split = {
        key: "test" if i < heldout else "val" if i < 2 * heldout else "train"
        for i, key in enumerate(ordered)
    }
    system, provenance = load_character(pack, mode)
    output = {name: [] for name in ("train", "val", "test")}
    lengths = []
    for row in rows:
        for variant in row["variants"]:
            context = variant.get("context_messages", [])
            if len(context) % 2:
                raise ValueError("Context must contain complete user/assistant turns")
            for i, message in enumerate(context):
                if (
                    message.get("role") != ("user" if i % 2 == 0 else "assistant")
                    or not isinstance(message.get("content"), str)
                    or not message["content"].strip()
                ):
                    raise ValueError("Invalid conversation context")
            messages = [
                {"role": "system", "content": system},
                *context,
                {"role": "user", "content": variant["user"]},
                {"role": "assistant", "content": variant["response"]},
            ]
            result = {
                "family_id": row["family_id"],
                "category": row["category"],
                "variant_id": variant["variant_id"],
                "split": split[row["family_id"]],
                "messages": messages,
                "reviewed": True,
                "review_status": row["review_status"],
                "human_reviewed": row["human_reviewed"],
                "provenance": "synthetic_original",
                "review_method": "Human review declared in seed metadata; verify reviewer records."
                if row["human_reviewed"]
                else "Authoring-agent editorial review plus deterministic schema, split, duplicate and token checks. NOT human acceptance or canon verification.",
                "review_notes": row.get("review_notes", ""),
                "intended_traits": row.get("intended_traits", []),
                "character": provenance,
            }
            if tokenizer is not None:
                from .training import encode_row

                encoded = encode_row(result, tokenizer, sequence_length)
                lengths.append(len(encoded[0]["input_ids"]))
            output[result["split"]].append(result)
    dest = Path(dest)
    for name, examples in output.items():
        save_jsonl(dest / f"{name}.jsonl", examples)
    save_jsonl(
        dest / "test-prompts.jsonl",
        [
            {
                k: row[k]
                for k in (
                    "family_id",
                    "category",
                    "variant_id",
                    "intended_traits",
                    "character",
                )
            }
            | {"messages": row["messages"][:-1]}
            for row in output["test"]
        ],
    )
    manifest = {
        "schema_version": 2,
        "task": "complete_persona_sft",
        "base_model": "Qwen/Qwen2.5-1.5B-Instruct",
        "base_revision": "989aa7980e4cf806f80c7fef2b1adb7bc71aa306",
        "seed": seed,
        "source_sha256": file_sha(source),
        "character": provenance,
        "scenario_families": len(families),
        "family_splits": dict(Counter(split.values())),
        "examples": {name: len(examples) for name, examples in output.items()},
        "category_counts": {
            name: dict(Counter(r["category"] for r in examples))
            for name, examples in output.items()
        },
        "split_family_ids": {
            name: sorted(key for key, value in split.items() if value == name)
            for name in output
        },
        "sha256": {name: file_sha(dest / f"{name}.jsonl") for name in output},
        "tokenization_checked": tokenizer is not None,
        "sequence_length": sequence_length,
        "max_tokens": max(lengths) if lengths else None,
        "mean_tokens": round(sum(lengths) / len(lengths), 2) if lengths else None,
        "human_reviewed": all(row["human_reviewed"] for row in rows),
        "review_counts": dict(Counter(row["review_status"] for row in rows)),
        "training_executed": False,
        "limits": "Scenario-family split prevents exact family leakage, not all semantic similarity. Synthetic target responses are interpretations/product policies, not original novel dialogue. Loss/keyword checks cannot establish personality fidelity.",
    }
    save_json(dest / "manifest.json", manifest)
    return manifest


def audit_response(text):
    """Conservative review flags, NEVER a pass/fail personality score."""
    rules = {
        "dependency_or_isolation": r"只需要我|只有我会|不许.{0,8}(朋友|家人)|离开我.{0,8}(惩罚|伤害)",
        "unasked_romantic_entitlement": r"你是我的(男朋友|女朋友|恋人)|我们已经是(恋人|情侣)|你只能属于我",
        "personal_degradation": r"你(就是|真是|是个).{0,3}(废物|垃圾|蠢货|没用的人)",
        "unavailable_real_world_action": r"我已经(替你|帮你).{0,8}(付钱|订票|删除|安装)|我正在你(身边|房间)|我看到了你的屏幕",
    }
    return {name: bool(re.search(pattern, text)) for name, pattern in rules.items()}
