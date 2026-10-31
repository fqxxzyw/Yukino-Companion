import * as THREE from 'three';
import {Reflector} from 'three/addons/objects/Reflector.js';
import {sunlightConfig} from './procedural-scenes.mjs';

// One art direction for both the collectible and the character's street-level
// stage. Emissive paint is not a lamp: these lights actually illuminate meshes.
export const CITY_NIGHT=Object.freeze({
 background:'#0b1528',sky:'#829ed0',ground:'#27324b',ambient:.32,
 moon:'#9dbcea',moonIntensity:.85,exposure:1.12
});
export function applyCityNight(ambient,key,gl){
 ambient.color.set(CITY_NIGHT.sky);ambient.groundColor.set(CITY_NIGHT.ground);ambient.intensity=CITY_NIGHT.ambient;
 key.color.set(CITY_NIGHT.moon);key.intensity=CITY_NIGHT.moonIntensity;key.position.set(-10,16,12);
 if(gl){gl.toneMapping=THREE.ACESFilmicToneMapping;gl.toneMappingExposure=CITY_NIGHT.exposure;}
}

const clamp=value=>Math.max(0,Math.min(1,Number.isFinite(value)?value:0));
const smooth=value=>{const t=clamp(value);return t*t*(3-2*t)};
const mix=(a,b,t)=>(1-t)*a+t*b;
const mixColor=(a,b,t)=>'#'+new THREE.Color(a).lerp(new THREE.Color(b),t).getHexString();
function localHour(){const now=new Date();return now.getHours()+now.getMinutes()/60+now.getSeconds()/3600}
function lightingTime(value){
 if(typeof value==='number'&&Number.isFinite(value))return ((value%24)+24)%24;
 if(value?.kind==='solar'&&Number.isFinite(value.elevation)&&Math.abs(value.elevation)<=90&&Number.isFinite(value.hourAngle)&&Math.abs(value.hourAngle)<=180)return value;
 const hours={morning:7,noon:12,evening:18};
 return typeof value==='string'&&Object.hasOwn(hours,value)?hours[value]:localHour();
}

/** Pure light snapshot for both renderers. Supply a local fractional hour or the
 * same solar object accepted by sunlightConfig. Missing/invalid time uses the
 * local clock; weather is normalized {cloud,rain,fog,snow} in [0,1], null=dry. */
export function cityLighting(timeOfDay,weather=null){
 const time=lightingTime(timeOfDay),sun=sunlightConfig(time);
 const nightAmount=typeof time==='number'
  ?1-smooth((time-5)/2)*(1-smooth((time-17)/3))
  :1-smooth((time.elevation+6)/9);
 const moonDirection=typeof time==='number'
  ?1-smooth(time-5)*(1-smooth((time-18)/2))
  :1-smooth((time.elevation+6)/6);
 const cloud=clamp(weather?.cloud),rain=clamp(weather?.rain),fog=clamp(weather?.fog),snow=clamp(weather?.snow);
 const precipitation=Math.max(rain,snow),dullness=clamp(cloud*.38+precipitation*.24+fog*.55);
 const cool=color=>mixColor(color,'#aabdd2',dullness);
 return {...sun,
  color:cool(mixColor(sun.color,CITY_NIGHT.moon,nightAmount)),
  intensity:mix(sun.intensity,CITY_NIGHT.moonIntensity,nightAmount)*(1-cloud*.62)*(1-precipitation*.28)*(1-fog*.4),
  // Preserve the sun direction above the horizon, blending to moon below it.
  position:sun.position.map((value,i)=>mix(value,[-10,16,12][i],moonDirection)),
  ambient:mix(sun.ambient,CITY_NIGHT.ambient,nightAmount)*(1-cloud*.16-precipitation*.12-fog*.2),
  ambientColor:cool(mixColor(sun.ambientColor,CITY_NIGHT.sky,nightAmount)),
  groundColor:cool(mixColor(sun.groundColor,CITY_NIGHT.ground,nightAmount)),
  skyColor:mixColor(mixColor(sun.skyColor,CITY_NIGHT.background,nightAmount),mixColor('#929fae','#344153',nightAmount),dullness),
  nightAmount,wetness:Math.max(rain,snow*.25),
  fogDensity:mix(.006,.012,nightAmount)+cloud*.006+rain*.026+snow*.04+fog*.1,
  exposure:mix(1.02,CITY_NIGHT.exposure,nightAmount),
  cloud,rain,fog,snow
 };
}

export function applyCityLighting(ambient,key,gl,timeOfDay,weather=null){
 const light=cityLighting(timeOfDay,weather);
 ambient.color.set(light.ambientColor);ambient.groundColor.set(light.groundColor);ambient.intensity=light.ambient;
 key.color.set(light.color);key.intensity=light.intensity;key.position.set(...light.position);
 if(gl){gl.toneMapping=THREE.ACESFilmicToneMapping;gl.toneMappingExposure=light.exposure;}
 return light;
}

