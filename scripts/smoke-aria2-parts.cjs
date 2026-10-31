'use strict';
// Actual public, digest-pinned release parts; no user models or profile data.
const path=require('node:path'),fs=require('node:fs/promises'),{spawn}=require('node:child_process');
const {downloadResource}=require('../electron/resource-download.cjs');
const catalog=require('../resources/resource-parts.json');
async function main(){
 const parts=Object.values(catalog.files).map(item=>item.parts.at(-1)).filter(item=>item.bytes>=8*1024**2&&item.bytes<=22*1024**2).slice(0,3);
 if(parts.length!==3)throw Error('Expected three suitable pinned public resource parts');
 // Never remove/reuse a fixed directory that might contain earlier user data.
 const parent=path.resolve('build');await fs.mkdir(parent,{recursive:true});
 const root=await fs.mkdtemp(path.join(parent,'aria2-parts-smoke-'));let active=0,maximum=0,maxConnections=0;
 const destinations=await Promise.all(parts.map(async(_,index)=>{const dir=path.join(root,`download-${index}`);await fs.mkdir(dir);return path.join(dir,'part');}));
 const spawnProcess=(exe,args,options)=>{const child=spawn(exe,args,options);active++;maximum=Math.max(maximum,active);child.once('close',()=>active--);return child;};
 try{
  const settled=await Promise.allSettled(parts.map((part,index)=>downloadResource({url:part.url,parts:null,dest:destinations[index],bytes:part.bytes,sha256:part.sha256,aria2Path:path.resolve('build/aria2/aria2c.exe'),spawnProcess,timeoutMs:60000,signal:AbortSignal.timeout(240000),onProgress:progress=>{maxConnections=Math.max(maxConnections,progress.connections||0)}})));
  const failed=settled.find(item=>item.status==='rejected');if(failed)throw failed.reason;const results=settled.map(item=>item.value);
  if(results.some(result=>result.engine!=='aria2')||maximum<2)throw Error('Real aria2 part downloads did not overlap successfully');
  const report={verifiedParts:results.length,engines:results.map(item=>item.engine),overlappingAria2Processes:maximum,maxConnectionsObserved:maxConnections,bytes:parts.reduce((sum,item)=>sum+item.bytes,0),root};
  await fs.writeFile(path.join(root,'verification.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
 }catch(error){console.error('Isolated download evidence retained at '+root);throw error;}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
