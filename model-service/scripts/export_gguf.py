"""Export merged HF weights with an audited training report and distributable manifest.

Temporary FP16 weights live outside the shipping directory. Quantization uses an
explicit llama-quantize binary or the installed llama-cpp-python shared library.
Neither path downloads models or compiles software implicitly.
"""
import argparse
import ctypes
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

from yuki_model.io import file_sha, save_json
from yuki_model.training import BASE, REVISION


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--llama-cpp', type=Path, required=True)
    p.add_argument('--merged', type=Path, required=True)
    p.add_argument('--quantizer', type=Path)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--work-dir', type=Path)
    p.add_argument('--training-report', type=Path, required=True)
    p.add_argument('--base-license', type=Path, required=True)
    p.add_argument('--threads', type=int, default=min(8, os.cpu_count() or 1))
    a = p.parse_args()
    report = json.loads(a.training_report.read_text(encoding='utf-8'))
    if report.get('completed') is not True or report.get('run_purpose') != 'training' or report.get('steps', 0) <= 1:
        p.error('Shipping requires a completed training run, not a one-step smoke check')
    if report.get('base_revision') != REVISION:
        p.error('Training base revision does not match the pinned Qwen base')
    if not a.base_license.is_file() or not 1 <= a.threads <= 128:
        p.error('Supply the base model license and a valid thread count')
    work = a.work_dir or a.output.parent / ('.conversion-' + a.output.name)
    if work.resolve() == a.output.resolve() or a.output.resolve() in work.resolve().parents:
        p.error('FP16 working directory must be outside the shipping output directory')
    a.output.mkdir(parents=True, exist_ok=True)
    work.mkdir(parents=True, exist_ok=True)
    fp16 = work / 'yukino-f16.gguf'
    q4 = a.output / 'yukino-persona-q4_k_m.gguf'
    temporary = work / 'yukino-persona-q4_k_m.partial.gguf'
    if fp16.exists() or q4.exists() or temporary.exists():
        p.error('Output GGUF already exists; choose a new output/work directory')
    commit = subprocess.check_output(['git', '-C', str(a.llama_cpp), 'rev-parse', 'HEAD'], text=True).strip()
    subprocess.run([sys.executable, str(a.llama_cpp / 'convert_hf_to_gguf.py'),
        str(a.merged), '--outfile', str(fp16), '--outtype', 'f16'], check=True)
    if a.quantizer:
        subprocess.run([str(a.quantizer.resolve()), str(fp16), str(temporary), 'Q4_K_M', str(a.threads)], check=True)
        quantizer = {'binary': a.quantizer.name, 'sha256': file_sha(a.quantizer)}
    else:
        import llama_cpp
        params = llama_cpp.llama_model_quantize_default_params()
        params.ftype = llama_cpp.LLAMA_FTYPE_MOSTLY_Q4_K_M
        params.nthread = a.threads
        result = llama_cpp.llama_model_quantize(os.fsencode(fp16), os.fsencode(temporary), ctypes.byref(params))
        if result != 0:
            raise RuntimeError(f'llama.cpp quantization failed with code {result}')
        quantizer = {'runtime': 'llama-cpp-python', 'version': llama_cpp.__version__}
    if not temporary.is_file() or temporary.stat().st_size < 100_000_000:
        raise RuntimeError('Quantizer did not produce complete model weights')
    shutil.move(str(temporary), q4)
    shutil.copyfile(a.base_license, a.output / 'BASE_LICENSE.txt')
    save_json(a.output / 'training_report.json', report)
    save_json(a.output / 'manifest.json', {
        'schemaVersion': 1, 'name': '雪乃本地角色模型 · Qwen 1.5B · 人格续训 v1.2',
        'file': q4.name, 'bytes': q4.stat().st_size, 'sha256': file_sha(q4),
        'baseModel': BASE, 'baseRevision': REVISION, 'baseLicense': 'Apache-2.0',
        'quantization': 'Q4_K_M', 'llamaCppConverterCommit': commit,
        'quantizer': quantizer, 'sameWeightsCpuGpu': True,
        'training': {'completed': True, 'task': report.get('task'),
            'runPurpose': report['run_purpose'], 'steps': report['steps'],
            'adapterSha256': report.get('adapter_sha256'),
            'beforeEvalLoss': report.get('before', {}).get('eval_loss'),
            'afterEvalLoss': report.get('after', {}).get('eval_loss'),
            'qualityClaim': report.get('quality_claim')},
        'limitations': ['Small-model generations may contain factual errors.',
            'Validation loss is not a character-fidelity or general-knowledge score.',
            'GPU execution requires a compatible runtime and actual offload.'],
    })
    print(q4)


if __name__ == '__main__':
    main()
