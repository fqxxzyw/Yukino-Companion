"""Checkpoint integrity and best-model orchestration without a model download."""

import json
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pytest

from yuki_model import training
from yuki_model.io import file_sha, save_json, save_jsonl


def write_checkpoint(out, step, *, epoch=1, max_steps=20, best=None, counter=0):
    path = out / f"checkpoint-{step}"
    path.mkdir(parents=True, exist_ok=True)
    for name in training.CHECKPOINT_FILES:
        (path / name).write_bytes(f"{name}:{step}".encode())
    save_json(path / "trainer_state.json", {
        "global_step": step, "epoch": epoch, "max_steps": max_steps,
        "best_model_checkpoint": str(best) if best else None,
        "best_metric": 0.25 if best else None,
        "is_world_process_zero": True,
        "stateful_callbacks": {"EarlyStoppingCallback": {
            "args": {"early_stopping_patience": 3, "early_stopping_threshold": 0.001},
            "attributes": {"early_stopping_patience_counter": counter},
        }},
    })
    return path


def resume_run(tmp_path, marked=True):
    out = tmp_path / "run"
    out.mkdir()
    config = {"output_dir": str(out), "epochs": 12}
    provenance = {"train_sha256": "train", "eval_sha256": "val", "adapter_mode": "fresh"}
    if marked:
        provenance["checkpoint_format"] = "sha256-v1"
    save_json(out / "run_config.json", config)
    save_json(out / "data_provenance.json", provenance)
    return out, config, provenance


def test_auto_resume_skips_interrupted_and_corrupt_drive_checkpoints(tmp_path):
    out, config, provenance = resume_run(tmp_path)
    good = write_checkpoint(out, 2)
    training.mark_checkpoint_complete(good)
    interrupted = write_checkpoint(out, 3)
    # All files can exist while an upload is still partial: absence of marker excludes it.
    corrupted = write_checkpoint(out, 4)
    training.mark_checkpoint_complete(corrupted)
    (corrupted / "optimizer.pt").write_bytes(b"interrupted replacement")
    assert training.validate_resume(out, config | {"resume": True}, provenance) == str(good.resolve())
    with pytest.raises(ValueError, match="completion marker"):
        training.validate_resume(out, config | {"resume": str(interrupted)}, provenance)
    with pytest.raises(ValueError, match="checksum"):
        training.validate_resume(out, config | {"resume": str(corrupted)}, provenance)


def test_legacy_resume_keeps_old_full_checkpoint_compatibility(tmp_path):
    out, config, provenance = resume_run(tmp_path, marked=False)
    old = write_checkpoint(out, 2)
    incomplete = write_checkpoint(out, 3)
    (incomplete / "rng_state.pth").unlink()
    assert training.validate_resume(out, config | {"resume": True}, provenance) == str(old.resolve())
    training.mark_checkpoint_complete(old)
    (old / "scheduler.pt").write_bytes(b"modified")
    with pytest.raises(ValueError, match="No complete"):
        training.validate_resume(out, config | {"resume": True}, provenance)


def test_marker_requires_all_state_and_rejects_tampering(tmp_path):
    path = write_checkpoint(tmp_path, 8)
    training.mark_checkpoint_complete(path)
    marker = json.loads((path / training.CHECKPOINT_MARKER).read_text())
    assert set(marker["sha256"]) == set(training.CHECKPOINT_FILES)
    marker["sha256"].pop("optimizer.pt")
    save_json(path / training.CHECKPOINT_MARKER, marker)
    with pytest.raises(ValueError, match="marker is invalid"):
        training.checkpoint_state(path, require_marker=True)
    training.mark_checkpoint_complete(path)  # A complete re-save can replace a stale marker.
    assert training.checkpoint_state(path, True)["global_step"] == 8


def test_best_checkpoint_must_remain_valid_and_inside_run(tmp_path):
    out, config, provenance = resume_run(tmp_path)
    config["load_best_model_at_end"] = True
    save_json(out / "run_config.json", config)
    fallback = write_checkpoint(out, 1)
    training.mark_checkpoint_complete(fallback)
    best = write_checkpoint(out, 2)
    training.mark_checkpoint_complete(best)
    last = write_checkpoint(out, 3, best=best)
    training.mark_checkpoint_complete(last)
    (best / "adapter_model.safetensors").write_bytes(b"corrupt best")
    with pytest.raises(ValueError, match="checksum"):
        training.validate_resume(out, config | {"resume": str(last)}, provenance)
    assert training.validate_resume(out, config | {"resume": True}, provenance) == str(fallback.resolve())


@pytest.mark.parametrize("options", [
    {"early_stopping_patience": -1}, {"early_stopping_patience": True},
    {"early_stopping_threshold": float("nan")}, {"early_stopping_threshold": -0.1},
    {"early_stopping_patience": 3, "load_best_model_at_end": False},
    {"early_stopping_patience": 3, "restore_callback_states_from_checkpoint": False},
])
def test_invalid_selection_is_rejected_before_loading_weights(options):
    with pytest.raises(ValueError):
        training.validate_training_spec(options)


