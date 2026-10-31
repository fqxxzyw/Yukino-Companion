const test=require('node:test'),assert=require('node:assert/strict');
const modulePromise=import('../src/ui/city-atmosphere.mjs');
const threePromise=import('three');

// Scene graph/shader tests only: no app, browser, GPU or network is started.
test('city follows local hours with smooth dawn/day/dusk/night and keeps legacy night exports',async()=>{
 const {cityLighting,CITY_NIGHT,applyCityNight}=await modulePromise,{sunlightConfig}=await import('../src/ui/procedural-scenes.mjs');
 const night=cityLighting(0),dawn=cityLighting(6),day=cityLighting(12),dusk=cityLighting(18);
 assert.equal(night.nightAmount,1);assert.equal(day.nightAmount,0);
 assert.ok(dawn.nightAmount>0&&dawn.nightAmount<1);assert.ok(dusk.nightAmount>0&&dusk.nightAmount<1);
 assert.ok(day.intensity>dawn.intensity&&dawn.intensity>night.intensity);assert.ok(day.ambient>night.ambient);
 assert.notEqual(day.skyColor,night.skyColor);assert.notEqual(dawn.color,day.color);
 assert.deepEqual(day.position,sunlightConfig(12).position);assert.deepEqual(cityLighting(7).position,sunlightConfig(7).position);
 assert.deepEqual(cityLighting(24),night);assert.deepEqual(cityLighting(-1),cityLighting(23));
 for(let minute=0;minute<1440;minute++){
  const a=cityLighting(minute/60),b=cityLighting((minute+1)/60);
  assert.ok(Math.abs(a.intensity-b.intensity)<.08,`continuous intensity at minute ${minute}`);
  assert.ok(Math.abs(a.nightAmount-b.nightAmount)<.02);
  assert.ok(a.position.every(Number.isFinite));assert.ok(a.ambient>0&&a.intensity>0);
 }
 const THREE=await threePromise,ambient=new THREE.HemisphereLight(),key=new THREE.DirectionalLight(),gl={};
 applyCityNight(ambient,key,gl);
 assert.equal(key.intensity,CITY_NIGHT.moonIntensity);assert.equal(ambient.intensity,CITY_NIGHT.ambient);
 assert.equal(gl.toneMappingExposure,CITY_NIGHT.exposure);
 key.shadow.dispose();
});

test('missing/invalid city time uses the actual fractional local clock, not forced night',async t=>{
 const {cityLighting,createCityAtmosphere}=await modulePromise,RealDate=globalThis.Date;
 const fixed=new RealDate(2026,0,10,12,30,15);
 globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[fixed.getTime()]));}static now(){return fixed.getTime();}};
 t.after(()=>{globalThis.Date=RealDate;});
 const expected=cityLighting(12+30/60+15/3600);
 for(const invalid of [undefined,null,NaN,Infinity,{},'__proto__',{kind:'solar',elevation:10}])assert.deepEqual(cityLighting(invalid),expected);
 const rig=createCityAtmosphere();try{assert.deepEqual(rig.group.userData.lighting,expected);assert.ok(rig.group.children.filter(x=>x.isLight).every(x=>x.intensity===0));}finally{rig.dispose();}
});

test('solar elevation handles polar daylight/night and preserves the real sun direction above the horizon',async()=>{
 const {cityLighting}=await modulePromise,{sunlightConfig}=await import('../src/ui/procedural-scenes.mjs');
 const summer={kind:'solar',elevation:15,hourAngle:175,localHour:0},winter={kind:'solar',elevation:-12,hourAngle:0,localHour:12};
 assert.equal(cityLighting(summer).nightAmount,0,'midnight sun must not light shop lamps');
 assert.equal(cityLighting(winter).nightAmount,1,'polar noon darkness must light shop lamps');
 for(const hourAngle of [-90,-15,90]){
  const solar={kind:'solar',elevation:1,hourAngle};
  assert.deepEqual(cityLighting(solar).position,sunlightConfig(solar).position);
 }
 assert.ok(cityLighting({kind:'solar',elevation:25,hourAngle:-60}).position[0]<0);
 assert.ok(cityLighting({kind:'solar',elevation:25,hourAngle:60}).position[0]>0);
 for(let elevation=-8;elevation<10;elevation+=.1){
  const a=cityLighting({kind:'solar',elevation,hourAngle:-80}),b=cityLighting({kind:'solar',elevation:elevation+.01,hourAngle:-80});
  assert.ok(Math.abs(a.nightAmount-b.nightAmount)<.003);assert.ok(Math.abs(a.intensity-b.intensity)<.02);
 }
});

