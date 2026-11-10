"""Assemble book-held-out, source-verified chapter QA and train-only v3 replay."""

import argparse
import json
import tempfile
from collections import Counter, defaultdict
from difflib import SequenceMatcher
from pathlib import Path

from .distillation import SPLITS, validate_manifest
from .io import file_sha, read_jsonl, save_json, save_jsonl
from .persona import load_character, normalize_prompt
from .training import BASE, REVISION, encode_row

REQUIRED_CATEGORIES = {"plot", "relationship", "causality"}
CATEGORIES = REQUIRED_CATEGORIES | {"timeline"}
SOURCE_KEYS = ("chapter_id", "book_id", "book", "volume", "chapter", "split")


def _load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def _unique_rows(path, key):
    result = {}
    for row in read_jsonl(path):
        value = row.get(key)
        if not isinstance(value, str) or not value or value in result:
            raise ValueError(f"Empty or duplicate {key} in {path.name}")
        result[value] = row
    if not result:
        raise ValueError(f"Empty inventory: {path.name}")
    return result


def _load_corpus(directory):
    meta = _load(directory / "manifest.json")
    for filename in ("chapters.jsonl", "passages.jsonl"):
        if file_sha(directory / filename) != meta["artifacts"].get(filename):
            raise ValueError(f"Corpus artifact hash mismatch: {filename}")
    chapters = _unique_rows(directory / "chapters.jsonl", "chapter_id")
    passages = _unique_rows(directory / "passages.jsonl", "passage_id")
    if len(chapters) != meta["chapter_count"] or len(passages) != meta["passage_count"]:
        raise ValueError("Corpus counts differ from manifest")
    books = {b["book_id"]: b for b in meta["books"]}
    if len(books) != len(meta["books"]) or len(books) != meta["book_count"]:
        raise ValueError("Corpus book counts differ from manifest")
    book_splits = {}
    for chapter in chapters.values():
        book_id, split = chapter["book_id"], chapter["split"]
        if book_id not in books or split not in SPLITS or book_splits.setdefault(book_id, split) != split:
            raise ValueError("Book leakage or unknown book/split")
        book = books[book_id]
        if any(chapter[k] != book[k] for k in ("book", "volume")):
            raise ValueError("Chapter book does not match corpus manifest")
    if book_splits.keys() != books.keys():
        raise ValueError("A book has no chapters")
    chapter_paragraphs = {}
    represented = defaultdict(set)
    for key, chapter in chapters.items():
        paragraphs = {p["id"]: p["text"] for p in chapter["paragraphs"]}
        if not paragraphs or len(paragraphs) != len(chapter["paragraphs"]):
            raise ValueError("Empty chapter or duplicate paragraph ID")
        chapter_paragraphs[key] = paragraphs
    for passage in passages.values():
        key = passage["chapter_id"]
        chapter = chapters.get(key)
        if not chapter or any(chapter[k] != passage[k] for k in SOURCE_KEYS):
            raise ValueError("Passage does not match its chapter")
        if not passage["paragraphs"] or any(
            chapter_paragraphs[key].get(p["id"]) != p["text"] for p in passage["paragraphs"]
        ):
            raise ValueError("Passage text differs from its chapter")
        represented[key].update(p["id"] for p in passage["paragraphs"])
    if any(represented[key] != paras.keys() for key, paras in chapter_paragraphs.items()):
        raise ValueError("A chapter is missing paragraphs from its passages")
    return meta, books, chapters, passages


