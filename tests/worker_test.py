"""No weights required: configuration and actual worker protocol/error paths."""
import importlib.util
import builtins
import json
import os
import subprocess
import sys
import tempfile
import unittest
import contextlib
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('worker', ROOT/'inference/worker.py')
worker = importlib.util.module_from_spec(spec); spec.loader.exec_module(worker)


class WorkerTests(unittest.TestCase):
    def test_device_selection(self):
        self.assertEqual(worker.select_device('auto', {'cudaAvailable': False}), 'cpu')
        self.assertEqual(worker.select_device('cpu', {'cudaAvailable': True}), 'cpu')
        self.assertEqual(worker.select_device('auto', {'cudaAvailable': True}), 'cuda:0')
        with self.assertRaisesRegex(RuntimeError, 'CUDA'):
            worker.select_device('cuda', {'cudaAvailable': False})

    def test_cuda_probe_executes_kernel_and_handles_broken_driver(self):
        class CUDA:
            def is_available(self): return True
        class Torch:
            __version__ = 'test'
            class version: cuda = 'test'
            cuda = CUDA()
            def get_num_threads(self): return 2
            def ones(self, *args, **kwargs): raise RuntimeError('driver mismatch')
        info = worker.device_info(Torch())
        self.assertFalse(info['cudaAvailable'])
        self.assertIn('driver mismatch', info['cudaError'])
        self.assertEqual(info['cpuThreads'], 2)

    def test_load_reports_effective_torch_threads_not_host_cpu_count(self):
        # All inference dependencies are import-hook fakes: no SDK or weights load.
        for requested, host, pipeline_threads, expected in [
            (2, 64, None, 2), (128, 8, None, 8), (0, 8, None, 1), (2, 64, 3, 3),
        ]:
            with self.subTest(requested=requested, host=host, pipeline_threads=pipeline_threads), tempfile.TemporaryDirectory() as tmp:
                base = Path(tmp)
                ffmpeg = base / 'ffmpeg'
                ffmpeg.touch()
                cfg = {'root': tmp, 'stateDir': tmp, 'device': 'cpu', 'cpuThreads': requested,
                       'ffmpeg': str(ffmpeg), 'reference': str(base / 'reference.wav'),
                       'version': 'v2', 'gpt': 'test.ckpt', 'sovits': 'test.pth',
                       'bert': 'bert', 'hubert': 'hubert', 'textLang': 'all_ja', 'promptLang': 'ja'}
                state = {'threads': host, 'at_pipeline': None}
                def set_threads(value): state['threads'] = value
                torch = SimpleNamespace(__version__='fake', version=SimpleNamespace(cuda=None),
                                        cuda=SimpleNamespace(is_available=lambda: False),
                                        get_num_threads=lambda: state['threads'],
                                        set_num_threads=mock.Mock(side_effect=set_threads))
                class TTSConfig:
                    def __init__(self, values):
                        self.__dict__.update(values['custom'])
                        self.languages = ['all_ja', 'ja']
                class TTS:
                    def __init__(self, config):
                        self.configs = config
                        state['at_pipeline'] = state['threads']
                        if pipeline_threads is not None:
                            state['threads'] = pipeline_threads
                    def set_ref_audio(self, reference): pass
                portable = SimpleNamespace(FFMPEG_EXE=ffmpeg, activate=mock.Mock())
                fakes = {
                    'torch': torch,
                    'tools': SimpleNamespace(portable_runtime=portable),
                    'GPT_SoVITS.TTS_infer_pack.TTS': SimpleNamespace(TTS=TTS, TTS_Config=TTSConfig),
                    'fast_langdetect': SimpleNamespace(infer=SimpleNamespace(
                        LangDetector=lambda config: config, LangDetectConfig=lambda **values: values)),
                    'soundfile': SimpleNamespace(info=lambda reference: SimpleNamespace(duration=4)),
                }
                def fake_import(name, *args, **kwargs):
                    if name not in fakes:
                        raise AssertionError('Unexpected dependency import: ' + name)
                    return fakes[name]
                with mock.patch.object(worker, 'validate_config', return_value=cfg), \
                     mock.patch.object(os, 'chdir'), mock.patch.object(os, 'cpu_count', return_value=host), \
                     mock.patch.object(sys, 'path', list(sys.path)), \
                     mock.patch.object(sys, 'executable', str(base / 'python')), \
                     mock.patch.dict(os.environ), mock.patch.object(builtins, '__import__', side_effect=fake_import):
                    metadata = worker.Engine().load(cfg)
                configured = max(1, min(requested, host))
                torch.set_num_threads.assert_called_once_with(configured)
                self.assertEqual(state['at_pipeline'], configured)
                self.assertEqual(metadata['cpuThreads'], expected)

    def test_telemetry_is_disabled_before_first_inference_dependency_import(self):
        class FirstDependencyReached(RuntimeError): pass
        real_import = builtins.__import__
        attempted = []
        def guarded_import(name, *args, **kwargs):
            root = name.split('.')[0]
            if root in sys.stdlib_module_names or root in sys.builtin_module_names:
                return real_import(name, *args, **kwargs)
            attempted.append(name)
            self.assertEqual(name, 'torch')
            self.assertEqual(os.environ.get('ORT_DISABLE_TELEMETRY'), '1')
            raise FirstDependencyReached('No real inference SDK is imported')
        isolated_spec = importlib.util.spec_from_file_location('worker_telemetry_test', ROOT / 'inference/worker.py')
        isolated = importlib.util.module_from_spec(isolated_spec)
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.dict(os.environ, {'ORT_DISABLE_TELEMETRY': '0'}), \
             mock.patch.object(os, 'chdir'), mock.patch.object(sys, 'path', list(sys.path)), \
             mock.patch.object(builtins, '__import__', side_effect=guarded_import):
            isolated_spec.loader.exec_module(isolated)
            with mock.patch.object(isolated, 'validate_config', return_value={'root': tmp}):
                with self.assertRaises(FirstDependencyReached):
                    isolated.Engine().load({})
        self.assertEqual(attempted, ['torch'])

    def test_missing_paths_fail_before_importing_models(self):
        with self.assertRaisesRegex(ValueError, '不存在'):
            worker.validate_config({})

    def test_prompt_text_is_optional_for_v1_but_required_for_vocoder_versions(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            engine = root/'engine'; (engine/'GPT_SoVITS/TTS_infer_pack').mkdir(parents=True)
            (engine/'GPT_SoVITS/TTS_infer_pack/TTS.py').write_text('fixture')
            for name in ['bert','hubert','state']: (root/name).mkdir()
            for name in ['gpt.ckpt','sovits.pth','reference.wav']: (root/name).write_bytes(b'fixture')
            cfg={'root':str(engine),'gpt':str(root/'gpt.ckpt'),'sovits':str(root/'sovits.pth'),'reference':str(root/'reference.wav'),'bert':str(root/'bert'),'hubert':str(root/'hubert'),'stateDir':str(root/'state'),'version':'v1','device':'cpu','textLang':'all_ja','promptLang':'all_ja','promptText':''}
            self.assertEqual(worker.validate_config(cfg)['promptText'],'')
            cfg['version']='v3'
            with self.assertRaisesRegex(ValueError,'参考音频实际说出'): worker.validate_config(cfg)

    def test_protocol_survives_error_without_stdout_pollution(self):
        commands = [{'id':'a','method':'unknown'}, {'id':'b','method':'synthesize','text':'hello'}]
        result = subprocess.run([sys.executable, str(ROOT/'inference/worker.py')],
                                input=''.join(json.dumps(x)+'\n' for x in commands), text=True,
                                encoding='utf-8', capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 0)
        lines = [json.loads(x) for x in result.stdout.splitlines()]
        self.assertEqual([x['id'] for x in lines], ['a','b'])
        self.assertTrue(all(not x['ok'] for x in lines))
        self.assertIn('尚未加载', lines[1]['error'])

    def test_oom_errors_are_distinguished_from_missing_files(self):
        self.assertFalse(worker.is_oom(ValueError('missing file')))
        self.assertTrue(worker.is_oom(RuntimeError('CUDA out of memory')))

    def test_cuda_errors_fall_back_but_model_errors_do_not(self):
        for message in ['CUDA error: invalid device function', 'CUBLAS_STATUS_EXECUTION_FAILED', 'CUDA out of memory']:
            self.assertTrue(worker.is_gpu_failure(RuntimeError(message)))
        self.assertFalse(worker.is_gpu_failure(ValueError('missing checkpoint')))
        # The configured fallback must still proceed if driver cleanup fails.
        torch = SimpleNamespace(cuda=SimpleNamespace(empty_cache=mock.Mock(side_effect=RuntimeError('driver gone'))))
        worker.release_cuda_cache(torch)
        torch.cuda.empty_cache.assert_called_once()

    def test_synthesis_cuda_failure_recovers_on_cpu_with_reason(self):
        class BrokenPipeline:
            def run(self, params):
                raise RuntimeError('CUDA error: invalid device function')
        class Torch:
            cuda = SimpleNamespace(empty_cache=mock.Mock(side_effect=RuntimeError('driver gone')))
            def inference_mode(self): return contextlib.nullcontext()
        engine = worker.Engine()
        engine.pipeline, engine.torch = BrokenPipeline(), Torch()
        engine.cfg = {'reference':'reference.wav','promptText':'', 'promptLang':'ja', 'cpuFallback':True}
        engine.metadata = {'device':'cuda:0'}
        with mock.patch.object(engine, 'load') as load:
            def fake_load(config, **kwargs):
                engine.metadata={'device':'cpu'}
                engine.pipeline=SimpleNamespace(run=lambda params: (_ for _ in ()).throw(RuntimeError('cpu retry reached')))
            load.side_effect=fake_load
            with self.assertRaisesRegex(RuntimeError, 'cpu retry reached'):
                engine.synthesize('こんにちは。', 1)
            self.assertTrue(load.call_args.kwargs['force_cpu'])
            self.assertIn('invalid device function',load.call_args.kwargs['fallback_reason'])

    def test_synthesis_language_is_fixed_even_if_stale_config_requests_chinese(self):
        captured = {}
        class Pipeline:
            def run(self, params):
                captured.update(params)
                raise RuntimeError('captured-before-inference')
        class Torch:
            def inference_mode(self): return contextlib.nullcontext()
        engine = worker.Engine()
        engine.pipeline, engine.torch = Pipeline(), Torch()
        engine.cfg = {'textLang':'zh','reference':'reference.wav','promptText':'你好', 'promptLang':'zh'}
        engine.metadata = {'device':'cpu'}
        with self.assertRaisesRegex(ValueError, '日语译文'):
            engine.synthesize('你好，今天想聊什么？', 1)
        self.assertEqual(captured, {})
        with self.assertRaisesRegex(RuntimeError, 'captured-before-inference'):
            engine.synthesize('今日は何を話しましょうか。', 1)
        self.assertEqual(captured['text_lang'], 'all_ja')
        self.assertEqual(captured['prompt_lang'], 'zh')
        self.assertEqual(captured['prompt_text'], '你好')


if __name__ == '__main__': unittest.main()
