"""Hard-target evidence, grouped splits, replay isolation and immutable artifacts."""

import copy
import json
from pathlib import Path

import pytest

from yuki_model import distillation
from yuki_model.io import file_sha, read_jsonl, save_json, save_jsonl
from yuki_model.persona import build_persona, normalize_prompt
from yuki_model.training import REVISION, encode_row


class Tokenizer:
    """Stable chat prefix with one token per codepoint; no network or weights."""

    def apply_chat_template(self, messages, tokenize=True, add_generation_prompt=False):
        text = "".join(f"<{m['role']}>" + m["content"] + "</turn>" for m in messages)
        if add_generation_prompt:
            text += "<assistant>"
        return list(map(ord, text))


@pytest.fixture
def dataset(tmp_path):
    pack = tmp_path / "characters" / "yukino"
    pack.mkdir(parents=True)
    for mode in ("training", "compact", "runtime"):
        (pack / f"{mode}.md").write_text("说话克制，核实事实。", encoding="utf-8")
    save_json(pack / "manifest.json", {
        "schema_version": 2, "id": "yukino", "version": "fixture",
        "training_path": "training.md", "compact_path": "compact.md",
        "runtime_path": "runtime.md",
    })
    evidence = [{
        "evidence_id": "style", "kind": "style", "source_type": "local_character_pack",
        "source_file": "characters/yukino/training.md",
        "source_sha256": file_sha(pack / "training.md"), "locator": "核实事实",
    }]
    review = {
        "provenance": "synthetic_original", "review_status": "assistant-reviewed",
        "human_reviewed": False,
    }
    seeds = [{
        "family_id": f"new-{split}", "split": split, "category": "fixture",
        "evidence_ids": ["style"], "regression": split == "train", **review,
        "variants": [{
            "variant_id": f"v{i}", "user": f"独立情境 {split} 的提问 {i}",
            "response": f"新目标 {split} {i}",
            "context_messages": [
                {"role": "user", "content": "前一轮的问题"},
                {"role": "assistant", "content": "前一轮的回答"},
            ] if i == 2 else [],
        } for i in range(3)],
    } for split in ("train", "val", "test")]
    replay = [{
        "family_id": f"legacy-{n}", "category": "legacy", **review,
        "variants": [{"variant_id": f"v{i}", "user": f"历史场景 {n} 的问题 {i}",
                      "response": f"历史自然回答 {n} {i}"} for i in range(3)],
    } for n in range(10)]
    source, evidence_file, replay_file = [tmp_path / name for name in (
        "new-seeds.jsonl", "evidence.jsonl", "replay.jsonl"
    )]
    save_jsonl(source, seeds)
    save_jsonl(evidence_file, evidence)
    save_jsonl(replay_file, replay)
    legacy_dest = tmp_path / "legacy-prepared"
    legacy_meta = build_persona(replay_file, pack, legacy_dest, tokenizer=Tokenizer())
    return {
        "source": source, "evidence_file": evidence_file, "replay_source": replay_file,
        "pack": pack, "epubs": tmp_path / "epubs", "dest": tmp_path / "prepared",
        "seeds": seeds, "evidence": evidence, "legacy_dest": legacy_dest,
        "legacy_meta": legacy_meta,
    }


def build(data, *, tokenize=True):
    return distillation.build_distillation(
        **{key: data[key] for key in ("source", "evidence_file", "replay_source", "pack", "epubs", "dest")},
        tokenizer=Tokenizer() if tokenize else None,
    )


def config(data):
    return {
        "task": "distill_sft", "revision": REVISION, "allow_synthetic_persona": True,
        "data_manifest": str(data["dest"] / "manifest.json"),
        "train_file": str(data["dest"] / "train.jsonl"),
        "eval_file": str(data["dest"] / "val.jsonl"), "sequence_length": 1536,
    }


def test_grouped_splits_train_only_replay_and_prompt_target_isolation(dataset):
    meta = build(dataset)
    assert meta["examples"] == {"train": 27, "val": 3, "test": 3}
    assert meta["origin_counts"]["train"] == {"new_hard_label": 3, "legacy_train_replay": 24}
    assert meta["tokenization_checked"] and meta["evidence_verified"]
    assert meta["human_reviewed"] is False and not meta["training_executed"]
    groups = {split: set(meta["split_family_ids"][split]) for split in ("train", "val", "test")}
    assert not groups["train"] & groups["val"]
    assert not (groups["train"] | groups["val"]) & groups["test"]
    legacy = dataset["legacy_meta"]["split_family_ids"]
    assert {"replay/" + family for family in legacy["train"]} <= groups["train"]
    assert not {"replay/" + family for family in legacy["val"] + legacy["test"]} & groups["train"]
    for split in ("test", "regression"):
        refs = list(read_jsonl(dataset["dest"] / f"{split}.jsonl"))
        prompts = list(read_jsonl(dataset["dest"] / f"{split}-prompts.jsonl"))
        assert len(refs) == len(prompts) == 3
        for reference, prompt in zip(refs, prompts):
            assert prompt["messages"] == reference["messages"][:-1]
            assert prompt["messages"][-1]["role"] == "user"
            assert "response" not in prompt and "target" not in prompt
            encoded = encode_row(reference, Tokenizer(), 1536)[0]
            prefix = Tokenizer().apply_chat_template(prompt["messages"], add_generation_prompt=True)
            assert encoded["labels"][:len(prefix)] == [-100] * len(prefix)
            assert all(v >= 0 for v in encoded["labels"][len(prefix):])
    assert distillation.validate_manifest(config(dataset))["data_manifest_sha256"] == file_sha(dataset["dest"] / "manifest.json")