def _load_teacher(directory, corpus_dir, passages, *, allow_partial_teacher=False):
    manifest = _load(directory / "manifest.json")
    done = manifest.get("completed_passage_ids")
    complete = manifest.get("complete")
    if complete is not True and not allow_partial_teacher:
        raise ValueError("Teacher generation is incomplete; finish or resume all passages")
    if not isinstance(done, list) or any(not isinstance(key, str) for key in done):
        raise ValueError("Invalid list of completed teacher passages")
    completed = set(done)
    omitted = len(passages) - len(completed)
    if (not completed or len(completed) != len(done) or not completed <= passages.keys()
            or manifest.get("passages_total") != len(passages)
            or manifest.get("passages_completed") != len(completed)
            or complete is not (omitted == 0)
            or (omitted and manifest.get("passages_failed") != omitted)):
        raise ValueError("Teacher generation is incomplete or inconsistent; check passage counts and completed IDs")
    if manifest.get("verification") != "exact_quote_and_same_model_review":
        raise ValueError("Teacher must verify evidence and answer support")
    if (manifest.get("passages_sha256") != file_sha(corpus_dir / "passages.jsonl")
            or manifest.get("qa_sha256") != file_sha(directory / "qa.jsonl")):
        raise ValueError("Teacher input/output hash mismatch")
    rows = _unique_rows(directory / "qa.jsonl", "id")
    if len(rows) != manifest.get("qa_count"):
        raise ValueError("Teacher QA count differs from manifest")
    for row in rows.values():
        passage = passages.get(row.get("passage_id"))
        if (not passage or row.get("passage_id") not in completed or row.get("verified") is not True
                or row.get("category") not in CATEGORIES
                or any(row.get(key) != passage[key] for key in SOURCE_KEYS)):
            raise ValueError(f"Unverified QA or invalid provenance: {row['id']}")
        for field in ("question", "answer"):
            value = row.get(field)
            if not isinstance(value, str) or not normalize_prompt(value) or "<|" in value:
                raise ValueError(f"Invalid {field}: {row['id']}")
        paras = {p["id"]: p["text"] for p in passage["paragraphs"]}
        citations = row.get("evidence")
        minimum = 2 if row["category"] == "causality" else 1
        if not isinstance(citations, list) or not minimum <= len(citations) <= 3:
            raise ValueError(f"Missing evidence: {row['id']}")
        seen = set()
        for citation in citations:
            pid, quote = citation["paragraph_id"], citation["quote"]
            if (not isinstance(quote, str) or not 8 <= len(quote) <= 55
                    or pid not in paras or quote not in paras[pid] or (pid, quote) in seen):
                raise ValueError(f"Invalid source quote: {row['id']}")
            seen.add((pid, quote))
    return manifest, rows


class PromptIndex:
    """Conservative wording deduplication; not a semantic leakage guarantee."""

    def __init__(self):
        self.exact = set()
        self.postings = defaultdict(list)
        self.grams = {}

    @staticmethod
    def trigrams(question):
        return {question[i:i + 3] for i in range(len(question) - 2)}

    def reserve(self, question):
        key = normalize_prompt(question)
        if key in self.exact:
            return "exact_duplicate"
        grams = self.trigrams(key)
        if len(key) >= 10:
            candidates = Counter(q for gram in grams for q in self.postings[gram])
            for other, shared in candidates.items():
                if min(len(key), len(other)) / max(len(key), len(other)) < 0.8:
                    continue
                union = len(grams) + len(self.grams[other]) - shared
                if shared / union >= 0.80 or (
                    shared / union >= 0.4
                    and SequenceMatcher(None, key, other, autojunk=False).ratio() >= 0.92
                ):
                    return "near_duplicate"
        self.record(key, grams)
        return None

    def record(self, key, grams=None):
        self.exact.add(key)
        if len(key) >= 10 and key not in self.grams:
            grams = self.trigrams(key) if grams is None else grams
            self.grams[key] = grams
            for gram in grams:
                self.postings[gram].append(key)


def _without_answer(row):
    return {key: row[key] for key in ("family_id", "variant_id", "category", "evidence_ids")} | {
        "messages": row["messages"][:-1]
    }


def _copies_source(row, passage):
    # Record short evidence separately; avoid turning the LoRA into a source-text copier.
    limit = 48
    texts = [normalize_prompt(row[field]) for field in ("question", "answer")]
    chunks = {t[i:i + limit] for t in texts for i in range(len(t) - limit + 1)}
    if not chunks:
        return False
    for para in passage["paragraphs"]:
        normalized = normalize_prompt(para["text"])
        if any(normalized[i:i + limit] in chunks for i in range(len(normalized) - limit + 1)):
            return True
    return False


