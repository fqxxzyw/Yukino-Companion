import * as THREE from 'three';

// Original, texture-free geometry. No downloads, timers, random seeds or shared
// GPU resources: each environment has one owner and can be replaced atomically.
export const ENVIRONMENT_IDS = Object.freeze(['studio', 'classroom', 'beach', 'forest', 'city']);
export const ENVIRONMENT_BUDGET = Object.freeze({drawCalls: 40, triangles: 12000, instances: 300});
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
 const light=sunlightConfig(timeOfDay);
 for(const mesh of group.children)if(mesh.userData?.role==='sky')mesh.material?.color?.set(light.skyColor);
 group.userData.timeOfDay=light.timeOfDay;
}

function builder(id, options) {
 const group = new THREE.Group();
 group.name = `environment:${id}`;
 const state = {meshes: new Set(), geometries: new Set(), materials: new Set(), disposed: false};
 owned.set(group, state);
 const batches = new Map(), geometryCache = new Map(), materialCache = new Map();
 const shadows = options.shadows === true;
 group.userData = {proceduralEnvironment: true, environmentId: id, characterHeight: 2, floorY: 0, shadows, timeOfDay: sunlightConfig(options.timeOfDay).timeOfDay};
 function add(role, shape, color, size, position, {yaw = 0, pitch = 0, roll = 0, unlit = false, cast = true, receive = true} = {}) {
  const key = [role, shape, color, unlit, cast, receive].join(':');
  if (!batches.has(key)) batches.set(key, {role, shape, color, unlit, cast, receive, transforms: []});
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll));
  batches.get(key).transforms.push(new THREE.Matrix4().compose(new THREE.Vector3(...position), rotation, new THREE.Vector3(...size)));
 }
 const box = (role, color, size, position, flags) => add(role, 'box', color, size, position, flags);
 const ground = (color, width = 24, depth = 28, z = -7) => box('ground', color, [width, .12, depth], [0, -.06, z], {cast: false});
 const sky = () => box('sky', sunlightConfig(options.timeOfDay).skyColor, [76, 28, .08], [0, 10, -38], {unlit: true, cast: false, receive: false});
 function finish() {
  let triangles = 0, instances = 0;
  for (const batch of batches.values()) {
   if (!geometryCache.has(batch.shape)) {
    const geometry = batch.shape === 'cylinder' ? new THREE.CylinderGeometry(.5, .5, 1, 8)
     : batch.shape === 'cone' ? new THREE.ConeGeometry(.5, 1, 8)
     : batch.shape === 'foliage' ? new THREE.IcosahedronGeometry(.5, 1) : new THREE.BoxGeometry(1, 1, 1);
    geometry.computeBoundingBox();
    geometryCache.set(batch.shape, geometry);state.geometries.add(geometry);
   }
   // Sky must own its material: automatic daylight changes only the sky and
   // must never recolor unrelated scene props sharing the initial color.
   const materialKey = `${batch.role==='sky'?'sky:':''}${batch.color}:${batch.unlit}`;
   if (!materialCache.has(materialKey)) {
    const material = batch.unlit ? new THREE.MeshBasicMaterial({color: batch.color}) : new THREE.MeshStandardMaterial({color: batch.color, roughness: .94, metalness: 0});
    materialCache.set(materialKey, material);state.materials.add(material);
   }
   const geometry = geometryCache.get(batch.shape), mesh = new THREE.InstancedMesh(geometry, materialCache.get(materialKey), batch.transforms.length);
   mesh.name = `${id}:${batch.role}`;mesh.userData.role = batch.role;
   mesh.castShadow = shadows && batch.cast;mesh.receiveShadow = shadows && batch.receive;
   mesh.matrixAutoUpdate = false;
   batch.transforms.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
   mesh.instanceMatrix.needsUpdate = true;
   mesh.computeBoundingBox();mesh.computeBoundingSphere();
   triangles += (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3 * mesh.count;
   instances += mesh.count;
   state.meshes.add(mesh);group.add(mesh);
  }
  group.userData.stats = {drawCalls: state.meshes.size, triangles, instances, geometries: state.geometries.size, materials: state.materials.size};
  group.updateMatrixWorld(true);
  return group;
 }
 return {group, add, box, ground, sky, finish};
}

