const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {mainHarness}=require('./helpers/main-harness.cjs');
const referencePreset=require('../resources/voice-presets/yukino-default.json');
const state={profiles:[],conversations:[]};
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};

test('default voice resources download despite an unfinished custom reference, without pairing it with default audio',async()=>{
 const promptText='自分で選んだ音声の原文です。';
 const app=await mainHarness({state,voiceMissing:['gpt','sovits'],files:{'speech.json':JSON.stringify({promptText})}});
 const result=await app.invoke('setup-install',{features:['voice']});
 assert.equal(result.phase,'ready');assert.ok(app.voiceInstallCalls.includes('yukino-e2'));
 const saved=await app.invoke('voice-settings');assert.equal(saved.promptText,promptText);assert.equal(saved.reference,'');
 const directory=(await app.invoke('setup-status')).resourceDirectory;
 const reference=app.storage.get(path.relative(path.resolve('/virtual-user'),path.join(directory,'voice-presets','yukino-reference.wav')));
 assert.ok(Buffer.isBuffer(reference));assert.equal(createHash('sha256').update(reference).digest('hex'),referencePreset.reference.sha256);
 assert.equal((await app.invoke('voice-status')).configured,false,'a resource download does not make the unfinished custom voice usable');
});

test('default download does not replace a partial custom model pair or a missing custom reference',async()=>{
 const custom={gpt:path.resolve('/custom/my-model.ckpt'),sovits:'',reference:path.resolve('/custom/missing.wav'),promptText:'私の原文。'};
 const app=await mainHarness({state,voiceMissing:['sovits','reference'],files:{'speech.json':JSON.stringify(custom)}});
 await app.invoke('setup-install',{features:['voice']});assert.ok(app.voiceInstallCalls.includes('yukino-e2'));
 const saved=await app.invoke('voice-settings');for(const key of Object.keys(custom))assert.equal(saved[key],custom[key],key);
});

test('edits made during default voice download survive the resource commit',async()=>{
 const entered=deferred(),release=deferred();
 const app=await mainHarness({state,voiceMissing:['gpt'],voiceInstallBarrier:async id=>{if(id==='yukino-e2'){entered.resolve();await release.promise;}}});
 const installing=app.invoke('setup-install',{features:['voice']});await entered.promise;
 const latest={...await app.invoke('voice-settings'),gpt:path.resolve('/custom/new.ckpt'),sovits:'',reference:'',promptText:'新しい設定です。'};
 await app.invoke('voice-save',latest);release.resolve();await installing;
 const saved=await app.invoke('voice-settings');for(const key of ['gpt','sovits','reference','promptText'])assert.equal(saved[key],latest[key],key);
});

test('explicitly switching to the default reference clears the unmatched custom transcript together',async()=>{
 const app=await mainHarness({state,files:{'speech.json':JSON.stringify({promptText:'自分の原文。'})}});
 await app.invoke('voice-patch',{reference:'',promptText:'',promptLang:'all_ja'});const result=await app.invoke('voice-settings');
 assert.match(result.reference,/(?:ref|yukino-reference)\.wav$/);assert.equal(result.promptText,'');assert.equal(result.promptLang,'all_ja');
 const saved=await app.invoke('voice-settings');assert.equal(saved.reference,result.reference);assert.equal(saved.promptText,'');
});
