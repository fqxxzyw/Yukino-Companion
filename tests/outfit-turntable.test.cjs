const test=require('node:test'),assert=require('node:assert/strict');
const load=import('../src/ui/outfit-turntable.mjs');

function outfit(index,ready=true,extra={}){
 const number=String(index).padStart(2,'0');
 return {id:`yukino-${number}-v1`,label:`服装${index}`,outfitGroup:`yukino-${number}`,ready,url:`./characters/${number}.glb`,bytes:1,sha256:'a'.repeat(64),...extra};
}
const nine=Array.from({length:9},(_,index)=>outfit(index+1));

test('ring follows wardrobe order with the current outfit in front',async()=>{
 const {turntableOrder}=await load,result=turntableOrder(nine,'yukino-01-v1','yukino-05-v1');
 assert.equal(result.items.length,9);
 assert.equal(result.items[0].model.id,'yukino-01-v1');
 assert.equal(result.items[4].model.id,'yukino-05-v1');
 assert.equal(result.targetIndex,4);
});

test('current outfit wraps to slot zero and target index follows the rotated order',async()=>{
 const {turntableOrder}=await load,result=turntableOrder(nine,'yukino-06-v1','yukino-02-v1');
 assert.equal(result.items[0].model.id,'yukino-06-v1');
 assert.equal(result.items[5].model.id,'yukino-02-v1');
 assert.equal(result.targetIndex,5);
});

test('rotation always takes the shorter arc and never adds a full turn',async()=>{
 const {turntablePlan}=await load;
 const adjacent=turntablePlan(9,1);
 assert.deepEqual([adjacent.steps,adjacent.direction], [1,-1]);
 assert.ok(Math.abs(adjacent.rotation+Math.PI*2/9)<1e-12);
 const wrap=turntablePlan(9,8);
 assert.deepEqual([wrap.steps,wrap.direction], [1,1]);
 assert.ok(Math.abs(wrap.rotation-Math.PI*2/9)<1e-12);
 const far=turntablePlan(9,4);
 assert.deepEqual([far.steps,far.direction], [4,-1]);
 assert.equal(far.duration,740+185*4);
 const same=turntablePlan(9,0);
 assert.deepEqual([same.steps,same.rotation,same.duration],[0,0,0]);
});

test('an even ring resolves a half-turn tie to one fixed direction',async()=>{
 const {turntablePlan}=await load;
 const first=turntablePlan(8,4),second=turntablePlan(8,4);
 assert.equal(first.steps,4);
 assert.equal(first.direction,1);
 assert.deepEqual(first,second);
});

test('quintic easing is bounded, monotonic and slow at both ends',async()=>{
 const {turntableEase}=await load;
 assert.equal(turntableEase(0),0);
 assert.equal(turntableEase(.5),.5);
 assert.equal(turntableEase(1),1);
 assert.equal(turntableEase(-1),0);
 assert.equal(turntableEase(2),1);
 let previous=-1;
 for(let step=0;step<=100;step++){
  const value=turntableEase(step/100);
  assert.ok(value>=previous,'monotonic');
  previous=value;
 }
 assert.ok(turntableEase(.1)<.01,'slow start');
 assert.ok(turntableEase(.9)>.99,'slow landing');
});

test('ring slots are evenly spaced, face outward and keep their feet on the platform',async()=>{
 const {turntableSlot}=await load;
 const first=turntableSlot(0,9,1.2);
 assert.ok(Math.abs(first.position[0])<1e-12);
 assert.ok(Math.abs(first.position[1])<1e-12);
 assert.ok(Math.abs(first.position[2]-1.2)<1e-12);
 assert.equal(first.rotation,0);
 const quarter=turntableSlot(9/4,9,1.2);
 assert.ok(Math.abs(quarter.position[0]-1.2)<1e-9);
 assert.ok(Math.abs(quarter.position[2])<1e-9);
 assert.ok(Math.abs(quarter.rotation-Math.PI/2)<1e-12);
 for(let index=0;index<9;index++){
  const slot=turntableSlot(index,9,1.2);
  assert.ok(Math.abs(Math.hypot(...slot.position)-1.2)<1e-12);
  assert.equal(slot.position[1],0);
 }
});

test('ring radius grows with slot count and wide frames but never collapses',async()=>{
 const {turntableRadius}=await load;
 assert.ok(turntableRadius(9,1)>turntableRadius(7,1));
 assert.ok(turntableRadius(9,2)>turntableRadius(9,.6));
 assert.ok(turntableRadius(1,.2)>=.62);
 assert.ok(turntableRadius(9,NaN)>0);
});

test('unloadable variants are skipped in favour of a ready version',async()=>{
 const {turntableOrder}=await load;
 const models=[outfit(1,false),outfit(1,true,{id:'yukino-01-garment-normal-v1',label:'服装1·修正'}),outfit(2)];
 const result=turntableOrder(models,'yukino-01-v1','yukino-02-v1');
 assert.equal(result.items.length,2);
 assert.equal(result.items[0].model.id,'yukino-01-garment-normal-v1');
 assert.equal(result.items[1].model.id,'yukino-02-v1');
 assert.equal(result.targetIndex,1);
});

test('a target outside the registered wardrobe is rejected before any transition',async()=>{
 const {turntableOrder}=await load;
 assert.throws(()=>turntableOrder(nine,'yukino-01-v1','missing'),/衣橱/);
 const readyMissing=nine.map(model=>model.id==='yukino-02-v1'?{...model,ready:false}:model);
 assert.throws(()=>turntableOrder(readyMissing,'yukino-01-v1','yukino-02-v1'),/可加载/);
});
