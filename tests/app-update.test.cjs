'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {createHash} = require('node:crypto');
const {gzipSync} = require('node:zlib');
const {createServer} = require('node:http');
const {once} = require('node:events');
const {createUpdater, newer, trustedAsset, githubGet} = require('../electron/app-update.cjs');

const tag = 'v0.4.4';
const name = 'Yukino-Companion-0.4.4-Base-Setup.exe';
const repo = 'https://github.com/fqxxzyw/Yukino-Companion/releases/download/';
const url = repo+tag+'/'+name;
const shared = Buffer.alloc(8192, 1), oldChunk = Buffer.alloc(2048, 2), changed = Buffer.alloc(2048, 3);
const old = Buffer.concat([shared,oldChunk,shared]), target = Buffer.concat([shared,changed,shared]);
const sha = b => createHash('sha512').update(b).digest('base64');
const blockmap = blocks => gzipSync(JSON.stringify({version:'2', files:[{name:'file',offset:0,sizes:blocks.map(b=>b.length),checksums:blocks.map(b=>sha(b).slice(0,24))}]}));

async function fixture(t, mode = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'yukino-update-'));
  const cache = path.join(root,'cache'), destination = path.join(root,'saved.exe');
  await fs.mkdir(cache);
  if (mode.cache !== false) {
    await fs.writeFile(path.join(cache,'installer.exe'), mode.badCache ? Buffer.alloc(old.length) : old);
    if (mode.map !== false) await fs.writeFile(path.join(cache,'current.blockmap'), mode.badMap ? 'broken' : blockmap([shared,oldChunk,shared]));
  }
  const manifest = () => 'version: 0.4.4\nfiles:\n  - url: '+name+'\n    size: '+target.length+'\n    sha512: '+(mode.wrongHash ? sha(old) : sha(target))+'\n';
  const asset = (name,size) => ({name,size,browser_download_url:repo+tag+'/'+name});
  const state = {requests:[],progress:[],launches:0,quits:0,saves:0};
  const server = createServer((req,res)=>{
    const send = body => {res.writeHead(200,{'content-length': Buffer.byteLength(body)});res.end(body);};
    if(req.url.endsWith('/releases/latest')) {
      if(mode.status){res.writeHead(mode.status);res.end();return;}
      const assets=[asset(name,target.length),asset('latest.yml',Buffer.byteLength(manifest()))];
      if(mode.foreign)assets[0].browser_download_url='https://example.org/'+name;
      return send(JSON.stringify({draft:false,prerelease:!!mode.preview,tag_name:tag,body:mode.notes,assets}));
    }
    if(req.url.endsWith('/latest.yml')) return send(manifest());
    if(req.url.endsWith('.blockmap')) {
      if(mode.noRemoteMaps){res.writeHead(404);res.end();return;}
      return send(blockmap(req.url.includes('0.4.3') ? [shared,oldChunk,shared] : [shared,changed,shared]));
    }
    if(!req.url.endsWith(name)){res.writeHead(404);res.end();return;}
    const range = req.headers.range;
    if (range && !mode.noRanges) {
      const [,a,b] = /^bytes=(\d+)-(\d+)$/.exec(range).map(Number);
      const chunk = target.subarray(a,b+1);
      state.requests.push(chunk.length);
      res.writeHead(206, {'content-range':'bytes '+a+'-'+b+'/'+target.length});res.end(chunk);
    } else {
      state.requests.push(target.length);
      if(mode.interrupt){res.writeHead(200,{'content-length':target.length});res.write(target.subarray(0,128));res.destroy();return;}
      send(mode.short ? target.subarray(1) : target);
    }
  });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const get = async (url,opts) => {
    const r = await fetch('http://127.0.0.1:'+server.address().port+new URL(url).pathname,opts);
    if(!r.ok) throw Object.assign(Error('HTTP '+r.status), {status:r.status});
    return r;
  };
  const make = () => createUpdater({get, app:{isPackaged:true,getVersion:()=>mode.current||'0.4.3',getPath:()=>root,quit:()=>state.quits++},
    shell:{showItemInFolder(){}}, dialog:{showSaveDialog:async()=>({filePath:destination})}, isPortable:!!mode.portable, cacheDir:cache,
    send:(_,p)=>{state.progress.push(p); if(mode.cancel)updater.cancel();}, beforeInstall:async()=>{state.saves++;},
    launch:async()=>{assert.ok(state.saves); if(mode.failLaunch)throw Error('failed'); state.launches++;}});
  const updater = make();
  t.after(async()=>{server.closeAllConnections(); await new Promise(done=>server.close(done)); await fs.rm(root,{recursive:true,force:true});});
  return {updater,make,state,destination,cache,filename:path.join(cache,'pending',name)};
}

