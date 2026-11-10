"""Repair failed v4 passage jobs in a new directory, retaining original QA."""

import argparse
import json
import time
from collections import Counter
from pathlib import Path

from yuki_model import chapter_teacher as teacher
from yuki_model.io import file_sha, read_jsonl, save_json, save_jsonl, sha

# This version used the same prompts and validators, but generated one job at a time.
SERIAL_RECOVERY_SHA256 = "1688d90cf5b73cbe8be9a782406ab67cce567620cd19c9fec4ccbf416cc950a5"


def _load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def _read_job(path, passage, settings_digest):
    job = _load(path)
    if (job.get("schema") != teacher.SCHEMA
            or job.get("passage_id") != passage["passage_id"]
            or job.get("passage_sha256") != teacher._fingerprint(passage)
            or job.get("settings_sha256") != settings_digest
            or job.get("status") not in {"complete", "failed"}
            or not isinstance(job.get("rows"), list)
            or job.get("rows_sha256") != teacher._fingerprint(job["rows"])
            or (job["status"] == "failed" and job["rows"])):
        raise ValueError(f"Invalid saved job: {path}")
    return job


def _merged_rows(jobs):
    seen = set()
    for job in jobs:
        for row in job["rows"]:
            key = teacher._key(row["question"])
            if key not in seen:
                yield row
                seen.add(key)


def _read_original(directory, passages_path, passages, *, allow_unfinalized):
    settings = _load(directory / "settings.json")
    manifest_path = directory / "manifest.json"
    manifest = _load(manifest_path) if manifest_path.is_file() else None
    if manifest is None and not allow_unfinalized:
        raise ValueError("Original manifest is missing. Use --allow-unfinalized after checking the first process stopped.")
    if (settings.get("schema") != teacher.SCHEMA
            or settings.get("passages_sha256") != file_sha(passages_path)
            or settings.get("teacher_model") != teacher.TEACHER_MODEL
            or settings.get("teacher_revision") != teacher.TEACHER_REVISION
            or settings.get("verification") != teacher.VERIFICATION
            or settings.get("implementation_sha256") != file_sha(Path(teacher.__file__))
            or (manifest is not None and any(manifest.get(k) != v for k, v in settings.items()))):
        raise ValueError("Original teacher settings or implementation do not match")
    job_paths = {p.stem: p for p in (directory / "jobs").glob("*.json")}
    if job_paths.keys() != passages.keys():
        missing = len(passages.keys() - job_paths.keys())
        extra = len(job_paths.keys() - passages.keys())
        raise ValueError(f"Original jobs do not cover exactly the source passages ({missing} missing, {extra} unexpected)")
    settings_digest = teacher._fingerprint(settings)
    original = {ident: _read_job(job_paths[ident], passage, settings_digest) for ident, passage in passages.items()}
    completed = [ident for ident, job in original.items() if job["status"] == "complete"]
    if manifest is not None and (manifest.get("passages_total") != len(passages)
            or manifest.get("passages_completed") != len(completed)
            or manifest.get("passages_failed") != len(passages) - len(completed)
            or manifest.get("completed_passage_ids") != completed
            or manifest.get("complete") != (len(completed) == len(passages))):
        raise ValueError("Original manifest does not match saved jobs. Run recovery only after the first pass ends.")
    qa_path = directory / "qa.jsonl"
    rows = list(_merged_rows(original.values()))
    qa_present = qa_path.is_file()
    if manifest is not None and (not qa_present or manifest.get("qa_sha256") != file_sha(qa_path)
                                 or manifest.get("qa_count") != len(rows)):
        raise ValueError("Published original manifest requires matching QA")
    if qa_present and rows != list(read_jsonl(qa_path)):
        raise ValueError("Original aggregate QA differs from the verified jobs")
    aggregate = {
        "manifest_present": manifest is not None,
        "qa_present": qa_present,
        "reconstructed_from_jobs": manifest is None,
        "manifest_sha256": file_sha(manifest_path) if manifest is not None else None,
        "qa_count": len(rows),
        "limitation": "Semantic checking uses a separate prompt to the same model; it is not human review.",
    }
    return settings, aggregate, original


