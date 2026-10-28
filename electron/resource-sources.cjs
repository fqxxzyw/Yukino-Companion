// Only build-pinned sources are accepted. Renderer input never supplies a download URL.
let catalog={schemaVersion:1,sources:{}};
try { catalog=require('../resources/resource-download-sources.json'); } catch(error) { if(error.code!=='MODULE_NOT_FOUND')throw error; }
const splitCatalog=require('../resources/resource-parts.json');
const PART_BYTES=64*1024**2;
const PART_PREFIX='https://github.com/fqxxzyw/Yukino-Companion/releases/download/v0.4.0-resource-parts.1/';
function resourceParts(bytes,sha256) {
  const row=splitCatalog.files?.[sha256];
  if(!row)return null;
  if(splitCatalog.schemaVersion!==1||splitCatalog.partBytes!==PART_BYTES||splitCatalog.release!=='v0.4.0-resource-parts.1'||row.bytes!==bytes||row.sha256!==sha256||!Array.isArray(row.parts)||!row.parts.length||row.parts.length>128)throw Error('资源分卷清单无效');
  let total=0;
  for(const [index,part] of row.parts.entries()){
    const name=`${row.name}.${sha256.slice(0,12)}.part${String(index+1).padStart(3,'0')}`;
    if(!/^[A-Za-z0-9_.-]+$/.test(name)||part.name!==name||part.url!==PART_PREFIX+name||!Number.isSafeInteger(part.bytes)||part.bytes<1||part.bytes>PART_BYTES||(index<row.parts.length-1&&part.bytes!==PART_BYTES)||!/^[a-f0-9]{64}$/.test(part.sha256))throw Error('资源分卷地址或校验值无效');
    total+=part.bytes;
  }
  if(total!==bytes)throw Error('资源分卷总长度无效');
  return row.parts.map(part=>({...part}));
}
function resourceSources(url, extra=[]) {
  const mapped=catalog.schemaVersion===1?catalog.sources?.[url]:null;
  return [...new Set([...(Array.isArray(mapped)?mapped:[]),...(Array.isArray(extra)?extra:[]),url])].map(value=>{
    const parsed=new URL(value);
    if(parsed.protocol!=='https:'||parsed.username||parsed.password)throw Error('资源地址必须是安全 HTTPS 地址');
    return parsed.href;
  });
}
module.exports={resourceSources,resourceParts,PART_BYTES};
