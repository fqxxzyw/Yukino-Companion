"""Run scripted conversations with separate generated histories for two adapters.

Only the shared character prompt and scripted user turns enter generation.
Expectations and evidence IDs remain in review artifacts. This is an actual
generation runner, not a model-judged score or a replay of reference answers.
"""

import argparse
import html
import json
from pathlib import Path

from evaluate_distillation import (
    PairedEngine, adapter_identity, atomic_text, model_identity, write_json, write_jsonl,
)
from yuki_model.io import file_sha, read_jsonl, sha
from yuki_model.persona import load_character
from yuki_model.training import REVISION


def text_digest(value):
    return sha(json.dumps(value, ensure_ascii=False, sort_keys=True))


def load_cases(path):
    document = json.loads(Path(path).read_text(encoding="utf-8"))
    cases = document.get("cases")
    if not isinstance(cases, list) or not cases:
        raise ValueError("Cases file needs a nonempty cases list")
    seen = set()
    for case in cases:
        if not isinstance(case, dict):
            raise ValueError("Each case must be an object")
        if any(not isinstance(case.get(k), str) or not case[k].strip() for k in ("id", "title")):
            raise ValueError("Every case needs a text id and title")
        if case["id"] in seen:
            raise ValueError("Duplicate case ID")
        seen.add(case["id"])
        if not isinstance(case.get("turns"), list) or not case["turns"]:
            raise ValueError("Every case needs at least one user turn")
        for turn in case["turns"]:
            if not isinstance(turn, dict) or not isinstance(turn.get("user"), str) or not turn["user"].strip():
                raise ValueError("Each scripted user turn must be nonempty text")
            expectation = turn.get("expect")
            if not (isinstance(expectation, str) and expectation.strip()) and not (
                isinstance(expectation, list) and expectation
                and all(isinstance(t, str) and t.strip() for t in expectation)
            ):
                raise ValueError("Each turn needs review expectations outside model input")
            if not isinstance(turn.get("evidence_ids"), list) or any(
                not isinstance(ref, str) or not ref.strip() for ref in turn["evidence_ids"]
            ):
                raise ValueError("evidence_ids must be a list of source identifiers")
    return cases


def record_id(case_id, turn_index, side):
    return json.dumps([case_id, turn_index, side], ensure_ascii=False, separators=(",", ":"))


def render(out, cases, records, config):
    lookup = {row["id"]: row for row in records}
    case_reports = []
    paired = 0
    for case in cases:
        turns = []
        for index, turn in enumerate(case["turns"]):
            answers = {side: lookup.get(record_id(case["id"], index, side)) for side in ("before", "after")}
            paired += all(answers.values())
            turns.append({"turn": index + 1, **turn, **answers})
        case_reports.append({"id": case["id"], "title": case["title"], "turns": turns})
    requested = sum(len(case["turns"]) for case in cases)
    report = {
        "schema_version": 1, "completed": paired == requested,
        "generation_completed": paired == requested, "requested_cases": len(cases),
        "requested_turn_pairs": requested, "completed_turn_pairs": paired,
        "generated_responses": len(records), "configuration_sha256": file_sha(out / "evaluation_config.json"),
        "generation_sha256": file_sha(out / "generations.jsonl") if records else None,
        "references_sent_to_model": False, "history_mode": "separate_generated_history_per_model_per_case",
        "automatic_quality_score": None, "human_review_required": True,
        "limits": "Scripted user turns are identical; later full prompts differ because each model retains its own generated answers. Facts may overlap training. No RAG, no reference answers, no silent history truncation. Read evidence and actual replies before judging improvement.",
        "cases": case_reports,
    }
    write_json(out / "report.json", report)
    parts = [
        '<!doctype html><html lang="zh-CN"><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
        '<title>雪乃多轮对话对照</title><style>',
        'body{font:16px/1.65 system-ui;margin:24px;background:#f4f6fa;color:#172238}',
        'article{background:white;border-radius:12px;padding:20px;margin:20px 0}',
        '.pair{display:grid;grid-template-columns:1fr 1fr;gap:24px}',
        'pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}summary{cursor:pointer}',
        '@media(max-width:700px){.pair{display:block}}</style><body>',
        '<h1>雪乃多轮对话对照</h1>',
        '<p>两个模型收到相同的用户提问，各自接续自己的真实回答。每个场景重新开始。</p>',
        '<p>检查标准与证据编号没有送入模型。这里没有自动质量分数。</p>',
        f'<p>已完成 {paired}/{requested} 组双模型轮次。</p>',
    ]
    for case in case_reports:
        parts.append('<article><h2>' + html.escape(case["title"]) + '</h2>')
        for turn in case["turns"]:
            parts.append('<h3>第 ' + str(turn["turn"]) + ' 轮</h3><pre>' + html.escape(turn["user"]) + '</pre><div class="pair">')
            for side, label in (("before", "续训前"), ("after", "续训后")):
                row = turn[side]
                answer = row["answer"] if row else "待生成"
                parts.append('<section><strong>' + label + '</strong><pre>' + html.escape(answer or "（空回答）") + '</pre>')
                if row and row.get("hit_token_limit"):
                    parts.append('<p>达到输出长度限制，请检查回答是否截断。</p>')
                parts.append('</section>')
            expected = turn["expect"] if isinstance(turn["expect"], str) else "\n".join(turn["expect"])
            parts.append('</div><details><summary>查看检查标准与证据</summary><pre>' + html.escape(expected) + '</pre><p>' + html.escape(", ".join(turn["evidence_ids"])) + '</p></details>')
        parts.append('</article>')
    parts.append('</body></html>')
    atomic_text(out / "comparison.html", "\n".join(parts))
    return report


