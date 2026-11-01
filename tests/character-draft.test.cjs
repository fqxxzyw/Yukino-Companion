const test=require('node:test'),assert=require('node:assert/strict');
const {CharacterDraft}=require('../electron/character-draft.cjs');
const {mainHarness}=require('./helpers/main-harness.cjs');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

test('draft generation sends only the selected prompt and rejects empty or oversized results',async()=>{
 const calls=[];let output='草稿';const draft=new CharacterDraft({resolve:async id=>({profile:{id}}),transport:async request=>{calls.push(request);request.onToken(output);}});
 assert.deepEqual(await draft.generate({configId:'chosen',prompt:'角色资料'}),{text:'草稿'});
 assert.equal(calls[0].profile.id,'chosen');assert.deepEqual(calls[0].messages,[{role:'user',content:'角色资料'}]);
 output=' ';await assert.rejects(draft.generate({configId:'chosen',prompt:'资料'}),/未返回/);
 output='x'.repeat(6001);await assert.rejects(draft.generate({configId:'chosen',prompt:'资料'}),/超过 6000/);
 await assert.rejects(draft.generate({configId:'',prompt:'资料'}),/无效/);
});

test('cancel and replacement never allow a late request to publish or occupy the new request',async()=>{
 const gate=deferred(),entered=deferred();let calls=0;
 const draft=new CharacterDraft({resolve:async()=>({}),transport:async ({onToken})=>{if(++calls===1){entered.resolve();await gate.promise;}onToken('结果');}});
 const old=draft.generate({configId:'a',prompt:'旧'});await entered.promise;
 await assert.rejects(draft.generate({configId:'a',prompt:'重复'}),/正在生成/);
 draft.cancel();assert.deepEqual(await draft.generate({configId:'a',prompt:'新'}),{text:'结果'});
 gate.resolve();await assert.rejects(old,/取消或超时/);
});

test('main IPC uses the saved API and keeps generated text out of chat history',async()=>{
 const profile={id:'writer',base:'https://example.test/v1',model:'writer-model'};
 const state={profiles:[profile],activeProfile:'writer',conversations:[]};
 const app=await mainHarness({state,reply:'可审阅的设定'});
 const result=await app.invoke('character-draft',{configId:'writer',prompt:'请根据资料起草'});
 assert.equal(result.text,'可审阅的设定');assert.equal(app.requests.length,1);assert.equal(app.requests[0].model,'writer-model');
 assert.equal(app.requests[0].messages[0].content,'请根据资料起草');assert.equal(app.companions.replies.length,0);
 await assert.rejects(app.invoke('character-draft',{configId:'other',prompt:'资料'}),/请选择/);
 await assert.rejects(app.handlers.get('character-draft')({sender:{},senderFrame:{}},{configId:'writer',prompt:'资料'}),/不允许/);
});
