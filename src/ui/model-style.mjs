import * as THREE from 'three';
import {installEightWeightMesh} from './eight-weight-skinning.mjs';
const styles=new WeakMap();
const compactOptions=value=>Object.fromEntries(Object.entries(value).filter(([,item])=>item!==undefined));
export function applyRenderStyle(root,style='natural'){
 root?.traverse(mesh=>{if(!mesh.isMesh||!mesh.material||/outline/i.test(mesh.name))return;let saved=styles.get(mesh);if(!saved){saved={original:mesh.material,toon:null,lit:null,retained:new Set()};styles.set(mesh,saved)}
  for(const material of [mesh.material].flat())if(material)saved.retained.add(material);
  if(style==='toon'&&!saved.toon){const convert=material=>{const gradient=new THREE.DataTexture(new Uint8Array([42,108,185,255]),4,1,THREE.RedFormat);gradient.minFilter=THREE.NearestFilter;gradient.magFilter=THREE.NearestFilter;gradient.generateMipmaps=false;gradient.needsUpdate=true;const toon=new THREE.MeshToonMaterial(compactOptions({color:material.color?.clone()||new THREE.Color(0xffffff),map:material.map,gradientMap:gradient,transparent:material.transparent,opacity:material.opacity,alphaTest:material.alphaTest,alphaMap:material.alphaMap,side:material.side,depthWrite:material.depthWrite,vertexColors:material.vertexColors,normalMap:material.normalMap,normalScale:material.normalScale?.clone(),bumpMap:material.bumpMap,bumpScale:material.bumpScale,displacementMap:material.displacementMap,displacementScale:material.displacementScale,displacementBias:material.displacementBias,emissive:material.emissive?.clone()||new THREE.Color(0),emissiveMap:material.emissiveMap,emissiveIntensity:material.emissiveIntensity??1}));toon.name=material.name+' · cel preview';return toon;};saved.toon=Array.isArray(saved.original)?saved.original.map(convert):convert(saved.original);}
  if(style==='lit'&&!saved.lit){const relight=material=>material.isMeshBasicMaterial?new THREE.MeshStandardMaterial({color:material.color.clone(),map:material.map,alphaMap:material.alphaMap,alphaTest:material.alphaTest,opacity:material.opacity,transparent:material.transparent,side:material.side,depthWrite:material.depthWrite,vertexColors:material.vertexColors,roughness:.92,metalness:0}):material;saved.lit=Array.isArray(saved.original)?saved.original.map(relight):relight(saved.original);}
  mesh.material=style==='toon'?saved.toon:style==='lit'?saved.lit:saved.original;
  if(mesh.geometry?.getAttribute('skinIndex1'))installEightWeightMesh(mesh);
 });
}
export function modelMaterials(mesh){const saved=styles.get(mesh),values=saved?[mesh.material,saved.original,saved.toon,saved.lit,...saved.retained]:[mesh.material];return values.flat().filter(Boolean)}
export function cameraFrame(bounds,aspect,zoom=1){
 const z=Math.max(1,Math.min(2.2,Number(zoom)||1)),{size,center}=bounds,vertical=THREE.MathUtils.degToRad(30),horizontal=2*Math.atan(Math.tan(vertical/2)*Math.max(.1,aspect));
 const base=Math.max(size.y/2/Math.tan(vertical/2),Math.hypot(size.x,size.z)/2/Math.tan(horizontal/2))*1.13+size.z/2;
 const lift=size.y*.26*((z-1)/1.2),distance=Math.max(size.z*.7+.35,base/z);
 return {zoom:z,target:new THREE.Vector3(center.x,center.y+lift,center.z),position:new THREE.Vector3(center.x,center.y+lift,center.z+distance),near:Math.max(.001,distance/100),far:Math.max(20,distance*20)};
}
