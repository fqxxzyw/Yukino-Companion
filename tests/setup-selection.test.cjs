const test=require('node:test');
const assert=require('node:assert/strict');
const {mainHarness}=require('./helpers/main-harness.cjs');
const state={profiles:[],activeProfile:'',conversations:[],persona:'',translationMode:'api'};
function forbid(object,name){object[name]=async()=>{throw Error(`Unrelated dependency was inspected: ${name}`);};}
test('real setup IPC checks no inference dependencies for pet-only selection',async()=>{
 const app=await mainHarness({state});
 for(const name of ['status','catalog'])forbid(app.runtime,name);
 forbid(app.local,'status');forbid(app.voice,'readiness');
 const result=await app.invoke('setup-status',{features:['pet']});
 assert.equal(result.steps.find(step=>step.id==='pet').state,'missing');
 assert.ok(result.steps.filter(step=>step.id!=='pet').every(step=>step.state==='skipped'));
 assert.equal(app.network.length,0);
});
test('real setup IPC accepts API-only selection without inspecting local inference',async()=>{
 const app=await mainHarness({state});
 for(const name of ['status','catalog'])forbid(app.runtime,name);
 forbid(app.local,'status');forbid(app.voice,'readiness');
 const result=await app.invoke('setup-status',{features:[]});
 assert.equal(result.ready,true);assert.ok(result.steps.every(step=>step.state==='skipped'));assert.equal(app.network.length,0);
});
test('real setup IPC checks chat and shared runtime without checking speech readiness',async()=>{
 const app=await mainHarness({state});let runtimeChecks=0,chatChecks=0;
 const runtimeStatus=app.runtime.status.bind(app.runtime),chatStatus=app.local.status.bind(app.local);
 app.runtime.status=async()=>{runtimeChecks++;return runtimeStatus();};app.local.status=async()=>{chatChecks++;return chatStatus();};forbid(app.voice,'readiness');
 const result=await app.invoke('setup-status',{features:['chat']});
 assert.equal(runtimeChecks,1);assert.equal(chatChecks,1);assert.equal(result.steps.find(step=>step.id==='chat').state,'ready');assert.equal(result.steps.find(step=>step.id==='voiceCore').state,'skipped');assert.equal(app.network.length,0);
});