def _recover_items(raw):
    """Allow surrounding prose or a truncated tail, keeping only complete JSON items."""
    if isinstance(raw, ValueError):
        raise raw
    try:
        return teacher._items(raw)
    except ValueError as error:
        # Search only for the precise schema anchor. Never infer a missing value,
        # close a truncated string, or manufacture evidence during parse recovery.
        import re

        anchors = list(re.finditer(r'\{\s*"items"\s*:\s*\[', raw))
        if len(anchors) != 1:
            raise error
        tail = raw[anchors[0].end():].lstrip()
        decoder = json.JSONDecoder()
        rows = []
        while tail and not tail.startswith("]") and len(rows) < 2:
            try:
                value, end = decoder.raw_decode(tail)
            except ValueError:
                break
            if not isinstance(value, dict):
                break
            rows.append(value)
            tail = tail[end:].lstrip()
            if not tail.startswith(","):
                break
            tail = tail[1:].lstrip()
        if not rows:
            raise error
        return rows


def _context(passage):
    return {
        "volume": passage["volume"], "chapter": passage["chapter"],
        "paragraphs": {f"P{i}": p["text"] for i, p in enumerate(passage["paragraphs"], 1)},
    }


def _generation_prompt(context, count, round_number):
    focus = ("情节或因果", "人物关系或时间顺序", "前半段的具体情节", "后半段的具体情节")
    request = (f"只写 {count} 道依据最明确的题，优先考虑{focus[(round_number - 1) % len(focus)]}，"
               "不足可少写。每个答案用一句话，证据从原文复制连续 8–30 字。"
               '输出 {"items":[...]}，不要 Markdown 或前后说明。\n')
    return request + teacher._canonical(context)


def _recover_batch(work, generate):
    pending = [(passage, round_number, _context(passage), []) for passage, round_number in work]
    for count, tokens in ((2, 850), (1, 520)):
        if not pending:
            break
        prompts = [_generation_prompt(context, count, number) for _, number, context, _ in pending]
        raw_outputs = generate(teacher.GEN_SYSTEM, prompts, tokens)
        retry, review_batch, review_prompts = [], [], []
        for item, raw in zip(pending, raw_outputs, strict=True):
            passage, number, context, errors = item
            try:
                parsed = _recover_items(raw)
                if not parsed:
                    yield passage, [], {"status": "no_suitable_question", "round": number}, "complete"
                    continue
                candidates = teacher._candidates(passage, parsed, count)
                if not candidates:
                    raise ValueError("All candidates failed structure or exact quote checks")
            except ValueError as error:
                errors.append(str(error))
                retry.append(item)
                continue
            review = [{**row, "evidence": refs, "number": i} for i, (row, refs) in enumerate(candidates, 1)]
            review_batch.append((item, candidates))
            review_prompts.append(teacher._canonical({**context, "candidates": review}))
        if review_batch:
            reviews = generate(teacher.REVIEW_SYSTEM, review_prompts, 256)
            for (item, candidates), raw in zip(review_batch, reviews, strict=True):
                passage, number, _, errors = item
                try:
                    decisions = teacher._decisions(_recover_items(raw), len(candidates))
                except ValueError as error:
                    errors.append(str(error))
                    retry.append(item)
                    continue
                fields = ("passage_id", "chapter_id", "book_id", "book", "volume", "chapter", "split")
                rows = [
                    {**{k: passage[k] for k in fields}, **row, "verified": True,
                     "id": sha(passage["passage_id"] + "|" + teacher._key(row["question"]))[:24]}
                    for i, (row, _) in enumerate(candidates, 1) if decisions[i]
                ]
                details = {"round": number, "valid": len(candidates),
                           "status": "verified" if rows else "all_rejected_by_review"}
                yield passage, rows, details, "complete"
        pending = retry
    for passage, number, _, errors in pending:
        yield passage, [], {"round": number, "error": "; ".join(errors)}, "failed"


def _oom_safe_batches(generate, oom_error, clear_cache):
    cap = 8

    def run(system, prompts, token_limit):
        nonlocal cap
        if len(prompts) > cap:
            outputs = []
            start = 0
            while start < len(prompts):
                chunk = prompts[start:start + cap]
                outputs.extend(run(system, chunk, token_limit))
                start += len(chunk)
            return outputs
        try:
            return generate(system, prompts, token_limit)
        except oom_error:
            if len(prompts) <= 1:
                raise
        # Retry after leaving the exception scope, so the failed call's
        # traceback can release its CUDA tensors.
        cap = len(prompts) // 2
        clear_cache()
        print(f"CUDA OOM with {len(prompts)} prompts; using batches of at most {cap}.", flush=True)
        return run(system, prompts, token_limit)

    return run


