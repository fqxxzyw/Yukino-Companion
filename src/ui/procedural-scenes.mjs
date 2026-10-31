import * as THREE from 'three';
import {buildDiorama} from './diorama-geometry.mjs';
import {buildSeaside, applySeasideLighting} from './seaside-scene.mjs';
import {
  SEASIDE_ANCHOR,
  SEASIDE_CAMERAS,
  SEASIDE_DEFAULT_LIGHTING,
  SEASIDE_LIGHTING_IDS,
  SEASIDE_LIGHTING_PRESETS,
  seasideLightingPreset,
} from './seaside-presets.mjs';

// Original, texture-free miniatures plus one purpose-built seaside collectible.
// Its sand grain, wood grain and contact shadows use small procedural DataTextures
// owned by the same factory; no external image, audio, network or asset is read.
export const ENVIRONMENT_IDS = Object.freeze(['studio', 'classroom', 'beach', 'forest', 'city', 'seaside']);
export const ENVIRONMENT_BUDGET = Object.freeze({drawCalls: 100, triangles: 16000, instances: 500});
// Only the city is receiving the denser art pass. Other four budgets stay fixed.
export const CITY_ENVIRONMENT_BUDGET = Object.freeze({drawCalls: 150, triangles: 32000, instances: 1100});
export const SEASIDE_ENVIRONMENT_BUDGET = Object.freeze({drawCalls: 72, triangles: 80000, instances: 1500});
export const environmentBudget = id => id === 'city' ? CITY_ENVIRONMENT_BUDGET : id === 'seaside' ? SEASIDE_ENVIRONMENT_BUDGET : ENVIRONMENT_BUDGET;
const owned = new WeakMap();
const SUNLIGHT = Object.freeze({
 morning: {color: '#ffe2bc', intensity: 2.5, position: [-5, 4, 3], ambient: 1.45, ambientColor: '#dceafb', groundColor: '#b5b9a5', skyColor: '#dceaf2'},
 noon: {color: '#fff8e8', intensity: 3.1, position: [-2, 7, 4], ambient: 1.65, ambientColor: '#e5f0ff', groundColor: '#b9c7b2', skyColor: '#cee6f3'},
 evening: {color: '#ffc18c', intensity: 2.1, position: [5, 2.2, 1], ambient: 1.05, ambientColor: '#c2c9e6', groundColor: '#9a9398', skyColor: '#e9d9dc'}
});
const NIGHT = Object.freeze({color:'#c5d6f2',intensity:1.05,position:[-1,3,3],ambient:.95,ambientColor:'#c0d3ef',groundColor:'#8f9daf',skyColor:'#778cae'});
const DAYLIGHT_CURVE = Object.freeze([[0,NIGHT],[5,NIGHT],[7,SUNLIGHT.morning],[12,SUNLIGHT.noon],[18,SUNLIGHT.evening],[20,NIGHT],[24,NIGHT]]);
function blendLight(a,b,t){
 const mix=(x,y)=>x+(y-x)*t,color=key=>'#'+new THREE.Color(a[key]).lerp(new THREE.Color(b[key]),t).getHexString();
 return {color:color('color'),intensity:mix(a.intensity,b.intensity),position:a.position.map((v,i)=>mix(v,b.position[i])),ambient:mix(a.ambient,b.ambient),ambientColor:color('ambientColor'),groundColor:color('groundColor'),skyColor:color('skyColor')};
}
const smooth=(x)=>{const t=Math.max(0,Math.min(1,x));return t*t*(3-2*t)};
function daylightAtSolarPosition(solar){
 const warm=blendLight(SUNLIGHT.morning,SUNLIGHT.evening,(1+Math.sin(solar.hourAngle*Math.PI/180))/2);
 // -0.833° is the usual approximate sunrise/sunset threshold. Twilight is
 // deliberately soft; indoor fill at night keeps the character visible.
 const illuminated=blendLight(NIGHT,warm,smooth((solar.elevation+6)/9));
 const daylight=blendLight(illuminated,SUNLIGHT.noon,smooth((solar.elevation-3)/32));
 daylight.position=[Math.sin(solar.hourAngle*Math.PI/180)*5,1.5+5*smooth((solar.elevation+6)/50),3];
 return {...daylight,timeOfDay:solar};
}
function daylightAtHour(hour){
 const normalized=((hour%24)+24)%24;
 const next=DAYLIGHT_CURVE.findIndex(([time])=>time>normalized);
 const [start,a]=DAYLIGHT_CURVE[next-1], [end,b]=DAYLIGHT_CURVE[next];
 const t=(normalized-start)/(end-start),smooth=t*t*(3-2*t),mix=(x,y)=>x+(y-x)*smooth;
 const color=key=>'#'+new THREE.Color(a[key]).lerp(new THREE.Color(b[key]),smooth).getHexString();
 return {color:color('color'),intensity:mix(a.intensity,b.intensity),position:a.position.map((v,i)=>mix(v,b.position[i])),ambient:mix(a.ambient,b.ambient),ambientColor:color('ambientColor'),groundColor:color('groundColor'),skyColor:color('skyColor'),timeOfDay:normalized};
}

