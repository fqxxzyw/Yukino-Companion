const test=require('node:test');
const assert=require('node:assert/strict');
const load=import('../src/ui/avatar-presentation.mjs');
test('gaze is bounded, neutral outside and independent of whole desktop position',async()=>{
 const {gazeTarget}=await load;
 assert.deepEqual(gazeTarget(400,-20,200,100),{eyeX:.35,eyeY:-.25,headYaw:12,headPitch:7});
 assert.deepEqual(gazeTarget(400,-20,200,100,false),{eyeX:0,eyeY:0,headYaw:0,headPitch:0});
 assert.deepEqual(gazeTarget(10,10,0,100),{eyeX:0,eyeY:0,headYaw:0,headPitch:0});
});
test('gaze smoothing moves toward the target without overshoot',async()=>{const {smoothGaze}=await load;const value=smoothGaze({headYaw:-12},{headYaw:12},16);assert.ok(value.headYaw>-12&&value.headYaw<12);});
test('scene reveal starts at current avatar center relative to UI after docking',async()=>{
 const {revealOrigin}=await load;assert.deepEqual(revealOrigin({left:800,top:100,width:200,height:400},{left:100,top:0,width:1000,height:800}),{x:80,y:37.5});
});
test('outfit preloads then exits left, enters right and greets once',async()=>{
 const {AvatarPresentationController}=await load,events=[];
 const adapter={prepareOutfit:async id=>(events.push('prepare:'+id),{id}),exit:async({direction})=>events.push('exit:'+direction),commitOutfit:async({id})=>events.push('commit:'+id),enter:async({direction})=>events.push('enter:'+direction),greet:async()=>events.push('greet')};
 const controller=new AvatarPresentationController(adapter);await controller.changeOutfit('uniform');await controller.changeOutfit('uniform');
 assert.deepEqual(events,['prepare:uniform','exit:left','commit:uniform','enter:right','greet']);
});
test('failed preload keeps existing model visible and never greets',async()=>{const {AvatarPresentationController}=await load;let exits=0;const controller=new AvatarPresentationController({prepareOutfit:async()=>{throw Error('broken asset')},exit:async()=>exits++});await assert.rejects(controller.changeOutfit('missing'),/broken/);assert.equal(exits,0);});
test('reduced motion swaps without walking but keeps single greeting',async()=>{const {AvatarPresentationController}=await load,events=[];const controller=new AvatarPresentationController({prepareOutfit:async()=>({}),commitOutfit:async()=>events.push('commit'),greet:async()=>events.push('greet')});await controller.changeOutfit('uniform',{reducedMotion:true});assert.deepEqual(events,['commit','greet']);});
test('no renderer is reported as unavailable instead of pretending a skin changed',async()=>{const {AvatarPresentationController}=await load;await assert.rejects(new AvatarPresentationController(null).changeOutfit('uniform'),/尚未接入/);});
