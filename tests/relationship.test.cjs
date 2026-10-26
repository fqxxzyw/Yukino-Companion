const test=require('node:test');
const assert=require('node:assert/strict');
const ready=import('../src/companion/relationship.mjs');
test('check-in is once per local calendar day and rollback cannot grant another',async()=>{
  const {createRelationship,advanceRelationship}=await ready,now=new Date(2026,9,26,12).getTime();
  let s=advanceRelationship(createRelationship(now),{type:'checkin',id:'a',now});
  s=advanceRelationship(s,{type:'checkin',id:'b',now:now+60000});
  s=advanceRelationship(s,{type:'checkin',id:'c',now:now-86400000});
  assert.equal(s.checkinDays,1);assert.equal(s.affection,37);
  s=advanceRelationship(s,{type:'checkin',id:'d',now:now+86400000});assert.equal(s.checkinDays,2);
});
test('long conversations drain stamina, preserve affection, and rest recovers it',async()=>{
  const {createRelationship,advanceRelationship,summarizeRelationship}=await ready,now=1000000000;
  let s=createRelationship(now);for(let n=0;n<30;n++)s=advanceRelationship(s,{type:'message',id:String(n),now});
  assert.equal(s.affection,35);assert.equal(s.stamina,0);assert.equal(summarizeRelationship(s,now).mood,'tired');
  assert.equal(summarizeRelationship(s,now+50*60000).stamina,100);
});
test('duplicate reply completion is idempotent and payment flags are not trusted',async()=>{
  const {createRelationship,advanceRelationship,summarizeRelationship}=await ready,now=1000000000;
  let s=advanceRelationship(createRelationship(now),{type:'message',id:'reply1',now});
  s=advanceRelationship({...s,sponsorAvailable:true,unlocks:['paid']},{type:'message',id:'reply1',now});
  assert.equal(s.stamina,98);assert.equal(s.turns,1);
  assert.equal(summarizeRelationship(s,now).sponsorAvailable,false);assert.deepEqual(summarizeRelationship(s,now).unlocks,[]);
});
