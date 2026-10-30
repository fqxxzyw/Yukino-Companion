"""Read cached upstream wheel PE imports without importing or executing its DLLs.
Only a JSON text report is produced; binary wheels are not uploaded.
"""
import argparse
import json
import os
from pathlib import Path
import struct
import zipfile


def imports(data):
    if data[:2] != b'MZ':
        return []
    pe = struct.unpack_from('<I', data, 0x3c)[0]
    if data[pe:pe+4] != b'PE\0\0':
        raise ValueError('Invalid PE signature')
    sections, optional_size = struct.unpack_from('<H', data, pe+6)[0], struct.unpack_from('<H', data, pe+20)[0]
    optional = pe+24
    magic = struct.unpack_from('<H', data, optional)[0]
    directories = optional + (112 if magic == 0x20b else 96)
    import_rva = struct.unpack_from('<I', data, directories+8)[0]
    table = optional+optional_size
    spans = []
    for index in range(sections):
        section = table+index*40
        virtual_size, rva, raw_size, raw = struct.unpack_from('<IIII', data, section+8)
        spans.append((rva, max(virtual_size, raw_size), raw))
    def offset(rva):
        for start, length, raw in spans:
            if start <= rva < start+length:
                return raw+rva-start
        raise ValueError('Import RVA outside sections')
    if not import_rva:
        return []
    descriptor = offset(import_rva)
    result = []
    for index in range(4096):
        fields = struct.unpack_from('<IIIII', data, descriptor+index*20)
        if not any(fields):
            break
        start = offset(fields[3])
        end = data.index(b'\0', start, start+512)
        result.append(data[start:end].decode('ascii'))
    return sorted(result, key=str.casefold)


def diagnose(root):
    root = Path(root)
    cache = root/'runtime/pip-cache'
    report = {'cache': str(cache), 'systemNvidiaDriverPresent': (Path(os.environ.get('SystemRoot', r'C:\Windows'))/'System32/nvcuda.dll').is_file(), 'wheels': [], 'errors': []}
    for file in cache.rglob('*'):
        if not file.is_file() or not zipfile.is_zipfile(file):
            continue
        try:
            with zipfile.ZipFile(file) as archive:
                entries = [entry for entry in archive.infolist() if entry.filename.lower().startswith('llama_cpp/') and entry.filename.lower().endswith('.dll')]
                if not entries:
                    continue
                item = {'cachedFile': str(file.relative_to(cache)), 'dlls': []}
                for entry in entries:
                    if entry.file_size > 1024**3:
                        raise ValueError('DLL exceeds diagnosis size bound')
                    item['dlls'].append({'path': entry.filename, 'bytes': entry.file_size, 'imports': imports(archive.read(entry))})
                report['wheels'].append(item)
        except Exception as error:
            report['errors'].append({'file': str(file), 'error': str(error)})
    report['directNvidiaDriverImports'] = [dll['path'] for wheel in report['wheels'] for dll in wheel['dlls'] if any(name.casefold() == 'nvcuda.dll' for name in dll['imports'])]
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', required=True)
    args = parser.parse_args()
    result = diagnose(args.directory)
    output = Path(args.directory)/'cuda-wheel-dependencies.json'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(result, indent=2))
