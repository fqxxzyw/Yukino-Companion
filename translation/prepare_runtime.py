"""Prepare the fixed translation runtime inside the selected build Python.

CPU uses SHA-256-verified wheels from abetlen/llama-cpp-python's official release.
CUDA builds the same verified source release with GGML_CUDA; a CUDA toolkit and
C++ build tools are required on the build machine, not on the user's computer.
The application never compiles or installs packages during conversation.
"""
from __future__ import annotations
import argparse
import hashlib
import os
from pathlib import Path
import platform
import subprocess
import sys
import tempfile
from urllib.request import urlopen

VERSION = '0.3.36'
BASE = f'https://github.com/abetlen/llama-cpp-python/releases/download/v{VERSION}'
ARTIFACTS = {
    'win32': ('llama_cpp_python-0.3.36-py3-none-win_amd64.whl', 'ae5e88a2cf464e5a2dde7c8898c2d5c71cc24d03cac6396bf7509456bde0b9fb'),
    'linux': ('llama_cpp_python-0.3.36-py3-none-manylinux2014_x86_64.manylinux_2_17_x86_64.whl', 'c8a3e98093e950d7a770f794842e36f2db82b2933e8762ed7b5ffd435011e8e4'),
    'source': ('llama_cpp_python-0.3.36.tar.gz', '6eed0d1931e1b6ee6ea43bd320ea438c6494bddac4e46e5133afc3b10594964f'),
}


def download(directory, kind):
    name, expected = ARTIFACTS[kind]
    target = directory / name
    digest = hashlib.sha256()
    with urlopen(BASE + '/' + name, timeout=90) as response, target.open('wb') as out:
        while chunk := response.read(1024 * 1024):
            digest.update(chunk); out.write(chunk)
    if digest.hexdigest() != expected:
        target.unlink()
        raise RuntimeError('Translation runtime SHA-256 mismatch')
    return target


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--flavor', choices=['cpu', 'cuda', 'cu124'], default='cpu')
    parser.add_argument('--python', default=sys.executable)
    args = parser.parse_args()
    if sys.platform not in {'win32', 'linux'} or platform.machine().lower() not in {'amd64', 'x86_64'}:
        raise RuntimeError('This preparation script supports Windows/Linux x64; configure an existing compatible Python for other platforms.')
    subprocess.run([args.python, '-m', 'pip', 'install', '-r', str(Path(__file__).with_name('requirements.txt'))], check=True)
    with tempfile.TemporaryDirectory(prefix='yukino-translation-runtime-') as temp:
        cuda = args.flavor != 'cpu'
        archive = download(Path(temp), 'source' if cuda else sys.platform)
        env = os.environ.copy()
        if cuda:
            env['CMAKE_ARGS'] = '-DGGML_CUDA=ON -DGGML_RPC=OFF'
            env['CMAKE_BUILD_PARALLEL_LEVEL'] = '4'
            env['FORCE_CMAKE'] = '1'
        subprocess.run([args.python, '-m', 'pip', 'install', '--force-reinstall', '--no-deps', str(archive)], check=True, env=env)
    smoke = (f"import sys; sys.path.insert(0, {str(Path(__file__).parent.resolve())!r}); "
             "from worker import prepare_windows_dlls; prepare_windows_dlls(); "
             "import llama_cpp; print('translation runtime', llama_cpp.__version__, "
             "'GPU available', llama_cpp.llama_supports_gpu_offload())")
    subprocess.run([args.python, '-c', smoke], check=True)



if __name__ == '__main__':
    main()
