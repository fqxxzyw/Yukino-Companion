import json
import threading
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from yuki_model.corpus import member, prepare
from yuki_model.hardware import device
from yuki_model.io import read_jsonl, save_jsonl
from yuki_model.retrieval import Retriever, index
from yuki_model.server import create_app
from yuki_model.training import Collator, encode_row


@pytest.mark.parametrize(
    "href", ["../../escape", "https://evil/x", "/etc/passwd", "..%2f..%2fx", "..\\x"]
)
def test_archive_paths(href):
    with pytest.raises(ValueError):
        member("OPS", href)


def test_epub_spine_and_group_splits(tmp_path):
    source = tmp_path / "input"
    source.mkdir()
    with zipfile.ZipFile(source / "[1]fixture.epub", "w") as z:
        z.writestr(
            "META-INF/container.xml",
            '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>',
        )
        items = "".join(
            f'<item id="c{i}" href="c{i}.xhtml" media-type="application/xhtml+xml"/>'
            for i in range(8)
        )
        spine = "".join(f'<itemref idref="c{i}"/>' for i in reversed(range(8)))
        z.writestr(
            "OPS/book.opf",
            f'<package xmlns="http://www.idpf.org/2007/opf"><manifest>{items}</manifest><spine>{spine}</spine></package>',
        )
        for i in range(8):
            z.writestr(
                f"OPS/c{i}.xhtml",
                f"<html><head><title>第{i}章</title></head><body><p>"
                + "".join(f"章节{i}段落{j}的合成测试内容。" for j in range(150))
                + "</p></body></html>",
            )
    report = prepare(source, tmp_path / "processed")
    rows = list(read_jsonl(tmp_path / "processed/chunks.jsonl"))
    assert report["sections"] == 8 and set(report["split_counts"]) == {
        "train",
        "val",
        "test",
    }
    assert rows[0]["member"] == "OPS/c7.xhtml"
    for section in {r["section_id"] for r in rows}:
        assert len({r["split"] for r in rows if r["section_id"] == section}) == 1


@pytest.fixture
def retriever(tmp_path):
    rows = [
        dict(
            id=str(i),
            text=text,
            volume=volume,
            chapter="测试",
            section_id=str(i),
            offset=0,
            split="train",
        )
        for i, (text, volume) in enumerate(
            [
                ("雪之下雪乃是侍奉部部长。", 1),
                ("雪之下阳乃是雪乃的姐姐。", 2),
                ("比企谷小町是八幡的妹妹。", 3),
            ]
        )
    ]
    save_jsonl(tmp_path / "chunks.jsonl", rows)
    index(tmp_path / "chunks.jsonl", tmp_path / "knowledge.sqlite")
    return Retriever(tmp_path / "knowledge.sqlite")


def test_retrieval_and_spoiler_filter(retriever):
    assert "姐姐" in retriever.search("雪乃的姐姐是谁？")[0]["text"]
    assert all(r["volume"] <= 1 for r in retriever.search("雪乃", max_volume=1))
    assert retriever.search('" OR * --') == []


@pytest.mark.parametrize(
    "cuda,mps,expected",
    [(True, False, "cuda"), (False, True, "mps"), (False, False, "cpu")],
)
def test_gpu_priority_even_with_low_memory(cuda, mps, expected):
    assert device({"cuda": cuda, "mps": mps, "gpus": [{"free_gib": 0.1}]}) == expected


def test_explicit_unavailable_gpu():
    with pytest.raises(RuntimeError):
        device({"cuda": False, "mps": False}, "cuda")


class Tokenizer:
    def apply_chat_template(self, messages, tokenize=True, add_generation_prompt=False):
        return [1, 2, 3] if add_generation_prompt else [1, 2, 3, 4, 5]


def test_supervised_masking_and_padding():
    row = {
        "reviewed": True,
        "messages": [
            {"role": "user", "content": "q"},
            {"role": "assistant", "content": "a"},
        ],
    }
    encoded = encode_row(row, Tokenizer(), 32)[0]
    assert encoded["labels"] == [-100, -100, -100, 4, 5]
    batch = Collator(0)(
        [encoded, {"input_ids": [1], "attention_mask": [1], "labels": [1]}]
    )
    assert batch["labels"][1].tolist() == [1, -100, -100, -100, -100]
    with pytest.raises(ValueError):
        encode_row(row | {"reviewed": False}, Tokenizer(), 32)


class FakeBackend:
    def status(self):
        return {"loaded": True, "device": "cpu"}

    def stream(self, messages, max_tokens, temperature, cancel):
        yield "测试"
        yield "回答"


@pytest.fixture
def client(retriever):
    with TestClient(
        create_app(
            {"index": "unused", "allowed_hosts": ["testserver"]},
            FakeBackend(),
            retriever,
        )
    ) as c:
        yield c