def _local_batch_generator(model_path):
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    if (not torch.cuda.is_available() or "A100" not in torch.cuda.get_device_name(0).upper()
            or not torch.cuda.is_bf16_supported()):
        raise RuntimeError("Teacher requires an actual CUDA A100 with BF16 support")
    if not Path(model_path).is_dir():
        raise FileNotFoundError(f"Teacher snapshot not found: {model_path}")
    tokenizer = AutoTokenizer.from_pretrained(model_path, local_files_only=True, trust_remote_code=False,
                                              padding_side="left")
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token
    model = AutoModelForCausalLM.from_pretrained(
        model_path, local_files_only=True, trust_remote_code=False, use_safetensors=True,
        torch_dtype=torch.bfloat16, device_map={"": 0}, attn_implementation="sdpa",
    ).eval()
    max_context = min(16384, model.config.max_position_embeddings)

    @torch.inference_mode()
    def generate(system, prompts, max_new_tokens):
        conversations = [
            [{"role": "system", "content": system}, {"role": "user", "content": user.replace("<|", "＜|")}]
            for user in prompts
        ]
        tokens = tokenizer.apply_chat_template(
            conversations, tokenize=True, add_generation_prompt=True, padding=True,
            return_dict=True, return_tensors="pt", tokenizer_kwargs={"return_attention_mask": True},
        )
        width = tokens["input_ids"].shape[1]
        if width + max_new_tokens > max_context:
            if len(prompts) > 1:
                return [generate(system, [prompt], max_new_tokens)[0] for prompt in prompts]
            return [ValueError(f"Passage context too long ({width} input tokens); split it further")]
        tokens = tokens.to("cuda:0")
        result = model.generate(**tokens, max_new_tokens=max_new_tokens, do_sample=False,
                                temperature=None, top_p=None, top_k=None, pad_token_id=tokenizer.pad_token_id)
        # Continuations begin after the padded input width for every row.
        return tokenizer.batch_decode(result[:, width:], skip_special_tokens=True)

    return _oom_safe_batches(generate, torch.cuda.OutOfMemoryError, torch.cuda.empty_cache)


