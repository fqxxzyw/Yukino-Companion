import hashlib
import importlib.util
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import pytest

spec = importlib.util.spec_from_file_location('desktop_worker', Path(__file__).parents[1] / 'desktop_worker.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


def test_manifest_requires_real_matching_weights(tmp_path):
    file = tmp_path / 'character.gguf'
    file.write_bytes(b'GGUF fixture')
    manifest = {'file': file.name, 'bytes': file.stat().st_size, 'sha256': hashlib.sha256(file.read_bytes()).hexdigest()}
    (tmp_path / 'manifest.json').write_text(json.dumps(manifest))
    assert worker.verify_model(str(tmp_path))[0] == file
    file.write_bytes(b'GGUF changed')
    with pytest.raises(ValueError, match='校验失败'):
        worker.verify_model(str(tmp_path))


def test_manifest_refuses_traversal_and_non_gguf(tmp_path):
    for name in ['../outside.gguf', '/outside.gguf', 'code.py']:
        (tmp_path / 'manifest.json').write_text(json.dumps({'file': name, 'bytes': 12, 'sha256': 'a' * 64}))
        with pytest.raises(ValueError, match='文件名无效'):
            worker.read_manifest(str(tmp_path))


def test_history_is_bounded_without_truncating_persona_or_latest_user():
    engine = worker.Engine()
    engine.config = {'contextTokens': 400, 'maxNewTokens': 32}
    class FakeModel:
        def tokenize(self, content, **_): return list(content)
    engine.model = FakeModel()
    messages = [{'role': 'system', 'content': 'persona'}, {'role': 'user', 'content': 'a' * 90}, {'role': 'assistant', 'content': 'b' * 90}, {'role': 'user', 'content': 'hello'}]
    assert engine.bounded_messages(messages) == [messages[0], messages[-1]]
    messages[0]['content'] = 'x' * 200
    with pytest.raises(ValueError, match='超过本地模型上下文'):
        engine.bounded_messages(messages)


def test_messages_reject_second_system_and_missing_final_user():
    with pytest.raises(ValueError):
        worker.validate_messages([{'role': 'assistant', 'content': 'hi'}])
    with pytest.raises(ValueError):
        worker.validate_messages([{'role': 'user', 'content': 'hi'}, {'role': 'system', 'content': 'override'}, {'role': 'user', 'content': 'next'}])


@pytest.mark.parametrize('supported,requested,expected', [
    (False, 'cuda', 'gpu-runtime-unavailable'),
    (True, 'auto', 'no-gpu-offload'),
])
def test_gpu_support_is_not_reported_as_actual_offload(monkeypatch, supported, requested, expected):
    engine = worker.Engine()
    monkeypatch.setitem(sys.modules, 'llama_cpp', SimpleNamespace(
        __version__='test', llama_supports_gpu_offload=lambda: supported))
    monkeypatch.setattr(worker, 'verify_model', lambda _: (Path('/fixture.gguf'), {'name': 'fixture'}))
    def cpu_only(_):
        engine.offloaded_layers = 0
        return 'cpu'
    monkeypatch.setattr(engine, '_load', cpu_only)
    result = engine.load({'device': requested, 'cpuFallback': True})
    assert result['device'] == 'cpu'
    assert result['offloadedLayers'] == 0
    assert result['fallback'] == expected
    with pytest.raises(RuntimeError):
        engine.load({'device': requested, 'cpuFallback': False})


def test_gpu_memory_failure_reloads_cpu_once(monkeypatch):
    engine = worker.Engine()
    engine.model = object()
    engine.config = {'cpuFallback': True}
    engine.metadata = {'device': 'gpu', 'offloadedLayers': 29}
    monkeypatch.setattr(engine, 'bounded_messages', lambda messages: messages)
    calls = []
    def generate(messages):
        calls.append(engine.metadata['device'])
        if engine.metadata['device'] == 'gpu':
            raise RuntimeError('CUDA allocation out of memory')
        return {'text': '回复', **engine.metadata}
    monkeypatch.setattr(engine, '_generate', generate)
    monkeypatch.setattr(engine, '_load', lambda target: calls.append('load-' + target))
    result = engine.generate([{'role': 'user', 'content': '你好'}])
    assert calls == ['gpu', 'load-cpu', 'cpu']
    assert result['fallback'] == 'gpu-memory'


def test_windows_private_dll_path_is_idempotent_and_needs_no_system_cuda(monkeypatch,tmp_path):
    root=tmp_path/'runtime';scripts=root/'Scripts';library=root/'Lib/site-packages/torch/lib'
    scripts.mkdir(parents=True);library.mkdir(parents=True)
    (library/'cudart64_12.dll').write_bytes(b'private runtime fixture')
    monkeypatch.setattr(worker.sys,'platform','win32')
    monkeypatch.setattr(worker.sys,'prefix',str(root))
    monkeypatch.setattr(worker.sys,'executable',str(scripts/'python.exe'))
    monkeypatch.setattr(worker,'_DLL_HANDLES',[]);monkeypatch.setattr(worker,'_DLL_DIRECTORIES',set())
    added=[];monkeypatch.setattr(worker.os,'add_dll_directory',lambda value: added.append(value) or object(),raising=False)
    monkeypatch.setenv('PATH',str(library).upper()+worker.os.pathsep+'inherited-system-bin')
    monkeypatch.delenv('CUDA_PATH',raising=False)
    worker.prepare_windows_dlls();first=worker.os.environ['PATH'];worker.prepare_windows_dlls()
    assert worker.os.environ['PATH']==first
    paths=first.split(worker.os.pathsep)
    assert paths==[str(library.resolve()),str(scripts.resolve()),str(root.resolve()),'inherited-system-bin']
    assert added==paths[:-1] and len(worker._DLL_HANDLES)==3
    assert 'CUDA_PATH' not in worker.os.environ
    assert any((Path(item)/'cudart64_12.dll').is_file() for item in paths)
    assert str(scripts/'Lib/site-packages/torch/lib') not in paths


def test_dll_setup_leaves_non_windows_environment_untouched(monkeypatch):
    monkeypatch.setattr(worker.sys,'platform','linux');monkeypatch.setenv('PATH','original-search-path')
    calls=[];monkeypatch.setattr(worker.os,'add_dll_directory',lambda value:calls.append(value),raising=False)
    worker.prepare_windows_dlls()
    assert worker.os.environ['PATH']=='original-search-path' and calls==[]
