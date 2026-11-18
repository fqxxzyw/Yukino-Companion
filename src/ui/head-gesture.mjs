import {Quaternion} from 'three';
import gestures from './head-gestures.json' with {type:'json'};

// The curves are extracted from the already-playable Yukino07 Look_Left,
// Look_Right and Question_Tilt clips. Only the neck/head tracks are used; the
// runtime applies their local rotation delta additively, so hair and springs
// keep following the head without rebinding the body.
export const HEAD_GESTURE_IDS = Object.freeze(['tilt', 'look-left', 'look-right']);
const IDENTITY = new Quaternion();

function findBone(scene, names) {
  for (const name of names) {
    const node = scene.getObjectByName(name);
    if (node) return node;
  }
  return null;
}

function sampleTrack(rows, time) {
  if (!Array.isArray(rows) || !rows.length) return IDENTITY.clone();
  if (time <= rows[0][0]) return new Quaternion(rows[0][1], rows[0][2], rows[0][3], rows[0][4]);
  if (time >= rows.at(-1)[0]) {
    const row = rows.at(-1);
    return new Quaternion(row[1], row[2], row[3], row[4]);
  }
  let low = 0, high = rows.length - 1;
  while (low + 1 < high) {
    const middle = (low + high) >> 1;
    if (rows[middle][0] <= time) low = middle;
    else high = middle;
  }
  const from = rows[low], to = rows[high];
  const span = to[0] - from[0];
  const t = span > 1e-8 ? (time - from[0]) / span : 0;
  return new Quaternion(from[1], from[2], from[3], from[4]).slerp(
    new Quaternion(to[1], to[2], to[3], to[4]), t,
  );
}

export function bindHeadGesture(gltf, {onStatus = () => {}} = {}) {
  const {scene} = gltf || {};
  if (!scene) return null;
  const neck = findBone(scene, ['neck', 'J_Bip_C_Neck']);
  const head = findBone(scene, ['head', 'J_Bip_C_Head']);
  if (!neck || !head) return null;
  let active = null;
  let elapsed = 0;
  let name = '';
  let applied = false;
  let baseNeck = null;
  let baseHead = null;

  function restore() {
    if (!applied) return;
    neck.quaternion.copy(baseNeck);
    head.quaternion.copy(baseHead);
    applied = false;
  }

  function cancel() {
    restore();
    active = null;
    elapsed = 0;
    name = '';
  }

  function play(id, {speaking = false} = {}) {
    const clip = gestures.clips?.[id];
    if (!clip || speaking) return false;
    restore();
    active = clip;
    name = id;
    elapsed = 0;
    onStatus({name:id,duration:clip.duration});
    return true;
  }

  function applyWorld(bone, delta) {
    bone.updateWorldMatrix(true, false);
    const parent = bone.parent;
    if (!parent) return;
    parent.updateWorldMatrix(true, false);
    const parentWorld = parent.getWorldQuaternion(new Quaternion());
    const world = bone.getWorldQuaternion(new Quaternion());
    const targetWorld = delta.clone().multiply(world);
    bone.quaternion.copy(parentWorld.invert().multiply(targetWorld));
    bone.updateWorldMatrix(false, true);
  }

  function update(dt) {
    if (!active) return null;
    const step = Math.max(0, Math.min(.1, Number.isFinite(dt) ? dt : 0));
    elapsed += step;
    const time = Math.min(active.duration, elapsed);
    baseNeck = neck.quaternion.clone();
    baseHead = head.quaternion.clone();
    applyWorld(neck, sampleTrack(active.neck, time));
    applyWorld(head, sampleTrack(active.head, time));
    applied = true;
    const running = elapsed < active.duration;
    if (!running) {
      active = null;
      name = '';
    }
    return {name, time, running};
  }

  return {
    get active() { return Boolean(active); },
    get name() { return name; },
    play,
    update,
    restore,
    cancel,
  };
}
