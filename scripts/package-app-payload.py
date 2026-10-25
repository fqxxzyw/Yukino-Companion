"""Split the complete Windows application into verified, offline-installable ZIP64 parts."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import stat
import tempfile
import zipfile

spec = importlib.util.spec_from_file_location('runtime_package', Path(__file__).with_name('package-runtime.py'))
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


def package(source, output, tag, part_bytes=runtime.MAX_PART_BYTES):
    if Path(source).is_symlink() or (hasattr(Path(source), 'is_junction') and Path(source).is_junction()):
        raise ValueError('Application root must not be a link')
    source, output = Path(source).resolve(), Path(output).resolve()
    if output == source or output.is_relative_to(source):
        raise ValueError('Output must be outside the application directory')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._/-]*', tag or '') or '..' in tag.split('/'):
        raise ValueError('A safe release tag is required')
    if not 0 < part_bytes <= runtime.MAX_PART_BYTES:
        raise ValueError('Part size must not exceed 900 MiB')
    if not (source / 'Yukino Companion.exe').is_file():
        raise ValueError('Complete win-unpacked application is missing')
    entries = []
    for folder, directories, files in os.walk(source, followlinks=False):
        for name in directories + files:
            item = Path(folder) / name
            if item.is_symlink() or (hasattr(item, 'is_junction') and item.is_junction()):
                raise ValueError('Application payload must not contain links')
            if item.is_dir():
                continue
            before = item.stat()
            relative = item.relative_to(source).as_posix()
            if not stat.S_ISREG(before.st_mode) or '\\' in relative or ':' in relative:
                raise ValueError('Unsafe application entry')
            entries.append((item, relative, before))
    output.mkdir(parents=True, exist_ok=True)
    stem = f'Yukino-Companion-{runtime.VERSION}-windows-x64'
    with tempfile.TemporaryDirectory(prefix='.app-payload-', dir=output) as temporary:
        temp = Path(temporary)
        archive = temp / (stem + '.zip')
        with zipfile.ZipFile(archive, 'w', allowZip64=True, compression=zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
            for item, relative, before in sorted(entries, key=lambda x: x[1]):
                info = zipfile.ZipInfo(relative, date_time=(1980, 1, 1, 0, 0, 0))
                info.create_system = 3
                info.external_attr = (stat.S_IFREG | 0o644) << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                info.file_size = before.st_size
                with item.open('rb') as incoming, bundle.open(info, 'w', force_zip64=True) as outgoing:
                    shutil.copyfileobj(incoming, outgoing, runtime.CHUNK)
                after = item.stat()
                if (after.st_size, after.st_mtime_ns) != (before.st_size, before.st_mtime_ns):
                    raise ValueError('Application changed during packaging')
        parts, checksum = runtime._split_archive(archive, temp, stem, tag, part_bytes)
        catalog = {'schemaVersion': 1, 'version': runtime.VERSION, 'executable': 'Yukino Companion.exe',
                   'bytes': archive.stat().st_size, 'unpackedBytes': sum(x[2].st_size for x in entries),
                   'archiveSha256': checksum, 'parts': parts}
        for part in parts:
            os.replace(temp / part['path'], output / part['path'])
        (temp / 'app-payload.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        os.replace(temp / 'app-payload.json', output / 'app-payload.json')
    return catalog


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('release/win-unpacked'))
    parser.add_argument('--output', type=Path, default=Path('release'))
    parser.add_argument('--tag', required=True)
    parser.add_argument('--part-bytes', type=int, default=runtime.MAX_PART_BYTES)
    args = parser.parse_args()
    print(json.dumps(package(args.source, args.output, args.tag, args.part_bytes), indent=2))