def test_api_nonstream_sources_and_validation(client):
    r = client.post(
        "/v1/chat/completions",
        json={"messages": [{"role": "user", "content": "雪乃姐姐"}]},
    )
    assert (
        r.status_code == 200
        and r.json()["choices"][0]["message"]["content"] == "测试回答"
        and r.json()["sources"]
    )
    assert (
        client.post(
            "/v1/chat/completions",
            json={"model": "invalid", "messages": [{"role": "user", "content": "q"}]},
        ).status_code
        == 404
    )
    assert (
        client.post(
            "/v1/chat/completions",
            json={"messages": [{"role": "assistant", "content": "a"}]},
        ).status_code
        == 422
    )
    assert client.post("/v1/chat/completions", content="a" * 131073).status_code == 413


def test_api_sse(client):
    r = client.post(
        "/v1/chat/completions",
        json={"messages": [{"role": "user", "content": "雪乃"}], "stream": True},
    )
    assert r.headers["x-request-id"].startswith("chatcmpl-")
    packets = [x[6:] for x in r.text.splitlines() if x.startswith("data: ")]
    assert packets[-1] == "[DONE]" and json.loads(packets[0])["sources"]
    assert (
        "".join(
            json.loads(p)["choices"][0]["delta"].get("content", "")
            for p in packets[:-1]
        )
        == "测试回答"
    )


def test_auth_and_bind(retriever, monkeypatch):
    monkeypatch.setenv("YUKI_API_KEY", "a" * 24)
    with TestClient(
        create_app(
            {"index": "unused", "allowed_hosts": ["testserver"]},
            FakeBackend(),
            retriever,
        )
    ) as c:
        assert c.get("/v1/models").status_code == 401
        assert (
            c.get(
                "/v1/models", headers={"Authorization": "Bearer " + "a" * 24}
            ).status_code
            == 200
        )
    monkeypatch.delenv("YUKI_API_KEY")
    with pytest.raises(ValueError):
        create_app({"host": "0.0.0.0", "index": "unused"}, FakeBackend(), retriever)


def test_concurrent_rejection_and_cancel(retriever):
    class Slow(FakeBackend):
        def stream(self, messages, max_tokens, temperature, cancel):
            started.set()
            cancel.wait(5)
            yield "已取消"

    started = threading.Event()
    app = create_app(
        {"index": "unused", "allowed_hosts": ["testserver"]}, Slow(), retriever
    )
    with TestClient(app) as c:
        result = []

        def request():
            result.append(
                c.post(
                    "/v1/chat/completions",
                    json={"messages": [{"role": "user", "content": "雪乃"}]},
                )
            )

        t = threading.Thread(target=request)
        t.start()
        assert started.wait(2)
        assert (
            c.post(
                "/v1/chat/completions",
                json={"messages": [{"role": "user", "content": "雪乃"}]},
            ).status_code
            == 429
        )
        t.join(7)
        assert not t.is_alive() and result[0].status_code == 200


def test_cuda_oom_falls_back_same_backend(monkeypatch):
    import torch

    import yuki_model.backends as b

    monkeypatch.setattr(b, "detect", lambda: {"cuda": True, "mps": False})
    backend = b.TransformersBackend({"model": "unused"})
    calls = []

    def stream(*args):
        calls.append(backend.device)
        if backend.device == "cuda":
            raise torch.OutOfMemoryError("test")
        yield "CPU result"

    monkeypatch.setattr(backend, "_stream", stream)
    assert list(backend.stream([], 2, 0, threading.Event())) == ["CPU result"]
    assert calls == ["cuda", "cpu"] and backend.fallback_used


def test_most_available_cuda_device(monkeypatch):
    import yuki_model.backends as b

    monkeypatch.setattr(
        b,
        "detect",
        lambda: {
            "cuda": True,
            "mps": False,
            "gpus": [{"index": 0, "free_gib": 0.1}, {"index": 1, "free_gib": 8}],
        },
    )
    assert b.TransformersBackend({"model": "unused"}).cuda_index == 1
    assert b.TransformersBackend({"model": "unused", "cuda_index": 0}).cuda_index == 0


def test_gguf_gpu_detection(monkeypatch):
    import importlib.util
    from types import SimpleNamespace

    spec = importlib.util.spec_from_file_location(
        "launcher", Path(__file__).parents[1] / "scripts/launch_local.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(
        module.subprocess,
        "run",
        lambda *a, **k: SimpleNamespace(
            returncode=0,
            stdout="Available devices:\n  Vulkan0: AMD Radeon (8 GiB)",
            stderr="",
        ),
    )
    assert module.gpu_layers(Path("llama-server"), "auto") == [99, 14, 4, 0]
    assert module.gpu_layers(Path("llama-server"), "cpu") == [0]
    monkeypatch.setattr(
        module.subprocess,
        "run",
        lambda *a, **k: SimpleNamespace(
            returncode=0, stdout="Available devices:\n", stderr=""
        ),
    )
    assert module.gpu_layers(Path("llama-server"), "auto") == [0]
    with pytest.raises(RuntimeError):
        module.gpu_layers(Path("llama-server"), "gpu")


