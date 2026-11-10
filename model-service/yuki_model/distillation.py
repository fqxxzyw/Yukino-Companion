"""Source-checked, authored hard targets mixed with train-only persona rehearsal.

This is supervised distillation, not access to teacher logits. Evidence checks
establish file/snippet identity, not that every paraphrase is logically correct.
"""

import json
import tempfile
from collections import Counter
from difflib import SequenceMatcher
from pathlib import Path

from .io import file_sha, read_jsonl, save_json, save_jsonl, sha
from .persona import build_persona, load_character, normalize_prompt, valid_review

SPLITS = ("train", "val", "test")


def verify_evidence(path, epubs, repository):
    """Verify exact cited source bytes before using manually authored labels."""
    from .corpus import sections

    evidence = {}
    checked_files = {}
    section_cache = {}
    epubs, repository = Path(epubs), Path(repository).resolve()
    for item in read_jsonl(path):
        key = item["evidence_id"]
        if not isinstance(key, str) or not key or key in evidence:
            raise ValueError("Duplicate or empty evidence id")
        kind = item["source_type"]
        if kind == "user_supplied_epub":
            filename = item["source_file"]
            if Path(filename).name != filename:
                raise ValueError("Evidence EPUB must be a simple filename")
            book = epubs / filename
            if str(book) not in checked_files:
                checked_files[str(book)] = file_sha(book)
                section_cache[str(book)] = {s["member"]: s for s in sections(book)}
            if checked_files[str(book)] != item["source_sha256"]:
                raise ValueError("Evidence EPUB hash mismatch: " + filename)
            section = section_cache[str(book)][item["member"]]
            if section["section_id"] != item["section_id"] or section["chapter"] != item["chapter"]:
                raise ValueError("Evidence section locator mismatch")
            if not item["paragraphs"]:
                raise ValueError("Evidence needs a source passage")
            for paragraph in item["paragraphs"]:
                index = paragraph["index"]
                if type(index) is not int or not 0 <= index < len(section["paragraphs"]) or section["paragraphs"][index] != paragraph["text"]:
                    raise ValueError("Evidence paragraph differs from source: " + key)
        elif kind == "local_character_pack":
            file = (repository / item["source_file"]).resolve()
            if not file.is_relative_to(repository):
                raise ValueError("Evidence repository path escapes repository")
            if str(file) not in checked_files:
                checked_files[str(file)] = file_sha(file)
            if checked_files[str(file)] != item["source_sha256"]:
                raise ValueError("Evidence repository hash mismatch")
            if not item["locator"] or item["locator"] not in file.read_text(encoding="utf-8"):
                raise ValueError("Evidence locator missing from character pack")
        else:
            raise ValueError("Unsupported evidence source type")
        if item["kind"] not in {"canon", "style", "product_policy", "canon_pack_summary", "evidence_scope"}:
            raise ValueError("Evidence needs an explicit kind")
        evidence[key] = item
    if not evidence:
        raise ValueError("Empty evidence inventory")
    return evidence


def _messages(system, variant):
    context = variant.get("context_messages", [])
    if not isinstance(context, list) or len(context) % 2:
        raise ValueError("Context must contain complete turns")
    for i, message in enumerate(context):
        if (not isinstance(message, dict) or set(message) != {"role", "content"}
                or message.get("role") != ("user" if i % 2 == 0 else "assistant")
                or not isinstance(message.get("content"), str) or not message["content"].strip()):
            raise ValueError("Invalid context role/content")
    return [{"role": "system", "content": system}, *context,
            {"role": "user", "content": variant["user"]},
            {"role": "assistant", "content": variant["response"]}]


