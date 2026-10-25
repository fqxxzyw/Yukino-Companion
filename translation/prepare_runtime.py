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
import shutil
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


def diagnose_windows_cuda(python):
    """Expose actual built DLL imports before the required runtime import check."""
    packages = Path(subprocess.check_output(
        [python, '-c', "import sysconfig;print(sysconfig.get_paths()['platlib'])"], text=True).strip())
    library = packages / 'llama_cpp/lib'
    print('Built llama DLLs:', ', '.join(sorted(file.name for file in library.glob('*.dll'))), flush=True)
    driver = Path(os.environ.get('SystemRoot', r'C:\Windows')) / 'System32/nvcuda.dll'
    print('NVIDIA driver DLL present:', driver.is_file(), flush=True)
    dumpbin = shutil.which('dumpbin')
    if not dumpbin:
        raise RuntimeError('CUDA Windows build requires dumpbin to verify actual DLL dependencies')
    for name in ('llama.dll', 'ggml.dll', 'ggml-cuda.dll'):
        file = library / name
        if not file.is_file():
            raise RuntimeError(f'CUDA wheel is missing {name}')
        result = subprocess.run([dumpbin, '/NOLOGO', '/DEPENDENTS', str(file)],
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        print(result.stdout, flush=True)
        result.check_returncode()
        if any(line.strip().casefold() == 'nvcuda.dll' for line in result.stdout.splitlines()):
            raise RuntimeError(f'{name} still directly imports the NVIDIA driver; CPU fallback would fail without a driver')


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
            if sys.platform == 'win32':
                # The fixed upstream CUDA target otherwise imports nvcuda.dll
                # directly for VMM. A GPU-less Windows machine must still be
                # able to import this runtime and use its CPU fallback.
                # Upstream ggml-cuda/CMakeLists.txt links cuda_driver only when
                # GGML_CUDA_NO_VMM is OFF; CUDA inference remains enabled.
                env['CMAKE_ARGS'] += ' -DGGML_CUDA_NO_VMM=ON'
            env['CMAKE_BUILD_PARALLEL_LEVEL'] = '4'
            env['FORCE_CMAKE'] = '1'
            print('CUDA build options:', env['CMAKE_ARGS'], flush=True)
        subprocess.run([args.python, '-m', 'pip', 'install', '--force-reinstall', '--no-deps', str(archive)], check=True, env=env)
    if cuda and sys.platform == 'win32':
        diagnose_windows_cuda(args.python)
    smoke = (f"import sys; sys.path.insert(0, {str(Path(__file__).parent.resolve())!r}); "
             "from worker import prepare_windows_dlls; prepare_windows_dlls(); "
             "import llama_cpp; print('translation runtime', llama_cpp.__version__, "
             "'GPU available', llama_cpp.llama_supports_gpu_offload())")
    subprocess.run([args.python, '-c', smoke], check=True)



if __name__ == '__main__':
    main()
