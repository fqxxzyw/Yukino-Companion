"""Real trained-model HTTP/SSE/cancellation test; run after training."""

import json
import socket
import threading
import time
from pathlib import Path

import httpx
import uvicorn

from yuki_model.io import save_json
from yuki_model.server import create_app


def main():
    config = json.loads(Path("configs/serve.json").read_text())
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    server = uvicorn.Server(
        uvicorn.Config(
            create_app(config), host="127.0.0.1", port=port, log_level="error"
        )
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{port}"
    results = []
    try:
        with httpx.Client(base_url=base, timeout=180, trust_env=False) as client:
            for _ in range(100):
                try:
                    if client.get("/health").status_code == 200:
                        break
                except httpx.HTTPError:
                    pass
                time.sleep(0.1)
            checks = [
                ("雪乃的姐姐是谁？", ["阳乃"]),
                ("八幡的妹妹叫什么？", ["小町"]),
                ("雪之下雪乃负责哪个社团？", ["侍奉"]),
                ("户冢彩加参加哪种运动的社团？", ["网球"]),
                ("平冢静的职业是什么？", ["老师", "教师"]),
                (
                    "原作明确公布雪乃2035年的职业了吗？",
                    ["无法", "没有", "未", "不确定"],
                ),
            ]
            for question, expected in checks:
                answer = ""
                sources = []
                answer_mode = None
                done = False
                start = time.monotonic()
                with client.stream(
                    "POST",
                    "/v1/chat/completions",
                    json={
                        "messages": [{"role": "user", "content": question}],
                        "stream": True,
                        "temperature": 0,
                        "max_tokens": 96,
                    },
                ) as r:
                    r.raise_for_status()
                    for line in r.iter_lines():
                        if not line.startswith("data: "):
                            continue
                        raw = line[6:]
                        if raw == "[DONE]":
                            done = True
                            break
                        event = json.loads(raw)
                        if "error" in event:
                            raise RuntimeError(event["error"])
                        sources = event.get("sources", sources)
                        answer_mode = event.get("answer_mode", answer_mode)
                        answer += event["choices"][0]["delta"].get("content", "")
                result = {
                    "question": question,
                    "answer": answer,
                    "sources": len(sources),
                    "answer_mode": answer_mode,
                    "transport_complete": done,
                    "keyword_check": any(x in answer for x in expected),
                    "seconds": round(time.monotonic() - start, 2),
                }
                results.append(result)
                print(json.dumps(result, ensure_ascii=False), flush=True)
            cancelled = False
            cancellation_mode = None
            with client.stream(
                "POST",
                "/v1/chat/completions",
                json={
                    "messages": [
                        {
                            "role": "user",
                            "content": "请写一篇至少八百字的学习计划，分十步解释如何学习一门新知识，每步给出例子。",
                        }
                    ],
                    "use_knowledge": False,
                    "stream": True,
                    "max_tokens": 384,
                },
            ) as r:
                r.raise_for_status()
                rid = r.headers["x-request-id"]
                for line in r.iter_lines():
                    if not line.startswith("data: ") or line[6:] == "[DONE]":
                        continue
                    event = json.loads(line[6:])
                    if "error" in event:
                        raise RuntimeError(event["error"])
                    cancellation_mode = event.get("answer_mode", cancellation_mode)
                    if event.get("choices", [{}])[0].get("delta", {}).get("content"):
                        assert cancellation_mode == "model", (
                            "Cancellation must exercise model generation"
                        )
                        with httpx.Client(
                            base_url=base, timeout=30, trust_env=False
                        ) as cancel:
                            response = cancel.delete("/v1/requests/" + rid)
                            assert response.status_code == 200, response.text
                            cancelled = True
                        break
            assert cancelled, "No generated content was cancelled"
            for _ in range(100):
                health = client.get("/health").json()
                if not health["busy"]:
                    break
                time.sleep(0.1)
            assert not health["busy"], "Cancellation did not release generation slot"
            result = {
                "real_model": True,
                "results": results,
                "cancellation": cancelled,
                "cancellation_answer_mode": cancellation_mode,
                "hardware": health,
                "note": "Source-excerpt answers are direct retrieval, not learned model accuracy. Other keyword checks are small development probes, not independent benchmarks.",
            }
            save_json("reports/integration.json", result)
    finally:
        server.should_exit = True
        thread.join(15)


if __name__ == "__main__":
    main()
