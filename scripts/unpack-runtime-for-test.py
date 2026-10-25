"""Reconstruct the exact distributed runtime for CI smoke tests, verifying every byte."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import stat
import tempfile
import zipfile

spec = importlib.util.spec_from_file_location('runtime_packager', Path(__file__).with_name('package-runtime.py'))
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


def unpack(directory, output, flavor):
    directory, output = Path(directory), Path(output)
    catalog = packager.validate_catalog(json.loads((directory / 'runtime-catalog.json').read_text(encoding='utf-8')))
    variant = catalog['variants'][flavor]
    if output.exists() and any(output.iterdir()):
        raise ValueError('Test extraction directory must be empty')
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='runtime-verify-') as temp:
        archive = Path(temp) / 'runtime.zip'
        digest = hashlib.sha256()
        with archive.open('wb') as target:
            for part in variant['parts']:
                file = directory / part['path']
                if file.stat().st_size != part['bytes']:
                    raise ValueError('Runtime part length mismatch')
                current = hashlib.sha256()
                with file.open('rb') as source:
                    for block in iter(lambda: source.read(1024 * 1024), b''):
                        target.write(block); current.update(block); digest.update(block)
                if current.hexdigest() != part['digest']:
                    raise ValueError('Runtime part digest mismatch')
        if digest.hexdigest() != variant['archiveSha256']:
            raise ValueError('Runtime archive digest mismatch')
        with zipfile.ZipFile(archive) as bundle:
            seen = set(); total = 0
            for item in bundle.infolist():
                parts = item.filename.split('/')
                if parts[0] not in {'python-runtime', 'inference-engine'} or any(p in {'', '.', '..'} for p in parts) or '\\' in item.filename or ':' in item.filename or stat.S_ISLNK(item.external_attr >> 16) or item.filename.casefold() in seen:
                    raise ValueError('Unsafe runtime ZIP entry')
                seen.add(item.filename.casefold()); total += item.file_size
            if total != variant['unpackedBytes']:
                raise ValueError('Runtime unpacked length mismatch')
            bundle.extractall(output)
    print(json.dumps({'verified': True, 'flavor': flavor, 'bytes': variant['bytes']}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--flavor', choices=['cpu', 'cu124'], default='cpu')
    args = parser.parse_args()
    unpack(args.directory, args.output, args.flavor)
