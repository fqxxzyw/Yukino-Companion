"""Export auditable EPUB chapters and bounded teacher passages, in reading order."""

import argparse
import json
import posixpath
import re
import zipfile
from collections import Counter
from decimal import Decimal
from pathlib import Path
from xml.etree import ElementTree as ET

from bs4 import BeautifulSoup, Comment, NavigableString

from .corpus import member, normalize
from .io import file_sha, read_jsonl, save_json, save_jsonl, sha

TEXT_TYPES = {"text/html", "application/xhtml+xml"}
BLOCKS = set("address article blockquote dd div dl dt h1 h2 h3 h4 h5 h6 hr li p pre section table td th tr".split())
IGNORE = {"head", "script", "style", "nav", "rt", "rp", "svg", "math", "img"}
META = re.compile(
    r"^(?:封[面底]|cover|back\s*cover|标题|title(?:\s+page)?|制作信息|制作者|版权(?:信息)?|"
    r"简介|作者简介|作者/插画|人物(?:简介|介绍|设定)|登场人物\d*|目录|table of contents|contents(?:\d+)?|con|"
    r"彩页\d*|插图\d*|插画\d*|tu\d+|(?:长|译)?后记|中记|postscript|afterword|首次刊载)$",
    re.I,
)
META_FILE = re.compile(
    r"^(?:backcover|cover|title|message|summary|copyright|introduction|contents?(?:[-_]illus|\d+)?|"
    r"(?:illustration|illus)\d*|char-illus|postscript(?:-\d+)?|afterword|bookmark\d+)\.[a-z]+$",
    re.I,
)
HAN = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U000323af]")
RELATED_VOLUMES = frozenset({"6.25", "6.5", "6.75"})


def _volume(path):
    match = re.match(r"\[(\d+(?:\.\d+)?)\]", path.name)
    if not match:
        raise ValueError(f"EPUB volume prefix missing: {path.name}")
    return format(Decimal(match[1]).normalize(), "f")


def _clean(text):
    return normalize(re.sub(r"\s+", " ", text))


def _paragraphs(body):
    """Keep visible text in reading order, including inserts written as HTML tables."""
    out, buffer = [], []

    def flush():
        text = _clean("".join(buffer))
        if text:
            out.append(text)
        buffer.clear()

    def walk(node):
        if isinstance(node, Comment):
            return
        if isinstance(node, NavigableString):
            buffer.append(str(node))
            return
        if node.name in IGNORE or node.has_attr("hidden") or node.get("aria-hidden") == "true":
            return
        if node.name == "br":
            flush()
            return
        boundary = node.name in BLOCKS
        if boundary:
            flush()
        for child in node.children:
            walk(child)
        if boundary:
            flush()

    walk(body)
    flush()
    return out


def _spine(path):
    with zipfile.ZipFile(path) as epub:
        if sum(x.file_size for x in epub.infolist()) > 256 * 1024**2:
            raise ValueError(f"EPUB uncompressed size limit: {path.name}")

        def read(name):
            if epub.getinfo(name).file_size > 16 * 1024**2:
                raise ValueError(f"EPUB member size limit: {name}")
            return epub.read(name)

        container = ET.fromstring(read("META-INF/container.xml"))
        opf = member("", next(x.attrib["full-path"] for x in container.iter() if x.tag.endswith("}rootfile")))
        root = ET.fromstring(read(opf))
        base = posixpath.dirname(opf)
        items = {x.attrib["id"]: x.attrib for x in root.iter() if x.tag.endswith("}item")}
        labels = {}
        for item in items.values():
            if item.get("media-type") == "application/x-dtbncx+xml":
                toc_name = member(base, item["href"])
                toc = ET.fromstring(read(toc_name))
                for nav in (x for x in toc.iter() if x.tag.endswith("}navPoint")):
                    src = next((x.get("src") for x in nav if x.tag.endswith("}content")), None)
                    label = next((_clean("".join(x.itertext())) for x in nav if x.tag.endswith("}navLabel")), "")
                    if src and label:
                        labels.setdefault(member(posixpath.dirname(toc_name), src), label)
            elif "nav" in item.get("properties", "").split():
                toc_name = member(base, item["href"])
                toc = BeautifulSoup(read(toc_name), "html.parser")
                nav = toc.find("nav", attrs={"epub:type": "toc"})
                if nav:
                    for anchor in nav.find_all("a", href=True):
                        if anchor["href"].startswith("#"):
                            continue
                        labels.setdefault(member(posixpath.dirname(toc_name), anchor["href"]), _clean(anchor.get_text()))

        for order, ref in enumerate(x for x in root.iter() if x.tag.endswith("}itemref")):
            item = items[ref.attrib["idref"]]
            name = member(base, item["href"])
            record = {"member": name, "order": order, "title": labels.get(name) or posixpath.basename(name)}
            if ref.get("linear") == "no" or item.get("media-type") not in TEXT_TYPES:
                yield record | {"excluded_reason": "nonlinear_or_non_html"}
                continue
            if "nav" in item.get("properties", "").split():
                yield record | {"excluded_reason": "metadata"}
                continue
            soup = BeautifulSoup(read(name), "html.parser")
            body = soup.body or soup
            title = _clean(soup.title.get_text()) if soup.title else ""
            head = body.find(re.compile(r"^h[1-6]$"))
            heading = _clean(head.get_text()) if head else ""
            chapter = labels.get(name) or heading or title or posixpath.basename(name)
            record["title"] = chapter
            paragraphs = _paragraphs(body)
            if (
                any(META.fullmatch(s) for s in (chapter, title, heading))
                or META_FILE.fullmatch(posixpath.basename(name))
                or (paragraphs and META.fullmatch(paragraphs[0]))
                # This early edition uses a chapter-like title for a reference card.
                or (chapter.lower() == "chapter4" and {"专长", "假日活动"} <= set(paragraphs))
            ):
                yield record | {"excluded_reason": "metadata"}
                continue
            images = [x.get("src") for x in body.find_all("img") if x.get("src")]
            image_members = [member(posixpath.dirname(name), src) for src in images if ":" not in src]
            def title_key(value):
                return re.sub(r"[\W_]", "", value.casefold())

            if not paragraphs or (
                len(paragraphs) == 1 and title_key(paragraphs[0]) in {title_key(s) for s in (title, heading, chapter)}
            ):
                yield record | {"excluded_reason": "image_without_body_text" if images else "heading_or_empty",
                                "image_members": image_members}
                continue
            yield record | {"paragraphs": paragraphs}


