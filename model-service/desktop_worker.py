"""Owned offline character generation worker. JSONL, no HTTP listener or downloads."""
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

_DLL_HANDLES = []
_DLL_DIRECTORIES = set()


def prepare_windows_dlls():
    """Expose private DLLs to both Python's safe loader and llama's winmode=0."""
    if sys.platform != "win32" or not hasattr(os, "add_dll_directory"):
        return
    candidates = [Path(sys.prefix) / "Lib/site-packages/torch/lib",
                  Path(sys.executable).parent / "Lib/site-packages/torch/lib",
                  Path(sys.executable).parent, Path(sys.prefix)]
    directories = []
    seen = set()
    for directory in candidates:
        if not directory.is_dir():
            continue
        resolved = str(directory.resolve())
        key = os.path.normcase(resolved).casefold()
        if key in seen:
            continue
        seen.add(key)
        directories.append(resolved)
        if key not in _DLL_DIRECTORIES:
            _DLL_HANDLES.append(os.add_dll_directory(resolved))
            _DLL_DIRECTORIES.add(key)
    # llama-cpp-python 0.3.36 explicitly uses CDLL(winmode=0), which does not
    # reliably search AddDllDirectory entries. Only this owned worker process
    # inherits this PATH; no system/user environment or CUDA installation changes.
    search = []
    seen.clear()
    for entry in directories + os.environ.get("PATH", "").split(os.pathsep):
        key = os.path.normcase(entry).casefold()
        if entry and key not in seen:
            search.append(entry)
            seen.add(key)
    os.environ["PATH"] = os.pathsep.join(search)


def read_manifest(directory):
    root = Path(directory)
    if not root.is_absolute() or not root.is_dir():
        raise ValueError('本地角色模型尚未安装，请先打开首次配置。')
    manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
    name = manifest.get('file', '')
    if not isinstance(name, str) or Path(name).name != name or not name.endswith('.gguf'):
        raise ValueError('本地模型清单中的权重文件名无效。')
    if not re.fullmatch(r'[a-f0-9]{64}', str(manifest.get('sha256', ''))):
        raise ValueError('本地模型清单缺少完整 SHA-256。')
    if not isinstance(manifest.get('bytes'), int) or manifest['bytes'] <= 0:
        raise ValueError('本地模型清单缺少权重大小。')
    return root, manifest


def verify_model(directory):
    root, manifest = read_manifest(directory)
    file = root / manifest['file']
    if not file.is_file() or file.stat().st_size != manifest['bytes']:
        raise ValueError('本地角色权重缺失或不完整，请在首次配置中修复。')
    digest = hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    if digest.hexdigest() != manifest['sha256']:
        raise ValueError('本地角色权重校验失败，请重新准备模型。')
    return file, manifest


def validate_messages(messages):
    if not isinstance(messages, list) or not 1 <= len(messages) <= 81:
        raise ValueError('本地对话需要有效的消息列表。')
    result = []
    total = 0
    for index, message in enumerate(messages):
        if not isinstance(message, dict) or message.get('role') not in {'system', 'user', 'assistant'}:
            raise ValueError('本地对话消息角色无效。')
        content = message.get('content')
        if not isinstance(content, str) or not content.strip():
            raise ValueError('本地对话内容不能为空。')
        if message['role'] == 'system' and index != 0:
            raise ValueError('角色规范只能位于消息开头。')
        total += len(content)
        if total > 60000:
            raise ValueError('本次对话上下文太长，请新建对话。')
        result.append({'role': message['role'], 'content': content.strip()})
    if result[-1]['role'] != 'user':
        raise ValueError('本地对话末条消息必须是用户问题。')
    return result


