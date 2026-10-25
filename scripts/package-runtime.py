"""Package the shared Windows inference runtime independently of model weights.

Example:
  python scripts/package-runtime.py --flavor cpu --tag v0.4.0-local.1
  python scripts/package-runtime.py --merge cpu.json cuda.json --output build/runtime-distribution

The ordered parts form one ordinary ZIP64 archive. Concatenate in catalog order,
verify archiveSha256, then extract only the two documented roots. This script
never downloads resources or installs dependencies.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import tempfile
from urllib.parse import quote
import zipfile

VERSION = '0.4.0'
MAX_PART_BYTES = 900 * 1024 * 1024
RELEASE_BASE = 'https://github.com/fqxxzyw/Yukino-Companion/releases/download/'
FLAVORS = ('cpu', 'cu124')
PROJECT = Path(__file__).resolve().parents[1]
CHUNK = 1024 * 1024


def _json(path: Path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def _files(source: Path, prefix: str):
    """Walk without following links or Windows junctions and reject model payloads."""
    source = Path(source)
    if source.is_symlink() or (hasattr(source, 'is_junction') and source.is_junction()):
        raise ValueError(f'Runtime root must not be a link: {source}')
    source = source.resolve()
    if not source.is_dir():
        raise ValueError(f'Missing runtime directory: {source}')
    entries = []
    for folder, directories, files in os.walk(source, followlinks=False):
        for name in directories + files:
            item = Path(folder) / name
            mode = item.lstat().st_mode
            if stat.S_ISLNK(mode) or (hasattr(item, 'is_junction') and item.is_junction()):
                raise ValueError(f'Runtime contains a link: {item}')
            if item.is_dir():
                continue
            if not stat.S_ISREG(mode):
                raise ValueError(f'Runtime contains a non-regular file: {item}')
            relative = item.relative_to(source).as_posix()
            suffix = item.suffix.lower()
            # Third-party wheels can legitimately contain small model fixtures,
            # .pt templates or .onnx resources required by that library. Their
            # own package tree is preserved; our chat/translation/voice weights
            # belong outside these runtime roots and are never selected here.
            library_resource = prefix == 'python-runtime' and relative.casefold().startswith('lib/site-packages/')
            if not library_resource and (suffix in {'.gguf', '.safetensors', '.ckpt'} or (
                prefix == 'inference-engine' and (suffix == '.pth' or item.name.lower() == 'pytorch_model.bin')
            )):
                raise ValueError(f'Model weights must be distributed separately: {item}')
            if '\\' in relative or ':' in relative or any(part in {'.', '..'} for part in relative.split('/')):
                raise ValueError(f'Unsafe ZIP entry: {relative}')
            entries.append((item, f'{prefix}/{relative}', item.stat()))
    return sorted(entries, key=lambda entry: entry[1])


def _split_archive(archive: Path, directory: Path, stem: str, tag: str, part_bytes: int):
    archive_hash = hashlib.sha256()
    parts = []
    with archive.open('rb') as source:
        index = 1
        while True:
            first = source.read(min(CHUNK, part_bytes))
            if not first:
                break
            name = f'{stem}.zip.part{index:03d}'
            digest = hashlib.sha256()
            size = 0
            with (directory / name).open('wb') as target:
                block = first
                while block:
                    target.write(block)
                    digest.update(block)
                    archive_hash.update(block)
                    size += len(block)
                    if size == part_bytes:
                        break
                    block = source.read(min(CHUNK, part_bytes - size))
            parts.append({'path': name, 'bytes': size, 'algorithm': 'sha256',
                          'digest': digest.hexdigest(),
                          'url': RELEASE_BASE + quote(tag, safe='') + '/' + quote(name, safe='')})
            index += 1
    return parts, archive_hash.hexdigest()


def validate_catalog(catalog):
    if catalog.get('schemaVersion') != 1 or catalog.get('version') != VERSION:
        raise ValueError('Incompatible runtime catalog schema/version')
    variants = catalog.get('variants')
    if not isinstance(variants, dict) or not variants:
        raise ValueError('Runtime catalog has no variants')
    for flavor, variant in variants.items():
        if flavor not in FLAVORS or not isinstance(variant, dict):
            raise ValueError('Unsupported runtime flavor')
        if variant.get('id') != f'windows-x64-{flavor}':
            raise ValueError('Runtime variant ID does not match flavor')
        if not re.fullmatch(r'[0-9a-f]{64}', variant.get('archiveSha256', '')):
            raise ValueError('Missing archive SHA-256')
        if not isinstance(variant.get('unpackedBytes'), int) or variant['unpackedBytes'] <= 0:
            raise ValueError('Invalid unpacked byte count')
        parts = variant.get('parts')
        if not isinstance(parts, list) or not parts:
            raise ValueError('Runtime variant has no parts')
        seen = set()
        for index, part in enumerate(parts, 1):
            expected_name = f'Yukino-Runtime-{VERSION}-windows-x64-{flavor}.zip.part{index:03d}'
            if part.get('path') != expected_name or part['path'] in seen:
                raise ValueError('Runtime parts must be safe and sequential')
            seen.add(part['path'])
            if not isinstance(part.get('bytes'), int) or not 0 < part['bytes'] <= MAX_PART_BYTES:
                raise ValueError('Runtime part exceeds the 900 MiB bound or is empty')
            if part.get('algorithm') != 'sha256' or not re.fullmatch(r'[0-9a-f]{64}', part.get('digest', '')):
                raise ValueError('Invalid runtime part digest')
            url = part.get('url', '')
            if not url.startswith(RELEASE_BASE) or not url.endswith('/' + expected_name):
                raise ValueError('Invalid runtime release URL')
        if variant.get('bytes') != sum(part['bytes'] for part in parts):
            raise ValueError('Runtime total bytes do not match its ordered parts')
    return catalog


def package_runtime(runtime: Path, engine: Path, output: Path, *, flavor: str, tag: str,
                    part_bytes: int = MAX_PART_BYTES):
    if flavor not in FLAVORS:
        raise ValueError('Unsupported runtime flavor')
    if not isinstance(part_bytes, int) or not 0 < part_bytes <= MAX_PART_BYTES:
        raise ValueError('Part size must be between 1 byte and 900 MiB')
    if not tag or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._/-]*', tag) or '..' in tag.split('/'):
        raise ValueError('A safe GitHub release tag is required')
    runtime, engine, output = Path(runtime), Path(engine), Path(output).resolve()
    for source in (runtime, engine):
        if output == source.resolve() or output.is_relative_to(source.resolve()):
            raise ValueError('Output must be outside the packaged runtime directories')
    marker = _json(runtime / 'yukino-runtime-build.json')
    if marker.get('flavor') != flavor:
        raise ValueError('Runtime build marker does not match requested flavor')
    for required in (runtime / 'python.exe', engine / 'yukino-runtime.json'):
        if not required.is_file() or not required.stat().st_size:
            raise ValueError(f'Missing required runtime file: {required}')
    entries = _files(runtime, 'python-runtime') + _files(engine, 'inference-engine')
    output.mkdir(parents=True, exist_ok=True)
    stem = f'Yukino-Runtime-{VERSION}-windows-x64-{flavor}'
    with tempfile.TemporaryDirectory(prefix='.runtime-package-', dir=output) as temp:
        temporary = Path(temp)
        archive = temporary / f'{stem}.zip'
        with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED,
                             allowZip64=True, compresslevel=6) as bundle:
            for source, name, before in entries:
                # Deterministic timestamps and regular-file mode. force_zip64 also
                # supports a single DLL/package file above the classic ZIP limit.
                info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                info.create_system = 3
                info.external_attr = (stat.S_IFREG | 0o644) << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                info.file_size = before.st_size
                with source.open('rb') as source_file, bundle.open(info, 'w', force_zip64=True) as target:
                    shutil.copyfileobj(source_file, target, CHUNK)
                after = source.stat()
                if (after.st_size, after.st_mtime_ns) != (before.st_size, before.st_mtime_ns):
                    raise ValueError(f'Runtime changed during packaging: {source}')
        parts, archive_hash = _split_archive(archive, temporary, stem, tag, part_bytes)
        variant = {'id': f'windows-x64-{flavor}', 'bytes': archive.stat().st_size,
                   'unpackedBytes': sum(entry[2].st_size for entry in entries),
                   'archiveSha256': archive_hash, 'parts': parts}
        catalog = validate_catalog({'schemaVersion': 1, 'version': VERSION, 'variants': {flavor: variant}})
        filename = f'runtime-catalog-{flavor}.json'
        (temporary / filename).write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        # Install the catalog last. A failed generation never exposes a new
        # catalog that points at parts which were not fully generated.
        for part in parts:
            os.replace(temporary / part['path'], output / part['path'])
        os.replace(temporary / filename, output / filename)
    return catalog


def merge_catalogs(inputs, output: Path):
    variants = {}
    for source in inputs:
        catalog = validate_catalog(_json(Path(source)))
        for flavor, variant in catalog['variants'].items():
            if flavor in variants and variants[flavor] != variant:
                raise ValueError(f'Conflicting catalogs for {flavor}')
            variants[flavor] = variant
    merged = validate_catalog({'schemaVersion': 1, 'version': VERSION,
                               'variants': dict(sorted(variants.items()))})
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    destination = output / 'runtime-catalog.json'
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=output,
                                     prefix='.runtime-catalog-', suffix='.tmp', delete=False) as handle:
        temporary = Path(handle.name)
        json.dump(merged, handle, ensure_ascii=False, indent=2)
        handle.write('\n')
    try:
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)
    return merged


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--flavor', choices=FLAVORS, default='cpu')
    parser.add_argument('--tag', help='Target GitHub Release tag (required when packaging)')
    parser.add_argument('--output', type=Path, default=PROJECT / 'build/runtime-distribution')
    parser.add_argument('--runtime-dir', type=Path, default=PROJECT / 'build/python-runtime')
    parser.add_argument('--engine-dir', type=Path, default=PROJECT / 'build/inference-engine')
    parser.add_argument('--part-bytes', type=int, default=MAX_PART_BYTES, help='Maximum part size, capped at 900 MiB')
    parser.add_argument('--merge', nargs='+', type=Path, help='Merge pre-generated flavor catalogs instead of packaging')
    args = parser.parse_args()
    try:
        if args.merge:
            result = merge_catalogs(args.merge, args.output)
        else:
            result = package_runtime(args.runtime_dir, args.engine_dir, args.output,
                                     flavor=args.flavor, tag=args.tag, part_bytes=args.part_bytes)
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        parser.exit(1, f'Runtime packaging failed: {error}\n')
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
