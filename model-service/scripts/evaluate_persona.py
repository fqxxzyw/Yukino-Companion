"""Generate held-out contextual replies and an unscored human review sheet.

No RAG or direct-source answer path is used here. Heuristic flags are triage,
not an automatic character-fidelity score or a release approval.
"""

import argparse
import csv
import threading
from pathlib import Path

from yuki_model.backends import TransformersBackend
from yuki_model.io import file_sha, read_jsonl, save_json, save_jsonl
from yuki_model.persona import audit_response, load_character
from yuki_model.training import REVISION

p = argparse.ArgumentParser()
p.add_argument("--prompts", default="data/persona/test-prompts.jsonl")
p.add_argument("--character-pack", default="../characters/yukino")
p.add_argument("--prompt-mode", choices=["compact", "training"], default="compact")
p.add_argument("--model", default="models/base")
p.add_argument(
    "--adapter",
    help="Omit for a base-model baseline; pass the trained persona adapter for comparison",
)
p.add_argument("--output", required=True)
p.add_argument("--device", choices=["auto", "cpu", "cuda", "mps"], default="auto")
p.add_argument("--max-tokens", type=int, default=192)
p.add_argument(
    "--max-families",
    type=int,
    help="Development smoke only; final review should include the whole held-out set",
)
p.add_argument(
    "--dry-run",
    action="store_true",
    help="Validate prompt contracts without generating answers",
)
a = p.parse_args()
if not 1 <= a.max_tokens <= 512:
    p.error("max-tokens must be 1..512")
if a.max_families is not None and a.max_families < 1:
    p.error("max-families must be positive")
rows = list(read_jsonl(a.prompts))
if any(row["messages"][-1]["role"] != "user" for row in rows):
    raise ValueError("Evaluation prompts must not contain a final target answer")
families = sorted({row["family_id"] for row in rows})
if a.max_families:
    families = families[: a.max_families]
rows = [row for row in rows if row["family_id"] in families]
if not rows:
    raise ValueError("No evaluation prompts")
out = Path(a.output)
if out.exists() and any(out.iterdir()):
    raise ValueError("Evaluation output must be empty; do not overwrite another run")
out.mkdir(parents=True, exist_ok=True)
engine = (
    None
    if a.dry_run
    else TransformersBackend(
        {
            "model": a.model,
            "adapter": a.adapter,
            "device": a.device,
            "local_files_only": True,
            "cpu_fallback": True,
            "context_tokens": 8192,
            "threads": 4,
        }
    )
)
answers = []
for row in rows:
    system, provenance = load_character(a.character_pack, a.prompt_mode)
    messages = [{"role": "system", "content": system}] + row["messages"][1:]
    answer = (
        ""
        if a.dry_run
        else "".join(engine.stream(messages, a.max_tokens, 0, threading.Event()))
    )
    answers.append(
        {
            "family_id": row["family_id"],
            "category": row["category"],
            "variant_id": row["variant_id"],
            "messages": messages,
            "answer": answer,
            "flags": audit_response(answer),
            "character": provenance,
            "generation_executed": not a.dry_run,
            "answer_mode": "model" if not a.dry_run else "dry_run",
        }
    )
    print(
        row["family_id"],
        row["variant_id"],
        "generated" if not a.dry_run else "prompt checked",
        flush=True,
    )
save_jsonl(out / "generations.jsonl", answers)
fields = [
    "family_id",
    "variant_id",
    "character_coherence_0_4",
    "independent_judgment_0_4",
    "restrained_warmth_0_4",
    "voice_naturalness_0_4",
    "user_identity_boundary_0_4",
    "factual_honesty_0_4",
    "context_coherence_0_4",
    "non_coercion_0_4",
    "critical_failure",
    "reviewer",
    "notes",
]
with (out / "human-review.csv").open("w", newline="", encoding="utf-8-sig") as f:
    writer = csv.DictWriter(f, fieldnames=fields)
    writer.writeheader()
    for row in answers:
        writer.writerow(
            {"family_id": row["family_id"], "variant_id": row["variant_id"]}
        )
save_json(
    out / "report.json",
    {
        "generation_completed": not a.dry_run,
        "dry_run": a.dry_run,
        "personality_accepted": False,
        "model": a.model,
        "base_revision": REVISION,
        "adapter": a.adapter,
        "adapter_sha256": file_sha(Path(a.adapter) / "adapter_model.safetensors")
        if a.adapter and not a.dry_run
        else None,
        "prompt_file_sha256": file_sha(a.prompts),
        "families": len(families),
        "responses": len(answers),
        "flagged_response_count": sum(any(row["flags"].values()) for row in answers),
        "backend": engine.status() if engine else None,
        "review_required": "Read EVALUATION.md and manually score paired base/adapter outputs. Regex flags and loss cannot approve a personality model. Empty/low flag counts are not proof of safety or fidelity.",
    },
)