def build_distillation(source, evidence_file, replay_source, pack, epubs, dest, *, tokenizer=None, sequence_length=1536):
    from .training import BASE, REVISION, encode_row

    dest, pack = Path(dest), Path(pack).resolve()
    if dest.exists() and any(dest.iterdir()):
        raise ValueError("Output exists; use a new empty data directory")
    evidence = verify_evidence(evidence_file, epubs, pack.parent.parent)
    system, character = load_character(pack, "training")
    output = {name: [] for name in SPLITS}
    families, prompts, identities = {}, {}, set()
    regression = []
    lengths = []
    excluded_replay = []

    def append(row):
        prompt_key = normalize_prompt(row["messages"][-2]["content"])
        if prompt_key in prompts:
            raise ValueError("Duplicate normalized question; edit the source instead of repeating it")
        prompts[prompt_key] = (row["split"], row["family_id"])
        identity = (row["family_id"], row["variant_id"])
        if identity in identities:
            raise ValueError("Duplicate sample ID")
        identities.add(identity)
        if tokenizer is not None:
            lengths.append(len(encode_row(row, tokenizer, sequence_length)[0]["input_ids"]))
        output[row["split"]].append(row)

    for seed in read_jsonl(source):
        family, split = seed["family_id"], seed["split"]
        if split not in SPLITS or not isinstance(family, str) or not family.strip() or family in families:
            raise ValueError("Invalid/duplicate family or split")
        families[family] = split
        if not valid_review(seed) or seed.get("human_reviewed") is not False or seed.get("provenance") != "synthetic_original":
            raise ValueError("Hard labels must identify assistant review honestly")
        refs = seed["evidence_ids"]
        if not isinstance(refs, list) or not refs or any(not isinstance(ref, str) or ref not in evidence for ref in refs):
            raise ValueError("Every new scenario needs known evidence IDs")
        variants = seed["variants"]
        if not isinstance(variants, list) or len(variants) < 3:
            raise ValueError("Each family needs at least 3 distinct authored targets")
        for variant in variants:
            if not isinstance(variant, dict) or any(not isinstance(variant.get(k), str) or not variant[k].strip() for k in ("variant_id", "user", "response")):
                raise ValueError("Empty hard target/question")
            row = {
                "family_id": family, "variant_id": variant["variant_id"], "split": split,
                "category": seed["category"], "evidence_ids": refs,
                "messages": _messages(system, variant), "reviewed": True,
                "review_status": "assistant-reviewed", "human_reviewed": False,
                "provenance": "synthetic_original", "teacher": "codex-authored-hard-label",
                "origin": "new_hard_label", "character": character,
            }
            append(row)
            if split == "train" and seed.get("regression"):
                regression.append(row)
        if len({v["response"] for v in variants}) != len(variants):
            raise ValueError("Each family needs distinct authored targets")
    if any(not output[s] for s in SPLITS):
        raise ValueError("Explicit train, validation and test families are all required")

    # Rebuild the established split and use only its training partition. Older
    # validation/test examples have been exposed and are not fresh v3 holdouts.
    with tempfile.TemporaryDirectory() as staging:
        replay_meta = build_persona(replay_source, pack, staging, tokenizer=tokenizer, sequence_length=sequence_length)
        for row in read_jsonl(Path(staging) / "train.jsonl"):
            question = normalize_prompt(row["messages"][-2]["content"])
            if question in prompts:
                if prompts[question][0] != "train":
                    raise ValueError("Replay question overlaps held-out correction data")
                excluded_replay.append({"family_id": row["family_id"], "variant_id": row["variant_id"], "reason": "new training target takes precedence for identical prompt"})
                continue
            row.update(family_id="replay/" + row["family_id"], origin="legacy_train_replay", teacher="historical-synthetic-author",
                       evidence_ids=[], split="train")
            if row["family_id"] in families and families[row["family_id"]] != "train":
                raise ValueError("Replay family overlaps holdout")
            families[row["family_id"]] = "train"
            append(row)

    # Surface close wording for editorial review; grouping is by scenario, not
    # unseen canon fact. Similarity is NOT a quality score or semantic guarantee.
    near = []
    train_prompts = [(normalize_prompt(r["messages"][-2]["content"]), r) for r in output["train"]]
    for split in ("val", "test"):
        for row in output[split]:
            q = normalize_prompt(row["messages"][-2]["content"])
            for other, train_row in train_prompts:
                similarity = SequenceMatcher(None, q, other).ratio()
                if similarity >= 0.72:
                    near.append({"heldout": [row["family_id"], row["variant_id"]], "train": [train_row["family_id"], train_row["variant_id"]], "similarity": round(similarity, 3)})

    for split in SPLITS:
        save_jsonl(dest / f"{split}.jsonl", output[split])
    if not regression:
        regression = [r for r in output["train"] if r["origin"] == "new_hard_label"][:12]
    save_jsonl(dest / "regression.jsonl", regression)
    for name, rows in (("test", output["test"]), ("regression", regression)):
        save_jsonl(dest / f"{name}-prompts.jsonl", [{k: r[k] for k in ("family_id", "variant_id", "category", "evidence_ids")} | {"messages": r["messages"][:-1]} for r in rows])
    save_jsonl(dest / "seeds.jsonl", read_jsonl(source))
    save_jsonl(dest / "evidence.jsonl", read_jsonl(evidence_file))
    manifest = {
        "schema_version": 1, "task": "distill_sft", "base_model": BASE, "base_revision": REVISION,
        "teacher": "Codex-authored hard targets in this chat; no external teacher API or logits",
        "character": character, "source_sha256": file_sha(source), "evidence_sha256": file_sha(evidence_file),
        "replay_source_sha256": file_sha(replay_source), "replay_manifest": replay_meta,
        "excluded_replay": excluded_replay,
        "tokenization_checked": tokenizer is not None, "evidence_verified": True,
        "sequence_length": sequence_length, "max_tokens": max(lengths) if lengths else None,
        "examples": {s: len(output[s]) for s in SPLITS},
        "origin_counts": {s: dict(Counter(r["origin"] for r in output[s])) for s in SPLITS},
        "category_counts": {s: dict(Counter(r["category"] for r in output[s])) for s in SPLITS},
        "split_family_ids": {s: sorted(f for f, group in families.items() if group == s) for s in SPLITS},
        "sha256": {s: file_sha(dest / f"{s}.jsonl") for s in SPLITS},
        "artifacts": {p.name: file_sha(p) for p in sorted(dest.iterdir()) if p.is_file()},
        "near_prompt_pairs_for_review": near, "human_reviewed": False, "training_executed": False,
        "limits": "Scenario-family holdouts test new phrasing/situations over overlapping canon facts, not unseen-fact knowledge. Some new situations resemble earlier persona themes. Source hashes/snippets do not prove interpretations. Regression prompts are trained examples; report separately. Human paired review required.",
    }
    save_json(dest / "manifest.json", manifest)
    return manifest


