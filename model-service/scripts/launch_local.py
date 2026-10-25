"""Optional GGUF launcher. Probe actual llama.cpp devices, then prefer GPU."""

import argparse
import json
import re
import socket
import subprocess
import time
from pathlib import Path

import httpx


def gpu_layers(binary, requested):
    if requested == "cpu":
        return [0]
    probe = subprocess.run(
        [str(binary), "--list-devices"], capture_output=True, text=True, timeout=30
    )
    available = probe.returncode == 0 and bool(
        re.search(
            r"^\s*(?:CUDA|Vulkan|Metal|SYCL|ROCm|HIP)\d*\s*:",
            probe.stdout + "\n" + probe.stderr,
            re.M | re.I,
        )
    )
    if requested == "gpu" and not available:
        raise RuntimeError("No GPU backend detected in this llama-server build")
    return [99, 14, 4, 0] if available else [0]


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--llama-server", required=True, type=Path)
    p.add_argument("--model", required=True, type=Path)
    p.add_argument("--device", choices=["auto", "cpu", "gpu"], default="auto")
    p.add_argument("--config", default="configs/serve-gguf.json")
    a = p.parse_args()
    binary = a.llama_server.resolve()
    model = a.model.resolve()
    if not binary.is_file() or not model.is_file():
        p.error("llama-server and GGUF paths must exist")
    config = json.loads(Path(a.config).read_text(encoding="utf-8-sig"))
    Path("logs").mkdir(exist_ok=True)
    child = None
    try:
        choices = gpu_layers(binary, a.device)
        for layers in choices:
            port = free_port()
            with open("logs/llama-server.log", "ab") as log:
                child = subprocess.Popen(
                    [
                        str(binary),
                        "-m",
                        str(model),
                        "--host",
                        "127.0.0.1",
                        "--port",
                        str(port),
                        "-c",
                        "4096",
                        "-ngl",
                        str(layers),
                        "--parallel",
                        "1",
                        "--alias",
                        "oregairu-small",
                    ],
                    stdout=log,
                    stderr=subprocess.STDOUT,
                )
            ready = False
            with httpx.Client(timeout=2, trust_env=False) as client:
                deadline = time.monotonic() + 240
                while child.poll() is None and time.monotonic() < deadline:
                    try:
                        if (
                            client.get(f"http://127.0.0.1:{port}/health").status_code
                            == 200
                        ):
                            ready = True
                            break
                    except httpx.HTTPError:
                        pass
                    time.sleep(0.5)
            if ready:
                config.update(
                    llama_url=f"http://127.0.0.1:{port}/v1",
                    runtime_device="cpu" if layers == 0 else f"gpu-offload-{layers}",
                    cpu_fallback_used=layers == 0 and choices[0] != 0,
                )
                break
            if child.poll() is None:
                child.terminate()
                child.wait(timeout=15)
        if not ready:
            raise RuntimeError("Model startup failed; inspect logs/llama-server.log")
        import uvicorn

        from yuki_model.server import create_app

        uvicorn.run(
            create_app(config),
            host=config.get("host", "127.0.0.1"),
            port=config.get("port", 8765),
        )
    finally:
        if child is not None and child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=15)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()


if __name__ == "__main__":
    main()
