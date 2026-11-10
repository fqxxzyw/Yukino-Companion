"""LoRA CPT and assistant-only supervised training; same adapter on CPU or GPU."""

import json
import math
import random
import re
from pathlib import Path
from .io import read_jsonl, save_json, file_sha, sha
from .hardware import detect, device

BASE = "Qwen/Qwen2.5-1.5B-Instruct"
REVISION = "989aa7980e4cf806f80c7fef2b1adb7bc71aa306"
CHECKPOINT_FILES = (
    "adapter_config.json",
    "adapter_model.safetensors",
    "trainer_state.json",
    "optimizer.pt",
    "scheduler.pt",
    "rng_state.pth",
)
CHECKPOINT_MARKER = "checkpoint-complete.json"


def checkpoint_state(path, require_marker=False):
    """Validate a single-GPU checkpoint; a marker is written only after all saves finish."""
    path = Path(path)
    step = re.fullmatch(r"checkpoint-([1-9]\d*)", path.name)
    if step is None:
        raise ValueError("Invalid checkpoint directory name")
    for name in CHECKPOINT_FILES:
        file = path / name
        if not file.is_file() or not file.stat().st_size:
            raise ValueError(f"Resume checkpoint is incomplete: {name}")
    state = json.loads((path / "trainer_state.json").read_text(encoding="utf-8"))
    if not isinstance(state, dict) or state.get("global_step") != int(step[1]):
        raise ValueError("Resume checkpoint step does not match the saved trainer state")
    marker_path = path / CHECKPOINT_MARKER
    if require_marker and not marker_path.is_file():
        raise ValueError("Resume checkpoint lacks its completion marker")
    if marker_path.is_file():
        marker = json.loads(marker_path.read_text(encoding="utf-8"))
        if (not isinstance(marker, dict) or marker.get("schema_version") != 1
                or marker.get("global_step") != int(step[1])
                or not isinstance(marker.get("sha256"), dict)
                or set(marker.get("sha256", {})) != set(CHECKPOINT_FILES)):
            raise ValueError("Resume checkpoint completion marker is invalid")
        for name, digest in marker["sha256"].items():
            if file_sha(path / name) != digest:
                raise ValueError(f"Resume checkpoint checksum differs: {name}")
    return state


def mark_checkpoint_complete(path):
    """Read back full state, then publish a small final marker atomically."""
    path = Path(path)
    # A retried save may replace an interrupted checkpoint at the same step.
    (path / CHECKPOINT_MARKER).unlink(missing_ok=True)
    state = checkpoint_state(path)
    save_json(path / CHECKPOINT_MARKER, {
        "schema_version": 1,
        "global_step": state["global_step"],
        "sha256": {name: file_sha(path / name) for name in CHECKPOINT_FILES},
    })
    checkpoint_state(path, require_marker=True)


def training_selection_options(c):
    """Old configs keep their final epoch; early stopping explicitly selects validation loss."""
    patience = c.get("early_stopping_patience", 0)
    threshold = c.get("early_stopping_threshold", 0.0)
    if type(patience) is not int or patience < 0:
        raise ValueError("early_stopping_patience must be a nonnegative integer")
    if (type(threshold) not in (int, float) or not math.isfinite(threshold)
            or threshold < 0):
        raise ValueError("early_stopping_threshold must be finite and nonnegative")
    best = c.get("load_best_model_at_end", patience > 0)
    restore = c.get("restore_callback_states_from_checkpoint", patience > 0)
    if type(best) is not bool or type(restore) is not bool:
        raise ValueError("Best-model selection and callback restoration must be booleans")
    if patience and not (best and restore):
        raise ValueError("Early stopping requires best-model selection and callback restoration")
    return patience, threshold, best, restore


def checkpoint_finished(state, config):
    """A terminal saved epoch can be finalized after a disconnect without another update."""
    target_steps = state.get("max_steps", 0)
    if target_steps > 0 and state.get("global_step", 0) >= target_steps:
        return True
    if float(state.get("epoch") or 0) >= float(config.get("epochs", 2)):
        return True
    callback = state.get("stateful_callbacks", {}).get("EarlyStoppingCallback", {})
    counter = callback.get("attributes", {}).get("early_stopping_patience_counter", 0)
    return bool(config.get("early_stopping_patience", 0) and
                counter >= config["early_stopping_patience"])


