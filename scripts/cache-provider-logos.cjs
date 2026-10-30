'use strict';
// Download only fixed public brand assets from official websites. No user URL,
// credentials, third-party logo service, or API account is involved.
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const catalogue=require('../resources/api-brands.json');
function allowed(url,domains){try{const address=new URL(url);return address.protocol==='https:'&&!address.username&&!address.password&&domains.some(domain=>address.hostname===domain||address.hostname.endsWith('.'+domain));}catch{return false;}}
function imageExtension(bytes){if(bytes.length<8||bytes.length>1024*1024)throw Error('官方图标大小无效');if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'png';if(bytes.subarray(0,4).equals(Buffer.from([0,0,1,0])))return 'ico';if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'jpg';if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')return 'webp';throw Error('未取得可用的官方位图图标（拒绝HTML和活动内容）');}
async function fetchAsset(address,domains,fetcher=fetch){
 let next=address;
 for(let hop=0;hop<4;hop++){
  if(!allowed(next,domains))throw Error('图标地址不在该品牌的官方域名范围');
  const response=await fetcher(next,{redirect:'manual',signal:AbortSignal.timeout(15000),headers:{Accept:'image/avif,image/webp,image/png,image/*;q=0.8','User-Agent':'Yukino-Companion-Brand-Asset-Cache/1.0'}});
  if([301,302,303,307,308].includes(response.status)){const location=response.headers.get('location');await response.body?.cancel();if(!location)throw Error('官方资源重定向缺失');next=new URL(location,next).href;continue;}
  if(response.status!==200){await response.body?.cancel();throw Error('官方图标请求失败：'+response.status);}
  if(Number(response.headers.get('content-length'))>1024*1024){await response.body?.cancel();throw Error('官方图标超过大小限制');}
  const reader=response.body?.getReader();if(!reader)throw Error('官方图标没有返回文件');const chunks=[];let size=0;
  try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>1024*1024)throw Error('官方图标超过大小限制');chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const bytes=Buffer.concat(chunks),extension=imageExtension(bytes);return {bytes,extension,sourceUrl:next};
 }
 throw Error('官方图标重定向次数过多');
}
async function cacheProviderLogos({outputRoot=path.resolve(__dirname,'../public/provider-logos'),brands=catalogue.brands,fetcher=fetch,concurrency=4}={}){
 await fs.mkdir(outputRoot,{recursive:true});const entries=Object.entries(brands),results={};let cursor=0;
 async function worker(){for(;;){const entry=entries[cursor++];if(!entry)return;const [brand,definition]=entry;if(!definition.logoSources?.length){results[brand]={status:'not-applicable'};continue;}let result,error;
  for(const source of definition.logoSources){try{result=await fetchAsset(source,definition.assetDomains,fetcher);break;}catch(failure){error=failure.message;}}
  if(result){const file=brand+'.'+result.extension;await fs.writeFile(path.join(outputRoot,file),result.bytes);results[brand]={status:'cached',file,sourceUrl:result.sourceUrl,bytes:result.bytes.length,sha256:crypto.createHash('sha256').update(result.bytes).digest('hex')};}
  else results[brand]={status:'missing',error:error||'未取得官方图标'};
 }}
 await Promise.all(Array.from({length:Math.min(concurrency,entries.length)},worker));
 const manifest={version:1,generatedAt:new Date().toISOString(),brands:results};await fs.writeFile(path.join(outputRoot,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');return manifest;
}
if(require.main===module)cacheProviderLogos().then(manifest=>{const missing=Object.entries(manifest.brands).filter(([,value])=>value.status==='missing').map(([brand])=>brand);console.log(JSON.stringify({cached:Object.values(manifest.brands).filter(value=>value.status==='cached').length,missing}));if(missing.length&&!process.argv.includes('--allow-missing'))process.exitCode=1;}).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={allowed,imageExtension,fetchAsset,cacheProviderLogos};
