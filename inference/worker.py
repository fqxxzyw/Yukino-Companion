"""Owned, inference-only GPT-SoVITS worker. JSONL on stdout, diagnostics on stderr.

Imports the upstream TTS engine; never starts a WebUI, trainer or HTTP server.
All model/audio paths belong to the user's local machine.
"""
from __future__ import annotations
import base64
import contextlib
import gc
import io
import json
import os
# ORT 1.31+ official native builds initialize 1DS during indirect imports.
# Set the full opt-out before any third-party module (e.g. Lightning) loads;
# disable_telemetry_events() alone can run after an initialization event.
os.environ["ORT_DISABLE_TELEMETRY"] = "1"
import re
from pathlib import Path
import shutil
import sys
import traceback

VERSIONS = {"v1", "v2", "v2Pro", "v2ProPlus", "v3", "v4", "v5dev", "v5turbo"}
LANGUAGES = {"auto", "auto_yue", "zh", "en", "ja", "yue", "ko", "all_zh", "all_ja", "all_yue", "all_ko"}
MAX_AUDIO = 12 * 1024 * 1024


def require_path(value, label, directory=False):
    p = Path(value or "").expanduser()
    if not value or not p.is_absolute() or not (p.is_dir() if directory else p.is_file()):
        raise ValueError(f"{label}不存在，请选择本机绝对路径：{value or '未选择'}")
    return str(p.resolve())


def validate_config(config):
    cfg = dict(config)
    for field, label, directory in [
        ("root", "GPT-SoVITS 推理目录", True), ("gpt", "GPT .ckpt 权重", False),
        ("sovits", "SoVITS .pth 权重", False), ("reference", "参考音频", False),
        ("bert", "BERT 模型目录", True), ("hubert", "HuBERT 模型目录", True),
        ("stateDir", "应用运行目录", True),
    ]:
        cfg[field] = require_path(cfg.get(field), label, directory)
    if Path(cfg["gpt"]).suffix.lower() != ".ckpt" or Path(cfg["sovits"]).suffix.lower() != ".pth":
        raise ValueError("请分别选择 GPT .ckpt 与 SoVITS .pth，不能仅用一个 .pth 替代两个模型。")
    if not (Path(cfg["root"]) / "GPT_SoVITS/TTS_infer_pack/TTS.py").is_file():
        raise ValueError("推理目录缺少 GPT_SoVITS/TTS_infer_pack/TTS.py")
    if cfg.get("version") not in VERSIONS or cfg.get("device") not in {"auto", "cpu", "cuda"}:
        raise ValueError("无效的引擎版本或设备选项")
    if cfg.get("textLang") not in LANGUAGES or cfg.get("promptLang") not in LANGUAGES:
        raise ValueError("请选择支持的文本与参考音频语言")
    cfg["textLang"] = "all_ja"
    if not isinstance(cfg.get("promptText"), str) or len(cfg["promptText"]) > 3000:
        raise ValueError("参考文本必须为字符串，最多 3000 字符")
    if cfg["version"] in {"v3", "v4", "v5dev", "v5turbo"} and not cfg["promptText"].strip():
        raise ValueError("此版本需要填写参考音频实际说出的文本")
    return cfg


def device_info(torch):
    result = {"torch": torch.__version__, "cudaBuild": torch.version.cuda,
              "cudaAvailable": False, "devices": [], "cpuThreads": torch.get_num_threads()}
    try:
        if torch.cuda.is_available():
            # A driver string alone does not prove kernels can actually run.
            tensor = torch.ones(1, device="cuda:0")
            _ = (tensor + tensor).cpu().item()
            del tensor
            result["cudaAvailable"] = True
            result["devices"] = [{"name": torch.cuda.get_device_name(i),
                                  "vramGiB": round(torch.cuda.get_device_properties(i).total_memory / 2**30, 2)}
                                 for i in range(torch.cuda.device_count())]
    except Exception as exc:
        result["cudaError"] = str(exc)[:500]
    return result


