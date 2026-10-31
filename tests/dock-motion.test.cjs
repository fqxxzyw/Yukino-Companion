const test=require('node:test'),assert=require('node:assert/strict');
const load=()=>import('../src/ui/dock-motion.mjs');
test('dock hysteresis avoids midpoint flicker while preserving edge choices',async()=>{const {dockTarget}=await load();assert.equal(dockTarget(505,0,1000,'left'),'left');assert.equal(dockTarget(495,0,1000,'right'),'right');assert.equal(dockTarget(530,0,1000,'left'),'right');assert.equal(dockTarget(470,0,1000,'right'),'left');});
test('FLIP preserves painted rectangle and settles with a bounded rebound',async()=>{const {snapFrames}=await load();const frames=snapFrames({left:400,top:20,width:305.4,height:509},{left:10,top:10,width:300,height:500});assert.match(frames[0].transform,/translate\(390px,10px\) scale\(1.018,1.018\)/);assert.match(frames[1].transform,/translate\(-5.85px,0\)/);assert.equal(frames[1].offset,.82);assert.equal(frames[0].easing,'cubic-bezier(.32,0,.2,1)');assert.equal(frames.at(-1).transform,'translate(0,0) scale(1,1)');});
test('new gesture cancels prior snap and rebases from current painted position',async()=>{const {DockMotion}=await load();const motion=new DockMotion();let cancelled=0;motion.animation={cancel(){cancelled++}};const offset=motion.rebase({getBoundingClientRect:()=>({left:cancelled?10:145})});assert.equal(cancelled,1);assert.equal(offset,135);});
test('reduced motion never starts a snap and cancellation rejection is handled',async()=>{const {DockMotion}=await load();const motion=new DockMotion();let calls=0,reject,cancelled=0;const element={getBoundingClientRect:()=>({left:0,top:0,width:100,height:100}),animate(){calls++;return {finished:new Promise((_r,r)=>reject=r),cancel(){cancelled++;reject(new DOMException('aborted','AbortError'))}}}};motion.settle(element,{left:1,top:1,width:100,height:100},true);assert.equal(calls,0);motion.settle(element,{left:1,top:1,width:100,height:100});motion.cancel();await new Promise(setImmediate);assert.equal(calls,1);assert.equal(cancelled,1);});
test('drag stretch responds to pointer speed, is bounded and springs back at rest',async()=>{const {dragStretch,advanceDragStretch}=await load();assert.equal(dragStretch(0,16),0);assert.equal(dragStretch(1000,1),.035);assert.equal(dragStretch(-24,16),dragStretch(24,16));let state={position:0,velocity:0};for(let i=0;i<15;i++)state=advanceDragStretch(state,.035,16);assert.ok(state.position>.02&&state.position<=.045);for(let i=0;i<120;i++)state=advanceDragStretch(state,0,16);assert.ok(Math.abs(state.position)<.0001);assert.ok(Math.abs(state.velocity)<.0001);});
test('snap allows a slower buffered approach and caps rebound on either side',async()=>{
 const {DockMotion,DOCK_SETTLE_MS,snapFrames}=await load();let options;
 const motion=new DockMotion(),rect={left:0,top:0,width:100,height:100};
 motion.settle({getBoundingClientRect:()=>rect,animate(_frames,next){options=next;return {finished:Promise.resolve(),cancel(){}};}},{...rect,left:1000});
 assert.equal(DOCK_SETTLE_MS,720);assert.equal(options.duration,720);assert.equal(options.easing,'linear');
 for(const left of [-5000,5000]){const frames=snapFrames({...rect,left},rect);const x=Number(frames[1].transform.match(/translate\(([-\d.]+)px/)[1]);assert.ok(Math.abs(x)<=6);assert.equal(frames.at(-1).offset,1);}
 await new Promise(setImmediate);assert.equal(motion.animation,null);
});
test('drag bounds cover the whole padded workspace in either direction, not half its width',async()=>{
 const {dragOffset}=await load(),bounds={left:220,right:1180};
 const left={left:220,width:300,startX:250};assert.equal(dragOffset(400,left,bounds),150);assert.equal(dragOffset(1100,left,bounds),660);assert.equal(dragOffset(-100,left,bounds),0);
 const right={left:880,width:300,startX:950};assert.equal(dragOffset(250,right,bounds),-660);assert.equal(dragOffset(5000,right,bounds),0);
 const interrupted={left:880,width:300,startX:950-(-120)};assert.equal(dragOffset(950,interrupted,bounds),-120,'a new drag keeps the currently painted offset');
});
test('chat uses the same timing without scale or bounce at its landing',async()=>{
 const {snapFrames}=await load(),rect={left:100,top:20,width:640,height:500};
 const frames=snapFrames(rect,{...rect,left:420},{rebound:false});assert.equal(frames[0].transform,'translate(-320px,0px) scale(1,1)');assert.equal(frames[1].transform,'translate(0,0) scale(1,1)');
});
test('clicking without moving starts no decorative snap on unchanged rectangles',async()=>{
 const {DockMotion}=await load(),rect={left:100,top:20,width:300,height:500};let calls=0;
 new DockMotion().settle({getBoundingClientRect:()=>({...rect}),animate(){calls++;}},rect);assert.equal(calls,0);
});
test('OS reduced-motion changes are observed and unsubscribed',async()=>{const {observeReducedMotion}=await import('../src/ui/use-reduced-motion.mjs');let fn,removed=false;const values=[],query={matches:false,addEventListener(_type,callback){fn=callback},removeEventListener(_type,callback){removed=callback===fn}};const stop=observeReducedMotion(value=>values.push(value),{matchMedia:()=>query});fn({matches:true});fn({matches:false});stop();assert.deepEqual(values,[false,true,false]);assert.equal(removed,true);});