def test_duplicate_replay_training_prompt_is_excluded_but_holdout_overlap_fails(dataset):
    legacy_row = next(read_jsonl(dataset["legacy_dest"] / "train.jsonl"))
    question = legacy_row["messages"][-2]["content"]
    seeds = copy.deepcopy(dataset["seeds"])
    seeds[0]["variants"][0]["user"] = question
    save_jsonl(dataset["source"], seeds)
    meta = build(dataset)
    assert meta["examples"]["train"] == 26
    assert len(meta["excluded_replay"]) == 1
    matching = [r for r in read_jsonl(dataset["dest"] / "train.jsonl")
                if normalize_prompt(r["messages"][-2]["content"]) == normalize_prompt(question)]
    assert len(matching) == 1 and matching[0]["origin"] == "new_hard_label"
    assert matching[0]["messages"][-1]["content"] == seeds[0]["variants"][0]["response"]
    dataset["dest"] = dataset["dest"].with_name("holdout-overlap")
    seeds = copy.deepcopy(dataset["seeds"])
    seeds[1]["variants"][0]["user"] = question
    save_jsonl(dataset["source"], seeds)
    with pytest.raises(ValueError, match="Replay question overlaps held-out"):
        build(dataset)


@pytest.mark.parametrize("change", [
    {"human_reviewed": True}, {"review_status": "unreviewed"},
    {"provenance": "unknown"}, {"evidence_ids": []},
    {"evidence_ids": ["uncited-source"]}, {"split": "development"},
])
def test_unreviewed_untraceable_or_unsplit_hard_targets_rejected(dataset, change):
    seeds = copy.deepcopy(dataset["seeds"])
    seeds[0].update(change)
    save_jsonl(dataset["source"], seeds)
    with pytest.raises(ValueError):
        build(dataset)


def test_duplicate_family_prompt_and_copied_targets_rejected(dataset):
    seeds = copy.deepcopy(dataset["seeds"])
    seeds[1]["family_id"] = seeds[0]["family_id"]
    save_jsonl(dataset["source"], seeds)
    with pytest.raises(ValueError, match="family"):
        build(dataset)
    seeds = copy.deepcopy(dataset["seeds"])
    seeds[1]["variants"][0]["user"] = seeds[0]["variants"][0]["user"] + "！"
    save_jsonl(dataset["source"], seeds)
    with pytest.raises(ValueError, match="Duplicate normalized"):
        build(dataset)
    seeds = copy.deepcopy(dataset["seeds"])
    seeds[0]["variants"][1]["response"] = seeds[0]["variants"][0]["response"]
    save_jsonl(dataset["source"], seeds)
    with pytest.raises(ValueError, match="distinct authored targets"):
        build(dataset)


@pytest.mark.parametrize("context", [
    [{"role": "user", "content": "incomplete turn"}],
    [{"role": "assistant", "content": "wrong"}, {"role": "user", "content": "wrong"}],
    [{"role": "user", "content": ""}, {"role": "assistant", "content": "answer"}],
])
def test_malformed_multiturn_context_rejected(dataset, context):
    seeds = copy.deepcopy(dataset["seeds"])
    seeds[0]["variants"][0]["context_messages"] = context
    save_jsonl(dataset["source"], seeds)
    with pytest.raises(ValueError, match="Context|context"):
        build(dataset)


def test_numeric_context_is_rejected_even_without_tokenizer(dataset):
    seeds = copy.deepcopy(dataset["seeds"])
    seeds[0]["variants"][0]["context_messages"] = [
        {"role": "user", "content": 123}, {"role": "assistant", "content": "answer"}
    ]
    save_jsonl(dataset["source"], seeds)
    with pytest.raises(ValueError, match="context|Context|content"):
        build(dataset, tokenize=False)


@pytest.mark.parametrize("artifact", [
    "train.jsonl", "val.jsonl", "test.jsonl", "seeds.jsonl", "evidence.jsonl",
    "regression.jsonl", "test-prompts.jsonl", "regression-prompts.jsonl",
])
def test_manifest_rejects_modified_saved_artifacts(dataset, artifact):
    build(dataset)
    path = dataset["dest"] / artifact
    path.write_text(path.read_text(encoding="utf-8") + "\n", encoding="utf-8")
    with pytest.raises(ValueError, match="artifact hash mismatch"):
        distillation.validate_manifest(config(dataset))


