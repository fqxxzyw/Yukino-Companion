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

test('leaving the street stage restores portrait projection for every other scene without waiting for resize',async()=>{
 const T=await import('three'),{GlbAvatarRenderer}=await import('../src/ui/model-runtime.mjs'),{disposeEnvironment}=await import('../src/ui/procedural-scenes.mjs');
 for(const [width,height] of [[270,850],[340,630],[168,700]]){
  const container={clientWidth:width,clientHeight:height,closest:()=>({getBoundingClientRect:()=>({left:0,top:0,width:1440,height:1000})}),getBoundingClientRect:()=>({left:100,top:120,width,height})};
  const r=Object.create(GlbAvatarRenderer.prototype),model=new T.Mesh(new T.BoxGeometry(.6,2,.4),new T.MeshStandardMaterial());model.position.y=1;
  Object.assign(r,{container,renderEnvironment:false,scene:new T.Scene(),camera:new T.PerspectiveCamera(30,width/height,.01,100),environmentId:'studio',timeOfDay:12,zoom:1,yaw:0,bounds:{size:new T.Vector3(.6,2,.4),center:new T.Vector3(0,1,0)},ambient:new T.HemisphereLight(),key:new T.DirectionalLight(),root:model,meshes:[model],gl:{toneMapping:T.NoToneMapping,toneMappingExposure:1,shadowMap:{enabled:false,type:T.PCFShadowMap,autoUpdate:true}}});r.scene.add(model);
  try{
   r.fitCamera();const portrait=r.camera.clone(),originalPosition=model.position.clone(),originalScale=model.scale.clone(),material=model.material;
   for(const id of ['beach','classroom','forest','studio'])for(const route of ['panel','direct','hidden']){
    r.setEnvironment({id:'city',timeOfDay:12});r.setSceneStage(true);
    assert.equal(r.camera.view.enabled,true);assert.notEqual(r.camera.aspect,width/height);
    if(route==='hidden'){container.clientWidth=0;container.clientHeight=0;}
    // The panel disables staging before changing ID; callers may also change
    // ID directly. Both must restore the lens, even with no resize callback.
    if(route==='panel')r.setSceneStage(false);
    r.setEnvironment({id,timeOfDay:12});r.camera.updateMatrixWorld(true);
    assert.equal(r.camera.view.enabled,false);assert.equal(r.camera.aspect,width/height);assert.equal(r.camera.fov,30);
    assert.deepEqual(r.camera.projectionMatrix.toArray(),portrait.projectionMatrix.toArray());
    const project=camera=>{
     const left=new T.Vector3(-.3,1,0).project(camera),right=new T.Vector3(.3,1,0).project(camera),feet=new T.Vector3(0,0,0).project(camera),head=new T.Vector3(0,2,0).project(camera);
     return [(right.x-left.x)*width/2,(head.y-feet.y)*height/2];
    };
    assert.deepEqual(project(r.camera),project(portrait),'body width/height in actual panel pixels is unchanged');
    assert.equal(model.parent,r.scene);assert.equal(r.stageAnchor,null);assert.equal(r.cityAtmosphere,null);assert.equal(r.environment,null);
    assert.equal(model.material,material);assert.deepEqual(model.position,originalPosition);assert.deepEqual(model.scale,originalScale);
    container.clientWidth=width;container.clientHeight=height;
   }
  }finally{r.cityAtmosphere?.dispose();disposeEnvironment(r.environment);r.key.shadow.dispose();model.geometry.dispose();model.material.dispose()}
 }
});

test('actual avatar runtime changes only the outer anchor when dragging, not street/camera/assets',async()=>{
 const T=await import('three'),{GlbAvatarRenderer}=await import('../src/ui/model-runtime.mjs'),{disposeEnvironment}=await import('../src/ui/procedural-scenes.mjs');
 let left=100;const container={clientWidth:270,clientHeight:630,closest:()=>({getBoundingClientRect:()=>({left:0,top:0,width:1400,height:900})}),getBoundingClientRect:()=>({left,top:160,width:270,height:630})};
 const r=Object.create(GlbAvatarRenderer.prototype),model=new T.Mesh(new T.BoxGeometry(.6,2,.4),new T.MeshStandardMaterial());model.position.y=1;
 Object.assign(r,{container,renderEnvironment:false,scene:new T.Scene(),camera:new T.PerspectiveCamera(30,1,.01,100),environmentId:'city',timeOfDay:23,zoom:1,ambient:new T.HemisphereLight(),key:new T.DirectionalLight(),root:model,meshes:[model],gl:{toneMapping:T.NoToneMapping,toneMappingExposure:1,shadowMap:{enabled:false,type:T.PCFShadowMap,autoUpdate:true}}});r.scene.add(model);
 try{
  const material=JSON.stringify(model.material.toJSON()),sourcePosition=model.position.clone();r.setSceneStage(true);
  const environment=r.environment,rig=r.cityAtmosphere,anchor=r.stageAnchor,x=anchor.position.x,worldCamera=r.camera.position.clone(),environmentPosition=environment.position.clone(),lamp=rig.group.children.find(x=>x.name==='store-warm-left'),lampPosition=lamp.position.clone();
  r.setSceneWeather({rain:.7,cloud:.5});assert.equal(r.cityAtmosphere,rig);assert.ok(rig.reflection.visible);
  left=950;r.updateCityStageView();assert.ok(anchor.position.x>x+2);assert.equal(anchor.position.z,.2);assert.equal(anchor.position.y,0);
  assert.equal(r.environment,environment);assert.deepEqual(environment.position,environmentPosition);assert.deepEqual(lamp.position,lampPosition);assert.deepEqual(r.camera.position,worldCamera);assert.deepEqual(model.position,sourcePosition);assert.equal(JSON.stringify(model.material.toJSON()),material);
  const a=lamp.getWorldPosition(new T.Vector3()),near=a.distanceTo(anchor.position);left=100;r.updateCityStageView();assert.notEqual(a.distanceTo(anchor.position),near,'real point-light distance changes with actor world position');
  r.setEnvironment({id:'city',timeOfDay:12});assert.ok(rig.group.children.filter(x=>x.isLight).every(x=>x.intensity===0));
  r.setSceneStage(false);assert.equal(model.parent,r.scene);assert.equal(r.stageAnchor,null);assert.equal(r.camera.view?.enabled,false);assert.equal(r.environment,null);
 }finally{r.cityAtmosphere?.dispose();disposeEnvironment(r.environment);r.key.shadow.dispose();model.geometry.dispose();model.material.dispose()}
});
