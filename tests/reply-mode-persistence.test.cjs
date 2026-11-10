const test = require('node:test');
const assert = require('node:assert/strict');
const {mainHarness} = require('./helpers/main-harness.cjs');

test('local reply source survives save and reload along with original bilingual text', async () => {
 const message = {id:'reply',role:'assistant',content:'你好。太好了！',zh:'你好。太好了！',ja:'こんにちは。よかった！',status:'done',replyMode:'local'};
 const state = {profiles:[{id:'default',name:'默认'}],conversations:[{id:'conversation',messages:[message]}]};
 const app = await mainHarness({state});
 await app.invoke('save',state);
 const loaded = await app.invoke('load');
 assert.deepEqual(JSON.parse(JSON.stringify(loaded.state.conversations[0].messages[0])),message);
});
