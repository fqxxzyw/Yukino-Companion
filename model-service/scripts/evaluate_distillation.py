"""Paired, resumable closed-book evaluation of two LoRA adapters.

References appear only in the review artifacts, never in model inputs. A flag is
a request to inspect an answer, not a factuality/personality score. Run with
--dry-run to validate files without loading weights or claiming generation.
"""

import argparse
import csv
import html
import io
import json
import os
import re
from pathlib import Path

from yuki_model.io import file_sha, read_jsonl, sha
from yuki_model.training import REVISION


def atomic_text(path, text):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="") as handle:
        handle.write(text)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def write_json(path, value):
    atomic_text(path, json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def write_jsonl(path, rows):
    atomic_text(path, "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows))


def row_key(row):
    values = [row.get("family_id"), row.get("variant_id")]
    if any(not isinstance(value, str) or not value.strip() for value in values):
        raise ValueError("Each row needs nonempty text family_id and variant_id")
    return json.dumps(values, ensure_ascii=False, separators=(",", ":"))


def validate_messages(messages, final_role):
    if not isinstance(messages, list) or not messages:
        raise ValueError("Empty or invalid messages")
    result = []
    for message in messages:
        if not isinstance(message, dict) or set(message) != {"role", "content"}:
            raise ValueError("Messages must contain only role and content")
        if not isinstance(message["content"], str) or not message["content"].strip():
            raise ValueError("Message content must be nonempty text")
        result.append(dict(message))
    first = 1 if result[0]["role"] == "system" else 0
    for i, message in enumerate(result[first:]):
        if message["role"] != ("user" if i % 2 == 0 else "assistant"):
            raise ValueError("Conversation must alternate user/assistant after optional system")
    if len(result) == first or result[-1]["role"] != final_role:
        raise ValueError(f"Messages must end in {final_role}; targets must not enter prompts")
    return result


def read_inputs(prompt_path, reference_path=None):
    prompts = {}
    for row in read_jsonl(prompt_path):
        key = row_key(row)
        if key in prompts:
            raise ValueError("Duplicate evaluation family/variant ID")
        row = dict(row)
        row["messages"] = validate_messages(row.get("messages"), "user")
        if any(field in row for field in ("response", "target", "reference", "answer")):
            raise ValueError("Prompt file contains a reference target; use --references separately")
        prompts[key] = row
    if not prompts:
        raise ValueError("Empty evaluation prompt file")
    references = {}
    if reference_path:
        for row in read_jsonl(reference_path):
            key = row_key(row)
            if key in references or key not in prompts:
                raise ValueError("Duplicate or unmatched reference ID")
            messages = validate_messages(row.get("messages"), "assistant")
            if messages[:-1] != prompts[key]["messages"]:
                raise ValueError("Reference prefix differs from evaluation prompt")
            references[key] = messages[-1]["content"]
        if set(references) != set(prompts):
            raise ValueError("Every prompt needs exactly one matching reference")
    return prompts, references


def adapter_identity(path, revision, *, dry_run=False):
    path = Path(path).resolve()
    names = ("adapter_config.json", "adapter_model.safetensors")
    if not all((path / name).is_file() for name in names):
        if dry_run:
            return {"path": str(path), "weights_available": False}
        raise ValueError(f"Adapter files missing: {path}")
    files = {name: file_sha(path / name) for name in names}
    result = {"path": str(path), "weights_available": True, "sha256": files}
    config = json.loads((path / "adapter_config.json").read_text(encoding="utf-8"))
    if config.get("revision") and config["revision"] != revision:
        raise ValueError("Adapter config and evaluation base revisions differ")
    report_path = path.parent / "training_report.json"
    if report_path.is_file():
        report = json.loads(report_path.read_text(encoding="utf-8"))
        if report.get("base_revision") != revision:
            raise ValueError("Adapter training report has a different base revision")
        if report.get("adapter_sha256") != files["adapter_model.safetensors"]:
            raise ValueError("Adapter weights differ from training report")
        result["training_report_sha256"] = file_sha(report_path)
    return result


def model_identity(source, revision, *, dry_run=False):
    path = Path(source)
    if not path.is_dir():
        return {"source": source, "revision": revision, "local": False}
    files = sorted(
        p for p in path.iterdir()
        if p.is_file() and (
            p.suffix in {".json", ".safetensors", ".model"}
            or p.name.startswith("pytorch_model") and p.suffix == ".bin"
            or p.name == "merges.txt"
        )
    )
    if not dry_run and not any(p.suffix in {".safetensors", ".bin"} for p in files):
        raise ValueError("Local base directory contains no model weights")
    proof_path = path / "BASE_PROVENANCE.json"
    if proof_path.is_file():
        proof = json.loads(proof_path.read_text(encoding="utf-8"))
        if proof.get("base_revision") != revision:
            raise ValueError("Local base provenance has a different revision")
    return {
        "source": str(path.resolve()), "revision": revision, "local": True,
        "sha256": {p.name: file_sha(p) for p in files},
    }


def review_flags(answer):
    """High-precision triage of the reported error; absence proves nothing."""
    flagged = False
    for clause in re.split(r"[。！？!?\n；;]", answer):
        if any(mark in clause for mark in ('“', '”', '「', '」', '"')):
            continue  # Quoting a bad claim is not asserting it.
        if re.search(r"不是|并非|不只是|不能说|不应|不该|不对|错误|荒谬|没有依据|怎.{0,2}可能", clause):
            continue
        if re.search(r"(?:阳乃|姐姐)(?:是|就是|成了|已经是|一直是).{0,5}唯一(?:的)?(?:亲人|家人)", clause):
            flagged = True
        if re.search(r"唯一(?:的)?(?:亲人|家人)(?:是|就是|只剩).{0,3}(?:阳乃|姐姐)", clause):
            flagged = True
    return {"possible_only_relative_assertion": flagged}


class PairedEngine:
    """One backbone, two named adapters, identical greedy generation settings."""

    def __init__(self, args):
        import torch
        from peft import PeftModel
        from transformers import AutoModelForCausalLM, AutoTokenizer
        from yuki_model.hardware import detect, device

        self.torch = torch
        self.info = detect()
        self.device = device(self.info, args.device)
        if self.device not in {"cpu", "cuda"}:
            raise ValueError("Paired evaluation supports CPU or CUDA; select explicitly")
        self.dtype = (
            torch.bfloat16 if self.device == "cuda" and torch.cuda.is_bf16_supported()
            else torch.float16 if self.device == "cuda" else torch.float32
        )
        kwargs = {"trust_remote_code": False, "local_files_only": True}
        if not Path(args.model).is_dir():
            kwargs["revision"] = args.revision
        self.tokenizer = AutoTokenizer.from_pretrained(args.model, **kwargs)
        base = AutoModelForCausalLM.from_pretrained(
            args.model, torch_dtype=self.dtype, low_cpu_mem_usage=True, **kwargs
        )
        self.model = PeftModel.from_pretrained(
            base, args.before_adapter, adapter_name="before", local_files_only=True,
            is_trainable=False,
        )
        self.model.load_adapter(
            args.after_adapter, adapter_name="after", local_files_only=True,
            is_trainable=False,
        )
        self.model.to(self.device).eval()
        self.max_tokens = args.max_tokens
        self.context_tokens = args.context_tokens

    def status(self):
        return {
            "device": self.device, "dtype": str(self.dtype), "hardware": self.info,
            "cpu_fallback_used": False, "shared_backbone": True,
        }

    def generate(self, side, messages):
        torch = self.torch
        self.model.set_adapter(side)
        self.model.eval()
        ids = self.tokenizer.apply_chat_template(
            messages, tokenize=True, add_generation_prompt=True, return_tensors="pt"
        ).to(self.device)
        if ids.shape[1] + self.max_tokens > self.context_tokens:
            raise ValueError("Evaluation prompt exceeds context budget; no silent truncation")
        with torch.inference_mode():
            output = self.model.generate(
                input_ids=ids, attention_mask=torch.ones_like(ids),
                max_new_tokens=self.max_tokens, do_sample=False, use_cache=True,
                pad_token_id=self.tokenizer.eos_token_id,
            )
        generated = output[0, ids.shape[1]:]
        return {
            "answer": self.tokenizer.decode(generated, skip_special_tokens=True),
            "generated_tokens": len(generated),
            "hit_token_limit": len(generated) >= self.max_tokens,
        }


def render_review(out, prompts, references, generations, config):
    by_id = {(row["id"], row["side"]): row for row in generations}
    parts = [
        '<!doctype html><html lang="zh-CN"><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
        '<title>雪乃微调前后回答对照</title><style>',
        'body{font:16px/1.65 system-ui;margin:24px;background:#f4f6fa;color:#172238}',
        'article{background:white;padding:20px;margin:20px 0;border-radius:12px}',
        '.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}',
        'pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}',
        'details{margin:10px 0} .note{color:#5c6573} @media(max-width:700px){.pair{display:block}}',
        '</style><body><h1>雪乃微调前后回答对照</h1>',
        '<p>同一底座、同一提示、贪心解码。参考答案仅供对照，没有送入模型。</p>',
        '<p class="note">自动标记仅供排查，未标记也可能有错误；没有自动人格或事实通过分数。',
        '请检查事实、语气和上下文，并填写 human-review.csv。</p>',
        '<p>题集类型：' + html.escape(config["evaluation_kind"]) + '</p>',
    ]
    if config["dry_run"]:
        parts.append('<p><strong>仅检查输入，未执行模型生成。</strong></p>')
    for key, prompt in prompts.items():
        label = prompt["family_id"] + " / " + prompt["variant_id"]
        parts.append('<article><h2>' + html.escape(label) + '</h2>')
        conversation = "\n\n".join(
            m["role"] + ": " + m["content"] for m in prompt["messages"] if m["role"] != "system"
        )
        parts.append('<pre>' + html.escape(conversation) + '</pre><div class="pair">')
        for side, title in (("before", "继续训练前"), ("after", "继续训练后")):
            row = by_id.get((key, side), {})
            parts.append('<section><h3>' + title + '</h3><pre>' + html.escape(row.get("answer", "待生成")) + '</pre>')
            if any(row.get("flags", {}).values()):
                parts.append('<p>需检查：可能断言姐姐是唯一亲人。</p>')
            if row.get("hit_token_limit"):
                parts.append('<p>达到输出长度限制，需检查是否截断。</p>')
            parts.append('</section>')
        parts.append('</div>')
        if key in references:
            parts.append('<details><summary>人工编写的参考答案</summary><pre>' + html.escape(references[key]) + '</pre></details>')
        parts.append('<p class="note">证据编号：' + html.escape(", ".join(prompt.get("evidence_ids", []))) + '</p></article>')
    parts.append('</body></html>')
    atomic_text(out / "comparison.html", "\n".join(parts))
    review_path = out / "human-review.csv"
    # A resumed evaluation must not erase ratings that the user has filled in.
    if not review_path.exists():
        content = io.StringIO(newline="")
        fields = [
            "family_id", "variant_id", "before_factual_error", "after_factual_error",
            "before_voice_0_4", "after_voice_0_4", "before_context_error",
            "after_context_error", "preferred", "critical_failure", "reviewer", "notes",
        ]
        writer = csv.DictWriter(content, fieldnames=fields)
        writer.writeheader()
        for prompt in prompts.values():
            writer.writerow({name: prompt[name] for name in ("family_id", "variant_id")})
        atomic_text(review_path, "\ufeff" + content.getvalue())


def evaluate(args, engine_factory=PairedEngine):
    prompts, references = read_inputs(args.prompts, args.references)
    if not 1 <= args.max_tokens <= 512 or args.context_tokens <= args.max_tokens:
        raise ValueError("Invalid max_tokens/context_tokens")
    config = {
        "schema_version": 1, "evaluation_kind": args.evaluation_kind,
        "prompts_sha256": file_sha(args.prompts),
        "references_sha256": file_sha(args.references) if args.references else None,
        "model": model_identity(args.model, args.revision, dry_run=args.dry_run),
        "before_adapter": adapter_identity(args.before_adapter, args.revision, dry_run=args.dry_run),
        "after_adapter": adapter_identity(args.after_adapter, args.revision, dry_run=args.dry_run),
        "generation": {"do_sample": False, "max_new_tokens": args.max_tokens,
                       "context_tokens": args.context_tokens, "device": args.device},
        "dry_run": args.dry_run,
    }
    out = Path(args.output)
    config_path = out / "evaluation_config.json"
    if config_path.is_file():
        if json.loads(config_path.read_text(encoding="utf-8")) != config:
            raise ValueError("Evaluation inputs/settings changed; use a new output directory")
    else:
        if out.exists() and any(out.iterdir()):
            raise ValueError("Nonempty evaluation output lacks its original configuration")
        write_json(config_path, config)

    result_path = out / "generations.jsonl"
    generations = list(read_jsonl(result_path)) if result_path.is_file() else []
    existing = set()
    for row in generations:
        key = (row.get("id"), row.get("side"))
        if key in existing or key[0] not in prompts or key[1] not in {"before", "after"}:
            raise ValueError("Invalid or duplicate saved generation ID")
        if row.get("prompt_sha256") != sha(json.dumps(prompts[key[0]]["messages"], ensure_ascii=False, sort_keys=True)):
            raise ValueError("Saved generation does not match its prompt")
        if row.get("generation_executed") != (not args.dry_run) or not isinstance(row.get("answer"), str):
            raise ValueError("Saved generation has inconsistent execution metadata")
        existing.add(key)
    engine = None
    for key, prompt in prompts.items():
        for side in ("before", "after"):
            if (key, side) in existing:
                continue
            if args.dry_run:
                result = {"answer": "", "generated_tokens": 0, "hit_token_limit": False}
                runtime = {"loaded": False}
            else:
                if engine is None:
                    engine = engine_factory(args)
                # Only canonical prompt messages enter generate(), never references.
                result = engine.generate(side, [dict(m) for m in prompt["messages"]])
                runtime = engine.status()
            if not isinstance(result.get("answer"), str):
                raise ValueError("Generator returned no textual answer")
            row = {
                "id": key, "family_id": prompt["family_id"], "variant_id": prompt["variant_id"],
                "side": side, "category": prompt.get("category"), **result,
                "prompt_sha256": sha(json.dumps(prompt["messages"], ensure_ascii=False, sort_keys=True)),
                "generation_executed": not args.dry_run,
                "flags": review_flags(result["answer"]), "runtime": runtime,
            }
            generations.append(row)
            # Each successful answer becomes an atomic durable snapshot. A lost
            # process reruns only the unfinished side/question, not the full set.
            write_jsonl(result_path, generations)
            existing.add((key, side))
            print(prompt["family_id"], prompt["variant_id"], side,
                  "generated" if not args.dry_run else "input checked", flush=True)
    render_review(out, prompts, references, generations, config)
    report = {
        "completed": True, "generation_completed": not args.dry_run,
        "dry_run": args.dry_run, "evaluation_kind": args.evaluation_kind,
        "question_count": len(prompts), "paired_answer_count": len(generations),
        "configuration_sha256": file_sha(config_path),
        "generation_file_sha256": file_sha(result_path),
        "flagged_for_review": {
            side: sum(any(r["flags"].values()) for r in generations if r["side"] == side)
            for side in ("before", "after")
        },
        "references_sent_to_model": False, "personality_accepted": False,
        "human_review_required": True,
        "limits": "No automatic factuality or personality score. Known-error regression is training retention, not unseen knowledge. A held-out scenario may still concern a fact seen in training. Read the paired answers and evidence before judging improvement.",
    }
    write_json(out / "report.json", report)
    return report


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--prompts", required=True)
    p.add_argument("--references", help="Matching full SFT rows; displayed only for human review")
    p.add_argument("--model", default="models/base", help="Local weights or an already cached pinned model")
    p.add_argument("--revision", default=REVISION)
    p.add_argument("--before-adapter", required=True)
    p.add_argument("--after-adapter", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--device", choices=("cuda", "cpu", "auto"), default="cuda")
    p.add_argument("--max-tokens", type=int, default=192)
    p.add_argument("--context-tokens", type=int, default=4096)
    p.add_argument("--evaluation-kind", choices=("held-out", "regression"), default="held-out")
    p.add_argument("--dry-run", action="store_true")
    return p


if __name__ == "__main__":
    print(json.dumps(evaluate(parser().parse_args()), ensure_ascii=False, indent=2))
