import * as THREE from 'three';
import {upgradeSurfaces} from './surface-materials.mjs';
import {refineArchitecture} from './architectural-details.mjs';
import {sceneDaylight} from '../ui/scene-daylight.mjs';
import {addNightSky} from './night-sky.mjs';
import {architectureFinish} from './architecture-textures.mjs';
import {createDaySky} from './day-sky.mjs';

const clamp=THREE.MathUtils.clamp;

export function finishScene(api,{scene,renderer,id}){
 const groundTextures=new Set(),groundOwner={textures:groundTextures},groundMaterials=new Set();
 api.root.traverse(o=>{for(const m of [o.material].flat().filter(Boolean)){
  if(!m.isMeshStandardMaterial||groundMaterials.has(m))continue;
  if(/^(soil:verge|soil:woodland-ground|soil:stream-bank|verge:grass|grass|leaf:campus-lawn|garden:lawn|garden:lawn-large|lawn)$/.test(m.name)){
   architectureFinish(groundOwner,m,'grass',{scale:2,amount:m.name==='soil:stream-bank'?.58:.72});groundMaterials.add(m);
  }
 }});
 const details=refineArchitecture(api.root,id),surfaces=upgradeSurfaces(api.root,id);
 const original={setLighting:api.setLighting,update:api.update,dispose:api.dispose,setWeather:api.setWeather};
 const outdoor=id!=='classroom',lights=[],effects=[],skies=[],waters=[],winds=[],rainObjects=[],puddles=[];
 const nightSky=outdoor?addNightSky(api,scene):null;api.nightSky=nightSky;
 const daySky=outdoor?createDaySky():null;
 // The older sakura illustration encloses the entire scene; hide that sky
 // mesh so the shared weather sky can be seen without changing scene bounds.
 const authoredSky=outdoor?api.root.getObjectByName('sakura-stream:sky'):null;
 const authoredSkyVisible=authoredSky?.visible;if(authoredSky)authoredSky.visible=false;
 let disposed=false,climate=null,baseExposure=renderer?.toneMappingExposure||1;
 let sourceEnvironment=scene.environment,sourceIntensity=scene.environmentIntensity,sourceBackground=scene.background;
 let sourceFog=scene.fog;
 const clearFog=sourceFog?.isFogExp2?sourceFog.clone():null;
 const sourceToneMapping=renderer?.toneMapping;
 const clearSky=sourceBackground?.isColor?new THREE.Color():null;
 let ownedIntensity=scene.environmentIntensity;
 const weatherFog=new THREE.FogExp2('#a8b4be',0);
 api.root.traverse(o=>{
  if(o.name.startsWith('weather:rain-'))rainObjects.push(o);
  if(o.isLight)lights.push({node:o,intensity:o.intensity,color:o.color.clone(),position:o.position.clone()});
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
 const key=lights.filter(l=>l.node.isDirectionalLight).sort((a,b)=>b.intensity-a.intensity)[0];
 const size=(api.bounds||new THREE.Box3().setFromObject(api.framingRoot||api.root)).getSize(new THREE.Vector3()).length();
 const envData=new Uint8Array(64*32*4),environment=new THREE.DataTexture(envData,64,32);
 environment.mapping=THREE.EquirectangularReflectionMapping;environment.colorSpace=THREE.SRGBColorSpace;
 environment.minFilter=environment.magFilter=THREE.LinearFilter;environment.name='live-weather-reflection';
 let environmentKey='';
 function attenuateEffects(){
  if(!climate)return;
  const daylight=sceneDaylight(climate.timeOfDay),cloud=clamp(climate.weather?.cloud||0,0,1);
  for(const e of effects)e.node.material.opacity=e.opacity*(1-cloud*.85)*(id==='forest'?(daylight.night?0:daylight.brightness):(daylight.night?.2:1))*.5;
 }
 function updateEnvironment(daylight,weather){
  const cloud=clamp(weather?.cloud||0,0,1),night=1-daylight.brightness;
  const fingerprint=[Math.round(daylight.brightness*20),Math.round(cloud*10),daylight.twilight,daylight.hour<12].join(':');
  if(fingerprint===environmentKey){scene.environment=environment;return;}environmentKey=fingerprint;
  const sky=new THREE.Color(daylight.sun.skyColor).lerp(new THREE.Color('#66afe9'),daylight.twilight?.12:.48).lerp(new THREE.Color('#a1acb4'),cloud*.7).multiplyScalar(1-night*.8);
  const horizon=new THREE.Color(daylight.twilight&&!daylight.night?'#f0d1b2':'#c6e0ee').lerp(new THREE.Color('#abb4bb'),cloud).multiplyScalar(1-night*.84);
  const ground=new THREE.Color('#777a70').multiplyScalar(1-night*.8),c=new THREE.Color();
  for(let y=0;y<32;y++)for(let x=0;x<64;x++){
   const t=y/31;if(t<.5)c.copy(ground).lerp(horizon,Math.pow(t*2,3));else c.copy(horizon).lerp(sky,Math.pow((t-.5)*2,.5));
   const haze=(Math.sin(x*.44+y*.23)*Math.sin(x*.21-y*.7))*.018*(1-cloud);
   c.offsetHSL(0,0,haze).convertLinearToSRGB();const k=(y*64+x)*4;
   envData[k]=Math.round(clamp(c.r,0,1)*255);envData[k+1]=Math.round(clamp(c.g,0,1)*255);envData[k+2]=Math.round(clamp(c.b,0,1)*255);envData[k+3]=255;
  }
  environment.needsUpdate=true;scene.environment=environment;
 }
 function remember(){
  baseExposure=renderer?.toneMappingExposure||1;
  if(scene.environment!==environment)sourceEnvironment=scene.environment;
  sourceIntensity=scene.environmentIntensity;
  if(scene.background!==environment&&scene.background!==clearSky&&scene.background!==daySky?.texture)sourceBackground=scene.background;
  if(scene.fog!==weatherFog&&scene.fog!==clearFog)sourceFog=scene.fog;
  for(const l of lights){l.intensity=l.node.intensity;l.color.copy(l.node.color);l.position.copy(l.node.position);}
  for(const effect of effects)effect.opacity=effect.node.material.opacity;
  for(const water of waters)water.sky.copy(water.u.uSky.value);
 }
 function applyClimate(){
  if(!climate||disposed)return;
  const daylight=sceneDaylight(climate.timeOfDay),weather=climate.weather;
  const cloud=clamp(weather?.cloud||0,0,1),rain=clamp(weather?.rain||0,0,1),fog=clamp(weather?.fog||0,0,1);
  const brightness=daylight.brightness;
  nightSky?.setClimate(daylight,weather);
  for(const l of lights){
   const node=l.node;
   if(l===key){
    node.color.set(daylight.sun.color).lerp(new THREE.Color('#fff8ed'),brightness*.38*(1-cloud)).lerp(new THREE.Color('#dce5eb'),cloud*.7);
    node.intensity=l.intensity*(.12+.88*brightness)*(1-cloud*.72)*(1-rain*.12)*(outdoor&&!daylight.night?1.24:1)*(api.lightResponse?.sun??1);
    const solar=climate.timeOfDay?.kind==='solar'?climate.timeOfDay:null;
    const elevation=solar?solar.elevation:Math.max(5,Math.sin((daylight.hour-6)/12*Math.PI)*60);
    const angle=solar?solar.hourAngle:(daylight.hour-12)*15;
    const radius=Math.max(size*.7,l.position.length());
    const target=node.target?.position||new THREE.Vector3();
    node.position.set(Math.sin(THREE.MathUtils.degToRad(angle))*.85,Math.sin(THREE.MathUtils.degToRad(Math.max(6,elevation))),.65).normalize();
    // Scene coordinates are local artistic north. Rotate both the real key
    // and its optical water input together when the authored site needs it.
    if(Number.isFinite(api.sunAzimuthOffset))node.position.applyAxisAngle(new THREE.Vector3(0,1,0),THREE.MathUtils.degToRad(api.sunAzimuthOffset));
    node.position.multiplyScalar(radius).add(target);
    node.shadow.needsUpdate=true;
   }else if(node.isHemisphereLight||node.isAmbientLight){
    // Keep sunlight and cast shadows legible. Cloud cover restores softer fill;
    // night retains its practical-light balance rather than crushing the blacks.
    const fill=daylight.night?(outdoor?.77*.42:.9*.7):(outdoor?.90+.10*cloud:.78+.1*cloud);
    node.intensity=l.intensity*fill*(api.lightResponse?.ambient??1);
    node.color.copy(l.color).lerp(new THREE.Color('#becbd6'),cloud*.65);
   }else if(node.isDirectionalLight){node.intensity=l.intensity*(.18+.82*brightness)*.7;}
  }
  attenuateEffects();
  for(const u of skies){
   u.topColor.value.set(daylight.sun.skyColor).lerp(new THREE.Color('#66afe9'),daylight.twilight?.12:.48).lerp(new THREE.Color('#9ba8b2'),cloud*.85).multiplyScalar(.2+.8*brightness);
   u.midColor.value.set(daylight.sun.skyColor).lerp(new THREE.Color('#b2d7e9'),.4).lerp(new THREE.Color('#b7bfc1'),cloud*.6).multiplyScalar(.2+.8*brightness);
   u.lowColor.value.set(daylight.twilight&&!daylight.night?'#e0ba9e':'#c4dce7').multiplyScalar(.18+.82*brightness);
  }
  for(const water of waters){
   if(key)water.u.uLiveSunDirection.value.copy(key.node.position).sub(key.node.target.position).normalize();
   water.u.uLiveSunStrength.value=(.04+.96*brightness)*(1-cloud*.85);
   water.u.uLiveRain.value=rain;
   water.u.uSky.value.copy(water.sky).lerp(new THREE.Color('#96a5ae'),cloud*.5).multiplyScalar(.22+.78*brightness);
  }
  for(const wind of winds)wind.u.uWindStrength.value=wind.strength*(weather?.wind===undefined?1:.35+clamp(weather.wind,0,1)*2);
  // A short, slowly recurring interval models a break in passing cloud. Only
  // sites with an authored canopy aperture render shafts; no rays pass through
  // unrelated solid structures or wash out a night/rain scene.
  const rayPhase=((daylight.hour*60+7)%37)/37;
  const rayWindow=Math.max(0,1-Math.abs(rayPhase-.5)/.19);
  if(key)api.setSunlight?.(key.node.position.clone().sub(key.node.target.position),brightness,cloud,rayWindow);
  api.setWind?.(weather?.wind);
  for(const o of rainObjects){o.visible=rain>.01;if(o.isLineSegments)o.geometry.setDrawRange(0,Math.floor(o.geometry.attributes.position.count/2*rain)*2);}
  for(const u of puddles){u.uLiveWetness.value=rain;u.uLiveDaylight.value=.18+.82*brightness;}
  // Weather affects exterior receivers; room surfaces remain dry.
  surfaces.setWeather(weather);surfaces.sync();
  updateEnvironment(daylight,weather);scene.environmentIntensity=(daylight.night?.22:.36+.14*cloud)*(api.lightResponse?.environment??1);ownedIntensity=scene.environmentIntensity;
  if(clearSky&&outdoor)clearSky.set(daylight.sun.skyColor).lerp(new THREE.Color('#79b9e9'),brightness*.55*(1-cloud));
  if(outdoor&&!daylight.night){daySky.update(daylight,weather);scene.background=daySky.texture;}
  else scene.background=cloud>.35||(outdoor&&daylight.night)?environment:sourceBackground;
  scene.backgroundIntensity=daylight.night?.18:1-cloud*.33;
  if(fog||rain||(outdoor&&daylight.night)){weatherFog.color.set(daylight.sun.skyColor).lerp(new THREE.Color('#a8b4be'),.6).multiplyScalar(daylight.night?.12:1);weatherFog.density=(fog||rain)?(fog*.8+rain*.12)/Math.max(size,1):(sourceFog?.density||0);scene.fog=weatherFog;}
  else if(outdoor&&clearFog&&sourceFog?.isFogExp2){clearFog.color.copy(sourceFog.color);clearFog.density=sourceFog.density*.5;scene.fog=clearFog;}
  else scene.fog=sourceFog;
  // Neutral preserves the authored pigment saturation while compressing bright
  // highlights. This applies to the 3D renderer, including water and sky shaders.
  if(renderer){renderer.toneMapping=THREE.NeutralToneMapping;renderer.toneMappingExposure=baseExposure;renderer.shadowMap.needsUpdate=true;}
  api.root.userData.liveSurfaceClimate={rain,cloud,fog,brightness,hour:daylight.hour};
 }
 api.setLighting=id=>{
  if(disposed)return false;
  // Some supplied indoor factories mutate a Color background in place. Return
  // their own object before invoking them after an overcast texture override.
  if(scene.background===environment||scene.background===clearSky||scene.background===daySky?.texture)scene.background=sourceBackground;
  if(scene.environment===environment)scene.environment=sourceEnvironment;
  if(scene.fog===weatherFog||scene.fog===clearFog)scene.fog=sourceFog;
  scene.environmentIntensity=sourceIntensity;
  for(const e of effects)e.node.material.opacity=e.opacity;
  const result=original.setLighting?.(id);surfaces.sync();remember();
  // Host calls setClimate after a preset; continuous updates don't select a
  // fixed photo mood and don't touch geometry, anchors, or camera state.
  return result;
 };
 api.setClimate=value=>{climate=value;applyClimate();};
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
  if(scene.environment===environment)scene.environment=sourceEnvironment;
  if(scene.background===environment||scene.background===clearSky||scene.background===daySky?.texture)scene.background=sourceBackground;
  if(scene.environmentIntensity===ownedIntensity)scene.environmentIntensity=sourceIntensity;
  if(scene.fog===weatherFog||scene.fog===clearFog||scene.fog===sourceFog)scene.fog=sourceFog;
  if(renderer?.toneMapping===THREE.NeutralToneMapping)renderer.toneMapping=sourceToneMapping;
  if(authoredSky)authoredSky.visible=authoredSkyVisible;
  daySky?.dispose();environment.dispose();original.dispose?.();
 };
 return api;
}
