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