def test_old_selection_defaults_and_terminal_checkpoint_rules():
    assert training.training_selection_options({}) == (0, 0.0, False, False)
    assert training.training_selection_options({"early_stopping_patience": 3}) == (3, 0.0, True, True)
    assert training.checkpoint_finished({"global_step": 10, "max_steps": 10}, {"epochs": 12})
    assert training.checkpoint_finished({"epoch": 12}, {"epochs": 12})
    assert not training.checkpoint_finished({"epoch": 3, "global_step": 3, "max_steps": 12}, {"epochs": 12})


def test_distillation_manifest_is_mandatory_for_new_task(monkeypatch):
    module = ModuleType("yuki_model.distillation")
    calls = []
    def validate(config):
        calls.append(config)
        return {"data_manifest_sha256": "checked", "distill_manifest": {"valid": True}}
    module.validate_manifest = validate
    monkeypatch.setitem(sys.modules, module.__name__, module)
    config = {"task": "distill_sft"}
    assert training.validate_training_spec(config)["data_manifest_sha256"] == "checked"
    assert calls == [config]


@pytest.fixture
def fake_framework(monkeypatch):
    events = SimpleNamespace(trainers=[], loads=[], train_calls=0, fail_after_save=False)
    torch = ModuleType("torch")
    torch.__version__ = "2.8.0"
    torch.set_num_threads = lambda n: None
    torch.float32, torch.float16, torch.bfloat16 = "float32", "float16", "bfloat16"
    torch.OutOfMemoryError = type("OutOfMemoryError", (RuntimeError,), {})
    torch.cuda = SimpleNamespace(is_bf16_supported=lambda: False)
    monkeypatch.setitem(sys.modules, "torch", torch)
    monkeypatch.setattr(training, "detect", lambda: {"native_cpu_bf16": False})
    monkeypatch.setattr(training, "device", lambda info, requested: "cpu")

    class Tokenizer:
        pad_token, eos_token, pad_token_id = "pad", "eos", 0
        @classmethod
        def from_pretrained(cls, *a, **kw):
            return cls()
        def apply_chat_template(self, messages, tokenize=True, add_generation_prompt=False):
            text = "".join(f"<{m['role']}>" + m["content"] + "</turn>" for m in messages)
            if add_generation_prompt:
                text += "<assistant>"
            return list(map(ord, text))
        def save_pretrained(self, path):
            (Path(path) / "tokenizer.json").write_text("{}")

    class Model:
        def __init__(self):
            self.config = SimpleNamespace(use_cache=True)
            self.weights = b"initial adapter"
        @classmethod
        def from_pretrained(cls, *a, **kw):
            return cls()
        def to(self, device):
            return self
        def print_trainable_parameters(self):
            pass
        def get_nb_trainable_parameters(self):
            return 10, 100

    class TrainerState(SimpleNamespace):
        @classmethod
        def load_from_json(cls, path):
            return cls(**json.loads(Path(path).read_text()))

    class EarlyStoppingCallback:
        def __init__(self, **kw):
            self.__dict__.update(kw)

    class Trainer:
        def __init__(self, model, args, callbacks, **kw):
            self.model, self.args, self.callbacks = model, args, callbacks
            self.kwargs = kw
            self.state = TrainerState(global_step=0, epoch=0, max_steps=12,
                                      best_model_checkpoint=None, best_metric=None)
            self.evaluations = 0
            events.trainers.append(self)
        def evaluate(self):
            self.evaluations += 1
            return {"eval_loss": 2.0 if self.state.global_step == 0 else 0.25}
        def train(self, resume_from_checkpoint=None):
            events.train_calls += 1
            out = Path(self.args.output_dir)
            selecting = self.args.load_best_model_at_end
            best = write_checkpoint(out, 2, epoch=2, max_steps=12)
            training.mark_checkpoint_complete(best)
            last = write_checkpoint(out, 5, epoch=5, max_steps=12 if selecting else 5,
                                    best=best if selecting else None, counter=3 if selecting else 0)
            self.state = TrainerState.load_from_json(last / "trainer_state.json")
            for callback in self.callbacks:
                if hasattr(callback, "on_save"):
                    callback.on_save(self.args, self.state, SimpleNamespace())
            if events.fail_after_save:
                raise RuntimeError("simulated disconnect after full checkpoint")
            self.model.weights = ((best if selecting else last) / "adapter_model.safetensors").read_bytes()
            return SimpleNamespace(metrics={"train_loss": 0.5})
        def save_model(self, path):
            path = Path(path)
            path.mkdir(parents=True, exist_ok=True)
            (path / "adapter_model.safetensors").write_bytes(self.model.weights)
            save_json(path / "adapter_config.json", {"r": 8})

    transformers = ModuleType("transformers")
    transformers.AutoTokenizer, transformers.AutoModelForCausalLM = Tokenizer, Model
    transformers.Trainer, transformers.TrainingArguments = Trainer, lambda **kw: SimpleNamespace(**kw)
    transformers.TrainerState, transformers.TrainerCallback = TrainerState, type("TrainerCallback", (), {})
    transformers.EarlyStoppingCallback = EarlyStoppingCallback
    transformers.set_seed = lambda n: None
    monkeypatch.setitem(sys.modules, "transformers", transformers)

    class PeftModel:
        @staticmethod
        def from_pretrained(model, path, **kw):
            events.loads.append(str(path))
            model.weights = (Path(path) / "adapter_model.safetensors").read_bytes()
            return model
    peft = ModuleType("peft")
    peft.LoraConfig = lambda **kw: kw
    peft.PeftModel = PeftModel
    peft.get_peft_model = lambda model, config: model
    peft.prepare_model_for_kbit_training = lambda model: model
    monkeypatch.setitem(sys.modules, "peft", peft)
    return events


