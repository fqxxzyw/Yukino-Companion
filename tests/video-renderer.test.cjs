const test=require('node:test'),assert=require('node:assert/strict');
const {videoRendererHarness}=require('./helpers/video-renderer-harness.cjs');
function moduleStub(){const previews=[];return {previews,loadVideoModule:async()=>({createVideoCompanion:async options=>{const preview={ready:true,failed:false,updates:[],dispose(){this.disposed=true},update(state){this.updates.push({...state})},movementElapsed(){return 40},hitTest(){return false}};previews.push(preview);options.onPresentation('poster');return preview;}})};}
function enable(h,patch={}){h.state.preferences={...h.state.preferences,petRenderer:'video-preview',...patch};h.emit(h.state);}
test('video renderer default sprite never requests the video pack or changes chat controls',async()=>{const stub=moduleStub(),h=await videoRendererHarness(stub);h.frame(1016);await h.settle();assert.equal(stub.previews.length,0);assert.equal(h.calls.some(c=>c.action==='video-pack'),false);assert.equal(h.nodes.get('pet-composer').hidden,false);h.unload();});
test('pet releases report an actual drag even when the coalesced move has not run, but clicks remain clicks',async()=>{
 const h=await videoRendererHarness(),pet=h.nodes.get('pet');
 const event=(x,y)=>({button:0,pointerId:1,screenX:x,screenY:y,clientX:100,clientY:350,target:pet});
 pet.events.get('pointerdown')(event(100,100));h.windowEvents.get('pointermove')(event(130,120));
 assert.equal(h.calls.filter(c=>c.action==='drag-move').length,0);
 pet.events.get('pointerup')(event(130,120));
 assert.equal(h.calls.filter(c=>c.action==='drag-end').at(-1).payload.moved,true);
 assert.ok(h.cancelledFrames.length>0);
 pet.events.get('pointerdown')(event(100,100));pet.events.get('pointerup')(event(100,100));
 assert.equal(h.calls.filter(c=>c.action==='drag-end').at(-1).payload.moved,false);h.unload();
});
test('stale video preference never replaces the original pet or disables its actions',async()=>{
 const stub=moduleStub(),h=await videoRendererHarness(stub);enable(h);await h.settle();h.frame(1016);h.act('jump');
 assert.equal(stub.previews.length,0);assert.equal(h.calls.some(c=>c.action==='video-pack'),false);assert.equal(h.evaluate('videoRequested()'),false);assert.equal(h.evaluate('clipName'),'jump');assert.equal(h.nodes.get('pet').hidden,false);assert.equal(h.nodes.get('pet-video-layer').hidden,true);h.unload();
});
