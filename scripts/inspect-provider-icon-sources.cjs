'use strict';
// Read only fixed public vendor pages to discover their declared static icons.
// Diagnostic output contains URLs and HTTP metadata, never credentials or user files.
const fs=require('node:fs/promises'),path=require('node:path');
const {allowed}=require('./cache-provider-logos.cjs'),brands=require('../resources/api-brands.json').brands;
const ids=['openai','aliyun','volcengine','zhipu'];
async function inspect(url,domains){
 const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(15000),headers:{'User-Agent':'Yukino-Companion-Brand-Asset-Check/1.0'}});
 const info={url,status:response.status,contentType:response.headers.get('content-type'),location:response.headers.get('location')};
 if(!response.ok){await response.body?.cancel();return info;}
 if(!allowed(url,domains)){await response.body?.cancel();throw Error('Unexpected diagnostic domain');}
 const reader=response.body.getReader(),chunks=[];let bytes=0;
 try{for(;;){const value=await reader.read();if(value.done)break;bytes+=value.value.byteLength;if(bytes>1024*1024){await reader.cancel();info.truncated=true;break;}chunks.push(Buffer.from(value.value));}}finally{reader.releaseLock();}
 const html=Buffer.concat(chunks).toString('utf8');
 info.iconLinks=[...html.matchAll(/<link\b[^>]*>/gi)].map(match=>match[0]).filter(tag=>/\brel\s*=\s*["'][^"']*(?:icon|image_src)[^"']*["']/i.test(tag)).map(tag=>{const href=tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];try{return href?new URL(href.replaceAll('&amp;','&'),url).href:null}catch{return null}}).filter(Boolean);
 return info;
}
async function main(){const output={kind:'public-official-icon-source-diagnostic',checkedAt:new Date().toISOString(),brands:{}};await Promise.all(ids.map(async id=>{const brand=brands[id],addresses=[brand.websiteUrl,...brand.logoSources];output.brands[id]=await Promise.all(addresses.map(async url=>{try{return await inspect(url,brand.assetDomains)}catch(error){return {url,error:error.message}}}));}));await fs.mkdir(path.resolve(__dirname,'../build'),{recursive:true});await fs.writeFile(path.resolve(__dirname,'../build/provider-icon-sources.json'),JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify(output,null,2));}
main().catch(error=>{console.error(error.message);process.exitCode=1});
