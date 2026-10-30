const test = require('node:test');
const assert = require('node:assert/strict');
const {VoiceSessionStart} = require('../electron/voice-session-start.cjs');
const {mainHarness} = require('./helpers/main-harness.cjs');
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
function fixture() {
  const reads=[], actions=[], busy=[];
  const speech={
    session:null,
    configure(config){actions.push(['configure',config]);},
    begin(id){this.session=id;actions.push(['begin',id]);},
    stop(id){if(!id||this.session===id)this.session=null;actions.push(['stop',id]);},
  };
  const start=new VoiceSessionStart({speech,onBusy:value=>busy.push(value),readConfig:()=>{const gate=deferred();reads.push(gate);return gate.promise;}});
  return {start,speech,reads,actions,busy};
}

test('stop while reading voice configuration cannot resurrect a cancelled session',async()=>{
  const f=fixture(),starting=f.start.begin('old');
  const rejected=assert.rejects(starting,/已取消/);
  f.start.stop('old');f.reads[0].resolve({voice:'old'});await rejected;
  assert.deepEqual(f.actions,[['stop','old']]);assert.equal(f.speech.session,null);
  assert.deepEqual(f.busy,[true,false]);
});

test('out-of-order begin completion and stale stop cannot replace or release a newer session',async()=>{
  const f=fixture(),old=f.start.begin('old'),rejected=assert.rejects(old,/已取消/);
  const current=f.start.begin('new');f.start.stop('old');
  f.reads[1].resolve({voice:'new'});await current;
  f.reads[0].resolve({voice:'old'});await rejected;
  assert.equal(f.speech.session,'new');
  assert.deepEqual(f.actions,[['stop','old'],['configure',{voice:'new'}],['begin','new']]);
  assert.deepEqual(f.busy,[true,true]);
});

test('late failure from a replaced begin does not release newer audio ownership',async()=>{
  const f=fixture(),old=f.start.begin('old'),rejected=assert.rejects(old,/read failed/);
  const current=f.start.begin('new');f.reads[1].resolve({});await current;
  f.reads[0].reject(Error('read failed'));await rejected;
  assert.equal(f.speech.session,'new');assert.deepEqual(f.busy,[true,true]);
});

test('invalid session ID does not invalidate an already pending valid request',async()=>{
  const f=fixture(),current=f.start.begin('new');
  await assert.rejects(f.start.begin(''),/无效/);f.reads[0].resolve({});await current;
  assert.equal(f.speech.session,'new');assert.equal(f.reads.length,1);
});

test('current configuration failure releases ownership and allows another begin',async()=>{
  const f=fixture(),failed=f.start.begin('failed'),rejected=assert.rejects(failed,/read failed/);
  f.reads[0].reject(Error('read failed'));await rejected;
  assert.equal(f.start.pending,null);assert.deepEqual(f.busy,[true,false]);
  const current=f.start.begin('new');f.reads[1].resolve({});await current;assert.equal(f.speech.session,'new');
});

const state={profiles:[],conversations:[]};
test('real main IPC stop cancels the begin reservation before its async config read returns',async()=>{
  const app=await mainHarness({state}),baseline=app.voiceActions.length;
  const starting=app.invoke('voice-begin','cancelled-before-ready'),rejected=assert.rejects(starting,/已取消/);
  await app.invoke('voice-stop','cancelled-before-ready');await rejected;
  assert.equal(app.voice.session,null);
  assert.deepEqual(app.voiceActions.slice(baseline).map(item=>item.method),['stop']);
});

test('real main manual unload or load invalidates pending begin without late reconfiguration',async()=>{
  for(const action of ['voice-unload','voice-load']){
    const app=await mainHarness({state}),config=await app.invoke('voice-settings'),baseline=app.voiceActions.length;
    const starting=app.invoke('voice-begin','cancelled-before-ready'),rejected=assert.rejects(starting,/已取消/);
    await app.invoke(action,config);await rejected;
    assert.ok(!app.voiceActions.slice(baseline).some(item=>item.method==='begin'),action);
  }
});

test('real main renderer navigation, loss and close invalidate pending begin',async()=>{
  for(const event of ['did-start-navigation','render-process-gone','closed']){
    const app=await mainHarness({state}),baseline=app.voiceActions.length;
    const starting=app.invoke('voice-begin','cancelled-before-ready'),rejected=assert.rejects(starting,/已取消/);
    if(event==='closed')app.window.emit(event);
    else app.window.webContents.emit(event,{isMainFrame:true,isSameDocument:false});
    await rejected;
    assert.ok(!app.voiceActions.slice(baseline).some(item=>item.method==='begin'),event);
  }
});

test('prewarming is tied to the active voice session and stop invalidates a late load',async()=>{
  const app=await mainHarness({state}),loading=deferred(),entered=deferred();
  await assert.rejects(app.invoke('voice-prewarm','missing'),/过期/);
  await app.invoke('voice-begin','current');
  app.voice.ensureLoaded=async()=>{entered.resolve();return loading.promise;};
  const warming=app.invoke('voice-prewarm','current'),rejected=assert.rejects(warming,/过期/);await entered.promise;
  await app.invoke('voice-stop','current');loading.resolve({phase:'ready'});await rejected;
  assert.equal(app.voice.session,null);
});
