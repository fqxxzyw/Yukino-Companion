const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {SpeechService,DEFAULTS}=require('../electron/speech.cjs');
const {speechCacheKey}=require('../electron/speech-cache-key.cjs');
const tick=()=>new Promise(setImmediate);
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject};};
function wav(){const audio=Buffer.alloc(48);audio.write('RIFF');audio.writeUInt32LE(40,4);audio.write('WAVEfmt ',8);audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(16000,24);audio.writeUInt32LE(32000,28);audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);audio.write('data',36);audio.writeUInt32LE(4,40);audio.writeInt16LE(500,44);return audio;}
function serviceFixture({cache=null,cacheKey=async()=> 'a'.repeat(64),request}={}){
 const calls=[],audio=wav();let clients=0;
 const service=new SpeechService({script:__filename,stateDir:os.tmpdir(),cache,cacheKey,readinessChecker:async()=>({configured:true,needsSetup:false,missing:[]}),workerFactory:()=>{
  clients++;return {closed:false,pending:null,async request(method,data){calls.push({method,data});return method==='load'?{device:'cpu'}:request?request(method,data):{audio:audio.toString('base64'),metadata:{device:'cpu'}};},close(){this.closed=true;}};
 }});
 service.makeWorker=async()=>service.workerFactory();service.config={...DEFAULTS,python:process.execPath,root:__dirname};service.begin('a');
 return {service,calls,audio,clients:()=>clients};
}
test('backend sends one bounded native batch instead of simultaneous single requests',async()=>{
 const f=serviceFixture();assert.deepEqual(await f.service.synthesizeBatch('a',['こんにちは。','お元気ですか。']),f.audio);
 assert.deepEqual(f.calls.map(call=>call.method),['load','synthesize_batch']);assert.deepEqual(f.calls[1].data,{texts:['こんにちは。','お元気ですか。'],speed:1});assert.equal(f.service.status.metadata.batchSentences,2);f.service.dispose();
});
test('invalid batches reject before loading or leaking untranslated Chinese',async()=>{
 const f=serviceFixture();for(const texts of [null,[],['です。','です。','です。','です。'],['你好。','こんにちは。'],['あ'.repeat(250),'い'.repeat(250)]])await assert.rejects(f.service.synthesizeBatch('a',texts));
 assert.equal(f.clients(),0);assert.deepEqual(f.calls,[]);f.service.dispose();
});
test('an extra concurrent request cannot kill the actual inference owner',async()=>{
 const gate=deferred(),f=serviceFixture({request:()=>gate.promise});await f.service.ensureLoaded();const first=f.service.synthesize('a','こんにちは。');await tick();
 const worker=f.service.worker;await assert.rejects(f.service.synthesizeBatch('a',['こんにちは。','そうですね。']),/推理忙/);assert.equal(worker.closed,false);
 gate.resolve({audio:f.audio.toString('base64')});assert.deepEqual(await first,f.audio);f.service.dispose();
});
test('disabled cache incurs no key generation or disk access',async()=>{
 const f=serviceFixture({cache:{enabled:false,read:()=>assert.fail('disabled read'),write:()=>assert.fail('disabled write')},cacheKey:()=>assert.fail('disabled key')});await f.service.synthesize('a','こんにちは。');f.service.dispose();
});
test('cache hit avoids model allocation, while cache write errors cannot break successful audio',async()=>{
 let writes=0;const hit=serviceFixture({cache:{enabled:true,read:async()=>wav(),write:()=>assert.fail('hit write')}});assert.deepEqual(await hit.service.synthesize('a','こんにちは。'),hit.audio);assert.equal(hit.clients(),0);assert.equal(hit.service.status.metadata.cacheHit,true);hit.service.dispose();
 const miss=serviceFixture({cache:{enabled:true,read:async()=>{throw Error('read denied')},write:async()=>{writes++;throw Error('disk full')}}});assert.deepEqual(await miss.service.synthesizeBatch('a',['こんにちは。','そうですね。']),miss.audio);assert.equal(writes,1);assert.equal(miss.service.status.phase,'ready');miss.service.dispose();
});
test('cancelled cache response cannot revive audio even when a session ID is reused',async()=>{
 const gate=deferred();let reads=0;const f=serviceFixture({cache:{enabled:true,read:()=>++reads===1?gate.promise:Promise.resolve(null),write:async()=>true}});
 const old=f.service.synthesize('a','古い返事です。');await tick();f.service.stop('a');f.service.begin('a');
 const fresh=f.service.synthesize('a','新しい返事です。');assert.deepEqual(await fresh,f.audio);
 gate.resolve(f.audio);await assert.rejects(old,/已过期/);assert.equal(f.service.status.phase,'ready');assert.equal(f.service.worker.closed,false);f.service.dispose();
});
test('late cancelled batch completion never closes the newer generation worker',async()=>{
 const gate=deferred();let count=0;const f=serviceFixture({request:()=>++count===1?gate.promise:{audio:wav().toString('base64')}});
 await f.service.ensureLoaded();const old=f.service.synthesizeBatch('a',['古い返事です。','待ってください。']);await tick();
 // A real worker is marked pending while kernels run and stop terminates it.
 f.service.worker.pending={};f.service.stop('a');f.service.begin('b');
 assert.deepEqual(await f.service.synthesize('b','新しい返事です。'),f.audio);const current=f.service.worker;
 gate.resolve({audio:f.audio.toString('base64')});await assert.rejects(old,/已过期/);assert.equal(current.closed,false);assert.equal(f.service.status.phase,'ready');f.service.dispose();
});
test('first sentence is immediate; following sentences use bounded groups and play in order',async()=>{
 const {SpeechSession}=await import('../src/speech/session.mjs'),gate=deferred(),calls=[],played=[],states=[];let active=0,maxActive=0;
 const bridge={begin:async()=>{},stop:async()=>{},synthesize:async(_id,text)=>{calls.push([text]);return text;},synthesizeBatch:async(_id,texts)=>{calls.push(texts);active++;maxActive=Math.max(maxActive,active);await Promise.resolve();active--;return texts.join('');}};
 const flow=new SpeechSession({bridge,onState:value=>states.push(value),player:{stop(){gate.resolve()},async play(audio){played.push(audio);if(played.length===1)await gate.promise;}}});
 // start() calls stop(), so use a separate deferred playback gate afterwards.
 const playback=deferred();flow.player.stop=()=>{};flow.player.play=async audio=>{played.push(audio);if(played.length===1)await playback.promise;};
 flow.start('a');flow.push('一句。二句。三句。四句。五句。六句。');flow.finish();const done=flow.current.completion;await tick();
 assert.deepEqual(calls,[['一句。'],['二句。','三句。','四句。']]);assert.deepEqual(played,['一句。']);playback.resolve();assert.equal((await done).completed,true);
 assert.deepEqual(played,['一句。','二句。三句。四句。','五句。六句。']);assert.deepEqual(states.filter(item=>item.phase==='playing').map(item=>item.sentenceIndex),[0,1,4]);assert.equal(maxActive,1);
});
test('long batches respect the joined 500-character bound without losing or replaying text',async()=>{
 const {SpeechSession}=await import('../src/speech/session.mjs'),calls=[],played=[];
 const flow=new SpeechSession({bridge:{begin:async()=>{},stop:async()=>{},synthesize:async(_,text)=>{calls.push([text]);return text},synthesizeBatch:async(_,texts)=>{calls.push(texts);return texts.join('')}},player:{stop(){},play:async text=>played.push(text)}});
 const raw=('あ'.repeat(170)+'。').repeat(8);flow.start('long');flow.push(raw);flow.finish();const done=flow.current.completion;await done;
 assert.equal(played.join(''),raw);assert.ok(calls.every(texts=>texts.length<=3&&texts.join('\n').length<=500));
});
test('cancel drops both prepared and late native batches and does not synthesize the remaining old queue',async()=>{
 const {SpeechSession}=await import('../src/speech/session.mjs'),batch=deferred(),playback=deferred(),calls=[],played=[];
 const flow=new SpeechSession({bridge:{begin:async()=>{},stop:async()=>{},synthesize:async(id,text)=>{calls.push({id,text});return text;},synthesizeBatch:async(id,texts)=>{calls.push({id,texts});return batch.promise;}},player:{stop(){playback.resolve()},play:async text=>{played.push(text);if(text==='旧一。')await playback.promise;}}});
 flow.start('old');flow.push('旧一。旧二。旧三。旧四。旧五。');flow.finish();await tick();flow.start('new');flow.push('新一。');flow.finish();await tick();batch.resolve('旧二。旧三。旧四。');await tick();assert.deepEqual(played,['旧一。','新一。']);assert.ok(!calls.some(call=>call.text==='旧五。'));
});
test('a failed batch is explicit and cannot skip to later sentences',async()=>{
 const {SpeechSession}=await import('../src/speech/session.mjs'),played=[],states=[];
 const flow=new SpeechSession({bridge:{begin:async()=>{},stop:async()=>{},synthesize:async(_,text)=>text,synthesizeBatch:async()=>{throw Error('batch failed')}},onState:value=>states.push(value),player:{stop(){},play:async text=>played.push(text)}});
 flow.start('a');flow.push('一。二。三。四。五。');flow.finish();const done=await flow.current.completion;assert.equal(done.completed,false);assert.equal(done.error,'batch failed');assert.deepEqual(played,['一。']);assert.equal(states.at(-1).phase,'error');
});
test('cache identity changes with voice contents, reference, text, speed and batch boundaries, not volume',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-cache-identity-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const cfg={...DEFAULTS,python:path.join(root,'python'),gpt:path.join(root,'voice.ckpt'),sovits:path.join(root,'voice.pth'),reference:path.join(root,'reference.wav'),root:path.join(root,'engine'),bert:path.join(root,'bert'),hubert:path.join(root,'hubert')};
 const script=path.join(root,'worker.py'),files=[cfg.python,cfg.gpt,cfg.sovits,cfg.reference,script,path.join(cfg.root,'GPT_SoVITS/TTS_infer_pack/TTS.py'),...['config.json','pytorch_model.bin','tokenizer.json'].map(name=>path.join(cfg.bert,name)),...['config.json','pytorch_model.bin','preprocessor_config.json'].map(name=>path.join(cfg.hubert,name))];
 for(const file of files){await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,'identity');}
 const key=await speechCacheKey(cfg,['こんにちは。'],script);assert.match(key,/^[a-f0-9]{64}$/);assert.equal(await speechCacheKey({...cfg,volume:.1},['こんにちは。'],script),key);
 assert.notEqual(await speechCacheKey({...cfg,speed:1.2},['こんにちは。'],script),key);assert.notEqual(await speechCacheKey(cfg,['そうですね。'],script),key);assert.notEqual(await speechCacheKey(cfg,['こんにちは。','そうですね。'],script),await speechCacheKey(cfg,['こんにちは。そうですね。'],script));
 await fs.writeFile(cfg.gpt,'different-model');assert.notEqual(await speechCacheKey(cfg,['こんにちは。'],script),key);const next=await speechCacheKey(cfg,['こんにちは。'],script);await fs.writeFile(cfg.reference,'new-reference');assert.notEqual(await speechCacheKey(cfg,['こんにちは。'],script),next);
 await fs.unlink(cfg.sovits);assert.equal(await speechCacheKey(cfg,['こんにちは。'],script),null);
});
