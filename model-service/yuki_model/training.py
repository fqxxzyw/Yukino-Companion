"""LoRA CPT and assistant-only supervised training; same adapter on CPU or GPU."""

import json
import math
import random
from pathlib import Path
from .io import read_jsonl, save_json, file_sha, sha
from .hardware import detect, device

BASE = "Qwen/Qwen2.5-1.5B-Instruct"
REVISION = "989aa7980e4cf806f80c7fef2b1adb7bc71aa306"


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
    if initial and c.get("resume"):
        raise ValueError(
            "initial_adapter starts a new run; resume restores an existing run, not both"
        )
    meta = {"adapter_mode": mode}
    if initial:
        path = Path(initial)
        if not (path / "adapter_model.safetensors").is_file():
            raise ValueError("initial_adapter must contain safetensors LoRA weights")
        report_path = path.parent / "training_report.json"
        if report_path.is_file():
            report = json.loads(report_path.read_text())
            if report.get("base_revision") != c.get("revision", REVISION):
                raise ValueError("Initial adapter and requested base revisions differ")
        elif not c.get("allow_unverified_initial_adapter", False):
            raise ValueError(
                "Initial adapter lacks base provenance; do not silently combine unknown weights"
            )
        meta["initial_adapter_sha256"] = file_sha(path / "adapter_model.safetensors")
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


def train(c):
    import torch
    from transformers import (
        AutoTokenizer,
        AutoModelForCausalLM,
        TrainingArguments,
        Trainer,
        set_seed,
    )
    from peft import (
        LoraConfig,
        PeftModel,
        get_peft_model,
        prepare_model_for_kbit_training,
    )

    specification = validate_training_spec(c)
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
    out = Path(c["output_dir"])
    if out.exists() and any(out.iterdir()) and not c.get("resume"):
        raise ValueError("Output exists; choose a new directory or resume")
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
    if c.get("adapter_mode", "fresh") == "continue":
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
        save_total_limit=2,
        logging_steps=5,
        report_to="none",
        seed=c.get("seed", 42),
        data_seed=c.get("seed", 42),
        dataloader_num_workers=0,
        dataloader_pin_memory=selected == "cuda",
        remove_unused_columns=False,
        prediction_loss_only=True,
    )
    trainer = Trainer(
        model=model,
        args=args,
        train_dataset=training,
        eval_dataset=validation,
        data_collator=Collator(tokenizer.pad_token_id),
        processing_class=tokenizer,
    )
    provenance = {
        "train_sha256": file_sha(c["train_file"]),
        "eval_sha256": file_sha(c["eval_file"]),
        "train_examples": len(training),
        "eval_examples": len(validation),
        "train_tokens": sum(sum(v != -100 for v in r["labels"]) for r in training),
    }
    provenance.update(specification)
    save_json(out / "run_config.json", c)
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

    before = trainer.evaluate()
    probes_before = probe()
    save_json(out / "probes_before.json", probes_before)
    try:
        result = trainer.train(resume_from_checkpoint=c.get("resume"))
    except torch.OutOfMemoryError as e:
        raise RuntimeError(
            "Training OOM. Reduce sequence/batch size or use QLoRA. No silent CPU restart."
        ) from e
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
        "before": before,
        "after": after,
        "training_metrics": result.metrics,
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
