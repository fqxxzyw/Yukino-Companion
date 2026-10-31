const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');

// These execute Three scene graphs/shader construction, not a real GPU. Keep
// the visual acceptance gate separate; no app, browser or model is launched.
test('night rig has actual warm/cool local lights and bounded low-resolution broken wet reflections',async()=>{
 const THREE=await import('three'),{createCityAtmosphere}=await import('../src/ui/city-atmosphere.mjs');
 const a=createCityAtmosphere({timeOfDay:23,weather:{rain:1}}),b=createCityAtmosphere({resolution:384,timeOfDay:23,weather:{rain:1}});
 try{
  const lights=a.group.children.filter(x=>x.isLight);assert.equal(lights.length,5);
  assert.equal(lights.filter(x=>x.isPointLight).length,3);assert.equal(lights.filter(x=>x.isSpotLight).length,2);
  const warm=lights.find(x=>x.name==='canopy-warm-spill'),cool=lights.find(x=>x.name==='vending-cool-spill');
  assert.ok(warm.intensity>20&&warm.color.r>warm.color.b);assert.ok(cool.color.b>cool.color.r);
  for(const light of lights){assert.ok(light.distance>0&&light.distance<10);assert.ok(Math.abs(light.position.x)<6&&Math.abs(light.position.z)<6);assert.equal(light.castShadow,false,'one caller-owned directional shadow map, not five extra shadow maps');}
  a.group.updateMatrixWorld(true);const reflector=a.reflection;
  assert.ok(reflector.isReflector);assert.equal(reflector.getRenderTarget().width,512);assert.equal(b.reflection.getRenderTarget().width,384);
  assert.equal(reflector.getRenderTarget().samples,0);assert.equal(reflector.material.transparent,true);assert.equal(reflector.material.depthWrite,false);
  assert.match(reflector.material.fragmentShader,/wetPosition/);assert.match(reflector.material.fragmentShader,/smoothstep/);assert.match(reflector.material.fragmentShader,/texture2D\(tDiffuse/);assert.match(reflector.material.vertexShader,/wetPosition = position.xy/);
  const bounds=new THREE.Box3().setFromObject(reflector);assert.ok(bounds.min.x>=-6&&bounds.max.x<=6&&bounds.min.z>=-6&&bounds.max.z<=6);
  assert.ok(Math.abs(bounds.min.y-.048)<1e-6);assert.ok(bounds.max.y<.06);
  // L shape, not a mirror covering the shop/pavement: vertex triangle centroids
  // must fall in the front road or in the narrow left return.
  const pos=reflector.geometry.attributes.position,idx=reflector.geometry.index;
  for(let i=0;i<idx.count;i+=3){let x=0,z=0;for(let k=0;k<3;k++){const p=new THREE.Vector3().fromBufferAttribute(pos,idx.getX(i+k)).applyMatrix4(reflector.matrixWorld);x+=p.x/3;z+=p.z/3;}assert.ok(z>=2.26||x<=-3.28);}
  const sprites=a.group.children.filter(x=>x.isSprite);assert.equal(sprites.length,4);
  assert.ok(sprites.every(x=>x.material.map.isDataTexture&&x.material.blending===THREE.AdditiveBlending&&!x.material.depthWrite));
  assert.notEqual(sprites[0].material.map,b.group.children.find(x=>x.isSprite).material.map);
 }finally{a.dispose();b.dispose();}
});

test('atmosphere disposes targets, shader, glow map and sprite materials exactly once',async()=>{
 const {createCityAtmosphere}=await import('../src/ui/city-atmosphere.mjs');const a=createCityAtmosphere();
 const sprite=a.group.children.find(x=>x.isSprite),resources=new Set([a.reflection.getRenderTarget(),a.reflection.material,a.reflection.geometry,sprite.material.map,...a.group.children.filter(x=>x.isSprite).map(x=>x.material)]);
 const calls=new Map();for(const resource of resources){calls.set(resource,0);resource.addEventListener('dispose',()=>calls.set(resource,calls.get(resource)+1));}
 a.dispose();a.dispose();assert.ok([...calls.values()].every(count=>count===1));assert.equal(a.group.children.length,0);
 const noMirror=createCityAtmosphere({reflections:false});assert.equal(noMirror.reflection,null);noMirror.dispose();
});

test('character and store share a scene, ground and lights without changing model geometry or materials',async()=>{
 const THREE=await import('three'),{GlbAvatarRenderer}=await import('../src/ui/model-runtime.mjs'),{cityLighting}=await import('../src/ui/city-atmosphere.mjs');
 const r=Object.create(GlbAvatarRenderer.prototype),material=new THREE.MeshStandardMaterial({color:'#958a8a'}),geometry=new THREE.BoxGeometry(.6,2,.3),avatar=new THREE.Mesh(geometry,material);avatar.position.y=1;
 const gl={toneMapping:THREE.NoToneMapping,toneMappingExposure:1,shadowMap:{enabled:false,type:THREE.PCFShadowMap,autoUpdate:true}};
 Object.assign(r,{renderEnvironment:false,scene:new THREE.Scene(),camera:new THREE.PerspectiveCamera(),environmentId:'studio',timeOfDay:12,ambient:new THREE.HemisphereLight(),key:new THREE.DirectionalLight(),meshes:[avatar],root:avatar,gl});r.scene.add(avatar);
 const original=JSON.stringify(material.toJSON()),position=avatar.position.clone();
 try{
  r.setEnvironment({id:'city',timeOfDay:12});assert.equal(r.environment,undefined,'wallpaper/ordinary transparent view is not forced into a street stage');
  r.setSceneStage(true);assert.equal(avatar.parent,r.stageAnchor);assert.equal(r.stageAnchor.parent,r.scene);assert.ok(r.scene.children.includes(r.environment));assert.equal(r.cityAtmosphere.group.parent,r.scene);
  assert.equal(r.environment.userData.timeOfDay,12);assert.equal(r.timeOfDay,12,'stage follows supplied real time rather than forcing a rainy night');assert.deepEqual(r.environment.position.toArray(),[0,-.14,-1.6]);
  assert.equal(r.ambient.intensity,cityLighting(12).ambient);assert.equal(r.key.intensity,cityLighting(12).intensity);assert.equal(gl.toneMapping,THREE.ACESFilmicToneMapping);assert.equal(gl.shadowMap.enabled,true);
  assert.equal(avatar.castShadow,true);assert.equal(avatar.receiveShadow,true);assert.equal(avatar.material,material);assert.equal(avatar.geometry,geometry);assert.deepEqual(avatar.position,position);assert.equal(JSON.stringify(material.toJSON()),original);
  r.scene.updateMatrixWorld(true);const floor=new THREE.Raycaster(new THREE.Vector3(0,.5,0),new THREE.Vector3(0,-1,0)).intersectObject(r.environment).find(hit=>hit.object.userData.role==='sidewalk');assert.ok(floor);assert.ok(Math.abs(floor.point.y)<1e-6,'actual street pavement meets the avatar floor, not a floating portrait');
  const atmosphere=r.cityAtmosphere,environment=r.environment;let released=0;environment.children[0].geometry.addEventListener('dispose',()=>released++);
  r.setEnvironment({id:'forest',timeOfDay:8});assert.equal(r.environment,null);assert.equal(r.cityAtmosphere,null);assert.equal(environment.parent,null);assert.equal(atmosphere.group.children.length,0);assert.equal(released,1);
  assert.equal(avatar.parent,r.scene);assert.equal(avatar.castShadow,false);assert.equal(avatar.receiveShadow,false);assert.equal(avatar.material,material);
  assert.equal(gl.toneMapping,THREE.NoToneMapping);assert.equal(gl.toneMappingExposure,1);assert.equal(gl.shadowMap.enabled,false);assert.equal(gl.shadowMap.type,THREE.PCFShadowMap);assert.equal(gl.shadowMap.autoUpdate,true);assert.equal(r.scene.fog,null);
 }finally{r.cityAtmosphere?.dispose();if(r.environment)(await import('../src/ui/procedural-scenes.mjs')).disposeEnvironment(r.environment);r.key.shadow.dispose();geometry.dispose();material.dispose();}
});

test('hidden character suppresses GPU draws without stalling an outfit walking completion',async t=>{
 const {GlbAvatarRenderer}=await import('../src/ui/model-runtime.mjs'),r=Object.create(GlbAvatarRenderer.prototype);
 const saved={document:globalThis.document,requestAnimationFrame:globalThis.requestAnimationFrame};t.after(()=>{for(const [k,v]of Object.entries(saved))if(v===undefined)delete globalThis[k];else globalThis[k]=v;});
 globalThis.document={hidden:false};globalThis.requestAnimationFrame=()=>1;
 let draws=0,finished=0,steps=0;
 Object.assign(r,{last:0,reducedMotion:true,activity:'idle',nextMicro:Infinity,meshes:[],container:{dataset:{},clientWidth:300,clientHeight:600},gl:{render(){draws++;},domElement:{dataset:{}}},advanceWalking(){steps++;},updateSpeechMotion(){},updateGarment(){},updateBlink(){},hasCompetingBodyAction(){return false;},finishWalking(){finished++;this.walkingMotion=null;}});
 r.walkingMotion={sample:{done:true}};r.setVisible(false);r.renderFrame(200);assert.equal(draws,0);assert.equal(steps,1);assert.equal(finished,1);
 r.setVisible(true);r.renderFrame(400);assert.equal(draws,1);globalThis.document.hidden=true;r.renderFrame(800);assert.equal(draws,1);
 globalThis.document.hidden=false;r.container.clientWidth=0;r.renderFrame(1000);assert.equal(draws,1);
});

test('city UI styling removes the grey wash only for the derived night scene and preserves accessibility fallbacks',async()=>{
 const css=await fs.readFile(path.join(__dirname,'../src/style.css'),'utf8'),app=await fs.readFile(path.join(__dirname,'../src/main.jsx'),'utf8');
 assert.match(css,/\.app\.scene-city \.environment-backdrop-canvas\{opacity:1\}/);
 assert.match(css,/\.app\.scene-city \.character-panel[^}]+background:color-mix[^}]+border-radius:22px/);
 assert.doesNotMatch(css,/scene-city-night \.character-model-host\{[^}]*border-radius:0/);
 assert.match(css,/prefers-reduced-transparency:reduce[^}]+scene-city/);assert.match(css,/forced-colors:active[^}]+scene-city/);
 assert.match(app,/citySceneActive=s\.presentation\?\.scene==='city'&&s\.presentation\?\.spread&&!\(wallpaperSettings\.enabled&&wallpaperSettings\.items\.length\)/);
 assert.match(app,/themeVariables\(s\.accent,cityNight\?'#0d1729':s\.background\)/);assert.match(app,/sceneStage=\{Boolean\(citySceneActive\)\}/);
 assert.doesNotMatch(app,/patch\(\{background:'#0d1729'/);
});
