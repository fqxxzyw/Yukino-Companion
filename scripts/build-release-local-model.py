"""CI: rebuild the offline model from the actually trained LoRA transfer archive.

Run on a fresh Ubuntu Python 3.12 builder. This intentionally installs pinned CPU
build dependencies and downloads a pinned public base model. It never trains or
substitutes an untrained model when the supplied adapter is missing.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
BASE = 'Qwen/Qwen2.5-1.5B-Instruct'
REVISION = '989aa7980e4cf806f80c7fef2b1adb7bc71aa306'
CONVERTER = 'b3fa69955ea81c3b60e77e3c1e2224c4a826ffb9'


def sha(file):
    value = hashlib.sha256()
    with Path(file).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def inside(root, name):
    file = (root / name).resolve()
    if not isinstance(name, str) or Path(name).is_absolute() or not file.is_relative_to(root.resolve()):
        raise ValueError('Unsafe transfer/archive path')
    return file


def join_transfer(directory, destination):
    manifest = json.loads((directory / 'model-parts.json').read_text(encoding='utf-8'))
    meta, parts = manifest['archive'], manifest['parts']
    name = meta['name']
    if Path(name).name != name or not name.endswith('.zip') or not 0 < meta['bytes'] <= 256 * 1024**2:
        raise ValueError('Invalid LoRA archive metadata')
    if not isinstance(parts, list) or not parts or len(parts) > 256:
        raise ValueError('Invalid LoRA transfer parts')
    destination.mkdir(parents=True, exist_ok=True)
    archive = destination / name
    temporary = archive.with_suffix('.zip.partial')
    with temporary.open('wb') as target:
        for part in parts:
            file = inside(directory, part['path'])
            if not file.is_file() or file.stat().st_size != part['bytes'] or sha(file) != part['sha256']:
                raise ValueError('LoRA transfer part integrity check failed: ' + part['path'])
            with file.open('rb') as source:
                shutil.copyfileobj(source, target, 1024 * 1024)
    if temporary.stat().st_size != meta['bytes'] or sha(temporary) != meta['sha256']:
        raise ValueError('Joined LoRA archive integrity check failed')
    temporary.replace(archive)
    return archive


def extract_verified(archive, destination):
    destination.mkdir(parents=True, exist_ok=False)
    with zipfile.ZipFile(archive) as package:
        names = package.namelist()
        if len(names) != len(set(names)) or sum(info.file_size for info in package.infolist()) > 256 * 1024**2:
            raise ValueError('Duplicate or excessive LoRA archive entries')
        manifest = json.loads(package.read('MANIFEST.json'))
        if set(names) != set(manifest['files']) | {'MANIFEST.json'}:
            raise ValueError('LoRA archive entries do not match inventory')
        if manifest.get('baseModel') != BASE or manifest.get('baseRevision') != REVISION:
            raise ValueError('LoRA base model/revision mismatch')
        for info in package.infolist():
            file = inside(destination, info.filename)
            if info.is_dir() or stat.S_ISLNK(info.external_attr >> 16):
                raise ValueError('Directories/symlinks are not permitted in adapter archive')
            file.parent.mkdir(parents=True, exist_ok=True)
            with package.open(info) as source, file.open('wb') as target:
                shutil.copyfileobj(source, target, 1024 * 1024)
            if info.filename != 'MANIFEST.json' and sha(file) != manifest['files'][info.filename]:
                raise ValueError('LoRA archive file integrity failed: ' + info.filename)
    report = json.loads((destination / 'training_report.json').read_text(encoding='utf-8'))
    if report.get('completed') is not True or report.get('task') != 'complete_persona' or report.get('run_purpose') != 'training' or report.get('steps', 0) <= 1:
        raise ValueError('A real completed personality continuation run is required')
    if report.get('base_revision') != REVISION or report.get('adapter_sha256') != sha(destination / 'adapter/adapter_model.safetensors'):
        raise ValueError('Adapter does not match completed training report')


def run(command, **kwargs):
    print('+', ' '.join(map(str, command)), flush=True)
    subprocess.run(list(map(str, command)), check=True, **kwargs)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    source = p.add_mutually_exclusive_group(required=True)
    source.add_argument('--transfer', type=Path)
    source.add_argument('--adapter-archive', type=Path, help='Already downloaded authorized release/build artifact')
    p.add_argument('--adapter-sha256', help='Required with --adapter-archive')
    p.add_argument('--output', type=Path, default=ROOT / 'resources/local-model/yukino-1.5b-persona-q4')
    p.add_argument('--work-dir', type=Path, default=ROOT / 'build/local-model-build')
    p.add_argument('--skip-install', action='store_true', help='Use an already prepared compatible builder')
    a = p.parse_args()
    work = a.work_dir.resolve()
    if work.exists() and any(work.iterdir()):
        p.error('Work directory must be empty; do not reuse an unfinished conversion')
    if a.output.exists() and any(file.suffix == '.gguf' for file in a.output.iterdir()):
        p.error('Output already contains model weights')
    work.mkdir(parents=True, exist_ok=True)
    distribution = ROOT / 'build/model-distribution'
    if a.transfer:
        archive = join_transfer(a.transfer.resolve(), distribution)
    else:
        if not a.adapter_sha256 or sha(a.adapter_archive) != a.adapter_sha256:
            p.error('The supplied adapter archive must match --adapter-sha256')
        distribution.mkdir(parents=True, exist_ok=True)
        archive = distribution / a.adapter_archive.name
        if archive.resolve() != a.adapter_archive.resolve():
            shutil.copyfile(a.adapter_archive, archive)
    extracted = work / 'trained-adapter'
    extract_verified(archive, extracted)
    if not a.skip_install:
        run([sys.executable, '-m', 'pip', 'install', '--disable-pip-version-check', '--no-cache-dir',
             '--index-url', 'https://download.pytorch.org/whl/cpu', 'torch==2.6.0'])
        run([sys.executable, '-m', 'pip', 'install', '--disable-pip-version-check', '--no-cache-dir',
             'transformers==4.57.6', 'peft==0.18.1', 'accelerate==1.12.0',
             'huggingface_hub==0.36.2', 'psutil==7.2.1', 'numpy==2.2.6',
             'safetensors==0.6.2', 'sentencepiece==0.2.0', 'protobuf==4.25.8'])
    converter = work / 'llama.cpp'
    run(['git', 'init', converter])
    run(['git', '-C', converter, 'remote', 'add', 'origin', 'https://github.com/ggml-org/llama.cpp.git'])
    run(['git', '-C', converter, 'fetch', '--depth', '1', 'origin', CONVERTER])
    run(['git', '-C', converter, 'checkout', '--detach', 'FETCH_HEAD'])
    if subprocess.check_output(['git', '-C', str(converter), 'rev-parse', 'HEAD'], text=True).strip() != CONVERTER:
        raise ValueError('Converter revision mismatch')
    run(['cmake', '-S', converter, '-B', converter / 'build', '-DCMAKE_BUILD_TYPE=Release',
         '-DGGML_NATIVE=OFF', '-DLLAMA_BUILD_TESTS=OFF', '-DLLAMA_CURL=OFF'])
    run(['cmake', '--build', converter / 'build', '--target', 'llama-quantize', '--parallel', '2'])
    from huggingface_hub import snapshot_download
    base = Path(snapshot_download(BASE, revision=REVISION, local_dir=work / 'base',
        allow_patterns=['*.json', '*.safetensors', '*.txt', 'LICENSE'], max_workers=3))
    env = {**os.environ, 'PYTHONPATH': str(ROOT / 'model-service'), 'OMP_NUM_THREADS': '2', 'MKL_NUM_THREADS': '2'}
    run([sys.executable, '-c', 'from yuki_model.training import merge,REVISION; import sys; merge(sys.argv[1],sys.argv[2],sys.argv[3],REVISION)',
         base, extracted / 'adapter', work / 'merged'], cwd=ROOT, env=env)
    run([sys.executable, ROOT / 'model-service/scripts/export_gguf.py', '--llama-cpp', converter,
         '--merged', work / 'merged', '--quantizer', converter / 'build/bin/llama-quantize',
         '--training-report', extracted / 'training_report.json', '--base-license', base / 'LICENSE',
         '--output', a.output.resolve(), '--work-dir', work / 'conversion', '--threads', '2'], cwd=ROOT, env=env)
    print(json.dumps({'output': str(a.output.resolve()), 'adapterArchive': str(archive),
        'adapterArchiveSha256': sha(archive), 'baseRevision': REVISION, 'converterCommit': CONVERTER}))


if __name__ == '__main__':
    main()