test('normalized live weather softens/cools sunlight and visibility while unknown weather stays dry and inputs stay unchanged',async()=>{
 const {cityLighting}=await modulePromise,THREE=await threePromise;
 const clear=cityLighting(12),cloud=cityLighting(12,{cloud:1}),rain=cityLighting(12,{cloud:.8,rain:.9}),fog=cityLighting(12,{fog:1}),snow=cityLighting(12,{snow:1});
 assert.equal(clear.wetness,0);assert.deepEqual(cityLighting(12,null),clear);assert.equal(cloud.wetness,0);
 assert.ok(cloud.intensity<clear.intensity);assert.ok(rain.intensity<clear.intensity);assert.ok(fog.intensity<clear.intensity);
 assert.ok(rain.fogDensity>clear.fogDensity);assert.ok(fog.fogDensity>rain.fogDensity);assert.ok(snow.fogDensity>clear.fogDensity);
 assert.equal(rain.wetness,.9);assert.equal(fog.wetness,0);
 const warmRatio=color=>{const c=new THREE.Color(color);return c.r/c.b;};
 assert.ok(warmRatio(rain.color)<warmRatio(clear.color));
 const solar=Object.freeze({kind:'solar',elevation:30,hourAngle:-40}),weather=Object.freeze({cloud:.7,rain:.4,fog:.1,snow:0});
 assert.deepEqual(cityLighting(solar,weather),cityLighting(solar,weather));
 const invalid=cityLighting(12,{cloud:NaN,rain:Infinity,fog:-2,snow:undefined});assert.deepEqual(invalid,clear);
});

test('both city renderers receive identical exposure, hemisphere fill and directional light',async()=>{
 const {applyCityLighting,cityLighting}=await modulePromise,THREE=await threePromise;
 const a=new THREE.HemisphereLight(),b=new THREE.HemisphereLight(),ka=new THREE.DirectionalLight(),kb=new THREE.DirectionalLight(),ga={},gb={};
 const solar={kind:'solar',elevation:8,hourAngle:-70},weather={cloud:.4,rain:.25};
 try{
  const snapshot=applyCityLighting(a,ka,ga,solar,weather),other=applyCityLighting(b,kb,gb,solar,weather);
  assert.deepEqual(snapshot,cityLighting(solar,weather));assert.deepEqual(other,snapshot);
  assert.equal(ga.toneMapping,THREE.ACESFilmicToneMapping);assert.equal(ga.toneMappingExposure,snapshot.exposure);assert.equal(gb.toneMappingExposure,ga.toneMappingExposure);
  assert.equal(a.intensity,snapshot.ambient);assert.equal(a.color.getHexString(),new THREE.Color(snapshot.ambientColor).getHexString());
  assert.equal(a.groundColor.getHexString(),new THREE.Color(snapshot.groundColor).getHexString());
  assert.equal(ka.intensity,snapshot.intensity);assert.deepEqual(ka.position.toArray(),snapshot.position);
  assert.deepEqual(ka.position,kb.position);assert.deepEqual(a.color,b.color);
  assert.deepEqual(applyCityLighting(a,ka,null,12),cityLighting(12));
 }finally{ka.shadow.dispose();kb.shadow.dispose();}
});

