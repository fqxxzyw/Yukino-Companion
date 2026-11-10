const {test}=require('node:test');
const assert=require('node:assert/strict');

async function fixture(t){
 const T=await import('three'),{createScene}=await import('../src/scenes/school.mjs');
 const saved=global.document;global.document={createElement(){const canvas={width:0,height:0};canvas.getContext=()=>new Proxy({canvas,createLinearGradient:()=>({addColorStop(){}}),createRadialGradient:()=>({addColorStop(){}}),measureText:()=>({width:40}),getImageData:(_x,_y,w,h)=>({data:new Uint8ClampedArray(w*h*4),width:w,height:h})},{get:(target,key)=>key in target?target[key]:()=>{}});return canvas;}};
 t.after(()=>{if(saved===undefined)delete global.document;else global.document=saved});
 const scene=new T.Scene(),renderer={toneMappingExposure:1,shadowMap:{}},api=createScene({scene,renderer});api.root.updateMatrixWorld(true);t.after(()=>api.dispose());return {T,api,scene,renderer};
}

test('school home is a centered pedestrian front view and its two gates face perpendicular public roads',async t=>{
 const {T,api}=await fixture(t),p=api.cameraPresets.companion,plan=api.root.userData.schoolCampus;
 assert.equal(p.position[0],p.target[0]);assert.ok(p.position[2]>p.target[2]);assert.ok(p.position[1]<3,'home stays at the public road rather than high above campus');
 assert.ok(Math.abs(p.target[1]-p.position[1])/(p.position[2]-p.target[2])<.08,'facade pitch stays shallow');
 assert.equal(new T.Vector3(...plan.entrances.white.outward).dot(new T.Vector3(...plan.entrances.library.outward)),0);
 const south=api.root.getObjectByName('school:south-road'),east=api.root.getObjectByName('school:east-road');
 assert.ok(south&&east);assert.ok(south.scale.x>south.scale.z*4);assert.ok(east.scale.z>east.scale.x*4);
});

test('pedestrian view exposes the actual paired exterior stairs through the entrance instead of tall red screening',async t=>{
 const {T,api}=await fixture(t),camera=new T.Vector3(...api.cameraPresets.companion.position);
 const walls=api.root.children.filter(o=>o.name==='red-gate-wall');assert.equal(walls.length,2);
 for(const wall of walls){const box=new T.Box3().setFromObject(wall);assert.ok(box.getSize(new T.Vector3()).y<1.85);}
 for(const side of [-1,1]){
  const end=new T.Vector3(side*6.8,4.9,-2.6),direction=end.clone().sub(camera),ray=new T.Raycaster(camera,direction.clone().normalize(),0,direction.length());
  assert.equal(ray.intersectObjects(walls,true).length,0,'red wall does not hide the upper exterior stair');
 }
});

test('school clock remains live when scenery is paused and extension resources release only once',async t=>{
 const {api}=await fixture(t),face=api.root.getObjectByName('school:clock-face'),library=api.root.getObjectByName('school:curved-library-cladding');
 assert.ok(face&&library);api.setMotion({enabled:false});api.updateTime(new Date(2026,10,3,18,25,31));assert.deepEqual(face.userData.time,{hour:18,minute:25,second:31});
 let disposed=0;library.geometry.addEventListener('dispose',()=>disposed++);api.dispose();api.dispose();assert.equal(disposed,1);
});
