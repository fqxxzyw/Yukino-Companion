const test=require('node:test');
const assert=require('node:assert/strict');

test('expanded scenes keep all current conversation turns in chronological order',async()=>{
 const {selectSceneMessages}=await import('../src/ui/scene-messages.mjs');
 const history=[{id:'u1',role:'user',content:'first'},{id:'a1',role:'assistant',zh:'older'},{id:'u2',role:'user',content:'second'},{id:'a2',role:'assistant',zh:'latest',ja:'最新'}];
 const result=selectSceneMessages(history,true);
 assert.deepEqual(result,history);
 assert.equal(result.at(-1).ja,'最新');
 assert.equal(history.length,4);
 assert.equal(selectSceneMessages(history,false),history);
});

test('sending and streaming a new message leave the previous reply visible',async()=>{
 const {selectSceneMessages}=await import('../src/ui/scene-messages.mjs');
 const question={id:'u2',role:'user',content:'hello'};
 const oldReply={id:'a1',role:'assistant',content:'old'};
 const streaming={id:'a2',role:'assistant',status:'streaming',content:''};
 assert.deepEqual(selectSceneMessages([oldReply,question],true),[oldReply,question]);
 assert.deepEqual(selectSceneMessages([oldReply,question,streaming],true),[oldReply,question,streaming]);
 assert.deepEqual(selectSceneMessages([oldReply],true),[oldReply]);
 assert.deepEqual(selectSceneMessages([],true),[]);
});

test('automatic blackboard receipts do not cover the scene or hide the latest submitted question',async()=>{
 const {selectSceneMessages,BLACKBOARD_RECEIPT_TEXT}=await import('../src/ui/scene-messages.mjs');
 const question={id:'u1',role:'user',content:'画一张黑板报'};
 const oldReply={id:'a1',role:'assistant',content:'旧回复'};
 const receipt={id:'u2',role:'user',content:BLACKBOARD_RECEIPT_TEXT,image:'data:image/png;base64,AA=='};
 const reply={id:'a2',role:'assistant',content:'我看到你的画了'};
 const history=[question,oldReply,receipt,reply];
 assert.deepEqual(selectSceneMessages(history,true),[question,oldReply,reply]);
 assert.deepEqual(selectSceneMessages([question,oldReply,receipt],true),[question,oldReply]);
 assert.deepEqual(selectSceneMessages([receipt,reply],true),[reply]);
 assert.equal(selectSceneMessages(history,false),history);
});