def evaluate(args, engine_factory=PairedEngine):
    if not 1 <= args.max_tokens <= 512 or args.context_tokens <= args.max_tokens:
        raise ValueError("Invalid generation/context token limit")
    cases = load_cases(args.cases)
    system, character = load_character(args.character_pack, "training")
    config = {
        "schema_version": 1, "cases_sha256": file_sha(args.cases), "character": character,
        "model": model_identity(args.model, args.revision),
        "before_adapter": adapter_identity(args.before_adapter, args.revision),
        "after_adapter": adapter_identity(args.after_adapter, args.revision),
        "generation": {"device": args.device, "do_sample": False,
                       "max_new_tokens": args.max_tokens, "context_tokens": args.context_tokens},
        "history_mode": "separate_generated_history_per_model_per_case",
    }
    out = Path(args.output)
    config_file = out / "evaluation_config.json"
    if config_file.is_file():
        if json.loads(config_file.read_text(encoding="utf-8")) != config:
            raise ValueError("Evaluation inputs or model identities changed; use a new output")
    else:
        if out.exists() and any(out.iterdir()):
            raise ValueError("Nonempty output lacks its original evaluation config")
        write_json(config_file, config)
        write_json(out / "cases.json", {"cases": cases})
    generations_file = out / "generations.jsonl"
    records = list(read_jsonl(generations_file)) if generations_file.is_file() else []
    saved = {}
    allowed = {record_id(case["id"], index, side): (case["id"], index, side) for case in cases
               for index in range(len(case["turns"])) for side in ("before", "after")}
    for row in records:
        key = row.get("id")
        if key not in allowed or key in saved or not isinstance(row.get("answer"), str) or row.get("generation_executed") is not True:
            raise ValueError("Invalid or duplicate saved generation")
        if (row.get("case_id"), row.get("turn_index"), row.get("side")) != allowed[key]:
            raise ValueError("Saved generation metadata disagrees with its ID")
        saved[key] = row
    # A resumed history must have a complete prefix on each side.
    for case in cases:
        for side in ("before", "after"):
            gap = False
            verified_history = [{"role": "system", "content": system}]
            for index, turn in enumerate(case["turns"]):
                key = record_id(case["id"], index, side)
                if key not in saved:
                    gap = True
                elif gap:
                    raise ValueError("Saved conversation has a missing earlier turn")
                else:
                    row = saved[key]
                    messages = [*verified_history, {"role": "user", "content": turn["user"]}]
                    if row.get("input_sha256") != text_digest(messages) or row.get("input_messages") != messages:
                        raise ValueError("Saved generation history does not match earlier answers")
                    verified_history = [*messages, {"role": "assistant", "content": row["answer"]}]
    render(out, cases, records, config)
    engine = None
    for case in cases:
        history = {side: [{"role": "system", "content": system}] for side in ("before", "after")}
        for index, turn in enumerate(case["turns"]):
            for side in ("before", "after"):
                key = record_id(case["id"], index, side)
                messages = [*history[side], {"role": "user", "content": turn["user"]}]
                if key in saved:
                    row = saved[key]
                    if row.get("input_sha256") != text_digest(messages) or row.get("input_messages") != messages:
                        raise ValueError("Saved generation history does not match earlier answers")
                else:
                    if engine is None:
                        engine = engine_factory(args)
                    # No expectation, evidence identifier, or other model answer is passed.
                    result = engine.generate(side, [dict(m) for m in messages])
                    if not isinstance(result.get("answer"), str):
                        raise ValueError("Generator returned no text")
                    row = {
                        "id": key, "case_id": case["id"], "turn_index": index,
                        "side": side, **result, "input_messages": messages,
                        "input_sha256": text_digest(messages), "generation_executed": True,
                        "runtime": engine.status(),
                    }
                    records.append(row)
                    saved[key] = row
                    write_jsonl(generations_file, records)
                    render(out, cases, records, config)
                    print(f"{case['id']} turn {index + 1} {side}: {row['answer']}", flush=True)
                history[side] = [*messages, {"role": "assistant", "content": row["answer"]}]
    return render(out, cases, records, config)


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--cases", required=True)
    p.add_argument("--character-pack", required=True)
    p.add_argument("--model", default="models/base")
    p.add_argument("--revision", default=REVISION)
    p.add_argument("--before-adapter", required=True)
    p.add_argument("--after-adapter", required=True)
    p.add_argument("--device", choices=("cuda", "cpu", "auto"), default="cuda")
    p.add_argument("--output", required=True)
    p.add_argument("--max-tokens", type=int, default=192)
    p.add_argument("--context-tokens", type=int, default=4096)
    return p


if __name__ == "__main__":
    result = evaluate(parser().parse_args())
    print(json.dumps({key: value for key, value in result.items() if key != "cases"}, ensure_ascii=False, indent=2))
