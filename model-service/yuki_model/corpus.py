"""EPUB spine reader with provenance, exact dedup and chapter-grouped splits."""

import posixpath
import re
import unicodedata
import zipfile
from collections import Counter
from pathlib import Path
from urllib.parse import unquote
from xml.etree import ElementTree as ET

from bs4 import BeautifulSoup

from .io import file_sha, save_json, save_jsonl, sha

SKIP = re.compile(
    r"^(封面|cover|标题|制作信息|制作者|简介|目录|contents|彩页|插图|后记|长后记|版权|开始|con$|tu\d)",
    re.I,
)
SKIP_FILE = re.compile(
    r"(^|/)(cover|title|message|logo|introduction|contents?\d*|illustration\d*|afterword|copyright|start)\.(x?html?)$",
    re.I,
)


def normalize(text):
    text = (
        unicodedata.normalize("NFKC", text).replace("\u200b", "").replace("\ufeff", "")
    )
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    return re.sub(r"(?<=[\u3400-\u9fff]) +(?=[\u3400-\u9fff])", "", text).strip()


def member(base, href):
    href = unquote(href.split("#", 1)[0])
    if ":" in href or "\\" in href or href.startswith("/"):
        raise ValueError("Unsafe EPUB reference")
    result = posixpath.normpath(posixpath.join(base, href))
    if result == ".." or result.startswith("../"):
        raise ValueError("EPUB path escapes archive")
    return result


def sections(path):
    path = Path(path)
    m = re.match(r"\[([\d.]+)\]", path.name)
    volume = float(m[1]) if m else None
    with zipfile.ZipFile(path) as z:
        if sum(x.file_size for x in z.infolist()) > 256 * 1024**2:
            raise ValueError("EPUB too large")

        def read(name):
            if z.getinfo(name).file_size > 16 * 1024**2:
                raise ValueError("EPUB member too large")
            return z.read(name)

        container = ET.fromstring(read("META-INF/container.xml"))
        opf = member(
            "",
            next(
                x.attrib["full-path"]
                for x in container.iter()
                if x.tag.endswith("}rootfile")
            ),
        )
        root = ET.fromstring(read(opf))
        manifest = {
            x.attrib["id"]: x.attrib for x in root.iter() if x.tag.endswith("}item")
        }
        labels = {}
        for meta in manifest.values():
            if meta.get("media-type") == "application/x-dtbncx+xml":
                toc_name = member(posixpath.dirname(opf), meta["href"])
                toc = ET.fromstring(read(toc_name))
                for nav in toc.iter():
                    if not nav.tag.endswith("}navPoint"):
                        continue
                    c = next((x for x in nav if x.tag.endswith("}content")), None)
                    l = next((x for x in nav if x.tag.endswith("}navLabel")), None)
                    if c is not None and l is not None:
                        labels.setdefault(
                            member(posixpath.dirname(toc_name), c.attrib["src"]),
                            normalize("".join(l.itertext())),
                        )
        for order, item in enumerate(
            x for x in root.iter() if x.tag.endswith("}itemref")
        ):
            meta = manifest[item.attrib["idref"]]
            if (
                item.get("linear") == "no"
                or meta.get("media-type") not in {"text/html", "application/xhtml+xml"}
                or "nav" in meta.get("properties", "").split()
            ):
                continue
            name = member(posixpath.dirname(opf), meta["href"])
            soup = BeautifulSoup(read(name), "html.parser")
            title = normalize(soup.title.get_text(" ")) if soup.title else ""
            if SKIP.search(title) or SKIP_FILE.search(name):
                continue
            for tag in soup(["head", "script", "style", "nav", "rt", "rp"]):
                tag.decompose()
            body = soup.body or soup
            heading = body.find(re.compile("^h[1-6]$"))
            chapter = normalize(heading.get_text(" ")) if heading else title
            if SKIP.search(chapter):
                continue
            chapter = labels.get(name) or chapter or f"section-{order}"
            blocks = body.find_all(["p", "h1", "h2", "h3", "h4", "li"])
            ps = (
                [normalize(x.get_text("")) for x in blocks]
                if blocks
                else [normalize(x) for x in body.get_text("\n").splitlines()]
            )
            ps = [x for x in ps if x]
            if sum(map(len, ps)) < 150:
                continue
            yield dict(
                book=path.stem,
                volume=volume,
                chapter=chapter,
                member=name,
                order=order,
                paragraphs=ps,
                section_id=sha(path.stem + "|" + name)[:20],
            )


def windows(ps, size=900, overlap=120):
    if size < 100 or not 0 <= overlap < size // 2:
        raise ValueError("Invalid chunk size/overlap")
    text = "\n".join(ps)
    start = 0
    while start < len(text):
        end = min(start + size, len(text))
        if end < len(text):
            cut = max(
                text.rfind("\n", start + size // 2, end),
                text.rfind("。", start + size // 2, end),
            )
            if cut >= 0:
                end = cut + 1
        if text[start:end].strip():
            yield start, text[start:end].strip()
        if end == len(text):
            break
        start = end - overlap


def prepare(source, dest, seed=42):
    files = sorted(Path(source).glob("*.epub"))
    dest = Path(dest)
    if not files:
        raise ValueError("No EPUB files")
    docs = []
    seen = set()
    duplicates = 0
    books = []
    for path in files:
        count = 0
        for s in sections(path):
            keep = []
            for p in s["paragraphs"]:
                h = sha(re.sub(r"\W", "", p))
                if len(p) >= 40 and h in seen:
                    duplicates += 1
                    continue
                if len(p) >= 40:
                    seen.add(h)
                keep.append(p)
            if sum(map(len, keep)) < 100:
                continue
            s["paragraphs"] = keep
            docs.append(s)
            count += 1
        books.append({"file": path.name, "sha256": file_sha(path), "sections": count})
    groups = sorted({d["section_id"] for d in docs}, key=lambda x: sha(f"{seed}|{x}"))
    if len(groups) < 5:
        raise ValueError("Need five substantive sections")
    n = max(1, len(groups) // 10)
    split = {
        g: "test" if i < n else "val" if i < 2 * n else "train"
        for i, g in enumerate(groups)
    }
    rows = []
    seen_chunks = set()
    for doc in docs:
        for offset, text in windows(doc["paragraphs"]):
            h = sha(text)
            if h in seen_chunks:
                continue
            seen_chunks.add(h)
            rows.append(
                {k: v for k, v in doc.items() if k != "paragraphs"}
                | {
                    "id": sha(doc["section_id"] + str(offset))[:24],
                    "offset": offset,
                    "text": text,
                    "split": split[doc["section_id"]],
                }
            )
    save_jsonl(dest / "chunks.jsonl", rows)
    for name in ["train", "val", "test"]:
        save_jsonl(dest / f"{name}.jsonl", (x for x in rows if x["split"] == name))
    report = {
        "schema": 2,
        "books": books,
        "sections": len(docs),
        "chunks": len(rows),
        "split_counts": dict(Counter(r["split"] for r in rows)),
        "characters": sum(sum(map(len, d["paragraphs"])) for d in docs),
        "exact_duplicate_paragraphs_removed": duplicates,
        "seed": seed,
        "limitation": "Near duplicates and alternate translations are not removed; chapter split is not a strict unseen-fact benchmark.",
    }
    save_json(dest / "manifest.json", report)
    return report
