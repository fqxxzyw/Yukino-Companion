import gc
import json
import threading
from pathlib import Path
from urllib.parse import urlparse

import httpx

from .hardware import detect, device


class TransformersBackend:
    def __init__(self, c):
        self.c = c
        self.info = detect()
        self.device = device(self.info, c.get("device", "auto"))
        self.model = None
        self.tokenizer = None
        self.fallback_used = False
        gpus = self.info.get("gpus", [])
        self.cuda_index = c.get(
            "cuda_index", max(gpus, key=lambda g: g["free_gib"])["index"] if gpus else 0
        )

    @property
    def target_device(self):
        return f"cuda:{self.cuda_index}" if self.device == "cuda" else self.device

    def load(self):
        if self.model is not None:
            return
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer

        torch.set_num_threads(self.c.get("threads", 4))
        if self.device == "cuda":
            torch.cuda.set_device(self.cuda_index)
        kw = {
            "trust_remote_code": False,
            "local_files_only": self.c.get("local_files_only", True),
        }
        if not Path(self.c["model"]).is_dir():
            kw["revision"] = self.c.get("revision")
        tokenizer = AutoTokenizer.from_pretrained(self.c["model"], **kw)
        dtype = (
            torch.bfloat16
            if self.device == "cuda"
            and torch.cuda.is_bf16_supported()
            or self.device == "cpu"
            and self.info["native_cpu_bf16"]
            else torch.float32
            if self.device == "cpu"
            else torch.float16
        )
        model = AutoModelForCausalLM.from_pretrained(
            self.c["model"], torch_dtype=dtype, low_cpu_mem_usage=True, **kw
        )
        if self.c.get("adapter"):
            from peft import PeftModel

            model = PeftModel.from_pretrained(
                model, self.c["adapter"], local_files_only=True
            )
        model.to(self.target_device).eval()
        self.model = model
        self.tokenizer = tokenizer

    def status(self):
        return {
            "loaded": self.model is not None,
            "device": self.device,
            "cuda_index": self.cuda_index if self.device == "cuda" else None,
            "cpu_fallback_used": self.fallback_used,
        }

    def to_cpu(self):
        import torch

        self.model = None
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        self.device = "cpu"
        self.fallback_used = True

    def _stream(self, messages, max_tokens, temperature, cancel):
        from queue import Empty

        import torch
        from transformers import (
            StoppingCriteria,
            StoppingCriteriaList,
            TextIteratorStreamer,
        )

        self.load()
        messages = [dict(x) for x in messages]
        budget = self.c.get("context_tokens", 4096) - max_tokens

        def tokenize():
            return self.tokenizer.apply_chat_template(
                messages, tokenize=True, add_generation_prompt=True
            )

        ids = tokenize()
        while len(ids) > budget and len(messages) > 2:
            del messages[1]
            if len(messages) > 2 and messages[1]["role"] == "assistant":
                del messages[1]
            ids = tokenize()
        if len(ids) > budget:
            raise ValueError("Prompt too long; shorten question or evidence")
        ids = torch.tensor([ids], device=self.target_device)

        class Cancel(StoppingCriteria):
            def __call__(self, input_ids, scores, **kw):
                return cancel.is_set()

        streamer = TextIteratorStreamer(
            self.tokenizer, skip_prompt=True, skip_special_tokens=True, timeout=1
        )
        errors = []
        done = threading.Event()

        def generate():
            try:
                with torch.inference_mode():
                    kw = {
                        "input_ids": ids,
                        "attention_mask": torch.ones_like(ids),
                        "streamer": streamer,
                        "max_new_tokens": max_tokens,
                        "do_sample": temperature > 0,
                        "pad_token_id": self.tokenizer.eos_token_id,
                        "stopping_criteria": StoppingCriteriaList([Cancel()]),
                    }
                    if temperature > 0:
                        kw.update(temperature=temperature, top_p=0.9)
                    self.model.generate(**kw)
            except BaseException as e:
                errors.append(e)
                streamer.end()
            finally:
                done.set()

        thread = threading.Thread(target=generate, daemon=True)
        thread.start()
        exhausted = False
        try:
            while True:
                try:
                    piece = next(streamer)
                except Empty:
                    if done.is_set():
                        exhausted = True
                        break
                    continue
                except StopIteration:
                    exhausted = True
                    break
                if piece and not cancel.is_set():
                    yield piece
            if errors:
                raise errors[0]
        finally:
            if not exhausted and not done.is_set():
                cancel.set()
            thread.join()

    def stream(self, messages, max_tokens, temperature, cancel):
        import torch

        emitted = False
        fallback = False
        try:
            for piece in self._stream(messages, max_tokens, temperature, cancel):
                emitted = True
                yield piece
        except torch.OutOfMemoryError:
            if self.device == "cpu" or emitted or not self.c.get("cpu_fallback", True):
                raise RuntimeError(
                    "Out of memory. Reduce context or use GGUF; partial responses are not replayed."
                )
            fallback = True
        # Leave the exception scope so its traceback can release failed GPU tensors.
        if fallback:
            self.to_cpu()
            if not cancel.is_set():
                yield from self._stream(messages, max_tokens, temperature, cancel)


class LlamaBackend:
    def __init__(self, c):
        self.c = c
        self.url = c.get("llama_url", "http://127.0.0.1:8081/v1").rstrip("/")
        u = urlparse(self.url)
        if (
            u.scheme not in {"http", "https"}
            or u.username
            or u.password
            or u.query
            or u.fragment
        ):
            raise ValueError("Invalid llama-server URL")
        if u.scheme == "http" and u.hostname not in {"127.0.0.1", "localhost", "::1"}:
            raise ValueError("Remote endpoint requires HTTPS")

    def status(self):
        ready = False
        try:
            with httpx.Client(timeout=2, trust_env=False) as c:
                ready = (
                    c.get(self.url.removesuffix("/v1") + "/health").status_code == 200
                )
        except httpx.HTTPError:
            pass
        return {
            "loaded": ready,
            "device": self.c.get("runtime_device", "managed-by-llama-server"),
            "cpu_fallback_used": self.c.get("cpu_fallback_used", False),
        }

    def stream(self, messages, max_tokens, temperature, cancel):
        with httpx.Client(
            timeout=httpx.Timeout(180, connect=10), trust_env=False
        ) as client:
            with client.stream(
                "POST",
                self.url + "/chat/completions",
                json={
                    "model": "oregairu-small",
                    "messages": messages,
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                    "stream": True,
                },
            ) as r:
                r.raise_for_status()
                for line in r.iter_lines():
                    if cancel.is_set():
                        return
                    if not line.startswith("data:"):
                        continue
                    text = line[5:].strip()
                    if text == "[DONE]":
                        return
                    event = json.loads(text)
                    choices = event.get("choices", [])
                    if choices and choices[0].get("delta", {}).get("content"):
                        yield choices[0]["delta"]["content"]


def backend(c):
    if c.get("backend", "transformers") == "transformers":
        return TransformersBackend(c)
    if c["backend"] == "llama-server":
        return LlamaBackend(c)
    raise ValueError("Unknown backend")