def encode_row(row, tokenizer, limit, mode="sft"):
    if mode == "cpt":
        ids = tokenizer.encode(row["text"], add_special_tokens=False) + [
            tokenizer.eos_token_id
        ]
        return [
            {
                "input_ids": part,
                "attention_mask": [1] * len(part),
                "labels": part.copy(),
            }
            for start in range(0, len(ids), limit)
            if len(part := ids[start : start + limit]) >= 16
        ]
    if not row.get("reviewed"):
        raise ValueError("SFT requires reviewed:true; never guess novel speakers")
    messages = row["messages"]
    if not messages or messages[-1]["role"] != "assistant":
        raise ValueError("SFT needs final assistant answer")
    prefix = tokenizer.apply_chat_template(
        messages[:-1], tokenize=True, add_generation_prompt=True
    )
    full = tokenizer.apply_chat_template(
        messages, tokenize=True, add_generation_prompt=False
    )
    if full[: len(prefix)] != prefix:
        raise ValueError("Chat template prefix mismatch")
    if len(prefix) >= limit - 1:
        raise ValueError("SFT prompt too long; increase sequence_length")
    if len(full) > limit:
        raise ValueError("SFT answer would be truncated; increase sequence_length")
    return [
        {
            "input_ids": full,
            "attention_mask": [1] * len(full),
            "labels": [-100] * len(prefix) + full[len(prefix) :],
        }
    ]


class Collator:
    def __init__(self, pad):
        self.pad = pad

    def __call__(self, rows):
        import torch

        width = max(len(r["input_ids"]) for r in rows)
        return {
            key: torch.tensor(
                [r[key] + [pad] * (width - len(r[key])) for r in rows], dtype=torch.long
            )
            for key, pad in [
                ("input_ids", self.pad),
                ("attention_mask", 0),
                ("labels", -100),
            ]
        }


def validate_training_spec(c):
    """Reject ambiguous adapter reuse and data leakage before allocating weights."""
    training_selection_options(c)
    if c.get("run_purpose", "training") not in {"training", "smoke"}:
        raise ValueError("run_purpose must be training or smoke")
    mode = c.get("adapter_mode", "fresh")
    initial = c.get("initial_adapter")
    if mode not in {"fresh", "continue"}:
        raise ValueError("adapter_mode must be fresh or continue")
    if (mode == "continue") != bool(initial):
        raise ValueError(
            "Only adapter_mode:continue accepts and requires initial_adapter"
        )
    meta = {"adapter_mode": mode}
    if initial:
        path = Path(initial)
        weights = path / "adapter_model.safetensors"
        if not weights.is_file():
            raise ValueError("initial_adapter must contain safetensors LoRA weights")
        weights_sha256 = file_sha(weights)
        report_path = path.parent / "training_report.json"
        if report_path.is_file():
            report = json.loads(report_path.read_text(encoding="utf-8"))
            if report.get("base_revision") != c.get("revision", REVISION):
                raise ValueError("Initial adapter and requested base revisions differ")
            reported_sha256 = report.get("adapter_sha256")
            if reported_sha256 and reported_sha256 != weights_sha256:
                raise ValueError("Initial adapter weights differ from their training report")
        elif not c.get("allow_unverified_initial_adapter", False):
            raise ValueError(
                "Initial adapter lacks base provenance; do not silently combine unknown weights"
            )
        meta["initial_adapter_sha256"] = weights_sha256
        adapter_config = path / "adapter_config.json"
        if adapter_config.is_file():
            meta["initial_adapter_config_sha256"] = file_sha(adapter_config)
    if c.get("task") == "distill_sft":
        from .distillation import validate_manifest

        meta.update(validate_manifest(c))
    if c.get("task") == "complete_persona":
        from .persona import valid_review

        if not c.get("allow_synthetic_persona"):
            raise ValueError(
                "Synthetic persona training requires allow_synthetic_persona:true; targets are not human accepted"
            )
        manifest_path = Path(c["data_manifest"])
        manifest = json.loads(manifest_path.read_text())
        if not manifest.get("tokenization_checked"):
            raise ValueError("Run the persona builder with a tokenizer before training")
        if manifest.get("base_revision") != c.get("revision", REVISION):
            raise ValueError("Persona data expects a different base revision")
        if manifest.get("max_tokens", 0) > c.get("sequence_length", 512):
            raise ValueError(
                "Training sequence_length is smaller than the validated persona examples"
            )
        families = {}
        for split, field in [("train", "train_file"), ("val", "eval_file")]:
            if file_sha(c[field]) != manifest["sha256"][split]:
                raise ValueError("Persona dataset changed after manifest creation")
            rows = list(read_jsonl(c[field]))
            families[split] = {r["family_id"] for r in rows}
            if families[split] != set(manifest["split_family_ids"][split]):
                raise ValueError(
                    "Persona scenario families do not match their split manifest"
                )
            for family in families[split]:
                variants = [r["variant_id"] for r in rows if r["family_id"] == family]
                if len(variants) < 3 or len(set(variants)) != len(variants):
                    raise ValueError(
                        "Every scenario family needs at least three distinct variants"
                    )
            if any(
                not valid_review(r) or r.get("provenance") != "synthetic_original"
                for r in rows
            ):
                raise ValueError(
                    "Synthetic persona review status and human_reviewed flag must agree"
                )
        if families["train"] & families["val"]:
            raise ValueError("Scenario-family leakage between train and validation")
        if families["train"] & set(manifest["split_family_ids"]["test"]) or families[
            "val"
        ] & set(manifest["split_family_ids"]["test"]):
            raise ValueError("Test scenario leaked into development data")
        meta.update(
            data_manifest_sha256=file_sha(manifest_path), persona_manifest=manifest
        )
    return meta


