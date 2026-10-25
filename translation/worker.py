"""Offline Chinese → Japanese translation. Owned JSONL subprocess; no HTTP server."""
from __future__ import annotations
import contextlib
import ctypes
import gc
import hashlib
import json
import os
from pathlib import Path
import re
import sys

MODEL_ID = "tencent/Hy-MT2-1.8B-GGUF"
MAX_INPUT = 20000
_DLL_HANDLES = []


def prepare_windows_dlls():
    """Use the application's packaged CUDA DLLs without requiring CUDA_PATH."""
    if sys.platform != "win32" or not hasattr(os, "add_dll_directory"):
        return
    candidates = [Path(sys.prefix) / "Lib/site-packages/torch/lib",
                  Path(sys.executable).parent / "Lib/site-packages/torch/lib",
                  Path(sys.executable).parent]
    for directory in dict.fromkeys(candidates):
        if directory.is_dir():
            _DLL_HANDLES.append(os.add_dll_directory(str(directory.resolve())))


def validate_config(config):
    cfg = dict(config)
    path = Path(cfg.get("modelDir", ""))
    if not cfg.get("modelDir") or not path.is_absolute() or not path.is_dir():
        raise ValueError("本地翻译模型不存在，请先安装中日翻译资源。")
    cfg["modelDir"] = str(path.resolve())
    if cfg.get("device", "auto") not in {"auto", "cpu", "cuda"}:
        raise ValueError("翻译设备必须是 auto、cpu 或 cuda")
    threads = cfg.get("cpuThreads", 4)
    if isinstance(threads, bool) or not isinstance(threads, int) or not 1 <= threads <= 32:
        raise ValueError("翻译 CPU 线程数必须在 1–32 之间")
    return cfg


def verify_model(directory, manifest):
    """Only fixed, verified official tensor/tokenizer files are loaded, never remote code."""
    directory = Path(directory)
    for item in manifest["files"]:
        file = directory / item["path"]
        if not file.is_file() or file.stat().st_size != item["size"]:
            raise ValueError(f"翻译模型缺少或大小不符：{item['path']}，请重新安装资源。")
        digest = hashlib.sha256()
        with file.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        if digest.hexdigest() != item["sha256"]:
            raise ValueError(f"翻译模型校验失败：{item['path']}，请重新安装资源。")


def split_text(text, tokenizer, limit=384):
    """Bounded sentence chunks without dropping source characters or truncating tokens."""
    parts = re.findall(r"[^。！？!?\n]+[。！？!?\n]*|[。！？!?\n]+", text)
    result = []
    def add(part):
        if not part.strip():
            return
        ids = tokenizer(part, add_special_tokens=True)["input_ids"]
        if len(ids) <= limit and len(part) <= 500:
            result.append(part)
        elif len(part) < 2:
            raise ValueError("单个字符超过翻译模型输入限制")
        else:
            # Split by Unicode characters, not encoded tokens, preserving source fidelity.
            mid = len(part) // 2
            add(part[:mid]); add(part[mid:])
    for part in parts:
        add(part)
    return result


def choose_device(llama_cpp, requested):
    available = bool(llama_cpp.llama_supports_gpu_offload())
    if requested == "cuda" and not available:
        raise RuntimeError("当前翻译运行库没有可用的 GPU。请选择自动/CPU，或安装带 CUDA 的翻译运行库。")
    return "gpu" if requested != "cpu" and available else "cpu"


GLOSSARY = {"雪之下雪乃": "雪ノ下雪乃", "雪乃": "雪乃", "比企谷八幡": "比企谷八幡", "由比滨结衣": "由比ヶ浜結衣", "奉仕部": "奉仕部"}


def make_prompt(text):
    terms = [f"{source} → {target}" for source, target in GLOSSARY.items() if source in text]
    prefix = "参考下面的专有名词翻译：\n" + "\n".join(terms) + "\n\n" if terms else ""
    return prefix + "将以下文本准确翻译为日语。保留原意、否定、条件、数字和货币单位，保留说话者的口吻。只输出译文，不要额外解释：\n\n" + text


