const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {createHash}=require('node:crypto');
const {VoiceResources,verified,safeDestination}=require('../electron/voice-resources.cjs');
function file(data,algorithm='sha256'){const hash=createHash(algorithm);if(algorithm==='sha1')hash.update(`blob ${data.length}\0`);hash.update(data);return {path:'model/config.json',url:'https://example.test/model',bytes:data.length,algorithm,digest:hash.digest('hex')}}
async function setup(t,data,fetcher){const root=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-download-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const item=file(data);return {root,item,installer:new VoiceResources({root,catalog:{packs:{core:{files:[item],label:'test'}}},fetcher})}}
test('model downloads verify digest, atomically publish, and skip verified files',async t=>{
 const data=Buffer.from('verified data');let calls=0;const {root,item,installer}=await setup(t,data,async()=>{calls++;return new Response(data)});
 await installer.install();assert.equal(await verified(path.join(root,item.path),item),true);await installer.install();assert.equal(calls,1);
});
test('bad hashes never become installed files',async t=>{
 const data=Buffer.from('abcd');const {root,item,installer}=await setup(t,data,async()=>new Response('efgh'));
 await assert.rejects(installer.install(),/校验/);await assert.rejects(fs.access(path.join(root,item.path)));assert.equal(installer.status.phase,'error');
});
test('download resumes an interrupted file with matching range',async t=>{
 const data=Buffer.from('abcdefghijkl');const {root,item,installer}=await setup(t,data,async(url,opts)=>{assert.equal(opts.headers.Range,'bytes=4-');return new Response(data.subarray(4),{status:206,headers:{'content-range':'bytes 4-11/12'}})});
 const dest=path.join(root,item.path);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest+'.part',data.subarray(0,4));await installer.install();assert.equal(await verified(dest,item),true);
});
test('servers ignoring Range restart safely, and Git SHA1 blobs verify',async t=>{
 const data=Buffer.from('abcd');const {root,item,installer}=await setup(t,data,async()=>new Response(data));const dest=path.join(root,item.path);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest+'.part','ab');await installer.install();assert.equal(await verified(dest,file(data,'sha1')),true);
});
test('wrong Content-Range cannot append corrupt bytes',async t=>{
 const {installer}=await setup(t,Buffer.from('abcd'),async()=>new Response('bcd',{status:206,headers:{'content-range':'bytes 1-3/4'}}));await assert.rejects(installer.install(),/下载源|续传范围/);
});
test('cancel interrupts the network and keeps status explicit',async t=>{
 let started;const ready=new Promise(r=>started=r);const {installer}=await setup(t,Buffer.from('abcd'),async(url,opts)=>{started();return new Promise((resolve,reject)=>opts.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}))});
 const promise=installer.install();await ready;installer.cancel();await assert.rejects(promise,/aborted/);assert.equal(installer.status.phase,'cancelled');
});
test('catalog traversal and unknown packs rejected',async t=>{
 for(const p of ['../weights','a/../../x','/etc/passwd','a\\..\\x'])assert.throws(()=>safeDestination(os.tmpdir(),p));
 const {installer}=await setup(t,Buffer.from('a'),()=>{throw Error('should not fetch')});await assert.rejects(installer.install('private-weights'),/未知/);
});
test('Git blob configuration files switch to a second pinned source and still verify SHA1',async t=>{
 const data=Buffer.from('{"small":"config"}'),item={...file(data,'sha1'),sources:['https://mirror.example.test/config','https://origin.example.test/config']};const root=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-small-source-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const requested=[];
 const installer=new VoiceResources({root,catalog:{packs:{core:{files:[item]}}},fetcher:async url=>{requested.push(url);return url.includes('mirror')?new Response('unavailable',{status:503}):new Response(data);}});
 await installer.install();assert.deepEqual(requested,item.sources);assert.equal(await verified(path.join(root,item.path),item),true);
});

test('multi-file model progress retains independent rows and never reports pack complete early',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-file-progress-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const data=[Buffer.from('first model data'),Buffer.from('second model data')],files=data.map((bytes,index)=>({...file(bytes),path:`model/file-${index}.bin`,url:`https://example.test/${index}`})),events=[];
 const installer=new VoiceResources({root,catalog:{packs:{core:{files}}},notify:event=>events.push(event),fetcher:async url=>new Response(data[Number(new URL(url).pathname.slice(1))])});await installer.install();
 const second=events.find(event=>event.fileIndex===1&&event.fileReceived===0);assert.equal(second.files[0].phase,'complete');assert.equal(second.files[0].received,data[0].length);assert.equal(second.fileTotal,data[1].length);
 assert.equal(events.filter(event=>event.phase==='complete').length,1);assert.ok(events.at(-1).files.every(row=>row.phase==='complete'&&row.received===row.total));
});
