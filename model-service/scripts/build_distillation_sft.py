"""Prepare explicit hard targets and persona replay, without launching training."""
import argparse
import json

from yuki_model.distillation import build_distillation


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--source", default="distill-data/seeds.jsonl")
    p.add_argument("--evidence", default="distill-data/evidence.jsonl")
    p.add_argument("--replay", default="persona-data/scenarios.jsonl")
    p.add_argument("--character-pack", default="../characters/yukino")
    p.add_argument("--epubs", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--tokenizer", required=True)
    p.add_argument("--sequence-length", type=int, default=1536)
    a = p.parse_args()
    from transformers import AutoTokenizer
    tokenizer = AutoTokenizer.from_pretrained(a.tokenizer, local_files_only=True, trust_remote_code=False)
    report = build_distillation(a.source, a.evidence, a.replay, a.character_pack, a.epubs, a.output,
                               tokenizer=tokenizer, sequence_length=a.sequence_length)
    print(json.dumps({k: report[k] for k in ("examples", "origin_counts", "max_tokens", "near_prompt_pairs_for_review", "limits")}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
