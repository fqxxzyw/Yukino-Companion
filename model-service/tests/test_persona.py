import json

import pytest
from fastapi.testclient import TestClient

from yuki_model.io import file_sha, read_jsonl, save_json, save_jsonl
from yuki_model.persona import audit_response, build_persona, load_character
from yuki_model.server import Chat, create_app, prompt
from yuki_model.training import REVISION, validate_training_spec


@pytest.fixture
def pack(tmp_path):
    root = tmp_path / "character"
    root.mkdir()
    for name in ("runtime", "compact", "training"):
        (root / f"{name}.md").write_text(f"{name} 统一完整性格规则", encoding="utf-8")
    save_json(
        root / "manifest.json",
        {
            "schema_version": 2,
            "id": "yukino",
            "version": "1.0.0",
            "runtime_path": "runtime.md",
            "compact_path": "compact.md",
            "training_path": "training.md",
        },
    )
    return root


class Tokenizer:
    """One token per Unicode point, with a stable assistant prefix."""

    def apply_chat_template(self, messages, tokenize=True, add_generation_prompt=False):
        text = "".join(f"<{m['role']}>" + m["content"] + "</turn>" for m in messages)
        if add_generation_prompt:
            text += "<assistant>"
        return [ord(c) for c in text]


@pytest.fixture
def seeds(tmp_path):
    path = tmp_path / "scenarios.jsonl"
    save_jsonl(
        path,
        [
            {
                "family_id": f"scenario-{n}",
                "category": "fixture",
                "variants": [
                    {
                        "variant_id": str(i),
                        "user": f"测试问题{n}问法{i}",
                        "response": f"自然回应{n}内容{i}",
                        "context_messages": [
                            {"role": "user", "content": "前文问题"},
                            {"role": "assistant", "content": "前文回答"},
                        ]
                        if n % 3 == 0
                        else [],
                    }
                    for i in range(3)
                ],
                "human_reviewed": False,
                "review_status": "assistant-reviewed",
                "provenance": "synthetic_original",
            }
            for n in range(20)
        ],
    )
    return path


def test_shared_pack_modes_and_hash(pack):
    text, provenance = load_character(pack, "detailed")
    assert text == "runtime 统一完整性格规则"
    assert load_character(pack, "training")[0] == "training 统一完整性格规则"
    assert load_character(pack)[0] == "compact 统一完整性格规则"
    (pack / "runtime.md").write_text("更新统一完整性格规则", encoding="utf-8")
    assert load_character(pack)[1]["pack_sha256"] != provenance["pack_sha256"]
    with pytest.raises(ValueError, match="Unknown character"):
        load_character(pack, "early")


def test_pack_rejects_resource_escape(pack):
    manifest = json.loads((pack / "manifest.json").read_text())
    (pack.parent / "outside.md").write_text("outside", encoding="utf-8")
    manifest["compact_path"] = "../outside.md"
    save_json(pack / "manifest.json", manifest)
    with pytest.raises(ValueError, match="unsafe"):
        load_character(pack)


def test_grouped_split_masking_and_heldout_targets(pack, seeds, tmp_path):
    out = tmp_path / "data"
    report = build_persona(seeds, pack, out, tokenizer=Tokenizer())
    assert report["family_splits"] == {"test": 2, "val": 2, "train": 16}
    assert report["examples"] == {"train": 48, "val": 6, "test": 6}
    assert report["tokenization_checked"] and report["max_tokens"] > 0
    split_families = []
    for split in ("train", "val", "test"):
        rows = list(read_jsonl(out / f"{split}.jsonl"))
        groups = {r["family_id"] for r in rows}
        split_families.append(groups)
        assert all(
            {r["variant_id"] for r in rows if r["family_id"] == family}
            == {"0", "1", "2"}
            for family in groups
        )
        assert all(
            r["review_status"] == "assistant-reviewed" and not r["human_reviewed"]
            for r in rows
        )
    assert not split_families[0] & split_families[1]
    assert not (split_families[0] | split_families[1]) & split_families[2]
    assert all(
        r["messages"][-1]["role"] == "user" and "responses" not in r
        for r in read_jsonl(out / "test-prompts.jsonl")
    )
    assert (
        build_persona(seeds, pack, tmp_path / "repeat", tokenizer=Tokenizer())["sha256"]
        == report["sha256"]
    )
    with pytest.raises(ValueError, match="too long|truncated"):
        build_persona(
            seeds, pack, tmp_path / "short", tokenizer=Tokenizer(), sequence_length=40
        )


