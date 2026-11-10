import importlib.util
import json
from pathlib import Path

import pytest

from yuki_model.io import read_jsonl, save_json, save_jsonl


spec = importlib.util.spec_from_file_location(
    "evaluate_distillation", Path(__file__).parents[1] / "scripts/evaluate_distillation.py"
)
evaluation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evaluation)


@pytest.fixture
def inputs(tmp_path):
    prompts = []
    references = []
    for number in range(2):
        row = {
            "family_id": f"family-{number}", "variant_id": "v1", "category": "fixture",
            "evidence_ids": ["source-1"],
            "messages": [
                {"role": "system", "content": "人格与准确性"},
                {"role": "user", "content": f"问题 {number} <script>alert(1)</script>"},
            ],
        }
        prompts.append(row)
        references.append(row | {"messages": row["messages"] + [
            {"role": "assistant", "content": "保密参考目标 <img src=x onerror=alert(2)>"}
        ]})
    save_jsonl(tmp_path / "prompts.jsonl", prompts)
    save_jsonl(tmp_path / "references.jsonl", references)
    for side in ("before", "after"):
        (tmp_path / side).mkdir()
        save_json(tmp_path / side / "adapter_config.json", {"r": 8})
        (tmp_path / side / "adapter_model.safetensors").write_bytes(side.encode())
    args = evaluation.parser().parse_args([
        "--prompts", str(tmp_path / "prompts.jsonl"),
        "--references", str(tmp_path / "references.jsonl"),
        "--model", "Qwen/Qwen2.5-1.5B-Instruct",
        "--before-adapter", str(tmp_path / "before"),
        "--after-adapter", str(tmp_path / "after"),
        "--output", str(tmp_path / "results"), "--device", "cpu",
    ])
    return args, prompts, references


class Engine:
    calls = []
    fail_after = None

    def __init__(self, args):
        pass

    def status(self):
        return {"device": "cpu", "test_double": True}

    def generate(self, side, messages):
        if self.fail_after is not None and len(self.calls) == self.fail_after:
            raise RuntimeError("simulated interruption")
        self.calls.append((side, messages))
        return {"answer": "模型输出 <script>bad()</script>", "generated_tokens": 8, "hit_token_limit": False}


def test_paired_generation_references_excluded_html_escaped_and_resume(inputs):
    args, prompts, references = inputs
    Engine.calls = []
    Engine.fail_after = 1
    with pytest.raises(RuntimeError, match="simulated interruption"):
        evaluation.evaluate(args, Engine)
    saved = list(read_jsonl(Path(args.output) / "generations.jsonl"))
    assert len(saved) == 1 and saved[0]["side"] == "before"
    Engine.fail_after = None
    result = evaluation.evaluate(args, Engine)
    assert result["paired_answer_count"] == 4 and result["generation_completed"]
    assert len(Engine.calls) == 4
    assert all(messages[-1]["role"] == "user" for _, messages in Engine.calls)
    assert all("保密参考目标" not in json.dumps(messages, ensure_ascii=False) for _, messages in Engine.calls)
    for n in range(2):
        assert Engine.calls[n * 2][1] == Engine.calls[n * 2 + 1][1]
    document = (Path(args.output) / "comparison.html").read_text(encoding="utf-8")
    assert "<script>" not in document and "<img " not in document
    assert "&lt;script&gt;" in document and "保密参考目标" in document
    review = Path(args.output) / "human-review.csv"
    review.write_text("user entered ratings", encoding="utf-8")
    evaluation.evaluate(args, lambda args: pytest.fail("completed run must not load a model"))
    assert review.read_text(encoding="utf-8") == "user entered ratings"


def test_resume_rejects_changed_adapters_and_prompts(inputs):
    args, prompts, _ = inputs
    args.dry_run = True
    evaluation.evaluate(args)
    (Path(args.after_adapter) / "adapter_model.safetensors").write_bytes(b"changed")
    with pytest.raises(ValueError, match="inputs/settings changed"):
        evaluation.evaluate(args)
    (Path(args.after_adapter) / "adapter_model.safetensors").write_bytes(b"after")
    prompts[0]["messages"][-1]["content"] = "new question"
    save_jsonl(args.prompts, prompts)
    # Reference mismatch fails even before the locked-config check.
    with pytest.raises(ValueError, match="Reference prefix differs"):
        evaluation.evaluate(args)


def test_dry_run_does_not_generate_or_claim_acceptance(inputs):
    args, _, _ = inputs
    args.dry_run = True
    report = evaluation.evaluate(args, lambda args: pytest.fail("no model in dry run"))
    assert report["dry_run"] and not report["generation_completed"]
    assert not report["personality_accepted"] and report["human_review_required"]
    rows = list(read_jsonl(Path(args.output) / "generations.jsonl"))
    assert all(not row["generation_executed"] and row["answer"] == "" for row in rows)
    args.dry_run = False
    with pytest.raises(ValueError, match="inputs/settings changed"):
        evaluation.evaluate(args, Engine)


