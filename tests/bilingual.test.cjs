const test = require('node:test');
const assert = require('node:assert/strict');
const {BilingualStream, completeBilingual} = require('../electron/bilingual.cjs');

test('Chinese JSON stream survives every split without speaking JSON or Japanese', () => {
  const zh = '今天说“你好”\n猫咪 🐱 也在。';
  const envelope = JSON.stringify({zh, ja: '今日はこんにちは。'}).replace('猫', '\\u732b');
  for (let size = 1; size <= envelope.length; size++) {
    let displayed = ''; const parser = new BilingualStream(t => displayed += t);
    for (let i = 0; i < envelope.length; i += size) parser.push(envelope.slice(i, i + size));
    assert.equal(displayed, zh); assert.equal(parser.value().ja, '今日はこんにちは。');
  }
});
test('reordered complete envelope works, plain Chinese uses local translation', () => {
  const parser = new BilingualStream(() => {}); parser.push('{"ja":"おはよう。","zh":"早上好。"}');
  assert.deepEqual(parser.value(), {zh:'早上好。', ja:'おはよう。'});
  const plain = new BilingualStream(() => {}); plain.push('今天也辛苦了。');
  assert.deepEqual(plain.value(), {zh:'今天也辛苦了。', ja:''});
});
test('missing Japanese translates, Chinese-only result never becomes speech', async () => {
  let calls = 0;
  const ready = await completeBilingual({zh:'早上好',ja:'早上好'}, {translate:async input => {calls++;assert.equal(input.target,'ja');return {text:'おはよう。'};}});
  assert.equal(calls,1);assert.equal(ready.ja,'おはよう。');
  const bad = await completeBilingual({zh:'你好'}, {translate:async () => ({text:'你好'})});
  assert.equal(bad.translationStatus,'error');assert.equal(bad.ja,'');assert.equal(bad.zh,'你好');
});
test('valid API Japanese avoids unnecessary model startup, local mode forces it', async () => {
  const ready = await completeBilingual({zh:'你好',ja:'こんにちは'}, {translate:() => {throw Error('must not run')}});
  assert.equal(ready.source,'api');
  const local = await completeBilingual({zh:'你好',ja:'こんにちは'}, {preferLocal:true,translate:async()=>({text:'こんにちは。'})});
  assert.equal(local.source,'local');
});
test('cancellation does not turn into a completed response', async () => {
  const ctrl = new AbortController(); ctrl.abort();
  await assert.rejects(completeBilingual({zh:'你好'}, {signal:ctrl.signal,translate:async()=>({text:'こんにちは'})}), /abort/i);
});
test('reasoning stripped and malformed response handled without raw JSON', () => {
  const parser = new BilingualStream(() => {});parser.push('<think>秘密</think>```json\n{"zh":"你好","ja":"こんにちは"}\n```');
  assert.equal(parser.value().zh,'你好');
  const partial = new BilingualStream(() => {});partial.push('{"zh":"你好","ja":');assert.equal(partial.value().zh,'你好');
  const invalid = new BilingualStream(() => {});invalid.push('{"message":"你好"}');assert.throws(()=>invalid.value(),/格式/);
});
test('Japanese-only provider answer is translated to Chinese for display, while speech keeps the Japanese original', async () => {
  const japanese='ここであなたに返事ができるわ。今日はどうだった？';
  const parser=new BilingualStream(()=>{});parser.push(japanese);
  assert.deepEqual(parser.value(),{zh:'',ja:japanese});
  const result=await completeBilingual(parser.value(),{requestId:'japanese-answer',translateToChinese:async request=>{assert.deepEqual(request,{text:japanese,source:'ja',target:'zh',requestId:'japanese-answer'});return {text:'我可以在这里回答你。今天过得怎么样？'};},translate:()=>{throw Error('must not translate back to Japanese')}});
  assert.equal(result.zh,'我可以在这里回答你。今天过得怎么样？');assert.equal(result.ja,japanese);assert.equal(result.translationStatus,'ready');
});
test('a Chinese translation failure keeps the Japanese source explicitly separate',async()=>{
  const ja='こんにちは、今日はいい天気ですね。';
  const result=await completeBilingual({zh:ja,ja:''},{translateToChinese:async()=>{throw Error('离线');}});
  assert.equal(result.zh,'');assert.equal(result.ja,ja);assert.equal(result.displayStatus,'error');assert.equal(result.translationStatus,'ready');
});
test('Japanese-only JSON response is not shown as raw JSON',()=>{
  const parser=new BilingualStream(()=>{});parser.push('{"ja":"こんにちは、今日はどう？"}');assert.deepEqual(parser.value(),{zh:'',ja:'こんにちは、今日はどう？'});
});
