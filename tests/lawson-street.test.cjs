const {test}=require('node:test');
const assert=require('node:assert/strict');

async function fixture(t){
 const T=await import('three'),{createScene}=await import('../src/scenes/lawson.mjs');
 const previous=global.document;global.document={createElement(){const canvas={width:0,height:0};canvas.getContext=()=>new Proxy({canvas},{get:(target,key)=>key in target?target[key]:()=>{}});return canvas}};
 t.after(()=>{if(previous===undefined)delete global.document;else global.document=previous});
 const api=createScene({scene:new T.Scene(),renderer:{toneMappingExposure:1,shadowMap:{}}});api.root.updateMatrixWorld(true);t.after(()=>api.dispose());return {T,api};
}

test('street housing has multiple cladding systems and daylight shop lamps reach the shelving',async t=>{
 const {T,api}=await fixture(t),finishes=new Set(),lights=[];
 api.root.traverse(o=>{
  if(o.material?.userData.cladding)finishes.add(o.material.userData.cladding);
  if(o.name==='lawson:merchandise-fluorescent')lights.push(o);
 });
 assert.deepEqual([...finishes].sort(),['brick','panel','render','siding']);
 assert.equal(lights.length,2);
 for(const preset of ['day','night']){
  api.setLighting(preset);
  for(const light of lights){
   assert.ok(light.isSpotLight&&light.intensity>=45);
   assert.ok(light.color.b>=light.color.r);
   const shelf=light.target.getWorldPosition(new T.Vector3());
   assert.ok(shelf.y<1.5&&shelf.z<0,'the cone points towards merchandise inside the store');
   assert.ok(light.position.distanceTo(shelf)<light.distance);
  }
 }
});

test('Lawson storefront cameras face its frontage without yaw and sit on a bounded square diorama plinth',async t=>{
 const {T,api}=await fixture(t);
 for(const name of ['photo','companion']){
  const {position,target}=api.cameraPresets[name];assert.equal(position[0],target[0]);assert.ok(position[2]>target[2]);
  assert.ok(Math.abs(position[1]-target[1])/(position[2]-target[2])<.08,'a shallow street-level pitch keeps the frontage upright');
 }
 assert.ok([...api.bounds.min.toArray(),...api.bounds.max.toArray()].every(Number.isFinite));
 assert.ok(api.bounds.getSize(new T.Vector3()).length()<120,'square urban diorama stays compact for gallery framing');
 const ground=api.root.getObjectByName('lawson:diorama-road');assert.ok(ground,'bounded diorama road slab exists');
 const cutBases=[];api.root.traverse(node=>{if(node.material?.name==='base:cut-earth')cutBases.push(node)});assert.ok(cutBases.length>=1,'museum-grade diorama plinth anchors the block');
});

test('Lawson has an actual open entrance into the recessed interior rather than glazing across its doorway',async t=>{
 const {T,api}=await fixture(t);
 for(const y of [1.2,1.8,2.4]){
  const ray=new T.Raycaster(new T.Vector3(1.95,y,4),new T.Vector3(0,0,-1),0,12),hit=ray.intersectObject(api.root,true)[0];
  assert.ok(hit,'there is shop interior beyond the entrance');assert.ok(hit.point.z<.8,'the entry opening has no flat glass or sill across it');
 }
 for(const side of ['left','right']){
  const leaf=api.root.getObjectByName('lawson:open-door-'+side);assert.ok(leaf?.isMesh);assert.ok(leaf.material.transparent);assert.equal(leaf.material.depthWrite,false);
 }
});

test('bounded Lawson road covers the diorama carriageway and preserves owned resources across lighting changes',async t=>{
 const {T,api}=await fixture(t);
 for(const x of [-25,0,25])for(const z of [10,14.5]){
  const hit=new T.Raycaster(new T.Vector3(x,2,z),new T.Vector3(0,-1,0),0,3).intersectObject(api.root,true)[0];
  assert.ok(hit,'street carriageway surface exists on the diorama block');assert.equal(hit.object.material.name,'asphalt:road');assert.ok(Math.abs(hit.point.y-.035)<1e-5);
 }
 const geometry=api.root.getObjectByName('lawson:diorama-road').geometry;let released=0;geometry.addEventListener('dispose',()=>released++);
 for(const mode of ['night','day','morning'])assert.equal(api.setLighting(mode),true);
 assert.equal(api.root.getObjectByName('lawson:diorama-road').geometry,geometry);
 api.dispose();api.dispose();assert.equal(released,1,'diorama road belongs cleanly to factory disposal');
});
