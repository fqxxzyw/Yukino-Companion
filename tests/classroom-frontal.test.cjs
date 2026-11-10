const {test}=require('node:test');
const assert=require('node:assert/strict');

test('classroom companion view faces the actual board squarely and frames it between sidebar and character',async t=>{
 const T=await import('three'),{createScene}=await import('../src/scenes/classroom.mjs'),{setCameraFrameShift}=await import('../src/ui/scene-camera.mjs');
 const saved=global.document;global.document={createElement(){const canvas={width:0,height:0};canvas.getContext=()=>new Proxy({canvas},{get:(target,key)=>key in target?target[key]:()=>{}});return canvas;}};
 t.after(()=>{if(saved===undefined)delete global.document;else global.document=saved;});
 const api=createScene({scene:new T.Scene(),renderer:{toneMappingExposure:1,shadowMap:{type:T.PCFSoftShadowMap}}});t.after(()=>api.dispose());
 const board=api.root.getObjectByName('classroom:board');board.updateWorldMatrix(true,false);
 const preset=api.cameraPresets.companion;
 assert.equal(preset.position[0],preset.target[0]);assert.equal(preset.position[1],preset.target[1]);
 assert.deepEqual(api.cameraPresets.photo,preset);
 for(const [width,height]of [[1440,1000],[1920,1080],[2560,1528]]){
  const camera=new T.PerspectiveCamera(preset.fov,width/height,.05,1500);camera.position.fromArray(preset.position);camera.lookAt(new T.Vector3(...preset.target));setCameraFrameShift(camera,preset.shiftY);camera.updateMatrixWorld(true);
  const positions=board.geometry.attributes.position,uv=board.geometry.attributes.uv,points=[];
  for(const [u,v]of [[0,1],[1,1],[1,0],[0,0]]){
   const index=Array.from({length:uv.count},(_,i)=>i).find(i=>uv.getX(i)===u&&uv.getY(i)===v);assert.notEqual(index,undefined);
   const p=new T.Vector3().fromBufferAttribute(positions,index).applyMatrix4(board.matrixWorld).project(camera);
   points.push({x:(p.x+1)*width/2,y:(1-p.y)*height/2});
  }
  assert.ok(Math.abs(points[0].y-points[1].y)<1e-6&&Math.abs(points[2].y-points[3].y)<1e-6,'horizontal board edges stay level');
  assert.ok(Math.abs(points[0].x-points[3].x)<1e-6&&Math.abs(points[1].x-points[2].x)<1e-6,'board stays a frontal rectangle');
  assert.ok(points[0].x>244&&points[1].x<width-290,'board fits between the existing panels');
  assert.ok(points[0].y>100&&points[2].y<height*.65,'board stays visible above composer');
 }
});

test('temporary overview removes vertical frame shift and restores the frontal composition on return',async()=>{
 const T=await import('three'),{SceneOverview}=await import('../src/ui/scene-overview.mjs');
 const camera=new T.PerspectiveCamera(29,1.6,.05,1500),target=new T.Vector3();
 const home={position:new T.Vector3(-2.1,2,8.3),target:new T.Vector3(-2.1,2,-4.445),shiftY:.22};
 const overview={position:new T.Vector3(20,18,24),target:new T.Vector3(0,1,0)};
 const view=new SceneOverview(camera,target,{reducedMotion:true});view.reset(home,overview);
 assert.equal(camera.view.enabled,true);assert.equal(camera.view.offsetY,.22);assert.equal(camera.aspect,1.6);
 view.show();view.step(.1);assert.equal(camera.view.enabled,false);assert.equal(camera.aspect,1.6);
 view.release();view.step(.1);assert.equal(camera.view.enabled,true);assert.equal(camera.view.offsetY,.22);
 assert.deepEqual(camera.position.toArray(),home.position.toArray());assert.deepEqual(target.toArray(),home.target.toArray());
});
