"""Exercise evidence and recovery with a scripted teacher; no GPU is required."""

import json

import pytest

from yuki_model.chapter_teacher import run_teacher
from yuki_model.io import read_jsonl, save_jsonl


def passage(ident, split):
    return {
        "passage_id": ident, "chapter_id": f"chapter-{ident}", "book_id": "b01",
        "book": "fixture.epub", "volume": "1", "chapter": "测试章", "split": split,
        "paragraphs": [{"id": f"{ident}-p1", "text": "小华把写着姓名的纸条贴在了礼物上。"},
                       {"id": f"{ident}-p2", "text": "因此客人看到纸条才知道是谁送的。"}],
    }


def candidate(question="客人为什么知道礼物是小华送的？"):
    return {"category": "causality", "question": question, "answer": "客人看到了小华贴在礼物上的署名纸条。",
            "evidence": [{"paragraph_id": "P1", "quote": "写着姓名的纸条贴在了礼物上"},
                         {"paragraph_id": "P2", "quote": "看到纸条才知道是谁送的"}]}


def as_json(items):
    return json.dumps({"items": items}, ensure_ascii=False)


def scripted(*responses):
    stream = iter(responses)
    return lambda: lambda *_: next(stream)


def test_resume_filters_bad_evidence_and_deduplicates(tmp_path):
    input_file, output = tmp_path / "passages.jsonl", tmp_path / "teacher"
    save_jsonl(input_file, [passage("a", "train"), passage("b", "test")])
    bad = candidate("小华为什么把礼物放在院子里？")
    bad["evidence"][1]["quote"] = "院子里的树下有一件礼物"
    first = run_teacher(input_file, output,
                        scripted(as_json([bad, candidate()]), as_json([{"number": 1, "supported": True}])), limit=1)
    assert not first["complete"] and first["qa_count"] == 1
    a_job = (output / "jobs/a.json").read_bytes()
    second = run_teacher(input_file, output,
                         scripted(as_json([candidate()]), as_json([{"number": 1, "supported": True}])))
    assert second["complete"] and second["completed_passage_ids"] == ["a", "b"]
    assert second["qa_count"] == 1 and second["duplicates_removed"] == 1
    assert (output / "jobs/a.json").read_bytes() == a_job
    [row] = list(read_jsonl(output / "qa.jsonl"))
    assert row["evidence"][0]["paragraph_id"] == "a-p1" and row["split"] == "train"
    # A resumed, complete run does not need to load a model at all.
    assert run_teacher(input_file, output, lambda: pytest.fail("unexpected model load")) == second


def test_incomplete_review_is_retried_before_marking_complete(tmp_path):
    input_file, output = tmp_path / "passages.jsonl", tmp_path / "teacher"
    save_jsonl(input_file, [passage("a", "train"), passage("b", "val")])
    first = run_teacher(input_file, output, scripted(as_json([candidate()]), as_json([]), "broken JSON"), limit=1)
    assert first["passages_failed"] == 1 and not first["complete"]
    # Previously failed jobs must not starve untouched jobs on small chunks.
    second = run_teacher(input_file, output, scripted(as_json([])), limit=1)
    assert second["completed_passage_ids"] == ["b"] and second["passages_failed"] == 1
    last = run_teacher(input_file, output,
                       scripted(as_json([candidate()]), as_json([{"number": 1, "supported": False}])))
    assert last["complete"] and last["qa_count"] == 0 and last["passages_empty"] == 2
    with pytest.raises(ValueError, match="settings changed"):
        run_teacher(input_file, output, scripted(), questions=6)


def test_unsafe_or_duplicate_job_ids_are_rejected(tmp_path):
    input_file = tmp_path / "passages.jsonl"
    for rows, pattern in [([passage("../a", "train")], "Unsafe"),
                          ([passage("a", "train"), passage("a", "test")], "Duplicate")]:
        save_jsonl(input_file, rows)
        with pytest.raises(ValueError, match=pattern):
            run_teacher(input_file, tmp_path / "teacher", scripted())