function classroom(b) {
 b.ground('#d6c4a7', 14, 14, -3);
 // Open-front room. Wall segments leave two genuine window apertures, filled
 // by inset sky-colored glazing and dimensional frames, not painted textures.
 b.box('wall', '#eee8db', [3.4, 4.4, .18], [0, 2.2, -7.6]);
 for (const x of [-4.95, 4.95]) b.box('wall', '#eee8db', [3.3, 4.4, .18], [x, 2.2, -7.6]);
 for (const x of [-2.5, 2.5]) {
  b.box('wall', '#eee8db', [1.6, .9, .18], [x, .45, -7.6]);
  b.box('wall', '#eee8db', [1.6, .8, .18], [x, 4, -7.6]);
  b.box('window-glazing', '#c6e2ed', [1.58, 2.7, .04], [x, 2.25, -7.64], {unlit: true, cast: false, receive: false});
  for (const dx of [-.8, 0, .8]) b.box('window-frame', '#f7f4ec', [.065, 2.75, .12], [x + dx, 2.25, -7.46]);
  for (const y of [.9, 2.25, 3.6]) b.box('window-frame', '#f7f4ec', [1.68, .065, .12], [x, y, -7.46]);
  b.box('window-sill', '#c9b18b', [1.8, .1, .35], [x, .9, -7.35]);
 }
 for (const x of [-6.6, 6.6]) b.box('side-wall', '#e7dfcf', [.16, 4.4, 5.5], [x, 2.2, -4.85]);
 b.box('board-frame', '#a58b64', [3.1, 1.88, .12], [0, 2.46, -7.43]);
 b.box('board', '#365a4d', [2.88, 1.66, .06], [0, 2.46, -7.33]);
 b.box('board-tray', '#c4b698', [3.12, .065, .24], [0, 1.49, -7.25]);
 for (let row = 0; row < 3; row++) b.box('chalk-marks', '#c5d9bd', [1.35 - row * .25, .024, .008], [-.42, 2.87 - row * .24, -7.293]);
 for (const z of [-3.25, -5.3]) for (const x of [-1.8, 0, 1.8]) {
  b.box('desk-top', '#c99f6a', [1.35, .095, .8], [x, .85, z]);
  for (const dx of [-.51, .51]) for (const dz of [-.25, .25]) b.box('desk-legs', '#6d7775', [.055, .8, .055], [x + dx, .4, z + dz]);
  b.box('desk-brace', '#6d7775', [1.08, .055, .055], [x, .3, z - .25]);
  b.box('chair-seat', '#bb9161', [.63, .07, .56], [x, .48, z - .76]);
  b.box('chair-back', '#bb9161', [.63, .36, .06], [x, .87, z - 1.02]);
  for (const dx of [-.24, .24]) for (const dz of [-.2, .2]) b.box('chair-legs', '#6d7775', [.045, .46, .045], [x + dx, .23, z - .76 + dz]);
  for (const dx of [-.24, .24]) b.box('chair-uprights', '#6d7775', [.045, .55, .045], [x + dx, .73, z - 1.02]);
 }
}

function beach(b) {
 b.sky();
 b.ground('#e8d4ad', 48, 12, 0);
 b.box('water', '#65b4c5', [48, .08, 28], [0, -.06, -20], {cast: false});
 b.box('horizon-water', '#5e9fb7', [76, .08, 4], [0, -.06, -36], {cast: false});
 // Static shallow relief crests, deliberately no simulation/timer/render loop.
 for (const [z, width, x] of [[-6.1, 17, -5], [-6.8, 12, 7], [-9.2, 18, 1], [-13.4, 23, -2], [-20.3, 29, 3]]) {
  b.box('water-crest', '#d0e8e3', [width, .014, .07], [x, -.01, z], {cast: false});
 }
 // Faceted dunes, stones and two distant palms make this spatial geometry,
 // while the entire front stage remains clear for the supplied character.
 for (const [x, z, size] of [[-7, -3.5, 3], [7.3, -4.3, 3.4]]) {
  b.add('dune', 'foliage', '#dfc79b', [size, .65, 2], [x, -.05, z]);
  b.add('palm-trunk', 'cylinder', '#b6986e', [.18, 3.1, .18], [x, 1.55, z - .5], {roll: x < 0 ? -.09 : .09});
  for (let i = 0; i < 5; i++) {
   const angle = i * Math.PI * 2 / 5;
   b.add('palm-leaf', 'foliage', '#76997a', [1.7, .18, .48], [x + Math.cos(angle) * .55, 3.06, z - .5 + Math.sin(angle) * .55], {yaw: -angle});
  }
 }
 for (const [x, z] of [[-4.5, -4], [4.1, -3.3], [4.7, -4.9]]) b.add('shore-stone', 'foliage', '#b3b1a3', [.38, .22, .3], [x, .09, z]);
}

