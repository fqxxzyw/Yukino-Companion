const {test}=require('node:test');
const assert=require('node:assert/strict');

async function fixture(t){
 const T=await import('three'),{Diorama}=await import('../src/scenes/diorama-kit.mjs'),{addClearStream}=await import('../src/scenes/clear-stream.mjs');
 const b=new Diorama(new T.Scene(),{toneMappingExposure:1,shadowMap:{}},'water-contact-test'),water=addClearStream(b,{}),api=b.finish({rain:false});
 t.after(()=>{water.dispose();api.dispose()});return {T,b,water,api};
}

test('visible current obstructions emerge from the connected riverbed and own the wake locations',async t=>{
 const {T,water,api}=await fixture(t),{STREAM_LEVEL,streamCenter,streamHalfWidth}=await import('../src/scenes/sakura-stream-layout.mjs');
 const rocks=[];api.root.updateMatrixWorld(true);api.root.traverse(o=>{if(o.name==='stream:current-obstacle')rocks.push(o)});
 assert.ok(rocks.length>=3,'the current changes around actual visible obstructions');
 for(const obstacle of water.metadata.obstacles){
  const rock=rocks.find(o=>Math.abs(o.position.x-obstacle.x)<1e-8&&Math.abs(o.position.z-obstacle.z)<1e-8);assert.ok(rock);
  const bounds=new T.Box3().setFromObject(rock);
  assert.ok(bounds.min.y<=obstacle.bedY+.025,'obstruction is embedded in the stream bed');
  assert.ok(bounds.max.y>STREAM_LEVEL+.08&&bounds.max.y<STREAM_LEVEL+.5,'current meets a partly submerged rock');
  assert.ok(Math.abs(obstacle.x-streamCenter(obstacle.z))+obstacle.radius<streamHalfWidth(obstacle.z),'obstruction is inside the water footprint');
 }
});

test('turbulence freezes on pause and solar reflection follows scene sunlight rather than wall time',async t=>{
 const {T,water}=await fixture(t),u=water.material.uniforms;
 water.update(0);water.update(2);const phase=u.uTime.value;
 water.setMotion({enabled:false});water.update(200);assert.equal(u.uTime.value,phase);
 water.setSunlight(new T.Vector3(.3,.8,-.5),1,0);const direct=u.uSunStrength.value;
 water.setSunlight(new T.Vector3(.3,.8,-.5),1,1);assert.ok(u.uSunStrength.value<direct*.2);
 water.setSunlight(new T.Vector3(.3,.8,-.5),0,0);assert.equal(u.uSunStrength.value,0);
 assert.equal(u.uTime.value,phase,'changing sunlight never advances the current');
 water.setMotion({enabled:true});water.update(900);assert.equal(u.uTime.value,phase,'resuming does not consume parked wall time');
 water.update(900.05);assert.ok(Math.abs(u.uTime.value-phase-.05)<1e-8);
});
