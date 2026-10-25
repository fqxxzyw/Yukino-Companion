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
