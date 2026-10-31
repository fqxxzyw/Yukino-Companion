import * as THREE from 'three';

// A window-fixed street camera, shared by the passive background and the
// character's off-axis sub-view. Panel movement NEVER translates the street.
export const CITY_STAGE_OFFSET=Object.freeze([0,-.14,-1.6]);
export function fitCityStreetCamera(camera,width,height,view){
 if(!(width>0&&height>0))return false;
 camera.clearViewOffset();camera.fov=34;camera.aspect=width/height;
 camera.near=.05;camera.far=100;camera.position.set(0,2.3,5.8);
 camera.lookAt(0,1.35,0);camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
 if(view?.width>0&&view?.height>0){
  camera.setViewOffset(width,height,view.left,view.top,view.width,view.height);
  camera.updateMatrixWorld(true);
 }
 return true;
}

// Place an outer, disposable stage anchor, not authored skeleton transforms.
// Mapping is done against the FULL camera before applying the panel crop.
export function cityCharacterAnchor(camera,viewport,panel,zoom=1){
 const x=(panel.left+panel.width/2)/viewport.width*2-1;
 const y=1-(panel.top+panel.height*.94)/viewport.height*2;
 const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(x,y),camera);
 const position=ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,0,1),-.2),new THREE.Vector3());
 if(!position||!Number.isFinite(position.x)||!Number.isFinite(position.z))return null;
 // A reserved foreground strip on the pavement: the frame only changes X,
 // never sends the actor into the bike, guardrail, shop or an invented floor.
 position.x=THREE.MathUtils.clamp(position.x,-2.9,4.3);position.y=0;position.z=.2;
 return {position,scale:THREE.MathUtils.clamp(Number(zoom)||1,1,2.2)};
}

// Only presentation staging changes: the standalone collectible keeps its
// original layout. The pavement stays put while the shop and props retreat .9m.
const groundRole=/^(?:plinth-|ground$|road$|dim-alley$|sidewalk(?:-curb)?$|paving-seam$|zebra-crossing$|parking-line$|drain(?:-grate)?$|puddle(?:-|$)|wet-)/;
const stagedPositions=new WeakMap();
export function stageCityForeground(environment,atmosphere){
 if(environment?.userData?.environmentId!=='city')return;
 for(const mesh of environment.children.slice(0,environment.userData.stats.drawCalls)){
  if(!mesh.isInstancedMesh||!mesh.name.startsWith('city:')||groundRole.test(mesh.userData.role))continue;
  if(!stagedPositions.has(mesh))stagedPositions.set(mesh,mesh.position.z);
  mesh.position.z=stagedPositions.get(mesh)-.9;mesh.updateMatrix();
 }
 for(const object of atmosphere?.group.children||[]){
  if(object.isReflector)continue;
  if(!stagedPositions.has(object))stagedPositions.set(object,object.position.z);
  object.position.z=stagedPositions.get(object)-.9;
 }
}

export function cityStageRects(container){
 const root=container?.closest?.('.app');
 const viewport=root?.getBoundingClientRect?.(),panel=container?.getBoundingClientRect?.();
 if(!viewport?.width||!viewport?.height||!panel?.width||!panel?.height)return null;
 return {viewport:{width:viewport.width,height:viewport.height},panel:{left:panel.left-viewport.left,top:panel.top-viewport.top,width:panel.width,height:panel.height}};
}
