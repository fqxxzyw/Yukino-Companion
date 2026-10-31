"""Owned JSONL-worker adapter for installed Aqua-TTS 0.3.0.

Only call load() inside the owned inference child: Aqua configures process-wide
imports, frontend resources and CUDA state. Importing this module does none of
that. The pinned upstream inferencer supports streaming, but this adapter only
delivers complete WAV replies and never advertises streaming or native batches.
"""
from __future__ import annotations

import base64
import contextlib
import gc
import importlib.metadata
import importlib.util
import io
import logging
import math
import numbers
import os
from pathlib import Path
import re
import sys
import time

AQUA_VERSION = "0.3.0"
SUPPORTED_MODELS = frozenset({"v2", "v2Pro", "v2ProPlus", "v3"})
PROMPT_LANGUAGES = {"ja": "日文", "all_ja": "日文", "zh": "中文", "all_zh": "中文", "en": "英文"}
GRAPH_PRESETS = frozenset({"lazy", "off", "minimal", "full"})
MIN_VRAM = 6 * 2**30
MIN_FREE_VRAM = 2 * 2**30


def _worker_helpers():
    """Reuse the running worker, including when its module name is __main__."""
    worker_path = Path(__file__).with_name("worker.py").resolve()
    for name in ("__main__", "inference.worker", "worker", "_aqua_worker_helpers"):
        module = sys.modules.get(name)
        source = getattr(module, "__file__", None)
        if source and Path(source).resolve() == worker_path:
            return module
    spec = importlib.util.spec_from_file_location("_aqua_worker_helpers", worker_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    sys.modules[spec.name] = module
    return module


@contextlib.contextmanager
def _quiet_runtime():
    # Upstream logs target/reference text, including at INFO and in tracebacks.
    # No raw runtime diagnostics cross this privacy boundary. The JSONL worker
    # owns this process and serializes tasks, so this scope cannot hide a peer's
    # inference logs. Restore logging even when construction/inference fails.
    previous = logging.root.manager.disable
    with open(os.devnull, "w", encoding="utf-8") as sink:
        logging.disable(logging.CRITICAL)
        try:
            with contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
                yield
        finally:
            logging.disable(previous)


def _clear_cuda(torch):
    gc.collect()
    try:
        torch.cuda.empty_cache()
    except Exception:
        pass


class _AdapterValidationError(ValueError):
    """Only adapter-authored messages may cross the runtime privacy boundary."""


def _runtime_error(stage, oom=False):
    code = "AQUA_LOAD" if stage == "加载" else "AQUA_INFER"
    if oom:
        return RuntimeError(f"[{code}_OOM] Aqua {stage}显存不足；请关闭其他 GPU 模型或选择 standard 引擎。")
    return RuntimeError(
        f"[{code}_FAILED] Aqua {stage}失败；请检查当前安装的本地模型、离线前端资源与 CUDA 运行环境。"
        "运行库原始诊断已隐藏，以免记录参考文本或合成文本。"
    )


class AquaEngine:
    def __init__(self):
        self.pipeline = None
        self.cfg = None
        self.metadata = {}

    def load(self, config):
        started = time.perf_counter()
        helpers = _worker_helpers()
        cfg = helpers.validate_config(config)
        if cfg.get("engine", "auto") not in {"auto", "aqua"}:
            raise ValueError("Aqua 适配器只接受 auto 或 aqua 引擎选择")
        if cfg["version"] not in SUPPORTED_MODELS:
            raise ValueError("Aqua 仅支持 v2/v2Pro/v2ProPlus/v3；其他版本请选择 standard 引擎。")
        if cfg["device"] == "cpu":
            raise ValueError("Aqua 只支持 CUDA，不会模拟 CPU 推理；CPU 请选择 standard 引擎。")
        if cfg["promptLang"] not in PROMPT_LANGUAGES:
            raise ValueError("Aqua 参考音频语言仅支持 ja/all_ja、zh/all_zh 或 en")
        graph = cfg.get("aquaGraph", "lazy")
        if graph not in GRAPH_PRESETS:
            raise ValueError("Aqua Graph 必须为 lazy、off、minimal 或 full")
        optional = {}
        for field, argument, directory in (
            ("aquaSovitsBase", "sovits_pretrain_path", False),
            ("aquaBigvgan", "bigvgan_path", True),
            ("aquaSpeaker", "sv_model_path", False),
            ("aquaLangdetect", "fast_langdetect_path", True),
        ):
            if cfg.get(field):
                optional[argument] = helpers.require_path(cfg[field], field, directory)
        try:
            installed_version = importlib.metadata.version("aqua-tts")
        except importlib.metadata.PackageNotFoundError:
            raise RuntimeError("所选 Aqua Python 未安装 aqua-tts==0.3.0；不会自动安装或下载。") from None
        if installed_version != AQUA_VERSION:
            raise RuntimeError("Aqua 需要已安装的 aqua-tts==0.3.0；当前环境版本不匹配。")

        self.pipeline = None
        self.cfg = None
        self.metadata = {}
        # These are confined to the owned child, never the app process. Defaults
        # for optional resources remain under this explicitly selected root.
        os.environ.update(GPT_SOVITS_HOME=cfg["root"], bert_path=cfg["bert"],
                          HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1",
                          HF_DATASETS_OFFLINE="1", ORT_DISABLE_TELEMETRY="1", G2PW="0")
        # Upstream environment overrides would otherwise defeat lazy/off and the
        # one-time OOM retry. Use the explicitly selected named preset instead.
        for key in ("ENABLE_CUDA_GRAPH", "ENABLE_CUDA_GRAPH_PRECAPTURE", "CUDA_GRAPH_PRECAPTURE_BUCKETS"):
            os.environ.pop(key, None)
        runtime = Path(cfg["root"]) / "runtime"
        os.environ["PATH"] = str(runtime) + os.pathsep + os.environ.get("PATH", "")
        nltk_data = Path(sys.executable).parent / "nltk_data"
        os.environ["NLTK_DATA"] = str(nltk_data if nltk_data.is_dir() else runtime / "nltk_data")
        os.chdir(cfg["root"])

        import torch
        self.torch = torch
        torch.set_num_threads(max(1, min(int(cfg.get("cpuThreads", 4)), os.cpu_count() or 1)))
        info = helpers.device_info(torch)  # Includes a real CUDA allocation/kernel/readback.
        if not info["cudaAvailable"]:
            raise RuntimeError("Aqua CUDA 实际计算测试失败；不支持 CPU 回退，请检查驱动或选择 standard 引擎。")
        _clear_cuda(torch)
        try:
            total = torch.cuda.get_device_properties(0).total_memory
            free, _ = torch.cuda.mem_get_info("cuda:0")
        except Exception:
            raise RuntimeError("Aqua 无法读取实际 CUDA 显存，拒绝未经验证的 GPU 加载。") from None
        if total < MIN_VRAM or free < MIN_FREE_VRAM:
            raise RuntimeError(
                f"Aqua 保守显存门槛为显卡总容量至少 6 GiB、当前空闲至少 2 GiB；"
                f"当前总容量 {total / 2**30:.2f} GiB、空闲 {free / 2**30:.2f} GiB。"
                "这仅是加载门槛，不保证模型可装入；请释放显存或选择 standard 引擎。"
            )
        import soundfile as sf
        self.sf = sf
        duration = float(sf.info(cfg["reference"]).duration)
        if not math.isfinite(duration) or not 3 <= duration <= 10:
            raise ValueError("Aqua 参考音频需为 3–10 秒；建议使用干净的 WAV。")
        self.max_audio = helpers.MAX_AUDIO
        torch.cuda.reset_peak_memory_stats("cuda:0")
        # Import only after version, actual CUDA, local paths and environment
        # checks. Never import the downloaded review copy or start its server.
        with _quiet_runtime():
            from aquatts import TTSInferencer
        arguments = dict(device="cuda:0", gpt_path=cfg["gpt"], sovits_path=cfg["sovits"],
                         bert_path=cfg["bert"], cnhubert_path=cfg["hubert"],
                         language="Auto", offline_only=True, **optional)
        pipeline = None
        presets = [graph] if graph == "off" else [graph, "off"]
        retried = False
        for index, preset in enumerate(presets):
            failed = False
            try:
                with _quiet_runtime(), torch.inference_mode():
                    pipeline = TTSInferencer(cuda_graph_preset=preset, **arguments)
                    actual = getattr(pipeline, "model_version", None)
                    if actual not in SUPPORTED_MODELS or actual != cfg["version"]:
                        raise _AdapterValidationError("Aqua 检测到的模型架构不支持或与声明版本不一致；未转换权重。")
                    if str(pipeline.device) not in {"cuda", "cuda:0"} or not pipeline.is_half:
                        raise _AdapterValidationError("Aqua 未实际加载到 CUDA 半精度设备，拒绝伪装 GPU 推理。")
                    reference = pipeline.warm_reference_cache(
                        cfg["reference"], cfg["promptText"], PROMPT_LANGUAGES[cfg["promptLang"]], strict=True)
                    if not isinstance(reference, dict) or reference.get("ready") is not True:
                        raise _AdapterValidationError("Aqua 参考缓存预热未就绪")
                    torch.cuda.synchronize("cuda:0")
            except Exception as exc:
                failed = True
                oom = helpers.is_oom(exc)
                # Only our own validation messages are safe to expose. Upstream
                # exceptions can embed reference/target text or model secrets.
                safe_validation = str(exc) if isinstance(exc, _AdapterValidationError) else None
            if not failed:
                break
            # Outside except: its traceback (and partially built CUDA objects)
            # must be released before garbage collection and the single retry.
            pipeline = None
            _clear_cuda(torch)
            if oom and index == 0 and graph != "off":
                retried = True
                continue
            if safe_validation:
                raise ValueError(safe_validation) from None
            raise _runtime_error("加载", oom) from None

        self.pipeline, self.cfg = pipeline, cfg
        self.metadata = {
            **info, "engine": "aqua", "engineVersion": installed_version,
            "modelVersion": pipeline.model_version, "version": pipeline.model_version,
            "device": str(pipeline.device), "half": bool(pipeline.is_half),
            "cpuThreads": torch.get_num_threads(), "cpuFallback": False,
            "aquaGraph": preset, "aquaGraphRequested": graph, "graphOomRetry": retried,
            "capabilities": {"maxConcurrentTasks": 1, "nativeBatch": False, "audioStreaming": False},
            "audioStreaming": False,
            "referenceSeconds": round(duration, 3),
            "referenceCache": {"status": reference.get("status"), "ready": True,
                               "residentCount": reference.get("resident_count")},
            "loadSeconds": round(time.perf_counter() - started, 6),
            "rtf": None, "audioDuration": None,
            "vramPeakBytes": int(torch.cuda.max_memory_allocated("cuda:0")),
        }
        return self.metadata

    def synthesize_batch(self, texts, speed):
        if not isinstance(texts, list) or len(texts) != 1:
            raise ValueError("Aqua 不支持原生批推理；每次仅接受一句，不拼接或伪装批处理。")
        return self.synthesize(texts[0], speed)

    def synthesize(self, text, speed):
        if self.pipeline is None:
            raise RuntimeError("语音模型尚未加载")
        if not isinstance(text, str) or not text.strip() or len(text) > 500:
            raise ValueError("单段语音文本必须为 1–500 字符")
        if not re.search(r"[ぁ-ゖァ-ヺｦ-ﾝ]", text):
            raise ValueError("语音仅接受包含假名的完整日语译文，未翻译的中文不会合成。")
        if isinstance(speed, bool):
            raise ValueError("语速必须为 0.5–2.0")
        speed = float(speed)
        if not math.isfinite(speed) or not 0.5 <= speed <= 2:
            raise ValueError("语速必须为 0.5–2.0")
        cfg = self.cfg
        started = time.perf_counter()
        try:
            with _quiet_runtime(), self.torch.inference_mode():
                result = self.pipeline.infer(
                    text=text, ref_audio_path=cfg["reference"], prompt_text=cfg["promptText"],
                    text_language="日文", prompt_language=PROMPT_LANGUAGES[cfg["promptLang"]],
                    how_to_cut="按标点符号切", speed=speed, ref_free=False, if_sr=False,
                    enable_cuda_graph=self.metadata["aquaGraph"] != "off", enable_static_kv=True)
                self.torch.cuda.synchronize("cuda:0")
        except Exception as exc:
            # No per-sentence reload/retry, including lazy graph capture OOMs.
            oom = _worker_helpers().is_oom(exc)
            raise _runtime_error("推理", oom) from None
        elapsed = time.perf_counter() - started
        # Defend against upstream versions that swallow inference errors and
        # return None, not just implementations that raise exceptions.
        if not isinstance(result, (tuple, list)) or len(result) != 2:
            raise RuntimeError("Aqua 推理未返回有效音频")
        rate, audio = result
        if isinstance(rate, bool) or not isinstance(rate, numbers.Integral) or not 8000 <= rate <= 192000:
            raise RuntimeError("Aqua 推理返回无效采样率")
        import numpy as np
        audio = np.asarray(audio)
        if audio.ndim != 1 or audio.size == 0 or audio.dtype.kind != "f":
            raise RuntimeError("Aqua 推理必须返回非空单声道浮点音频")
        if audio.nbytes > self.max_audio or audio.size * 2 + 44 > self.max_audio:
            raise RuntimeError("单段音频过大，请缩短文本")
        if not np.isfinite(audio).all() or float(np.max(np.abs(audio))) > 1:
            raise RuntimeError("Aqua 推理返回非有限数值或超出 [-1, 1] 的音频")
        # SoundFile does not accept the float16 dtype produced by some runtimes.
        audio = audio.astype(np.float32, copy=False)
        buffer = io.BytesIO()
        self.sf.write(buffer, audio, int(rate), format="WAV", subtype="PCM_16")
        wav = buffer.getvalue()
        if not wav or len(wav) > self.max_audio:
            raise RuntimeError("Aqua WAV 输出为空或过大，请缩短文本")
        duration = audio.size / int(rate)
        metrics = {"audioDuration": round(duration, 6), "inferenceSeconds": round(elapsed, 6),
                   "rtf": round(elapsed / duration, 6),
                   "vramPeakBytes": int(self.torch.cuda.max_memory_allocated("cuda:0")),
                   "batchSize": 1, "parallelInference": False}
        return {"audio": base64.b64encode(wav).decode("ascii"), "metadata": {**self.metadata, **metrics}}
