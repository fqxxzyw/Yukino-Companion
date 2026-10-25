"""Prepare one usable default voice without checking large weights into Git.

Downloads only the pinned user-published GPT e2 / SoVITS e1 pair. Reference audio
and its verified transcription come from the small checked-in preset directory.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import shutil
from urllib.request import Request, urlopen
from zipfile import ZipFile

PROJECT = Path(__file__).resolve().parents[1]


def digest(file):
    value = hashlib.sha256()
    with Path(file).open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def verify(file, size, sha):
    return file.is_file() and file.stat().st_size == size and digest(file) == sha


def within(root, name):
    if not isinstance(name, str) or '\\' in name or Path(name).is_absolute() or any(part in {'..', '.', ''} for part in name.split('/')):
        raise ValueError('Invalid resource path')
    target = (root / name).resolve()
    if not target.is_relative_to(root.resolve()):
        raise ValueError('Resource path escapes bundle')
    return target


def acquire(item, output, cache):
    target = within(output, item['path'])
    if verify(target, item['bytes'], item['digest']):
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    # Support a prior verified download cache without copying arbitrary files.
    candidates = [within(cache, item['path']), cache / Path(item['path']).name]
    if item.get('extract'):
        candidates.append(cache / 'SoVITS_weights.zip')
    for candidate in candidates:
        if verify(candidate, item['bytes'], item['digest']):
            shutil.copy2(candidate, target)
            return target
    temporary = target.with_name(target.name + '.part')
    request = Request(item['url'], headers={'User-Agent': 'Yukino-Companion-Voice-Bundle/1.0'})
    received = 0
    with urlopen(request, timeout=120) as response, temporary.open('wb') as stream:
        while chunk := response.read(1024 * 1024):
            received += len(chunk)
            if received > item['bytes']:
                raise ValueError('Voice download exceeds pinned length')
            stream.write(chunk)
    if not verify(temporary, item['bytes'], item['digest']):
        temporary.unlink(missing_ok=True)
        raise ValueError('Voice download checksum mismatch')
    temporary.replace(target)
    return target


def prepare(output, cache):
    catalog = json.loads((PROJECT / 'resources/voice-models.json').read_text(encoding='utf-8'))
    preset_root = PROJECT / 'resources/voice-presets'
    preset = json.loads((preset_root / 'yukino-default.json').read_text(encoding='utf-8'))
    pack = catalog['packs'][preset['packId']]
    output.mkdir(parents=True, exist_ok=True)
    files = []
    for item in pack['files']:
        extraction = item.get('extract')
        destination = within(output, extraction['path']) if extraction else None
        if extraction and verify(destination, extraction['bytes'], extraction['digest']):
            files.append({'kind': 'sovits', 'path': extraction['path'], 'bytes': extraction['bytes'], 'sha256': extraction['digest']})
            continue
        source = acquire(item, output, cache)
        if extraction:
            if not verify(destination, extraction['bytes'], extraction['digest']):
                destination.parent.mkdir(parents=True, exist_ok=True)
                temporary = destination.with_name(destination.name + '.part')
                with ZipFile(source) as archive:
                    member = archive.getinfo(extraction['member'])
                    if member.file_size != extraction['bytes'] or member.is_dir():
                        raise ValueError('Pinned SoVITS member length mismatch')
                    with archive.open(member) as incoming, temporary.open('wb') as target:
                        shutil.copyfileobj(incoming, target)
                if not verify(temporary, extraction['bytes'], extraction['digest']):
                    temporary.unlink(missing_ok=True)
                    raise ValueError('Pinned SoVITS member checksum mismatch')
                temporary.replace(destination)
            files.append({'kind': 'sovits', 'path': extraction['path'], 'bytes': extraction['bytes'], 'sha256': extraction['digest']})
            # Only the extracted trained weight ships, not a duplicate ZIP.
            source.unlink()
        else:
            files.append({'kind': 'gpt', 'path': item['path'], 'bytes': item['bytes'], 'sha256': item['digest']})
    reference = preset['reference']
    reference_source = within(preset_root, reference['sourcePath'])
    if not verify(reference_source, reference['bytes'], reference['sha256']):
        raise ValueError('Reference audio checksum mismatch')
    reference_target = within(output, reference['path'])
    reference_target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(reference_source, reference_target)
    files.append({'kind': 'reference', 'path': reference['path'], 'bytes': reference['bytes'], 'sha256': reference['sha256']})
    manifest = {key: value for key, value in preset.items() if key != 'reference'}
    manifest['files'] = files
    (output / 'preset.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'id': manifest['id'], 'files': files, 'totalBytes': sum(item['bytes'] for item in files)}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=PROJECT / 'build/bundled-voice')
    parser.add_argument('--cache', type=Path, default=PROJECT / 'build/voice-downloads')
    arguments = parser.parse_args()
    prepare(arguments.output.resolve(), arguments.cache.resolve())
