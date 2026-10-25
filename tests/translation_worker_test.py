import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('translation_worker', Path(__file__).resolve().parents[1] / 'translation/worker.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class TranslationWorkerTests(unittest.TestCase):
    def test_windows_private_dlls_are_visible_to_legacy_loader_without_cuda_path(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary)/'runtime'; scripts=root/'Scripts'; library=root/'Lib/site-packages/torch/lib'
            scripts.mkdir(parents=True);library.mkdir(parents=True)
            (library/'cublas64_12.dll').write_bytes(b'private CUDA DLL fixture')
            # Resolve Windows TEMP's 8.3 alias first: this fixture tests case
            # deduplication, not equivalence between distinct short/long names.
            case_variant=str(library.resolve()).upper()
            original='inherited-system-bin';added=[]
            with mock.patch.object(worker.sys,'platform','win32'), mock.patch.object(worker.sys,'prefix',str(root)), mock.patch.object(worker.sys,'executable',str(scripts/'python.exe')), mock.patch.object(worker.os,'add_dll_directory',side_effect=lambda item: added.append(item) or object(),create=True), mock.patch.dict(worker.os.environ,{'PATH':case_variant+worker.os.pathsep+original},clear=True), mock.patch.object(worker,'_DLL_HANDLES',[]), mock.patch.object(worker,'_DLL_DIRECTORIES',set()):
                worker.prepare_windows_dlls();first=worker.os.environ['PATH'];worker.prepare_windows_dlls()
                self.assertEqual(worker.os.environ['PATH'],first)
                paths=first.split(worker.os.pathsep)
                self.assertEqual(paths,[str(library.resolve()),str(scripts.resolve()),str(root.resolve()),original])
                self.assertEqual(added,paths[:-1]);self.assertEqual(len(worker._DLL_HANDLES),3)
                self.assertNotIn('CUDA_PATH',worker.os.environ)
                self.assertTrue(any((Path(item)/'cublas64_12.dll').is_file() for item in paths))
                self.assertNotIn(str(scripts/'Lib/site-packages/torch/lib'),paths)

    def test_dll_setup_does_not_modify_non_windows_search_paths(self):
        with mock.patch.object(worker.sys,'platform','linux'), mock.patch.dict(worker.os.environ,{'PATH':'original-search-path'}), mock.patch.object(worker.os,'add_dll_directory',create=True) as add:
            worker.prepare_windows_dlls()
            self.assertEqual(worker.os.environ['PATH'],'original-search-path');add.assert_not_called()

    def test_chunking_keeps_source_without_truncating(self):
        class Tokenizer:
            def __call__(self, text, **kwargs):
                return {'input_ids': list(range(len(text) * 2 + 1))}
        text='今天也辛苦了。'+('不要勉强自己' * 150)+'！\n先休息一下。'
        chunks=worker.split_text(text,Tokenizer(),limit=100)
        self.assertEqual(''.join(chunks),text)
        self.assertTrue(all(len(Tokenizer()(part)['input_ids']) <= 100 for part in chunks))

    def test_config_rejects_bad_devices_and_threads(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaises(ValueError): worker.validate_config({'modelDir':root,'device':'gpu'})
            with self.assertRaises(ValueError): worker.validate_config({'modelDir':root,'cpuThreads':True})
            self.assertEqual(worker.validate_config({'modelDir':root})['modelDir'],str(Path(root).resolve()))

    def test_manifest_detects_corruption(self):
        import hashlib
        with tempfile.TemporaryDirectory() as root:
            file=Path(root)/'model.safetensors';file.write_bytes(b'valid')
            manifest={'files':[{'path':file.name,'size':5,'sha256':hashlib.sha256(b'valid').hexdigest()}]}
            worker.verify_model(root,manifest)
            file.write_bytes(b'wrong')
            with self.assertRaisesRegex(ValueError,'校验失败'):worker.verify_model(root,manifest)

    def test_cpu_auto_does_not_assume_cuda_build(self):
        class Runtime:
            @staticmethod
            def llama_supports_gpu_offload(): return False
        self.assertEqual(worker.choose_device(Runtime(),'auto'),'cpu')
        with self.assertRaises(RuntimeError):worker.choose_device(Runtime(),'cuda')

    def test_gpu_available_is_preferred_unless_cpu_is_requested(self):
        class Runtime:
            @staticmethod
            def llama_supports_gpu_offload(): return True
        self.assertEqual(worker.choose_device(Runtime(),'auto'),'gpu')
        self.assertEqual(worker.choose_device(Runtime(),'cpu'),'cpu')

    def test_incomplete_or_non_japanese_generation_is_rejected(self):
        class Model:
            result = {'choices':[{'finish_reason':'length','message':{'content':'こんにちは'}}]}
            def create_chat_completion(self, **kwargs): return self.result
        engine = worker.Engine();engine.model = Model()
        with self.assertRaisesRegex(RuntimeError,'不完整'):engine._generate('你好')
        engine.model.result = {'choices':[{'finish_reason':'stop','message':{'content':'你好'}}]}
        with self.assertRaisesRegex(RuntimeError,'日文'):engine._generate('你好')

    def test_prompt_contains_relevant_glossary_and_original_input(self):
        source = '雪之下雪乃喜欢猫，但她没有养猫。'
        prompt = worker.make_prompt(source)
        self.assertIn('雪之下雪乃 → 雪ノ下雪乃',prompt)
        self.assertTrue(prompt.endswith(source))

    def test_unloaded_model_fails_without_chinese_fallback(self):
        with self.assertRaises(RuntimeError):worker.Engine().translate('你好')


if __name__ == '__main__': unittest.main()
