import * as THREE from 'three';
import {upgradeSurfaces} from './surface-materials.mjs';
import {refineArchitecture} from './architectural-details.mjs';
import {sceneDaylight} from '../ui/scene-daylight.mjs';
import {addNightSky} from './night-sky.mjs';
import {architectureFinish} from './architecture-textures.mjs';
import {createDaySky} from './day-sky.mjs';
import {sceneSun} from '../ui/scene-sun.mjs';

const clamp=THREE.MathUtils.clamp;

export function finishScene(api,{scene,renderer,id}){
 const groundTextures=new Set(),groundOwner={textures:groundTextures},groundMaterials=new Set();
 api.root.traverse(o=>{for(const m of [o.material].flat().filter(Boolean)){
  if(!m.isMeshStandardMaterial||groundMaterials.has(m))continue;
  if(/^(soil:verge|soil:woodland-ground|soil:stream-bank|verge:grass|grass|leaf:campus-lawn|garden:lawn|garden:lawn-large|lawn)$/.test(m.name)){
   architectureFinish(groundOwner,m,'grass',{scale:2,amount:id==='kasai'?.24:m.name==='soil:stream-bank'?.58:.72});groundMaterials.add(m);
  }
 }});
 const details=refineArchitecture(api.root,id),surfaces=upgradeSurfaces(api.root,id);
 const original={setLighting:api.setLighting,update:api.update,dispose:api.dispose,setWeather:api.setWeather};
 const outdoor=id!=='classroom',lights=[],effects=[],skies=[],waters=[],winds=[],rainObjects=[],puddles=[];
 const nightSky=outdoor?addNightSky(api,scene):null;api.nightSky=nightSky;
 // The classroom retains its native lit backdrop; its windows can also show
 // the painted panorama. Textures are allocated on the first weather update.
 const daySky=createDaySky();
 // The older sakura illustration encloses the entire scene; hide that sky
 // mesh so the shared weather sky can be seen without changing scene bounds.
 const authoredSky=outdoor?api.root.getObjectByName('sakura-stream:sky'):null;
 const authoredSkyVisible=authoredSky?.visible;if(authoredSky)authoredSky.visible=false;
 let disposed=false,climate=null,renderStyle='lit',baseExposure=renderer?.toneMappingExposure||1;
 let sourceEnvironment=scene.environment,sourceIntensity=scene.environmentIntensity,sourceBackground=scene.background;
 let sourceFog=scene.fog;
 const clearFog=sourceFog?.isFogExp2?sourceFog.clone():null;
 const sourceToneMapping=renderer?.toneMapping;
 const originalBackgroundIntensity=scene.backgroundIntensity;
 const clearSky=sourceBackground?.isColor?new THREE.Color():null;
 let ownedIntensity=scene.environmentIntensity;
 const weatherFog=new THREE.FogExp2('#a8b4be',0);
 api.root.traverse(o=>{
  if(o.name.startsWith('weather:rain-'))rainObjects.push(o);
  if(o.isLight)lights.push({node:o,intensity:o.intensity,color:o.color.clone(),groundColor:o.groundColor?.clone(),position:o.position.clone()});
  if(o.material?.transparent&&(o.material.blending===THREE.AdditiveBlending||(id==='forest'&&o.name==='Backlit_Mist'))&&!effects.some(e=>e.node.material===o.material))effects.push({node:o,opacity:o.material.opacity});
  for(const material of [o.material].flat().filter(Boolean)){
   const u=material.uniforms;
   if(u?.topColor&&u?.midColor&&u?.lowColor)skies.push(u);
   if(o.isReflector&&u?.tPuddle){
    u.uLiveWetness={value:0};u.uLiveDaylight={value:1};
    material.fragmentShader='uniform float uLiveWetness;\nuniform float uLiveDaylight;\n'+material.fragmentShader
     .replace('float wet = clamp(0.18 + puddle * 0.82 + coarse * 0.08, 0.0, 1.0);','float wet = clamp(0.18 + puddle * 0.82 + coarse * 0.08, 0.0, 1.0)*uLiveWetness;')
     .replace('float reflectionStrength = mix(0.14, 0.95, puddle) * (0.55 + wet * 0.45);','float reflectionStrength = mix(0.14, 0.82, puddle) * wet;')
     .replace('vec3 col = base + reflection * reflectionStrength;','vec3 col = base * uLiveDaylight + reflection * reflectionStrength;');
    const reflect=o.onBeforeRender;
    o.onBeforeRender=function(...args){if(u.uLiveWetness.value>.005)reflect.apply(this,args);};
    material.needsUpdate=true;puddles.push(u);
   }
   if(material.userData.windUniforms&&!winds.some(w=>w.u===material.userData.windUniforms))winds.push({u:material.userData.windUniforms,strength:material.userData.windUniforms.uWindStrength.value});
  }
 });
 const directional=lights.filter(l=>l.node.isDirectionalLight).sort((a,b)=>b.intensity-a.intensity);
 // Prefer the authored shadow key, then the strongest directional. The selected
 // light is made the only shadow caster for outdoor scenes below, so a bright
 // fill or a practical point light can never steal the projection.
 const key=directional.find(l=>l.node.castShadow)||directional[0];
 const bounds=api.bounds||new THREE.Box3().setFromObject(api.framingRoot||api.root);
 const size=bounds.getSize(new THREE.Vector3()).length();
 const companion=api.cameraPresets?.companion;
 const shadowCenter=companion?.target?new THREE.Vector3(...companion.target):bounds.getCenter(new THREE.Vector3());
 const viewDistance=companion?.position?shadowCenter.distanceTo(new THREE.Vector3(...companion.position)):size*.4;
 // The shadow camera follows the companion framing, not the full display slab:
 // the visible architecture and ground get the texel budget. Distant mountains
 // and the 720 m street extension stay outside the finite shadow frustum.
 const shadowRadius=outdoor?clamp(viewDistance*1.15,24,82):clamp(viewDistance*.8,7.5,11);
 const shadowDistance=Math.max(shadowRadius*2.2,32);
 if(key){
  key.node.castShadow=true;
  if(key.node.target&&!key.node.target.parent)api.root.add(key.node.target);
  for(const light of directional)if(light!==key)light.node.castShadow=false;
  const shadow=key.node.shadow;
  if(shadow){
   shadow.mapSize.set(2048,2048);
   shadow.camera.left=-shadowRadius;shadow.camera.right=shadowRadius;
   shadow.camera.top=shadowRadius*.82;shadow.camera.bottom=-shadowRadius*.82;
   shadow.camera.near=1;shadow.camera.far=shadowDistance+shadowRadius*1.8;
   shadow.normalBias=outdoor?clamp(shadowRadius*.0006,.018,.05):.005;
   shadow.bias=-.00018;
   shadow.camera.updateProjectionMatrix();shadow.needsUpdate=true;
  }
 }
 // Sky domes and untextured glass should never write a black sheet into the
 // shadow map. Textured foliage uses alphaTest and intentionally keeps casting.
 api.root.traverse(o=>{
  if(!o.isMesh)return;
  const materials=[o.material].flat().filter(Boolean);
  if(!materials.length)return;
  if(/sky|dome|backdrop|cloud/i.test(o.name)||materials.every(m=>m.transparent===true&&!(m.alphaTest>0)))o.castShadow=false;
 });
 const envData=new Uint8Array(64*32*4);
 const makeEnvironment=()=>{
  const next=new THREE.DataTexture(envData.slice(),64,32);
  next.mapping=THREE.EquirectangularReflectionMapping;next.colorSpace=THREE.SRGBColorSpace;
  next.minFilter=next.magFilter=THREE.LinearFilter;next.name='live-weather-reflection';
  next.needsUpdate=true;
  return next;
 };
 let environment=makeEnvironment();
 const ownsEnvironment=value=>value===environment||daySky.owns(value);
 const ownsBackground=value=>value===clearSky||ownsEnvironment(value);
 let environmentKey='';
 function attenuateEffects(){
  if(!climate)return;
  const daylight=sceneDaylight(climate.timeOfDay),cloud=clamp(climate.weather?.cloud||0,0,1);
  for(const e of effects)e.node.material.opacity=e.opacity*(1-cloud*.85)*(id==='forest'?(daylight.night?0:daylight.brightness):(daylight.night?.2:1))*.5;
 }
 function updateEnvironment(daylight,weather){
  const cloud=clamp(weather?.cloud||0,0,1),rain=clamp(weather?.rain||0,0,1),fog=clamp(weather?.fog||0,0,1),snow=clamp(weather?.snow||0,0,1),night=1-daylight.brightness;
  const fingerprint=[Math.round(daylight.brightness*20),Math.round(cloud*10),Math.round(rain*10),Math.round(fog*10),Math.round(snow*10),daylight.twilight,daylight.hour<12].join(':');
  if(fingerprint===environmentKey){scene.environment=environment;return;}environmentKey=fingerprint;
  // The visible sky may be saturated blue, but its light-probe version stays
  // close to neutral so walls and ground keep their authored pigment instead
  // of turning blue with the backdrop.
  const sky=new THREE.Color(daylight.sun.skyColor).lerp(new THREE.Color('#9dc3dc'),daylight.twilight?.12:.32).lerp(new THREE.Color('#a1acb4'),cloud*.7).multiplyScalar(1-night*.8);
  const horizon=new THREE.Color(daylight.twilight&&!daylight.night?'#f0d1b2':'#d0e0e9').lerp(new THREE.Color('#abb4bb'),cloud).lerp(new THREE.Color('#bcc7d0'),fog*.5).multiplyScalar((1-night*.84)*(1-rain*.08+snow*.05));
  const ground=new THREE.Color('#777a70').lerp(new THREE.Color('#c6ced4'),snow*.55).multiplyScalar(1-night*.8),c=new THREE.Color();
  for(let y=0;y<32;y++)for(let x=0;x<64;x++){
   const t=y/31;if(t<.5)c.copy(ground).lerp(horizon,Math.pow(t*2,3));else c.copy(horizon).lerp(sky,Math.pow((t-.5)*2,.5));
   const haze=(Math.sin(x*.44+y*.23)*Math.sin(x*.21-y*.7))*.018*(1-cloud);
   c.offsetHSL(0,0,haze).convertLinearToSRGB();const k=(y*64+x)*4;
   envData[k]=Math.round(clamp(c.r,0,1)*255);envData[k+1]=Math.round(clamp(c.g,0,1)*255);envData[k+2]=Math.round(clamp(c.b,0,1)*255);envData[k+3]=255;
  }
  // A fresh identity is required for the same reason as the sky: three caches
  // the PMREM conversion of an equirectangular environment by texture object.
  const previous=environment;environment=makeEnvironment();previous.dispose();
  scene.environment=environment;
 }
 function remember(){
  baseExposure=renderer?.toneMappingExposure||1;
  if(!ownsEnvironment(scene.environment))sourceEnvironment=scene.environment;
  sourceIntensity=scene.environmentIntensity;
  if(!ownsBackground(scene.background))sourceBackground=scene.background;
  if(scene.fog!==weatherFog&&scene.fog!==clearFog)sourceFog=scene.fog;
  for(const l of lights){l.intensity=l.node.intensity;l.color.copy(l.node.color);l.groundColor?.copy(l.node.groundColor);l.position.copy(l.node.position);}
  for(const effect of effects)effect.opacity=effect.node.material.opacity;
  for(const water of waters)water.sky.copy(water.u.uSky.value);
 }
 function applyClimate(){
  if(!climate||disposed)return;
  const daylight=sceneDaylight(climate.timeOfDay),weather=climate.weather;
  const cloud=clamp(weather?.cloud||0,0,1),rain=clamp(weather?.rain||0,0,1),fog=clamp(weather?.fog||0,0,1),snow=clamp(weather?.snow||0,0,1);
  const brightness=daylight.brightness;
  const painted=renderStyle==='toon';
  const sun=sceneSun({timeOfDay:climate.timeOfDay,weather,baseIntensity:key?.intensity??1,outdoor,azimuthOffset:api.sunAzimuthOffset});
  nightSky?.setClimate(daylight,weather);
  let sunDirection=null,keyIntensity=0;
  for(const l of lights){
   const node=l.node;
   if(l===key){
    node.color.set(sun.color);
    if(painted)node.color.lerp(new THREE.Color('#ffdfab'),brightness*(1-cloud)*.16);
    // One beam, attenuated by weather. Clear days keep a deliberate gap over
    // the sky fill; overcast and rain broaden the fill instead of painting the
    // beam out with exposure.
    node.intensity=sun.intensity*(api.lightResponse?.sun??1);
    keyIntensity=node.intensity;
    const direction=new THREE.Vector3(...sun.direction);
    node.position.copy(shadowCenter).addScaledVector(direction,shadowDistance);
    if(node.target){
     node.target.position.copy(shadowCenter);
     node.target.updateMatrixWorld(true);
    }
    node.shadow.needsUpdate=true;
    sunDirection=direction;
   }else if(node.isHemisphereLight||node.isAmbientLight){
    // Keep sunlight and cast shadows legible. Overcast, fog and snow lift the
    // fill while cloud also cools and desaturates it; night retains its
    // authored practical-light balance rather than crushing the blacks.
    node.intensity=l.intensity*sun.fillScale*(api.lightResponse?.ambient??1);
    node.color.copy(l.color).lerp(new THREE.Color('#c4d0da'),cloud*.55).lerp(new THREE.Color('#dbe5ec'),fog*.35).lerp(new THREE.Color('#dfe9f2'),snow*.25);
    if(l.groundColor)node.groundColor.copy(l.groundColor);
    if(painted){
     node.color.lerp(new THREE.Color('#c5d3ec'),.21);
     node.groundColor?.lerp(new THREE.Color('#9ca4bf'),.23*brightness);
    }
   }else if(node.isDirectionalLight){node.intensity=l.intensity*(.18+.82*brightness)*.7*(1-cloud*.25)*(1-rain*.1);}
  }
  attenuateEffects();
  for(const u of skies){
   u.topColor.value.set(daylight.sun.skyColor).lerp(new THREE.Color('#66afe9'),daylight.twilight?.12:.48).lerp(new THREE.Color('#9ba8b2'),cloud*.85).multiplyScalar(.2+.8*brightness);
   u.midColor.value.set(daylight.sun.skyColor).lerp(new THREE.Color('#b2d7e9'),.4).lerp(new THREE.Color('#b7bfc1'),cloud*.6).multiplyScalar(.2+.8*brightness);
   u.lowColor.value.set(daylight.twilight&&!daylight.night?'#e0ba9e':'#c4dce7').lerp(new THREE.Color('#bcc7d0'),fog*.4).multiplyScalar((.18+.82*brightness)*(1-rain*.08));
  }
  for(const water of waters){
   if(key)water.u.uLiveSunDirection.value.copy(key.node.position).sub(key.node.target.position).normalize();
   water.u.uLiveSunStrength.value=(.04+.96*brightness)*(1-cloud*.85)*(1-rain*.1);
   water.u.uLiveRain.value=rain;
   water.u.uSky.value.copy(water.sky).lerp(new THREE.Color('#96a5ae'),cloud*.5).lerp(new THREE.Color('#b9c4cd'),fog*.4).multiplyScalar(.22+.78*brightness);
  }
  for(const wind of winds)wind.u.uWindStrength.value=wind.strength*(weather?.wind===undefined?1:.35+clamp(weather.wind,0,1)*2);
  // A short, slowly recurring interval models a break in passing cloud. Only
  // sites with an authored canopy aperture render shafts; no rays pass through
  // unrelated solid structures or wash out a night/rain scene.
  const rayPhase=((daylight.hour*60+7)%37)/37;
  const rayWindow=Math.max(0,1-Math.abs(rayPhase-.5)/.19);
  if(key)api.setSunlight?.(key.node.position.clone().sub(key.node.target.position),brightness,cloud,id==='forest'?1:rayWindow,weather);
  api.setWind?.(weather?.wind);
  for(const o of rainObjects){o.visible=rain>.01;if(o.isLineSegments)o.geometry.setDrawRange(0,Math.floor(o.geometry.attributes.position.count/2*rain)*2);}
  for(const u of puddles){u.uLiveWetness.value=rain;u.uLiveDaylight.value=.18+.82*brightness;}
  // Weather affects exterior receivers; room surfaces remain dry.
  surfaces.setWeather(weather,sun.brightness*sun.direction[1]);surfaces.sync();
  scene.environmentIntensity=sun.environmentScale*(api.lightResponse?.environment??1);ownedIntensity=scene.environmentIntensity;
  if(clearSky&&outdoor)clearSky.set(daylight.sun.skyColor).lerp(new THREE.Color('#79b9e9'),brightness*.55*(1-cloud));
  if((outdoor&&!daylight.night)||painted){
   daySky.update(daylight,weather,sunDirection,renderStyle);
   scene.background=scene.environment=daySky.texture;
  }else{
   updateEnvironment(daylight,weather);
   scene.background=cloud>.35||(outdoor&&daylight.night)?environment:sourceBackground;
  }
  scene.backgroundIntensity=daylight.night?(painted?.82:.18):((1.07-cloud*.34)*(1-rain*.08)*(1-fog*.06)+snow*.02);
  api.setVisibleSky?.(scene.background,scene.backgroundIntensity,{sun,weather,renderStyle});
  if(fog||rain||snow||(outdoor&&daylight.night)){
   weatherFog.color.set(daylight.sun.skyColor).lerp(new THREE.Color('#a8b4be'),.6).lerp(new THREE.Color('#d7dfe5'),snow*.35).multiplyScalar(daylight.night?.12:1);
   weatherFog.density=daylight.night?(sourceFog?.density||0):(fog*.8+rain*.12+snow*.05)/Math.max(size,1);
   scene.fog=weatherFog;
  }
  else if(outdoor&&clearFog&&sourceFog?.isFogExp2){clearFog.color.copy(sourceFog.color);clearFog.density=sourceFog.density*.5;scene.fog=clearFog;}
  else scene.fog=sourceFog;
  // Neutral preserves the authored pigment saturation while compressing bright
  // highlights. This applies to the 3D renderer, including water and sky shaders.
  if(renderer){
   renderer.toneMapping=THREE.NeutralToneMapping;
   const weatherExposure=daylight.night?1:(1-cloud*.035-rain*.055- fog*.03+snow*.05+(daylight.twilight?.035:0));
   renderer.toneMappingExposure=baseExposure*weatherExposure;
   renderer.shadowMap.needsUpdate=true;
  }
  api.sunState={
   ...sun,
   id,color:key?'#'+key.node.color.getHexString():sun.color,
   direction:sun.direction.slice(),
   intensity:keyIntensity,
   keyBase:key?.intensity??0,
   timeOfDay:climate.timeOfDay,
  };
  api.root.userData.liveSurfaceClimate={rain,cloud,fog,snow,brightness,hour:daylight.hour};
 }
 api.setLighting=id=>{
  if(disposed)return false;
  // Some supplied indoor factories mutate a Color background in place. Return
  // their own object before invoking them after an overcast texture override.
  if(ownsBackground(scene.background))scene.background=sourceBackground;
  if(ownsEnvironment(scene.environment))scene.environment=sourceEnvironment;
  if(scene.fog===weatherFog||scene.fog===clearFog)scene.fog=sourceFog;
  scene.environmentIntensity=sourceIntensity;
  for(const l of lights){
   l.node.intensity=l.intensity;l.node.color.copy(l.color);l.node.position.copy(l.position);
   if(l.groundColor)l.node.groundColor.copy(l.groundColor);
  }
  for(const e of effects)e.node.material.opacity=e.opacity;
  const result=original.setLighting?.(id);surfaces.sync();remember();
  // Host calls setClimate after a preset; continuous updates don't select a
  // fixed photo mood and don't touch geometry, anchors, or camera state.
  return result;
 };
 api.setClimate=value=>{climate=value;applyClimate();};
 const setAuthoredStyle=api.setRenderStyle;
 api.setRenderStyle=value=>{
  const next=value==='toon'?'toon':'lit';
  if(disposed||next===renderStyle)return;
  renderStyle=next;
  setAuthoredStyle?.(next);
  api.streamWater?.setRenderStyle?.(next);
  applyClimate();
 };
 api.setWeather=value=>{original.setWeather?.(value);if(climate){climate={...climate,weather:value};applyClimate();}};
 api.update=(...args)=>{
  if(disposed)return;
  for(const e of effects)e.node.material.opacity=e.opacity;
  original.update?.(...args);
  for(const e of effects)e.opacity=e.node.material.opacity;
  attenuateEffects();surfaces.sync();
 };
 api.surfaceRefinement={materials:surfaces.count,version:1};
 api.dispose=()=>{
  if(disposed)return;disposed=true;
  // Detach additions before the source factory traverses its owned resources.
  details.dispose();surfaces.dispose();nightSky?.dispose();for(const texture of groundTextures)texture.dispose();groundTextures.clear();
  if(ownsEnvironment(scene.environment))scene.environment=sourceEnvironment;
  if(ownsBackground(scene.background)){scene.background=sourceBackground;scene.backgroundIntensity=originalBackgroundIntensity;}
  if(scene.environmentIntensity===ownedIntensity)scene.environmentIntensity=sourceIntensity;
  if(scene.fog===weatherFog||scene.fog===clearFog||scene.fog===sourceFog)scene.fog=sourceFog;
  if(renderer?.toneMapping===THREE.NeutralToneMapping)renderer.toneMapping=sourceToneMapping;
  if(authoredSky)authoredSky.visible=authoredSkyVisible;
  daySky.dispose();environment.dispose();original.dispose?.();
 };
 return api;
}