def select_device(requested, info):
    if requested == "cuda" and not info["cudaAvailable"]:
        raise RuntimeError("所选 Python 环境无法使用 CUDA；检查 PyTorch/驱动，或改为自动/CPU。")
    return "cuda:0" if requested != "cpu" and info["cudaAvailable"] else "cpu"


def is_oom(exc):
    return "out of memory" in str(exc).lower() or "cuda error: memory" in str(exc).lower()


class Engine:
    def __init__(self):
        self.pipeline = None
        self.cfg = None
        self.metadata = {}

    def load(self, config, force_cpu=False):
        cfg = validate_config(config)
        os.chdir(cfg["root"])
        sys.path[:0] = [cfg["root"], str(Path(cfg["root"]) / "GPT_SoVITS")]
        # Fail with missing resources rather than downloading weights implicitly.
        os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", G2PW="0")
        runtime = Path(cfg["root"]) / "runtime"
        os.environ["PATH"] = str(runtime) + os.pathsep + os.environ.get("PATH", "")
        os.environ.setdefault("NLTK_DATA", str(runtime / "nltk_data"))
        import torch
        self.torch = torch
        torch.set_num_threads(max(1, min(int(cfg.get("cpuThreads", 4)), os.cpu_count() or 1)))
        info = device_info(torch)
        device = "cpu" if force_cpu else select_device(cfg["device"], info)
        # Upstream's portable build expects runtime/ffmpeg.exe even on other OSes.
        from tools import portable_runtime
        ffmpeg = cfg.get("ffmpeg") or (str(portable_runtime.FFMPEG_EXE) if portable_runtime.FFMPEG_EXE.is_file() else shutil.which("ffmpeg"))
        if not ffmpeg:
            raise RuntimeError("未找到 FFmpeg；请使用官方运行环境或在语音设置中选择 ffmpeg 可执行文件。")
        portable_runtime.FFMPEG_EXE = Path(require_path(ffmpeg, "FFmpeg"))
        portable_runtime.activate()
        bundled_nltk = Path(sys.executable).parent / "nltk_data"
        if bundled_nltk.is_dir():
            os.environ["NLTK_DATA"] = str(bundled_nltk)
            import nltk
            nltk.data.path.insert(0, str(bundled_nltk))
        from GPT_SoVITS.TTS_infer_pack.TTS import TTS, TTS_Config
        # The lite detector ships with fast-langdetect; do not trigger its
        # default 126 MB network download during an offline conversation.
        import fast_langdetect
        fast_langdetect.infer._default_detector = fast_langdetect.infer.LangDetector(
            fast_langdetect.infer.LangDetectConfig(model="lite", cache_dir=cfg["stateDir"]))
        import soundfile as sf
        self.sf = sf
        audio_info = sf.info(cfg["reference"])
        if not 3 <= audio_info.duration <= 10:
            raise ValueError(f"参考音频需为 3–10 秒，当前 {audio_info.duration:.2f} 秒；建议使用干净的 WAV。")
        half = device != "cpu" and cfg.get("half", False)
        values = {"device": device, "is_half": bool(half), "version": cfg["version"],
                  "t2s_weights_path": cfg["gpt"], "vits_weights_path": cfg["sovits"],
                  "bert_base_path": cfg["bert"], "cnhuhbert_base_path": cfg["hubert"]}
        self.cfg = cfg
        tts_config = TTS_Config({"custom": values})
        # Upstream writes weights selections: keep its user config untouched.
        tts_config.configs_path = str(Path(cfg["stateDir"]) / "tts-worker.yaml")
        try:
            self.pipeline = TTS(tts_config)
            if cfg["textLang"] not in self.pipeline.configs.languages or cfg["promptLang"] not in self.pipeline.configs.languages:
                raise ValueError("该模型版本不支持所选语言")
            self.pipeline.set_ref_audio(cfg["reference"])
        except Exception as exc:
            self.pipeline = None
            if device != "cpu" and cfg.get("cpuFallback") and is_oom(exc) and not force_cpu:
                gc.collect(); torch.cuda.empty_cache()
                return self.load(cfg, force_cpu=True)
            raise
        self.metadata = {**info, "cpuThreads": torch.get_num_threads(),
                         "device": str(self.pipeline.configs.device),
                         "half": bool(self.pipeline.configs.is_half), "version": self.pipeline.configs.version,
                         "cpuFallback": force_cpu, "referenceSeconds": round(audio_info.duration, 2)}
        return self.metadata

    def synthesize(self, text, speed):
        if not self.pipeline:
            raise RuntimeError("语音模型尚未加载")
        if not isinstance(text, str) or not text.strip() or len(text) > 500:
            raise ValueError("单段语音文本必须为 1–500 字符")
        if not re.search(r"[\u3041-\u3096\u30a1-\u30fa\uff66-\uff9d]", text):
            raise ValueError("语音仅接受包含假名的完整日语译文，未翻译的中文不会合成。")
        speed = float(speed)
        if not 0.5 <= speed <= 2:
            raise ValueError("语速必须为 0.5–2.0")
        cfg = self.cfg
        params = {"text": text, "text_lang": "all_ja", "ref_audio_path": cfg["reference"],
                  "prompt_text": cfg["promptText"], "prompt_lang": cfg["promptLang"],
                  "text_split_method": "cut5", "batch_size": 1, "speed_factor": speed,
                  "streaming_mode": False, "return_fragment": False, "parallel_infer": False,
                  "use_cuda_graph": False, "use_flash_attention": False, "gpt_streaming": False, "super_sampling": False,
                  "seed": -1}
        try:
            with self.torch.inference_mode():
                parts = list(self.pipeline.run(params))
        except Exception as exc:
            if self.metadata["device"] != "cpu" and cfg.get("cpuFallback") and is_oom(exc):
                self.pipeline = None; gc.collect(); self.torch.cuda.empty_cache()
                self.load(cfg, force_cpu=True)
                return self.synthesize(text, speed)
            raise
        import numpy as np
        if not parts or any(rate != parts[0][0] for rate, _ in parts):
            raise RuntimeError("推理没有返回有效音频或采样率不一致")
        data = np.concatenate([audio for _, audio in parts])
        if data.size == 0 or not np.isfinite(data).all():
            raise RuntimeError("推理返回空音频或无效数值")
        if data.nbytes > MAX_AUDIO:
            raise RuntimeError("单段音频过大，请缩短文本")
        buffer = io.BytesIO()
        self.sf.write(buffer, data, parts[0][0], format="WAV", subtype="PCM_16")
        return {"audio": base64.b64encode(buffer.getvalue()).decode("ascii"), "metadata": self.metadata}


