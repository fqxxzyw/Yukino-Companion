import * as THREE from 'three';
export function sceneStageRects(container){
 const viewport=container?.closest?.('.app')?.getBoundingClientRect?.(),panel=container?.getBoundingClientRect?.();
 if(!viewport?.width||!viewport?.height||!panel?.width||!panel?.height)return null;
 return {viewport:{width:viewport.width,height:viewport.height},panel:{left:panel.left-viewport.left,top:panel.top-viewport.top,width:panel.width,height:panel.height}};
}
// Use the background's FULL camera before cropping the transparent model view.
// A replaceable outer anchor owns positioning; authored model/skeleton stay intact.
export function sceneCharacterPlacement(camera,viewport,panel,{floorY=0,zoom=1,fallback=[0,0,6]}={}){
 const ndc=new THREE.Vector2((panel.left+panel.width/2)/viewport.width*2-1,1-(panel.top+panel.height*.94)/viewport.height*2);
 const ray=new THREE.Raycaster();ray.setFromCamera(ndc,camera);
 const position=ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),-floorY),new THREE.Vector3());
 const point=position&&position.distanceTo(camera.position)<300?position:new THREE.Vector3(...fallback);
 const foot=point.clone().project(camera),top=point.clone().add(new THREE.Vector3(0,2,0)).project(camera);
 const pixels=Math.abs(top.y-foot.y)*viewport.height/2;
 const scale=THREE.MathUtils.clamp(panel.height*.79/Math.max(1,pixels),.25,4)*THREE.MathUtils.clamp(zoom,1,2.2);
 return {position:point,scale,yaw:Math.atan2(camera.position.x-point.x,camera.position.z-point.z)};
}
export function copySceneCamera(camera,full,viewport,panel){
 camera.copy(full);camera.clearViewOffset();camera.aspect=viewport.width/viewport.height;camera.updateProjectionMatrix();
 camera.setViewOffset(viewport.width,viewport.height,panel.left,panel.top,panel.width,panel.height);camera.updateMatrixWorld(true);
}