/** Colors are sRGB strings; intensities are artistic Three light multipliers.
 * Assign ambient/ambientColor/groundColor to an existing HemisphereLight and
 * color/intensity/position to a DirectionalLight. Never adds duplicate lights. */
export function sunlightConfig(timeOfDay = 'noon') {
 if(typeof timeOfDay==='number'&&Number.isFinite(timeOfDay))return daylightAtHour(timeOfDay);
 if(timeOfDay?.kind==='solar'&&Number.isFinite(timeOfDay.elevation)&&Math.abs(timeOfDay.elevation)<=90&&Number.isFinite(timeOfDay.hourAngle)&&Math.abs(timeOfDay.hourAngle)<=180)return daylightAtSolarPosition(timeOfDay);
 const id = Object.hasOwn(SUNLIGHT, timeOfDay) ? timeOfDay : 'noon';
 return {...SUNLIGHT[id], timeOfDay: id, position: [...SUNLIGHT[id].position]};
}
export function updateEnvironmentSunlight(group,timeOfDay){
 if(!group)return;
 if(group.userData?.environmentId==='seaside'){
  const preset=seasideLightingPreset(timeOfDay);
  applySeasideLighting(group,preset);
  const light={
   color:preset.sun.color,intensity:preset.sun.intensity,position:[...preset.sun.position],
   ambient:preset.ambient.intensity,ambientColor:preset.ambient.color,groundColor:preset.ambient.groundColor,
   skyColor:preset.water.sky,timeOfDay:preset.id,
  };
  group.userData.timeOfDay=preset.id;
  group.userData.lightingPreset=preset.id;
  group.userData.sunlight=light;
  return light;
 }
 const light=sunlightConfig(timeOfDay);
 // Miniatures have no sky/backdrop to recolor. Keep the legacy role handling
 // for an explicitly caller-added sky, and expose the light snapshot instead.
 for(const mesh of group.children)if(mesh.userData?.role==='sky')mesh.material?.color?.set(light.skyColor);
 group.userData.timeOfDay=light.timeOfDay;
 group.userData.sunlight=light;
}

function seasideLightSnapshot(preset){
 return {
  color:preset.sun.color,intensity:preset.sun.intensity,position:[...preset.sun.position],
  ambient:preset.ambient.intensity,ambientColor:preset.ambient.color,groundColor:preset.ambient.groundColor,
  skyColor:preset.water.sky,timeOfDay:preset.id,
 };
}

/** A freely orbitable, square-base collectible with floor datum y=0.
 * The four original miniature scenes remain 12 x 12. The seaside is authored at
 * 20 x 20 for real-size decking, a 4 x 3 m character floor and a deeper water
 * basin. Character height metadata stays 2 units for the host's existing model. */
