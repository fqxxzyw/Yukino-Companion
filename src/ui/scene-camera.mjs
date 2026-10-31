import * as THREE from 'three';

export const DIORAMA_VIEW=Object.freeze({fov:36,padding:1.12,minPolar:Math.PI*.12,maxPolar:Math.PI*.48,minZoom:.45,maxZoom:3.2});
const defaultDirection=new THREE.Vector3(1.25,1,1.5).normalize();
// A bounding sphere fits at every azimuth, including the base's far corners.
// Fit against the narrower FOV, so portrait windows never crop a square plinth.
export function dioramaFrame(bounds,aspect=1,options={}){
 const sphere=bounds.getBoundingSphere(new THREE.Sphere());
 const fov=Number.isFinite(options.fov)?options.fov:DIORAMA_VIEW.fov;
 const padding=Number.isFinite(options.padding)?options.padding:DIORAMA_VIEW.padding;
 const vertical=THREE.MathUtils.degToRad(fov)/2;
 const horizontal=Math.atan(Math.tan(vertical)*Math.max(.05,aspect));
 let distance=Math.max(1,sphere.radius)*padding/Math.sin(Math.min(vertical,horizontal));
 const direction=options.direction?.length===3
  ?new THREE.Vector3(...options.direction).normalize()
  :defaultDirection.clone();
 if(options.tight===true){
  // A sphere fit is safe at every azimuth but leaves a large air gap at a wide
  // fixed viewing angle. For a curated first view, find a closer distance that
  // still keeps all eight base bounds inside the frame, and leave a small margin.
  const corners=[];
  for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z])corners.push(new THREE.Vector3(x,y,z));
  const camera=new THREE.PerspectiveCamera(fov,Math.max(.05,aspect),.1,10000);
  const fits=d=>{
   camera.position.copy(sphere.center).addScaledVector(direction,d);camera.lookAt(sphere.center);camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
   let maxX=0,maxY=0;
   for(const corner of corners){const p=corner.clone().project(camera);maxX=Math.max(maxX,Math.abs(p.x));maxY=Math.max(maxY,Math.abs(p.y))}
   return maxX<=.92&&maxY<=.88;
  };
  let low=Math.max(.5,sphere.radius*.35),high=distance*1.6;
  for(let i=0;i<24;i++){const mid=(low+high)/2;if(fits(mid))high=mid;else low=mid}
  if(fits(high))distance=high;
 }
 return {target:sphere.center.clone(),distance,position:sphere.center.clone().addScaledVector(direction,distance),radius:sphere.radius,fov,direction:[direction.x,direction.y,direction.z]};
}

export function galleryKey(camera,target,key,limits={}){
 const offset=camera.position.clone().sub(target),spherical=new THREE.Spherical().setFromVector3(offset);
 const minPolar=Number.isFinite(limits.minPolar)?limits.minPolar:DIORAMA_VIEW.minPolar;
 const maxPolar=Number.isFinite(limits.maxPolar)?limits.maxPolar:DIORAMA_VIEW.maxPolar;
 if(key==='ArrowLeft')spherical.theta-=.1;
 else if(key==='ArrowRight')spherical.theta+=.1;
 else if(key==='ArrowUp')spherical.phi=Math.max(minPolar,spherical.phi-.08);
 else if(key==='ArrowDown')spherical.phi=Math.min(maxPolar,spherical.phi+.08);
 else return false;
 camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(spherical));camera.lookAt(target);return true;
}