def test_cached_model_uses_explicit_cuda_device_in_new_request_thread(monkeypatch):
    import sys
    from types import ModuleType, SimpleNamespace

    import torch

    import yuki_model.backends as b

    monkeypatch.setattr(b, "detect", lambda: {"cuda": True, "mps": False})
    backend = b.TransformersBackend({"model": "unused", "cuda_index": 1})
    backend.model = object()  # Already loaded by the preceding request thread.
    backend.tokenizer = SimpleNamespace(apply_chat_template=lambda *a, **kw: [1, 2])
    # This test stops before GPU allocation; it does not require transformers or CUDA.
    fake_transformers = ModuleType("transformers")
    for name in ["StoppingCriteria", "StoppingCriteriaList", "TextIteratorStreamer"]:
        setattr(fake_transformers, name, object)
    monkeypatch.setitem(sys.modules, "transformers", fake_transformers)
    devices = []

    class Captured(Exception):
        pass

    def tensor(*args, **kwargs):
        devices.append(kwargs["device"])
        raise Captured()

    monkeypatch.setattr(torch, "tensor", tensor)
    errors = []

    def request():
        try:
            next(
                backend._stream(
                    [{"role": "user", "content": "q"}], 10, 0, threading.Event()
                )
            )
        except Captured:
            pass
        except BaseException as exc:
            errors.append(exc)

    worker = threading.Thread(target=request)
    worker.start()
    worker.join(2)
    assert not worker.is_alive() and not errors
    assert devices == ["cuda:1"]


@pytest.mark.parametrize(
    "build,version", [("cpu", "2.6.0"), ("cu124", "2.6.0"), ("cu128", "2.8.0")]
)
def test_windows_installer_pins_exact_compute_wheel(build, version):
    import re

    from packaging.specifiers import SpecifierSet

    script = (Path(__file__).parents[1] / "scripts/setup_windows.ps1").read_text()
    pin = re.search(r'"(torch==[^"\n]+)"', script).group(1)
    requirement = pin.replace("$torchVersion", version).replace("$build", build)
    spec = SpecifierSet(requirement.removeprefix("torch"))
    assert spec.contains(version + "+" + build)
    assert not spec.contains(version + "+" + ("cpu" if build != "cpu" else "cu124"))


def test_oom_releases_failed_request_before_cpu_reload(monkeypatch):
    import weakref

    import torch

    import yuki_model.backends as b

    monkeypatch.setattr(b, "detect", lambda: {"cuda": True, "mps": False})
    backend = b.TransformersBackend({"model": "unused"})
    refs = []

    class FailedAllocation:
        pass

    def stream(*args):
        if backend.device == "cuda":
            allocation = FailedAllocation()
            refs.append(weakref.ref(allocation))
            raise torch.OutOfMemoryError("test")
        assert refs[0]() is None, (
            "Exception traceback still retains failed GPU allocation"
        )
        yield "CPU result"

    monkeypatch.setattr(backend, "_stream", stream)
    assert list(backend.stream([], 2, 0, threading.Event())) == ["CPU result"]


def test_oom_does_not_replay_partial_response(monkeypatch):
    import torch

    import yuki_model.backends as b

    monkeypatch.setattr(b, "detect", lambda: {"cuda": True, "mps": False})
    backend = b.TransformersBackend({"model": "unused"})

    def stream(*args):
        yield "partial"
        raise torch.OutOfMemoryError("test")

    monkeypatch.setattr(backend, "_stream", stream)
    output = backend.stream([], 2, 0, threading.Event())
    assert next(output) == "partial"
    with pytest.raises(RuntimeError, match="partial responses are not replayed"):
        next(output)
    assert backend.device == "cuda" and not backend.fallback_used


@pytest.fixture
def profile_retriever(tmp_path):
    profiles = [
        ("雪之下雪乃：侍奉部部长。", 1),
        ("雪之下阳乃：雪乃的姐姐。", 2),
        ("比企谷八幡：高中生。", 1),
        ("比企谷小町：八幡的妹妹。", 3),
        ("平塚静：国文老师。", 1),
    ]
    rows = [
        dict(
            id="card" + str(i),
            text=text,
            volume=volume,
            chapter="人物卡",
            section_id="cards",
            offset=i * 10,
            split="train",
            kind="profile",
        )
        for i, (text, volume) in enumerate(profiles)
    ]
    rows += [
        dict(
            id="plot" + str(i),
            text=f"雪之下雪乃负责哪个社团，社团的排版工作，第{i}次排版。",
            volume=1,
            chapter="剧情",
            section_id=str(i),
            offset=0,
            split="train",
        )
        for i in range(35)
    ]
    save_jsonl(tmp_path / "profiles.jsonl", rows)
    index(tmp_path / "profiles.jsonl", tmp_path / "profiles.sqlite")
    return Retriever(tmp_path / "profiles.sqlite")


