const test=require('node:test'),assert=require('node:assert/strict');

test('street camera and every moved panel crop project the identical background pixels',async()=>{
 const T=await import('three'),{fitCityStreetCamera}=await import('../src/ui/city-stage-camera.mjs');
 for(const [width,height] of [[1400,900],[900,700],[760,580]]){
  const full=new T.PerspectiveCamera();fitCityStreetCamera(full,width,height);
  for(const left of [40,width*.4,width-290]){
   const panel={left,top:110,width:240,height:height-140},crop=new T.PerspectiveCamera();fitCityStreetCamera(crop,width,height,panel);
   assert.deepEqual(crop.position,full.position);assert.deepEqual(crop.quaternion.toArray(),full.quaternion.toArray());
   for(const p of [new T.Vector3(0,0,0),new T.Vector3(-2,1,-2),new T.Vector3(2,2.4,-3)]){
    const a=p.clone().project(full),b=p.clone().project(crop);
    assert.ok(Math.abs((a.x+1)*width/2-(panel.left+(b.x+1)*panel.width/2))<1e-8);
    assert.ok(Math.abs((1-a.y)*height/2-(panel.top+(1-b.y)*panel.height/2))<1e-8);
   }
  }
 }
});

test('stage moves the shop, bike, guardrail and their lamps back while retaining a grounded foreground',async()=>{
 const T=await import('three'),{stageCityForeground,CITY_STAGE_OFFSET}=await import('../src/ui/city-stage-camera.mjs'),{createEnvironment,disposeEnvironment}=await import('../src/ui/procedural-scenes.mjs'),{createCityAtmosphere}=await import('../src/ui/city-atmosphere.mjs');
 const env=createEnvironment('city'),gallery=createEnvironment('city'),rig=createCityAtmosphere({timeOfDay:23,weather:{rain:1}});
 try{
  const curb=env.children.find(x=>x.userData.role==='sidewalk-curb'),floor=env.children.find(x=>x.userData.role==='sidewalk'),lamp=rig.group.children.find(x=>x.name==='canopy-warm-spill'),target=lamp.target;
  const beforeLamp=lamp.position.z,beforeTarget=target.position.z,reflectionMatrix=rig.reflection.matrix.clone();
  stageCityForeground(env,rig);stageCityForeground(env,rig);
  assert.equal(lamp.position.z,beforeLamp-.9);assert.equal(target.position.z,beforeTarget-.9);assert.deepEqual(rig.reflection.matrix,reflectionMatrix);
  assert.equal(curb.position.z,0);assert.equal(floor.position.z,0);
  for(const mesh of env.children){const b=new T.Box3().setFromObject(mesh);assert.ok(b.min.z>=-6&&b.max.z<=6,`${mesh.name} stays inside local collectible base`)}
  for(const role of ['guardrail','bicycle-tire','bicycle-frame','bicycle-handlebar','storefront-glass']){
   const meshes=env.children.filter(x=>x.userData.role===role);assert.ok(meshes.length);
   for(const mesh of meshes){assert.equal(mesh.position.z,-.9);assert.ok(new T.Box3().setFromObject(mesh).max.z+CITY_STAGE_OFFSET[2]<-.3,`${role} is behind the reserved actor strip`)}
   assert.ok(gallery.children.filter(x=>x.userData.role===role).every(x=>x.position.z===0));
  }
  env.position.set(...CITY_STAGE_OFFSET);env.updateMatrixWorld(true);
  const hit=new T.Raycaster(new T.Vector3(0,1,.2),new T.Vector3(0,-1,0)).intersectObject(env).find(x=>x.object.userData.role==='sidewalk');assert.ok(hit&&Math.abs(hit.point.y)<1e-7);
 }finally{rig.dispose();disposeEnvironment(env);disposeEnvironment(gallery)}
});

test('all seven scene switches preserve portrait projection and the authored model pose',async()=>{
 const T=await import('three'),{GlbAvatarRenderer}=await import('../src/ui/model-runtime.mjs'),{SCENES}=await import('../src/ui/scene-catalog.mjs');
 for(const [width,height] of [[270,850],[340,630],[168,700]]){
  const container={clientWidth:width,clientHeight:height};const r=Object.create(GlbAvatarRenderer.prototype),model=new T.Mesh(new T.BoxGeometry(.6,2,.4),new T.MeshStandardMaterial());model.position.y=1;
  Object.assign(r,{container,renderEnvironment:false,scene:new T.Scene(),camera:new T.PerspectiveCamera(30,width/height,.01,100),environmentId:'classroom',timeOfDay:12,zoom:1,yaw:0,bounds:{size:new T.Vector3(.6,2,.4),center:new T.Vector3(0,1,0)},ambient:new T.HemisphereLight(),key:new T.DirectionalLight(),root:model,meshes:[model]});r.scene.add(model);
  try{r.fitCamera();const portrait=r.camera.projectionMatrix.toArray(),originalPosition=model.position.clone(),originalScale=model.scale.clone(),material=model.material;
   for(const id of Object.keys(SCENES))for(const route of ['panel','direct','hidden']){
    r.setEnvironment({id:'city',timeOfDay:12});r.setSceneStage(true);if(route==='hidden'){container.clientWidth=0;container.clientHeight=0;}if(route==='panel')r.setSceneStage(false);
    r.setEnvironment({id,timeOfDay:12});r.fitCamera();assert.equal(r.camera.view?.enabled||false,false);assert.equal(r.camera.aspect,width/height);assert.equal(r.camera.fov,30);assert.deepEqual(r.camera.projectionMatrix.toArray(),portrait);
    assert.equal(model.parent,r.scene);assert.equal(model.material,material);assert.deepEqual(model.position,originalPosition);assert.deepEqual(model.scale,originalScale);assert.equal(r.environment,undefined);container.clientWidth=width;container.clientHeight=height;
   }
  }finally{r.key.shadow.dispose();model.geometry.dispose();model.material.dispose()}
 }
});

test('moving an avatar panel does not mutate its camera or authored assets',async()=>{
 const T=await import('three'),{GlbAvatarRenderer}=await import('../src/ui/model-runtime.mjs');let left=100;
 const container={clientWidth:270,clientHeight:630,getBoundingClientRect:()=>({left,top:160,width:270,height:630})},r=Object.create(GlbAvatarRenderer.prototype),model=new T.Mesh(new T.BoxGeometry(.6,2,.4),new T.MeshStandardMaterial());model.position.y=1;
 Object.assign(r,{container,renderEnvironment:false,scene:new T.Scene(),camera:new T.PerspectiveCamera(30,1,.01,100),environmentId:'city',timeOfDay:23,zoom:1,yaw:0,bounds:{size:new T.Vector3(.6,2,.4),center:new T.Vector3(0,1,0)},ambient:new T.HemisphereLight(),key:new T.DirectionalLight(),root:model,meshes:[model]});r.scene.add(model);
 try{r.fitCamera();const material=JSON.stringify(model.material.toJSON()),position=model.position.clone(),camera=r.camera.position.clone(),projection=r.camera.projectionMatrix.toArray();
  left=950;r.fitCamera();assert.deepEqual(r.camera.position,camera);assert.deepEqual(r.camera.projectionMatrix.toArray(),projection);assert.deepEqual(model.position,position);assert.equal(JSON.stringify(model.material.toJSON()),material);assert.equal(model.parent,r.scene);
 }finally{r.key.shadow.dispose();model.geometry.dispose();model.material.dispose()}
});
