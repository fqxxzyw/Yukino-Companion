const test=require('node:test');
const assert=require('node:assert/strict');
const {mainHarness}=require('./helpers/main-harness.cjs');
const profile={id:'manual-fixture',base:'https://example.test/v1',model:'synthetic-model'};
const state={profiles:[profile],activeProfile:profile.id,conversations:[],translationMode:'api'};
const request={text:'SYNTHETIC_ONLY',requestId:'manual-cancel-fixture',mode:'api',profileId:profile.id};
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const aborted=error=>error.name==='AbortError'||/取消/.test(error.message);

test('manual translation cancelled immediately by ID never dispatches API content after preflight',async()=>{
 const app=await mainHarness({state,reply:'こんにちは。'}),pending=app.invoke('translate',request);
 const rejected=assert.rejects(pending,aborted);await app.invoke('translation-cancel',request.requestId);await rejected;
 assert.equal(app.requests.length,0);assert.equal(app.network.length,0);assert.equal(app.translated.length,0);
});
test('global Stop immediately cancels a manual translation before API preflight completes',async()=>{
 const app=await mainHarness({state,reply:'こんにちは。'}),pending=app.invoke('translate',request);
 const rejected=assert.rejects(pending,aborted);await app.invoke('stop');await rejected;assert.equal(app.requests.length,0);assert.equal(app.network.length,0);
});
test('duplicate manual request IDs are rejected even when both calls begin during preflight',async()=>{
 const gate=deferred(),app=await mainHarness({state,reply:async()=>{await gate.promise;return 'こんにちは。';}});
 const first=app.invoke('translate',request),second=app.invoke('translate',request),results=Promise.allSettled([first,second]);gate.resolve();const [accepted,duplicate]=await results;
 assert.equal(accepted.status,'fulfilled');assert.equal(duplicate.status,'rejected');assert.match(duplicate.reason.message,/正在进行/);assert.equal(app.requests.length,1);assert.equal(app.network.length,0);
});
test('explicit-local translation stopped during bundled-resource preflight never calls the translator',async()=>{
 const gate=deferred(),app=await mainHarness({state,bundleGate:gate.promise});
 const pending=app.invoke('translate',{...request,mode:'local'}),rejected=assert.rejects(pending,aborted);await new Promise(setImmediate);await app.invoke('translation-cancel',request.requestId);gate.resolve();await rejected;
 assert.equal(app.translated.length,0);assert.equal(app.requests.length,0);assert.equal(app.network.length,0);
});
test('cancelled preflight releases the request ID for a later intentional retry',async()=>{
 const app=await mainHarness({state,reply:'こんにちは。'}),pending=app.invoke('translate',request),rejected=assert.rejects(pending,aborted);await app.invoke('translation-cancel',request.requestId);await rejected;
 const result=await app.invoke('translate',request);assert.equal(result.text,'こんにちは。');assert.equal(app.requests.length,1);
});
