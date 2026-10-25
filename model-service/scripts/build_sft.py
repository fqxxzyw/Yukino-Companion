"""Reviewed facts from explicit EPUB character profiles. Not invented novel dialogue."""

import json
import sqlite3

from yuki_model.io import save_json, save_jsonl

SYSTEM = "你是熟悉《春物》的中文助手。简短、准确地回答。资料不足时说明无法确认，不编造原作事实。"
with sqlite3.connect("data/processed/knowledge.sqlite") as db:
    cards = [
        json.loads(x[0])
        for x in db.execute("SELECT metadata FROM chunks")
        if json.loads(x[0]).get("kind") == "profile"
    ]
byname = {}
for card in cards:
    name = card["text"].split("：", 1)[0].replace("平塚", "平冢")
    byname.setdefault(name, card)
train = []
val = []


def add(dest, q, a, source=None, context=False, kind="fact"):
    system = SYSTEM
    if context and source:
        system += "\n参考资料：" + source["text"]
    dest.append(
        {
            "reviewed": True,
            "review_method": "Explicit character profile inspected; factual paraphrase. Unknown examples intentionally contain no asserted canon fact.",
            "kind": kind,
            "source_ids": [source["id"]] if source else [],
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": q},
                {"role": "assistant", "content": a},
            ],
        }
    )


for name, source in byname.items():
    answer = source["text"].replace("平塚", "平冢")
    for q in [f"{name}是谁？", f"请简单介绍《春物》中的{name}。"]:
        add(train, q, answer, source)
    for q in [f"根据资料说明{name}的身份。", f"这份人物资料介绍了{name}的哪些特点？"]:
        add(train, q, answer, source, True)
    add(val, f"用一句话概括{name}的人物介绍。", answer, source, True)
facts = [
    (
        "雪之下雪乃",
        "雪之下雪乃担任什么社团的部长？",
        "雪之下雪乃是侍奉部的部长，也译作侍奉社社长。",
        "雪乃是哪个社团的负责人？",
    ),
    (
        "雪之下阳乃",
        "雪之下雪乃的姐姐叫什么？",
        "雪乃的姐姐叫雪之下阳乃。",
        "雪乃的姐姐是谁？",
    ),
    (
        "比企谷小町",
        "比企谷八幡的妹妹叫什么？",
        "八幡的妹妹叫比企谷小町。",
        "八幡与小町是什么关系？",
    ),
    (
        "平冢静",
        "平冢静是什么身份？",
        "平冢静是国文老师，也担任导师。",
        "平冢静是学生还是老师？",
    ),
    (
        "户冢彩加",
        "户冢彩加参加什么运动社团？",
        "户冢彩加参加网球社，也称网球部。",
        "彩加的运动社团是什么？",
    ),
    (
        "叶山隼人",
        "叶山隼人参加什么运动社团？",
        "叶山隼人是足球社的成员。",
        "叶山属于什么体育社团？",
    ),
    (
        "一色彩羽",
        "一色彩羽在学生会中担任什么职务？",
        "一色彩羽是一年级时就当选的学生会长。",
        "一色彩羽是学生会长吗？",
    ),
    (
        "川崎大志",
        "川崎沙希的弟弟是谁？",
        "川崎沙希的弟弟是川崎大志。",
        "大志与沙希是什么关系？",
    ),
    (
        "比企谷八幡",
        "《春物》的男主角叫什么？",
        "男主角是比企谷八幡。",
        "《春物》的主人公是谁？",
    ),
    (
        "材木座义辉",
        "材木座义辉有什么写作梦想？",
        "材木座义辉希望成为轻小说作家。",
        "材木座希望成为哪类作家？",
    ),
    (
        "折本香织",
        "折本香织和八幡曾经同校吗？",
        "他们曾经就读同一所中学。",
        "折本香织与八幡在中学时期有什么关系？",
    ),
]
for name, q, answer, heldout in facts:
    s = byname[name]
    for context in [False, True]:
        add(train, q, answer, s, context)
    add(train, "请依据原作人物介绍回答：" + q, answer, s, True)
    # The sibling relation answer must explicitly cover both names, not just a name lookup.
    if name == "比企谷小町":
        answer = "八幡是哥哥，小町是他的妹妹。"
    if name == "川崎大志":
        answer = "沙希是姐姐，大志是她的弟弟。"
    add(val, heldout, answer, s, True)
unknowns = [
    "原作明确写过雪乃在2040年的工作吗？",
    "雪乃的银行账户号码是什么？",
    "原作有没有公布八幡的身份证号码？",
    "请给出阳乃没有在小说中提到的私人电话号码。",
    "请精确说出结衣在2050年的住址。",
    "没有原文依据，可以把猜测说成作者设定吗？",
    "请编一个没发生过的剧情并说这是原作。",
    "资料里没提到的情节，能直接当成事实吗？",
]
for q in unknowns:
    add(
        train,
        q,
        "现有原作资料无法确认这项信息，我不会把推测或虚构当作原作事实。",
        kind="abstention",
    )
    add(
        train,
        "仅凭人物介绍回答：" + q,
        "人物介绍没有提供这项信息，无法确认。",
        kind="abstention",
    )
add(
    val,
    "原作明确说雪乃在2035年从事什么职业了吗？",
    "现有资料无法确认。",
    kind="abstention",
)
add(
    val,
    "请给出小说里没有写过的雪乃个人账户。",
    "原作资料没有这项信息，无法提供。",
    kind="abstention",
)
save_jsonl("data/sft/train.jsonl", train)
save_jsonl("data/sft/val.jsonl", val)
save_json(
    "data/sft/manifest.json",
    {
        "train": len(train),
        "val": len(val),
        "source_characters": len(byname),
        "scope": "Supervised character facts + grounded answering + abstention. NOT all novel facts memorized. Full novels remain in RAG index.",
        "validation": "Paraphrase validation over known facts; not unseen-knowledge accuracy.",
    },
)
print("SFT examples", len(train), len(val), "character profiles", len(byname))
