import * as THREE from 'three';
import {installEightWeightMesh} from './eight-weight-skinning.mjs';
const styles=new WeakMap();
const compactOptions=value=>Object.fromEntries(Object.entries(value).filter(([,item])=>item!==undefined));
const faceMaterials={
 beret:'Material_head_EYE_CLEANUP_LOCAL','black-qipao':'Material_face',kimono:'AnimeV4_StrongerCheekBlush',
 'summer-uniform':'Material_head',swimsuit:'Material_head.001','twin-tail':'Material_head.001','winter-uniform':'Material_head.001',
};
function toonGradient(){
 // Keep a readable cel ramp, but use five softer steps instead of the old
 // four high-contrast bands. The base colour texture remains authoritative.
 const values=new Uint8Array([125,165,200,228,247]);
 const gradient=new THREE.DataTexture(values,values.length,1,THREE.RedFormat);
 gradient.minFilter=gradient.magFilter=THREE.NearestFilter;
 gradient.generateMipmaps=false;gradient.needsUpdate=true;return gradient;
}
function softenToonFace(toon,material){
 const shadow=(material.shadeColorFactor?.clone()||new THREE.Color(.64,.64,.64)).lerp(new THREE.Color(.72,.61,.54),.18);
 toon.onBeforeCompile=shader=>{
  shader.uniforms.yukinoFaceShade={value:shadow};
  shader.fragmentShader=shader.fragmentShader.replace('#include <gradientmap_pars_fragment>',`
   uniform vec3 yukinoFaceShade;
   vec3 getGradientIrradiance(vec3 normal, vec3 lightDirection){
    float lightAmount=dot(normal,lightDirection)*0.5+0.5;
    vec3 middle=mix(yukinoFaceShade,vec3(0.91),smoothstep(0.30,0.52,lightAmount));
    return mix(middle,vec3(0.99),smoothstep(0.66,0.84,lightAmount));
   }`);
 };
 toon.customProgramCacheKey=()=> 'yukino-soft-toon-face';
}
const isHair=material=>/^REVIEW_hair__/i.test(material.name||'');
const outlineWindow={value:new THREE.Vector2(0,100)};
const outlineMaterials=new Set();
const outlineExcluded=/eye|iris|pupil|oral|teeth|tongue|mouth|brow|lash|mascara|EYE_CLEANUP/i;
function canOutline(mesh){
 const materials=[mesh.material].flat().filter(Boolean);
 return Boolean(mesh.isMesh&&materials.length&&materials.every(material=>
  !outlineExcluded.test(material.name||'')&&!material.transparent&&(material.opacity??1)>=.95));
}
function createCelOutline(mesh){
 mesh.geometry.computeBoundingBox();
 const height=mesh.geometry.boundingBox?.getSize(new THREE.Vector3()).y||1;
  const source=[mesh.material].flat().find(Boolean);
 const material=new THREE.MeshBasicMaterial({color:0x17121a,side:THREE.BackSide,toneMapped:false,fog:false,depthWrite:true,map:source?.alphaTest>0?source.map:null,alphaMap:source?.alphaMap,alphaTest:source?.alphaTest||0,alphaHash:source?.alphaHash===true});
 material.name='Yukino · cel outline';
 // glTF meshes from Tripo keep centimetre-scale geometry under a scaled root;
 // the render loop converts a constant screen width into each mesh's units.
 const thickness={value:Math.max(.0005,height*.0045)};
 material.userData.outlineThickness=thickness;
 outlineMaterials.add(material);
 material.onBeforeCompile=shader=>{
  shader.uniforms.yukinoOutlineThickness=thickness;
  shader.uniforms.yukinoOutlineWindow=outlineWindow;
  shader.vertexShader=`uniform float yukinoOutlineThickness;\nvarying vec2 vYukinoOutlineScreen;\n${shader.vertexShader}`.replace('#include <skinning_vertex>',`
   #include <skinning_vertex>
   #ifdef USE_SKINNING
    transformed += normalize(objectNormal) * yukinoOutlineThickness;
   #else
    transformed += normalize(normal) * yukinoOutlineThickness;
   #endif
  `).replace('#include <project_vertex>',`
   #include <project_vertex>
   vYukinoOutlineScreen = gl_Position.xy / gl_Position.w;
  `);
  shader.fragmentShader=`uniform vec2 yukinoOutlineWindow;\nvarying vec2 vYukinoOutlineScreen;\n${shader.fragmentShader}`.replace('void main() {',`
   void main() {
   if (abs(vYukinoOutlineScreen.x - yukinoOutlineWindow.x) < yukinoOutlineWindow.y * 0.2) discard;
  `);
 };
 material.customProgramCacheKey=()=> 'yukino-cel-outline';
 const outline=mesh.isSkinnedMesh?new THREE.SkinnedMesh(mesh.geometry,material):new THREE.Mesh(mesh.geometry,material);
 outline.name=(mesh.name||'mesh')+' · cel outline';
 outline.userData.celOutline=true;
 material.userData.outlineMesh=outline;
 outline.castShadow=outline.receiveShadow=false;
 outline.frustumCulled=false;
 outline.renderOrder=mesh.renderOrder;
 if(mesh.isSkinnedMesh){
  outline.bindMode=mesh.bindMode;
  outline.bind(mesh.skeleton,mesh.bindMatrix);
  outline.bindMatrixInverse.copy(mesh.bindMatrixInverse);
  outline.morphTargetDictionary=mesh.morphTargetDictionary;
  outline.morphTargetInfluences=mesh.morphTargetInfluences?[...mesh.morphTargetInfluences]:[];
  outline.onBeforeRender=()=>{
   const source=mesh.morphTargetInfluences,target=outline.morphTargetInfluences;
   if(source&&target)for(let i=0;i<target.length&&i<source.length;i++)target[i]=source[i];
  };
  if(mesh.geometry.getAttribute('skinIndex1'))installEightWeightMesh(outline);
 }
 mesh.add(outline);
 return outline;
}
function updateCelOutline(mesh,saved,style){
 if(style==='toon'&&canOutline(mesh)){
  if(!saved.outline)saved.outline=createCelOutline(mesh);
  saved.outline.visible=mesh.visible;
  return saved.outline;
 }
 if(saved.outline)saved.outline.visible=false;
 return saved.outline||null;
}
function toneCandidateHair(material){
 const toned=material.clone();
 toned.color?.multiply(new THREE.Color(0.79,0.77,0.71));
 toned.shadeColorFactor?.multiplyScalar(.9);
 if(Number.isFinite(toned.specularIntensity))toned.specularIntensity*=.7;
 if(Number.isFinite(toned.sheen))toned.sheen*=.7;
 return toned;
}
function softenCandidateFaceHighlights(material, candidate) {
 const head = Object.hasOwn(faceMaterials, candidate) ? faceMaterials[candidate] : null;
 const skin = candidate === 'winter-uniform' ? 'Winter face skin | soften mouth-corner normals only' : `REVIEW_skin__${head}`;
 if (!head || !material.isMeshStandardMaterial || material.name !== skin) return material;

 const softened = material.clone();
 const toneMapping = '#include <tonemapping_fragment>';
 softened.onBeforeCompile = shader => {
  // Compress bright linear luminance while preserving RGB ratios and the shadow range.
  shader.fragmentShader = shader.fragmentShader.replace(toneMapping, `
   float faceLuminance = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
   float excess = max(faceLuminance - 0.60, 0.0);
   float reduction = excess - excess / (1.0 + excess / 0.36);
   gl_FragColor.rgb *= 1.0 - reduction / max(faceLuminance, 0.60);
   ${toneMapping}`);
 };
 softened.customProgramCacheKey = () => 'yukino-face-highlight-rolloff';
 return softened;
}
export function applyRenderStyle(root,style='natural',{candidate=false}={}){
 root?.traverse(mesh=>{if(!mesh.isMesh||!mesh.material||/outline/i.test(mesh.name))return;let saved=styles.get(mesh);if(!saved){saved={original:mesh.material,toon:null,lit:null,natural:null,outline:null,retained:new Set()};styles.set(mesh,saved)}
  for(const material of [mesh.material].flat())if(material)saved.retained.add(material);
  if(style==='toon'&&!saved.toon){const convert=material=>{const color=material.color?.clone()||new THREE.Color(0xffffff),face=Object.hasOwn(faceMaterials,candidate)&&material.name===faceMaterials[candidate];const toon=new THREE.MeshToonMaterial(compactOptions({color,map:material.map,gradientMap:face?null:toonGradient(),transparent:material.transparent,opacity:material.opacity,alphaTest:material.alphaTest,alphaMap:material.alphaMap,side:material.side,depthWrite:material.depthWrite,vertexColors:material.vertexColors,normalMap:material.normalMap,normalScale:material.normalScale?.clone(),bumpMap:material.bumpMap,bumpScale:material.bumpScale,displacementMap:material.displacementMap,displacementScale:material.displacementScale,displacementBias:material.displacementBias,emissive:material.emissive?.clone()||new THREE.Color(0),emissiveMap:material.emissiveMap,emissiveIntensity:material.emissiveIntensity??1}));if(face)softenToonFace(toon,material);toon.name=material.name+' · cel preview';return toon;};saved.toon=Array.isArray(saved.original)?saved.original.map(convert):convert(saved.original);}
  if(candidate&&(style==='lit'||style==='natural')&&!saved.natural){const soften=material=>softenCandidateFaceHighlights(material,candidate);saved.natural=Array.isArray(saved.original)?saved.original.map(soften):soften(saved.original);}
  if(style==='lit'&&!saved.lit){const relight=material=>{
   if(candidate&&isHair(material))return toneCandidateHair(material);
   return material.isMeshBasicMaterial?new THREE.MeshStandardMaterial({color:material.color.clone(),map:material.map,alphaMap:material.alphaMap,alphaTest:material.alphaTest,opacity:material.opacity,transparent:material.transparent,side:material.side,depthWrite:material.depthWrite,vertexColors:material.vertexColors,roughness:.92,metalness:0}):material;
  };const base=saved.natural||saved.original;saved.lit=Array.isArray(base)?base.map(relight):relight(base);}
  mesh.material=style==='toon'?saved.toon:style==='lit'?saved.lit:(style==='natural'&&saved.natural)||saved.original;
  updateCelOutline(mesh,saved,style);
  if(mesh.geometry?.getAttribute('skinIndex1'))installEightWeightMesh(mesh);
 });
}
export function modelMaterials(mesh){const saved=styles.get(mesh),values=saved?[mesh.material,saved.original,saved.toon,saved.lit,saved.natural,saved.outline?.material,...saved.retained]:[mesh.material];return values.flat().filter(Boolean)}
export function updateCelOutlineWindow(root,camera,viewportHeight=0){
 if(!root||!camera)return null;
 camera.updateMatrixWorld(true);
 const box=new THREE.Box3().setFromObject(root);
 if(box.isEmpty())return null;
 const {min,max}=box,point=new THREE.Vector3();
 let low=Infinity,high=-Infinity;
 for(let i=0;i<8;i++){
  point.set(i&1?max.x:min.x,i&2?max.y:min.y,i&4?max.z:min.z);
  const depth=point.clone().applyMatrix4(camera.matrixWorldInverse).z;
  if(depth>=-camera.near)continue;
  point.project(camera);
  if(Number.isFinite(point.x)){low=Math.min(low,point.x);high=Math.max(high,point.x);}
 }
 if(!Number.isFinite(low)||!Number.isFinite(high)||high<=low)return null;
 const half=Math.max(.001,(high-low)/2);
 outlineWindow.value.set((low+high)/2,half);
 if(viewportHeight>0){
  const worldPerPixel=2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))/Math.max(1,viewportHeight);
  const position=new THREE.Vector3(),scale=new THREE.Vector3();
  for(const material of outlineMaterials){
   const mesh=material.userData.outlineMesh;
   if(!mesh){outlineMaterials.delete(material);continue;}
   mesh.getWorldPosition(position);
   mesh.getWorldScale(scale);
   const distance=camera.position.distanceTo(position);
   material.userData.outlineThickness.value=worldPerPixel*Math.max(0.01,distance)*1.15/Math.max(.0001,scale.y);
  }
 }
 return {center:outlineWindow.value.x,halfWidth:half};
}
export function cameraFrame(bounds,aspect,zoom=1,yaw=0){
 const z=Math.max(1,Math.min(2.2,Number(zoom)||1)),{size,center}=bounds,vertical=THREE.MathUtils.degToRad(30),horizontal=2*Math.atan(Math.tan(vertical/2)*Math.max(.1,aspect));
 const angle=THREE.MathUtils.degToRad(Number.isFinite(yaw)?yaw:0),cos=Math.abs(Math.cos(angle)),sin=Math.abs(Math.sin(angle));
 const width=size.x*cos+size.z*sin,depth=size.x*sin+size.z*cos;
 const base=Math.max(size.y/2/Math.tan(vertical/2),width/2/Math.tan(horizontal/2))*1.13+depth/2;
 const lift=size.y*.26*((z-1)/1.2),distance=Math.max(size.z*.7+.35,base/z);
 return {zoom:z,target:new THREE.Vector3(center.x,center.y+lift,center.z),position:new THREE.Vector3(center.x,center.y+lift,center.z+distance),near:Math.max(.001,distance/100),far:Math.max(20,distance*20)};
}
