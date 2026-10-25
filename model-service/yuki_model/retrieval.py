import json
import re
import sqlite3
from pathlib import Path

from .io import read_jsonl, sha

ALIASES = {
    "雪乃": "雪之下雪乃",
    "八幡": "比企谷八幡",
    "结衣": "由比滨结衣",
    "小雪": "雪之下雪乃",
    "侍奉社": "侍奉部",
}
STOP = {
    "什么",
    "为什",
    "么是",
    "是谁",
    "怎么",
    "如何",
    "么会",
    "的什",
    "的是",
    "叫什",
    "谁的",
    "请问",
    "知道",
}


def normalize_name(text):
    return text.replace("平塚", "平冢")


def is_basic_profile_query(query):
    return (
        len(query) <= 60
        and not re.search(
            r"为什么|为何|如何|怎么|分析|变化|经历|发展|比较|评价|看待|未来|之后|后来|毕业后|成年后|长大后|[0-9]{4}|[一二三四五六七八九〇零]{4}年",
            query,
        )
        and bool(
            re.search(
                r"是谁|谁是|叫什么|名字|介绍|身份|社团|运动|职业|工作|职务|哪个社|什么社|姐姐|妹妹|哥哥|弟弟|父亲|母亲",
                query,
            )
        )
    )


def prefer_profiles(query, profiles):
    """Select explicit source cards for short basic facts, never synthesize answers."""
    if not is_basic_profile_query(query):
        return []
    query = normalize_name(query)
    named = []
    for row in profiles:
        if "：" not in row["text"]:
            continue
        name, desc = normalize_name(row["text"]).split("：", 1)
        named.append((name, desc, row))
    names = {name for name, _, _ in named}
    subjects = {name for name in names if name in query}
    for alias, name in ALIASES.items():
        name = normalize_name(name)
        if normalize_name(alias) in query and name in names:
            subjects.add(name)
    relations = re.findall(r"姐姐|妹妹|哥哥|弟弟|父亲|母亲", query)
    selected = []
    for name, desc, row in named:
        if relations:
            aliases = {subject for subject in subjects}
            aliases.update(
                normalize_name(alias)
                for alias, target in ALIASES.items()
                if normalize_name(target) in subjects
            )
            match = any(relation in desc for relation in relations) and any(
                alias in desc for alias in aliases
            )
        else:
            match = name in subjects
        if match:
            selected.append(
                row | {"score": 1.0, "retrieval_reason": "explicit_profile"}
            )
    return sorted(
        selected,
        key=lambda row: (
            row.get("volume") if row.get("volume") is not None else float("inf"),
            row["id"],
        ),
    )


def tokens(text):
    out = []
    for s in re.findall(r"[\u3400-\u9fff]+|[a-z0-9]+", text.lower()):
        out.extend(
            [s[i : i + 2] for i in range(len(s) - 1)]
            if re.match(r"[\u3400-\u9fff]", s) and len(s) > 1
            else [s]
        )
    return [x for x in out if x not in STOP]


def cards(row):
    if "人物介绍" not in row["chapter"] and not any(
        x in row["text"] for x in ["登场人物", "登場人物"]
    ):
        return []
    matches = list(
        re.finditer(
            r"(?m)^([\u3400-\u9fff]{2,10})[ \t]*[.·…・]{2,}[ \t]*$", row["text"]
        )
    )
    out = []
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(row["text"])
        desc = row["text"][m.end() : end].strip()
        if not desc or len(desc) > 300:
            continue
        out.append(
            row
            | {
                "id": sha(row["id"] + "|profile|" + m[1])[:24],
                "offset": row["offset"] + m.start(),
                "text": m[1] + "：" + desc,
                "kind": "profile",
                "derived_from": row["id"],
            }
        )
    return out


def index(source, path, splits=None):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".building")
    tmp.unlink(missing_ok=True)
    n = 0
    with sqlite3.connect(tmp) as db:
        db.execute(
            "CREATE TABLE chunks(id TEXT PRIMARY KEY, metadata TEXT, volume REAL)"
        )
        db.execute(
            "CREATE VIRTUAL TABLE search USING fts5(words,id UNINDEXED,tokenize='unicode61')"
        )
        for row in read_jsonl(source):
            if splits and row["split"] not in splits:
                continue
            for item in [row] + cards(row):
                db.execute(
                    "INSERT INTO chunks VALUES(?,?,?)",
                    (item["id"], json.dumps(item, ensure_ascii=False), item["volume"]),
                )
                db.execute(
                    "INSERT INTO search VALUES(?,?)",
                    (" ".join(tokens(item["text"])), item["id"]),
                )
                n += 1
    if not n:
        tmp.unlink()
        raise ValueError("Empty index")
    tmp.replace(path)
    return n


class Retriever:
    def __init__(self, path):
        self.path = Path(path).resolve()
        if not self.path.is_file():
            raise FileNotFoundError("Knowledge index missing; run prepare/index")

    def search(self, query, k=3, max_volume=None):
        if not 1 <= k <= 10:
            raise ValueError("k must be 1..10")
        query = normalize_name(query)
        terms = list(
            dict.fromkeys(
                tokens(
                    query + " " + " ".join(v for a, v in ALIASES.items() if a in query)
                )
            )
        )[:80]
        if not terms:
            return []
        sql = "SELECT c.metadata,bm25(search) FROM search JOIN chunks c ON c.id=search.id WHERE search MATCH ?"
        args = [" OR ".join('"' + x + '"' for x in terms)]
        if max_volume is not None:
            sql += " AND c.volume<=?"
            args.append(max_volume)
        sql += " ORDER BY bm25(search) LIMIT ?"
        args.append(k * 8)
        with sqlite3.connect(self.path.as_uri() + "?mode=ro", uri=True) as db:
            rows = db.execute(sql, args).fetchall()
            profiles = []
            if is_basic_profile_query(query):
                profile_sql = "SELECT metadata FROM chunks WHERE json_extract(metadata, '$.kind')='profile'"
                profile_args = []
                if max_volume is not None:
                    profile_sql += " AND volume<=?"
                    profile_args.append(max_volume)
                profiles = [
                    json.loads(raw) for (raw,) in db.execute(profile_sql, profile_args)
                ]
        ranked = []
        for raw, score in rows:
            row = json.loads(raw)
            if row.get("kind") == "profile":
                name, desc = row["text"].split("：", 1)
                if (set(tokens(query)) - set(tokens(name))) & set(tokens(desc)):
                    score *= 2
            ranked.append((score, row))
        ranked.sort(key=lambda x: x[0])
        out = []
        candidates = prefer_profiles(query, profiles) + [
            row | {"score": -score} for score, row in ranked
        ]
        for row in candidates:
            if any(
                x["text"] == row["text"]
                or x["section_id"] == row["section_id"]
                and not (x.get("kind") == row.get("kind") == "profile")
                and abs(x["offset"] - row["offset"]) < 500
                for x in out
            ):
                continue
            out.append(row)
            if len(out) == k:
                break
        return out
