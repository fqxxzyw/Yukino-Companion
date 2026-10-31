const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os');
const {enginePlan}=require('../electron/tts-engine.cjs'),{SpeechService,DEFAULTS,validateSettings}=require('../electron/speech.cjs');
function fixture(config={},load=async()=>({device:'cuda:0'})){
 const calls=[],workers=[];const service=new SpeechService({script:__filename,stateDir:os.tmpdir(),readinessChecker:async()=>({configured:true,missing:[]})});
 service.makeWorker=async cfg=>{calls.push(['python',cfg.python]);const worker={closed:false,close(){this.closed=true;},request:async(method,data)=>{calls.push([method,data]);return load(data.config);}};workers.push(worker);return worker;};service.configure({...DEFAULTS,version:'v2',python:process.execPath,aquaPython:path.resolve('fake-aqua-python'),...config});return {service,calls,workers};
}
test('engine planning preserves v1 and unsupported versions without weight conversion',()=>{
 for(const version of ['v1','v4','v5dev','v5turbo']){const plan=enginePlan({...DEFAULTS,version,aquaPython:process.execPath});assert.equal(plan.engine,'standard');assert.equal(plan.verified,false);assert.match(plan.reason,new RegExp(version));assert.equal(enginePlan({...DEFAULTS,version,engine:'aqua'}).blocked,true);}
});
test('settings reject invalid engine, queue limits and crossed segmentation budgets',()=>{
 for(const patch of [{engine:'fake'},{aquaGraph:'guess'},{maxConcurrentTasks:0},{maxPendingSegments:999},{maxBufferedAudioSeconds:Infinity},{minSegmentChars:36,targetSegmentChars:35}])assert.throws(()=>validateSettings({...DEFAULTS,...patch}));
 assert.equal(validateSettings({...DEFAULTS}).engine,'auto');
});
test('successful Aqua load uses selected interpreter once and truthfully reports actual capabilities',async()=>{
 const f=fixture();await f.service.ensureLoaded();await f.service.ensureLoaded();assert.equal(f.workers.length,1);assert.equal(f.calls[0][1],path.resolve('fake-aqua-python'));assert.equal(f.service.status.metadata.engine,'aqua');assert.equal(f.service.status.metadata.capabilities.nativeBatch,false);assert.equal(f.service.status.metadata.capabilities.maxConcurrentTasks,1);f.service.dispose();
});
test('auto initialization failure visibly falls back to standard in a different process',async()=>{
 const f=fixture({},async cfg=>{if(cfg.engine==='aqua')throw Error('CUDA fixture unavailable');return {device:'cpu'};});await f.service.ensureLoaded();assert.equal(f.workers.length,2);assert.equal(f.workers[0].closed,true);assert.deepEqual(f.calls.filter(c=>c[0]==='python').map(c=>c[1]),[path.resolve('fake-aqua-python'),process.execPath]);assert.equal(f.service.status.actualEngine,'standard');assert.equal(f.service.status.metadata.engine,'standard');assert.match(f.service.status.fallbackReason,/CUDA fixture/);f.service.dispose();
});
test('auto also recovers a missing Aqua executable, explicit Aqua never silently falls back',async()=>{
 const f=fixture();const original=f.service.makeWorker;f.service.makeWorker=cfg=>{if(cfg.python!==process.execPath)throw Error('missing interpreter');return original(cfg);};await f.service.ensureLoaded();assert.equal(f.service.status.metadata.engine,'standard');assert.match(f.service.status.fallbackReason,/missing interpreter/);f.service.dispose();
 const explicit=fixture({engine:'aqua'},async()=>{throw Error('incompatible model fixture');});await assert.rejects(explicit.service.ensureLoaded(),/incompatible model/);assert.equal(explicit.workers.length,1);assert.equal(explicit.service.status.phase,'error');explicit.service.dispose();
});
test('unsupported explicit Aqua is blocked before model allocation',async()=>{const f=fixture({engine:'aqua',version:'v1'});await assert.rejects(f.service.ensureLoaded(),/v1/);assert.equal(f.workers.length,0);f.service.dispose();});
