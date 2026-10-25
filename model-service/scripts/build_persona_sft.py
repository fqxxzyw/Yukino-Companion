"""Build complete-persona, family-separated SFT; never launch training implicitly."""

import argparse
import json
from yuki_model.persona import build_persona

p = argparse.ArgumentParser()
p.add_argument("--source", default="persona-data/scenarios.jsonl")
p.add_argument("--character-pack", default="../characters/yukino")
p.add_argument("--output", default="data/persona")
p.add_argument("--tokenizer", default="models/base")
p.add_argument("--sequence-length", type=int, default=1024)
p.add_argument(
    "--prompt-mode", choices=["training", "compact", "detailed"], default="training"
)
p.add_argument(
    "--schema-only",
    action="store_true",
    help="Skip tokenizer check; output cannot be used for a validated training release",
)
a = p.parse_args()
tokenizer = None
if not a.schema_only:
    from transformers import AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained(
        a.tokenizer, local_files_only=True, trust_remote_code=False
    )
print(
    json.dumps(
        build_persona(
            a.source,
            a.character_pack,
            a.output,
            mode=a.prompt_mode,
            tokenizer=tokenizer,
            sequence_length=a.sequence_length,
        ),
        ensure_ascii=False,
        indent=2,
    )
)
