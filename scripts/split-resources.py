"""Publish immutable, independently hashed 64 MiB resource parts.

Unlike aria2 range splitting, every part is an actual separate GitHub asset.
Only the already registered SHA-256-pinned resource bytes may be split.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import time
from urllib.request import Request, urlopen

ROOT=Path(__file__).resolve().parents[1]
TAG='v0.4.0-resource-parts.1'
PREFIX=f'https://github.com/fqxxzyw/Yukino-Companion/releases/download/{TAG}/'
PART_BYTES=64*1024**2
spec=importlib.util.spec_from_file_location('yukino_mirrors',ROOT/'scripts/mirror-resources.py')
mirrors=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mirrors)


def entries():
    return [item for item in mirrors.entries() if item['algorithm']=='sha256' and item['bytes']>=PART_BYTES]


def split_stream(incoming,item,output,part_bytes=PART_BYTES):
    if not re.fullmatch(r'[A-Za-z0-9_.-]+',item['asset']) or not re.fullmatch(r'[a-f0-9]{64}',item['digest']):
        raise ValueError('Invalid pinned split resource')
    if not 1<=part_bytes<=PART_BYTES or not isinstance(item['bytes'],int) or item['bytes']<1:
        raise ValueError('Invalid split size')
    output=Path(output);output.mkdir(parents=True,exist_ok=True)
    total=0;whole=hashlib.sha256();part_hash=None;part=None;part_size=0;parts=[];temporary=[]
    try:
        while block:=incoming.read(min(1024**2,part_bytes)):
            if total+len(block)>item['bytes']:raise ValueError('Resource exceeds pinned bytes')
            whole.update(block);total+=len(block)
            offset=0
            while offset<len(block):
                if part is None:
                    name=f"{item['asset']}.{item['digest'][:12]}.part{len(parts)+1:03d}"
                    target=output/name;tmp=output/(name+'.tmp')
                    if target.exists() or tmp.exists():raise ValueError('Refusing to overwrite an existing resource part')
                    part=tmp.open('xb');temporary.append(tmp);part_hash=hashlib.sha256();part_size=0
                take=min(part_bytes-part_size,len(block)-offset);piece=block[offset:offset+take]
                part.write(piece);part_hash.update(piece);part_size+=take;offset+=take
                if part_size==part_bytes:
                    part.close();part=None
                    parts.append({'name':name,'url':PREFIX+name,'bytes':part_size,'sha256':part_hash.hexdigest()})
        if part is not None:
            part.close();part=None
            parts.append({'name':name,'url':PREFIX+name,'bytes':part_size,'sha256':part_hash.hexdigest()})
        if total!=item['bytes'] or whole.hexdigest()!=item['digest']:
            raise ValueError('Complete resource SHA-256 or byte length differs from the published pin')
        for tmp,record in zip(temporary,parts):tmp.replace(output/record['name'])
        return {'name':item['asset'],'bytes':total,'sha256':item['digest'],'originalUrl':item['url'],
                'fallbackSources':[mirrors.MIRROR+item['asset'],item['url']],'parts':parts}
    finally:
        if part is not None:part.close()
        for tmp in temporary:tmp.unlink(missing_ok=True)


def acquire(item,output,opener=urlopen):
    sources=[mirrors.MIRROR+item['asset'],item['url']]
    for source in sources:
        for attempt in range(2):
            try:
                with opener(Request(source,headers={'User-Agent':'Yukino-Split-Resources/0.4'}),timeout=60) as response:
                    if not response.geturl().startswith('https://'):raise ValueError('Resource redirect lost HTTPS')
                    return split_stream(response,item,output)
            except Exception:
                if source==sources[-1] and attempt==1:raise
                time.sleep(1)
    raise RuntimeError('No resource source succeeded')


def validate_catalog(catalog,expected=None):
    expected=entries() if expected is None else expected
    if catalog.get('schemaVersion')!=1 or catalog.get('release')!=TAG or not isinstance(catalog.get('files'),dict):
        raise ValueError('Invalid split catalog')
    wanted={item['digest']:item for item in expected}
    if set(catalog['files'])!=set(wanted):raise ValueError('Split catalog does not cover exactly the pinned large resources')
    for digest,row in catalog['files'].items():
        item=wanted[digest]
        if row.get('bytes')!=item['bytes'] or row.get('sha256')!=digest or row.get('originalUrl')!=item['url']:
            raise ValueError('Split resource identity differs from the published pin')
        parts=row.get('parts')
        if not isinstance(parts,list) or not 1<=len(parts)<=128:raise ValueError('Invalid number of resource parts')
        total=0
        for index,part in enumerate(parts):
            name=f"{item['asset']}.{digest[:12]}.part{index+1:03d}"
            if part.get('name')!=name or part.get('url')!=PREFIX+name or not re.fullmatch('[a-f0-9]{64}',part.get('sha256','')):
                raise ValueError('Invalid resource part URL or digest')
            if not isinstance(part.get('bytes'),int) or not 0<part['bytes']<=PART_BYTES:raise ValueError('Invalid resource part length')
            if index<len(parts)-1 and part['bytes']!=PART_BYTES:raise ValueError('Non-final resource part must have the fixed chunk size')
            total+=part['bytes']
        if total!=item['bytes']:raise ValueError('Resource parts do not add up to the pinned file size')
    return catalog


def fetch_catalog(destination):
    with urlopen(Request(PREFIX+'resource-parts.json',headers={'User-Agent':'Yukino-Build/0.4'}),timeout=60) as response:
        if not response.geturl().startswith('https://'):raise ValueError('Catalog redirect lost HTTPS')
        data=response.read(2*1024**2+1)
    if len(data)>2*1024**2:raise ValueError('Split catalog is too large')
    catalog=validate_catalog(json.loads(data));destination.parent.mkdir(parents=True,exist_ok=True)
    destination.write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    return catalog


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=ROOT/'build/resource-parts')
    parser.add_argument('--fetch-catalog',action='store_true')
    parser.add_argument('--catalog-output',type=Path,default=ROOT/'resources/resource-parts.json')
    args=parser.parse_args()
    if args.fetch_catalog:
        catalog=fetch_catalog(args.catalog_output)
        print(json.dumps({'catalog':str(args.catalog_output),'files':len(catalog['files'])}));return
    args.output.mkdir(parents=True,exist_ok=True)
    if any(args.output.iterdir()):raise ValueError('Use a new empty output directory for immutable parts')
    with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(lambda item:acquire(item,args.output),entries()))
    catalog={'schemaVersion':1,'release':TAG,'partBytes':PART_BYTES,'files':{row['sha256']:row for row in results}}
    validate_catalog(catalog)
    (args.output/'resource-parts.json').write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    notice='Yukino Companion: separately downloadable resource parts\n\nEach asset is a contiguous 64 MiB (final part may be smaller) slice of a previously published, pinned resource. No model bytes have been changed.\nPer-part SHA-256 and the final complete-file SHA-256 are in resource-parts.json.\nOriginal sources, model licenses and environment notices remain those of v0.4.0-resources.1 and the original archives. See https://github.com/fqxxzyw/Yukino-Companion/releases/tag/v0.4.0-resources.1 for RESOURCE-SOURCES.txt and translation__LICENSE.txt.\nThe application downloads up to three pieces concurrently, verifies each piece, then checks the reconstructed file before installing.\n'
    (args.output/'RESOURCE-SOURCES.txt').write_text(notice,encoding='utf8')
    print(json.dumps({'files':len(results),'parts':sum(len(row['parts']) for row in results),'bytes':sum(row['bytes'] for row in results)}))

if __name__=='__main__':main()