test('all five real shop/street lamps and all four halos switch off at noon and recover authored intensities at night',async()=>{
 const {createCityAtmosphere}=await modulePromise,a=createCityAtmosphere({timeOfDay:0}),b=createCityAtmosphere({timeOfDay:12,reflections:false});
 try{
  const lamps=a.group.children.filter(x=>x.isLight),halos=a.group.children.filter(x=>x.isSprite);
  assert.equal(lamps.length,5);assert.equal(halos.length,4);
  const intensities=lamps.map(x=>x.intensity),opacities=halos.map(x=>x.material.opacity);
  assert.ok(intensities.every(x=>x>0));assert.ok(opacities.every(x=>x>0));
  a.update(12,{cloud:1,rain:1,fog:1});
  assert.ok(lamps.every(x=>x.intensity===0));assert.ok(halos.every(x=>x.material.opacity===0&&!x.visible));
  const dawn=a.update(6);
  lamps.forEach((x,i)=>assert.equal(x.intensity,intensities[i]*dawn.nightAmount));
  halos.forEach((x,i)=>assert.equal(x.material.opacity,opacities[i]*dawn.nightAmount));
  a.update(6);lamps.forEach((x,i)=>assert.equal(x.intensity,intensities[i]*dawn.nightAmount,'updates never compound attenuation'));
  a.update(0);assert.deepEqual(lamps.map(x=>x.intensity),intensities);assert.deepEqual(halos.map(x=>x.material.opacity),opacities);assert.ok(halos.every(x=>x.visible));
  assert.ok(b.group.children.filter(x=>x.isLight).every(x=>x.intensity===0),'rig instances are independent');
 }finally{a.dispose();b.dispose();}
});

