"""Prepare independently verifiable GitHub assets; never change upstream bytes.

The base app may be released before these mirrors finish: original pinned sources
remain usable fallbacks. No administrator token is embedded in the application.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import time
from urllib.request import Request,urlopen

ROOT=Path(__file__).resolve().parents[1]
RELEASE='https://github.com/fqxxzyw/Yukino-Companion/releases/download/'
MIRROR=RELEASE+'v0.4.0-resources.1/'
OLD=RELEASE+'v0.4.0-local.13/'
RUNTIME_NAME='Yukino-Runtime-0.4.0-windows-x64-cpu.zip.part001'
RUNTIME_SHA='6f8afeef581edfbe46f4d75188090b1e9042877b14b9f06712b06c2526e6411f'

def entries():
    items={}
    def add(prefix,item):
        url=item['url'];asset=prefix+'__'+item['path'].replace('/','__')
        record={'asset':asset,'url':url,'bytes':item['bytes'],'algorithm':item.get('algorithm','sha256'),'digest':item['digest']}
        if url in items and items[url]!=record:raise ValueError('Conflicting resource registration')
        items[url]=record
    voice=json.loads((ROOT/'resources/voice-models.json').read_text())
    for pack in voice['packs'].values():
        for item in pack['files']:add('voice',item)
    translation=json.loads((ROOT/'translation/model-manifest.json').read_text())
    for item in translation['files']:add('translation',{'path':item['path'],'url':translation['baseUrl']+'/'+item['path'],'bytes':item['size'],'digest':item['sha256']})
    add('chat',{'path':'Yukino-Local-1.5B-Persona-0.4.0.zip','url':OLD+'Yukino-Local-1.5B-Persona-0.4.0.zip','bytes':964897463,'digest':'1348039add1d3a2715cc81946703d4bd48f05fa7246bca0b26ea165da508a425'})
    pet=json.loads((ROOT/'electron/companion-view/assets/provenance.json').read_text())
    add('pet',{'path':'YukinoVoices.zip','url':f"https://raw.githubusercontent.com/fqxxzyw/yukino_desktop_pet/{pet['revision']}/src/YukinoPet/voice/YukinoVoices.zip",'bytes':80380288,'digest':'7b8b150e6b2593b43dd44bf476348b7a44ea0ab6c90d9bddc6a31cce1e2cb6bc'})
    add('runtime',{'path':RUNTIME_NAME,'url':OLD+RUNTIME_NAME,'bytes':681369634,'digest':RUNTIME_SHA})
    return list(items.values())

def hash_file(file,algorithm='sha256',size=None):
    value=hashlib.new(algorithm)
    if algorithm=='sha1':value.update(f'blob {size}\0'.encode())
    with file.open('rb') as source:
        for chunk in iter(lambda:source.read(1024**2),b''):value.update(chunk)
    return value.hexdigest()

def fetch(item,output):
    target=output/item['asset'];temporary=target.with_name(target.name+'.part')
    for attempt in range(3):
        try:
            received=0
            with urlopen(Request(item['url'],headers={'User-Agent':'Yukino-Resource-Mirror/0.4'}),timeout=90) as response,temporary.open('wb') as stream:
                if not response.geturl().startswith('https://'):raise ValueError('Resource download lost HTTPS')
                for chunk in iter(lambda:response.read(1024**2),b''):
                    received+=len(chunk)
                    if received>item['bytes']:raise ValueError('Resource exceeds pinned size')
                    stream.write(chunk)
            if received!=item['bytes'] or hash_file(temporary,item['algorithm'],received)!=item['digest']:raise ValueError('Resource length or digest mismatch')
            temporary.replace(target)
            return {**item,'mirrorUrl':MIRROR+item['asset'],'sha256':hash_file(target)}
        except Exception:
            temporary.unlink(missing_ok=True)
            if attempt==2:raise
            time.sleep(2)

def runtime_catalog(output):
    output.mkdir(parents=True,exist_ok=True)
    target=output/'runtime-catalog.json'
    with urlopen(Request(OLD+'runtime-catalog.json',headers={'User-Agent':'Yukino-Build/0.4'}),timeout=90) as response:
        data=response.read(65537)
    if len(data)!=703 or hashlib.sha256(data).hexdigest()!='81f3ba2946e665d63fc1e03937e4eff1ec714e202b51dc321b8fe5c65a63f29c':raise ValueError('Published runtime catalog checksum mismatch')
    target.write_bytes(data)

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--catalog-only',action='store_true');parser.add_argument('--runtime-catalog-only',action='store_true',help='Fetch the pinned runtime catalog without regenerating tracked resource sources');parser.add_argument('--runtime-catalog',action='store_true');parser.add_argument('--output',type=Path,default=ROOT/'build/resource-mirror');args=parser.parse_args()
    if args.runtime_catalog_only:
        runtime_catalog(ROOT/'build/base-resource-catalog')
        return
    items=entries();mapping={'schemaVersion':1,'release':'v0.4.0-resources.1','sources':{item['url']:[MIRROR+item['asset'],item['url']] for item in items}}
    (ROOT/'resources/resource-download-sources.json').write_text(json.dumps(mapping,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    if args.runtime_catalog:runtime_catalog(ROOT/'build/base-resource-catalog')
    if args.catalog_only:return
    args.output.mkdir(parents=True,exist_ok=True)
    with ThreadPoolExecutor(max_workers=4) as pool:results=list(pool.map(lambda item:fetch(item,args.output),items))
    (args.output/'resource-mirrors.json').write_text(json.dumps({'schemaVersion':1,'assets':results},ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    notice='Yukino Companion resource mirrors\n\nBytes are copied unchanged from their pinned original URLs in resource-mirrors.json.\nTranslation model: Tencent Hy-MT2, Apache-2.0; LICENSE.txt and model README are included as separate assets.\nChat model: trained Qwen2.5-1.5B adapter/merged GGUF, metadata and upstream notices remain inside the original ZIP.\nSpeech public models: refer to the original GPT-SoVITS model repository and its model card for terms; these mirror entries do not grant additional rights.\nUser-published voice weights and desktop pet clips retain their original provenance.\nThe CPU environment archive retains its embedded third-party notices.\n'
    (args.output/'RESOURCE-SOURCES.txt').write_text(notice,encoding='utf8')
    print(json.dumps({'files':len(results),'bytes':sum(x['bytes'] for x in results)}))

if __name__=='__main__':main()
