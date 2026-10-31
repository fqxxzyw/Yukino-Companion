const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {createHash}=require('node:crypto');
const {VoiceResources,verified,safeDestination}=require('../electron/voice-resources.cjs');
function file(data,algorithm='sha256'){const hash=createHash(algorithm);if(algorithm==='sha1')hash.update(`blob ${data.length}\0`);hash.update(data);return {path:'model/config.json',url:'https://example.test/model',bytes:data.length,algorithm,digest:hash.digest('hex')}}
function rendezvous(expected){let count=0,release;const gate=new Promise(resolve=>release=resolve);return async()=>{if(++count===expected)release();let timer;try{await Promise.race([gate,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('并发下载未同时启动')),10000);})]);}finally{clearTimeout(timer);}};}
async function setup(t,data,fetcher){const root=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-download-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const item=file(data);return {root,item,installer:new VoiceResources({root,catalog:{packs:{core:{files:[item],label:'test'}}},fetcher})}}
test('model downloads verify digest, atomically publish, and skip verified files',async t=>{
 const data=Buffer.from('verified data');let calls=0;const {root,item,installer}=await setup(t,data,async()=>{calls++;return new Response(data)});
 await installer.install();assert.equal(await verified(path.join(root,item.path),item),true);await installer.install();assert.equal(calls,1);
});
test('GPT and SoVITS can be downloaded and selected independently',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-weights-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const data={gpt:Buffer.from('a GPT checkpoint'),sovits:Buffer.from('a SoVITS checkpoint')},requests=[];
 const records=Object.entries(data).map(([key,value])=>({...file(value),path:`voice/${key}`,url:`https://example.test/${key}`}));
 const catalog={packs:{voice:{kind:'voice',version:'v1',paths:{gpt:'voice/gpt',sovits:'voice/sovits'},files:records}}};
 const installer=new VoiceResources({root,catalog,fetcher:async url=>{const key=url.split('/').at(-1);requests.push(key);return new Response(data[key]);}});
 const gpt=await installer.install('voice',{component:'gpt'});assert.ok(gpt.gpt);assert.equal(gpt.sovits,undefined);assert.deepEqual(requests,['gpt']);assert.deepEqual((await installer.inspect()).packs[0].components,{gpt:true,sovits:false});
 const sovits=await installer.install('voice',{component:'sovits'});assert.ok(sovits.sovits);assert.equal(sovits.gpt,undefined);assert.deepEqual(requests,['gpt','sovits']);assert.deepEqual((await installer.inspect()).packs[0].components,{gpt:true,sovits:true});
 await assert.rejects(installer.install('voice',{component:'other'}),/未知/);
});
test('separate GPT and SoVITS downloads can overlap without sharing a destination',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-parallel-weights-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const data={gpt:Buffer.from('one'),sovits:Buffer.from('two')},started=[];let release;const gate=new Promise(resolve=>release=resolve);
 const files=Object.entries(data).map(([key,value])=>({...file(value),path:`voice/${key}`,url:`https://example.test/${key}`}));const installer=new VoiceResources({root,catalog:{packs:{voice:{kind:'voice',version:'v1',paths:{gpt:'voice/gpt',sovits:'voice/sovits'},files}}},fetcher:async url=>{const key=url.split('/').at(-1);started.push(key);await gate;return new Response(data[key]);}});
 const a=installer.install('voice',{component:'gpt'}),b=installer.install('voice',{component:'sovits'});for(let i=0;i<100&&started.length<2;i++)await new Promise(resolve=>setTimeout(resolve,5));assert.deepEqual(new Set(started),new Set(['gpt','sovits']));release();await Promise.all([a,b]);
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
 const data=[Buffer.from('first model data'),Buffer.from('second model data')],files=data.map((bytes,index)=>({...file(bytes),path:`model/file-${index}.bin`,url:`https://example.test/${index}`})),events=[];let active=0,maximum=0;
 const meet=rendezvous(2),installer=new VoiceResources({root,catalog:{packs:{core:{files}}},notify:event=>events.push(event),fetcher:async url=>{active++;maximum=Math.max(active,maximum);await meet();active--;return new Response(data[Number(new URL(url).pathname.slice(1))]);}});await installer.install();
 assert.equal(maximum,2,'both independent weight files run concurrently');assert.ok(events.some(event=>event.fileIndex===1&&event.files.length===2));
 assert.equal(events.filter(event=>event.phase==='complete').length,1);assert.ok(events.at(-1).files.every(row=>row.phase==='complete'&&row.received===row.total));
});
test('public speech components and a selected voice pack can download together',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-voice-parallel-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const data=[Buffer.from('public component'),Buffer.from('trained gpt'),Buffer.from('trained sovits')],records=data.map((bytes,index)=>({...file(bytes),path:`file-${index}`,url:`https://example.test/${index}`}));
 const catalog={packs:{core:{kind:'core',files:[records[0]]},voice:{kind:'voice',version:'v1',files:records.slice(1),paths:{gpt:'file-1',sovits:'file-2'}}}};let active=0,maximum=0;
 const meet=rendezvous(3),installer=new VoiceResources({root,catalog,fetcher:async url=>{active++;maximum=Math.max(active,maximum);await meet();active--;return new Response(data[Number(new URL(url).pathname.slice(1))]);}});
 const [core,voice]=await Promise.all([installer.install('core'),installer.install('voice')]);assert.equal(maximum,3);assert.equal(voice.gpt,path.join(root,'file-1'));assert.equal(voice.sovits,path.join(root,'file-2'));assert.ok(core.bert);assert.equal(installer.controller,null);
});