// These caches never own/dispose resources. Only the factory's direct city
// batches qualify; do not traverse a scene or an avatar attached to the group.
const citySurfaces=new WeakMap(),surfaceBaseline=new WeakMap();
const wetRoles=new Set(['wet-reflection','puddle','puddle-edge','puddle-ripple','wet-asphalt']);
export function updateCitySurfaces(environment,snapshot){
 if(!environment?.userData?.proceduralEnvironment||environment.userData.environmentId!=='city'||!snapshot)return snapshot;
 let surfaces=citySurfaces.get(environment);
 if(!surfaces){
  // The factory emits exactly stats.drawCalls direct batches, before any
  // caller-added children. Even an appended instanced avatar is not an owner.
  const count=environment.userData.stats?.drawCalls;
  const meshes=Number.isInteger(count)&&count>0?environment.children.slice(0,count).filter(mesh=>mesh.isInstancedMesh&&typeof mesh.userData?.role==='string'&&mesh.name===`city:${mesh.userData.role}`):[];
  const materials=new Map();
  for(const mesh of meshes){
   for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]){
    if(!material)continue;
    if(!surfaceBaseline.has(material))surfaceBaseline.set(material,{emissiveIntensity:material.emissiveIntensity,opacity:material.opacity,roughness:material.roughness,metalness:material.metalness});
    if(!materials.has(material))materials.set(material,new Set());
    materials.get(material).add(mesh.userData.role);
   }
  }
  surfaces={meshes:meshes.map(mesh=>({mesh,visible:mesh.visible})),materials};citySurfaces.set(environment,surfaces);
 }
 const night=clamp(snapshot.nightAmount),wetness=clamp(snapshot.wetness);
 for(const {mesh,visible} of surfaces.meshes){
  if(wetRoles.has(mesh.userData.role))mesh.visible=visible&&wetness>0&&(mesh.userData.role!=='wet-reflection'||night>0);
 }
 for(const [material,roles] of surfaces.materials){
  const original=surfaceBaseline.get(material);
  if(Number.isFinite(original.emissiveIntensity))material.emissiveIntensity=original.emissiveIntensity*night;
  // Fade transparent wet overlays, but never change a shared dry material's opacity.
  if(material.transparent&&[...roles].every(role=>wetRoles.has(role)))material.opacity=original.opacity*wetness*(roles.has('wet-reflection')?night:1);
  if([...roles].every(role=>role==='road'||role==='dim-alley')){
   if(Number.isFinite(original.roughness))material.roughness=mix(.92,original.roughness,wetness);
   if(Number.isFinite(original.metalness))material.metalness=mix(.02,original.metalness,wetness);
  }
 }
 return snapshot;
}

function glowTexture(){
 const size=64,data=new Uint8Array(size*size*4);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const radius=Math.hypot((x+.5)/size*2-1,(y+.5)/size*2-1);
  const alpha=Math.pow(Math.max(0,1-radius),2.4);const i=(y*size+x)*4;
  data[i]=data[i+1]=data[i+2]=255;data[i+3]=Math.round(alpha*255);
 }
 const texture=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);
 texture.colorSpace=THREE.SRGBColorSpace;texture.needsUpdate=true;return texture;
}