function forest(b) {
 b.sky();b.ground('#a6b493');
 b.box('forest-path', '#d2c6a5', [2.6, .008, 20], [0, -.004, -6], {cast: false});
 for (const [x, z, height] of [[-3.4, -3.6, 4], [3.8, -4.2, 4.6], [-5.6, -7, 5.4], [5.5, -8, 5], [-1.9, -10, 4.5], [2.6, -12, 5.8], [-7.5, -12, 6], [7.7, -13, 5.6]]) {
  b.add('tree-trunk', 'cylinder', '#8b7760', [.28, height * .65, .28], [x, height * .325, z]);
  b.add('tree-crown', 'foliage', '#729574', [2.55, height * .56, 2.3], [x, height * .71, z]);
  b.add('tree-crown-light', 'foliage', '#91aa7e', [1.85, height * .39, 1.9], [x - .34, height * .86, z + .1]);
 }
 for (const [x, z] of [[-2.4, -3.2], [3.2, -2.7], [-4.2, -6.2], [4.8, -7.8]]) {
  b.add('fern', 'cone', '#678b67', [.65, .5, .65], [x, .25, z]);
  b.add('forest-rock', 'foliage', '#9ca598', [.48, .3, .42], [x + .55, .12, z - .25]);
 }
}

function city(b) {
 b.sky();b.ground('#c2c8cf');
 b.box('road', '#8995a2', [24, .01, 3.5], [0, -.005, -6.5], {cast: false});
 for (let i = -3; i <= 3; i++) b.box('road-marking', '#e7e6d5', [1.1, .008, .09], [i * 2.5, .002, -6.5], {cast: false});
 for (const [x, z, height, width] of [[-6.2, -11, 5.8, 2.6], [-3.2, -12.3, 4.3, 2.5], [0, -14, 6.8, 2.8], [3.3, -12, 5.2, 2.7], [6.6, -11.8, 6.4, 2.6]]) {
  b.box('building', '#a6b2c3', [width, height, 2.3], [x, height / 2, z]);
  b.box('roof-cap', '#8f9eaf', [width + .16, .14, 2.46], [x, height + .07, z]);
  for (let row = 0; row < Math.floor(height / .85); row++) for (const dx of [-.66, 0, .66]) b.box('building-window', '#d7e5e9', [.38, .46, .025], [x + dx, .58 + row * .85, z + 1.165], {cast: false});
 }
 for (const x of [-3.3, 3.6]) {
  b.box('bench-seat', '#a78d75', [1.65, .12, .48], [x, .46, -3.5]);
  b.box('bench-back', '#a78d75', [1.65, .48, .1], [x, .82, -3.73]);
  for (const dx of [-.6, .6]) b.box('bench-leg', '#71808a', [.09, .4, .36], [x + dx, .2, -3.5]);
  b.add('street-lamp', 'cylinder', '#71808a', [.065, 2.65, .065], [x + .95, 1.325, -4.5]);
  b.box('lamp-head', '#e3e9e3', [.32, .2, .32], [x + .95, 2.75, -4.5], {cast: false});
 }
}

function studio(b) {
 b.ground('#e3e8ec', 18, 16, -3);
 b.box('studio-backdrop', '#e9eef2', [18, 8, .15], [0, 3.8, -7.5], {cast: false});
 for (const x of [-4.2, 4.2]) b.box('studio-column', '#d9e1e8', [.7, 3.6, .7], [x, 1.8, -5.3]);
}

/** Character floor is y=0, height=2, viewing camera at z>0. No elevated prop
 * enters the foreground. Default shadows are OFF to avoid extra shadow passes;
 * `shadows:true` opts meshes in, but the caller must configure its renderer and
 * light shadow camera/map size. timeOfDay only colors the far sky; use the
 * separate sunlightConfig for lights. Unknown IDs fall back to a real studio. */
export function createEnvironment(sceneId = 'studio', options = {}) {
 const id = ENVIRONMENT_IDS.includes(sceneId) ? sceneId : 'studio';
 const b = builder(id, options || {});
 ({studio, classroom, beach, forest, city})[id](b);
 return b.finish();
}

/** Release instance buffers, shared-within-this-group geometry and material
 * exactly once. Other scenes/models (even children added later) are not disposed. */
export function disposeEnvironment(group) {
 const state = owned.get(group);
 if (!state || state.disposed) return false;
 state.disposed = true;
 group.removeFromParent();
 for (const mesh of state.meshes) {mesh.removeFromParent();mesh.dispose();}
 for (const geometry of state.geometries) geometry.dispose();
 for (const material of state.materials) material.dispose();
 state.meshes.clear();state.geometries.clear();state.materials.clear();
 return true;
}