def recover(passages_path, original_dir, output, generator_factory, *, limit=None, allow_unfinalized=False,
            batch_size=1):
    """Run recovery with a factory returning generate(system, list_of_prompts, token_limit)."""
    if limit is not None and limit < 1:
        raise ValueError("Use a positive limit")
    if not 1 <= batch_size <= 8:
        raise ValueError("Use a batch size from 1 to 8")
    original_dir, output = Path(original_dir).resolve(), Path(output).resolve()
    if original_dir == output or original_dir in output.parents or output in original_dir.parents:
        raise ValueError("Use a separate sibling directory for recovery")
    passages = {}
    for passage in read_jsonl(passages_path):
        teacher._passage_check(passage)
        ident = passage["passage_id"]
        if ident in passages:
            raise ValueError("Duplicate passage ID")
        passages[ident] = passage
    if not passages:
        raise ValueError("No source passages")
    old_settings, aggregate, original = _read_original(
        original_dir, passages_path, passages, allow_unfinalized=allow_unfinalized)
    failed = {ident: passages[ident] for ident, job in original.items() if job["status"] == "failed"}
    implementation_sha256 = file_sha(Path(__file__))
    known_implementations = {implementation_sha256, SERIAL_RECOVERY_SHA256}
    recovery = {
        "schema": 1, "implementation_sha256": implementation_sha256,
        "original_settings_sha256": teacher._fingerprint(old_settings),
        "original_jobs_sha256": teacher._fingerprint(original),
        "original_failed_passages": len(failed),
    }
    settings = {**old_settings, "recovery": recovery}
    settings_path = output / "settings.json"
    if settings_path.is_file():
        saved = _load(settings_path)
        saved_sha = saved.get("recovery", {}).get("implementation_sha256")
        compatible = {**old_settings, "recovery": {**recovery, "implementation_sha256": saved_sha}}
        if saved_sha not in known_implementations or saved != compatible:
            raise ValueError("Recovery source or settings changed. Use a new recovery directory.")
        settings = saved
    else:
        if output.exists() and any(output.iterdir()):
            raise ValueError("Refusing to initialize over a nonempty recovery directory")
        save_json(settings_path, settings)
    settings_digest = teacher._fingerprint(settings)
    jobs_dir = output / "jobs"
    jobs_dir.mkdir(exist_ok=True)
    recovered = {}
    for path in jobs_dir.glob("*.json"):
        if path.stem not in failed:
            raise ValueError(f"Unexpected recovery job: {path}")
        job = _read_job(path, failed[path.stem], settings_digest)
        if job.get("implementation_sha256", settings["recovery"]["implementation_sha256"]) not in known_implementations:
            raise ValueError(f"Unknown recovery job implementation: {path}")
        recovered[path.stem] = job

    def summarize():
        completed = {i: job for i, job in original.items() if job["status"] == "complete"}
        completed.update((i, recovered[i]) for i in passages if recovered.get(i, {}).get("status") == "complete")
        # Reserve original questions first so a repaired passage never displaces
        # an already accepted original row from the aggregate.
        rows = list(_merged_rows(completed.values()))
        order = {ident: i for i, ident in enumerate(passages)}
        rows.sort(key=lambda row: order[row["passage_id"]])
        qa_path = output / "qa.jsonl"
        save_jsonl(qa_path, rows)
        report = {
            **settings, "complete": len(completed) == len(passages), "passages_total": len(passages),
            "passages_completed": len(completed), "passages_failed": len(passages) - len(completed),
            "passages_empty": sum(not job["rows"] for job in completed.values()),
            "completed_passage_ids": [i for i in passages if i in completed],
            "qa_count": len(rows), "qa_sha256": file_sha(qa_path),
            "qa_categories": dict(Counter(row["category"] for row in rows)),
            "qa_splits": dict(Counter(row["split"] for row in rows)),
            "qa_chapters": len({row["chapter_id"] for row in rows}),
            "qa_books": len({row["book_id"] for row in rows}),
            "original_qa_count": aggregate["qa_count"],
            "recovered_qa_count": len(rows) - aggregate["qa_count"],
            "original_aggregate": aggregate,
            "recovery_implementations": sorted({
                job.get("implementation_sha256", settings["recovery"]["implementation_sha256"])
                for job in recovered.values()
            }),
            "limitation": aggregate["limitation"],
        }
        save_json(output / "manifest.json", report)
        return report

    started = time.monotonic()
    generate = None
    pending = sorted((ident for ident in failed if recovered.get(ident, {}).get("status") != "complete"),
                     key=lambda ident: ident in recovered)[:limit]
    try:
        if pending:
            generate = generator_factory()
        for start in range(0, len(pending), batch_size):
            work = [(failed[ident], recovered.get(ident, {}).get("details", {}).get("round", 0) + 1)
                    for ident in pending[start:start + batch_size]]
            for passage, rows, details, status in _recover_batch(work, generate):
                ident = passage["passage_id"]
                job = {"schema": teacher.SCHEMA, "passage_id": ident, "status": status,
                       "passage_sha256": teacher._fingerprint(passage), "settings_sha256": settings_digest,
                       "rows": rows, "rows_sha256": teacher._fingerprint(rows), "details": details,
                       "implementation_sha256": implementation_sha256, "requested_batch_size": batch_size}
                save_json(jobs_dir / f"{ident}.json", job)
                recovered[ident] = job
                done = sum(j["status"] == "complete" for j in recovered.values())
                print(f"[recovery {done}/{len(failed)}] {ident}: {status}, {len(rows)} QA; "
                      f"elapsed {(time.monotonic() - started) / 60:.1f} min", flush=True)
    finally:
        report = summarize()
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--passages", type=Path, required=True)
    parser.add_argument("--original", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--batch-size", type=int, default=2, help="prompts per GPU batch (1–8, default 2)")
    parser.add_argument("--allow-unfinalized", action="store_true",
                        help="Reconstruct a missing original aggregate after every source job was saved")
    args = parser.parse_args()
    report = recover(args.passages, args.original, args.output,
                     lambda: _local_batch_generator(args.model), limit=args.limit,
                     allow_unfinalized=args.allow_unfinalized, batch_size=args.batch_size)
    print(json.dumps({k: v for k, v in report.items() if k != "completed_passage_ids"}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
