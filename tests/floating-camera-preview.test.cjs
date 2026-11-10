const test=require('node:test'),assert=require('node:assert/strict');
test('floating preview bounds its local frame, stops copying when hidden, and never stops the camera track',async()=>{
 const {FloatingCameraPreview}=await import('../src/ui/floating-camera-preview.mjs');const frames=[],timers=new Map(),draws=[];let id=0,stops=0;
 const video={readyState:2,videoWidth:1920,videoHeight:1080,srcObject:{getTracks:()=>[{stop(){stops++}}]}};
 const canvas={width:0,height:0,getContext:()=>({drawImage(...args){draws.push(args)}}),toDataURL:()=> 'data:image/jpeg;base64,c3ludGhldGlj'};
 const copy=new FloatingCameraPreview({video,send:async frame=>frames.push(frame),createCanvas:()=>canvas,setTimer:fn=>{timers.set(++id,fn);return id},clearTimer:key=>timers.delete(key)});
 copy.start('local-token');await Promise.resolve();await Promise.resolve();assert.equal(frames.length,1);assert.deepEqual([canvas.width,canvas.height],[480,270]);assert.equal(frames[0].token,'local-token');assert.equal(timers.size,1);
 copy.stop();assert.equal(timers.size,0);assert.equal(stops,0);assert.equal(canvas.width,0);assert.equal(canvas.height,0);
 copy.start('local-token');await Promise.resolve();await Promise.resolve();assert.equal(frames.length,2);assert.equal(stops,0);copy.stop();
});
test('hiding while a local frame delivery is pending does not schedule stale copies',async()=>{
 const {FloatingCameraPreview}=await import('../src/ui/floating-camera-preview.mjs');let resolve,pending=0;const gate=new Promise(r=>resolve=r);const copy=new FloatingCameraPreview({video:{readyState:2,videoWidth:320,videoHeight:180},send:()=>gate,createCanvas:()=>({getContext:()=>({drawImage(){}}),toDataURL:()=> 'data:image/jpeg;base64,AA=='}),setTimer:()=>{pending++;return 1},clearTimer(){}});copy.start('token');copy.stop();resolve();await gate;await Promise.resolve();assert.equal(pending,0);
});
