import zipfile
from pathlib import Path

import pytest

from yuki_model.chapter_corpus import prepare
from yuki_model.io import file_sha, read_jsonl, save_jsonl


def _epub(path, parts):
    item_tags = "".join(f'<item id="a{i}" href="{name}" media-type="application/xhtml+xml" />'
                        for i, name in enumerate(parts))
    spine_tags = "".join(f'<itemref idref="a{i}" />' for i in range(len(parts)))
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("META-INF/container.xml", '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
                   '<rootfiles><rootfile full-path="book.opf"/></rootfiles></container>')
        z.writestr("book.opf", f'<package xmlns="http://www.idpf.org/2007/opf"><manifest>{item_tags}</manifest>'
                   f'<spine>{spine_tags}</spine></package>')
        for name, (title, body) in parts.items():
            z.writestr(name, f'<html><head><meta charset="utf-8"/><title>{title}</title></head><body>{body}</body></html>')


@pytest.fixture()
def volumes(tmp_path):
    source = tmp_path / "books"
    source.mkdir()
    _epub(source / "[01]样本.epub", {
        "a.xhtml": ("1 第一个故事", "<p>课堂结束。</p><table><tr><td>留下的纸条</td><td>社团会面。</td></tr></table>"),
        "b.xhtml": ("1 第一个故事", "<p>然后她抵达活动室。</p><p>" + "背景叙述" * 280 + "</p>"),
        "afterword.xhtml": ("后记", "<p>制作者的笔记</p>"),
        "interlude.xhtml": ("Interlude", '<img src="art.png"/>'),
    })
    _epub(source / "[05]样本.epub", {"a.xhtml": ("另一个故事", "<p>排练从周五开始。</p>")})
    _epub(source / "[10]样本.epub", {"a.xhtml": ("不同的故事", "<p>雨天活动改在楼内。</p>")})
    return source


def test_rebuild_preserves_table_and_source_ids(volumes, tmp_path):
    d1, d2 = tmp_path / "one", tmp_path / "two"
    report = prepare(volumes, d1, expected_books=3, passage_chars=500, overlap_chars=30)
    rebuilt = prepare(volumes, d2, expected_books=3, passage_chars=500, overlap_chars=30)
    assert report["artifacts"] == rebuilt["artifacts"]
    chapters = list(read_jsonl(d1 / "chapters.jsonl"))
    passages = list(read_jsonl(d1 / "passages.jsonl"))
    assert report["book_count"] == len(chapters) == 3
    assert [c["split"] for c in chapters] == ["train", "val", "test"]
    assert chapters[0]["members"] == ["a.xhtml", "b.xhtml"]
    train_texts = [p["text"] for p in chapters[0]["paragraphs"]]
    assert "留下的纸条" in train_texts and "社团会面。" in train_texts
    assert "制作者的笔记" not in train_texts
    assert report["books"][0]["excluded_counts"]["image_without_body_text"] == 1
    chapter_paragraphs = {p["id"]: p["text"] for c in chapters for p in c["paragraphs"]}
    assert chapter_paragraphs == {p["id"]: p["text"] for passage in passages for p in passage["paragraphs"]}
    assert all(sum(len(p["text"]) for p in r["paragraphs"]) <= 500 for r in passages)
    assert sum(len(text) for text in chapter_paragraphs.values()) == report["characters"]


def test_transcription_matches_epub_and_image(volumes, tmp_path):
    annotation = tmp_path / "transcription.jsonl"
    save_jsonl(annotation, [{"source_sha256": file_sha(volumes / "[01]样本.epub"),
                              "member": "interlude.xhtml", "image_member": "art.png",
                              "paragraphs": ["补录的幕间对话。"]}])
    report = prepare(volumes, tmp_path / "with-image", expected_books=3, supplement=annotation)
    rows = list(read_jsonl(tmp_path / "with-image" / "chapters.jsonl"))
    assert report["chapter_count"] == 4
    assert rows[1]["paragraphs"][0]["image_member"] == "art.png"
    bad = tmp_path / "mismatch.jsonl"
    save_jsonl(bad, [{**next(read_jsonl(annotation)), "image_member": "not-in-page.png"}])
    with pytest.raises(ValueError, match="source mismatch"):
        prepare(volumes, tmp_path / "bad", expected_books=3, supplement=bad)