def validate_resume(out, config, provenance):
    """Check that the checkpoint belongs to the unfinished run and its original inputs."""
    if (out / "training_report.json").exists():
        raise ValueError("This run already has a training report; use a new output directory")
    config_file = out / "run_config.json"
    provenance_file = out / "data_provenance.json"
    if not config_file.is_file() or not provenance_file.is_file():
        raise ValueError("Resuming requires the original run configuration and data provenance")

    saved_config = json.loads(config_file.read_text(encoding="utf-8"))
    saved_config.pop("resume", None)
    if saved_config != {key: value for key, value in config.items() if key != "resume"}:
        raise ValueError("Resume configuration differs from the original run")

    saved_provenance = json.loads(provenance_file.read_text(encoding="utf-8"))
    fields = [
        "train_sha256",
        "eval_sha256",
        "adapter_mode",
        "initial_adapter_sha256",
        "data_manifest_sha256",
    ]
    # Older runs recorded the origin weights but did not hash their adapter configuration.
    if "initial_adapter_config_sha256" in saved_provenance:
        fields.append("initial_adapter_config_sha256")
    if any(saved_provenance.get(key) != provenance.get(key) for key in fields):
        raise ValueError("Resume data or initial adapter differs from the original run")

    require_marker = saved_provenance.get("checkpoint_format") == "sha256-v1"
    def verify_candidate(candidate):
        state = checkpoint_state(candidate, require_marker=require_marker)
        if config.get("load_best_model_at_end", bool(config.get("early_stopping_patience"))):
            best_path = state.get("best_model_checkpoint")
            if best_path:
                best_path = Path(best_path).resolve()
                if best_path.parent != out.resolve():
                    raise ValueError("Best checkpoint must be inside the original output directory")
                checkpoint_state(best_path, require_marker=require_marker)
        return state

    checkpoint = config["resume"]
    if checkpoint is True:
        checkpoint = None
        candidates = sorted(
            (path for path in out.glob("checkpoint-*")
             if re.fullmatch(r"checkpoint-[1-9]\d*", path.name)),
            key=lambda path: int(path.name.split("-")[-1]), reverse=True,
        )
        for candidate in candidates:
            try:
                verify_candidate(candidate)
            except (OSError, ValueError, TypeError, KeyError):
                continue
            checkpoint = candidate
            break
        if checkpoint is None:
            raise ValueError("No complete checkpoint exists in the original run")
    checkpoint = Path(checkpoint).resolve()
    step = re.fullmatch(r"checkpoint-([1-9]\d*)", checkpoint.name)
    if checkpoint.parent != out.resolve() or step is None:
        raise ValueError("Resume checkpoint must be directly inside the original output directory")

    verify_candidate(checkpoint)
    return str(checkpoint)


