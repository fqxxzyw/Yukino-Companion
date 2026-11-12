const test=require('node:test');
const assert=require('node:assert/strict');
const {parseMemory,memoryUserText,extractMemory,startMemoryExtraction,affinityContext}=require('../electron/automatic-memory.cjs');
test('recent user statements provide context without treating assistant text as fact',()=>{
 assert.equal(memoryUserText([{role:'user',content:'我叫小雪'},{role:'assistant',content:'你叫小雨'},{role:'user',content:'对，记住我的名字'}]),'我叫小雪\n对，记住我的名字');
});
test('only bounded string facts are accepted from the extraction response',()=>{
 assert.deepEqual(parseMemory('```json\n["喜欢蓝色", 42, "喜欢蓝色", "x\\ny"]\n```'),['喜欢蓝色','x y']);
 assert.deepEqual(parseMemory('not JSON'),[]);
});
test('extraction sends only the current user text and returns structured facts',async()=>{
 let request;const output=await extractMemory({settings:{profile:{model:'test'}},text:'我喜欢蓝色',transport:async value=>{request=value;value.onToken('["喜欢蓝色"]')}});
 assert.deepEqual(output,['喜欢蓝色']);assert.equal(request.messages[1].content,'我喜欢蓝色');assert.equal(request.messages.length,2);
});
test('affinity questions receive the clamped local score and ordinary questions do not',()=>{
 assert.match(affinityContext('我的好感度是多少？',{relationship:{affection:52.6}}),/53 \/ 100/);
 assert.match(affinityContext('affinity?',{relationship:{affection:1000}}),/100 \/ 100/);
 assert.match(affinityContext('好感度？',{}),/35 \/ 100/);
 assert.equal(affinityContext('今天做什么',{}),'');
});
test('new facts append without replacing manual edits or exceeding the budget',async()=>{
 const {appendExtractedMemories}=await import('../src/companion/automatic-memory.mjs');
 assert.equal(appendExtractedMemories('自己写的\n• 喜欢蓝色',['喜欢蓝色','学习日语']), '自己写的\n• 喜欢蓝色\n• 学习日语');
 assert.equal(appendExtractedMemories('abc',['学习日语'],5),'abc');
});

test('extracted facts appear in the active memory editor and stay with their original character',async()=>{
 const {recordExtractedMemories}=await import('../src/companion/automatic-memory.mjs');
 const longMemory='手'.repeat(700);
 const initial={activeCharacter:'a',memory:longMemory,characters:[{id:'a',memory:longMemory},{id:'b',memory:'其他角色'}]};
 const updated=recordExtractedMemories(initial,'a',['喜欢蓝色']);
 assert.equal(updated.memory,longMemory+'\n• 喜欢蓝色');
 assert.equal(updated.characters[0].memory,updated.memory);
 const switched={...updated,activeCharacter:'b',memory:'其他角色'};
 const later=recordExtractedMemories(switched,'a',['学习日语']);
 assert.equal(later.memory,'其他角色');
 assert.match(later.characters[0].memory,/学习日语/);
 assert.strictEqual(recordExtractedMemories({...initial,autoMemory:false},'a',['喜欢蓝色']).memory,longMemory);
 assert.strictEqual(recordExtractedMemories(updated,'a',['学习日语'],longMemory),updated);
});

test('memory extraction runs after chat completion and delivers only successful results',async()=>{
 let finish,received;
 const task=startMemoryExtraction({settings:{},text:'我喜欢蓝色',transport:({onToken})=>new Promise(resolve=>{finish=()=>{onToken('["喜欢蓝色"]');resolve()}}),onResult:facts=>{received=facts}});
 task.publish();assert.equal(received,undefined);
 finish();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(received,['喜欢蓝色']);
});
test('cancelled or timed out extractions cannot publish late results',async()=>{
 let finish,received=false;const parent=new AbortController();
 const task=startMemoryExtraction({settings:{},text:'我喜欢蓝色',signal:parent.signal,transport:({onToken})=>new Promise(resolve=>{finish=()=>{onToken('["喜欢蓝色"]');resolve()}}),onResult:()=>{received=true},timeoutMs:10});
 parent.abort();task.publish();finish();await new Promise(resolve=>setTimeout(resolve,20));assert.equal(received,false);
 let finishTimeout;const timed=startMemoryExtraction({settings:{},text:'喜欢蓝色',transport:({onToken})=>new Promise(resolve=>{finishTimeout=()=>{onToken('["喜欢蓝色"]');resolve()}}),onResult:()=>{received=true},timeoutMs:10});
 timed.publish();await new Promise(resolve=>setTimeout(resolve,20));finishTimeout();await new Promise(resolve=>setImmediate(resolve));assert.equal(received,false);
});
