const test=require('node:test'),assert=require('node:assert/strict');

test('beret near/far release uses a head-width threshold and hysteresis',async()=>{
 const {beretDropZone}=await import('../src/ui/approved-beret.mjs');
 assert.equal(beretDropZone(.6,'near'),'near');
 assert.equal(beretDropZone(.8,'near'),'near');
 assert.equal(beretDropZone(.9,'near'),'far');
 assert.equal(beretDropZone(.7,'far'),'far');
 assert.equal(beretDropZone(.6,'far'),'near');
 assert.equal(beretDropZone(.2,'near',{below:true}),'far');
 assert.equal(beretDropZone(Infinity,'near'),'far');
});

test('beret floor fall clamps to the real floor and settles without extra contact',async()=>{
 const {beretFallStep}=await import('../src/ui/approved-beret.mjs');
 const falling=beretFallStep({y:1,velocity:0,dt:.1,floorY:0});
 assert.ok(falling.y<1&&falling.velocity<0&&!falling.contact);
 const hit=beretFallStep({y:.01,velocity:-2,dt:.1,floorY:0});
 assert.equal(hit.contact,true);
 assert.equal(hit.y,0);
 assert.ok(hit.velocity>0&&hit.velocity<2);
 const settled=beretFallStep({y:0,velocity:0,dt:.1,floorY:0});
 assert.equal(settled.contact,true);
 assert.equal(settled.velocity,0);
 const reduced=beretFallStep({y:.01,velocity:-2,dt:.1,floorY:0,reducedMotion:true});
 assert.equal(reduced.contact,true);
 assert.equal(reduced.velocity,0);
});

test('beret binding refuses a scene without the independent hat mesh',async()=>{
 const THREE=await import('three');
 const {bindApprovedBeret}=await import('../src/ui/approved-beret.mjs');
 const scene=new THREE.Scene();
 scene.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial()));
 assert.equal(bindApprovedBeret({scene,animations:[]}),null);
});
