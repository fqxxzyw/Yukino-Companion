import {Vector3} from 'three';

const boneNames = {
  head:'J_Bip_C_Head', neck:'J_Bip_C_Neck',
  leftUpperArm:'J_Bip_L_UpperArm', rightUpperArm:'J_Bip_R_UpperArm',
};

export function bindAvatarTouchZones(gltf, entry) {
  if (!gltf?.scene || entry?.custom || entry?.importMode === 'static') return null;
  if (entry?.characterId !== 'yukino' && !/^yukino-0[1-7]-/.test(entry?.id || '')) return null;
  const {scene} = gltf;
  const humanoid = gltf.userData?.vrm?.humanoid;
  const bone = key => humanoid?.getRawBoneNode(key) || scene.getObjectByName(boneNames[key]);
  const head = bone('head'), neck = bone('neck'), left = bone('leftUpperArm'), right = bone('rightUpperArm');
  if (![head,neck,left,right].every(Boolean)) return null;

  scene.updateMatrixWorld(true);
  const position = node => node.getWorldPosition(new Vector3());
  const origin = position(head);
  const up = new Vector3(0,1,0).transformDirection(scene.matrixWorld);
  const across = position(left).sub(position(right)).normalize();
  across.addScaledVector(up,-up.dot(across)).normalize();
  const front = across.clone().cross(up).normalize();
  if (!front.lengthSq()) return null;
  const localAxis = direction => head.worldToLocal(origin.clone().add(direction)).normalize();
  const unit = head.worldToLocal(position(neck)).length();
  if (!Number.isFinite(unit) || unit <= 1e-6) return null;
  const meshes = new Set(scene.getObjectsByProperty('isMesh',true));
  return {head,left,right,unit,meshes,across:localAxis(across),up:localAxis(up),front:localAxis(front)};
}

function visibleMaterial(hit, meshes) {
  if (!meshes.has(hit.object)) return null;
  for (let object=hit.object; object; object=object.parent) {
    if (!object.visible) return null;
  }
  const materials = hit.object.material;
  const material = Array.isArray(materials) ? materials[hit.face?.materialIndex] : materials;
  if (!material || !material.visible || /outline|inverted.?hull/i.test(material.name)) return null;
  if (material.transparent && material.opacity <= .01) return null;
  return material;
}

export function hitAvatarTouchZone({x,y,rect,camera,root,zones,raycaster,beret}) {
  if (!root || !camera || !zones || !raycaster || !rect || rect.width<=0 || rect.height<=0) return null;
  const u = (x-rect.left)/rect.width, v = (y-rect.top)/rect.height;
  if (!Number.isFinite(u) || !Number.isFinite(v) || u<0 || u>=1 || v<0 || v>=1) return null;
  root.updateMatrixWorld(true);
  camera.updateMatrixWorld();
  raycaster.setFromCamera({x:2*u-1,y:1-2*v},camera);
  if (beret?.active || beret?.hitTest(raycaster)) return null;
  for (const hit of raycaster.intersectObject(root,true)) {
    const material = visibleMaterial(hit,zones.meshes);
    if (!material) continue;
    const {head,unit,across,up,front,left,right} = zones;
    const point = head.worldToLocal(hit.point.clone());
    const side = Math.abs(point.dot(across)/unit);
    const height = point.dot(up)/unit;
    const depth = point.dot(front)/unit;
    const hair = /hair|accessor/i.test(material.name);
    if (height>=1.03 && height<=3.5 && side<=1.5 && depth>=-.95 && depth<=1.95) return 'head';
    if (!hair && height>=.04 && height<1.03 && side<=.83 && depth>=.34 && depth<=1.6) return 'face';
    if (hair || height>-.62 || height< -2.35) return null;

    // Restrict the boundary to the outside of either shoulder. A center
    // torso, neck, arm below the shoulder, or transparent gap never counts.
    const shoulders = [left,right].map(bone=>head.worldToLocal(bone.getWorldPosition(new Vector3())));
    const halfWidth = Math.abs(shoulders[0].clone().sub(shoulders[1]).dot(across))/2;
    if (halfWidth<=0 || Math.abs(point.dot(across))<halfWidth*.68) return null;
    return shoulders.some(shoulder=>point.distanceTo(shoulder)<=unit*.91) ? 'near' : null;
  }
  return null;
}

const TAP_DISTANCE = 5;
const TAP_TIME = 420;
const STROKE_MIN_TIME = 230;
const STROKE_MAX_TIME = 1350;
const STROKE_MIN_PATH = 13;
const STROKE_MAX_TRAVEL = 29;
const SAMPLE_GAP = 32;

export function createAvatarTouchGesture({hitZone, makeId=()=>crypto.randomUUID(), now=()=>performance.now()}) {
  let active;

  function begin(event) {
    const {pointerId,clientX:x,clientY:y} = event;
    const time = now();
    active = {pointerId,x,y,prevX:x,prevY:y,time,sampled:time,path:0,travel:0,
      zone:hitZone(x,y),orbit:false,leftHead:false};
  }

  function move(event, final=false) {
    if (!active || active.pointerId!==event.pointerId) return false;
    if (active.orbit) return true;
    const {clientX:x,clientY:y} = event;
    const time = now();
    active.path += Math.hypot(x-active.prevX,y-active.prevY);
    active.prevX=x; active.prevY=y;
    active.travel=Math.max(active.travel,Math.hypot(x-active.x,y-active.y));
    if (active.zone==='head' && active.travel>TAP_DISTANCE && (final || time-active.sampled>=SAMPLE_GAP)) {
      active.sampled=time;
      if (hitZone(x,y)!=='head') active.leftHead=true;
    }
    active.orbit=active.zone==='head'
      ? active.travel>STROKE_MAX_TRAVEL || active.travel>TAP_DISTANCE&&(active.leftHead||time-active.time>STROKE_MAX_TIME)
      : active.travel>TAP_DISTANCE;
    return active.orbit;
  }

  function end(event) {
    if (!active || active.pointerId!==event.pointerId) return null;
    move(event,true);
    const {zone,orbit,travel,path,time,leftHead} = active;
    active=undefined;
    if (orbit || !zone || hitZone(event.clientX,event.clientY)!==zone) return null;
    const elapsed=now()-time;
    if (travel<=TAP_DISTANCE && path<=TAP_DISTANCE*2 && elapsed<=TAP_TIME) return {id:makeId(),zone,gesture:'tap'};
    if (zone==='head' && !leftHead && path>=STROKE_MIN_PATH && elapsed>=STROKE_MIN_TIME && elapsed<=STROKE_MAX_TIME) {
      return {id:makeId(),zone,gesture:'stroke'};
    }
    return null;
  }

  return {begin,move,end,cancel:()=>{active=undefined;}};
}