def train(c):
    specification = validate_training_spec(c)
    patience, threshold, select_best, restore_callbacks = training_selection_options(c)
    provenance = {
        "train_sha256": file_sha(c["train_file"]),
        "eval_sha256": file_sha(c["eval_file"]),
        "checkpoint_format": "sha256-v1",
        **specification,
    }
    retention = c.get("save_total_limit", 2)
    if type(retention) is not int or retention < 1:
        raise ValueError("save_total_limit must be a positive integer")
    out = Path(c["output_dir"])
    checkpoint = validate_resume(out, c, provenance) if c.get("resume") else None
    if checkpoint:
        original_provenance = json.loads((out / "data_provenance.json").read_text(encoding="utf-8"))
        provenance["checkpoint_format"] = original_provenance.get("checkpoint_format", "legacy-full-state")
    resumed_state = checkpoint_state(checkpoint) if checkpoint else None
    terminal_checkpoint = bool(resumed_state and checkpoint_finished(resumed_state, c))
    if checkpoint is None and out.exists() and any(out.iterdir()):
        raise ValueError("Output exists; choose a new directory or resume")

    import torch
    torch_version = re.match(r"(\d+)\.(\d+)", torch.__version__)
    if not torch_version or tuple(map(int, torch_version.groups())) < (2, 6):
        raise RuntimeError(
            "Resumable training requires torch>=2.6; Transformers refuses older optimizer-state loads. "
            "Use the Colab CUDA environment or upgrade the training environment before starting."
        )
    from transformers import (
        AutoTokenizer,
        AutoModelForCausalLM,
        TrainingArguments,
        Trainer,
        TrainerCallback,
        TrainerState,
        EarlyStoppingCallback,
        set_seed,
    )
    from peft import (
        LoraConfig,
        PeftModel,
        get_peft_model,
        prepare_model_for_kbit_training,
    )

    info = detect()
    selected = device(info, c.get("device", "auto"))
    if selected == "mps":
        raise RuntimeError(
            "MPS training is not validated. Select CPU or CUDA; MPS inference is separate."
        )
    if selected == "cpu" and not c.get("allow_cpu", False):
        raise RuntimeError(
            "CPU training requires allow_cpu:true; inference still automatically supports CPU"
        )
    quant = c.get("quantize_4bit", False)
    if quant and selected != "cuda":
        raise ValueError("This QLoRA training path requires CUDA")
    limit = c.get("sequence_length", 512)
    if not 32 <= limit <= 4096:
        raise ValueError("sequence_length must be 32..4096")
    out.mkdir(parents=True, exist_ok=True)
    set_seed(c.get("seed", 42))
    torch.set_num_threads(c.get("threads", 4))
    source = c.get("model", BASE)
    kw = {"trust_remote_code": False}
    if not Path(source).is_dir():
        kw["revision"] = c.get("revision", REVISION)
    tokenizer = AutoTokenizer.from_pretrained(source, **kw)
    tokenizer.pad_token = tokenizer.pad_token or tokenizer.eos_token
    use_bf16 = (selected == "cuda" and torch.cuda.is_bf16_supported()) or (
        selected == "cpu" and c.get("cpu_bf16", False) and info["native_cpu_bf16"]
    )
    dtype = (
        torch.bfloat16
        if use_bf16
        else torch.float16
        if selected == "cuda"
        else torch.float32
    )
    load_kw = {**kw, "torch_dtype": dtype, "low_cpu_mem_usage": True}
    if quant:
        from transformers import BitsAndBytesConfig

        load_kw.update(
            quantization_config=BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_use_double_quant=True,
                bnb_4bit_compute_dtype=dtype,
            ),
            device_map={"": 0},
        )
    model = AutoModelForCausalLM.from_pretrained(source, **load_kw)
    if quant:
        model = prepare_model_for_kbit_training(model)
    else:
        model.to(selected)
    model.config.use_cache = False
    if terminal_checkpoint:
        selected_checkpoint = resumed_state.get("best_model_checkpoint") if select_best else checkpoint
        if not selected_checkpoint:
            raise ValueError("Terminal checkpoint has no selected best model")
        model = PeftModel.from_pretrained(
            model, selected_checkpoint, is_trainable=True, local_files_only=True
        )
    elif c.get("adapter_mode", "fresh") == "continue":
        model = PeftModel.from_pretrained(
            model, c["initial_adapter"], is_trainable=True, local_files_only=True
        )
    else:
        model = get_peft_model(
            model,
            LoraConfig(
                r=c.get("rank", 8),
                lora_alpha=c.get("rank", 8) * 2,
                lora_dropout=0.05,
                target_modules="all-linear",
                bias="none",
                task_type="CAUSAL_LM",
            ),
        )
    model.print_trainable_parameters()

    def load(path):
        data = []
        for row in read_jsonl(path):
            data.extend(encode_row(row, tokenizer, limit, c.get("mode", "sft")))
        if not data:
            raise ValueError("Empty training/eval set")
        return data

    training = load(c["train_file"])
    validation = load(c["eval_file"])
    hashes = {sha(json.dumps(r["input_ids"])) for r in training}
    if any(sha(json.dumps(r["input_ids"])) in hashes for r in validation):
        raise ValueError("Exact train/eval overlap")
    if len(validation) > c.get("max_eval_samples", 128):
        validation = random.Random(c.get("seed", 42)).sample(
            validation, c.get("max_eval_samples", 128)
        )
    args = TrainingArguments(
        output_dir=str(out),
        per_device_train_batch_size=c.get("batch_size", 1),
        per_device_eval_batch_size=1,
        gradient_accumulation_steps=c.get("gradient_accumulation_steps", 4),
        num_train_epochs=c.get("epochs", 2),
        max_steps=c.get("max_steps", -1),
        learning_rate=c.get("learning_rate", 5e-5),
        warmup_ratio=0.05,
        weight_decay=0.01,
        lr_scheduler_type="cosine",
        optim="adamw_torch",
        bf16=use_bf16,
        fp16=selected == "cuda" and not use_bf16,
        use_cpu=selected == "cpu",
        gradient_checkpointing=True,
        gradient_checkpointing_kwargs={"use_reentrant": False},
        eval_strategy="epoch",
        save_strategy="epoch",
        save_total_limit=retention,
        logging_steps=5,
        report_to="none",
        seed=c.get("seed", 42),
        data_seed=c.get("seed", 42),
        dataloader_num_workers=0,
        dataloader_pin_memory=selected == "cuda",
        remove_unused_columns=False,
        prediction_loss_only=True,
        load_best_model_at_end=select_best,
        metric_for_best_model="eval_loss" if select_best else None,
        greater_is_better=False if select_best else None,
        restore_callback_states_from_checkpoint=restore_callbacks,
        save_only_model=False,
    )
    class CompleteCheckpointCallback(TrainerCallback):
        def on_save(self, args, state, control, **kwargs):
            if state.is_world_process_zero:
                mark_checkpoint_complete(Path(args.output_dir) / f"checkpoint-{state.global_step}")
            return control

    callbacks = [CompleteCheckpointCallback()]
    if patience:
        callbacks.append(EarlyStoppingCallback(
            early_stopping_patience=patience, early_stopping_threshold=threshold
        ))
    trainer = Trainer(
        model=model,
        args=args,
        train_dataset=training,
        eval_dataset=validation,
        data_collator=Collator(tokenizer.pad_token_id),
        processing_class=tokenizer,
        callbacks=callbacks,
    )
    provenance.update(
        train_examples=len(training),
        eval_examples=len(validation),
        train_tokens=sum(sum(v != -100 for v in r["labels"]) for r in training),
    )
    if checkpoint is None:
        save_json(
            out / "run_config.json", {key: value for key, value in c.items() if key != "resume"}
        )
        save_json(out / "data_provenance.json", provenance)

    def probe():
        if not c.get("probe_questions"):
            return []
        model.eval()
        answers = []
        for q in c["probe_questions"]:
            messages = [
                {
                    "role": "system",
                    "content": "你是熟悉《春物》的中文助手。简短、准确地回答，不确定就说明。",
                },
                {"role": "user", "content": q},
            ]
            ids = tokenizer.apply_chat_template(
                messages, tokenize=True, add_generation_prompt=True, return_tensors="pt"
            ).to(selected)
            with torch.inference_mode():
                output = model.generate(
                    input_ids=ids,
                    attention_mask=torch.ones_like(ids),
                    max_new_tokens=80,
                    do_sample=False,
                    use_cache=True,
                    pad_token_id=tokenizer.eos_token_id,
                )
            answers.append(
                {
                    "question": q,
                    "answer": tokenizer.decode(
                        output[0, ids.shape[1] :], skip_special_tokens=True
                    ),
                }
            )
        return answers

    baseline_path = out / "baseline.json"
    if checkpoint:
        # Never measure the initial adapter and present it as resumed model quality.
        baseline = (json.loads(baseline_path.read_text(encoding="utf-8"))
                    if baseline_path.is_file() else {})
        before = baseline.get("metrics")
        before_origin = "original_run_baseline" if before is not None else "unavailable_in_legacy_run"
    else:
        before = trainer.evaluate()
        before_origin = "original_run_baseline"
        save_json(baseline_path, {"metrics": before, "origin": before_origin})
        save_json(out / "probes_before.json", probe())
    if terminal_checkpoint:
        trainer.state = TrainerState.load_from_json(str(Path(checkpoint) / "trainer_state.json"))
        training_metrics = {"recovered_from_terminal_checkpoint": True}
    else:
        try:
            result = trainer.train(resume_from_checkpoint=checkpoint)
        except torch.OutOfMemoryError as e:
            raise RuntimeError(
                "Training OOM. Reduce sequence/batch size or use QLoRA. No silent CPU restart."
            ) from e
        training_metrics = result.metrics
    actual_epoch = float(trainer.state.epoch or 0)
    best_checkpoint = trainer.state.best_model_checkpoint
    if select_best:
        if not best_checkpoint:
            raise RuntimeError("Best-model selection finished without a best checkpoint")
        checkpoint_state(best_checkpoint, require_marker=checkpoint is None or
                         json.loads((out / "data_provenance.json").read_text(encoding="utf-8"))
                         .get("checkpoint_format") == "sha256-v1")
    stopped_early = bool(patience and actual_epoch < float(c.get("epochs", 2)) and
                         trainer.state.global_step < trainer.state.max_steps)
    after = trainer.evaluate()
    trainer.save_model(str(out / "adapter"))
    tokenizer.save_pretrained(out / "adapter")
    save_json(out / "probes_after.json", probe())
    trainable, total = model.get_nb_trainable_parameters()
    report = {
        "completed": True,
        "task": c.get(
            "task", "knowledge_sft" if c.get("mode", "sft") == "sft" else "cpt"
        ),
        "adapter_sha256": file_sha(out / "adapter" / "adapter_model.safetensors"),
        "run_purpose": c.get("run_purpose", "training"),
        "base_model": source,
        "base_revision": c.get("revision", REVISION),
        "hardware": info,
        "device": selected,
        "dtype": str(dtype),
        "mode": c.get("mode", "sft"),
        "trainable_parameters": trainable,
        "total_parameters": total,
        "steps": trainer.state.global_step,
        "configured_epochs": c.get("epochs", 2),
        "actual_epoch": actual_epoch,
        "stopped_early": stopped_early,
        "early_stopping_patience": patience,
        "early_stopping_threshold": threshold,
        "best_checkpoint": best_checkpoint,
        "best_metric": trainer.state.best_metric,
        "selected_weights": "best_validation_loss" if select_best else "final_epoch",
        "resume_checkpoint": checkpoint,
        "recovered_from_terminal_checkpoint": terminal_checkpoint,
        "before": before,
        "before_origin": before_origin,
        "after": after,
        "training_metrics": training_metrics,
        "data": provenance,
        "perplexity_after": math.exp(min(after["eval_loss"], 20)),
        "quality_claim": "Configured training completed; not proof of complete canon knowledge or character fidelity.",
    }
    save_json(out / "training_report.json", report)
    return report


def merge(base, adapter, dest, revision=None):
    import torch
    from transformers import AutoTokenizer, AutoModelForCausalLM
    from peft import PeftModel

    dest = Path(dest)
    if dest.exists() and any(dest.iterdir()):
        raise ValueError("Merge destination must be empty")
    model = AutoModelForCausalLM.from_pretrained(
        base,
        torch_dtype=torch.bfloat16,
        low_cpu_mem_usage=True,
        trust_remote_code=False,
        revision=revision if not Path(base).is_dir() else None,
    )
    model = PeftModel.from_pretrained(model, adapter).merge_and_unload(safe_merge=True)
    model.to(torch.float16).save_pretrained(dest, safe_serialization=True)
    AutoTokenizer.from_pretrained(
        base,
        trust_remote_code=False,
        revision=revision if not Path(base).is_dir() else None,
    ).save_pretrained(dest)
    save_json(
        dest / "provenance.json",
        {
            "base": base,
            "revision": revision,
            "adapter": str(adapter),
            "format": "FP16; same weights for CPU and GPU",
        },
    )
