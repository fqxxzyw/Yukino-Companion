"""Extract only the pinned original desktop pet's OGG library for the release."""
from pathlib import Path
import hashlib,json,re,sys,zipfile
ARCHIVE_SHA='7b8b150e6b2593b43dd44bf476348b7a44ea0ab6c90d9bddc6a31cce1e2cb6bc'
archive=Path(sys.argv[1]);output=Path(sys.argv[2]);index=output.parent/'voices.json'
if archive.stat().st_size!=80380288 or hashlib.sha256(archive.read_bytes()).hexdigest()!=ARCHIVE_SHA:raise ValueError('Desktop pet voice archive checksum mismatch')
with zipfile.ZipFile(archive) as z:
    entries=z.infolist()
    if len(entries)!=2391 or sum(i.file_size for i in entries)!=81392721:raise ValueError('Desktop pet voice archive size mismatch')
    seen=set();rows=[]
    for entry in entries:
        name=entry.filename
        if not re.fullmatch(r'[A-Za-z0-9_-]+\.ogg',name) or name in seen or not 0<entry.file_size<2*1024*1024:raise ValueError('Invalid voice library entry')
        seen.add(name);data=z.read(entry);rows.append({'file':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
        output.mkdir(parents=True,exist_ok=True);(output/name).write_bytes(data)
index.write_text(json.dumps({'schemaVersion':1,'archiveSha256':ARCHIVE_SHA,'count':len(rows),'bytes':sum(x['bytes'] for x in rows),'files':rows},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(f'Prepared {len(rows)} original desktop-pet voice clips')
