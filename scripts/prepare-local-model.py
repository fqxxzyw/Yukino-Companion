"""Import an actually trained GGUF archive; fail closed if no artifact is supplied.

Archive URLs are read only from YUKINO_LOCAL_MODEL_ARCHIVE_URL and never logged.
Accepted layout: manifest.json beside its GGUF, either at ZIP root or in one folder.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import tempfile
from urllib.request import Request, urlopen
import zipfile


def prepare(archive, output):
    output = Path(output).resolve()
    with tempfile.TemporaryDirectory(prefix='yukino-local-model-') as temporary:
        temp = Path(temporary)
        if archive:
            archive = Path(archive)
        else:
            url = os.environ.get('YUKINO_LOCAL_MODEL_ARCHIVE_URL', '')
            if not url.startswith('https://'):
                raise ValueError('Provide a real trained model archive or HTTPS artifact URL; no placeholder weights are generated')
            archive = temp / 'download.zip'
            try:
                with urlopen(Request(url, headers={'User-Agent': 'Yukino-Model-Build/0.4'}), timeout=120) as response, archive.open('wb') as out:
                    shutil.copyfileobj(response, out, 1024 * 1024)
            except Exception:
                raise RuntimeError('The trained model artifact could not be downloaded; URL omitted from logs') from None
        extracted = temp / 'model'
        with zipfile.ZipFile(archive) as bundle:
            seen = set()
            total = 0
            for item in bundle.infolist():
                name = item.filename
                parts = name.rstrip('/').split('/')
                if not name or '\\' in name or ':' in name or any(p in {'', '.', '..'} for p in parts) or name.startswith('/'):
                    raise ValueError('Unsafe model archive path')
                if stat.S_ISLNK(item.external_attr >> 16) or name.casefold() in seen:
                    raise ValueError('Model archive contains a link or duplicate entry')
                seen.add(name.casefold())
                total += item.file_size
                if total > 8 * 1024 ** 3:
                    raise ValueError('Model archive exceeds the expected size')
            bundle.extractall(extracted)
        manifests = list(extracted.rglob('manifest.json'))
        if len(manifests) != 1:
            raise ValueError('Expected one actual trained GGUF manifest')
        root = manifests[0].parent
        manifest = json.loads(manifests[0].read_text(encoding='utf-8-sig'))
        name = manifest.get('file', '')
        if not isinstance(name, str) or Path(name).name != name or '\\' in name or ':' in name or not name.endswith('.gguf'):
            raise ValueError('Invalid trained model filename')
        model = root / name
        digest = hashlib.sha256()
        with model.open('rb') as incoming:
            if incoming.read(4) != b'GGUF':
                raise ValueError('The supplied model is not GGUF')
            incoming.seek(0)
            for block in iter(lambda: incoming.read(1024 * 1024), b''):
                digest.update(block)
        if model.stat().st_size != manifest.get('bytes') or digest.hexdigest() != manifest.get('sha256'):
            raise ValueError('Trained model digest or size mismatch')
        if not manifest.get('name') or not isinstance(manifest.get('training'), dict) or manifest['training'].get('completed') is not True:
            raise ValueError('Model manifest must include name and a completed factual training report')
        output.parent.mkdir(parents=True, exist_ok=True)
        if output.exists():
            shutil.rmtree(output)
        shutil.copytree(root, output)
        print(json.dumps({'model': manifest['name'], 'bytes': manifest['bytes'], 'sha256': manifest['sha256']}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path)
    parser.add_argument('--output', type=Path, default=Path('resources/local-model/yukino-1.5b-persona-q4'))
    args = parser.parse_args()
    prepare(args.archive, args.output)
