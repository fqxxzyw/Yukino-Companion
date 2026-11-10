const {test}=require('node:test');
const assert=require('node:assert/strict');

async function fixture(t){
 const T=await import('three'),{createScene,terrainHeight,groundHeight}=await import('../src/scenes/sakura-stream.mjs');
 const api=createScene({scene:new T.Scene(),renderer:{toneMappingExposure:1,shadowMap:{}}});api.root.updateMatrixWorld(true);t.after(()=>api.dispose());return {T,api,terrainHeight,groundHeight};
}

test('the clear stream has a metre-deep stony bed and connected raised banks along its authoritative water footprint',async t=>{
 const {T,api,terrainHeight}=await fixture(t),{STREAM_LEVEL,streamCenter,streamHalfWidth}=await import('../src/scenes/sakura-stream-layout.mjs');
 const bed=api.root.getObjectByName('sakura-stream:riverbed');assert.ok(bed?.isMesh);
 for(const z of [-40,-28,-12,0,15,29])for(const u of [-.8,0,.8]){
  const x=streamCenter(z)+u*streamHalfWidth(z),ray=new T.Raycaster(new T.Vector3(x,4,z),new T.Vector3(0,-1,0),0,6),hit=ray.intersectObject(bed,false)[0];
  assert.ok(hit,`bed covers ${x},${z}`);assert.ok(STREAM_LEVEL-hit.point.y>.9&&STREAM_LEVEL-hit.point.y<1.18);assert.ok(hit.face.normal.y>.85);
 }
 for(const side of [-1,1]){
  const bank=api.root.getObjectByName('sakura-stream:'+(side<0?'left-bank':'right-bank'));assert.ok(bank);
  for(const z of [-39,-15,8,28])for(const d of [-.3,.3,1,4]){
   const x=streamCenter(z)+side*(streamHalfWidth(z)+d),ray=new T.Raycaster(new T.Vector3(x,4,z),new T.Vector3(0,-1,0),0,6),hit=ray.intersectObject(bank,false)[0];
   assert.ok(hit,`bank has no hole at ${x},${z}`);assert.ok(Math.abs(hit.point.y-terrainHeight(x,z))<.09);
  }
  for(const z of [-39,-15,8,28]){
   const crest=streamCenter(z)+side*(streamHalfWidth(z)+3.35),wetEdge=streamCenter(z)+side*streamHalfWidth(z);
   assert.ok(terrainHeight(crest,z)-STREAM_LEVEL>1.4,'tree/path crest clearly sits above the water');
   assert.ok(terrainHeight(crest,z)-terrainHeight(wetEdge,z)>1.35,'bank has a visible slope break');
  }
 }
 assert.equal(api.root.getObjectByName('sakura-stream:submerged-pebbles').count,2450);
 const grass=api.root.getObjectByName('foliage:stream-bank-grass'),matrix=new T.Matrix4(),point=new T.Vector3();
 assert.ok(grass?.isInstancedMesh);
 for(let i=0;i<grass.count;i+=Math.max(1,Math.floor(grass.count/35))){
  grass.getMatrixAt(i,matrix);point.setFromMatrixPosition(matrix);
  assert.ok(Math.abs(point.y-api.root.userData.sakuraStream.groundHeight(point.x,point.z))<.008,'curved blade roots remain planted in the real bank');
 }
});

test('path, low bridge and mountain context share ground while far backdrop does not dilute the finite scene framing',async t=>{
 const {T,api,groundHeight,terrainHeight}=await fixture(t),{pathCenter,STREAM_LEVEL}=await import('../src/scenes/sakura-stream-layout.mjs');
 const path=api.root.getObjectByName('sakura-stream:blossom-path');
 for(const z of [-36,-18,0,18,27]){
  const x=pathCenter(z),hit=new T.Raycaster(new T.Vector3(x,4,z),new T.Vector3(0,-1,0),0,6).intersectObject(path,false)[0];
  assert.ok(hit);assert.ok(Math.abs(hit.point.y-groundHeight(x,z))<.035);
 }
 const bridge=api.root.getObjectByName('sakura-stream:bridge-deck');assert.ok(bridge);assert.ok(new T.Box3().setFromObject(bridge).min.y>STREAM_LEVEL+1.35);
 for(const side of ['left','right']){
  const approach=api.root.getObjectByName('sakura-stream:bridge-approach-'+side),p=approach.geometry.attributes.position;
  for(let i=0;i<p.count;i++)assert.ok(p.getY(i)>=terrainHeight(p.getX(i),p.getZ(i))-.025,'bridge approach clears the raised bank');
 }
 for(const preset of [api.cameraPresets.companion,api.cameraPresets.photo]){
  const [x,y,z]=preset.position;assert.ok(y-groundHeight(x,z)>=1.4,'camera stays at walking height above the raised path');
 }
 assert.ok(api.root.getObjectByName('sakura-stream:mountain-layer-0'));assert.ok(api.root.getObjectByName('sakura-stream:sky'));
 assert.ok([...api.bounds.min.toArray(),...api.bounds.max.toArray()].every(Number.isFinite));assert.ok(api.bounds.getSize(new T.Vector3()).length()<140);
 assert.ok(api.root.getObjectByName('sakura-stream:sky').parent===api.root);
});

test('scene motion, climate hooks and idempotent disposal coordinate water and blossoms without replacing river geometry',async t=>{
 const {api}=await fixture(t),geometry=api.root.getObjectByName('sakura-stream:riverbed').geometry,water=api.streamWater,life=api.sakuraLife;
 api.setMotion({enabled:true});api.update(.04,0);api.update(.04,1);
 const time=water.mesh.material.uniforms.uTime.value;api.setMotion({enabled:false});api.update(.04,8);assert.equal(water.mesh.material.uniforms.uTime.value,time);assert.equal(life.metadata.motionEnabled,false);
 api.setMotion({enabled:true});api.update(.04,9);api.update(.04,9.05);assert.equal(life.metadata.motionEnabled,true);
 api.setWind(.8);api.setSunlight({x:.4,y:.8,z:.4},.7,.2);assert.equal(api.root.getObjectByName('sakura-stream:riverbed').geometry,geometry);
 let geometryReleased=0;geometry.addEventListener('dispose',()=>geometryReleased++);
 const target=water.renderTargets?.[0];let targetReleased=0;target?.addEventListener('dispose',()=>targetReleased++);
 api.dispose();api.dispose();assert.equal(geometryReleased,1);if(target)assert.equal(targetReleased,1);
});