def _chapter_key(record):
    # Some volumes split a chapter across an illustration. Keep continuation files
    # together; repeated generic "Interlude" titles can be distinct scenes.
    title = record["title"].casefold()
    if re.fullmatch(r"(?:interlude|幕间|间奏)[.。…]*", title):
        return re.sub(r"_\d+(?=\.[a-z]+$)", "", record["member"], flags=re.I)
    if re.fullmatch(r"ch\d+(?:_\d+)?\.xhtml", posixpath.basename(title), flags=re.I):
        return re.sub(r"_\d+(?=\.[a-z]+$)", "", title)
    numbered = re.match(r"^(\d+)[\s:：、.．]*(?=\D|$)", title)
    if numbered:
        return "chapter-number:" + numbered[1]
    return title


def _passages(chapter, size, overlap):
    ps = chapter["paragraphs"]
    start = 0
    while start < len(ps):
        end, total = start, 0
        while end < len(ps) and total + len(ps[end]["text"]) <= size:
            total += len(ps[end]["text"])
            end += 1
        if end <= start:
            raise ValueError("A paragraph exceeds the passage limit")
        rows = ps[start:end]
        provenance = {k: v for k, v in chapter.items() if k != "paragraphs"}
        yield provenance | {"passage_id": sha(chapter["chapter_id"] + "|" + "|".join(p["id"] for p in rows))[:24],
                            "paragraphs": rows}
        if end == len(ps):
            break
        back = end
        carried = 0
        while back > start + 1:
            length = len(ps[back - 1]["text"])
            if carried + length > overlap or carried + length + len(ps[end]["text"]) > size:
                break
            carried += length
            back -= 1
        start = back


