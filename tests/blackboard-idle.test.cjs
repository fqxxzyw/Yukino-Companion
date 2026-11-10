const test=require('node:test'),assert=require('node:assert/strict');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture(onIdle){
 const {BlackboardIdle,BLACKBOARD_IDLE_MS}=await import('../src/ui/blackboard-idle.mjs');
 let now=0,sequence=0;const timers=new Map(),listeners=new Set(),calls=[];
 const controller={owner:1,revision:0,ink:false,hasInk(){return this.ink;},snapshot(){return this.ink?Object.freeze({owner:this.owner,revision:this.revision,image:'PNG-'+this.revision}):null;},subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},mark(){this.ink=true;this.revision++;for(const fn of listeners)fn();},clear(){this.ink=false;this.revision++;for(const fn of listeners)fn();}};
 const idle=new BlackboardIdle({controller,scopeKey:'yukino:current',onIdle:snapshot=>{calls.push(snapshot);return onIdle?.(snapshot);},now:()=>now,setTimer:(fn,delay)=>{const id=++sequence;timers.set(id,{fn,at:now+delay});return id;},clearTimer:id=>timers.delete(id)});
 function advance(ms){const target=now+ms;while(true){const next=[...timers].filter(([,value])=>value.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;timers.delete(next[0]);now=next[1].at;next[1].fn();}now=target;}
 function stroke(){idle.start();controller.mark();idle.move();idle.end();}
 return {idle,controller,calls,timers,advance,stroke,BLACKBOARD_IDLE_MS};
}

test('idle snapshot submits exactly once at 180000 ms after stroke release',async()=>{
 const f=await fixture();assert.equal(f.BLACKBOARD_IDLE_MS,180000);f.stroke();f.advance(179999);assert.equal(f.calls.length,0);f.advance(1);assert.equal(f.calls.length,1);assert.equal(f.calls[0].revision,1);await flush();f.advance(900000);assert.equal(f.calls.length,1);assert.equal(f.controller.hasInk(),true,'helper never clears independently');f.idle.dispose();
});
test('holding and moving never sends, and release starts a fresh full three minutes',async()=>{
 const f=await fixture();f.idle.start();f.controller.mark();f.advance(180000);f.idle.move();f.advance(180000);assert.equal(f.calls.length,0);f.idle.end();f.advance(179999);assert.equal(f.calls.length,0);f.advance(1);assert.equal(f.calls.length,1);f.idle.dispose();
});
test('a new stroke cancels the earlier deadline and resets it at the new release',async()=>{
 const f=await fixture();f.stroke();f.advance(170000);f.idle.start();f.controller.mark();f.advance(20000);assert.equal(f.calls.length,0);f.idle.end();f.advance(179999);assert.equal(f.calls.length,0);f.advance(1);assert.equal(f.calls.length,1);assert.equal(f.calls[0].revision,2);f.idle.dispose();
});
test('ordinary React callback/context refreshes do not restart the idle deadline',async()=>{
 const f=await fixture();let refreshed=0;f.stroke();f.advance(100000);f.idle.update({onIdle:()=>{refreshed++;return false;},scopeKey:'yukino:current'});f.advance(79999);assert.equal(refreshed,0);f.advance(1);assert.equal(refreshed,1);assert.equal(f.calls.length,0);f.idle.dispose();
});
test('accepted clear cancels timers and an empty board cannot submit',async()=>{
 const f=await fixture();f.stroke();f.controller.clear();f.advance(900000);assert.equal(f.calls.length,0);f.idle.start();f.idle.end();f.advance(180000);assert.equal(f.calls.length,0);f.idle.dispose();
});
test('rejection or failed saving retains ink without repeating an unchanged snapshot',async()=>{
 const f=await fixture(()=>Promise.reject(Error('unavailable config/save')));f.stroke();f.advance(180000);await flush();f.advance(900000);assert.equal(f.calls.length,1);assert.equal(f.controller.hasInk(),true);f.stroke();f.advance(180000);assert.equal(f.calls.length,2);f.idle.dispose();
});
test('hidden elapsed time catches up only on visibility return in the same scope',async()=>{
 const f=await fixture();f.stroke();f.advance(100000);f.idle.update({visible:false});f.advance(80000);assert.equal(f.calls.length,0);f.idle.update({visible:true});f.advance(0);assert.equal(f.calls.length,1);f.idle.dispose();
});
test('disabled board pauses delivery without losing a same-scope deadline',async()=>{
 const f=await fixture();f.stroke();f.idle.update({enabled:false});f.advance(180000);assert.equal(f.calls.length,0);f.idle.update({enabled:true});f.advance(0);assert.equal(f.calls.length,1);f.idle.dispose();
});
test('conversation/character changes cancel stale deadlines, including hidden and held strokes',async()=>{
 const f=await fixture();f.stroke();f.idle.update({visible:false});f.advance(180000);f.idle.update({scopeKey:'other:new',visible:true});f.advance(180000);assert.equal(f.calls.length,0);f.idle.start();f.controller.mark();f.idle.update({scopeKey:'third:chat'});f.idle.end();f.advance(180000);assert.equal(f.calls.length,0);f.stroke();f.advance(180000);assert.equal(f.calls.length,1);f.idle.dispose();
});
test('newer ink waits behind a pending submission and then sends its own snapshot once',async()=>{
 let resolve;const gate=new Promise(r=>resolve=r),f=await fixture(()=>gate);f.stroke();f.advance(180000);assert.equal(f.calls.length,1);f.stroke();f.advance(180000);assert.equal(f.calls.length,1);resolve(true);await flush();f.advance(0);assert.equal(f.calls.length,2);assert.equal(f.calls[1].revision,2);f.idle.dispose();
});
test('unmount cancels delivery and pending completion cannot revive a disposed timer',async()=>{
 const f=await fixture();f.stroke();f.idle.dispose();f.advance(180000);assert.equal(f.calls.length,0);assert.equal(f.timers.size,0);
 let resolve;const gate=new Promise(r=>resolve=r),p=await fixture(()=>gate);p.stroke();p.advance(180000);p.stroke();p.idle.dispose();resolve(true);await flush();p.advance(900000);assert.equal(p.calls.length,1);assert.equal(p.timers.size,0);
});