def validate_manifest(config):
    """Reject stale, altered or leaking training data before loading any model."""
    from .training import BASE, REVISION

    if not config.get("allow_synthetic_persona"):
        raise ValueError("Hard-label training requires allow_synthetic_persona:true")
    path = Path(config["data_manifest"])
    meta = json.loads(path.read_text(encoding="utf-8"))
    if meta.get("task") != "distill_sft" or meta.get("schema_version") != 1:
        raise ValueError("Unsupported distillation manifest")
    if not meta.get("tokenization_checked") or not meta.get("evidence_verified"):
        raise ValueError("Tokenization and source evidence must be checked before training")
    if meta["base_model"] != BASE or meta["base_revision"] != config.get("revision", REVISION):
        raise ValueError("Distillation base revision mismatch")
    if not 0 < meta["max_tokens"] <= config.get("sequence_length", 512):
        raise ValueError("Distillation tokens exceed configured sequence length")
    for name, expected in meta["artifacts"].items():
        if Path(name).name != name or file_sha(path.parent / name) != expected:
            raise ValueError("Distillation artifact hash mismatch")
    family_sets = {s: set(meta["split_family_ids"][s]) for s in SPLITS}
    if any(not family_sets[s] for s in SPLITS) or any(family_sets[a] & family_sets[b] for a, b in (("train", "val"), ("train", "test"), ("val", "test"))):
        raise ValueError("Distillation scenario-family leakage")
    questions = set()
    for split, field in (("train", "train_file"), ("val", "eval_file")):
        if Path(config[field]).resolve() != (path.parent / f"{split}.jsonl").resolve() or file_sha(config[field]) != meta["sha256"][split]:
            raise ValueError("Distillation dataset hash/path mismatch")
        rows = list(read_jsonl(config[field]))
        if len(rows) != meta["examples"][split] or {r["family_id"] for r in rows} != family_sets[split]:
            raise ValueError("Distillation split differs from manifest")
        for row in rows:
            if not valid_review(row) or not row.get("reviewed") or row.get("split") != split or row["messages"][-1]["role"] != "assistant":
                raise ValueError("Invalid distillation target review/split")
            if sha(row["messages"][0]["content"]) != meta["character"]["prompt_sha256"]:
                raise ValueError("Training prompt differs from manifest")
            question = normalize_prompt(row["messages"][-2]["content"])
            if question in questions:
                raise ValueError("Duplicate distillation prompt")
            questions.add(question)
    return {"data_manifest_sha256": file_sha(path), "distill_manifest": meta}
