const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {mainHarness} = require('./helpers/main-harness.cjs');
const profile = {id:'provider',base:'https://example.test/v1',model:'provider-model'};
const state = {profiles:[profile],activeProfile:profile.id,conversations:[],persona:'',translationMode:'api'};
const request = {id:'message',profileId:profile.id,messages:[{role:'user',content:'今天也辛苦了。'}]};
const deferred = () => {let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};

test('real main entrypoint wires startup IPC and rejects non-main renderer callers', async () => {
  const app = await mainHarness({state});
  for(const name of ['chat','voice-synthesize','voice-install','translation-status','translation-save','translate','translation-cancel','companion-state','companion-set','close-choice']) assert.ok(app.handlers.has(name),name);
  assert.equal(app.window.visible,true);
  assert.match(app.window.loadedFile,/dist[/\\]index\.html$/);
  await assert.rejects(app.handlers.get('translate')({sender:{},senderFrame:{}},{text:'你好',requestId:'untrusted'}),/不允许/);
  assert.equal(app.translated.length,0);
});

test('real main returns two versions, emits only Chinese chunks, and forwards both to desktop companions', async () => {
  const app = await mainHarness({state,reply:{zh:'坐下喝杯茶吧。',ja:'座ってお茶を飲みましょう。'}});
  const result = await app.invoke('chat',request);
  assert.equal(result.bilingual.zh,'坐下喝杯茶吧。');
  assert.equal(result.bilingual.ja,'座ってお茶を飲みましょう。');
  assert.equal(app.sent.filter(row=>row.channel==='chunk').map(row=>row.payload.text).join(''),'坐下喝杯茶吧。');
  assert.equal(app.companions.replies[0].ja,result.bilingual.ja);
  assert.equal(app.companions.replies[0].id,request.id);
});

test('local mode obtains Chinese from API and runs the local translator before returning Japanese', async () => {
  const app = await mainHarness({state:{...state,translationMode:'local'},reply:'不必急着回答。'});
  const result = await app.invoke('chat',request);
  assert.match(app.requests[0].messages[0].content,/请用简体中文自然回答/);
  assert.doesNotMatch(app.requests[0].messages[0].content,/只返回一个 JSON 对象/);
  assert.equal(app.translated.length,1);
  assert.equal(app.translated[0].request.text,'不必急着回答。');
  assert.equal(result.bilingual.ja,'ローカルで翻訳しました。');
  assert.equal(result.bilingual.source,'local');
});

test('local translation failure returns the original Chinese and an explicit unavailable Japanese result', async () => {
  const app = await mainHarness({state,reply:'慢慢来就好。',translate:async()=>{throw Error('model missing');}});
  const result = await app.invoke('chat',request);
  assert.equal(result.ok,true);assert.equal(result.bilingual.zh,'慢慢来就好。');
  assert.equal(result.bilingual.ja,'');assert.equal(result.bilingual.translationStatus,'error');
  assert.match(result.bilingual.translationError,/model missing/);
});

test('main stop during API response prevents completed bilingual replies and companion updates', async () => {
  const reply = deferred(), entered = deferred();
  const app = await mainHarness({state,reply:async()=>{entered.resolve();return reply.promise;}});
  const active = app.invoke('chat',request);await entered.promise;
  await app.invoke('stop');reply.resolve(JSON.stringify({zh:'迟到',ja:'遅れた返事です。'}));
  assert.equal((await active).stopped,true);
  assert.equal(app.companions.replies.length,0);
});

test('empty translation paths resolve to bundled defaults and persist valid config', async () => {
  for(const packaged of [false,true]) {
    const app = await mainHarness({state,packaged});
    const result = await app.invoke('translation-save',{python:'',modelDir:'',device:'auto'});
    assert.equal(result.config.python,path.resolve('/embedded/python'));
    assert.equal(result.config.modelDir,app.defaultModelRoot);
    const saved=JSON.parse(app.storage.get('translation.json'));
    assert.equal(saved.python,result.config.python);assert.equal(saved.modelDir,result.config.modelDir);
    await app.invoke('translation-cancel','preview-id');assert.equal(app.cancelled.at(-1),'preview-id');
  }
});