def test_manifest_requires_real_tokenization_and_exact_training_paths(dataset):
    build(dataset, tokenize=False)
    with pytest.raises(ValueError, match="Tokenization"):
        distillation.validate_manifest(config(dataset))
    dataset["dest"] = dataset["dest"].with_name("tokenized")
    build(dataset)
    original = config(dataset)
    with pytest.raises(ValueError, match="allow_synthetic_persona"):
        distillation.validate_manifest(original | {"allow_synthetic_persona": False})
    with pytest.raises(ValueError, match="sequence length"):
        distillation.validate_manifest(original | {"sequence_length": 8})
    with pytest.raises(ValueError, match="hash/path mismatch"):
        distillation.validate_manifest(original | {"train_file": str(dataset["dest"] / "test.jsonl")})
    with pytest.raises(ValueError, match="Output exists"):
        build(dataset)


def test_manifest_checks_split_leakage_and_review_after_hash_checks(dataset):
    build(dataset)
    path = dataset["dest"] / "manifest.json"
    manifest = json.loads(path.read_text(encoding="utf-8"))
    manifest["split_family_ids"]["test"].append(manifest["split_family_ids"]["train"][0])
    save_json(path, manifest)
    with pytest.raises(ValueError, match="scenario-family leakage"):
        distillation.validate_manifest(config(dataset))
    manifest["split_family_ids"]["test"].pop()
    rows = list(read_jsonl(dataset["dest"] / "train.jsonl"))
    rows[0]["review_status"] = "unreviewed"
    save_jsonl(dataset["dest"] / "train.jsonl", rows)
    digest = file_sha(dataset["dest"] / "train.jsonl")
    manifest["sha256"]["train"] = manifest["artifacts"]["train.jsonl"] = digest
    save_json(path, manifest)
    with pytest.raises(ValueError, match="target review/split"):
        distillation.validate_manifest(config(dataset))


def test_local_evidence_requires_exact_source_hash_locator_and_safe_path(dataset):
    args = (dataset["evidence_file"], dataset["epubs"], dataset["pack"].parent.parent)
    assert set(distillation.verify_evidence(*args)) == {"style"}
    for change, message in [
        ({"source_sha256": "wrong"}, "hash mismatch"),
        ({"locator": "not present anywhere"}, "locator missing"),
        ({"source_file": "../outside.md"}, "escapes repository"),
        ({"source_type": "teacher-memory"}, "Unsupported evidence"),
        ({"kind": "uncategorized"}, "explicit kind"),
    ]:
        save_jsonl(dataset["evidence_file"], [dataset["evidence"][0] | change])
        with pytest.raises(ValueError, match=message):
            distillation.verify_evidence(*args)
    save_jsonl(dataset["evidence_file"], dataset["evidence"] * 2)
    with pytest.raises(ValueError, match="Duplicate"):
        distillation.verify_evidence(*args)


def test_epub_evidence_checks_section_and_exact_paragraphs(dataset, monkeypatch):
    import yuki_model.corpus

    dataset["epubs"].mkdir()
    book = dataset["epubs"] / "fixture.epub"
    book.write_bytes(b"unit-test source identity; sections() is mocked")
    section = {"member": "text/a.html", "section_id": "section-a", "chapter": "第一章",
               "paragraphs": ["证据中的第一段", "证据中的第二段"]}
    monkeypatch.setattr(yuki_model.corpus, "sections", lambda path: iter([section]))
    evidence = {
        "evidence_id": "canon", "kind": "canon", "source_type": "user_supplied_epub",
        "source_file": book.name, "source_sha256": file_sha(book),
        "member": section["member"], "section_id": section["section_id"],
        "chapter": section["chapter"], "paragraphs": [{"index": 1, "text": "证据中的第二段"}],
    }
    args = (dataset["evidence_file"], dataset["epubs"], dataset["pack"].parent.parent)
    save_jsonl(dataset["evidence_file"], [evidence])
    assert set(distillation.verify_evidence(*args)) == {"canon"}
    for change, message in [
        ({"source_file": "../fixture.epub"}, "simple filename"),
        ({"source_sha256": "wrong"}, "hash mismatch"),
        ({"chapter": "错误章节"}, "locator mismatch"),
        ({"paragraphs": []}, "source passage"),
        ({"paragraphs": [{"index": 1, "text": "未核实的改写"}]}, "paragraph differs"),
        ({"paragraphs": [{"index": True, "text": "证据中的第二段"}]}, "paragraph differs"),
    ]:
        save_jsonl(dataset["evidence_file"], [evidence | change])
        with pytest.raises(ValueError, match=message):
            distillation.verify_evidence(*args)


def test_v3_config_continues_with_best_selection_and_preserves_epoch_checkpoints():
    path = Path(__file__).parents[1] / "configs/train-distill.json"
    settings = json.loads(path.read_text(encoding="utf-8"))
    assert settings["task"] == "distill_sft" and settings["adapter_mode"] == "continue"
    assert settings["epochs"] == 12 and settings["save_total_limit"] >= settings["epochs"]
    assert settings["load_best_model_at_end"] and settings["early_stopping_patience"] == 3
    assert settings["learning_rate"] == 2e-5 and settings["device"] == "cuda"
    assert not settings["allow_cpu"]