def build_chapter_dataset(corpus, teacher, replay, pack, dest, *, tokenizer,
                          sequence_length=1536, min_books=20, min_source_rows=1000,
                          min_chapter_coverage=0.8, min_holdout_rows=30,
                          min_validation_rows=None, allow_partial_teacher=False):
    """Freeze a new dataset only after all books and split gates pass."""
    corpus, teacher, replay, dest = map(Path, (corpus, teacher, replay, dest))
    if min_validation_rows is None:
        min_validation_rows = min_holdout_rows
    if (tokenizer is None or not 1 <= min_books or not 1 <= min_source_rows
            or not 0 < min_chapter_coverage <= 1 or not 1 <= min_holdout_rows
            or not 1 <= min_validation_rows):
        raise ValueError("A tokenizer and positive coverage gates are required")
    if dest.exists():
        raise ValueError("Dataset destination already exists; do not replace a frozen dataset")
    system, character = load_character(pack, "training")
    corpus_meta, books, chapters, passages = _load_corpus(corpus)
    teacher_meta, teacher_rows = _load_teacher(
        teacher, corpus, passages, allow_partial_teacher=allow_partial_teacher)
    teacher_omitted = sorted(passages.keys() - set(teacher_meta["completed_passage_ids"]))
    replay_meta = validate_manifest({
        "task": "distill_sft", "revision": REVISION, "allow_synthetic_persona": True,
        "data_manifest": str(replay / "manifest.json"), "train_file": str(replay / "train.jsonl"),
        "eval_file": str(replay / "val.jsonl"), "sequence_length": sequence_length,
    })["distill_manifest"]
    if replay_meta.get("dataset_kind") == "chapter_qa_v4" or replay_meta["character"]["prompt_sha256"] != character["prompt_sha256"]:
        raise ValueError("Expected compatible v3 persona replay")
    if len(books) < min_books:
        raise ValueError(f"Expected at least {min_books} books; found {len(books)}")

    outputs = {s: [] for s in SPLITS}
    evidence = []
    replay_by_id = {}
    max_tokens = 0
    token_counts = {s: Counter() for s in SPLITS}
    prompts = PromptIndex()
    kept_chapters, kept_passages = set(), set()
    accepted_per_book = Counter()
    dropped = Counter()
    accepted_categories = {s: Counter() for s in SPLITS}

    # Keep authored fixes and persona behavior. Train replay never comes from an
    # earlier validation/test split. V3 questions also reserve wording for dedup.
    for old in read_jsonl(replay / "train.jsonl"):
        row = old | {"family_id": "v3/" + old["family_id"], "replayed_from": "v3_train"}
        question = normalize_prompt(row["messages"][-2]["content"])
        prompts.record(question)
        encoded = encode_row(row, tokenizer, sequence_length)[0]
        n = len(encoded["input_ids"])
        token_counts["train"].update(input=n, supervised=sum(x != -100 for x in encoded["labels"]))
        max_tokens = max(max_tokens, n)
        outputs["train"].append(row)
        replay_by_id[(old["family_id"], old["variant_id"])] = (old, row)
    for split in ("val", "test"):
        for old in read_jsonl(replay / f"{split}.jsonl"):
            prompts.record(normalize_prompt(old["messages"][-2]["content"]))

    for generated in sorted(teacher_rows.values(), key=lambda r: (SPLITS.index(r["split"]), r["id"])):
        split = generated["split"]
        passage = passages[generated["passage_id"]]
        if _copies_source(generated, passage):
            dropped["long_verbatim_example"] += 1
            continue
        row = {
            "family_id": "chapter/" + generated["chapter_id"], "variant_id": generated["id"],
            "split": split, "category": generated["category"], "evidence_ids": [generated["id"]],
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": generated["question"].strip()},
                {"role": "assistant", "content": generated["answer"].strip()},
            ],
            "reviewed": True, "review_status": "assistant-reviewed", "human_reviewed": False,
            "review_method": teacher_meta["verification"], "provenance": "synthetic_source_grounded",
            "teacher": teacher_meta["teacher_model"], "origin": "chapter_qa",
            "character": character,
            "source": {key: generated[key] for key in SOURCE_KEYS + ("passage_id",)},
        }
        try:
            encoded = encode_row(row, tokenizer, sequence_length)[0]
            n = len(encoded["input_ids"])
        except ValueError as error:
            if "too long" not in str(error) and "would be truncated" not in str(error):
                raise
            dropped["over_token_limit"] += 1
            continue
        duplicate = prompts.reserve(row["messages"][1]["content"])
        if duplicate:
            dropped[duplicate] += 1
            continue
        outputs[split].append(row)
        token_counts[split].update(input=n, supervised=sum(x != -100 for x in encoded["labels"]))
        source_paragraphs = {p["id"]: p for p in passage["paragraphs"]}
        evidence.append({
            "evidence_id": generated["id"], **row["source"],
            "source_file_sha256": books[generated["book_id"]]["source_sha256"],
            "citations": [
                c | {k: source_paragraphs[c["paragraph_id"]][k]
                     for k in ("member", "paragraph", "offset")
                     if k in source_paragraphs[c["paragraph_id"]]}
                for c in generated["evidence"]
            ],
        })
        kept_chapters.add(generated["chapter_id"])
        kept_passages.add(generated["passage_id"])
        accepted_per_book[generated["book_id"]] += 1
        accepted_categories[split][generated["category"]] += 1
        max_tokens = max(max_tokens, n)

    source_counts = {s: sum(accepted_categories[s].values()) for s in SPLITS}
    chapter_coverage = len(kept_chapters) / len(chapters)
    if (sum(source_counts.values()) < min_source_rows or chapter_coverage < min_chapter_coverage
            or accepted_per_book.keys() != books.keys()):
        missing = [books[k]["volume"] for k in books.keys() - accepted_per_book.keys()]
        raise ValueError(
            f"Insufficient verified coverage after filtering: {source_counts}, "
            f"{len(kept_chapters)}/{len(chapters)} chapters, missing volumes {sorted(missing)}, "
            f"dropped={dict(dropped)}"
        )
    if any(not REQUIRED_CATEGORIES <= accepted_categories[s].keys() for s in SPLITS):
        raise ValueError(f"Each split needs plot, relationship and causality examples: {accepted_categories}")
    if source_counts["val"] < min_validation_rows or source_counts["test"] < min_holdout_rows:
        raise ValueError(f"Too few held-out examples: {source_counts}")
    regression = []
    for old in read_jsonl(replay / "regression.jsonl"):
        source, row = replay_by_id[(old["family_id"], old["variant_id"])]
        if source != old:
            raise ValueError("Replay regression example differs from the original v3 training row")
        regression.append(row)
    if not regression:
        raise ValueError("Keep the previous key factual regressions")

    dest.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".chapter-build-", dir=dest.parent) as tmp:
        staging = Path(tmp)
        for split in SPLITS:
            save_jsonl(staging / f"{split}.jsonl", outputs[split])
        save_jsonl(staging / "regression.jsonl", regression)
        for name, rows in (("test", outputs["test"]), ("regression", regression)):
            save_jsonl(staging / f"{name}-prompts.jsonl", map(_without_answer, rows))
        save_jsonl(staging / "chapter-evidence.jsonl", evidence)
        per_book = []
        for k, book in books.items():
            source_chapters = {c for c, ch in chapters.items() if ch["book_id"] == k}
            per_book.append({
                "book_id": k, "volume": book["volume"],
                "split": chapters[next(iter(source_chapters))]["split"],
                "chapters_total": len(source_chapters), "chapters_with_qa": len(source_chapters & kept_chapters),
                "qa": accepted_per_book[k],
            })
        manifest = {
            "schema_version": 1, "task": "distill_sft", "dataset_kind": "chapter_qa_v4",
            "base_model": BASE, "base_revision": REVISION, "character": character,
            "teacher": teacher_meta["teacher_model"], "teacher_revision": teacher_meta["teacher_revision"],
            "review_method": teacher_meta["verification"], "human_reviewed": False,
            "training_executed": False, "evidence_verified": True, "tokenization_checked": True,
            "sequence_length": sequence_length, "max_tokens": max_tokens,
            "token_counts_per_epoch": token_counts,
            "input_manifests_sha256": {
                name: file_sha(path / "manifest.json")
                for name, path in (("corpus", corpus), ("teacher", teacher), ("replay", replay))
            },
            "examples": {s: len(outputs[s]) for s in SPLITS},
            "origin_counts": {s: dict(Counter(r["origin"] for r in outputs[s])) for s in SPLITS},
            "category_counts": {s: dict(Counter(r["category"] for r in outputs[s])) for s in SPLITS},
            "split_family_ids": {s: sorted({r["family_id"] for r in outputs[s]}) for s in SPLITS},
            "sha256": {s: file_sha(staging / f"{s}.jsonl") for s in SPLITS},
            "artifacts": {p.name: file_sha(p) for p in sorted(staging.iterdir())},
            "coverage": {
                "books": len(books), "characters_extracted": corpus_meta.get("characters"),
                "han_characters_extracted": corpus_meta.get("han_characters"),
                "chapters_total": len(chapters), "chapters_with_qa": len(kept_chapters),
                "chapter_coverage": chapter_coverage, "passages_total": len(passages),
                "passages_with_qa": len(kept_passages), "teacher_rows": len(teacher_rows),
                "teacher_generation_complete": teacher_meta["complete"],
                "teacher_passages_completed": teacher_meta["passages_completed"],
                "teacher_passages_omitted": len(teacher_omitted),
                "teacher_omitted_passage_ids": teacher_omitted,
                "minimums": {"books": min_books, "source_rows": min_source_rows,
                             "chapter_fraction": min_chapter_coverage, "validation": min_validation_rows,
                             "test": min_holdout_rows},
                "source_counts": source_counts, "source_categories": accepted_categories,
                "dropped": dict(dropped), "per_book": per_book,
            },
            "limits": (
                "Source citations were exact-match checked and a second pass of the same teacher reviewed support. "
                "No human review or guarantee of factual correctness. "
                "New source-derived data are split by book; the starting adapter and earlier replay may know held-out events. "
                "The similarity filter detects wording overlap, not all semantic overlap. "
                "Coverage measures retained question/answer examples; extracted characters are not training tokens."
            ),
        }
        save_json(staging / "manifest.json", manifest)
        if dest.exists():
            raise ValueError("Dataset destination appeared while assembling")
        staging.replace(dest)
    return manifest


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ("corpus", "teacher", "replay", "character-pack", "tokenizer", "output"):
        p.add_argument("--" + name, required=True)
    p.add_argument("--sequence-length", type=int, default=1536)
    p.add_argument("--min-books", type=int, default=20)
    p.add_argument("--min-source-rows", type=int, default=1000)
    p.add_argument("--min-chapter-coverage", type=float, default=0.8)
    p.add_argument("--min-holdout-rows", type=int, default=30)
    p.add_argument("--min-validation-rows", type=int, help="Override the validation minimum only")
    p.add_argument("--allow-partial-teacher", action="store_true",
                   help="Allow finalized teacher jobs with failures; exclude all failed passages")
    a = p.parse_args()
    from transformers import AutoTokenizer
    tokenizer = AutoTokenizer.from_pretrained(a.tokenizer, local_files_only=True, trust_remote_code=False)
    report = build_chapter_dataset(
        a.corpus, a.teacher, a.replay, a.character_pack, a.output, tokenizer=tokenizer,
        sequence_length=a.sequence_length, min_books=a.min_books,
        min_source_rows=a.min_source_rows, min_chapter_coverage=a.min_chapter_coverage,
        min_holdout_rows=a.min_holdout_rows, min_validation_rows=a.min_validation_rows,
        allow_partial_teacher=a.allow_partial_teacher,
    )
    print(json.dumps({k: report[k] for k in (
        "examples", "origin_counts", "token_counts_per_epoch", "coverage"
    )}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