def prepare(source, dest, *, expected_books=20, passage_chars=5000, overlap_chars=350,
            val_volume="5", test_volume="10", supplement=None):
    source, dest = Path(source), Path(dest)
    if not 500 <= passage_chars <= 12000 or not 0 <= overlap_chars < passage_chars // 2:
        raise ValueError("Invalid passage size or overlap")
    books = sorted(source.glob("*.epub"), key=lambda x: (Decimal(_volume(x)), x.name))
    if len(books) != expected_books:
        raise ValueError(f"Expected {expected_books} EPUBs, found {len(books)}")
    volumes = [_volume(p) for p in books]
    if len(set(volumes)) != len(volumes):
        raise ValueError("Duplicate volume number; choose a single edition per volume")
    if val_volume == test_volume or not {val_volume, test_volume} <= set(volumes):
        raise ValueError("Validation and test volumes must be present and distinct")
    if {val_volume, test_volume} & RELATED_VOLUMES:
        raise ValueError("Keep overlapping editions 6.25/6.5/6.75 together in train")
    if dest.resolve() == source.resolve():
        raise ValueError("Write the corpus outside the source EPUB directory")
    annotations = {}
    if supplement:
        for row in read_jsonl(supplement):
            key = (row["source_sha256"], row["member"])
            if key in annotations or not row.get("paragraphs") or not all(isinstance(p, str) and _clean(p) for p in row["paragraphs"]):
                raise ValueError(f"Invalid image transcription: {key}")
            annotations[key] = row
    supplements_seen = set()
    book_reports, chapters, passages = [], [], []
    used_book_ids = set()
    for path, volume in zip(books, volumes):
        digest = file_sha(path)
        book_id = digest[:24]
        if book_id in used_book_ids:
            raise ValueError("Two volumes contain the same EPUB bytes")
        used_book_ids.add(book_id)
        split = "val" if volume == val_volume else "test" if volume == test_volume else "train"
        groups, excluded = [], []
        for row in _spine(path):
            key = (digest, row["member"])
            annotation = annotations.get(key)
            if annotation:
                if row.get("excluded_reason") != "image_without_body_text" or annotation.get("image_member") not in row.get("image_members", []):
                    raise ValueError(f"Image transcription source mismatch: {row['member']}")
                supplements_seen.add(key)
                row = row | {"paragraphs": [_clean(p) for p in annotation["paragraphs"]],
                             "image_member": annotation["image_member"]}
                del row["excluded_reason"]
            if "excluded_reason" in row:
                excluded.append(row)
                continue
            if groups and _chapter_key(groups[-1][-1]) == _chapter_key(row):
                groups[-1].append(row)
            else:
                groups.append([row])
        if not groups:
            raise ValueError(f"Volume contains no extractable narrative text: {path.name}")
        book_chapters, book_passages = [], []
        for group in groups:
            first = group[0]
            chapter_id = sha(book_id + "|" + first["member"] + "|" + str(first["order"]))[:24]
            ps = []
            for row in group:
                for ix, paragraph in enumerate(row["paragraphs"], 1):
                    for offset in range(0, len(paragraph), passage_chars):
                        value = paragraph[offset:offset + passage_chars]
                        paragraph_id = sha(f"{digest}|{row['member']}|{row['order']}|{ix}|{offset}|{value}")[:24]
                        ps.append({"id": paragraph_id, "text": value, "member": row["member"],
                                   "paragraph": ix, "offset": offset} |
                                  ({"image_member": row["image_member"]} if "image_member" in row else {}))
            chapter = {"chapter_id": chapter_id, "book_id": book_id, "book": path.name, "volume": volume,
                       "chapter": first["title"], "member": first["member"], "order": first["order"],
                       "members": [r["member"] for r in group], "source_sha256": digest, "split": split,
                       "paragraphs": ps}
            book_chapters.append(chapter)
            book_passages.extend(_passages(chapter, passage_chars, overlap_chars))
        chapters.extend(book_chapters)
        passages.extend(book_passages)
        texts = [p["text"] for c in book_chapters for p in c["paragraphs"]]
        book_reports.append({"book_id": book_id, "book": path.name, "volume": volume, "source_sha256": digest,
                             "split": split, "chapters": len(book_chapters), "passages": len(book_passages),
                             "characters": sum(map(len, texts)), "han_characters": sum(len(HAN.findall(t)) for t in texts),
                             "paragraph_count": len(texts),
                             "excluded_counts": dict(Counter(r["excluded_reason"] for r in excluded)),
                             "excluded_spine_items": excluded})

    if supplements_seen != set(annotations):
        raise ValueError("One or more image transcription entries do not match supplied EPUBs")
    paths = {name: dest / name for name in ("chapters.jsonl", "passages.jsonl")}
    save_jsonl(paths["chapters.jsonl"], chapters)
    save_jsonl(paths["passages.jsonl"], passages)
    report = {"schema": 1, "book_count": len(books), "chapter_count": len(chapters), "passage_count": len(passages),
              "characters": sum(r["characters"] for r in book_reports), "han_characters": sum(r["han_characters"] for r in book_reports),
              "paragraph_count": sum(r["paragraph_count"] for r in book_reports), "passage_chars": passage_chars,
              "overlap_chars": overlap_chars, "books": book_reports,
              "splits": {s: {"books": sum(b["split"] == s for b in book_reports),
                             "chapters": sum(c["split"] == s for c in chapters),
                             "passages": sum(p["split"] == s for p in passages)} for s in ("train", "val", "test")},
              "supplement_sha256": file_sha(supplement) if supplement else None,
              "artifacts": {name: file_sha(p) for name, p in paths.items()},
              "limitation": "Character counts exclude passage overlap. Covers EPUB spine text, not OCR; image-only pages are inventoried. Related editions 6.25/6.5/6.75 share the train split. Held-out volumes may overlap facts learned in earlier runs or pretraining."}
    save_json(dest / "manifest.json", report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--dest", type=Path, required=True)
    parser.add_argument("--expected-books", type=int, default=20)
    parser.add_argument("--passage-chars", type=int, default=5000)
    parser.add_argument("--overlap-chars", type=int, default=350)
    parser.add_argument("--val-volume", default="5")
    parser.add_argument("--test-volume", default="10")
    parser.add_argument("--supplement", type=Path, help="Reviewed private image transcriptions (JSONL)")
    report = prepare(**vars(parser.parse_args()))
    print(json.dumps({k: v for k, v in report.items() if k != "books"}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