def tiny_config(tmp_path, best=True):
    def row(prompt):
        return {"reviewed": True, "messages": [
            {"role": "user", "content": prompt}, {"role": "assistant", "content": "target"},
        ]}
    train_file, val_file = tmp_path / "train.jsonl", tmp_path / "val.jsonl"
    save_jsonl(train_file, [row("training")])
    save_jsonl(val_file, [row("validation")])
    config = {"train_file": str(train_file), "eval_file": str(val_file),
              "output_dir": str(tmp_path / "run"), "allow_cpu": True, "epochs": 12}
    if best:
        config.update(early_stopping_patience=3, early_stopping_threshold=0.001,
                      load_best_model_at_end=True, restore_callback_states_from_checkpoint=True)
    return config


def test_training_exports_best_and_reports_actual_epochs(tmp_path, fake_framework):
    config = tiny_config(tmp_path)
    report = training.train(config)
    out = Path(config["output_dir"])
    assert report["before"]["eval_loss"] == 2.0
    assert report["before_origin"] == "original_run_baseline"
    assert report["actual_epoch"] == 5 and report["configured_epochs"] == 12
    assert report["stopped_early"] is True
    assert report["selected_weights"] == "best_validation_loss"
    assert file_sha(out / "adapter/adapter_model.safetensors") == file_sha(out / "checkpoint-2/adapter_model.safetensors")
    assert training.checkpoint_state(out / "checkpoint-5", True)["global_step"] == 5
    args = fake_framework.trainers[0].args
    assert args.restore_callback_states_from_checkpoint and not args.save_only_model
    assert args.metric_for_best_model == "eval_loss" and args.greater_is_better is False
    assert args.save_strategy == args.eval_strategy == "epoch"
    # Training loads only train/val; test data is not a Trainer dataset.
    assert set(fake_framework.trainers[0].kwargs) == {
        "train_dataset", "eval_dataset", "data_collator", "processing_class",
    }


def test_old_torch_rejected_before_creating_an_unresumable_run(tmp_path, fake_framework):
    sys.modules["torch"].__version__ = "2.5.1+cpu"
    with pytest.raises(RuntimeError, match="torch>=2.6"):
        training.train(tiny_config(tmp_path))
    assert not fake_framework.trainers
    assert not (tmp_path / "run").exists()


@pytest.mark.parametrize("best", [True, False])
def test_disconnect_after_terminal_save_only_finalizes_no_extra_training(tmp_path, fake_framework, best):
    config = tiny_config(tmp_path, best=best)
    fake_framework.fail_after_save = True
    with pytest.raises(RuntimeError, match="simulated disconnect"):
        training.train(config)
    fake_framework.fail_after_save = False
    report = training.train(config | {"resume": True})
    out = Path(config["output_dir"])
    selected = out / ("checkpoint-2" if best else "checkpoint-5")
    assert fake_framework.train_calls == 1
    assert report["recovered_from_terminal_checkpoint"] is True
    assert report["before"]["eval_loss"] == 2.0
    assert report["actual_epoch"] == 5
    assert file_sha(out / "adapter/adapter_model.safetensors") == file_sha(selected / "adapter_model.safetensors")
    assert fake_framework.loads[-1] == str(selected)
    assert fake_framework.trainers[-1].evaluations == 1


def test_legacy_missing_baseline_is_not_measured_as_resumed_quality(tmp_path, fake_framework):
    config = tiny_config(tmp_path)
    fake_framework.fail_after_save = True
    with pytest.raises(RuntimeError, match="simulated disconnect"):
        training.train(config)
    (Path(config["output_dir"]) / "baseline.json").unlink()
    fake_framework.fail_after_save = False
    report = training.train(config | {"resume": True})
    assert report["before"] is None
    assert report["before_origin"] == "unavailable_in_legacy_run"
    assert fake_framework.trainers[-1].evaluations == 1