@pytest.mark.parametrize(
    "question,expected",
    [
        ("雪之下雪乃负责哪个社团？", "雪之下雪乃："),
        ("请介绍小雪的身份。", "雪之下雪乃："),
        ("平冢静的职业是什么？", "平塚静："),
        ("雪乃的姐姐是谁？", "雪之下阳乃："),
        ("八幡的妹妹叫什么？", "比企谷小町："),
    ],
)
def test_explicit_profile_priority(profile_retriever, question, expected):
    hits = profile_retriever.search(question)
    assert hits[0]["text"].startswith(expected)
    assert hits[0]["retrieval_reason"] == "explicit_profile"
    assert len({h["id"] for h in hits}) == len(hits)


def test_profile_priority_respects_volume(profile_retriever):
    hits = profile_retriever.search("雪乃的姐姐是谁？", max_volume=1)
    assert all(h["volume"] <= 1 for h in hits)
    assert not any(h["text"].startswith("雪之下阳乃：") for h in hits)


@pytest.mark.parametrize(
    "question", ["雪之下雪乃在2035年的职业是什么？", "分析雪之下雪乃如何管理社团。"]
)
def test_profile_priority_skips_time_and_analysis(profile_retriever, question):
    assert all(
        h.get("retrieval_reason") != "explicit_profile"
        for h in profile_retriever.search(question)
    )


def test_basic_profile_prompt_excludes_plot_snippets(profile_retriever):
    from yuki_model.server import Chat, prompt

    body = Chat(messages=[{"role": "user", "content": "雪之下雪乃负责哪个社团？"}])
    messages, hits = prompt(body, {}, profile_retriever)
    assert hits and all(h.get("kind") == "profile" for h in hits)
    assert (
        "侍奉部部长" in messages[0]["content"]
        and "排版工作" not in messages[0]["content"]
    )


@pytest.mark.parametrize("stream", [False, True])
def test_profile_answers_are_explicit_source_excerpts(profile_retriever, stream):
    class NoGeneration(FakeBackend):
        def stream(self, *args):
            raise AssertionError("Source excerpt must not invoke model")

    app = create_app(
        {"index": "unused", "allowed_hosts": ["testserver"]},
        NoGeneration(),
        profile_retriever,
    )
    with TestClient(app) as client:
        response = client.post(
            "/v1/chat/completions",
            json={
                "messages": [{"role": "user", "content": "雪之下雪乃负责哪个社团？"}],
                "stream": stream,
            },
        )
        assert response.status_code == 200
        if stream:
            events = [
                json.loads(line[6:])
                for line in response.text.splitlines()
                if line.startswith("data: ") and line[6:] != "[DONE]"
            ]
            assert (
                events[0]["answer_mode"] == "source_excerpt"
                and len(events[0]["sources"]) == 1
            )
            answer = "".join(
                e["choices"][0]["delta"].get("content", "") for e in events
            )
        else:
            event = response.json()
            assert (
                event["answer_mode"] == "source_excerpt" and len(event["sources"]) == 1
            )
            answer = event["choices"][0]["message"]["content"]
        assert answer == "雪之下雪乃：侍奉部部长。"


def test_disabling_profile_answers_calls_model(profile_retriever):
    app = create_app(
        {"index": "unused", "allowed_hosts": ["testserver"], "profile_answers": False},
        FakeBackend(),
        profile_retriever,
    )
    with TestClient(app) as client:
        event = client.post(
            "/v1/chat/completions",
            json={
                "messages": [{"role": "user", "content": "雪之下雪乃负责哪个社团？"}]
            },
        ).json()
    assert event["answer_mode"] == "model"
    assert event["choices"][0]["message"]["content"] == "测试回答"


def test_no_knowledge_bypasses_profile_extraction(profile_retriever):
    app = create_app(
        {"index": "unused", "allowed_hosts": ["testserver"]},
        FakeBackend(),
        profile_retriever,
    )
    with TestClient(app) as client:
        event = client.post(
            "/v1/chat/completions",
            json={
                "messages": [{"role": "user", "content": "雪之下雪乃负责哪个社团？"}],
                "use_knowledge": False,
            },
        ).json()
    assert event["answer_mode"] == "model" and event["sources"] == []
    assert event["choices"][0]["message"]["content"] == "测试回答"