export function createEnvironment(sceneId = 'studio', options = {}) {
 const id = ENVIRONMENT_IDS.includes(sceneId) ? sceneId : 'studio';
 const config = options || {};
 const isSeaside = id === 'seaside';
 const preset = isSeaside ? seasideLightingPreset(config.timeOfDay ?? config.lightingPreset ?? SEASIDE_DEFAULT_LIGHTING) : null;
 const state = {meshes: new Set(), geometries: new Set(), materials: new Set(), textures: new Set(), disposed: false};
 const group = isSeaside ? buildSeaside(state, {...config, timeOfDay: preset.id}) : buildDiorama(id, config, state);
 owned.set(group, state);
 const light = preset ? seasideLightSnapshot(preset) : sunlightConfig(config.timeOfDay);
 let triangles = 0, instances = 0;
 for (const mesh of state.meshes) {
  const count = mesh.isInstancedMesh ? mesh.count : 1;
  triangles += (mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position.count) / 3 * count;
  instances += count;
 }
 const stats = {drawCalls: state.meshes.size, triangles, instances, geometries: state.geometries.size, materials: state.materials.size, textures: state.textures.size};
 const previous = group.userData || {};
 group.userData = {
  proceduralEnvironment: true, diorama: true, environmentId: id,
  footprint: isSeaside ? {size: 20, min: -10, max: 10} : {size: 12, min: -6, max: 6},
  focus: isSeaside ? [0.5, 0.9, 2.4] : [0, 1.5, 0],
  characterHeight: 2, floorY: 0, shadows: config.shadows === true,
  timeOfDay: preset ? preset.id : light.timeOfDay, sunlight: light,
  stats,
  ...previous,
 };
 if (isSeaside && previous.seaside) {
  const api = previous.seaside;
  const anchorPosition = [SEASIDE_ANCHOR.x, SEASIDE_ANCHOR.y, SEASIDE_ANCHOR.z];
  let waveLineMaxZ = -Infinity;
  for (let x = SEASIDE_ANCHOR.standMinX; x <= SEASIDE_ANCHOR.standMaxX + 1e-6; x += 0.20) {
   const waterline = api.waterlineOffset(x);
   waveLineMaxZ = Math.max(waveLineMaxZ, api.shoreZ(x) + waterline + 0.95);
  }
  const safety = Object.freeze({
   surface: SEASIDE_ANCHOR.surface,
   standMinZ: SEASIDE_ANCHOR.standMinZ,
   waveLineMaxZ: Number(waveLineMaxZ.toFixed(3)),
   setback: Number((SEASIDE_ANCHOR.standMinZ - waveLineMaxZ).toFixed(3)),
   dry: true,
   animatedBySea: false,
   note: 'The highest authored foam reaches landward of the shoreline, still metres in front of the character floor.',
  });
  const presets = Object.freeze(SEASIDE_LIGHTING_IDS.map(key => Object.freeze({id: key, label: SEASIDE_LIGHTING_PRESETS[key].label, hour: SEASIDE_LIGHTING_PRESETS[key].hour, background: SEASIDE_LIGHTING_PRESETS[key].background})));
  group.userData.lightingPreset = preset.id;
  group.userData.defaultLightingPreset = SEASIDE_DEFAULT_LIGHTING;
  group.userData.lightingPresets = presets;
  group.userData.lightingPresetData = SEASIDE_LIGHTING_PRESETS;
  group.userData.cameras = SEASIDE_CAMERAS;
  group.userData.characterAnchor = {group: api.anchor, name: SEASIDE_ANCHOR.name, position: anchorPosition, stand: {...api.stand}, surface: SEASIDE_ANCHOR.surface, visible: false};
  group.userData.safety = safety;
  group.userData.animation = {primary: 'seaside-water-and-wind', reducedMotionAware: true, canDisable: true};
  group.userData.setLightingPreset = (value) => {
   const next = applySeasideLighting(group, value);
   const fresh = seasideLightSnapshot(seasideLightingPreset(value));
   group.userData.lightingPreset = next;
   group.userData.timeOfDay = next;
   group.userData.sunlight = fresh;
   return next;
  };
  group.userData.setMotion = api.setMotion;
  group.userData.update = api.update;
 }
 group.updateMatrixWorld(true);
 return group;
}

/** Release instance buffers, shared-within-this-group geometry, material and
 * procedural texture resources exactly once. Foreign children are untouched. */
export function disposeEnvironment(group) {
 const state = owned.get(group);
 if (!state || state.disposed) return false;
 state.disposed = true;
 group.removeFromParent();
 for (const mesh of state.meshes) {mesh.removeFromParent();mesh.dispose?.();}
 for (const geometry of state.geometries) geometry.dispose();
 for (const material of state.materials) material.dispose();
 for (const texture of state.textures) texture.dispose();
 state.meshes.clear();state.geometries.clear();state.materials.clear();state.textures.clear();
 return true;
}
