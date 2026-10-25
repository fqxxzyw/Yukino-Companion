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
BASE_WEIGHTS_SHA256 = 'dd924a11b4c220f385b51ffa522daea7c9f3d850e31b162bb5661df483c6d3ee'
BASE_WEIGHTS_BYTES = 3087467144
CONVERTER = 'b3fa69955ea81c3b60e77e3c1e2224c4a826ffb9'
# Release 0.4.0 is tied to this completed continuation, independently of the
# transfer branch's own manifest. Updating these requires a new reviewed model.
ARCHIVE_SHA256 = 'fff8bdcb2df7f0bfa1a30d2983ca1e7498f241ee978d41a206db54ba456989e5'
ARCHIVE_BYTES = 38114354
ARCHIVE_NAME = 'Yukino-Persona-LoRA-0.4.0.zip'
ADAPTER_SHA256 = '21f347ebc4b8658705dfd601270955708814d37a18bf5272cd0bfa1878cfdb7b'
TRAINING_STEPS = 47


def sha(file):
    value = hashlib.sha256()
    with Path(file).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def inside(root, name):
    if not isinstance(name, str) or not name or '\\' in name:
        raise ValueError('Unsafe transfer/archive path')
    file = (root / name).resolve()
    if Path(name).is_absolute() or file == root.resolve() or not file.is_relative_to(root.resolve()):
        raise ValueError('Unsafe transfer/archive path')
    return file


def verify_release_archive(archive):
    if archive.stat().st_size != ARCHIVE_BYTES or sha(archive) != ARCHIVE_SHA256:
        raise ValueError('Release 0.4.0 requires the approved 47-step LoRA archive ' + ARCHIVE_SHA256)


def join_transfer(directory, destination):
    manifest = json.loads((directory / 'model-parts.json').read_text(encoding='utf-8'))
    meta, parts = manifest['archive'], manifest['parts']
    name = meta['name']
    if name != ARCHIVE_NAME or not 0 < meta['bytes'] <= 256 * 1024**2:
        raise ValueError('Invalid LoRA archive metadata')
    if meta['bytes'] != ARCHIVE_BYTES or meta['sha256'] != ARCHIVE_SHA256:
        raise ValueError('Transfer manifest does not identify the approved release LoRA')
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
    verify_release_archive(archive)
    return archive


def extract_verified(archive, destination):
    verify_release_archive(archive)
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
    if report.get('completed') is not True or report.get('task') != 'complete_persona' or report.get('run_purpose') != 'training' or report.get('steps') != TRAINING_STEPS:
        raise ValueError('A real completed personality continuation run is required')
    if report.get('base_revision') != REVISION or report.get('adapter_sha256') != ADAPTER_SHA256 or sha(destination / 'adapter/adapter_model.safetensors') != ADAPTER_SHA256:
        raise ValueError('Adapter does not match completed training report')


def run(command, **kwargs):
    print('+', ' '.join(map(str, command)), flush=True)
    subprocess.run(list(map(str, command)), check=True, **kwargs)


