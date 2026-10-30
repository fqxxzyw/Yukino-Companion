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
test('video renderer opt-in selects the adapter, limits actions and moves using media delta not render time',async()=>{const stub=moduleStub(),h=await videoRendererHarness(stub);enable(h);await h.settle();assert.equal(stub.previews.length,1);h.act('jump');assert.equal(h.evaluate('clipName'),'idle');assert.match(h.nodes.get('chat-status').textContent,/仅支持/);h.act('walk');h.frame(1050);await h.settle();const step=h.calls.find(c=>c.action==='walk-step');assert.equal(step.payload.videoPreview,true);assert.equal(step.payload.elapsedMs,40);assert.equal(Math.abs(step.payload.x),1);assert.equal(step.payload.y,0);h.unload();assert.equal(stub.previews[0].disposed,true);});
test('a slow video decode does not spend the walking duration before the gait starts',async()=>{
 const stub=moduleStub(),h=await videoRendererHarness(stub);enable(h);await h.settle();
 let elapsed=0;stub.previews[0].movementElapsed=()=>elapsed;h.act('walk');h.frame(10000);await h.settle();
 assert.notEqual(h.evaluate('wander'),null);assert.equal(h.evaluate('wander.until'),null);assert.equal(h.calls.some(c=>c.action==='walk-step'),false);
 elapsed=40;h.frame(10040);await h.settle();assert.ok(h.evaluate('wander.until')>10040);assert.equal(h.calls.filter(c=>c.action==='walk-step').length,1);h.unload();
});
test('a video gait that never starts eventually returns to idle',async()=>{
 const stub=moduleStub(),h=await videoRendererHarness(stub);enable(h);await h.settle();stub.previews[0].movementElapsed=()=>0;
 h.act('walk');h.frame(11001);await h.settle();assert.equal(h.evaluate('wander'),null);assert.equal(h.evaluate('clipName'),'idle');h.unload();
});
test('video renderer drag keeps the same art using idle poster, not lifted sprite',async()=>{const stub=moduleStub(),h=await videoRendererHarness(stub);enable(h);await h.settle();h.evaluate("dragging=true;play('lifted')");assert.equal(h.evaluate('clipName'),'idle');assert.equal(stub.previews[0].updates.at(-1).staticPose,true);h.evaluate("dragging=false;play('landing')");assert.equal(stub.previews[0].updates.at(-1).name,'idle');h.unload();});
test('video renderer live reduced-motion, lock and document hide stop gait and decoder work',async()=>{const stub=moduleStub(),h=await videoRendererHarness(stub);enable(h);await h.settle();h.act('walk');h.setReduced(true);assert.equal(h.evaluate('wander'),null);assert.equal(stub.previews[0].updates.at(-1).staticPose,true);h.setReduced(false);h.emit({...h.state,playbackPaused:true});assert.equal(stub.previews[0].updates.at(-1).hidden,true);h.emit(h.state);h.setHidden(true);assert.equal(stub.previews[0].updates.at(-1).hidden,true);h.setHidden(false);assert.equal(stub.previews[0].updates.at(-1).hidden,false);h.unload();});
test('video renderer late pack response after disabling is ignored and does not import or create',async()=>{let resolvePack;const stub=moduleStub(),h=await videoRendererHarness({...stub,videoPack:()=>new Promise(r=>resolvePack=r)});enable(h);enable(h,{petRenderer:'sprite'});resolvePack({});await h.settle();assert.equal(stub.previews.length,0);assert.equal(h.evaluate('videoPreview'),null);h.unload();});
test('video renderer late factory completion disposes its instance after mode or character changes',async()=>{let finish;const preview={ready:true,dispose(){this.disposed=true},update(){}};const h=await videoRendererHarness({loadVideoModule:async()=>({createVideoCompanion:()=>new Promise(r=>finish=r)})});enable(h);await h.settle();h.emit({...h.state,character:{id:'custom',name:'其他角色'}});finish(preview);await h.settle();assert.equal(preview.disposed,true);assert.equal(h.evaluate('videoPreview'),null);h.unload();});
test('video renderer failed pack remains original sprite, does not repeatedly retry or start walking',async()=>{let calls=0;const h=await videoRendererHarness({videoPack:async()=>{calls++;throw Error('hash mismatch')}});enable(h);await h.settle();h.emit(h.state);h.frame(1016);h.act('walk');assert.equal(calls,1);assert.equal(h.evaluate('videoPreview'),null);assert.equal(h.evaluate('wander'),null);assert.match(h.nodes.get('chat-status').textContent,/保留原 Q 版/);enable(h,{petRenderer:'sprite'});enable(h);await h.settle();assert.equal(calls,2);h.unload();});
test('video renderer enabling preview never invokes camera, chat or audio and disabling restores sprite idle',async()=>{const stub=moduleStub(),h=await videoRendererHarness(stub);enable(h);await h.settle();h.act('walk');enable(h,{petRenderer:'sprite'});assert.equal(h.evaluate('wander'),null);assert.equal(h.evaluate('clipName'),'idle');assert.equal(stub.previews[0].disposed,true);assert.equal(h.calls.some(c=>['vision-open','vision-stop','chat-submit','voice-url'].includes(c.action)),false);h.unload();});
