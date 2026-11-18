const test=require('node:test');
const assert=require('node:assert/strict');

test('the latest scene turn starts at the user message, including a sent blackboard image',async()=>{
 const {latestSceneTurnStart,BLACKBOARD_RECEIPT_TEXT}=await import('../src/ui/scene-messages.mjs');
 const previousReply={role:'assistant',content:'旧回复'};
 const board={role:'user',content:BLACKBOARD_RECEIPT_TEXT,image:'data:image/png;base64,AA=='};
 const pendingReply={role:'assistant',status:'streaming',content:''};
 assert.equal(latestSceneTurnStart([previousReply,board]),1);
 assert.equal(latestSceneTurnStart([previousReply,board,pendingReply]),1);
 assert.equal(latestSceneTurnStart([previousReply]),0);
 assert.equal(latestSceneTurnStart([]),-1);
});
