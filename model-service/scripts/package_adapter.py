"""Package completed continuation weights without source novels, indexes or checkpoints."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

from yuki_model.io import file_sha
from yuki_model.training import BASE, REVISION


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--run', type=Path, required=True)
    p.add_argument('--base-license', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    a = p.parse_args()
    if a.output.exists():
        p.error('Output already exists')
    report = json.loads((a.run / 'training_report.json').read_text(encoding='utf-8'))
    adapter = a.run / 'adapter'
    weights = adapter / 'adapter_model.safetensors'
    if not report.get('completed') or report.get('run_purpose') != 'training' or report.get('steps', 0) <= 1:
        p.error('A completed non-smoke training report is required')
    if report.get('base_revision') != REVISION or report.get('adapter_sha256') != file_sha(weights):
        p.error('Adapter/base provenance does not match the completed run')
    report['base_model'] = BASE
    generated = {'training_report.json': json.dumps(report, ensure_ascii=False, indent=2).encode('utf-8')}
    config = json.loads((adapter / 'adapter_config.json').read_text(encoding='utf-8'))
    config['base_model_name_or_path'] = BASE
    config['revision'] = REVISION
    generated['adapter/adapter_config.json'] = json.dumps(config, indent=2).encode('utf-8')
    inventory = {'adapter/adapter_model.safetensors': weights, 'BASE_LICENSE.txt': a.base_license,
                 'data_provenance.json': a.run / 'data_provenance.json'}
    for name in ['tokenizer.json', 'tokenizer_config.json', 'vocab.json', 'merges.txt', 'special_tokens_map.json', 'added_tokens.json']:
        file = adapter / name
        if file.is_file():
            inventory['adapter/' + name] = file
    generated['README.md'] = (
        '# Yukino personality continuation LoRA\n\n'
        f'Base: {BASE}\n\nPinned revision: `{REVISION}`.\n\n'
        'These are real continued adapter weights, not a complete standalone base model. '
        'Load this adapter once on the pinned Qwen base; do not stack the old knowledge adapter again. '
        'For desktop use, merge it into the base and convert to GGUF using the repository export script.\n\n'
        'The completed training report records the actual optimizer steps and validation losses. '
        'Training completion and lower validation loss do not establish complete novel knowledge or human acceptance of character fidelity. '
        'This archive contains no original novel text, retrieval database, optimizer state or credentials. '
        'The data manifest describes synthetic authored dialogue scenarios; its training_executed=false field is the frozen pre-training dataset state. '
        'The enclosing training_report.json completed=true records the subsequently executed training run.\n'
    ).encode('utf-8')
    manifest = {'schemaVersion': 1, 'baseModel': BASE, 'baseRevision': REVISION,
        'completedTraining': True, 'adapterSha256': report['adapter_sha256'],
        'files': {name: file_sha(file) for name, file in sorted(inventory.items())}}
    manifest['files'].update({name: hashlib.sha256(value).hexdigest() for name, value in generated.items()})
    a.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = a.output.with_suffix('.zip.partial')
    with zipfile.ZipFile(temporary, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, file in inventory.items():
            archive.write(file, name)
        for name, value in generated.items():
            archive.writestr(name, value)
        archive.writestr('MANIFEST.json', json.dumps(manifest, indent=2))
    with zipfile.ZipFile(temporary) as archive:
        if archive.testzip():
            raise RuntimeError('Adapter archive CRC failed')
    temporary.replace(a.output)
    print(json.dumps({'path': str(a.output.resolve()), 'bytes': a.output.stat().st_size,
        'sha256': file_sha(a.output)}, indent=2))


if __name__ == '__main__':
    main()
