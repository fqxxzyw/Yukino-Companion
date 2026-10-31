const test=require('node:test');
const assert=require('node:assert/strict');
const {mainHarness}=require('./helpers/main-harness.cjs');
const {SetupService}=require('../electron/setup.cjs');
const state={profiles:[],activeProfile:'',conversations:[],persona:'',translationMode:'api'};
test('all-resource IPC check preserves API-only selection and performs no downloads',async()=>{
 const app=await mainHarness({state});
 await app.invoke('setup-status',{features:[]});
 const all=await app.invoke('setup-status',{scope:'all'});
 assert.equal(all.scope,'all');assert.deepEqual(all.features,['chat','translation','voice','pet']);
 assert.equal(all.steps.length,6);assert.ok(all.steps.every(step=>step.state!=='skipped'));
 assert.equal(all.ready,false);assert.equal(app.network.length,0);
 const selected=await app.invoke('setup-status');
 assert.deepEqual(selected.features,[]);assert.ok(selected.steps.every(step=>step.state==='skipped'));
});
test('all-resource inspection preserves selection, phase, error and active progress',async()=>{
 const inspections=[];
 const setup=new SetupService({inspect:async options=>{inspections.push(options.features);return {steps:['runtime','chat','translation','voiceCore','voicePreset','pet'].map(id=>({id,state:'missing'}))};}});
 await setup.status({features:['pet']});const revision=setup.revision;
 setup.phase='error';setup.failedStep='pet';setup.error='saved failure';
 const all=await setup.status({scope:'all',features:['chat']});
 assert.equal(inspections.at(-1),null);assert.deepEqual(setup.features,['pet']);assert.equal(setup.revision,revision);
 assert.equal(all.steps.find(step=>step.id==='pet').error,'saved failure');assert.equal(setup.phase,'error');
 setup.controller=new AbortController();setup.phase='installing';setup.activeSteps.add('pet');setup.progressByStep.set('pet',{phase:'downloading',received:8,total:10});
 const active=await setup.status({scope:'all'});
 assert.equal(active.steps.find(step=>step.id==='pet').state,'downloading');assert.equal(active.steps.find(step=>step.id==='pet').bytes,8);
 assert.deepEqual(setup.features,['pet']);assert.equal(setup.controller.signal.aborted,false);
});
test('all-resource retry retains its read-only scope after a concurrent selection change',async()=>{
 let release,checks=0;
 const setup=new SetupService({inspect:async options=>{checks++;if(checks===1)await new Promise(resolve=>release=resolve);assert.equal(options.features,null);return {steps:[{id:'pet',state:'ready'}]};}});
 const pending=setup.status({scope:'all'});setup.features=[];setup.revision++;release();
 const status=await pending;assert.equal(checks,2);assert.equal(status.scope,'all');assert.equal(status.steps[0].state,'ready');assert.deepEqual(setup.features,[]);
});
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