def main():
    # Also redirect native/C-extension stdout, not just Python print().
    protocol = os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8", buffering=1)
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
    engine = Engine()
    for line in sys.stdin:
        request = {}
        try:
            if len(line) > 64000:
                raise ValueError("Worker request too large")
            request = json.loads(line)
            with contextlib.redirect_stdout(sys.stderr):
                if request["method"] == "probe":
                    import torch
                    result = device_info(torch)
                elif request["method"] == "load":
                    result = engine.load(request["config"])
                elif request["method"] == "synthesize":
                    result = engine.synthesize(request["text"], request.get("speed", 1))
                else:
                    raise ValueError("Unknown worker method")
            response = {"id": request["id"], "ok": True, "result": result}
        except Exception as exc:
            traceback.print_exc(file=sys.stderr)
            hint = ""
            if isinstance(exc, ModuleNotFoundError):
                hint = "；所选 Python 环境缺少推理依赖，请先按语音接入文档安装或选择官方运行环境。"
            elif is_oom(exc):
                hint = "；内存/显存不足，请关闭其他模型，或选择 CPU 后重新加载。"
            response = {"id": request.get("id"), "ok": False, "error": str(exc)[:2000] + hint}
        protocol.write(json.dumps(response, ensure_ascii=False) + "\n")
        protocol.flush()


if __name__ == "__main__":
    main()