class Engine:
    def __init__(self):
        self.model = None
        self.config = {}
        self.metadata = {}

    def probe(self):
        prepare_windows_dlls()
        import llama_cpp
        return {'runtime': 'llama-cpp-python ' + llama_cpp.__version__,
                'gpuRuntimeAvailable': bool(llama_cpp.llama_supports_gpu_offload()),
                'cpuThreads': os.cpu_count() or 1,
                'note': 'GPU 运行库可用不代表已加载到显卡，实际设备以加载结果为准。'}

    def load(self, config):
        if not isinstance(config, dict):
            raise ValueError('无效的本地模型配置。')
        self.config = dict(config)
        if config.get('device', 'auto') not in {'auto', 'cpu', 'cuda'}:
            raise ValueError('无效的本地模型设备。')
        if not isinstance(config.get('cpuFallback', True), bool):
            raise ValueError('无效的 CPU 回退设置。')
        for key, default, low, high in [('cpuThreads', 4, 1, 32), ('contextTokens', 8192, 2048, 16384), ('maxNewTokens', 256, 32, 1024)]:
            value = config.get(key, default)
            if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
                raise ValueError('无效的本地模型参数：' + key)
            self.config[key] = value
        temperature = config.get('temperature', 0.65)
        if isinstance(temperature, bool) or not isinstance(temperature, (int, float)) or not 0 <= temperature <= 1.5:
            raise ValueError('本地模型温度超出范围。')
        self.config['temperature'] = temperature
        self.file, self.manifest = verify_model(config.get('modelDir', ''))
        prepare_windows_dlls()
        import llama_cpp
        self.llama_cpp = llama_cpp
        supported = bool(llama_cpp.llama_supports_gpu_offload())
        requested = config.get('device', 'auto')
        if requested == 'cuda' and not supported and not config.get('cpuFallback', True):
            raise RuntimeError('当前本地对话运行库没有 GPU 支持，请选择自动或配置 GPU 运行环境。')
        target = 'gpu' if requested != 'cpu' and supported else 'cpu'
        fallback = 'gpu-runtime-unavailable' if requested == 'cuda' and not supported else None
        try:
            actual = self._load(target)
        except Exception:
            if target != 'gpu' or not config.get('cpuFallback', True):
                raise
            actual = self._load('cpu')
            fallback = 'gpu-load-failed'
        if target == 'gpu' and actual == 'cpu':
            if not config.get('cpuFallback', True):
                raise RuntimeError('GPU 运行库未能把模型加载到显卡；可开启 CPU 回退或检查显卡运行环境。')
            fallback = fallback or 'no-gpu-offload'
        self.metadata = {'model': self.manifest.get('name', '雪乃本地角色模型'),
                         'baseModel': self.manifest.get('baseModel'),
                         'device': actual, 'offloadedLayers': self.offloaded_layers,
                         'quantization': self.manifest.get('quantization', 'Q4_K_M'),
                         'runtime': 'llama-cpp-python ' + llama_cpp.__version__,
                         'training': self.manifest.get('training', {}), 'offline': True}
        if fallback:
            self.metadata['fallback'] = fallback
        return self.metadata

    def _load(self, target):
        if self.model is not None:
            self.model.close()
            self.model = None
            gc.collect()
        self.offloaded_layers = 0
        self._log_buffer = ''
        @self.llama_cpp.llama_log_callback
        def logger(level, value, _):
            try:
                text = value.decode('utf-8', errors='replace')
                self._log_buffer = (self._log_buffer + text)[-2000:]
                match = re.search(r'offloaded (\d+)/\d+ layers to GPU', self._log_buffer)
                if match:
                    self.offloaded_layers = int(match.group(1))
                if level == 4:
                    print(text[:500], end='', file=sys.stderr)
            except Exception:
                pass
        self._logger = logger
        self.llama_cpp.llama_log_set(logger, ctypes.c_void_p(0))
        self.model = self.llama_cpp.Llama(model_path=str(self.file), n_ctx=self.config['contextTokens'],
            n_batch=256, n_threads=min(self.config['cpuThreads'], os.cpu_count() or 1),
            n_gpu_layers=-1 if target == 'gpu' else 0, verbose=False, seed=42)
        return 'gpu' if self.offloaded_layers > 0 else 'cpu'

    def bounded_messages(self, messages):
        result = validate_messages(messages)
        budget = self.config['contextTokens'] - self.config['maxNewTokens'] - 256
        def count():
            return sum(len(self.model.tokenize(row['content'].encode('utf-8'), add_bos=False)) + 24 for row in result)
        while count() > budget:
            start = 1 if result[0]['role'] == 'system' else 0
            if len(result) - start <= 1:
                raise ValueError('当前角色规范或问题超过本地模型上下文，请使用精简提示词或缩短问题。')
            result.pop(start)
            if start < len(result) - 1 and result[start]['role'] == 'assistant':
                result.pop(start)
        return result

    def generate(self, messages):
        if self.model is None:
            raise RuntimeError('本地对话模型尚未加载。')
        bounded = self.bounded_messages(messages)
        try:
            return self._generate(bounded)
        except Exception as error:
            if self.metadata.get('device') != 'gpu' or not self.config.get('cpuFallback', True) or not any(word in str(error).lower() for word in ('cuda', 'memory', 'alloc')):
                raise
            self._load('cpu')
            self.metadata.update(device='cpu', offloadedLayers=0, fallback='gpu-memory')
            return self._generate(bounded)

    def _generate(self, messages):
        output = self.model.create_chat_completion(messages=messages,
            max_tokens=self.config['maxNewTokens'], temperature=self.config['temperature'],
            top_p=0.9, repeat_penalty=1.08, stream=False)
        choice = output['choices'][0]
        text = choice['message'].get('content', '').strip()
        if not text:
            raise RuntimeError('本地模型没有生成正文，请重试。')
        return {**self.metadata, 'text': text, 'finishReason': choice.get('finish_reason', 'stop'),
                'historyMessagesUsed': len(messages)}


def main():
    engine = Engine()
    protocol = sys.stdout
    for raw in sys.stdin:
        request = {}
        try:
            if len(raw) > 500000:
                raise ValueError('本地模型请求过大。')
            request = json.loads(raw)
            if not isinstance(request, dict):
                raise ValueError('本地模型请求无效。')
            with contextlib.redirect_stdout(sys.stderr):
                method = request.get('method')
                if method == 'probe':
                    result = engine.probe()
                elif method == 'load':
                    result = engine.load(request.get('config', {}))
                elif method == 'generate':
                    result = engine.generate(request.get('messages'))
                else:
                    raise ValueError('未知的本地模型操作。')
            response = {'id': request.get('id'), 'ok': True, 'result': result}
        except Exception as error:
            response = {'id': request.get('id') if isinstance(request, dict) else None, 'ok': False, 'error': str(error)[:1200]}
        protocol.write(json.dumps(response, ensure_ascii=False) + '\n')
        protocol.flush()


if __name__ == '__main__':
    main()
