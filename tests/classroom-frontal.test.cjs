const {test}=require('node:test');
const assert=require('node:assert/strict');

test('paired classroom daylight tubes illuminate the writing plane and desks with bounded night output',async()=>{
 const T=await import('three'),{finishClassroomInterior}=await import('../src/scenes/classroom-interior.mjs');
 const room=new T.Group(),interior=finishClassroomInterior(room),fixtures=room.getObjectByName('classroom:ceiling-and-fixtures');
 const tubes=fixtures.getObjectByName('classroom:ceiling-lamps'),sources=fixtures.children.filter(node=>node.isSpotLight);
 assert.equal(tubes.count,12);assert.equal(tubes.geometry.type,'CylinderGeometry');
 assert.equal(fixtures.getObjectByName('classroom:fluorescent-sockets').count,12);
 assert.equal(sources.length,3);
 const sun=new T.Vector3(-.8,.6,.3),board=fixtures.getObjectByName('classroom:fluorescent-board');
 interior.setSunlight(sun,1,0);
 assert.ok(board.isRectAreaLight&&board.width>3.6&&board.height<.15,'continuous horizontal emitting area');
 const boardAim=new T.Vector3(0,0,-1).applyQuaternion(board.quaternion);
 assert.ok(boardAim.dot(new T.Vector3(-2.65,1.47,-4.445).sub(board.position).normalize())>.999);
 for(const light of sources){
  assert.equal(light.decay,2);assert.ok(light.penumbra>.7);
  assert.ok(light.color.b>=light.color.r&&light.color.r/light.color.b>.88);
  const toLight=light.position.clone().sub(light.target.position),r=toLight.length();
  const normal=new T.Vector3(0,1,0);
  // At the cone centre Three combines inverse-square falloff with this
  // cutoff across the horizontal desks.
  const illuminance=light.intensity/r**2*(1-(r/light.distance)**4)**2*normal.dot(toLight.normalize());
  assert.ok(illuminance>.48&&illuminance<3.1,light.name+' receiver illuminance '+illuminance);
 }
 const shader={...T.ShaderLib.standard,uniforms:{}};
 fixtures.getObjectByName('classroom:ceiling-underside').material.onBeforeCompile(shader,null);
 const bounce=shader.uniforms.uClassroomBounce;
 assert.ok(bounce.value>1);assert.ok(shader.fragmentShader.indexOf('irradiance+=bounced')<shader.fragmentShader.indexOf('#include <aomap_fragment>'));
 const noon=sources.map(l=>l.intensity);
 interior.setSunlight(sun,0,1);sources.forEach((l,i)=>assert.ok(l.intensity<noon[i]&&l.intensity>noon[i]*.8));
 assert.ok(bounce.value>.9&&bounce.value<1,'the lit room stays bright without lighting the outside');
 assert.ok(tubes.material.emissiveIntensity<.7);
 interior.setSunlight(sun,1,0);assert.deepEqual(sources.map(l=>l.intensity),noon);
 const resources=new Set();for(const g of [room,interior.overhang,interior.exteriorRain])g.traverse(o=>{
  if(o.geometry)resources.add(o.geometry);if(o.material)resources.add(o.material);if(o.isInstancedMesh)resources.add(o);
 });
 let releases=0;T.UniformsLib.LTC_FLOAT_1.addEventListener('dispose',()=>releases++);
 interior.dispose();interior.dispose();assert.equal(releases,1);
 for(const r of resources)r.dispose();
});

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
