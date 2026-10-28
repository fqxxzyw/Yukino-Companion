const test=require('node:test'),assert=require('node:assert/strict');
const {videoRendererHarness}=require('./helpers/video-renderer-harness.cjs');
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};}

// Execute the actual companion renderer with deferred IPC/media responses.
// This verifies cancellation ordering, not native audio output or device setup.
async function fixture(t,{urls=[],plays=[]}={}){
 const h=await videoRendererHarness();t.after(()=>h.unload());await h.settle();
 const state={...h.state,preferences:{...h.state.preferences,soundEnabled:true}};
 h.emit(state);const instances=[],requests=[];const originalCall=h.sandbox.window.companion.call;
 h.sandbox.window.companion.call=(action,payload)=>{
  if(action!=='voice-url')return originalCall(action,payload);
  const index=requests.length;requests.push(payload);
  return index<urls.length?urls[index]:Promise.resolve('file:///synthetic-voice.ogg');
 };
 h.sandbox.Audio=class{
  constructor(url){this.src=url;this.paused=true;this.index=instances.length;this.pauseCount=0;instances.push(this);}
  play(){this.paused=false;return this.index<plays.length?plays[this.index]:Promise.resolve();}
  pause(){this.paused=true;this.pauseCount++;}
 };
 h.evaluate("voiceFiles=['synthetic-voice.ogg'];lastVoice=-1");
 return {...h,state,instances,requests,start:()=>h.evaluate('playVoice(true)'),current:()=>h.evaluate('audio'),status:h.nodes.get('chat-status')};
}

test('late old voice URL failure cannot stop a newer prerecorded voice or replace its status',async t=>{
 const old=deferred(),f=await fixture(t,{urls:[old.promise]});
 const earlier=f.start();await f.settle();await f.start();const current=f.instances[0];
 assert.equal(current.paused,false);f.status.textContent='当前状态';f.status.hidden=true;
 old.reject(Error('old URL failed'));await earlier;
 assert.equal(f.current(),current);assert.equal(current.paused,false);
 assert.equal(current.src,'file:///synthetic-voice.ogg');assert.equal(current.pauseCount,0);
 assert.equal(f.status.textContent,'当前状态');assert.equal(f.status.hidden,true);
});

test('late old Audio.play rejection cannot stop a newer prerecorded voice or show a stale error',async t=>{
 const old=deferred(),f=await fixture(t,{plays:[old.promise]});
 const earlier=f.start();await f.settle();assert.equal(f.instances.length,1);
 await f.start();const current=f.instances[1];assert.equal(current.paused,false);
 assert.equal(f.instances[0].paused,true);assert.equal(f.instances[0].src,'');
 f.status.textContent='当前状态';f.status.hidden=true;
 old.reject(Error('AbortError: previous play interrupted'));await earlier;
 assert.equal(f.current(),current);assert.equal(current.paused,false);assert.equal(current.pauseCount,0);
 assert.equal(current.src,'file:///synthetic-voice.ogg');
 assert.equal(f.status.textContent,'当前状态');assert.equal(f.status.hidden,true);
});

test('current prerecorded media failure still stops current audio and reports the error',async t=>{
 const current=deferred(),f=await fixture(t,{plays:[current.promise]});
 const playing=f.start();await f.settle();const audio=f.instances[0];
 assert.equal(audio.paused,false);current.reject(Error('current device failed'));await playing;
 assert.equal(f.current(),null);assert.equal(audio.paused,true);assert.equal(audio.src,'');
 assert.equal(f.status.hidden,false);assert.match(f.status.textContent,/声音暂时无法播放/);
});

test('current prerecorded URL failure still reports an error without constructing audio',async t=>{
 const current=deferred(),f=await fixture(t,{urls:[current.promise]});
 const playing=f.start();await f.settle();current.reject(Error('current URL failed'));await playing;
 assert.equal(f.instances.length,0);assert.equal(f.current(),null);
 assert.equal(f.status.hidden,false);assert.match(f.status.textContent,/声音暂时无法播放/);
});

test('TTS ownership or character change cancels pending prerecorded URLs and media without late errors',async t=>{
 for(const source of ['url','play'])for(const reason of ['tts','character']){
  const old=deferred(),f=await fixture(t,source==='url'?{urls:[old.promise]}:{plays:[old.promise]});
  const earlier=f.start();await f.settle();
  f.emit(reason==='tts'?{...f.state,speechBusy:true}:{...f.state,character:{id:'new-character',name:'新角色'}});
  assert.equal(f.current(),null);f.status.textContent='切换后的状态';f.status.hidden=true;
  old.reject(Error('late cancelled operation'));await earlier;
  assert.equal(f.current(),null);assert.ok(f.instances.every(audio=>audio.paused&&audio.src===''));
  assert.equal(f.status.textContent,'切换后的状态');assert.equal(f.status.hidden,true);
  if(reason==='tts'){const before=f.requests.length;await f.start();assert.equal(f.requests.length,before);}
 }
});