// A bounded, single low-resolution planar reflection pass, not SSR or ray tracing.
// Local coordinates are deliberately used for the puddle mask so it cannot swim
// with camera motion. Distortion and multi-scale breakup keep it off a mirror.
function wetStreet(resolution){
 const shader={...Reflector.ReflectorShader,
  uniforms:{...Reflector.ReflectorShader.uniforms,wetness:{value:0},resolution:{value:new THREE.Vector2(resolution,resolution)}},
  vertexShader:Reflector.ReflectorShader.vertexShader
   .replace('varying vec4 vUv;','varying vec4 vUv;\nvarying vec2 wetPosition;')
   .replace('vUv = textureMatrix','wetPosition = position.xy;\n vUv = textureMatrix'),
  fragmentShader:`
   uniform sampler2D tDiffuse;
   uniform float wetness;
   uniform vec2 resolution;
   varying vec4 vUv;
   varying vec2 wetPosition;
   #include <logdepthbuf_pars_fragment>
   float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
   float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
   void main(){
    #include <logdepthbuf_fragment>
    vec2 p=wetPosition;
    float broad=noise(p*1.3),grain=noise(p*24.0);
    float wet=smoothstep(.26,.76,broad)*(.5+.5*grain);
    vec4 projection=vUv;
    projection.xy+=vec2(sin(p.y*39.0+p.x*9.0),cos(p.x*31.0))*projection.w*.0009;
    vec2 uv=projection.xy/projection.w;
    vec2 texel=1.0/resolution;
    vec3 reflection=texture2D(tDiffuse,uv).rgb*.4;
    reflection+=(texture2D(tDiffuse,uv+texel*vec2(1.8,.6)).rgb+texture2D(tDiffuse,uv-texel*vec2(1.8,.6)).rgb)*.3;
    gl_FragColor=vec4(reflection, wetness*(.10+wet*.42));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }`
 };
 const outline=[[-5.82,-5.78],[-3.29,-5.78],[-3.29,2.27],[5.82,2.27],[5.82,5.82],[-5.82,5.82]];
 const shape=new THREE.Shape(outline.map(([x,z])=>new THREE.Vector2(x,-z)));
 const geometry=new THREE.ShapeGeometry(shape);
 const mesh=new Reflector(geometry,{textureWidth:resolution,textureHeight:resolution,multisample:0,clipBias:.003,shader});
 mesh.name='city:wet-street-reflection';mesh.rotation.x=-Math.PI/2;mesh.position.y=.048;
 mesh.material.transparent=true;mesh.material.depthWrite=false;mesh.material.uniforms.color.value.set('#ffffff');
 mesh.renderOrder=1;mesh.userData.role='wet-street-reflection';return mesh;
}

export function createCityAtmosphere({reflections=true,resolution=512,timeOfDay,weather=null}={}){
 const group=new THREE.Group();group.name='city:atmosphere';
 const texture=glowTexture(),materials=new Set(),lamps=new Map(),halos=new Map();let disposed=false;
 function point(name,color,intensity,distance,position){
  const light=new THREE.PointLight(color,intensity,distance,2);light.name=name;light.position.set(...position);lamps.set(light,intensity);group.add(light);return light;
 }
 function spot(name,color,intensity,distance,angle,position,target){
  const light=new THREE.SpotLight(color,intensity,distance,angle,.8,2);light.name=name;light.position.set(...position);light.target.position.set(...target);lamps.set(light,intensity);group.add(light,light.target);return light;
 }
 point('store-warm-left','#ffdbb0',26,7.5,[-1.35,2.35,-1.45]);
 point('store-warm-right','#ffdbb0',26,7.5,[1.85,2.35,-1.45]);
 spot('canopy-warm-spill','#ffd3a0',48,8.5,1.08,[.5,2.48,1.24],[.5,.14,2.9]);
 point('vending-cool-spill','#83dbe2',8,3.8,[4.5,1.35,.76]);
 spot('street-lamp-spill','#ffd6a1',24,7.5,.76,[-2.7,3.34,1.75],[-2.7,0,3.5]);
 function glow(color,opacity,position,size){
  const material=new THREE.SpriteMaterial({map:texture,color,opacity,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false});materials.add(material);
  const sprite=new THREE.Sprite(material);sprite.position.set(...position);sprite.scale.set(...size,1);sprite.name='city:light-halo';halos.set(sprite,opacity);group.add(sprite);
 }
 glow('#ffe0ac',.34,[.5,3.055,.76],[6.7,.65]);
 glow('#ffd6a1',.3,[.5,2.55,1.44],[6.2,.47]);
 glow('#8be5ef',.34,[4.5,1.32,.59],[1.05,1.55]);
 glow('#ffdcad',.3,[-2.7,3.43,1.76],[.75,.55]);
 const pixels=Math.max(128,Math.min(768,Number.isFinite(resolution)?Math.round(resolution):512));
 const reflection=reflections?wetStreet(pixels):null;
 if(reflection)group.add(reflection);
 function update(timeOfDay,weather=null){
  const snapshot=cityLighting(timeOfDay,weather);
  if(disposed)return snapshot;
  for(const [light,intensity] of lamps)light.intensity=intensity*snapshot.nightAmount;
  for(const [sprite,opacity] of halos){sprite.material.opacity=opacity*snapshot.nightAmount;sprite.visible=snapshot.nightAmount>0;}
  if(reflection){
   const target=reflection.getRenderTarget();
   reflection.material.uniforms.resolution.value.set(target.width,target.height);
   reflection.material.uniforms.wetness.value=snapshot.wetness;
   reflection.visible=snapshot.wetness>0;
  }
  group.userData.lighting=snapshot;
  return snapshot;
 }
 update(timeOfDay,weather);
 return {group,reflection,update,dispose(){
  if(disposed)return;disposed=true;group.removeFromParent();
  reflection?.dispose();reflection?.geometry.dispose();
  for(const material of materials)material.dispose();texture.dispose();group.clear();lamps.clear();halos.clear();
 }};
}
