const test = require('node:test');
const assert = require('node:assert/strict');
const {chat} = require('../electron/chat.cjs');
const {BilingualStream, completeBilingual} = require('../electron/bilingual.cjs');
const {assertJapaneseSpeech} = require('../electron/speech.cjs');

const tick = () => new Promise(resolve => setImmediate(resolve));
const gate = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return {promise, resolve};
};

function provider(text) {
  const wire = [...text].map(character => 'data: ' + JSON.stringify({choices:[{delta:{content:character}}]}) + '\n\n').join('') + 'data: [DONE]\n\n';
  const bytes = new TextEncoder().encode(wire);
  return async () => new Response(new ReadableStream({start(controller) {
    // Split UTF-8 code points and SSE JSON independently of model tokens.
    for (let offset = 0; offset < bytes.length; offset += 7) controller.enqueue(bytes.slice(offset, offset + 7));
    controller.close();
  }}), {headers:{'Content-Type':'text/event-stream'}});
}

async function receive(reply) {
  let visible = '';
  const parser = new BilingualStream(text => {visible += text;});
  await chat({profile:{base:'https://example.test/v1',model:'fake-provider'},messages:[{role:'user',content:'今天怎么样？'}],fetcher:provider(reply),onToken:text => parser.push(text)});
  return {visible, parsed:parser.value()};
}

async function speechRecorder() {
  const {SpeechSession} = await import('../src/speech/session.mjs');
  const synthesized = [], played = [];
  const session = new SpeechSession({
    bridge:{begin:async()=>{},stop:async()=>{},synthesize:async (id,text) => {
      assertJapaneseSpeech(text); synthesized.push({id,text}); return {id,text};
    }},
    player:{stop(){},play:async audio => {played.push(audio);}},
  });
  return {session,synthesized,played};
}

test('provider SSE to stored bilingual answer to speech keeps Chinese out of TTS', async () => {
  const answer = {zh:'今天也辛苦了。可以先喝杯茶。',ja:'今日もお疲れさま。まずはお茶を飲みましょう。'};
  const received = await receive(JSON.stringify(answer));
  assert.equal(received.visible, answer.zh);
  const result = await completeBilingual(received.parsed, {translate:() => {throw Error('local model should not run');}});
  const {session,synthesized,played} = await speechRecorder();
  session.start('bilingual-message'); session.push(result.ja); session.finish(); await tick();
  assert.equal(synthesized.map(row=>row.text).join(''), answer.ja);
  assert.equal(played.map(row=>row.text).join(''), answer.ja);
  assert.equal(result.zh, answer.zh);
  assert.ok(synthesized.every(row => !row.text.includes('辛苦') && !row.text.includes('喝杯茶')));
});

test('provider ignoring envelope is translated locally before speech can begin', async () => {
  const received = await receive('不必急着下结论。');
  let translatedInput;
  const result = await completeBilingual(received.parsed, {requestId:'fallback',translate:async input => {
    translatedInput = input; return {text:'急いで結論を出す必要はないわ。',device:'cpu'};
  }});
  assert.deepEqual(translatedInput, {text:'不必急着下结论。',source:'zh',target:'ja',requestId:'fallback'});
  const {session,synthesized} = await speechRecorder();
  session.start('fallback');session.push(result.ja);session.finish();await tick();
  assert.equal(result.source,'local');assert.equal(result.device,'cpu');
  assert.equal(synthesized[0].text,'急いで結論を出す必要はないわ。');
});

test('translation failure preserves answer, does not produce speech text', async () => {
  const received = await receive('今晚早点休息吧。');
  const result = await completeBilingual(received.parsed, {translate:async()=>{throw Error('offline model missing');}});
  assert.equal(result.zh,'今晚早点休息吧。');assert.equal(result.ja,'');
  assert.equal(result.translationStatus,'error');assert.match(result.translationError,/missing/);
});

test('stopping during translation discards even successful late model output', async () => {
  const delayed = gate(), controller = new AbortController();
  const translating = completeBilingual({zh:'晚上好。'}, {signal:controller.signal,translate:()=>delayed.promise});
  controller.abort();delayed.resolve({text:'こんばんは。'});
  await assert.rejects(translating, {name:'AbortError'});
});

test('already cancelled API bilingual response must not bypass cancellation via fast path', async () => {
  const controller = new AbortController();controller.abort();
  await assert.rejects(completeBilingual({zh:'你好。',ja:'こんにちは。'}, {signal:controller.signal,translate:async()=>({text:'使いません。'})}), {name:'AbortError'});
});