def test_builder_rejects_duplicate_scenarios(pack, seeds, tmp_path):
    rows = list(read_jsonl(seeds))
    rows[1]["variants"][0]["user"] = rows[0]["variants"][0]["user"] + "！"
    save_jsonl(seeds, rows)
    with pytest.raises(ValueError, match="Duplicate normalized"):
        build_persona(seeds, pack, tmp_path / "data")


def training_config(out):
    return {
        "task": "complete_persona",
        "allow_synthetic_persona": True,
        "revision": REVISION,
        "train_file": str(out / "train.jsonl"),
        "eval_file": str(out / "val.jsonl"),
        "data_manifest": str(out / "manifest.json"),
        "sequence_length": 1024,
    }


def test_preflight_binds_persona_data_and_rejects_tamper(pack, seeds, tmp_path):
    out = tmp_path / "data"
    build_persona(seeds, pack, out, tokenizer=Tokenizer())
    c = training_config(out)
    assert validate_training_spec(c)["persona_manifest"]["human_reviewed"] is False
    with pytest.raises(ValueError, match="allow_synthetic"):
        validate_training_spec(c | {"allow_synthetic_persona": False})
    with pytest.raises(ValueError, match="smaller"):
        validate_training_spec(c | {"sequence_length": 32})
    rows = list(read_jsonl(out / "val.jsonl"))
    rows[0]["family_id"] = next(read_jsonl(out / "train.jsonl"))["family_id"]
    save_jsonl(out / "val.jsonl", rows)
    with pytest.raises(ValueError, match="changed"):
        validate_training_spec(c)
    manifest = json.loads((out / "manifest.json").read_text())
    manifest["sha256"]["val"] = file_sha(out / "val.jsonl")
    save_json(out / "manifest.json", manifest)
    with pytest.raises(ValueError, match="families"):
        validate_training_spec(c)


def test_preflight_requires_real_tokenization(pack, seeds, tmp_path):
    out = tmp_path / "data"
    build_persona(seeds, pack, out)
    with pytest.raises(ValueError, match="tokenizer"):
        validate_training_spec(training_config(out))


def test_explicit_adapter_continuation_and_revision(tmp_path):
    with pytest.raises(ValueError, match="requires initial_adapter"):
        validate_training_spec({"adapter_mode": "continue"})
    with pytest.raises(ValueError, match="requires initial_adapter"):
        validate_training_spec({"adapter_mode": "fresh", "initial_adapter": "unknown"})
    adapter = tmp_path / "adapter"
    adapter.mkdir()
    (adapter / "adapter_model.safetensors").write_bytes(b"fixture-not-real-weights")
    c = {
        "adapter_mode": "continue",
        "initial_adapter": str(adapter),
        "revision": REVISION,
    }
    with pytest.raises(ValueError, match="lacks base provenance"):
        validate_training_spec(c)
    save_json(tmp_path / "training_report.json", {"base_revision": "different"})
    with pytest.raises(ValueError, match="revisions differ"):
        validate_training_spec(c)
    save_json(tmp_path / "training_report.json", {"base_revision": REVISION})
    assert validate_training_spec(c)["initial_adapter_sha256"] == file_sha(
        adapter / "adapter_model.safetensors"
    )
    with pytest.raises(ValueError, match="not both"):
        validate_training_spec(c | {"resume": "checkpoint-1"})


class EmptyRetriever:
    def search(self, *args):
        return []


