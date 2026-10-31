"""SIMULATED adapter contracts: stdlib fakes only, no GPU/SDK/downloads.

Run like the existing worker tests: python -I tests/aqua_worker_test.py.
These tests are not evidence of real CUDA compatibility, quality or performance.
"""
import base64
import contextlib
import importlib.util
import io
import json
import logging
import math
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
from types import ModuleType, SimpleNamespace
import unittest
from unittest import mock
import wave

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("aqua_adapter_simulated", ROOT / "inference/aqua_adapter.py")
aqua = importlib.util.module_from_spec(spec)
spec.loader.exec_module(aqua)


class SimulatedArray:
    def __init__(self, values=(0.0, 0.25, -0.25), *, ndim=1, kind="f", nbytes=None):
        self.values = list(values)
        self.ndim = ndim
        self.size = len(self.values)
        self.dtype = SimpleNamespace(kind=kind)
        self.nbytes = self.size * 4 if nbytes is None else nbytes

    def astype(self, dtype, copy=False):
        return self


def simulated_numpy():
    module = ModuleType("numpy")
    module.asarray = lambda values: values if isinstance(values, SimulatedArray) else SimulatedArray(values)
    module.isfinite = lambda array: SimpleNamespace(all=lambda: all(math.isfinite(v) for v in array.values))
    module.abs = lambda array: SimulatedArray(abs(v) for v in array.values)
    module.max = lambda array: max(array.values)
    module.float32 = "float32"
    return module


class SimulatedTensor:
    def __add__(self, other): return self
    def cpu(self): return self
    def item(self): return 2


class AquaSimulatedTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        (self.root / "GPT_SoVITS/TTS_infer_pack").mkdir(parents=True)
        (self.root / "GPT_SoVITS/TTS_infer_pack/TTS.py").write_text("# never imported", encoding="utf-8")
        for name in ("bert", "hubert", "state"):
            (self.root / name).mkdir()
        for name in ("gpt.ckpt", "sovits.pth", "reference.wav"):
            (self.root / name).write_bytes(b"simulated; never loaded")
        self.cfg = {"root": str(self.root), "gpt": str(self.root / "gpt.ckpt"),
                    "sovits": str(self.root / "sovits.pth"), "reference": str(self.root / "reference.wav"),
                    "bert": str(self.root / "bert"), "hubert": str(self.root / "hubert"),
                    "stateDir": str(self.root / "state"), "version": "v2", "device": "auto",
                    "engine": "aqua", "textLang": "all_ja", "promptLang": "all_ja",
                    "promptText": "reference transcript secret", "half": False}
        self.total = 8 * 2**30
        self.free = 4 * 2**30
        self.actual_model = "v2"
        self.actual_device = "cuda:0"
        self.actual_half = True
        self.ready = True
        self.reference_duration = 4
        self.ctor_failures = []
        self.warm_failures = []
        self.infer_error = None
        self.output = (32000, SimulatedArray())
        self.constructions = []
        self.warms = []
        self.inferences = []
        self.threads = 4
        self.ones = mock.Mock(return_value=SimulatedTensor())
        self.cuda = SimpleNamespace(
            is_available=lambda: True, device_count=lambda: 1,
            get_device_name=lambda index: "SIMULATED GPU",
            get_device_properties=lambda index: SimpleNamespace(total_memory=self.total),
            mem_get_info=mock.Mock(side_effect=lambda device: (self.free, self.total)),
            empty_cache=mock.Mock(), synchronize=mock.Mock(), reset_peak_memory_stats=mock.Mock(),
            max_memory_allocated=mock.Mock(return_value=12345678))
        self.torch = SimpleNamespace(__version__="SIMULATED", version=SimpleNamespace(cuda="SIMULATED"),
                                     get_num_threads=lambda: self.threads,
                                     set_num_threads=lambda count: setattr(self, "threads", count),
                                     ones=self.ones, cuda=self.cuda, inference_mode=contextlib.nullcontext)
        owner = self

        # Explicit pinned public API; a misspelled/guessed keyword fails here.
        class SimulatedInferencer:
            def __init__(self, device="cuda", gpt_path=None, sovits_path=None, bert_path=None,
                         cnhubert_path=None, sovits_pretrain_path=None, bigvgan_path=None,
                         fast_langdetect_path=None, language="Auto", cuda_graph_preset="full",
                         sv_model_path=None, offline_only=False):
                owner.constructions.append({"device": device, "gpt_path": gpt_path, "sovits_path": sovits_path,
                                            "bert_path": bert_path, "cnhubert_path": cnhubert_path,
                                            "sovits_pretrain_path": sovits_pretrain_path, "bigvgan_path": bigvgan_path,
                                            "fast_langdetect_path": fast_langdetect_path, "sv_model_path": sv_model_path,
                                            "cuda_graph_preset": cuda_graph_preset, "offline_only": offline_only})
                owner.assertEqual(os.environ.get("GPT_SOVITS_HOME"), owner.cfg["root"])
                owner.assertEqual(os.environ.get("HF_HUB_OFFLINE"), "1")
                owner.assertEqual(os.environ.get("TRANSFORMERS_OFFLINE"), "1")
                owner.assertEqual(os.environ.get("ORT_DISABLE_TELEMETRY"), "1")
                owner.assertNotIn("ENABLE_CUDA_GRAPH", os.environ)
                if owner.ctor_failures:
                    failure = owner.ctor_failures.pop(0)
                    if failure is not None: raise failure
                self.model_version = owner.actual_model
                self.sovits_version = "v2"  # Deliberately not the architecture.
                self.device = owner.actual_device
                self.is_half = owner.actual_half

            def warm_reference_cache(self, audio_path, text="", language="日文", *, strict=True):
                owner.warms.append((audio_path, text, language, strict))
                if owner.warm_failures:
                    failure = owner.warm_failures.pop(0)
                    if failure is not None: raise failure
                return {"status": "miss", "ready": owner.ready, "key": text, "resident_count": 1}

            def infer(self, text, ref_audio_path, prompt_text=None, text_language="日文", prompt_language="日文",
                      how_to_cut="不切", speed=1.0, ref_free=False, if_sr=False,
                      enable_cuda_graph=None, enable_static_kv=True):
                owner.inferences.append(dict(text=text, ref_audio_path=ref_audio_path, prompt_text=prompt_text,
                                             text_language=text_language, prompt_language=prompt_language,
                                             how_to_cut=how_to_cut, speed=speed, ref_free=ref_free, if_sr=if_sr,
                                             enable_cuda_graph=enable_cuda_graph, enable_static_kv=enable_static_kv))
                logging.getLogger("tts_inference").error("target %s reference %s", text, prompt_text)
                print(text)
                print(prompt_text, file=sys.stderr)
                if owner.infer_error: raise owner.infer_error
                return owner.output

        def write_wav(buffer, data, rate, format, subtype):
            self.assertEqual((format, subtype), ("WAV", "PCM_16"))
            with wave.open(buffer, "wb") as output:
                output.setnchannels(1)
                output.setsampwidth(2)
                output.setframerate(rate)
                output.writeframes(b"".join(struct.pack("<h", round(v * 32767)) for v in data.values))

        self.sf = SimpleNamespace(info=lambda path: SimpleNamespace(duration=self.reference_duration),
                                  write=mock.Mock(side_effect=write_wav))
        module = ModuleType("aquatts")
        self.factory = mock.Mock(side_effect=SimulatedInferencer)
        # __getattr__ is reached by `from aquatts import TTSInferencer` after env setup.
        def exported(name):
            if name == "TTSInferencer":
                self.assertEqual(os.environ.get("GPT_SOVITS_HOME"), self.cfg["root"])
                return self.factory
            raise AttributeError(name)
        module.__getattr__ = exported
        self.fakes = {"torch": self.torch, "soundfile": self.sf, "numpy": simulated_numpy(), "aquatts": module}
        self.engine = aqua.AquaEngine()
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(mock.patch.dict(sys.modules, self.fakes))
        self.stack.enter_context(mock.patch.dict(os.environ, {"ENABLE_CUDA_GRAPH": "1",
                                                             "ENABLE_CUDA_GRAPH_PRECAPTURE": "1"}))
        self.chdir = self.stack.enter_context(mock.patch.object(os, "chdir"))
        self.package_version = self.stack.enter_context(mock.patch.object(aqua.importlib.metadata, "version", return_value="0.3.0"))

    def load(self, **changes):
        self.cfg.update(changes)
        return self.engine.load(self.cfg)

    def test_import_is_stdlib_only_and_does_not_import_worker_or_aqua(self):
        code = ("import importlib.util,sys; "
                f"s=importlib.util.spec_from_file_location('adapter',{str(ROOT / 'inference/aqua_adapter.py')!r}); "
                "m=importlib.util.module_from_spec(s);s.loader.exec_module(m); "
                "assert not any(n in sys.modules for n in ('torch','numpy','soundfile','aquatts','worker','inference.worker','_aqua_worker_helpers'))")
        process = subprocess.run([sys.executable, "-I", "-c", code], capture_output=True, text=True, timeout=20)
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(process.stdout, "")

    def test_running_worker_helpers_are_reused_without_circular_import(self):
        running = SimpleNamespace(__file__=str(ROOT / "inference/worker.py"))
        with mock.patch.dict(sys.modules, {"__main__": running}):
            self.assertIs(aqua._worker_helpers(), running)

    def test_load_passes_original_paths_offline_and_warms_one_reference(self):
        metadata = self.load()
        self.package_version.assert_called_once_with("aqua-tts")
        self.ones.assert_called_once_with(1, device="cuda:0")
        self.cuda.mem_get_info.assert_called_once_with("cuda:0")
        self.chdir.assert_called_once_with(self.cfg["root"])
        arguments = self.constructions[0]
        self.assertEqual(arguments["cuda_graph_preset"], "lazy")
        self.assertTrue(arguments["offline_only"])
        for argument, config in (("gpt_path", "gpt"), ("sovits_path", "sovits"), ("bert_path", "bert"), ("cnhubert_path", "hubert")):
            self.assertEqual(arguments[argument], self.cfg[config])
        self.assertEqual(self.warms, [(self.cfg["reference"], self.cfg["promptText"], "日文", True)])
        self.assertEqual(metadata["engine"], "aqua")
        self.assertEqual(metadata["engineVersion"], "0.3.0")
        self.assertEqual(metadata["modelVersion"], "v2")
        self.assertTrue(metadata["half"])  # Actual engine, not the user's false hint.
        self.assertFalse(metadata["cpuFallback"])
        self.assertEqual(metadata["capabilities"], {"maxConcurrentTasks": 1, "nativeBatch": False, "audioStreaming": False})
        self.assertFalse(metadata["audioStreaming"])
        self.assertTrue(metadata["referenceCache"]["ready"])
        self.assertNotIn("reference transcript secret", json.dumps(metadata))
        self.assertGreaterEqual(metadata["loadSeconds"], 0)
        self.assertEqual(metadata["vramPeakBytes"], 12345678)
        self.assertIsNone(metadata["rtf"])
        self.assertIsNone(metadata["audioDuration"])

    def test_optional_paths_map_to_real_constructor_parameters(self):
        for field, is_dir in (("aquaSovitsBase", False), ("aquaBigvgan", True), ("aquaSpeaker", False), ("aquaLangdetect", True)):
            path = self.root / field
            path.mkdir() if is_dir else path.touch()
            self.cfg[field] = str(path)
        self.load()
        for field, argument in (("aquaSovitsBase", "sovits_pretrain_path"), ("aquaBigvgan", "bigvgan_path"),
                                ("aquaSpeaker", "sv_model_path"), ("aquaLangdetect", "fast_langdetect_path")):
            self.assertEqual(self.constructions[0][argument], self.cfg[field])

    def test_missing_optional_resource_fails_before_runtime_import(self):
        with self.assertRaises(ValueError): self.load(aquaSpeaker=str(self.root / "missing.ckpt"))
        self.factory.assert_not_called()
        self.ones.assert_not_called()

    def test_exact_installed_distribution_version_is_required(self):
        for version in ("0.2.0", "0.3.0.dev1", "0.3.0+custom", "0.3.1"):
            with self.subTest(version=version):
                self.package_version.return_value = version
                with self.assertRaisesRegex(RuntimeError, "0.3.0"): self.load()
        self.package_version.side_effect = aqua.importlib.metadata.PackageNotFoundError("aqua-tts")
        with self.assertRaisesRegex(RuntimeError, "不会自动安装或下载"): self.load()
        self.factory.assert_not_called()
        self.ones.assert_not_called()

    def test_cpu_unsupported_versions_and_standard_are_rejected_before_gpu(self):
        for changes in ({"device": "cpu"}, {"version": "v1"}, {"version": "v4"},
                        {"version": "v5dev"}, {"version": "v5turbo"}, {"engine": "standard"}):
            with self.subTest(changes=changes):
                cfg = {**self.cfg, **changes}
                with self.assertRaises(ValueError): self.engine.load(cfg)
        self.factory.assert_not_called()
        self.ones.assert_not_called()

    def test_auto_engine_is_accepted_but_never_cpu(self):
        self.load(engine="auto")
        self.assertEqual(self.constructions[0]["device"], "cuda:0")

    def test_cuda_kernel_failure_is_not_a_driver_string_only_success(self):
        self.ones.side_effect = RuntimeError("SIMULATED broken CUDA driver")
        with self.assertRaisesRegex(RuntimeError, "实际计算测试失败"): self.load()
        self.factory.assert_not_called()

    def test_memory_guard_checks_total_and_free_and_reports_reason(self):
        for total, free in ((5 * 2**30, 4 * 2**30), (8 * 2**30, 2**30)):
            with self.subTest(total=total, free=free):
                self.total, self.free = total, free
                with self.assertRaisesRegex(RuntimeError, "6 GiB.*2 GiB"): self.load()
        self.factory.assert_not_called()
        self.total, self.free = 6 * 2**30, 2 * 2**30
        self.load()  # Exact stated boundary is allowed, not a guarantee it fits.

    def test_unreadable_free_memory_fails_closed(self):
        self.cuda.mem_get_info.side_effect = RuntimeError("SIMULATED unavailable")
        with self.assertRaisesRegex(RuntimeError, "无法读取实际 CUDA 显存"): self.load()
        self.factory.assert_not_called()

    def test_reference_duration_is_finite_and_between_three_and_ten_seconds(self):
        for duration in (0, 2.99, 10.01, float("nan"), float("inf")):
            with self.subTest(duration=duration):
                self.reference_duration = duration
                with self.assertRaisesRegex(ValueError, "3–10"): self.load()
        self.factory.assert_not_called()
        for duration in (3, 10):
            self.reference_duration = duration
            self.load()

    def test_prompt_language_mapping_is_exact_and_other_languages_rejected(self):
        for language, label in aqua.PROMPT_LANGUAGES.items():
            with self.subTest(language=language):
                self.load(promptLang=language)
                self.assertEqual(self.warms[-1][2], label)
                self.engine.synthesize("こんにちは。", 1)
                self.assertEqual(self.inferences[-1]["prompt_language"], label)
        for language in ("auto", "yue", "ko", "all_ko"):
            with self.subTest(language=language):
                with self.assertRaisesRegex(ValueError, "参考音频语言"): self.load(promptLang=language)

    def test_detected_architecture_not_symbol_version_is_reported(self):
        for version in ("v2", "v2Pro", "v2ProPlus", "v3"):
            with self.subTest(version=version):
                self.actual_model = version
                self.assertEqual(self.load(version=version)["modelVersion"], version)

    def test_unsupported_or_mismatched_detected_architecture_is_rejected(self):
        for actual in ("v1", "v3", "v4", "unknown", None):
            with self.subTest(actual=actual):
                self.actual_model = actual
                with self.assertRaisesRegex(ValueError, "模型架构"): self.load()
                self.assertIsNone(self.engine.pipeline)
        self.assertEqual(len(self.constructions), 5)  # Never retry model errors.
        self.assertEqual(self.warms, [])

    def test_runtime_cpu_or_non_half_is_not_advertised_as_cuda(self):
        for device, half in (("cpu", False), ("cuda:1", True), ("cuda:0", False)):
            self.actual_device, self.actual_half = device, half
            with self.assertRaisesRegex(ValueError, "实际加载到 CUDA"): self.load()
            self.assertIsNone(self.engine.pipeline)

    def test_unready_reference_cache_is_a_failed_load(self):
        self.ready = False
        with self.assertRaisesRegex(ValueError, "参考缓存预热未就绪"): self.load()
        self.assertIsNone(self.engine.pipeline)
        self.assertEqual(len(self.constructions), 1)

    def test_load_oom_retries_graph_off_once_and_clears_cuda(self):
        self.ctor_failures = [RuntimeError("CUDA out of memory"), None]
        metadata = self.load()
        self.assertEqual([c["cuda_graph_preset"] for c in self.constructions], ["lazy", "off"])
        self.assertTrue(metadata["graphOomRetry"])
        self.assertEqual(metadata["aquaGraph"], "off")
        self.assertEqual(metadata["aquaGraphRequested"], "lazy")
        self.assertGreaterEqual(self.cuda.empty_cache.call_count, 2)
        self.engine.synthesize("こんにちは。", 1)
        self.assertFalse(self.inferences[-1]["enable_cuda_graph"])
        self.assertEqual(len(self.constructions), 2)

    def test_reference_warmup_oom_also_uses_the_single_load_retry(self):
        self.warm_failures = [RuntimeError("CUDA out of memory"), None]
        self.load()
        self.assertEqual([c["cuda_graph_preset"] for c in self.constructions], ["lazy", "off"])
        self.assertEqual(len(self.warms), 2)

    def test_off_oom_never_retries_and_second_oom_stops(self):
        self.ctor_failures = [RuntimeError("CUDA out of memory")]
        with self.assertRaisesRegex(RuntimeError, "显存不足"): self.load(aquaGraph="off")
        self.assertEqual(len(self.constructions), 1)
        self.constructions.clear()
        self.ctor_failures = [RuntimeError("CUDA out of memory"), RuntimeError("CUDA out of memory")]
        with self.assertRaisesRegex(RuntimeError, "显存不足"): self.load(aquaGraph="full")
        self.assertEqual([c["cuda_graph_preset"] for c in self.constructions], ["full", "off"])
        self.assertIsNone(self.engine.pipeline)

    def test_other_load_errors_do_not_retry_or_leak_prompt_text(self):
        self.ctor_failures = [ValueError("Aqua secret reference transcript secret api-key-never-log")]
        with self.assertRaises(RuntimeError) as caught: self.load()
        self.assertIn("AQUA_LOAD_FAILED", str(caught.exception))
        self.assertNotIn("secret", str(caught.exception))
        self.assertNotIn("api-key", str(caught.exception))
        self.assertEqual(len(self.constructions), 1)

    def test_graph_presets_are_validated(self):
        for graph in ("lazy", "minimal", "full", "off"):
            with self.subTest(graph=graph):
                self.load(aquaGraph=graph)
                self.assertEqual(self.constructions[-1]["cuda_graph_preset"], graph)
        for graph in ("auto", "invalid", "", None):
            with self.subTest(graph=graph):
                with self.assertRaisesRegex(ValueError, "Aqua Graph"): self.load(aquaGraph=graph)

    def test_full_wav_reply_shape_metrics_and_no_text_in_logs(self):
        self.load(textLang="zh")  # The existing worker intentionally fixes output to Japanese.
        stdout, stderr = io.StringIO(), io.StringIO()
        previous = logging.root.manager.disable
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            result = self.engine.synthesize("こんにちは。", 1.25)
        self.assertEqual((stdout.getvalue(), stderr.getvalue()), ("", ""))
        self.assertEqual(logging.root.manager.disable, previous)
        self.assertEqual(set(result), {"audio", "metadata"})
        wav_bytes = base64.b64decode(result["audio"], validate=True)
        with wave.open(io.BytesIO(wav_bytes), "rb") as wav:
            self.assertEqual((wav.getnchannels(), wav.getsampwidth(), wav.getframerate(), wav.getnframes()), (1, 2, 32000, 3))
        metadata = result["metadata"]
        self.assertEqual(metadata["batchSize"], 1)
        self.assertFalse(metadata["parallelInference"])
        self.assertFalse(metadata["audioStreaming"])
        self.assertGreater(metadata["audioDuration"], 0)
        self.assertGreaterEqual(metadata["rtf"], 0)
        self.assertEqual(self.inferences[-1]["text_language"], "日文")
        self.assertEqual(self.inferences[-1]["speed"], 1.25)
        self.assertFalse(self.inferences[-1]["if_sr"])
        self.assertEqual(len(self.constructions), 1)
        self.assertEqual(len(self.warms), 1)
        self.assertNotIn(self.cfg["promptText"], json.dumps(result))

    def test_batches_of_more_than_one_are_not_faked(self):
        self.load()
        for texts in ([], ["こんにちは。", "お元気ですか。"], ["はい。"] * 3, "こんにちは。", None):
            with self.subTest(texts=texts):
                with self.assertRaisesRegex(ValueError, "不支持原生批推理"): self.engine.synthesize_batch(texts, 1)
        self.assertEqual(self.inferences, [])
        self.assertEqual(self.engine.synthesize_batch(["こんにちは。"], 1)["metadata"]["batchSize"], 1)

    def test_input_validation_happens_before_inference(self):
        with self.assertRaisesRegex(RuntimeError, "尚未加载"): self.engine.synthesize("こんにちは。", 1)
        self.load()
        for text in (None, "", "  ", "あ" * 501, "未翻译中文", "English only"):
            with self.subTest(text=text):
                with self.assertRaises(ValueError): self.engine.synthesize(text, 1)
        for speed in (0.49, 2.01, float("nan"), float("inf"), True):
            with self.subTest(speed=speed):
                with self.assertRaises(ValueError): self.engine.synthesize("こんにちは。", speed)
        self.assertEqual(self.inferences, [])

    def test_synthesis_failure_is_sanitized_and_never_reloads(self):
        self.load()
        for failure in (RuntimeError("CUDA out of memory target secret"), ValueError("reference transcript secret")):
            self.infer_error = failure
            with self.assertRaises(RuntimeError) as caught: self.engine.synthesize("こんにちは。", 1)
            self.assertIn("AQUA_INFER_", str(caught.exception))
            self.assertNotIn("secret", str(caught.exception))
        self.assertEqual(len(self.constructions), 1)
        self.assertEqual(len(self.warms), 1)

    def test_swallowed_error_none_and_invalid_sample_rates_are_rejected(self):
        self.load()
        for result in (None, (), (32000,), (32000, SimulatedArray(), "extra")):
            self.output = result
            with self.assertRaisesRegex(RuntimeError, "未返回有效音频"): self.engine.synthesize("こんにちは。", 1)
        for rate in (0, -1, 7999, 192001, float("nan"), 32000.0, "32000", True):
            self.output = (rate, SimulatedArray())
            with self.assertRaisesRegex(RuntimeError, "无效采样率"): self.engine.synthesize("こんにちは。", 1)
        self.sf.write.assert_not_called()

    def test_invalid_audio_empty_stereo_nonfinite_amplitude_and_size_are_rejected(self):
        self.load()
        for audio in (SimulatedArray([]), SimulatedArray(ndim=2), SimulatedArray(kind="O"),
                      SimulatedArray(kind="i"), SimulatedArray([float("nan")]), SimulatedArray([float("inf")]),
                      SimulatedArray([1.01]), SimulatedArray([-1.01]),
                      SimulatedArray(nbytes=self.engine.max_audio + 1)):
            with self.subTest(audio=vars(audio)):
                self.output = (32000, audio)
                with self.assertRaises(RuntimeError): self.engine.synthesize("こんにちは。", 1)
        self.sf.write.assert_not_called()

    def test_wav_size_is_bounded_independently_of_array_size(self):
        self.load()
        self.sf.write.side_effect = lambda buffer, *args, **kwargs: buffer.write(b"x" * (self.engine.max_audio + 1))
        with self.assertRaisesRegex(RuntimeError, "WAV 输出为空或过大"): self.engine.synthesize("こんにちは。", 1)


if __name__ == "__main__":
    unittest.main()
