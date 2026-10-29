const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {createHash}=require('node:crypto');
const {EventEmitter}=require('node:events');
const {PassThrough}=require('node:stream');
const {downloadResource,buildAria2Args,parseProgress}=require('../electron/resource-download.cjs');
const data=Buffer.from('downloaded Japanese resources: 雪乃');
const sha256=createHash('sha256').update(data).digest('hex');
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-download-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return{root,dest:path.join(root,'中文 model.gguf'),url:'https://github.com/example/model.gguf',bytes:data.length,sha256,aria2Path:null};}
function ok(bytes=data,headers={}){return new Response(bytes,{status:200,headers:{'content-length':String(bytes.length),...headers}});}

test('a verified cached resource never starts a network request',async t=>{const f=await fixture(t);await fs.writeFile(f.dest,data);const result=await downloadResource({...f,fetcher:()=>{throw Error('network should not run');}});assert.equal(result.engine,'cache');});
test('fresh HTTPS download verifies and commits only complete bytes',async t=>{const f=await fixture(t),events=[];const r=await downloadResource({...f,fetcher:async()=>ok(),onProgress:e=>events.push(e)});assert.equal(r.engine,'https');assert.deepEqual(await fs.readFile(f.dest),data);assert.equal(events.at(-1).phase,'complete');assert.equal(events.at(-1).received,data.length);});
test('a contiguous HTTPS partial resumes with a matching range',async t=>{const f=await fixture(t),n=12;await fs.writeFile(f.dest+'.https.partial',data.subarray(0,n));const r=await downloadResource({...f,fetcher:async(_u,o)=>{assert.equal(o.headers.Range,`bytes=${n}-`);return new Response(data.subarray(n),{status:206,headers:{'content-range':`bytes ${n}-${data.length-1}/${data.length}`,'content-length':String(data.length-n)}});}});assert.equal(r.resumed,true);assert.deepEqual(await fs.readFile(f.dest),data);});
test('servers ignoring Range restart the file rather than append',async t=>{const f=await fixture(t);await fs.writeFile(f.dest+'.https.partial',data.subarray(0,5));await downloadResource({...f,fetcher:async()=>ok()});assert.deepEqual(await fs.readFile(f.dest),data);});
test('bad hash never replaces a previous destination',async t=>{const f=await fixture(t);await fs.writeFile(f.dest,'old owned cache');await assert.rejects(downloadResource({...f,fetcher:async()=>ok(Buffer.alloc(data.length))}),/校验/);assert.equal(await fs.readFile(f.dest,'utf8'),'old owned cache');await assert.rejects(fs.access(f.dest+'.https.partial'));});
test('timeout switches to another source while retaining source progress',async t=>{const f=await fixture(t),events=[],urls=[];await downloadResource({...f,sources:[{url:'https://first.invalid/a',label:'GitHub'},{url:'https://second.invalid/a',label:'备用源'}],timeoutMs:15,onProgress:e=>events.push(e),fetcher:async url=>{urls.push(url);if(url.includes('first'))return new Promise(()=>{});return ok();}});assert.equal(urls.length,2);assert.equal(events.at(-1).sourceLabel,'备用源');assert.ok(events.some(e=>e.sourceSwitch));assert.deepEqual(await fs.readFile(f.dest),data);});
test('HTTPS redirects cannot downgrade or inject credentials',async t=>{const f=await fixture(t);let calls=0;await assert.rejects(downloadResource({...f,fetcher:async()=>{calls++;return new Response(null,{status:302,headers:{location:'http://unsafe.invalid/model'}});}}),/下载源/);assert.equal(calls,1);await assert.rejects(fs.access(f.dest));await assert.rejects(downloadResource({...f,url:'https://user:secret@example.org/file'}),/账号密码/);});
test('cancel aborts a pending fetch and does not try the next source',async t=>{const f=await fixture(t),controller=new AbortController();let calls=0;const job=downloadResource({...f,sources:['https://one.invalid/a','https://two.invalid/a'],signal:controller.signal,fetcher:async()=>{calls++;setTimeout(()=>controller.abort(),5);return new Promise(()=>{});}});await assert.rejects(job,error=>error.name==='AbortError');assert.equal(calls,1);await assert.rejects(fs.access(f.dest));});
test('invalid content range cannot append or commit untrusted bytes',async t=>{const f=await fixture(t);await fs.writeFile(f.dest+'.https.partial',data.subarray(0,4));await assert.rejects(downloadResource({...f,fetcher:async()=>new Response(data.subarray(4),{status:206,headers:{'content-range':`bytes 0-${data.length-1}/${data.length}`}})}),/下载源/);assert.deepEqual(await fs.readFile(f.dest+'.https.partial'),data.subarray(0,4));});
function fakeChild(action){const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=signal=>{setTimeout(()=>child.emit('close',signal==='SIGINT'?130:137),5);return true;};setImmediate(()=>action(child));return child;}
test('aria2 uses 8 connections and a separate sparse partial before HTTPS fallback',async t=>{const f=await fixture(t),aria2Path=path.join(f.root,'aria2c.exe');await fs.writeFile(aria2Path,'MZ');let called=false;await downloadResource({...f,aria2Path,spawnProcess:(_exe,args)=>{called=true;assert.ok(args.includes('--split=8'));assert.ok(args.includes('--max-connection-per-server=8'));assert.ok(!args.some(a=>a.startsWith('--max-redirect')));assert.ok(args.includes('--enable-rpc=false'));assert.ok(args.some(a=>a.includes('.aria2.partial')));return fakeChild(child=>child.emit('close',1));},fetcher:async(_u,o)=>{assert.equal(o.headers.Range,undefined);return ok();}});assert.equal(called,true);assert.deepEqual(await fs.readFile(f.dest),data);});
test('successful aria2 download is independently hashed before commit',async t=>{const f=await fixture(t),aria2Path=path.join(f.root,'aria2c.exe');await fs.writeFile(aria2Path,'MZ');const r=await downloadResource({...f,aria2Path,spawnProcess:()=>fakeChild(async child=>{await fs.writeFile(f.dest+'.aria2.partial',data);child.stdout.write(`[#ab12 ${data.length}/${data.length}(100%) CN:1 DL:20]\n`);child.emit('close',0);}),fetcher:()=>{throw Error('should not fallback');}});assert.equal(r.engine,'aria2');assert.deepEqual(await fs.readFile(f.dest),data);});
test('cancelling aria2 waits for its close event and never fetches HTTPS',async t=>{const f=await fixture(t),aria2Path=path.join(f.root,'aria2c.exe'),controller=new AbortController();await fs.writeFile(aria2Path,'MZ');let closed=false;await assert.rejects(downloadResource({...f,aria2Path,signal:controller.signal,spawnProcess:()=>{const child=fakeChild(()=>controller.abort());child.kill=()=>{setTimeout(()=>{closed=true;child.emit('close',130);},15);return true;};return child;},fetcher:()=>{throw Error('cancel must not fallback');}}),error=>error.name==='AbortError');assert.equal(closed,true);});
test('download destination cannot be a symlink',async t=>{const f=await fixture(t),real=path.join(f.root,'keep');await fs.writeFile(real,'private');try{await fs.symlink(real,f.dest);}catch(e){if(e.code==='EPERM')return t.skip('Windows user cannot create symlinks');throw e;}await assert.rejects(downloadResource({...f,fetcher:async()=>ok()}),/普通文件/);assert.equal(await fs.readFile(real,'utf8'),'private');});
test('aria2 arguments and numeric progress are exposed for real binary smoke',()=>{const args=buildAria2Args({url:'https://example.org/a',temporary:path.resolve('测试/a.partial'),sha256,timeoutMs:30000});assert.ok(args.includes('--check-certificate=true'));assert.ok(args.includes('--no-conf=true'));assert.ok(args.includes('--min-split-size=1M'));assert.deepEqual(parseProgress('[#ab8 120/1000(12%) CN:8 DL:50 ETA:18s]',1000),{received:120,total:1000,speedBytesPerSecond:50,connections:8});});