test('wet road is a dry-by-default planar reflection with independent wetness and actual 256/384/512 target texel uniforms',async()=>{
 const {createCityAtmosphere}=await modulePromise,THREE=await threePromise;
 const rigs=[256,384,512].map(resolution=>createCityAtmosphere({resolution,timeOfDay:0}));
 try{
  for(let i=0;i<rigs.length;i++){
   const rig=rigs[i],mesh=rig.reflection,target=mesh.getRenderTarget(),uniforms=mesh.material.uniforms;
   assert.equal(mesh.isReflector,true,'actual scene/camera planar render, not screen-space reflection');
   assert.equal(target.width,[256,384,512][i]);assert.equal(target.samples,0);
   assert.ok(uniforms.resolution.value instanceof THREE.Vector2);assert.deepEqual(uniforms.resolution.value.toArray(),[target.width,target.height]);
   assert.equal(uniforms.wetness.value,0);assert.equal(mesh.visible,false,'dry means no mirror pass');
   assert.match(mesh.material.fragmentShader,/uniform float wetness/);assert.match(mesh.material.fragmentShader,/uniform vec2 resolution/);
   assert.match(mesh.material.fragmentShader,/texel\s*=\s*1\.0\s*\/\s*resolution/);assert.doesNotMatch(mesh.material.fragmentShader,/1\.0\s*\/\s*512/);
   assert.match(mesh.material.fragmentShader,/gl_FragColor\s*=\s*vec4\(reflection,\s*wetness\*/);
  }
  rigs[0].update(12,{rain:.75});assert.equal(rigs[0].reflection.material.uniforms.wetness.value,.75);assert.equal(rigs[0].reflection.visible,true);
  assert.equal(rigs[1].reflection.material.uniforms.wetness.value,0);assert.equal(rigs[1].reflection.visible,false);
  assert.notEqual(rigs[0].reflection.material.uniforms.resolution.value,rigs[1].reflection.material.uniforms.resolution.value);
  assert.notEqual(rigs[0].reflection.material.uniforms.wetness,rigs[1].reflection.material.uniforms.wetness);
  rigs[0].reflection.getRenderTarget().setSize(300,240);rigs[0].update(12,{rain:.2});
  assert.deepEqual(rigs[0].reflection.material.uniforms.resolution.value.toArray(),[300,240]);
  rigs[0].update(0,null);assert.equal(rigs[0].reflection.visible,false);assert.equal(rigs[0].reflection.material.uniforms.wetness.value,0);
 }finally{for(const rig of rigs)rig.dispose();}
});

test('city-only surface updates remove daytime emissive glow and dry wet fragments without mutating avatar materials or geometry',async()=>{
 const {cityLighting,updateCitySurfaces}=await modulePromise,{createEnvironment,disposeEnvironment}=await import('../src/ui/procedural-scenes.mjs'),THREE=await threePromise;
 const city=createEnvironment('city'),other=createEnvironment('city'),forest=createEnvironment('forest');
 const avatarGeometry=new THREE.BoxGeometry(),avatarMaterial=new THREE.MeshStandardMaterial({color:'#938a88',emissive:'#ff4455',emissiveIntensity:2,roughness:.3}),avatar=new THREE.Mesh(avatarGeometry,avatarMaterial);
 // An avatar under the environment (and an instanced avatar in its own group)
 // must not be mistaken for an authored direct city batch.
 const avatarGroup=new THREE.Group(),instancedAvatar=new THREE.InstancedMesh(avatarGeometry,avatarMaterial,1),directAvatar=new THREE.InstancedMesh(avatarGeometry,avatarMaterial,1);
 instancedAvatar.name=directAvatar.name='city:puddle';instancedAvatar.userData.role=directAvatar.userData.role='puddle';avatarGroup.add(instancedAvatar);city.add(avatar,avatarGroup,directAvatar);
 const avatarBefore=JSON.stringify(avatarMaterial.toJSON()),geometryBefore=Array.from(avatarGeometry.attributes.position.array);
 const meshes=city.children.slice(0,city.userData.stats.drawCalls),originals=new Map(meshes.map(x=>[x,{material:x.material,geometry:x.geometry,emissive:x.material.emissiveIntensity,visible:x.visible}]));
 const roles=['wet-reflection','puddle','puddle-edge','puddle-ripple','wet-asphalt'];
 const cityMaterials=new Set(meshes.map(x=>x.material)),otherBefore=JSON.stringify(other.children.map(x=>x.material.toJSON())),forestBefore=JSON.stringify(forest.children.map(x=>x.material.toJSON()));
 try{
  assert.ok([...cityMaterials].some(x=>x.emissiveIntensity>0));assert.ok(roles.every(role=>meshes.some(x=>x.userData.role===role)));
  const noon=cityLighting(12);assert.equal(updateCitySurfaces(city,noon),noon);
  assert.ok([...cityMaterials].every(x=>x.emissiveIntensity===0),'emissive paint also switches off');
  assert.ok(meshes.filter(x=>roles.includes(x.userData.role)).every(x=>!x.visible));
  const road=meshes.find(x=>x.userData.role==='road');assert.equal(road.material.roughness,.92);
  updateCitySurfaces(city,cityLighting(0,{rain:1}));
  for(const mesh of meshes){const original=originals.get(mesh);assert.equal(mesh.material,original.material);assert.equal(mesh.geometry,original.geometry);assert.equal(mesh.material.emissiveIntensity,original.emissive);if(roles.includes(mesh.userData.role))assert.equal(mesh.visible,original.visible);}
  assert.equal(road.material.roughness,.34);
  updateCitySurfaces(city,cityLighting(12,{rain:1}));
  assert.ok(meshes.filter(x=>x.userData.role==='wet-reflection').every(x=>!x.visible),'painted lamp reflections stay off in daylight even when wet');
  assert.ok(meshes.filter(x=>x.userData.role==='puddle').every(x=>x.visible));
  updateCitySurfaces(city,cityLighting(6,{rain:.5}));updateCitySurfaces(city,cityLighting(6,{rain:.5}));
  const nightAmount=cityLighting(6).nightAmount;
  for(const [mesh,original] of originals)assert.equal(mesh.material.emissiveIntensity,original.emissive*nightAmount);
  updateCitySurfaces(forest,cityLighting(0));updateCitySurfaces(new THREE.Group(),noon);updateCitySurfaces(null,noon);
  assert.equal(JSON.stringify(avatarMaterial.toJSON()),avatarBefore);assert.deepEqual(Array.from(avatarGeometry.attributes.position.array),geometryBefore);assert.equal(avatar.visible,true);assert.equal(instancedAvatar.visible,true);assert.equal(directAvatar.visible,true);
  assert.equal(JSON.stringify(other.children.map(x=>x.material.toJSON())),otherBefore);assert.equal(JSON.stringify(forest.children.map(x=>x.material.toJSON())),forestBefore);
 }finally{avatar.removeFromParent();avatarGroup.removeFromParent();directAvatar.removeFromParent();instancedAvatar.dispose();directAvatar.dispose();avatarGeometry.dispose();avatarMaterial.dispose();disposeEnvironment(city);disposeEnvironment(other);disposeEnvironment(forest);}
});