test('old response audio arriving after a new bilingual reply cannot be played', async () => {
  const {SpeechSession} = await import('../src/speech/session.mjs');
  const delayed = gate(), played = [];
  const flow = new SpeechSession({
    bridge:{begin:async()=>{},stop:async()=>{},synthesize:async(id,text)=>{assertJapaneseSpeech(text);return id==='old'?delayed.promise:{id,text};}},
    player:{stop(){},play:async audio=>played.push(audio)},
  });
  flow.start('old');flow.push('古い返事です。');flow.finish();await tick();
  flow.cancel();flow.start('new');flow.push('新しい返事です。');flow.finish();await tick();
  delayed.resolve({id:'old',text:'古い返事です。'});await tick();
  assert.deepEqual(played,[{id:'new',text:'新しい返事です。'}]);
});

test('real main IPC converts a Japanese-only remote answer for the desktop while retaining Japanese speech',async()=>{
  const {mainHarness}=require('./helpers/main-harness.cjs');
  const profile={id:'remote',base:'https://example.test/v1',model:'synthetic'};
  const answer='こんにちは、今日はどうだった？';
  const app=await mainHarness({state:{profiles:[profile],activeProfile:profile.id,conversations:[],translationMode:'api'},reply:async({messages})=>messages[0].content.includes('Japanese text into natural Simplified Chinese')?'你好，今天过得怎么样？':answer});
  const result=await app.invoke('chat',{id:'japanese-provider',profileId:profile.id,messages:[{role:'user',content:'今天怎么样？'}]});
  assert.equal(result.bilingual.zh,'你好，今天过得怎么样？');assert.equal(result.bilingual.ja,answer);
  assert.equal(app.companions.replies.at(-1).zh,result.bilingual.zh);assert.equal(app.companions.replies.at(-1).ja,answer);
});

test('local JSON reply is parsed before forwarding, never leaving JSON syntax in companion bubble',async()=>{
  const {mainHarness}=require('./helpers/main-harness.cjs');
  const app=await mainHarness({state:{chatMode:'local',conversations:[]},localReply:JSON.stringify({zh:'下午好。',ja:'こんにちは。'})});
  const result=await app.invoke('chat',{id:'local-json',mode:'local',messages:[{role:'user',content:'你好'}]});
  assert.equal(result.bilingual.zh,'下午好。');assert.equal(app.companions.replies.at(-1).zh,'下午好。');
  assert.equal(result.bilingual.ja,'ローカルで翻訳しました。');
});

test('proactive model request reuses the saved provider without reading visual input or writing a fake user turn',async()=>{
  const {mainHarness}=require('./helpers/main-harness.cjs');const profile={id:'remote',base:'https://example.test/v1',model:'synthetic'};
  const app=await mainHarness({state:{profiles:[profile],activeProfile:'remote',activeCharacter:'yukino',conversations:[],translationMode:'api'},reply:'今天有空听听歌吗？'});
  const abort=new AbortController();const result=await app.companions.options.onProactive({id:'proactive-1',prompt:'聊聊音乐'},{signal:abort.signal,characterId:'yukino'});
  assert.equal(result.zh,'今天有空听听歌吗？');assert.equal(app.requests.length,1);assert.match(app.requests[0].messages.at(-1).content,/聊聊音乐/);assert.doesNotMatch(JSON.stringify(app.requests[0]),/image_url/);assert.deepEqual(JSON.parse(app.storage.get('state.json')).conversations,[]);
});
test('a user chat preempts an in-flight proactive generation',async()=>{
  const {mainHarness}=require('./helpers/main-harness.cjs');const profile={id:'remote',base:'https://example.test/v1',model:'synthetic'},entered=gate(),pending=gate();let count=0;
  const app=await mainHarness({state:{profiles:[profile],activeProfile:'remote',activeCharacter:'yukino',conversations:[],translationMode:'api'},reply:async()=>{if(++count===1){entered.resolve();await pending.promise;return '迟来的消息。';}return JSON.stringify({zh:'你好',ja:'こんにちは。'});}});
  const abort=new AbortController(),first=app.companions.options.onProactive({id:'proactive-old',prompt:'主动聊天'},{signal:abort.signal,characterId:'yukino'});await entered.promise;
  const reply=await app.invoke('chat',{id:'user-chat',profileId:'remote',messages:[{role:'user',content:'你好'}]});assert.equal(reply.bilingual.zh,'你好');pending.resolve();await assert.rejects(first);
});
