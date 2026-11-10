const {test}=require('node:test');
const assert=require('node:assert/strict');

async function fixture(id='school'){
 const T=await import('three'),{finishScene}=await import('../src/scenes/scene-finish.mjs');
 const scene=new T.Scene(),root=new T.Group(),geometry=new T.BoxGeometry(4,.2,4);
 const material=new T.MeshStandardMaterial({color:'#aa9988'});material.name='plaza:paving';
 const mesh=new T.Mesh(geometry,material);mesh.name='forecourt';root.add(mesh);scene.add(root);
 const sun=new T.DirectionalLight('#ffffff',2);sun.position.set(10,15,12);root.add(sun,sun.target);
 const ambient=new T.HemisphereLight('#ddeeff','#777766',1);root.add(ambient);
 const external=new T.Texture();scene.environment=external;scene.background=new T.Color('#abcabc');
 const background=scene.background;let releases=0;
 const renderer={toneMappingExposure:.9,shadowMap:{}};
 const api=finishScene({root,lightingPresets:['day','night'],setLighting(id){scene.background.set(id==='night'?'#152333':'#abcabc');sun.intensity=id==='night'?.3:2;ambient.intensity=id==='night'?.4:1;renderer.toneMappingExposure=.9;return id;},dispose(){releases++;geometry.dispose();material.dispose();root.removeFromParent();}}, {scene,renderer,id});
 return {T,scene,root,material,mesh,sun,ambient,api,renderer,external,background,get releases(){return releases}};
}

test('real climate changes surface wetness and solar direction continuously within the same preset',async()=>{
 const f=await fixture();
 f.api.setLighting('day');
 f.api.setClimate({timeOfDay:{kind:'solar',elevation:35,hourAngle:-35},weather:null});
 const morning=f.sun.position.clone(),dryIntensity=f.sun.intensity,geometry=f.mesh.geometry;
 f.api.setClimate({timeOfDay:{kind:'solar',elevation:35,hourAngle:35},weather:{cloud:1,rain:.8}});
 assert.notDeepEqual(f.sun.position.toArray(),morning.toArray());
 assert.ok(f.sun.intensity<dryIntensity*.5);
 assert.equal(f.material.userData.surfaceUniforms.uSurfaceRain.value,.8);
 assert.equal(f.mesh.geometry,geometry,'climate does not replace geometry');
 const intensity=f.sun.intensity;
 f.api.setClimate({timeOfDay:{kind:'solar',elevation:35,hourAngle:35},weather:{cloud:1,rain:.8}});
 assert.equal(f.sun.intensity,intensity,'repeated weather cannot compound light multipliers');
 f.api.setClimate({timeOfDay:14,weather:null});
 assert.equal(f.material.userData.surfaceUniforms.uSurfaceRain.value,0);
 assert.equal(f.scene.fog,null);assert.equal(f.scene.background.name,'weather:day-sky-clouds');assert.equal(f.background.getHexString(),'abcabc','native background remains available for reset');
 f.api.dispose();f.external.dispose();
});

test('interior floors stay dry and unknown weather clears the wetness input',async()=>{
 const f=await fixture('classroom');
 f.mesh.name='classroom:floor'; // Material is already classified from indoor scene ownership.
 f.api.setClimate({timeOfDay:14,weather:{rain:1,snow:1}});
 assert.equal(f.material.userData.surfaceUniforms.uSurfaceExposure.value,0);
 f.api.setClimate({timeOfDay:14,weather:null});
 assert.equal(f.material.userData.surfaceUniforms.uSurfaceSnow.value,0);
 f.api.dispose();f.external.dispose();
});

test('overcast-to-night restores native Color backgrounds before the supplied factory mutates them',async()=>{
 const f=await fixture('classroom');
 f.api.setClimate({timeOfDay:14,weather:{cloud:1,rain:.8}});
 assert.ok(f.scene.background.isTexture);
 assert.equal(f.api.setLighting('night'),'night');
 f.api.setClimate({timeOfDay:23,weather:null});
 assert.equal(f.scene.background,f.background);assert.equal(f.scene.background.getHexString(),'152333');
 f.api.dispose();f.external.dispose();
});

