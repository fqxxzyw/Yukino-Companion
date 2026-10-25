"""Build the EXE's private inference runtime; run on Windows with Python 3.12.

User-trained GPT/SoVITS weights are never downloaded. BERT/HuBERT are installed
from the app's pinned catalog after installation, or may be supplied locally.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile

PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT / 'inference'))
from prepare_runtime import prepare, REVISION

RUNTIME_INPUTS = [
    'scripts/build_windows_runtime.py', 'inference/prepare_runtime.py',
    'inference/requirements.txt', 'translation/prepare_runtime.py',
    'translation/requirements.txt',
]


def inputs_fingerprint():
    """Do not reuse a cache when either dependency baseline or preparation changes."""
    digest = hashlib.sha256()
    for name in RUNTIME_INPUTS:
        digest.update(name.encode('utf-8'))
        digest.update((PROJECT / name).read_bytes())
    return digest.hexdigest()


def embedded_smoke(embedded, engine, runtime):
    """Import both engines from the distributable Python, not the build venv."""
    env = os.environ.copy()
    env.update(PYTHONUTF8='1', NLTK_DATA=str(runtime / 'nltk_data'),
               HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1')
    source = (f"import sys,importlib.util;sys.path[:0]=[{str(engine)!r},{str(engine/'GPT_SoVITS')!r}];"
              f"spec=importlib.util.spec_from_file_location('translation_worker',{str(PROJECT/'translation/worker.py')!r});"
              "worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker);"
              "worker.prepare_windows_dlls();"
              "import llama_cpp;"
              "from GPT_SoVITS.TTS_infer_pack.TTS import TTS;"
              "import torch, torchaudio, nltk, pyopenjtalk;"
              "assert torch.__version__.startswith('2.5.1');"
              "assert torchaudio.__version__.startswith('2.5.1');"
              "assert llama_cpp.__version__ == '0.3.36';"
              "nltk.data.find('taggers/averaged_perceptron_tagger_eng/');"
              "assert pyopenjtalk.g2p('こんにちは');"
              "print('Embedded engines ready:',torch.__version__,llama_cpp.__version__)")
    run(embedded, '-X', 'utf8', '-c', source, cwd=engine, env=env)
    run(runtime / 'ffmpeg.exe', '-version', env=env, stdout=subprocess.DEVNULL)


def run(*args, **kwargs):
    subprocess.run([str(x) for x in args], check=True, **kwargs)


def download(url, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + '.part')
    with urllib.request.urlopen(url, timeout=120) as response, temporary.open('wb') as out:
        shutil.copyfileobj(response, out)
    temporary.replace(destination)


def engine_source(output, source=None):
    if output.exists():
        manifest = json.loads((output / 'yukino-runtime.json').read_text(encoding='utf-8'))
        if manifest['revision'] != REVISION:
            raise RuntimeError('生成目录版本不一致，请删除 build/inference-engine 后重建')
        return
    if source:
        prepare(source, output); return
    with tempfile.TemporaryDirectory(prefix='yukino-gsv-source-') as temp:
        run('git', 'init', temp)
        run('git', '-C', temp, 'remote', 'add', 'origin', 'https://github.com/RVC-Boss/GPT-SoVITS.git')
        run('git', '-C', temp, 'fetch', '--depth', '1', 'origin', REVISION)
        run('git', '-C', temp, 'checkout', '--detach', 'FETCH_HEAD')
        prepare(temp, output)


def build(flavor='cpu', source=None, source_only=False):
    build_dir = PROJECT / 'build'
    engine = build_dir / 'inference-engine'
    engine_source(engine, source)
    if source_only:
        return
    if sys.platform != 'win32' or sys.version_info[:2] != (3, 12):
        raise RuntimeError('完整运行环境须在 Windows x64 / Python 3.12 构建；其它环境可使用 --source-only')
    runtime = build_dir / 'python-runtime'
    marker = runtime / 'yukino-runtime-build.json'
    if marker.exists():
        saved = json.loads(marker.read_text())
        if (saved.get('flavor') == flavor and saved.get('revision') == REVISION
                and saved.get('translationRuntime') == 'llama-cpp-python-0.3.36'
                and saved.get('inputFingerprint') == inputs_fingerprint()):
            for name in ['python.exe', 'python312.dll', 'python312.zip', 'python312._pth', 'ffmpeg.exe']:
                if not (runtime / name).is_file():
                    raise RuntimeError(f'运行环境缓存不完整：{name}；请清理 build/python-runtime 后重建')
            embedded_smoke(runtime / 'python.exe', engine, runtime)
            return
        raise RuntimeError('运行环境版本不同，请清理 build/python-runtime 后重新构建')
    if runtime.exists():
        shutil.rmtree(runtime)
    runtime.mkdir(parents=True)
    archive = build_dir / 'python-embed.zip'
    download('https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip', archive)
    with zipfile.ZipFile(archive) as z:
        for info in z.infolist():
            dest = (runtime / info.filename).resolve()
            if not dest.is_relative_to(runtime.resolve()): raise RuntimeError('Invalid Python archive path')
        z.extractall(runtime)
    (runtime / 'python312._pth').write_text('python312.zip\n.\nLib/site-packages\nimport site\n', encoding='utf-8')
    packages = runtime / 'Lib/site-packages'
    # Install in a build-only venv first so the dependency resolver sees the
    # selected CPU/CUDA torch; copy the completed environment into embedded Python.
    env_dir = build_dir / 'runtime-venv'
    # A reused venv can retain a different CUDA wheel or obsolete dependencies.
    if env_dir.exists():
        shutil.rmtree(env_dir)
    run(sys.executable, '-m', 'venv', env_dir)
    python = env_dir / 'Scripts/python.exe'
    run(python, '-m', 'pip', 'install', '--upgrade', 'pip', 'setuptools', 'wheel')
    run(python, '-m', 'pip', 'install', 'torch==2.5.1', 'torchaudio==2.5.1', '--index-url', f'https://download.pytorch.org/whl/{flavor}')
    run(python, '-m', 'pip', 'install', '-r', PROJECT / 'inference/requirements.txt')
    run(sys.executable, PROJECT / 'translation/prepare_runtime.py', '--python', python, '--flavor', flavor)
    shutil.copytree(env_dir / 'Lib/site-packages', packages, dirs_exist_ok=True)
    embedded = runtime / 'python.exe'
    # FFmpeg wheel supplies a Windows binary without a full multimedia suite.
    run(python, '-m', 'pip', 'install', 'imageio-ffmpeg==0.6.0')
    ffmpeg = subprocess.check_output([str(python), '-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'], text=True).strip()
    shutil.copy2(ffmpeg, runtime / 'ffmpeg.exe')
    for resource in ['averaged_perceptron_tagger', 'averaged_perceptron_tagger_eng', 'cmudict', 'punkt', 'punkt_tab']:
        run(embedded, '-X', 'utf8', '-m', 'nltk.downloader', '-d', runtime / 'nltk_data', resource)
    # Pre-fetch Japanese pronunciation dictionary inside its own package.
    run(embedded, '-X', 'utf8', '-c', "import pyopenjtalk; print(pyopenjtalk.g2p('こんにちは'))")
    # Freeze the exact platform dependencies for release diagnostics.
    freeze = subprocess.check_output([str(python), '-m', 'pip', 'freeze'], text=True)
    (runtime / 'requirements-resolved.txt').write_text(freeze, encoding='utf-8')
    embedded_smoke(embedded, engine, runtime)
    marker.write_text(json.dumps({'flavor':flavor,'revision':REVISION,'python':'3.12.10',
                                 'pythonArchiveSha256':hashlib.sha256(archive.read_bytes()).hexdigest(),
                                 'translationRuntime':'llama-cpp-python-0.3.36',
                                 'inputFingerprint':inputs_fingerprint()}, indent=2), encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--flavor', choices=['cpu','cu124'], default='cpu')
    parser.add_argument('--source'); parser.add_argument('--source-only', action='store_true')
    args = parser.parse_args()
    build(args.flavor, args.source, args.source_only)
