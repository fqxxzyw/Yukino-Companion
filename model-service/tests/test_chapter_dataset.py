"""Exercise coverage, provenance and replay isolation without model inference."""

import json

import pytest

from test_distillation_data import Tokenizer, build, dataset as v3_fixture
from yuki_model.chapter_dataset import build_chapter_dataset
from yuki_model.distillation import validate_manifest
from yuki_model.io import file_sha, read_jsonl, save_json, save_jsonl
from yuki_model.training import REVISION


@pytest.fixture
def chapter_inputs(v3_fixture, tmp_path):
    v3_meta = build(v3_fixture)
    corpus, teacher = tmp_path / "corpus", tmp_path / "teacher"
    books, chapters, passages, rows = [], [], [], []
    quotes = ["当天傍晚众人在教室里商量安排", "因为会场临时关闭所以调整地点"]
    subjects = (
        ("黑板上留下了什么线索，之后如何找到负责同学？", "哪两个人负责登记参加活动的同学？", "为什么值日安排临时改到第二天上午？"),
        ("文化祭当晚是谁先发现电源没有接好？", "负责清点经费的学生由谁协助？", "关门之前为何要通知其他小组转去室外？"),
        ("到车站后主角用什么办法找到了遗失的包？", "照顾受伤社员的是哪一位同班同学？", "因为什么原因小组最后取消了周末安排？"),
    )
    for i, split in enumerate(("train", "val", "test")):
        book = {"book_id": f"book{i}", "book": f"book{i}.epub", "volume": str(i + 1), "source_sha256": "a" * 64}
        chapter = {k: book[k] for k in ("book_id", "book", "volume")} | {
            "chapter_id": f"chapter{i}", "chapter": f"情节章节 {i}", "split": split,
            "paragraphs": [{"id": f"p{i}-{j}", "text": t} for j, t in enumerate(quotes)],
        }
        passage = chapter | {"passage_id": f"passage{i}"}
        books.append(book)
        chapters.append(chapter)
        passages.append(passage)
        for j, category in enumerate(("plot", "relationship", "causality")):
            source = {key: value for key, value in passage.items() if key != "paragraphs"}
            rows.append(source | {
                "id": f"{i}-{j}", "verified": True, "category": category,
                "question": subjects[i][j], "answer": f"测试情节的概述 {i}-{j}。",
                "evidence": [{"paragraph_id": f"p{i}-{k}", "quote": t}
                             for k, t in enumerate(quotes[:2 if category == "causality" else 1])],
            })
    # Preserve all three category rows, but discard a wording repeat across books.
    rows.append(rows[-3] | {"id": "2-9", "question": subjects[0][0].replace("之后", "后来")})
    save_jsonl(corpus / "chapters.jsonl", chapters)
    save_jsonl(corpus / "passages.jsonl", passages)
    save_json(corpus / "manifest.json", {
        "book_count": len(books), "chapter_count": len(chapters), "passage_count": len(passages),
        "books": books, "artifacts": {p.name: file_sha(p) for p in corpus.iterdir()},
    })
    save_jsonl(teacher / "qa.jsonl", rows)
    save_json(teacher / "manifest.json", {
        "complete": True, "passages_total": len(passages), "passages_completed": len(passages),
        "completed_passage_ids": [p["passage_id"] for p in passages], "qa_count": len(rows),
        "qa_sha256": file_sha(teacher / "qa.jsonl"), "passages_sha256": file_sha(corpus / "passages.jsonl"),
        "verification": "exact_quote_and_same_model_review", "teacher_model": "fixture",
        "teacher_revision": "fixture-revision",
    })
    return {
        "corpus": corpus, "teacher": teacher, "replay": v3_fixture["dest"], "pack": v3_fixture["pack"],
        "dest": tmp_path / "v4", "tokenizer": Tokenizer(), "min_books": 3,
        "min_source_rows": 9, "min_holdout_rows": 3,
    }, v3_meta


def config(inputs):
    dest = inputs["dest"]
    return {
        "task": "distill_sft", "revision": REVISION, "allow_synthetic_persona": True,
        "data_manifest": str(dest / "manifest.json"), "train_file": str(dest / "train.jsonl"),
        "eval_file": str(dest / "val.jsonl"), "sequence_length": 1536,
    }


def test_verified_chapters_book_holdouts_and_train_only_replay(chapter_inputs):
    args, v3 = chapter_inputs
    meta = build_chapter_dataset(**args)
    dest = args["dest"]
    assert meta["examples"] == {"train": v3["examples"]["train"] + 3, "val": 3, "test": 3}
    assert meta["coverage"]["chapters_with_qa"] == 3
    assert meta["coverage"]["dropped"] == {"near_duplicate": 1}
    assert 0 < meta["token_counts_per_epoch"]["train"]["supervised"] < meta["token_counts_per_epoch"]["train"]["input"]
    assert validate_manifest(config(args))["distill_manifest"] == meta
    train = list(read_jsonl(dest / "train.jsonl"))
    assert {row["family_id"] for row in train} == {"v3/" + f for f in v3["split_family_ids"]["train"]} | {"chapter/chapter0"}
    assert list(read_jsonl(dest / "regression.jsonl"))[0] in train
    refs = list(read_jsonl(dest / "test.jsonl"))
    prompts = list(read_jsonl(dest / "test-prompts.jsonl"))
    assert [p["messages"] for p in prompts] == [r["messages"][:-1] for r in refs]
    evidence = list(read_jsonl(dest / "chapter-evidence.jsonl"))
    assert all(p["paragraph_id"].startswith("p") for e in evidence for p in e["citations"])
    assert not any(
        p["quote"] in m["content"]
        for e in evidence for p in e["citations"] for r in refs for m in r["messages"]
    )
    with pytest.raises(ValueError, match="frozen dataset"):
        build_chapter_dataset(**args)


def test_missing_teacher_passage_cannot_publish(chapter_inputs):
    args, _ = chapter_inputs
    path = args["teacher"] / "manifest.json"
    manifest = json.loads(path.read_text(encoding="utf-8"))
    manifest["completed_passage_ids"][-1] = manifest["completed_passage_ids"][0]
    save_json(path, manifest)
    with pytest.raises(ValueError, match="generation is incomplete"):
        build_chapter_dataset(**args)
    assert not args["dest"].exists()


def test_wrong_quote_cannot_publish_even_with_updated_hash(chapter_inputs):
    args, _ = chapter_inputs
    directory = args["teacher"]
    rows = list(read_jsonl(directory / "qa.jsonl"))
    rows[0]["evidence"][0]["quote"] = "这句话看起来可信但原文不存在"
    save_jsonl(directory / "qa.jsonl", rows)
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    manifest["qa_sha256"] = file_sha(directory / "qa.jsonl")
    save_json(directory / "manifest.json", manifest)
    with pytest.raises(ValueError, match="Invalid source quote"):
        build_chapter_dataset(**args)
    assert not args["dest"].exists()


def test_coverage_gate_prevents_thin_dataset(chapter_inputs):
    args, _ = chapter_inputs
    args["min_source_rows"] = 10  # Ten raw rows, but one repeats a training question.
    with pytest.raises(ValueError, match="Insufficient verified coverage"):
        build_chapter_dataset(**args)
    assert not args["dest"].exists()