test('material refinement owns its environment once and restores the latest native scene resources',async()=>{
 const f=await fixture();
 let foreignDisposed=0;f.external.addEventListener('dispose',()=>foreignDisposed++);
 f.api.setClimate({timeOfDay:14,weather:{cloud:1}});
 const environment=f.scene.environment;let disposed=0;environment.addEventListener('dispose',()=>disposed++);
 f.api.dispose();f.api.dispose();
 assert.equal(disposed,1);assert.equal(f.releases,1);assert.equal(foreignDisposed,0);
 assert.equal(f.scene.environment,f.external);assert.equal(f.scene.background,f.background);
 const position=f.sun.position.clone();f.api.setClimate({timeOfDay:8,weather:{rain:1}});
 assert.deepEqual(f.sun.position.toArray(),position.toArray());f.external.dispose();
});

test('day sky remains weather aware and its texture is disposed on scene exit',async()=>{
 const f=await fixture('inage');
 f.api.setClimate({timeOfDay:14,weather:null});
 const daySky=f.scene.background,clear=daySky.image.data.slice();
 assert.equal(daySky.name,'weather:day-sky-clouds');
 f.api.setClimate({timeOfDay:14,weather:{cloud:.85,rain:.65}});
 assert.equal(f.scene.background,daySky);assert.notDeepEqual(daySky.image.data,clear);
 f.api.setClimate({timeOfDay:23,weather:null});assert.notEqual(f.scene.background,daySky);
 f.api.setClimate({timeOfDay:14,weather:null});assert.equal(f.scene.background,daySky);
 assert.deepEqual(daySky.image.data,clear,'returning to clear day restores the same sky');
 let disposed=0;daySky.addEventListener('dispose',()=>disposed++);
 f.api.dispose();f.api.dispose();assert.equal(disposed,1);assert.equal(f.scene.background,f.background);f.external.dispose();
});

test('toon upgrade retains wind hooks, source animation colours and texture ownership',async()=>{
 const T=await import('three'),{upgradeSurfaces}=await import('../src/scenes/surface-materials.mjs');
 const root=new T.Group(),map=new T.Texture(),source=new T.MeshToonMaterial({map,color:'#7c6952'});
 source.name='forest:bark';let calls=0;source.onBeforeCompile=()=>calls++;
 const mesh=new T.Mesh(new T.BoxGeometry(),source);root.add(mesh);
 const surfaces=upgradeSurfaces(root,'forest');assert.equal(mesh.material.isMeshStandardMaterial,true);
 assert.equal(mesh.material.map,map);
 const shader={uniforms:{},vertexShader:'#include <common>\n#include <project_vertex>',fragmentShader:'#include <common>\n#include <roughnessmap_fragment>\n#include <normal_fragment_maps>'};
 mesh.material.onBeforeCompile(shader,{});assert.equal(calls,1);
 source.color.set('#6d7349');surfaces.sync();assert.equal(mesh.material.color.getHexString(),'6d7349');
 let disposed=0;map.addEventListener('dispose',()=>disposed++);surfaces.dispose();assert.equal(disposed,0);
 source.dispose();map.dispose();mesh.geometry.dispose();
});

test('disposal does not overwrite scene state installed by a later owner',async()=>{
 const f=await fixture();f.api.setClimate({timeOfDay:14,weather:{rain:1,cloud:1}});
 const environment=new f.T.Texture(),background=new f.T.Color('#224466'),fog=new f.T.Fog('#556677',5,50);
 f.scene.environment=environment;f.scene.background=background;f.scene.fog=fog;f.scene.environmentIntensity=.321;
 f.api.dispose();assert.equal(f.scene.environment,environment);assert.equal(f.scene.background,background);assert.equal(f.scene.fog,fog);assert.equal(f.scene.environmentIntensity,.321);
 environment.dispose();f.external.dispose();
});