def verify_adapter_applied(base, merged):
    """Check a targeted tensor actually changed; an untouched base is not release output."""
    from safetensors import safe_open
    import torch
    key = 'model.layers.0.self_attn.q_proj.weight'
    with safe_open(str(base / 'model.safetensors'), framework='pt', device='cpu') as source:
        original = source.get_tensor(key).float()
    with safe_open(str(merged / 'model.safetensors'), framework='pt', device='cpu') as source:
        actual = source.get_tensor(key).float()
    if actual.shape != original.shape or not torch.isfinite(actual).all():
        raise ValueError('Merged adapter tensor is incompatible or non-finite')
    difference = (actual - original).abs()
    changed = int(torch.count_nonzero(difference).item())
    if not changed:
        raise ValueError('Merged output is unchanged base weights; the trained adapter was not applied')
    proof = {'checkedTensor': key, 'changedElements': changed,
             'maxAbsoluteDelta': float(difference.max().item()), 'adapterSha256': ADAPTER_SHA256,
             'scope': 'This verifies application of the approved adapter, not personality accuracy.'}
    (merged / 'merge-validation.json').write_text(json.dumps(proof, indent=2), encoding='utf-8')
    return proof


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
    output = a.output.resolve()
    if output.is_relative_to(work) or work.is_relative_to(output):
        p.error('Shipping output and disposable build directory must not overlap')
    if work.exists() and any(work.iterdir()):
        p.error('Work directory must be empty; do not reuse an unfinished conversion')
    if a.output.exists() and any(file.suffix == '.gguf' for file in a.output.iterdir()):
        p.error('Output already contains model weights')
    work.mkdir(parents=True, exist_ok=True)
    distribution = ROOT / 'build/model-distribution'
    if a.transfer:
        archive = join_transfer(a.transfer.resolve(), distribution)
    else:
        if a.adapter_sha256 != ARCHIVE_SHA256:
            p.error('The supplied adapter archive must match --adapter-sha256')
        verify_release_archive(a.adapter_archive)
        distribution.mkdir(parents=True, exist_ok=True)
        archive = distribution / ARCHIVE_NAME
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
         '-DGGML_NATIVE=OFF', '-DLLAMA_BUILD_TESTS=OFF', '-DLLAMA_BUILD_TOOLS=ON',
         '-DLLAMA_BUILD_COMMON=ON', '-DLLAMA_BUILD_APP=OFF', '-DLLAMA_BUILD_SERVER=OFF',
         '-DLLAMA_BUILD_EXAMPLES=OFF', '-DLLAMA_OPENSSL=OFF'])
    run(['cmake', '--build', converter / 'build', '--target', 'llama-quantize', '--parallel', '2'])
    if shutil.disk_usage(work).free < 8 * 1024**3:
        raise RuntimeError('Model rebuild needs at least 8 GiB free after dependencies/compiler build; free builder disk space before retrying')
    os.environ['HF_HOME'] = str(work / 'hf-cache')
    os.environ['HF_HUB_DISABLE_XET'] = '1'
    from huggingface_hub import snapshot_download
    base = Path(snapshot_download(BASE, revision=REVISION, local_dir=work / 'base',
        allow_patterns=['*.json', '*.safetensors', '*.txt', 'LICENSE'], max_workers=3))
    base_weights = base / 'model.safetensors'
    if base_weights.stat().st_size != BASE_WEIGHTS_BYTES or sha(base_weights) != BASE_WEIGHTS_SHA256:
        raise ValueError('Downloaded base weights do not match the pinned revision LFS checksum')
    env = {**os.environ, 'PYTHONPATH': str(ROOT / 'model-service'), 'OMP_NUM_THREADS': '2', 'MKL_NUM_THREADS': '2'}
    run([sys.executable, '-c', 'from yuki_model.training import merge,REVISION; import sys; merge(sys.argv[1],sys.argv[2],sys.argv[3],REVISION)',
         base, extracted / 'adapter', work / 'merged'], cwd=ROOT, env=env)
    verify_adapter_applied(base, work / 'merged')
    license_file = work / 'BASE_LICENSE.txt'
    shutil.copyfile(base / 'LICENSE', license_file)
    if base.resolve() != (work / 'base').resolve():
        raise ValueError('Downloaded base is outside this build working directory')
    # Base + merged + FP16 would otherwise retain ~9 GiB until ZIP packaging.
    # Only disposable files created by this build are removed; the original
    # adapter ZIP in model-distribution remains available for Release upload.
    shutil.rmtree(base)
    run([sys.executable, ROOT / 'model-service/scripts/export_gguf.py', '--llama-cpp', converter,
         '--merged', work / 'merged', '--quantizer', converter / 'build/bin/llama-quantize',
         '--training-report', extracted / 'training_report.json', '--base-license', license_file,
         '--output', a.output.resolve(), '--work-dir', work / 'conversion', '--threads', '2',
         '--remove-fp16'], cwd=ROOT, env=env)
    shutil.rmtree(work / 'merged')
    verify_release_archive(archive)
    print(json.dumps({'output': str(a.output.resolve()), 'adapterArchive': str(archive),
        'adapterArchiveSha256': sha(archive), 'adapterSha256': ADAPTER_SHA256,
        'trainingSteps': TRAINING_STEPS, 'baseRevision': REVISION,
        'baseWeightsSha256': BASE_WEIGHTS_SHA256, 'converterCommit': CONVERTER}))


if __name__ == '__main__':
    main()
