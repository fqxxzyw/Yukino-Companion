const {test}=require('node:test');
const assert=require('node:assert/strict');

test('Kyoto chat camera frames Kiyomizu gate, pagoda and torii together',async t=>{
 const T=await import('three'),{createScene}=await import('../src/scenes/kyoto-temple.mjs');
 const saved=global.document;
 global.document={createElement(){const canvas={width:0,height:0};canvas.getContext=()=>new Proxy({canvas,measureText:()=>({width:40})},{get:(target,key)=>key in target?target[key]:()=>{}});return canvas;}};
 t.after(()=>{if(saved===undefined)delete global.document;else global.document=saved;});
 const api=createScene({scene:new T.Scene(),renderer:{toneMappingExposure:1,shadowMap:{}}});t.after(()=>api.dispose());
 api.root.updateMatrixWorld(true);
 const portal=api.root.getObjectByName('torii:joined-timber');assert.ok(portal);
 const gate=new T.Vector3(-4.4,5,.15),pagoda=new T.Vector3(.5,9,-6.15);
 const torii=portal.getWorldPosition(new T.Vector3()).add(new T.Vector3(0,2,0));
 const preset=api.cameraPresets.companion;
 for(const aspect of [1.25,1.42,1.85]){
  const camera=new T.PerspectiveCamera(preset.fov,aspect,.05,1500);
  camera.position.fromArray(preset.position);camera.lookAt(new T.Vector3(...preset.target));camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
  const points=[gate,pagoda,torii].map(point=>point.clone().project(camera));
  for(const point of points)assert.ok(Math.abs(point.x)<.9&&Math.abs(point.y)<.9,'each landmark centre should fit the chat camera');
  assert.ok(points[0].x<points[1].x&&points[1].x<points[2].x,'gate and pagoda should remain left of torii');
 }
});
