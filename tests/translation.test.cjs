const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { TranslationService, validateConfig } = require('../electron/translation.cjs');

function fixture(factory) {
  return new TranslationService({ script: __filename, stateDir: os.tmpdir(), modelDir: os.tmpdir(), python: process.execPath, workerFactory: factory });
}
function worker(overrides = {}) {
  return { closed: false, async request(method, request) {
    if (method === 'load') return { device: 'cpu' };
    return { text: `訳:${request.text}`, source: 'zh', target: 'ja', model: 'test', device: 'cpu' };
  }, close() { this.closed = true; }, ...overrides };
}

test('translation settings reject shell-like paths, invalid device, noninteger threads', () => {
  assert.throws(() => validateConfig({ python: 'python; rm -rf /' }));
  assert.throws(() => validateConfig({ device: 'gpu' }));
  assert.throws(() => validateConfig({ cpuThreads: 2.5 }));
  assert.equal(validateConfig({ device: 'auto' }).cpuFallback, true);
});
test('translation requests are ordered and a loaded model is reused', async () => {
  const order = []; let loads = 0;
  const service = fixture(() => worker({ async request(method, request) {
    if (method === 'load') { loads++; return { device: 'cpu' }; }
    order.push(request.text); await new Promise(resolve => setTimeout(resolve, 5));
    return { source: 'zh', target: 'ja', text: `訳:${request.text}`, device: 'cpu' };
  } }));
  const [a,b] = await Promise.all([
    service.translate({ requestId: 'a', text: '你好' }), service.translate({ requestId: 'b', text: '谢谢' })
  ]);
  assert.deepEqual(order, ['你好', '谢谢']); assert.equal(loads, 1);
  assert.equal(a.requestId, 'a'); assert.equal(b.target, 'ja'); service.dispose();
});
test('translation failure never falls back to Chinese speech', async () => {
  const service = fixture(() => worker({ async request(method) { return method === 'load' ? {} : { source: 'zh', target: 'zh', text: '中文' }; } }));
  await assert.rejects(service.translate({ requestId: 'a', text: '你好' }), /有效日文/);
  service.dispose();
});
test('cancelled in-flight result is discarded, next request reloads', async () => {
  let release; let started; const startedPromise = new Promise(resolve => started=resolve); let count=0;
  const service = fixture(() => { count++; return worker({ async request(method, request) {
    if (method === 'load') return {};
    if (request.text === '旧') { started(); await new Promise(resolve => release=resolve); }
    return { source: 'zh', target: 'ja', text: '新しい' };
  } }); });
  const promise = service.translate({ requestId: 'old', text: '旧' });
  const rejection = assert.rejects(promise, { name: 'AbortError' });
  await startedPromise; service.cancel('old'); release(); await rejection;
  const result = await service.translate({ requestId: 'new', text: '新' });
  assert.equal(result.text, '新しい'); assert.equal(count, 2); service.dispose();
});
test('queued cancellation does not cancel a different active translation', async () => {
  let release; let started; const startedPromise=new Promise(resolve=>started=resolve);
  const service = fixture(() => worker({ async request(method) {
    if (method === 'load') return {};
    started(); await new Promise(resolve=>release=resolve);
    return { source: 'zh', target: 'ja', text: 'こんにちは' };
  } }));
  const active=service.translate({requestId:'a',text:'你好'});
  const queued=service.translate({requestId:'b',text:'谢谢'});
  const rejection=assert.rejects(queued,{name:'AbortError'});
  await startedPromise; service.cancel('b'); release();
  assert.equal((await active).text,'こんにちは'); await rejection; service.dispose();
});
test('abort signal stops translation and duplicate IDs are rejected', async () => {
  const controller=new AbortController();controller.abort();
  const service=fixture(()=>worker());
  await assert.rejects(service.translate({requestId:'a',text:'你好'},{signal:controller.signal}),{name:'AbortError'});
  const one=service.translate({requestId:'a',text:'你好'});
  await assert.rejects(service.translate({requestId:'a',text:'你好'}),/重复/);
  await one;service.dispose();
});
test('install verifies fixed files and records a writable offline model directory', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-translation-'));
  try {
    const data=Buffer.from('test model');
    const script=path.join(dir,'worker.py');await fs.writeFile(script,'');
    await fs.writeFile(path.join(dir,'model-manifest.json'),JSON.stringify({directory:'hy-mt2-1.8b-q4',baseUrl:'https://example.invalid/pinned',files:[{path:'model.safetensors',size:data.length,sha256:createHash('sha256').update(data).digest('hex')}]}));
    let fetches=0;
    const service=new TranslationService({script,stateDir:dir,python:process.execPath,fetcher:async()=>{fetches++;return new Response(data);}});
    const status=await service.install();assert.equal(status.ready,true);assert.equal(status.config.modelDir,path.join(dir,'models','hy-mt2-1.8b-q4'));
    await service.install();assert.equal(fetches,1);service.dispose();
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});

