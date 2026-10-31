const {test}=require('node:test');
const assert=require('node:assert/strict');
async function setup(){const THREE=await import('three');const {SceneOverview}=await import('../src/ui/scene-overview.mjs');const {dioramaFrame}=await import('../src/ui/scene-camera.mjs');return {THREE,SceneOverview,dioramaFrame};}
test('miniature fits the whole scene while horizontally orbiting at wide and narrow aspects',async()=>{
 const {THREE,SceneOverview,dioramaFrame}=await setup();
 for(const aspect of [.75,1.25,1.8,2.4]){
  const bounds=new THREE.Box3(new THREE.Vector3(-38,0,-35),new THREE.Vector3(38,18,20));
  const camera=new THREE.PerspectiveCamera(42,aspect,.05,1500),target=new THREE.Vector3(),home={position:new THREE.Vector3(0,8,70),target:new THREE.Vector3(0,5,-16)};
  const frame=dioramaFrame(bounds,aspect,{fov:42,direction:[.8,.78,1.3],padding:1.06});
  const view=new SceneOverview(camera,target,{reducedMotion:true});view.reset(home,frame);view.show();view.step(.05);
  const distance=camera.position.distanceTo(target),height=camera.position.y-target.y;
  assert.ok(height/distance>.3&&height/distance<.7,'slightly elevated, not a top-down view');
  for(let i=0;i<12;i++){
   view.rotate(Math.PI/6);assert.ok(Math.abs(camera.position.distanceTo(target)-distance)<1e-8);
   for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){const p=new THREE.Vector3(x,y,z).project(camera);assert.ok(Math.abs(p.x)<1&&Math.abs(p.y)<1,'whole miniature must fit at every azimuth');}
  }
  view.release();view.step(.05);assert.ok(camera.position.distanceTo(home.position)<1e-8);assert.ok(target.distanceTo(home.target)<1e-8);
 }
});
test('wheel is bounded and release returns smoothly without mutating saved home',async()=>{
 const {THREE,SceneOverview}=await setup();const camera=new THREE.PerspectiveCamera(),target=new THREE.Vector3();
 const home={position:new THREE.Vector3(0,2,15),target:new THREE.Vector3(0,2,0)},overview={position:new THREE.Vector3(20,20,35),target:new THREE.Vector3()};
 const view=new SceneOverview(camera,target);view.reset(home,overview);for(let i=0;i<20;i++)view.wheel(100);assert.equal(view.desired,1);view.step(.05);assert.ok(view.amount>0&&view.amount<1);view.rotate(.4);view.release();const before=view.amount;view.step(.05);assert.ok(view.amount<before&&view.amount>0);for(let i=0;i<300;i++)view.step(.05);assert.equal(view.active,false);assert.deepEqual(home.position.toArray(),[0,2,15]);assert.ok(camera.position.distanceTo(home.position)<1e-8);
});
