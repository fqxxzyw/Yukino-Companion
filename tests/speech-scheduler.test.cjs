const test=require('node:test'),assert=require('node:assert/strict');
const tick=()=>new Promise(setImmediate),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
async function setup({settings={},synthesize=async(_,text)=>text,play,prepare,capabilities}={}){
 const {OrderedSpeechScheduler}=await import('../src/speech/scheduler.mjs'),played=[],states=[],stops=[];
 const player={stop:()=>stops.push('player'),play:play|| (async text=>{played.push(text);await tick();}),...(prepare?{prepare}:{})};
 const flow=new OrderedSpeechScheduler({id:'request',bridge:{synthesize,stop:id=>stops.push(id)},player,settings,onState:s=>states.push(s)});if(capabilities)flow.setCapabilities(capabilities);return {flow,played,states,stops};
}
test('real simulated 800/200/500/100ms completions play strictly 0→1→2→3 without overlap',async()=>{
 let active=0,peak=0;const order=[],f=await setup({settings:{synthesisMode:'concurrent',maxConcurrentTasks:4},capabilities:{maxConcurrentTasks:4},synthesize:async(_,text)=>{await delay([800,200,500,100][+text]);return text;},play:async text=>{active++;peak=Math.max(peak,active);order.push(+text);await delay(3);active--;}});
 for(let i=0;i<4;i++)assert.equal(f.flow.submit(String(i)),true);f.flow.finish();const done=await f.flow.completion;assert.deepEqual(order,[0,1,2,3]);assert.equal(peak,1);assert.equal(done.completed,true);assert.equal(done.metrics.played,4);
});
test('local capability clamps concurrency to one while current playback and next synthesis overlap',async()=>{
 const playback=deferred(),next=deferred();let active=0,peak=0,count=0;const f=await setup({synthesize:async(_,text)=>{active++;peak=Math.max(peak,active);if(++count===2)await next.promise;active--;return text;},play:async text=>{f.played.push(text);if(text==='0')await playback.promise;}});
 f.flow.submit('0');f.flow.submit('1');f.flow.finish();await tick();assert.deepEqual(f.played,['0']);assert.equal(count,2);next.resolve();await tick();assert.deepEqual(f.played,['0']);playback.resolve();await f.flow.completion;assert.deepEqual(f.played,['0','1']);assert.equal(peak,1);
});
test('completion waits for real player consumption, never merely audio ready',async()=>{
 const gate=deferred(),f=await setup({play:()=>gate.promise});f.flow.submit('first');f.flow.finish();await tick();let completed=false;f.flow.completion.then(()=>completed=true);await tick();assert.equal(completed,false);gate.resolve();assert.equal((await f.flow.completion).completed,true);
});
test('pending and prepared bounds include active reservations and backpressure',async()=>{
 const gates=[deferred(),deferred()],f=await setup({settings:{maxPendingSegments:3,maxPreparedSegments:2,maxConcurrentTasks:4},capabilities:{maxConcurrentTasks:4},synthesize:(_,text)=>gates[+text].promise});
 assert.equal(f.flow.submit('0'),true);assert.equal(f.flow.submit('1'),true);assert.equal(f.flow.submit('2'),true);assert.equal(f.flow.submit('3'),false);assert.equal(f.flow.active,2);assert.equal(f.flow.tasks.size,3);f.flow.cancel();gates.forEach(g=>g.resolve('old'));await tick();assert.deepEqual(f.played,[]);
});
test('cancel during synthesis or decode ignores all late results and clears task audio',async()=>{
 for(const phase of ['synthesis','decode']){const gate=deferred(),f=await setup({synthesize:phase==='synthesis'?()=>gate.promise:async()=> 'audio',prepare:phase==='decode'?()=>gate.promise:undefined});f.flow.submit('a');await tick();f.flow.cancel();gate.resolve(phase==='decode'?{duration:1}: 'audio');await tick();assert.deepEqual(f.played,[]);assert.equal(f.flow.tasks.size,0);assert.equal((await f.flow.completion).cancelled,true);}
});
test('failure policies abort, retry once, or explicitly skip without queue deadlock',async()=>{
 for(const policy of ['abort','retry','skip']){let count=0;const f=await setup({settings:{failurePolicy:policy},synthesize:async(_,text)=>{if(text==='0'&&count++<2)throw Error('fixture failure');return text;}});f.flow.submit('0');f.flow.submit('1');f.flow.finish();const done=await f.flow.completion;assert.equal(done.completed,policy==='skip');assert.deepEqual(f.played,policy==='skip'?['1']:[]);assert.equal(count,policy==='retry'?2:1);}
});
test('audio seconds bound rejects oversized prepared data rather than accumulate without limit',async()=>{
 const f=await setup({settings:{maxBufferedAudioSeconds:2},prepare:async()=>({duration:3})});f.flow.submit('a');f.flow.finish();const done=await f.flow.completion;assert.equal(done.completed,false);assert.match(done.error,/缓冲/);assert.equal(f.flow.tasks.size,0);
});
test('playback-start metric and current subtitle wait for source onStarted, not preparation',async()=>{
 const gate=deferred();let options;const f=await setup({prepare:async()=>({duration:1}),play:async(_,o)=>{options=o;await gate.promise;}});f.flow.submit('こんにちは。');f.flow.finish();await tick();assert.equal(f.flow.metrics.firstPlaybackMs,null);assert.ok(!f.states.some(s=>s.phase==='playing'));options.onStarted();assert.ok(Number.isFinite(f.flow.metrics.firstPlaybackMs));assert.equal(f.states.at(-1).segmentText,'こんにちは。');gate.resolve();await f.flow.completion;
});
test('streaming session feeds many sentences through a bounded text inbox without dropping or repeating',async()=>{
 const {StreamingSpeechSession}=await import('../src/speech/streaming-session.mjs'),played=[];const flow=new StreamingSpeechSession({japaneseOnly:true,settings:{maxPendingSegments:2},bridge:{begin(){},prewarm:async()=>({metadata:{capabilities:{maxConcurrentTasks:1}}}),stop(){},synthesize:async(_,text)=>text},player:{stop(){},play:async text=>{played.push(text);await tick();}}});
 const raw='こんにちは。お元気ですか。'.repeat(30);flow.start('many');const job=flow.current;flow.push(raw);flow.finish();const done=await job.completion;assert.equal(done.completed,true);assert.equal(played.join(''),raw);assert.ok(done.metrics.queuedPeak<=2);
});
test('first Japanese utterance starts before finish; Chinese-only tail never reaches TTS',async()=>{
 const {StreamingSpeechSession}=await import('../src/speech/streaming-session.mjs'),played=[];const flow=new StreamingSpeechSession({japaneseOnly:true,bridge:{begin(){},prewarm(){},stop(){},synthesize:async(_,text)=>text},player:{stop(){},play:async text=>played.push(text)}});
 flow.start('ja');const job=flow.current;flow.push('うん！');await tick();assert.deepEqual(played,['うん！']);flow.push('未翻译中文');flow.finish();const done=await job.completion;assert.equal(done.completed,false);assert.deepEqual(played,['うん！']);
});
test('rapid new generation cannot revive prior playback even when request ID is reused',async()=>{
 const {StreamingSpeechSession}=await import('../src/speech/streaming-session.mjs'),old=deferred(),played=[];let n=0;const flow=new StreamingSpeechSession({bridge:{begin(){},prewarm(){},stop(){},synthesize:async(_,text)=>++n===1?old.promise:text},player:{stop(){},play:async text=>played.push(text)}});flow.start('same');flow.push('古いです。');await tick();flow.start('same');const job=flow.current;flow.push('新しいです。');flow.finish();await job.completion;old.resolve('古いです。');await tick();assert.deepEqual(played,['新しいです。']);
});
