const test=require('node:test'),assert=require('node:assert/strict');
const {BilingualStream}=require('../electron/bilingual.cjs'),{createStreamingTranslation}=require('../electron/streaming-translation.cjs');
const tick=()=>new Promise(setImmediate);
test('top-level Japanese envelope emits before full LLM JSON is complete, split escapes stay safe',()=>{
 let spoken='';const p=new BilingualStream(()=>{},delta=>spoken+=delta);p.push('{"zh":"你好。","ja":"こん');assert.equal(spoken,'こん');p.push('にちは。\\u304');assert.equal(spoken,'こんにちは。');p.push('2');assert.equal(spoken,'こんにちは。あ');p.push('"}');assert.equal(p.value().ja,spoken);
});
test('quoted ja keys in prose, zh, nested fields, duplicate keys, and raw Chinese never become speech',()=>{
 for(const raw of ['你好。','文字 {"ja":"こんにちは。"}','{"zh":"引用 \\"ja\\": こんにちは。"}','{"other":{"ja":"こんにちは。"}}','{"zh":"正文","zh":"正文","ja":"こんにちは。"}']){let spoken='';const p=new BilingualStream(()=>{},d=>spoken+=d);p.push(raw);assert.equal(spoken,'',raw);}
});
test('ja-first supported envelopes and surrogate pairs emit safely',()=>{let s='';const p=new BilingualStream(()=>{},d=>s+=d);p.push('{"ja":"あ\\uD83D');assert.equal(s,'あ');p.push('\\uDE00！","zh":"啊"}');assert.equal(s,'あ😀！');});
test('Chinese-only provider translates first complete sentence before final flush',async()=>{
 const translated=[],spoken=[],ctrl=new AbortController();const flow=await createStreamingTranslation({signal:ctrl.signal,translate:async text=>{translated.push(text);return {text:'日語です。'};},onText:text=>spoken.push(text)});flow.push('你好！');await tick();assert.deepEqual(translated,['你好！']);assert.deepEqual(spoken,['日語です。']);flow.push('接下来还在生成');const done=await flow.finish();assert.deepEqual(translated,['你好！','接下来还在生成']);assert.equal(done.text,'日語です。日語です。');
});
test('translation failure returns successful prefix and never permanently blocks the queue',async()=>{
 let calls=0;const flow=await createStreamingTranslation({translate:async()=>{if(calls++)throw Error('fixture translation failed');return {text:'成功です。'};},onText(){}});flow.push('第一句。第二句。');const done=await flow.finish();assert.equal(done.text,'成功です。');assert.match(done.error.message,/failed/);assert.equal(flow.queue.length,0);
});
test('cancelled translation never emits a late Japanese result',async()=>{let resolve;const gate=new Promise(r=>resolve=r),spoken=[],ctrl=new AbortController();const flow=await createStreamingTranslation({signal:ctrl.signal,translate:()=>gate,onText:text=>spoken.push(text)});flow.push('你好！');await tick();ctrl.abort();flow.cancel();resolve({text:'遅れました。'});await tick();assert.deepEqual(spoken,[]);assert.ok((await flow.finish()).error);});
test('main IPC emits Japanese before local generation resolves using existing provider pipeline',async()=>{
 const {mainHarness}=require('./helpers/main-harness.cjs');let h,allow;const gate=new Promise(r=>allow=r);
 const state={chatMode:'local',activeCharacter:'yukino',translationMode:'local',characters:[{id:'yukino',name:'雪乃',localRoleplay:true}],profiles:[]};
 h=await mainHarness({state,localReply:async(_,options)=>{options.onChunk('你好！');await tick();await tick();assert.ok(h.sent.some(x=>x.channel==='speech-text'),'first translated sentence must arrive before generation returns');await gate;return {text:''};},translate:async()=>({text:'こんにちは。',source:'local'})});
 const result=h.invoke('chat',{id:'stream-local',mode:'local',messages:[{role:'user',content:'测试'}],streamSpeech:true});await tick();await tick();allow();const done=await result;assert.equal(done.bilingual.ja,'こんにちは。');assert.equal(h.translated.length,1);
});