test('forest night removes authored sun sprites even when native animation rewrites opacity',async()=>{
 const T=await import('three'),{finishScene}=await import('../src/scenes/scene-finish.mjs');
 const scene=new T.Scene(),root=new T.Group(),material=new T.SpriteMaterial({transparent:true,opacity:.6,blending:T.AdditiveBlending});
 const shaft=new T.Sprite(material);shaft.name='Soft_Light_Shaft';root.add(shaft);scene.add(root);scene.background=new T.Color('#bfae9e');
 const api=finishScene({root,update(){material.opacity=.6;},dispose(){}},{scene,renderer:{toneMappingExposure:1,shadowMap:{}},id:'forest'});
 api.setClimate({timeOfDay:23,weather:null});api.update(1);api.update(2);
 assert.equal(material.opacity,0);assert.ok(scene.background.isTexture);
 api.setClimate({timeOfDay:14,weather:null});api.update(3);const lit=material.opacity;
 assert.ok(lit>0);api.update(4);assert.equal(material.opacity,lit,'attenuation must not compound');
 api.dispose();material.dispose();
});

test('coated metal keeps dielectric optics while exposed fasteners remain metallic',async()=>{
 const T=await import('three'),{upgradeSurfaces}=await import('../src/scenes/surface-materials.mjs');
 const root=new T.Group(),geometry=new T.BoxGeometry(),coating=new T.MeshStandardMaterial(),bolt=new T.MeshStandardMaterial({metalness:.82});
 coating.name='paint:blue-steel';coating.userData.surfaceFinish={roughness:.71,metalness:0,envMapIntensity:.32};
 bolt.name='metal:galvanized-bolts';
 root.add(new T.Mesh(geometry,coating),new T.Mesh(geometry,bolt));
 const surfaces=upgradeSurfaces(root,'inage');
 assert.equal(coating.userData.surfaceProfile,'paint');assert.equal(coating.metalness,0);assert.equal(coating.roughness,.71);assert.equal(coating.envMapIntensity,.32);
 assert.equal(bolt.userData.surfaceProfile,'metal');assert.ok(bolt.metalness>.7);
 surfaces.setWeather({rain:.8});surfaces.sync();surfaces.setWeather(null);surfaces.sync();
 assert.equal(coating.userData.surfaceUniforms.uSurfaceRain.value,0);assert.equal(coating.roughness,.71);assert.equal(coating.envMapIntensity,.32);
 surfaces.dispose();geometry.dispose();coating.dispose();bolt.dispose();
});

test('authored storefront glass response survives weather resets and repeated synchronization',async()=>{
 const T=await import('three'),{upgradeSurfaces}=await import('../src/scenes/surface-materials.mjs');
 const root=new T.Group(),geometry=new T.PlaneGeometry(),glass=new T.MeshStandardMaterial({opacity:.24,transparent:true});glass.name='glass:shop-front';
 glass.userData.surfaceFinish={roughness:.22,metalness:0,envMapIntensity:.45};root.add(new T.Mesh(geometry,glass));
 const surfaces=upgradeSurfaces(root,'city');
 for(const weather of [{rain:1,cloud:1},null,{snow:.5},null]){surfaces.setWeather(weather);surfaces.sync();assert.equal(glass.roughness,.22);assert.equal(glass.envMapIntensity,.45);assert.equal(glass.opacity,.24);assert.equal(glass.metalness,0);}
 assert.equal(glass.userData.surfaceUniforms.uSurfaceSnow.value,0);surfaces.dispose();geometry.dispose();glass.dispose();
});

