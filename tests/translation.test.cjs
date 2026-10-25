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