test('accepts only newer stable versions and exact project assets',()=>{
  assert.equal(newer('v0.4.4','0.4.3'),true);
  for(const v of ['v0.4.3','v0.4.2','v0.4.4-beta','v0.04.4'])assert.equal(newer(v,'0.4.3'),false);
  assert.equal(trustedAsset({name,size:1,browser_download_url:url},tag,name),true);
  assert.equal(trustedAsset({name,size:1,browser_download_url:repo+'v0.4.3/'+name},tag,name),false);
});
for(const mode of [{current:'0.4.4'},{preview:true}])test('no update '+JSON.stringify(mode),async t=>{
  const {updater}=await fixture(t,mode);assert.equal(await updater.check(),null);await assert.rejects(updater.download());
});
for(const status of [403,404,429])test('surfaces GitHub HTTP '+status,async t=>{
  const {updater}=await fixture(t,{status});await assert.rejects(updater.check(),new RegExp(String(status)));
});
test('rejects a foreign asset and redirect',async t=>{
  const {updater}=await fixture(t,{foreign:true});await assert.rejects(updater.check(),/可信/);
  const orig=global.fetch;t.after(()=>global.fetch=orig);
  global.fetch=async()=>new Response(null,{status:302,headers:{Location:'https://untrusted.example/bad.exe'}});
  await assert.rejects(githubGet(url),/来源/);
});
test('returns the release changes section and bounds historical notes',async t=>{
  const mode={notes:'发布公告\r\n## 更新内容\r\n- 衣橱：新增筛选\r\n- 场景：调整光照\r\n## 下载\r\n安装说明'};
  const {updater}=await fixture(t,mode);
  assert.equal((await updater.check()).releaseNotes,'- 衣橱：新增筛选\n- 场景：调整光照');
  mode.notes='旧版修订'.repeat(900);
  const value=(await updater.check()).releaseNotes;
  assert.equal(value.length,2000);assert.ok(value.startsWith('旧版修订'));assert.ok(value.endsWith('…'));
});
test('rebuilds from an actual Range response, saves state and launches only on explicit install',async t=>{
  const {updater,make,state,filename}=await fixture(t,{map:false});
  assert.equal((await updater.check()).version,tag);
  const result=await updater.download();assert.equal(result.differential,true);
  assert.deepEqual(state.requests,[changed.length]);assert.deepEqual(await fs.readFile(filename),target);
  assert.equal(state.progress.at(-1).percent,100);assert.equal(state.quits,0);assert.equal(state.launches,0);
  const restarted=make();assert.equal((await restarted.check()).ready.fromCache,true);
  await restarted.install();assert.equal(state.saves,1);assert.equal(state.launches,1);assert.equal(state.quits,1);
});
for(const mode of [{cache:false},{badMap:true},{noRanges:true},{badCache:true},{noRemoteMaps:true}])test('falls back to verified full download '+JSON.stringify(mode),async t=>{
  const {updater,state,filename}=await fixture(t,mode);await updater.check();const result=await updater.download();
  assert.equal(result.differential,false);assert.equal(result.total,target.length);assert.equal(state.progress.at(-1).differential,false);
  assert.deepEqual(await fs.readFile(filename),target);assert.equal(state.launches,0);
});
for(const mode of [{wrongHash:true},{short:true, cache:false},{interrupt:true,cache:false}])test('failed download cleans partial, preserves existing cache, can retry '+JSON.stringify(mode),async t=>{
  const {updater,state,cache,filename}=await fixture(t,mode);await updater.check();
  await assert.rejects(updater.download());await assert.rejects(updater.install());assert.equal(state.quits,0);
  assert.deepEqual(await fs.readdir(path.dirname(filename)),[]);
  if(mode.cache!==false)assert.deepEqual(await fs.readFile(path.join(cache,'installer.exe')),old);
  Object.assign(mode,{wrongHash:false,short:false,interrupt:false});await updater.check();assert.equal((await updater.download()).ready,true);
});
test('cancel does not trigger a full fallback',async t=>{
  const mode={cancel:true};const {updater,state,filename}=await fixture(t,mode);await updater.check();
  assert.equal((await updater.download()).cancelled,true);assert.ok(!state.requests.includes(target.length));assert.deepEqual(await fs.readdir(path.dirname(filename)),[]);
});
test('rejects tampered pending installer just before launch',async t=>{
  const {updater,state,filename}=await fixture(t);await updater.check();await updater.download();await fs.writeFile(filename,old);
  await assert.rejects(updater.install(),/SHA-512/);assert.equal(state.launches,0);assert.equal(state.quits,0);
});
test('spawn failure keeps the app open and enables retry',async t=>{
  const mode={failLaunch:true};const {updater,state}=await fixture(t,mode);await updater.check();await updater.download();
  await assert.rejects(updater.install(),/启动失败/);assert.equal(state.quits,0);mode.failLaunch=false;await updater.install();assert.equal(state.quits,1);
});
test('portable saves only the full installer, never executes, retains previous destination on failure',async t=>{
  const mode={portable:true};const {updater,state,destination}=await fixture(t,mode);await updater.check();
  assert.equal((await updater.download()).saved,true);assert.deepEqual(state.requests,[target.length]);assert.deepEqual(await fs.readFile(destination),target);
  mode.short=true;await assert.rejects(updater.download());assert.deepEqual(await fs.readFile(destination),target);
  await assert.rejects(updater.install());assert.equal(state.launches,0);
});
