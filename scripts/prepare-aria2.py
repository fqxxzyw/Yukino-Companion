"""Bundle an unmodified, fixed official aria2 Windows distribution and its source."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import stat
import tempfile
from urllib.request import Request, urlopen
from zipfile import ZipFile

VERSION='1.37.0'
ZIP_NAME='aria2-1.37.0-win-64bit-build1.zip'
ZIP_SHA='67d015301eef0b612191212d564c5bb0a14b5b9c4796b76454276a4d28d9b288'
SOURCE_NAME='aria2-1.37.0.tar.xz'
SOURCE_SHA='60a420ad7085eb616cb6e2bdf0a7206d68ff3d37fb5a956dc44242eb2f79b66b'
BASE='https://github.com/aria2/aria2/releases/download/release-1.37.0/'

def digest(file):
    h=hashlib.sha256()
    with Path(file).open('rb') as source:
        for chunk in iter(lambda:source.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()

def acquire(name,sha,root):
    target=root/name
    with urlopen(Request(BASE+name,headers={'User-Agent':'Yukino-Build/0.4'}),timeout=120) as response,target.open('wb') as output:
        if not response.geturl().startswith('https://'):raise ValueError('Download must remain HTTPS')
        size=0
        for chunk in iter(lambda:response.read(1024*1024),b''):
            size+=len(chunk)
            if size>16*1024**2:raise ValueError('Unexpected aria2 archive size')
            output.write(chunk)
    if digest(target)!=sha:raise ValueError('aria2 checksum mismatch: '+name)
    return target

def prepare(output):
    output=Path(output).resolve();output.parent.mkdir(parents=True,exist_ok=True)
    if output.exists() and any(output.iterdir()):raise ValueError('Choose an empty aria2 output directory')
    with tempfile.TemporaryDirectory(prefix='aria2-',dir=output.parent) as temporary:
        stage=Path(temporary);archive=acquire(ZIP_NAME,ZIP_SHA,stage);source=acquire(SOURCE_NAME,SOURCE_SHA,stage);payload=stage/'payload';payload.mkdir();seen=set();total=0
        with ZipFile(archive) as bundle:
            for entry in bundle.infolist():
                p=PurePosixPath(entry.filename)
                if p.is_absolute() or '\\' in entry.filename or ':' in entry.filename or '..' in p.parts or p.parts[0]!=ZIP_NAME[:-4] or stat.S_ISLNK(entry.external_attr>>16) or entry.flag_bits&1:raise ValueError('Unsafe aria2 archive')
                if entry.is_dir():continue
                if len(p.parts)!=2 or p.name.casefold() in seen:raise ValueError('Unexpected aria2 member')
                seen.add(p.name.casefold());total+=entry.file_size
                if total>32*1024**2:raise ValueError('Unexpected aria2 expanded size')
                with bundle.open(entry) as incoming,(payload/p.name).open('xb') as target:shutil.copyfileobj(incoming,target)
        for name in ['aria2c.exe','COPYING','LICENSE.OpenSSL','README.mingw','AUTHORS']:
            if not (payload/name).is_file():raise ValueError('Missing aria2 distribution file: '+name)
        if (payload/'aria2c.exe').read_bytes()[:2]!=b'MZ':raise ValueError('Invalid aria2 Windows executable')
        shutil.copy2(source,payload/SOURCE_NAME)
        metadata={'name':'aria2','version':VERSION,'url':BASE+ZIP_NAME,'archiveSha256':ZIP_SHA,'executableSha256':digest(payload/'aria2c.exe'),'sourceUrl':BASE+SOURCE_NAME,'sourceSha256':SOURCE_SHA,'license':'GPL-2.0-or-later'}
        (payload/'provenance.json').write_text(json.dumps(metadata,indent=2)+'\n',encoding='utf8')
        (payload/'YUKINO-NOTICE.txt').write_text('Unmodified official aria2 executable. GPL, OpenSSL notices, authors, build information and corresponding upstream source accompany this distribution. No RPC server or Motrix application is installed.\n',encoding='utf8')
        if output.exists():output.rmdir()
        payload.replace(output)
    print(json.dumps(metadata))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,default=Path('build/aria2'));prepare(parser.parse_args().output)