class RecordingBackend:
    def __init__(self):
        self.messages = None

    def status(self):
        return {"loaded": True, "device": "cpu"}

    def stream(self, messages, *args):
        self.messages = messages
        yield "模型回答"


def test_full_client_prompt_preserved_without_competing_persona(pack):
    system = "共同设定" * 650 + "【完整性格末尾规则必须保留】"
    body = Chat(
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": "你好"},
        ]
    )
    messages, hits = prompt(
        body,
        {
            "default_use_knowledge": False,
            "character_pack": str(pack),
            "persona": "错误设定",
        },
        EmptyRetriever(),
    )
    assert messages[0]["content"] == system and not hits
    body = Chat(messages=[{"role": "user", "content": "你好"}])
    messages, _ = prompt(
        body,
        {"default_use_knowledge": False, "character_pack": str(pack)},
        EmptyRetriever(),
    )
    assert messages[0]["content"] == "compact 统一完整性格规则"


def test_persona_chat_defaults_generate_and_explicit_knowledge_still_works(pack):
    engine = RecordingBackend()
    config = {
        "index": "unused",
        "allowed_hosts": ["testserver"],
        "character_pack": str(pack),
        "default_use_knowledge": False,
    }
    with TestClient(create_app(config, engine, EmptyRetriever())) as client:
        body = {"messages": [{"role": "user", "content": "今天有些疲惫"}]}
        response = client.post("/v1/chat/completions", json=body)
        assert response.status_code == 200
        assert response.json()["answer_mode"] == "model"
        assert response.json()["choices"][0]["message"]["content"] == "模型回答"
        assert engine.messages[0]["content"] == "compact 统一完整性格规则"
        response = client.post(
            "/v1/chat/completions", json=body | {"use_knowledge": True}
        )
        assert response.json()["answer_mode"] == "no_evidence"


def test_rule_flags_are_only_specific_triage():
    flags = audit_response("你只能属于我，你就是废物。")
    assert flags["personal_degradation"] and flags["unasked_romantic_entitlement"]
    assert not any(audit_response("先把自己的想法说清楚，我会听。").values())
    assert "score" not in flags and "passed" not in flags


@pytest.mark.parametrize(
    "status,human,allowed",
    [
        ("assistant-reviewed", False, True),
        ("human-reviewed", True, True),
        ("assistant-reviewed", True, False),
        ("human-reviewed", False, False),
    ],
)
def test_review_provenance_consistency(pack, seeds, tmp_path, status, human, allowed):
    rows = list(read_jsonl(seeds))
    rows[0]["review_status"] = status
    rows[0]["human_reviewed"] = human
    save_jsonl(seeds, rows)
    out = tmp_path / "mixed"
    if allowed:
        report = build_persona(seeds, pack, out, tokenizer=Tokenizer())
        assert report["review_counts"][status] >= 1
        assert (
            validate_training_spec(training_config(out))["persona_manifest"][
                "human_reviewed"
            ]
            is False
        )
    else:
        with pytest.raises(ValueError, match="review status"):
            build_persona(seeds, pack, out, tokenizer=Tokenizer())


def test_persona_without_private_index(pack):
    with TestClient(
        create_app(
            {
                "default_use_knowledge": False,
                "index": None,
                "character_pack": str(pack),
                "allowed_hosts": ["testserver"],
            },
            RecordingBackend(),
        )
    ) as client:
        response = client.post(
            "/v1/chat/completions",
            json={"messages": [{"role": "user", "content": "你好"}]},
        )
        assert response.status_code == 200 and response.json()["answer_mode"] == "model"
        assert client.get("/v1/search", params={"q": "雪乃"}).status_code == 503
        response = client.post(
            "/v1/chat/completions",
            json={
                "messages": [{"role": "user", "content": "你好"}],
                "use_knowledge": True,
            },
        )
        assert (
            response.status_code == 503
            and "not configured" in response.json()["detail"]
        )


