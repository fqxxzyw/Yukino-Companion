const {test}=require('node:test');
const assert=require('node:assert/strict');

async function fixture(t,{reducedMotion=true,motion=false}={}){
 const {EnvironmentBackdrop}=await import('../src/ui/environment-backdrop.mjs');
 const saved=new Map(['window','document','ResizeObserver','requestAnimationFrame','cancelAnimationFrame','setTimeout','clearTimeout'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 class Surface{
  constructor(){this.listeners=new Map();this.style={};this.dataset={};this.children=[];this.clientWidth=800;this.clientHeight=600}
  addEventListener(type,fn){this.listeners.set(type,fn)}removeEventListener(type,fn){if(this.listeners.get(type)===fn)this.listeners.delete(type)}
  append(node){this.children.push(node)}setAttribute(){}remove(){}
  emit(type){this.listeners.get(type)?.()}
 }
 const doc=new Surface(),win=new Surface(),host=new Surface(),canvas=new Surface(),timers=new Map(),frames=new Map();doc.hidden=false;
 let sequence=0,now=0;
 Object.defineProperties(globalThis,{
  window:{value:win,configurable:true},document:{value:doc,configurable:true},
  ResizeObserver:{value:class{observe(){}disconnect(){}},configurable:true},
  setTimeout:{value:(fn,delay)=>{const id=++sequence;timers.set(id,{fn,at:now+delay});return id},configurable:true},
  clearTimeout:{value:id=>timers.delete(id),configurable:true},
  requestAnimationFrame:{value:fn=>{const id=++sequence;frames.set(id,fn);return id},configurable:true},
  cancelAnimationFrame:{value:id=>frames.delete(id),configurable:true},
 });
 const errors=[],samples=[];
 const gl={domElement:canvas,shadowMap:{},setPixelRatio(){},dispose(){}};
 const renderer=new EnvironmentBackdrop(host,{reducedMotion,rendererFactory:()=>gl,onError:error=>errors.push(error)});
 renderer.motion=motion;
 const clock={updateTime:date=>samples.push(date),timeUpdateInterval:1000,dispose(){}};
 renderer.current=clock;renderer.render=()=>{renderer.renders=(renderer.renders||0)+1};
 t.after(async()=>{renderer.dispose();await renderer.queue;for(const [key,value]of saved){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key]}});
 function advance(ms){const end=now+ms;for(;;){const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;now=next[1].at;timers.delete(next[0]);next[1].fn()}now=end}
 function paint(){const work=[...frames.values()];frames.clear();for(const fn of work)fn(now||100)}
 return {renderer,clock,doc,timers,frames,samples,errors,advance,paint};
}

test('paused and reduced-motion scenes invalidate once per second without decorative animation',async t=>{
 const h=await fixture(t),r=h.renderer;let animations=0;r.current.update=()=>animations++;
 r.scheduleTimeUpdate();assert.equal(h.timers.size,1);h.advance(999);assert.equal(h.samples.length,0);
 h.advance(1);assert.equal(h.samples.length,1);assert.equal(h.frames.size,1);h.paint();
 assert.equal(r.renders,1);assert.equal(animations,0);assert.equal(h.frames.size,0);
 assert.ok(h.samples.every(sample=>sample instanceof Date));assert.equal(h.timers.size,1);
 h.advance(1000);h.paint();assert.equal(r.renders,2);assert.equal(animations,0);
 assert.deepEqual(h.errors,[]);
});

test('hidden scenes stop clock wakeups and catch up immediately on return',async t=>{
 const h=await fixture(t),r=h.renderer;r.scheduleTimeUpdate();
 h.doc.hidden=true;h.doc.emit('visibilitychange');assert.equal(h.timers.size,0);assert.equal(h.frames.size,0);
 h.advance(60*60*1000);assert.equal(h.samples.length,0);
 h.doc.hidden=false;h.doc.emit('visibilitychange');assert.equal(h.samples.length,1);assert.equal(h.timers.size,1);assert.equal(h.frames.size,1);
 h.paint();h.advance(1000);h.paint();assert.equal(r.renders,2);
});

test('switching away from a clock and disposing cancel the pending timer',async t=>{
 const h=await fixture(t),r=h.renderer;r.scheduleTimeUpdate();const before=h.samples.length;
 r.current={dispose(){}};r.scheduleTimeUpdate();assert.equal(h.timers.size,0);h.advance(10000);assert.equal(h.samples.length,before);
 r.current=h.clock;r.scheduleTimeUpdate();assert.equal(h.timers.size,1);
 r.dispose();assert.equal(h.timers.size,0);assert.equal(h.frames.size,0);h.advance(10000);assert.equal(h.samples.length,before);
});

test('clock update errors are reported without multiplying scheduled timers',async t=>{
 const h=await fixture(t),r=h.renderer;r.current.updateTime=()=>{throw Error('clock update failure')};r.scheduleTimeUpdate();
 h.advance(3000);assert.equal(h.errors.length,3);assert.equal(h.timers.size,1);assert.equal(h.frames.size,0);
});