test('a damaged partial from an earlier source is retried fresh on the working mirror',async t=>{const f=await fixture(t);await fs.writeFile(f.dest+'.https.partial',Buffer.from('wrong'));let calls=0;await downloadResource({...f,fetcher:async(_u,o)=>{calls++;if(o.headers.Range)return new Response(data.subarray(5),{status:206,headers:{'content-range':`bytes 5-${data.length-1}/${data.length}`}});return ok();}});assert.equal(calls,2);assert.deepEqual(await fs.readFile(f.dest),data);});

test('an aria2 executable permission error still permits HTTPS fallback',async t=>{const f=await fixture(t),aria2Path=path.join(f.root,'aria2c.exe');await fs.writeFile(aria2Path,'MZ');const result=await downloadResource({...f,aria2Path,spawnProcess:()=>{const error=Error('cannot start');error.code='EACCES';throw error;},fetcher:async()=>ok()});assert.equal(result.engine,'https');assert.deepEqual(await fs.readFile(f.dest),data);});

function splitFixture(data){return [data.subarray(0,8),data.subarray(8,19),data.subarray(19)].map((chunk,index)=>({name:`model.part${index+1}`,url:`https://parts.example.test/${index}`,bytes:chunk.length,sha256:createHash('sha256').update(chunk).digest('hex'),chunk}));}
test('independent parts download concurrently, expose every progress row, and verify merged bytes',async t=>{
 const f=await fixture(t),parts=splitFixture(data),events=[];let running=0,maximum=0;
 const result=await downloadResource({...f,parts,onProgress:event=>events.push(event),fetcher:async url=>{running++;maximum=Math.max(maximum,running);await new Promise(resolve=>setTimeout(resolve,5));running--;return ok(parts[Number(new URL(url).pathname.slice(1))].chunk);}});
 assert.equal(result.engine,'multipart');assert.equal(maximum,3);assert.deepEqual(await fs.readFile(f.dest),data);
 assert.ok(events.some(event=>event.phase==='merging'));assert.equal(events.at(-1).parts.length,3);assert.ok(events.at(-1).parts.every(part=>part.phase==='complete'&&part.received===part.total));
});
test('all eight actual release parts start concurrently and retain independent verification',async t=>{
 const f=await fixture(t),parts=Array.from({length:8},(_,index)=>{const chunk=data.subarray(Math.floor(index*data.length/8),Math.floor((index+1)*data.length/8));return{name:`piece-${index}`,url:`https://example.test/${index}`,bytes:chunk.length,sha256:createHash('sha256').update(chunk).digest('hex'),chunk};});
 let active=0,maximum=0;await downloadResource({...f,parts,fetcher:async url=>{active++;maximum=Math.max(maximum,active);await new Promise(resolve=>setTimeout(resolve,15));active--;return ok(parts[Number(new URL(url).pathname.slice(1))].chunk);}});
 assert.equal(maximum,8);assert.deepEqual(await fs.readFile(f.dest),data);
});
test('verified parts survive cancellation and retry fetches only unfinished parts',async t=>{
 const f=await fixture(t),parts=splitFixture(data),controller=new AbortController();let cancelled=false;
 await assert.rejects(downloadResource({...f,parts,signal:controller.signal,onProgress:event=>{if(event.parts?.[0].phase==='complete'&&!cancelled){cancelled=true;controller.abort();}},fetcher:async url=>url.endsWith('/0')?ok(parts[0].chunk):new Promise(()=>{})}),error=>error.name==='AbortError');
 await assert.rejects(fs.access(f.dest));const requested=[];
 const result=await downloadResource({...f,parts,fetcher:async url=>{requested.push(url);return ok(parts[Number(new URL(url).pathname.slice(1))].chunk);}});
 assert.equal(result.resumed,true);assert.equal(requested.length,2);assert.ok(!requested.includes(parts[0].url));assert.deepEqual(await fs.readFile(f.dest),data);
});
test('part errors settle all workers before verified whole-file fallback',async t=>{
 const f=await fixture(t),parts=splitFixture(data),events=[];let active=0;
 const result=await downloadResource({...f,parts,onProgress:event=>events.push(event),fetcher:async(url,{signal})=>{
  if(url===f.url){assert.equal(active,0);return ok();}
  active++;try{if(url.endsWith('/0'))return new Response('not found',{status:404});return await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}finally{active--;}
 }});
 assert.equal(result.engine,'https');assert.ok(events.some(event=>event.multipartFallback));assert.deepEqual(await fs.readFile(f.dest),data);
});
test('merged digest is independently checked even when each part digest is valid',async t=>{
 const f=await fixture(t),parts=splitFixture(data);await fs.writeFile(f.dest,'keep old file');
 await assert.rejects(downloadResource({...f,sha256:'f'.repeat(64),parts,fetcher:async url=>url===f.url?ok():ok(parts[Number(new URL(url).pathname.slice(1))].chunk)}),/校验/);
 assert.equal(await fs.readFile(f.dest,'utf8'),'keep old file');await assert.rejects(fs.access(f.dest+'.merge.partial'));
});
test('unsafe and inconsistent part manifests fail before any network access',async t=>{
 const f=await fixture(t),parts=splitFixture(data);let calls=0;
 for(const bad of [[{...parts[0],name:'../private'},...parts.slice(1)],[{...parts[0],bytes:1},...parts.slice(1)],[parts[0],parts[0],parts[2]]])await assert.rejects(downloadResource({...f,parts:bad,fetcher:()=>{calls++;throw Error('should not run');}}),/分卷/);
 assert.equal(calls,0);
});
test('bundled 64 MiB release catalog is pinned and every entry validates',async()=>{
 const {resourceParts}=require('../electron/resource-sources.cjs'),catalogPath=path.join(__dirname,'../resources/resource-parts.json'),contents=await fs.readFile(catalogPath),catalog=JSON.parse(contents);
 assert.equal(createHash('sha256').update(contents).digest('hex'),'b67b4cc17ac51088d266e0256b6fd54d8f25a1fca652a2dab6879f2c85c7d0ed');
 assert.ok(Object.keys(catalog.files).length>=10);
 for(const [digest,row] of Object.entries(catalog.files)){const parts=resourceParts(row.bytes,digest);assert.equal(parts.reduce((sum,part)=>sum+part.bytes,0),row.bytes);assert.ok(parts.every(part=>part.bytes<=64*1024**2));}
});
