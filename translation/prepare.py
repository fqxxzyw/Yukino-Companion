"""Download the fixed official model, verify each file and prepare offline resources.

Run during release preparation, or explicitly from resource settings. No model is
fetched from a chat request. Standard library only; does not install dependencies.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
from urllib.request import Request, urlopen


def checksum(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def valid(path, item):
    return path.is_file() and path.stat().st_size == item['size'] and checksum(path) == item['sha256']


def download(item, directory, base_url, report=print):
    name = item['path']
    if Path(name).name != name or name in {'.', '..'}:
        raise ValueError('Unsafe model manifest path')
    target = directory / name
    if valid(target, item):
        report(json.dumps({'file': name, 'phase': 'verified', 'bytes': item['size']}), flush=True)
        return
    part = target.with_name(target.name + '.part')
    # Resume only bounded files; the final digest still covers all bytes.
    offset = part.stat().st_size if part.exists() else 0
    if offset > item['size']:
        part.unlink(); offset = 0
    if offset == item['size']:
        if valid(part, item):
            os.replace(part, target); return
        part.unlink(); offset = 0
    headers = {'User-Agent': 'Yukino-Companion-Translation/1.0'}
    if offset:
        headers['Range'] = f'bytes={offset}-'
    request = Request(base_url + '/' + name, headers=headers)
    with urlopen(request, timeout=90) as response:
        partial = response.status == 206 and offset > 0
        if partial and not response.headers.get('Content-Range', '').startswith(f'bytes {offset}-'):
            raise RuntimeError('模型服务器返回了不匹配的断点数据')
        if not partial:
            offset = 0
        with part.open('ab' if partial else 'wb') as stream:
            downloaded = offset
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                downloaded += len(chunk)
                if downloaded > item['size']:
                    raise RuntimeError(f'模型文件超过清单大小：{name}')
                stream.write(chunk)
                report(json.dumps({'file': name, 'phase': 'downloading', 'bytes': downloaded, 'total': item['size']}), flush=True)
    if not valid(part, item):
        part.unlink(missing_ok=True)
        raise RuntimeError(f'模型文件 SHA-256 校验失败：{name}')
    os.replace(part, target)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=None)
    parser.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    manifest = json.loads(Path(__file__).with_name('model-manifest.json').read_text(encoding='utf-8'))
    if args.output is None:
        args.output = Path(__file__).parent / 'models' / manifest['directory']
    args.output.mkdir(parents=True, exist_ok=True)
    for item in manifest['files']:
        if args.verify_only:
            if not valid(args.output / item['path'], item):
                raise RuntimeError(f'模型资源不完整或校验失败：{item["path"]}')
        else:
            download(item, args.output, manifest['baseUrl'])
    print(json.dumps({'phase': 'ready', 'model': manifest['modelId'], 'revision': manifest['revision'], 'directory': str(args.output.resolve())}), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1)