class Engine:
    def __init__(self):
        self.model = None
        self.cfg = None
        self.metadata = {}

    def load(self, config):
        cfg = validate_config(config)
        manifest = json.loads(Path(__file__).with_name("model-manifest.json").read_text(encoding="utf-8"))
        verify_model(cfg["modelDir"], manifest)
        prepare_windows_dlls()
        import llama_cpp
        self.llama_cpp = llama_cpp
        self.cfg = cfg
        device = choose_device(llama_cpp, cfg.get("device", "auto"))
        try:
            device = self._load_model(device)
        except Exception:
            if device == "cpu" or not cfg.get("cpuFallback", True):
                raise
            self._load_model("cpu")
            device = "cpu"
        self.metadata = {"model": MODEL_ID, "revision": manifest["revision"], "device": device,
                         "runtime": "llama-cpp-python " + llama_cpp.__version__, "quantization": "Q4_K_M", "offloadedLayers": self.offloaded_layers, "source": "zh", "target": "ja"}
        return self.metadata

    def _load_model(self, device):
        if self.model is not None:
            self.model.close()
            self.model = None
            gc.collect()
        self.offloaded_layers = 0
        self._log_buffer = ""
        # Availability alone is not proof of offload. Read the exact loader's
        # reported layer count so silently falling back never claims GPU use.
        @self.llama_cpp.llama_log_callback
        def log_callback(level, text, _user_data):
            try:
                message = text.decode("utf-8", errors="replace")
                self._log_buffer = (self._log_buffer + message)[-2000:]
                match = re.search(r"offloaded (\d+)/\d+ layers to GPU", self._log_buffer)
                if match:
                    self.offloaded_layers = int(match.group(1))
                if level == 4:  # GGML_LOG_LEVEL_ERROR; avoid printing debug/prompt diagnostics
                    print(message[:500], end="", file=sys.stderr)
            except Exception:
                pass
        self._log_callback = log_callback
        self.llama_cpp.llama_log_set(log_callback, ctypes.c_void_p(0))
        self.model = self.llama_cpp.Llama(
            model_path=str(Path(self.cfg["modelDir"]) / "Hy-MT2-1.8B-Q4_K_M.gguf"),
            n_ctx=2048, n_batch=256, n_threads=min(self.cfg.get("cpuThreads", 4), os.cpu_count() or 1),
            n_gpu_layers=-1 if device == "gpu" else 0, verbose=False, seed=42,
        )
        return "gpu" if self.offloaded_layers > 0 else "cpu"

    def translate(self, text, source="zh", target="ja"):
        if self.model is None:
            raise RuntimeError("翻译模型尚未加载")
        if source != "zh" or target != "ja":
            raise ValueError("内置翻译通道仅开放中文 → 日语")
        if not isinstance(text, str) or not text.strip() or len(text) > MAX_INPUT:
            raise ValueError("待翻译文本需为 1–20000 个字符")
        def tokenize(part, **_):
            return {"input_ids": self.model.tokenize(part.encode("utf-8"), add_bos=False)}
        segments = []
        for part in split_text(text, tokenize, limit=384):
            try:
                translated = self._generate(part)
            except Exception as exc:
                if self.metadata["device"] != "gpu" or not self.cfg.get("cpuFallback", True) or not any(term in str(exc).lower() for term in ["out of memory", "alloc", "cuda"]):
                    raise
                self._load_model("cpu")
                self.metadata["device"] = "cpu"
                self.metadata["offloadedLayers"] = 0
                self.metadata["fallback"] = "gpu-memory"
                translated = self._generate(part)
            segments.append({"sourceText": part, "text": translated})
        return {**self.metadata, "text": "\n".join(item["text"] for item in segments), "segments": segments}

    def _generate(self, text):
        prompt = make_prompt(text)
        result = self.model.create_chat_completion(
            messages=[{"role": "user", "content": prompt}], max_tokens=768,
            temperature=0, top_p=0.6, top_k=20, repeat_penalty=1.05,
        )
        choice = result["choices"][0]
        if choice.get("finish_reason") != "stop":
            raise RuntimeError("翻译超过输出限制；不会朗读不完整内容")
        translated = choice["message"].get("content", "").strip()
        if not translated or not re.search(r"[\u3040-\u30ff]", translated):
            raise RuntimeError("翻译未返回可确认的日文；不会将中文交给日语语音合成")
        if re.search(r"<\|[^>]+\|>|</?think>", translated):
            raise RuntimeError("翻译输出含模型控制标记，请重试")
        return translated


def main():
    engine = Engine()
    protocol = sys.stdout
    for raw in sys.stdin:
        request = {}
        try:
            if len(raw) > 100000:
                raise ValueError("翻译请求过大")
            request = json.loads(raw)
            if not isinstance(request, dict):
                raise ValueError("无效翻译请求")
            with contextlib.redirect_stdout(sys.stderr):
                if request.get("method") == "load":
                    result = engine.load(request["config"])
                elif request.get("method") == "translate":
                    result = engine.translate(request.get("text"), request.get("source", "zh"), request.get("target", "ja"))
                else:
                    raise ValueError("未知翻译操作")
            response = {"id": request.get("id"), "ok": True, "result": result}
        except Exception as exc:
            response = {"id": request.get("id") if isinstance(request, dict) else None, "ok": False, "error": str(exc)[:1200]}
        protocol.write(json.dumps(response, ensure_ascii=False) + "\n")
        protocol.flush()


if __name__ == "__main__":
    main()
