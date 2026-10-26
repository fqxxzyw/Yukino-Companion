// Only build-pinned sources are accepted. Renderer input never supplies a download URL.
let catalog={schemaVersion:1,sources:{}};
try { catalog=require('../resources/resource-download-sources.json'); } catch(error) { if(error.code!=='MODULE_NOT_FOUND')throw error; }
function resourceSources(url, extra=[]) {
  const mapped=catalog.schemaVersion===1?catalog.sources?.[url]:null;
  return [...new Set([...(Array.isArray(mapped)?mapped:[]),...(Array.isArray(extra)?extra:[]),url])].map(value=>{
    const parsed=new URL(value);
    if(parsed.protocol!=='https:'||parsed.username||parsed.password)throw Error('资源地址必须是安全 HTTPS 地址');
    return parsed.href;
  });
}
module.exports={resourceSources};
