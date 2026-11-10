const test=require('node:test'),assert=require('node:assert/strict');
const modulePromise=import('../src/ui/desktop-model-scale.mjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('rapid model scaling serializes writes and keeps the latest requested size',async()=>{
 const {createDesktopModelScale}=await modulePromise,calls=[],pending=[];
 const control=createDesktopModelScale({delay:0,save:value=>{calls.push(value);return new Promise(resolve=>pending.push(resolve))}});
 control.sync(1);control.change(.1);await new Promise(resolve=>setTimeout(resolve,10));control.change(.1);control.change(.1);
 assert.deepEqual(calls,[1.1]);
 control.sync(1.1);pending.shift()({preferences:{scale:1.1}});await new Promise(resolve=>setTimeout(resolve,10));
 assert.deepEqual(calls,[1.1,1.3]);pending.shift()({preferences:{scale:1.3}});await tick();
 control.change(9);await new Promise(resolve=>setTimeout(resolve,10));assert.equal(calls[2],2);pending.shift()({preferences:{scale:2}});await tick();
 control.change(-9);await new Promise(resolve=>setTimeout(resolve,10));assert.equal(calls[3],.6);pending.shift()({preferences:{scale:.6}});await tick();
 control.reset();await new Promise(resolve=>setTimeout(resolve,10));assert.equal(calls[4],1);pending.shift()({preferences:{scale:1}});await tick();control.dispose();
});

test('a failed resize reports the error and allows a later retry',async()=>{
 const {createDesktopModelScale}=await modulePromise,errors=[],calls=[];
 const control=createDesktopModelScale({delay:0,save:async value=>{calls.push(value);if(calls.length===1)throw Error('resize failed');return {preferences:{scale:value}}},onError:error=>errors.push(error.message)});
 control.change(.1);await new Promise(resolve=>setTimeout(resolve,10));assert.deepEqual(errors,['resize failed']);
 control.change(.1);await new Promise(resolve=>setTimeout(resolve,10));assert.deepEqual(calls,[1.1,1.1]);control.dispose();
});

test('a burst of wheel changes produces one native resize, and disposal cancels pending work',async()=>{
 const {createDesktopModelScale}=await modulePromise,calls=[];
 const control=createDesktopModelScale({delay:30,save:async value=>{calls.push(value);return {scale:value}}});
 control.change(.1);control.change(.1);control.change(.1);
 await new Promise(resolve=>setTimeout(resolve,50));assert.deepEqual(calls,[1.3]);
 control.change(.1);control.dispose();await new Promise(resolve=>setTimeout(resolve,50));assert.deepEqual(calls,[1.3]);
});