def test_prompt_target_leakage_and_bad_conversation_rejected(inputs):
    args, prompts, refs = inputs
    save_jsonl(args.prompts, refs)
    with pytest.raises(ValueError, match="end in user"):
        evaluation.read_inputs(args.prompts, args.references)
    prompts[0]["target"] = "answer that must not enter prompts"
    save_jsonl(args.prompts, prompts)
    with pytest.raises(ValueError, match="contains a reference target"):
        evaluation.read_inputs(args.prompts)
    del prompts[0]["target"]
    prompts[0]["messages"].append({"role": "user", "content": "consecutive user"})
    save_jsonl(args.prompts, prompts)
    with pytest.raises(ValueError, match="alternate"):
        evaluation.read_inputs(args.prompts)


def test_missing_or_duplicate_reference_rejected(inputs):
    args, _, refs = inputs
    save_jsonl(args.references, refs[:1])
    with pytest.raises(ValueError, match="exactly one"):
        evaluation.read_inputs(args.prompts, args.references)
    save_jsonl(args.references, refs + refs[:1])
    with pytest.raises(ValueError, match="Duplicate or unmatched"):
        evaluation.read_inputs(args.prompts, args.references)


def test_shared_backbone_switches_adapters_without_changing_prompt(inputs, monkeypatch):
    import sys
    import types
    import torch
    import yuki_model.hardware

    args, prompts, _ = inputs
    events = []

    class Tokenizer:
        eos_token_id = 0

        def apply_chat_template(self, messages, **kwargs):
            events.append(("tokenize", messages, kwargs))
            return torch.tensor([[1, 2, 3]])

        def decode(self, generated, **kwargs):
            return "真实接口的模拟输出"

    class Model:
        def load_adapter(self, path, **kwargs):
            events.append(("load_adapter", path, kwargs))

        def to(self, device):
            return self

        def eval(self):
            return self

        def set_adapter(self, side):
            events.append(("set_adapter", side))

        def generate(self, **kwargs):
            events.append(("generate", kwargs))
            return torch.cat([kwargs["input_ids"], torch.tensor([[4, 0]])], dim=1)

    model = Model()
    bases = []

    def load_base(source, **kwargs):
        bases.append((source, kwargs))
        return model

    fake_transformers = types.SimpleNamespace(
        AutoTokenizer=types.SimpleNamespace(from_pretrained=lambda *a, **k: Tokenizer()),
        AutoModelForCausalLM=types.SimpleNamespace(from_pretrained=load_base),
    )
    fake_peft = types.SimpleNamespace(PeftModel=types.SimpleNamespace(
        from_pretrained=lambda base, *a, **k: base
    ))
    monkeypatch.setitem(sys.modules, "transformers", fake_transformers)
    monkeypatch.setitem(sys.modules, "peft", fake_peft)
    monkeypatch.setattr(yuki_model.hardware, "detect", lambda: {"cuda": False, "mps": False})
    engine = evaluation.PairedEngine(args)
    for side in ("before", "after"):
        result = engine.generate(side, prompts[0]["messages"])
        assert result["answer"] == "真实接口的模拟输出"
    assert len(bases) == 1
    assert [(e[0], e[1]) for e in events if e[0] == "set_adapter"] == [
        ("set_adapter", "before"), ("set_adapter", "after")
    ]
    kwargs = [e[1] for e in events if e[0] == "generate"]
    assert all(k["do_sample"] is False and k["max_new_tokens"] == 192 for k in kwargs)
    assert torch.equal(kwargs[0]["input_ids"], kwargs[1]["input_ids"])
    assert engine.status()["cpu_fallback_used"] is False
    args.device = "cuda"
    with pytest.raises(RuntimeError, match="CUDA runtime unavailable"):
        evaluation.PairedEngine(args)


@pytest.mark.parametrize("answer,flag", [
    ("阳乃是我唯一的亲人。", True),
    ("姐姐就是我唯一的家人。", True),
    ("我唯一的亲人是阳乃。", True),
    ("阳乃不是我唯一的亲人，父母也在。", False),
    ("阳乃并非我唯一的亲人。", False),
    ("你说“阳乃是我唯一的亲人”是错的。", False),
    ("不能说姐姐是我唯一的亲人。", False),
    ("姐姐是姐姐，我也有父母。", False),
])
def test_known_error_flag_never_claims_a_score(answer, flag):
    result = evaluation.review_flags(answer)
    assert result == {"possible_only_relative_assertion": flag}
    assert "score" not in result and "passed" not in result
