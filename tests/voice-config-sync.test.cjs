const {test} = require('node:test');
const assert = require('node:assert/strict');

test('background installation updates weights without erasing local edits or newer edits during a save', async () => {
  const {VoiceConfigSync} = await import('../src/speech/config-sync.mjs');
  const sync = new VoiceConfigSync({gpt:'old',sovits:'old',volume:0.8,enabled:false});
  sync.edit({volume:0.5});
  const pending = sync.pending();
  assert.deepEqual(pending.patch,{volume:0.5});
  assert.deepEqual(sync.receive({gpt:'downloaded-gpt',sovits:'downloaded-sovits',volume:0.8,enabled:false}),{gpt:'downloaded-gpt',sovits:'downloaded-sovits',volume:0.5,enabled:false});
  sync.edit({volume:0.6,enabled:true});
  sync.acknowledge(pending);
  assert.deepEqual(sync.pending().patch,{volume:0.6,enabled:true});
  sync.acknowledge(sync.pending());
  assert.deepEqual(sync.receive({gpt:'downloaded-gpt',sovits:'downloaded-sovits',volume:0.6,enabled:true}),{gpt:'downloaded-gpt',sovits:'downloaded-sovits',volume:0.6,enabled:true});
});

test('overlapping saves serialize writes and reads and retain the latest engine selection',async()=>{
  const {VoiceConfigSync}=await import('../src/speech/config-sync.mjs'),sync=new VoiceConfigSync({engine:'auto'});
  let release,entered;const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve),calls=[];let persisted='auto';
  const api={write:async patch=>{calls.push('write:'+patch.engine);if(patch.engine==='aqua'){entered();await gate;}persisted=patch.engine;},read:async()=>{calls.push('read:'+persisted);return {engine:persisted}}};
  sync.edit({engine:'aqua'});const first=sync.save(api).then(value=>sync.receive(value));await started;
  sync.edit({engine:'standard'});const second=sync.save(api).then(value=>sync.receive(value));
  assert.deepEqual(calls,['write:aqua']);release();await first;await second;
  assert.deepEqual(calls,['write:aqua','read:aqua','write:standard','read:standard']);assert.equal(sync.value.engine,'standard');assert.deepEqual(sync.pending().patch,{});
});

test('a failed save preserves the dirty edit and does not block the next attempt',async()=>{
  const {VoiceConfigSync}=await import('../src/speech/config-sync.mjs'),sync=new VoiceConfigSync({engine:'auto'});sync.edit({engine:'standard'});
  await assert.rejects(sync.save({write:async()=>{throw Error('disk')},read:async()=>({engine:'auto'})}),/disk/);
  assert.deepEqual(sync.pending().patch,{engine:'standard'});const value=await sync.save({write:async()=>{},read:async()=>({engine:'standard'})});assert.equal(value.engine,'standard');assert.deepEqual(sync.pending().patch,{});
});
