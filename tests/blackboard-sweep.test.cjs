const test=require('node:test');
const assert=require('node:assert/strict');

test('panel sweep detects the projected board, including skipped movement, without false positives in skewed corners',async()=>{
 const {intersectsBoard}=await import('../src/ui/blackboard-sweep.mjs');
 const board=[{x:100,y:100},{x:300,y:120},{x:260,y:200},{x:120,y:180}];
 assert.equal(intersectsBoard({left:0,right:350,top:130,bottom:160},board),true);
 assert.equal(intersectsBoard({left:0,right:80,top:130,bottom:160},board),false);
 assert.equal(intersectsBoard({left:100,right:110,top:185,bottom:195},board),false);
 assert.equal(intersectsBoard({left:0,right:200,top:0,bottom:90},board),false);
 assert.equal(intersectsBoard({left:0,right:200,top:0,bottom:90},null),false);
});

test('sweep submits a snapshot containing existing text before wiping it; empty user ink never sends',async()=>{
 const {sweepBoard}=await import('../src/ui/blackboard-sweep.mjs');
 const events=[],receipt={image:'prior visible board',revision:4},points=[{x:0,y:0},{x:20,y:0},{x:20,y:20},{x:0,y:20}];
 const controller={project:()=>({points}),snapshot:()=>{events.push('snapshot');return receipt;},setAssistantText:text=>events.push(['wipe',text])};
 const submit=value=>events.push(['submit',value]);
 assert.equal(sweepBoard(controller,{left:40,right:50,top:0,bottom:20},submit),false);
 assert.deepEqual(events,[]);
 assert.equal(sweepBoard(controller,{left:10,right:30,top:0,bottom:20},submit),true);
 assert.deepEqual(events,['snapshot',['wipe',''],['submit',receipt]]);
 events.length=0;controller.snapshot=()=>null;
 assert.equal(sweepBoard(controller,{left:10,right:30,top:0,bottom:20},submit),true);
 assert.deepEqual(events,[['wipe','']]);
});
