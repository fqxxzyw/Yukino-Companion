const assert = require('node:assert/strict');
const test = require('node:test');
const {mainHarness} = require('./helpers/main-harness.cjs');

const target = {id:'touch-api', base:'https://example.test/v1', model:'test-chat'};
const state = {
  activeCharacter:'yukino', activeProfile:target.id, chatMode:'api', translationMode:'none',
  profiles:[target], characters:[{id:'yukino', useMemory:true, memory:'PRIVATE_MEMORY_FIXTURE'}],
  conversations:[{messages:[{role:'user', content:'PRIVATE_CHAT_FIXTURE'}]}],
};
const event = {reaction:'happy', gesture:'stroke', target};
const reply = {zh:'倒也不坏。', ja:'悪くないわね。'};

test('touch uses the current API and persona without sending conversation history or publishing a desktop bubble', async () => {
  const app = await mainHarness({state, reply});
  const result = await app.invoke('avatar-touch-reply', event);
  assert.equal(result.zh, reply.zh);
  assert.equal(result.ja, reply.ja);
  assert.equal(app.requests.length, 1);
  assert.equal(app.transport[0].url, 'https://example.test/v1/chat/completions');
  const messages = app.requests[0].messages;
  assert.equal(messages.length, 2);
  assert.match(messages[0].content, /雪之下雪乃/);
  assert.match(messages[1].content, /轻抚了虚拟人物/);
  assert.doesNotMatch(JSON.stringify(messages), /PRIVATE_(CHAT|MEMORY)_FIXTURE/);
  assert.equal(app.companions.replies.length, 0);
  assert.deepEqual(JSON.parse(app.storage.get('state.json')).conversations, state.conversations);
});

test('touch falls back for invalid replies, stale API settings and local chat', async () => {
  const app = await mainHarness({state, reply:'服务没有返回双语短句。'});
  assert.equal(await app.invoke('avatar-touch-reply', event), null);
  assert.equal(await app.invoke('avatar-touch-reply', {...event, target:{...target, model:'previous-model'}}), null);
  assert.equal(await app.invoke('avatar-touch-reply', {...event, reaction:'boundary'}), null);
  assert.equal(app.requests.length, 1);
  const local = await mainHarness({state:{...state, chatMode:'local'}});
  assert.equal(await local.invoke('avatar-touch-reply', event), null);
  assert.equal(local.requests.length, 0);
  assert.equal(local.localRequests.length, 0);
});

test('ordinary chat cancels pending touch generation and keeps its normal reply', async () => {
  let touchStarted;
  const started = new Promise(resolve => { touchStarted = resolve; });
  const app = await mainHarness({state:{...state, autoMemory:false}, reply:({messages})=>{
    if(messages.at(-1).content.startsWith('【应用事件】')){
      touchStarted();
      return new Promise(()=>{});
    }
    return JSON.stringify(reply);
  }});
  const pending = app.invoke('avatar-touch-reply', event);
  await started;
  assert.equal(await app.invoke('avatar-touch-reply', event), null);
  const chat = await app.invoke('chat', {id:'ordinary-chat', profileId:target.id, mode:'api', messages:[{role:'user', content:'你好'}]});
  assert.equal(chat.bilingual.zh, reply.zh);
  assert.equal(await pending, null);
  assert.equal(app.companions.replies.length, 1);
});