def test_persona_package_contains_selected_adapter_and_shared_pack(pack, tmp_path):
    import hashlib
    import importlib.util
    import zipfile
    from pathlib import Path

    source = Path(__file__).parents[1]
    spec = importlib.util.spec_from_file_location(
        "persona_packager", source / "scripts/package_persona.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    adapter = tmp_path / "run/adapter"
    adapter.mkdir(parents=True)
    output = tmp_path / "deliverable.zip"
    with pytest.raises(ValueError, match="completed persona run"):
        module.package_persona(source, adapter, pack, output)
    (adapter / "adapter_model.safetensors").write_bytes(b"unit-test-fixture-only")
    save_json(adapter / "adapter_config.json", {"r": 8})
    save_json(
        adapter.parent / "training_report.json",
        {
            "completed": True,
            "base_revision": REVISION,
            "task": "complete_persona",
            "adapter_sha256": file_sha(adapter / "adapter_model.safetensors"),
        },
    )
    save_json(adapter.parent / "run_config.json", {"task": "complete_persona"})
    save_json(
        adapter.parent / "data_provenance.json",
        {"persona_manifest": {"character": load_character(pack)[1]}},
    )
    result = module.package_persona(source, adapter, pack, output)
    assert result["base_included"] is False
    with zipfile.ZipFile(output) as archive:
        names = archive.namelist()
        assert "characters/yukino/manifest.json" in names
        assert (
            "model-service/outputs/yukino-persona-v1/adapter/adapter_model.safetensors"
            in names
        )
        assert not any(
            "knowledge.sqlite" in name or "yukino-1.5b-knowledge-v1/adapter/" in name
            for name in names
        )
        manifest = json.loads(archive.read("PERSONA_MANIFEST.json"))
        assert manifest["personality_accepted"] is False
        for name, digest in manifest["files"].items():
            assert hashlib.sha256(archive.read(name)).hexdigest() == digest
        serve = json.loads(archive.read("model-service/configs/serve-persona.json"))
        assert serve["index"] is None and serve["default_use_knowledge"] is False
    base = tmp_path / "base"
    base.mkdir()
    with pytest.raises(ValueError, match="BASE_PROVENANCE"):
        module.package_persona(source, adapter, pack, tmp_path / "offline.zip", base)
    for name in (
        "config.json",
        "tokenizer.json",
        "tokenizer_config.json",
        "LICENSE",
        "model.safetensors",
    ):
        (base / name).write_bytes(b"unit-test-base-fixture")
    from yuki_model.training import BASE

    save_json(
        base / "BASE_PROVENANCE.json",
        {
            "base_model": BASE,
            "base_revision": REVISION,
            "files": {file.name: file_sha(file) for file in base.iterdir()},
        },
    )
    offline = module.package_persona(
        source, adapter, pack, tmp_path / "offline.zip", base
    )
    assert offline["base_included"] is True
    (base / "model.safetensors").write_bytes(b"mismatched-base")
    with pytest.raises(ValueError, match="differ from pinned"):
        module.package_persona(source, adapter, pack, tmp_path / "bad-base.zip", base)
    save_json(
        adapter.parent / "run_config.json",
        {"task": "complete_persona", "run_purpose": "smoke"},
    )
    with pytest.raises(ValueError, match="smoke weights"):
        module.package_persona(source, adapter, pack, tmp_path / "smoke.zip")
    save_json(adapter.parent / "run_config.json", {"task": "complete_persona"})
    (adapter / "adapter_model.safetensors").write_bytes(b"wrong-copied-adapter")
    with pytest.raises(ValueError, match="weights do not match"):
        module.package_persona(source, adapter, pack, tmp_path / "wrong.zip")
    (adapter / "adapter_model.safetensors").write_bytes(b"unit-test-fixture-only")
    (pack / "compact.md").write_text("changed after training", encoding="utf-8")
    with pytest.raises(ValueError, match="changed since training"):
        module.package_persona(source, adapter, pack, tmp_path / "second.zip")