test('clear-day lighting keeps a stronger direct-to-fill ratio without accumulating or crushing night',async()=>{
 const f=await fixture();f.api.setLighting('day');
 const day={timeOfDay:14,weather:null};f.api.setClimate(day);
 const ratio=f.sun.intensity/f.ambient.intensity,dayFill=f.ambient.intensity;
 assert.ok(ratio>2.5,'cast shadows remain visible with brighter outdoor fill');
 assert.equal(f.renderer.toneMapping,f.T.NeutralToneMapping,'pigment colour uses Neutral output');
 for(let i=0;i<3;i++){f.api.setClimate({timeOfDay:14,weather:{cloud:1}});assert.ok(f.ambient.intensity>dayFill);f.api.setClimate(day);assert.equal(f.sun.intensity/f.ambient.intensity,ratio);}
 f.api.setLighting('night');f.api.setClimate({timeOfDay:23,weather:null});
 assert.ok(Math.abs(f.ambient.intensity-.4*.77*.42)<1e-8,'night retains its authored practical-light fill');
 f.renderer.toneMapping=f.T.AgXToneMapping;f.api.dispose();assert.equal(f.renderer.toneMapping,f.T.AgXToneMapping,'later renderer owner survives disposal');f.external.dispose();
});

test('clear-air fog is isolated from the authored weather and resets without density drift',async()=>{
 const T=await import('three'),{finishScene}=await import('../src/scenes/scene-finish.mjs');
 const scene=new T.Scene(),root=new T.Group(),native=new T.FogExp2('#aabcce',.008);
 scene.fog=native;scene.background=new T.Color('#b9cad9');
 const api=finishScene({root,setLighting(){scene.fog=native},dispose(){}},{scene,renderer:{shadowMap:{},toneMapping:T.ACESFilmicToneMapping},id:'inage'});
 for(let i=0;i<3;i++){
  api.setLighting('day');api.setClimate({timeOfDay:14,weather:null});assert.notEqual(scene.fog,native);assert.equal(scene.fog.density,.004);assert.equal(native.density,.008);
  api.setClimate({timeOfDay:14,weather:{fog:.8,rain:.4}});assert.ok(scene.fog.density>.004);
 }
 api.dispose();assert.equal(scene.fog,native);
});

test('all outdoor scenes share a weather-aware moon outside framing and dispose its resources once',async()=>{
 for(const id of ['inage','sakura','school','kyoto','city','bookshop','forest','wedding','kasai']){
  const f=await fixture(id),moon=f.api.nightSky.moon;
  assert.equal(moon.parent,f.scene);assert.equal(f.root.getObjectByName(moon.name),undefined,'sky does not inflate architecture bounds');
  f.api.setClimate({timeOfDay:14,weather:null});assert.equal(moon.visible,false);
  f.api.setClimate({timeOfDay:23,weather:null});assert.equal(moon.visible,true);
  f.api.setClimate({timeOfDay:23,weather:{cloud:1,rain:1}});assert.equal(moon.visible,false);
  f.api.setClimate({timeOfDay:23,weather:null});assert.equal(moon.visible,true);
  let g=0,m=0;moon.geometry.addEventListener('dispose',()=>g++);moon.material.addEventListener('dispose',()=>m++);
  f.api.dispose();f.api.dispose();assert.equal(g,1);assert.equal(m,1);assert.equal(moon.parent,null);f.external.dispose();
 }
 const indoor=await fixture('classroom');assert.equal(indoor.api.nightSky,null);indoor.api.dispose();indoor.external.dispose();
});

test('site orientation rotates the real sun and the water optics input together',async()=>{
 const f=await fixture('sakura');let opticsDirection;
 f.api.setSunlight=direction=>opticsDirection=direction.clone().normalize();
 f.api.setClimate({timeOfDay:14,weather:null});const before=opticsDirection.clone();
 f.api.sunAzimuthOffset=110;f.api.setClimate({timeOfDay:14,weather:null});
 const expected=before.applyAxisAngle(new f.T.Vector3(0,1,0),f.T.MathUtils.degToRad(110));
 assert.ok(opticsDirection.distanceTo(expected)<1e-8);
 assert.ok(f.sun.position.clone().sub(f.sun.target.position).normalize().distanceTo(opticsDirection)<1e-8);
 f.api.dispose();f.external.dispose();
});