function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}
test('duplicate speech downloads share one network operation and cancelling setup keeps the settings owner',async t=>{
 const entered=deferred(),release=deferred();let fetches=0,networkSignal;
 const {installer}=await setup(t,Buffer.from('shared core'),async(_url,{signal})=>{fetches++;networkSignal=signal;entered.resolve();await release.promise;return new Response('shared core');});
 const settings=installer.install('core');await entered.promise;
 const controller=new AbortController(),wizard=installer.install('core',{signal:controller.signal}),rejected=assert.rejects(wizard,{name:'AbortError'});
 controller.abort();await rejected;assert.equal(networkSignal.aborted,false);release.resolve();await settings;
 assert.equal(fetches,1);assert.equal(installer.controller,null);
});
test('whole voice packs wait for an overlapping single weight and reuse its verified bytes',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-overlap-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const data={gpt:Buffer.from('shared GPT'),sovits:Buffer.from('shared SoVITS')},entered=deferred(),release=deferred(),requests=[];
 const files=Object.entries(data).map(([key,value])=>({...file(value),path:`voice/${key}`,url:`https://example.test/${key}`}));
 const catalog={packs:{voice:{kind:'voice',version:'v1',paths:{gpt:'voice/gpt',sovits:'voice/sovits'},files}}};
 const installer=new VoiceResources({root,catalog,fetcher:async url=>{const key=new URL(url).pathname.slice(1);requests.push(key);if(key==='gpt'){entered.resolve();await release.promise;}return new Response(data[key]);}});
 const single=installer.install('voice',{component:'gpt'});await entered.promise;
 const pair=installer.install('voice');await new Promise(setImmediate);assert.deepEqual(requests,['gpt']);release.resolve();
 const [a,b]=await Promise.all([single,pair]);assert.equal(a.gpt,b.gpt);assert.ok(b.sovits);assert.deepEqual(requests,['gpt','sovits']);assert.equal(installer.controller,null);
});
test('aliases sharing a pinned weight serialize without writing that destination twice',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-alias-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const data=Buffer.from('same weight'),entered=deferred(),release=deferred(),item={...file(data),path:'voice/shared.ckpt'};let fetches=0;
 const pack={kind:'voice',version:'v1',paths:{gpt:item.path},files:[item]};
 const installer=new VoiceResources({root,catalog:{packs:{a:pack,b:pack}},fetcher:async()=>{fetches++;entered.resolve();await release.promise;return new Response(data);}});
 const a=installer.install('a',{component:'gpt'});await entered.promise;const b=installer.install('b',{component:'gpt'});release.resolve();
 const results=await Promise.all([a,b]);assert.equal(results[0].gpt,results[1].gpt);assert.equal(fetches,1);
});
