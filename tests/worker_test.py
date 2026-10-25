"""No weights required: configuration and actual worker protocol/error paths."""
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

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
            def ones(self, *args, **kwargs): raise RuntimeError('driver mismatch')
        info = worker.device_info(Torch())
        self.assertFalse(info['cudaAvailable'])
        self.assertIn('driver mismatch', info['cudaError'])

    def test_missing_paths_fail_before_importing_models(self):
        with self.assertRaisesRegex(ValueError, '不存在'):
            worker.validate_config({})

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


if __name__ == '__main__': unittest.main()