async function installFixture(t,options={}) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-translation-install-'));
  const script=path.join(dir,'worker.py'),bundled=path.join(dir,'bundled'),data=Buffer.from('bundled translated model');
  await fs.mkdir(bundled);await fs.writeFile(script,'');
  const filename='translation.gguf';await fs.writeFile(path.join(bundled,filename),data);
  await fs.writeFile(path.join(dir,'model-manifest.json'),JSON.stringify({directory:'hy-mt2-test',baseUrl:'https://example.invalid/pinned',files:[{path:filename,size:data.length,sha256:createHash('sha256').update(data).digest('hex')}]}));
  let fetches=0;const service=new TranslationService({script,stateDir:dir,modelDir:bundled,fetcher:async()=>{fetches++;return new Response(data)},...options});
  t.after(async()=>{service.dispose();await fs.rm(dir,{recursive:true,force:true})});
  return {service,dir,bundled,data,filename,fetches:()=>fetches};
}
function barrier(){let release,enter;return{entered:new Promise(resolve=>enter=resolve),wait:()=>{enter();return new Promise(resolve=>release=resolve)},release:(value)=>release(value)}}
test('valid bundled translation weights are reused without Python or any network download',async t=>{
  const f=await installFixture(t),status=await f.service.install();
  assert.equal(f.fetches(),0);assert.equal(status.modelDir,f.bundled);assert.equal(status.modelInstalled,true);assert.equal(status.runtimeAvailable,false);assert.equal(status.ready,false);assert.equal(status.modelSource,'bundled');assert.equal(status.phase,'installed');assert.equal(status.loaded,false);
  f.service.configure({python:process.execPath});const ready=await f.service.status();assert.equal(ready.ready,true);assert.equal(ready.runtimeAvailable,true);assert.equal(ready.loaded,false);
});
test('concurrent translation installs are rejected during manifest and in-place hash checks',async t=>{
  const gate=barrier(),f=await installFixture(t,{verifyFile:()=>gate.wait()});
  const first=f.service.install();await assert.rejects(f.service.install(),/正在准备/);
  await gate.entered;await assert.rejects(f.service.install(),/正在准备/);gate.release(true);await first;
  assert.equal(f.fetches(),0);assert.equal(f.service.installToken,null);
});
test('cancelling during existing-model verification prevents later downloads and permits retry',async t=>{
  const gate=barrier(),f=await installFixture(t,{verifyFile:()=>gate.wait()});
  const operation=f.service.install(),rejected=assert.rejects(operation,{name:'AbortError'});await gate.entered;
  f.service.cancel();gate.release(false);await rejected;
  assert.equal(f.fetches(),0);assert.equal(f.service.config.modelDir,f.bundled);assert.equal(f.service.phase,'paused');assert.equal(f.service.installToken,null);
  f.service.verifyFile=require('../electron/voice-resources.cjs').verified;const result=await f.service.install();assert.equal(result.modelInstalled,true);assert.equal(f.fetches(),0);
});
test('dispose during translation verification never publishes installed status or requests network',async t=>{
  const gate=barrier(),events=[],f=await installFixture(t,{verifyFile:()=>gate.wait(),notify:event=>events.push(event)});
  const operation=f.service.install(),rejected=assert.rejects(operation,{name:'AbortError'});await gate.entered;f.service.dispose();gate.release(true);await rejected;
  assert.equal(f.fetches(),0);assert.equal(events.some(event=>event.phase==='installed'),false);assert.equal(f.service.installToken,null);
});
test('request-specific chat cancellation does not cancel a separate translation installation',async t=>{
  const gate=barrier(),f=await installFixture(t,{verifyFile:()=>gate.wait()});
  const operation=f.service.install();await gate.entered;f.service.cancel('one-chat-request');gate.release(true);
  assert.equal((await operation).modelInstalled,true);assert.equal(f.service.installToken,null);
});
test('stopping all chat requests and changing the shared Python do not cancel a background model download',async t=>{
 const gate=barrier(),f=await installFixture(t,{verifyFile:()=>gate.wait()});const operation=f.service.install();await gate.entered;
 f.service.cancelRequests();f.service.configure({python:path.resolve('/new/shared/python')});gate.release(true);
 assert.equal((await operation).modelInstalled,true);assert.equal(f.service.installToken,null);
});
test('failed translation installation releases the entire lifecycle guard',async t=>{
  const f=await installFixture(t,{verifyFile:async()=>{throw Error('cannot read model')}});
  await assert.rejects(f.service.install(),/cannot read model/);assert.equal(f.service.installToken,null);assert.equal(f.service.phase,'error');
  f.service.verifyFile=require('../electron/voice-resources.cjs').verified;assert.equal((await f.service.install()).modelInstalled,true);
});
