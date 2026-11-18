import {AnimationMixer, Box3, MathUtils, Plane, Quaternion, Vector3} from 'three';

// Approved V2 07 keeps the beret as an independent mesh named
// Beret_Drag_Handle. The interaction is deliberately procedural: the exported
// action list has no accepted hat clips, so the hat prop, pointer and
// collision code are the only writers of the hat transform.
export const BERET_NEAR_HEAD_WIDTHS = .65;
export const BERET_FAR_HEAD_WIDTHS = .85;
const MAX_DRAG_DT = .1;
const FALL_GRAVITY = 9.8;
const BOUNCE = .28;

export function beretDropZone(distance, lastZone = 'near', {below = false} = {}) {
  if (below) return 'far';
  const value = Number.isFinite(distance) ? Math.max(0, distance) : Infinity;
  // Keep the previous side inside the hysteresis band. This prevents a hat
  // held just outside the wear anchor from flickering near/far every frame.
  const threshold = lastZone === 'near' ? BERET_FAR_HEAD_WIDTHS : BERET_NEAR_HEAD_WIDTHS;
  return value < threshold ? 'near' : 'far';
}

export function beretFallStep({y, velocity, dt, floorY, reducedMotion = false}) {
  if (y <= floorY && velocity <= 0) return {y: floorY, velocity: 0, contact: true};
  const step = Math.max(0, Math.min(MAX_DRAG_DT, Number.isFinite(dt) ? dt : 0));
  let nextVelocity = velocity - FALL_GRAVITY * step;
  let nextY = y + nextVelocity * step;
  let contact = false;
  if (nextY <= floorY) {
    nextY = floorY;
    contact = true;
    nextVelocity = reducedMotion || Math.abs(nextVelocity) <= .55 ? 0 : -nextVelocity * BOUNCE;
  }
  return {y: nextY, velocity: nextVelocity, contact};
}

function hatMesh(scene) {
  let found = null;
  scene.traverse(node => {
    if (found || !node.isMesh) return;
    if (node.name === 'Beret_Drag_Handle' || node.parent?.name === 'Beret_Drag_Handle') found = node;
  });
  return found;
}

function idleSample(gltf) {
  const scene = gltf.scene;
  const clip = gltf.animations?.find(item => item.name === 'Idle_Breathe')
    || gltf.animations?.find(item => /idle/i.test(item.name));
  if (!clip) return null;
  const mixer = new AnimationMixer(scene);
  mixer.clipAction(clip).play();
  mixer.update(0);
  scene.updateMatrixWorld(true);
  return mixer;
}

function releaseMixer(mixer) {
  if (!mixer) return;
  mixer.stopAllAction();
  mixer.uncacheRoot(mixer.getRoot());
}

function nearestVisibleHit(raycaster, scene, hat) {
  const hit = raycaster.intersectObject(hat, true)[0];
  if (!hit) return null;
  const front = raycaster.intersectObject(scene, true).find(({object, face}) => {
    for (let node = object; node; node = node.parent) if (!node.visible) return false;
    const material = Array.isArray(object.material) ? object.material[face?.materialIndex] : object.material;
    return material && material.visible && !material.isOutline && !/outline|inverted.?hull/i.test(material.name || '') &&
      (!material.transparent || material.opacity > .01);
  });
  return {hit, front};
}

function damp(current, target, time, dt) {
  if (!Number.isFinite(current)) return target;
  const factor = 1 - Math.exp(-Math.max(0, dt) / time);
  return MathUtils.lerp(current, target, factor);
}

function clampDegrees(value, bound) {
  return MathUtils.clamp(Number.isFinite(value) ? value : 0, -bound, bound);
}

function morphIndexes(scene, names) {
  const wanted = new Set(names), result = [];
  scene.traverse(node => {
    if (!node.isMesh || !node.morphTargetDictionary || !node.morphTargetInfluences) return;
    for (const [name, index] of Object.entries(node.morphTargetDictionary)) {
      if (wanted.has(name) && Number.isInteger(index)) result.push({node, index, name, original: null});
    }
  });
  return result;
}

function eyeAxes(eye, head) {
  if (!eye?.parent) return null;
  const parent = eye.parent.getWorldQuaternion(new Quaternion()).invert();
  const world = head.getWorldQuaternion(new Quaternion());
  const orientation = parent.multiply(world);
  return {
    right: new Vector3(1, 0, 0).applyQuaternion(orientation),
    up: new Vector3(0, 1, 0).applyQuaternion(orientation),
  };
}

function applyEye(eye, base, target, blend = 1) {
  if (!eye || !base || !target) return;
  const pitch = new Quaternion().setFromAxisAngle(target.right, MathUtils.degToRad(-target.pitch * blend));
  const yaw = new Quaternion().setFromAxisAngle(target.up, MathUtils.degToRad(target.yaw * blend));
  eye.quaternion.copy(base).premultiply(pitch).premultiply(yaw);
}

// Seats the independent hat on the head bone without turning it into a second
// skinned hat. The sample of the approved idle clip keeps the authored head
// position even when the imported armature rest pose is still a T-pose.
export function seatApprovedBeret(gltf) {
  const scene = gltf.scene;
  const hat = hatMesh(scene);
  const head = scene.getObjectByName('head') || scene.getObjectByName('J_Bip_C_Head');
  if (!hat || !head) return null;
  const mixer = idleSample(gltf);
  try {
    scene.updateMatrixWorld(true);
    const seatMatrix = head.matrixWorld.clone().invert().multiply(hat.matrixWorld);
    const seat = {
      position: new Vector3(), quaternion: new Quaternion(), scale: new Vector3(),
    };
    seatMatrix.decompose(seat.position, seat.quaternion, seat.scale);
    scene.attach(hat);
    scene.updateMatrixWorld(true);
    const box = new Box3().setFromObject(hat);
    const localMin = scene.worldToLocal(box.min.clone());
    const floorOffset = localMin.y - hat.position.y;
    hat.removeFromParent();
    head.add(hat);
    hat.position.copy(seat.position);
    hat.quaternion.copy(seat.quaternion);
    hat.scale.copy(seat.scale);
    scene.updateMatrixWorld(true);
    return {hat, head, seat, floorOffset};
  } finally {
    releaseMixer(mixer);
  }
}

export function bindApprovedBeret(gltf, {sourceBounds, onPenalty, reducedMotion = false, modelId = ''} = {}) {
  const scene = gltf.scene;
  const seated = seatApprovedBeret(gltf);
  if (!seated) return null;
  const {hat, head, seat, floorOffset} = seated;
  const eyes = [scene.getObjectByName('eye.L'), scene.getObjectByName('eye.R')].filter(Boolean);
  const faceMorphs = morphIndexes(scene, [
    'EA_angry_mouth', 'EA_brow_angry', 'EA_sad_mouth', 'EA_brow_sad',
    'EA_surprised_mouth', 'EA_brow_surprised', 'EA_blink',
  ]);
  const floorY = Number.isFinite(sourceBounds?.min?.y) ? sourceBounds.min.y : 0;
  const generation = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let counter = 0;
  let state = 'WORN';
  let active = false;
  let reduced = reducedMotion;
  let drag = null;
  let dragPlane = null;
  let grabOffset = new Vector3();
  let grabStart = 0;
  let maxLift = 0;
  let drop = null;
  let releaseId = '';
  let fromFloorInteraction = false;
  let lastZone = 'near';
  let lookUntil = 0;
  let blinkPulse = 0;
  let eyeBase = [null, null];
  let eyeTarget = null;
  let headYaw = 0;
  let headPitch = 0;
  let faceApplied = [];
  let speaking = false;
  const world = new Vector3(), worldTarget = new Vector3(), local = new Vector3();
  const worldQuaternion = new Quaternion(), worldScale = new Vector3();

  function sceneLocalPoint(point) {
    return scene.worldToLocal(point.clone());
  }

  function seatWorld() {
    const position = head.localToWorld(seat.position.clone());
    const quaternion = head.getWorldQuaternion(new Quaternion()).multiply(seat.quaternion);
    const scale = head.getWorldScale(new Vector3()).multiply(seat.scale);
    return {position, quaternion, scale};
  }

  function attachToHead() {
    scene.attach(hat);
    hat.removeFromParent();
    head.add(hat);
    hat.position.copy(seat.position);
    hat.quaternion.copy(seat.quaternion);
    hat.scale.copy(seat.scale);
    hat.updateMatrixWorld(true);
  }

  function restoreFace() {
    for (const {node, index, original} of faceApplied) {
      if (original !== null) node.morphTargetInfluences[index] = original;
    }
    faceApplied = [];
    for (const entry of faceMorphs) entry.original = null;
    for (let index = 0; index < eyes.length; index++) {
      if (eyeBase[index]) eyes[index].quaternion.copy(eyeBase[index]);
    }
  }

  function resetEyes() {
    for (let index = 0; index < eyes.length; index++) eyeBase[index] = eyes[index]?.quaternion.clone() || null;
  }

  function setState(next) {
    state = next;
    active = next === 'HELD' || next === 'DROP_NEAR' || next === 'DROP_FAR' || next === 'EQUIPPING' ||
      (next === 'FLOOR' && performance.now() < lookUntil);
  }

  function cancel() {
    const landed = state === 'FLOOR' || drop?.penaltyApplied === true || fromFloorInteraction;
    drag = null;
    dragPlane = null;
    drop = null;
    maxLift = 0;
    blinkPulse = 0;
    eyeTarget = null;
    headYaw = 0;
    headPitch = 0;
    lookUntil = 0;
    fromFloorInteraction = false;
    restoreFace();
    if (landed) {
      hat.position.y = floorY - floorOffset;
      hat.updateMatrixWorld(true);
      setState('FLOOR');
    } else {
      attachToHead();
      setState('WORN');
    }
    active = false;
  }

  function hitTest(raycaster) {
    scene.updateMatrixWorld(true);
    const found = nearestVisibleHit(raycaster, scene, hat);
    if (!found) return false;
    return found.front?.object === hat || !found.front || found.front.distance >= found.hit.distance - 1e-5;
  }

  function grab(pointerId, raycaster) {
    if (drag || !raycaster || (state !== 'WORN' && state !== 'FLOOR')) return false;
    if (!hitTest(raycaster)) return false;
    scene.updateMatrixWorld(true);
    const fromFloor = state === 'FLOOR';
    fromFloorInteraction = fromFloor;
    scene.attach(hat);
    scene.updateMatrixWorld(true);
    const point = hat.getWorldPosition(new Vector3());
    dragPlane = new Plane().setFromNormalAndCoplanarPoint(raycaster.ray.direction.clone().normalize(), point);
    const planePoint = raycaster.ray.intersectPlane(dragPlane, new Vector3()) || point.clone();
    grabOffset = hat.position.clone().sub(sceneLocalPoint(planePoint));
    grabStart = point.y;
    maxLift = 0;
    drag = {pointerId, fromFloor};
    drop = null;
    blinkPulse = 0;
    lastZone = fromFloor ? 'far' : 'near';
    setState('HELD');
    restoreFace();
    return true;
  }

  function moveRay(pointerId, raycaster) {
    if (!drag || drag.pointerId !== pointerId || state !== 'HELD' || !dragPlane || !raycaster) return false;
    const point = raycaster.ray.intersectPlane(dragPlane, new Vector3());
    if (!point) return false;
    hat.position.copy(sceneLocalPoint(point)).add(grabOffset);
    const minY = floorY - floorOffset;
    if (hat.position.y < minY) hat.position.y = minY;
    hat.updateMatrixWorld(true);
    maxLift = Math.max(maxLift, hat.getWorldPosition(world).y - grabStart);
    return true;
  }

  function release(pointerId) {
    if (!drag || drag.pointerId !== pointerId || state !== 'HELD') return false;
    const fromFloor = drag.fromFloor;
    drag = null;
    dragPlane = null;
    const hatWorld = hat.getWorldPosition(new Vector3());
    const target = seatWorld();
    const eyeWidth = eyes.length === 2
      ? eyes[0].getWorldPosition(new Vector3()).distanceTo(eyes[1].getWorldPosition(new Vector3()))
      : 0;
    const headWidth = Math.max(.06, eyeWidth * 2.2);
    const horizontal = hatWorld.clone().sub(target.position);
    horizontal.y = 0;
    const distance = horizontal.length() / headWidth;
    const below = hatWorld.y < target.position.y - headWidth * .35;
    const zone = beretDropZone(distance, lastZone, {below});
    lastZone = zone;
    const lifted = !fromFloor || maxLift > headWidth * .12;
    releaseId = `beret-${generation}-${++counter}`;
    if (zone === 'near' && lifted) {
      drop = {
        kind: 'near',
        from: hat.position.clone(),
        fromQuaternion: hat.quaternion.clone(),
        target: target.position,
        elapsed: 0,
        duration: reduced ? .08 : .24,
      };
      setState('DROP_NEAR');
      return true;
    }
    if (!lifted) {
      // Releasing a hat that is already resting on the floor without lifting it
      // is not a new far-drop event.
      drop = {kind: 'floor', targetY: floorY - floorOffset};
      setState('DROP_FAR');
      return true;
    }
    drop = {
      kind: 'far',
      velocity: 0,
      contacts: 0,
      penaltyApplied: false,
      targetY: floorY - floorOffset,
      look: true,
    };
    lookUntil = performance.now() + 2400;
    setState('DROP_FAR');
    return true;
  }

  function update(dt, {speaking: isSpeaking = false} = {}) {
    speaking = isSpeaking;
    resetEyes();
    const elapsed = Math.max(0, Math.min(MAX_DRAG_DT, Number.isFinite(dt) ? dt : 0));
    if (state === 'DROP_NEAR' && drop?.kind === 'near') {
      drop.elapsed += elapsed;
      const t = drop.duration <= 0 ? 1 : MathUtils.clamp(drop.elapsed / drop.duration, 0, 1);
      const eased = t * t * (3 - 2 * t);
      const targetLocal = sceneLocalPoint(drop.target);
      hat.position.lerpVectors(drop.from, targetLocal, eased);
      const sceneQuaternion = scene.getWorldQuaternion(new Quaternion()).invert();
      const targetQuaternion = sceneQuaternion.multiply(
        head.getWorldQuaternion(new Quaternion()).multiply(seat.quaternion),
      );
      hat.quaternion.slerpQuaternions(drop.fromQuaternion, targetQuaternion, eased);
      if (t >= 1) {
        attachToHead();
        blinkPulse = 1;
        drop = null;
        fromFloorInteraction = false;
        setState('WORN');
      }
    } else if (state === 'DROP_FAR' && drop) {
      if (drop.kind === 'floor') {
        hat.position.y = drop.targetY;
        hat.updateMatrixWorld(true);
        drop = null;
        setState('FLOOR');
      } else if (drop.kind === 'far') {
        const fall = beretFallStep({
          y: hat.position.y,
          velocity: drop.velocity,
          dt: elapsed,
          floorY: drop.targetY,
          reducedMotion: reduced,
        });
        hat.position.y = fall.y;
        drop.velocity = fall.velocity;
        hat.updateMatrixWorld(true);
        if (fall.contact) {
          drop.contacts += 1;
          if (!drop.penaltyApplied) {
            drop.penaltyApplied = true;
            onPenalty?.({id: releaseId, modelId});
          }
          if (drop.velocity === 0) {
            drop = null;
            setState('FLOOR');
          }
        }
      }
    } else if (state === 'FLOOR') {
      if (performance.now() >= lookUntil) active = false;
    }

    // Eye target uses the actual hat transform, not the screen pointer. The
    // head follows with a slower time constant so the eyes lead.
    const hatWorld = hat.getWorldPosition(world);
    const headWorld = head.getWorldPosition(worldTarget);
    const direction = hatWorld.clone().sub(headWorld).normalize();
    const headOrientation = head.getWorldQuaternion(worldQuaternion);
    const localDirection = direction.applyQuaternion(headOrientation.clone().invert());
    const rawYaw = MathUtils.radToDeg(Math.atan2(localDirection.x, localDirection.z));
    const rawPitch = MathUtils.radToDeg(Math.asin(MathUtils.clamp(localDirection.y, -1, 1)));
    const targetYaw = clampDegrees(rawYaw, 22);
    const targetPitch = clampDegrees(-rawPitch, 24);
    headYaw = damp(headYaw, targetYaw, .16, elapsed);
    headPitch = damp(headPitch, targetPitch, .16, elapsed);
    eyeTarget = {
      yaw: clampDegrees(rawYaw * .9, 18),
      pitch: clampDegrees(-rawPitch * .7, 15),
      right: eyes[0] ? eyeAxes(eyes[0], head)?.right : null,
      up: eyes[0] ? eyeAxes(eyes[0], head)?.up : null,
    };
    blinkPulse = Math.max(0, blinkPulse - elapsed * 3.6);
    const looking = state === 'HELD' || state === 'DROP_NEAR' || state === 'DROP_FAR' ||
      (state === 'FLOOR' && performance.now() < lookUntil);
    return {
      active: looking && !speaking,
      headYaw,
      headPitch,
      eyeX: eyeTarget?.yaw ? eyeTarget.yaw / 22 : 0,
      eyeY: eyeTarget?.pitch ? -eyeTarget.pitch / 16 : 0,
    };
  }

  function expressionWeights() {
    if (state === 'DROP_NEAR') return {surprise: .22, blink: blinkPulse * .9};
    if (state === 'DROP_FAR') return {sad: .16, angry: .05};
    if (state === 'FLOOR') return {sad: .12};
    if (state === 'HELD') return maxLift > .12 ? {angry: .16} : {};
    return {};
  }

  function applyFace(pointerEyeY, {speaking: isSpeaking = speaking} = {}) {
    const looking = state === 'HELD' || state === 'DROP_NEAR' || state === 'DROP_FAR' ||
      (state === 'FLOOR' && performance.now() < lookUntil);
    if (!looking) return;
    const weights = expressionWeights();
    const set = (name, amount) => {
      if (!Number.isFinite(amount) || amount <= 0) return;
      const isMouth = /mouth|_aa$|_ih$|_ou$|_ee$|_oh$/i.test(name);
      if (isSpeaking && isMouth) return;
      for (const entry of faceMorphs) {
        if (entry.name !== name) continue;
        if (entry.original === null) entry.original = entry.node.morphTargetInfluences[entry.index];
        faceApplied.push({node: entry.node, index: entry.index, original: entry.original});
        entry.node.morphTargetInfluences[entry.index] = Math.max(entry.original, amount);
      }
    };
    set('EA_surprised_mouth', weights.surprise || 0);
    set('EA_brow_surprised', weights.surprise || 0);
    set('EA_sad_mouth', weights.sad || 0);
    set('EA_brow_sad', weights.sad || 0);
    set('EA_angry_mouth', weights.angry || 0);
    set('EA_brow_angry', weights.angry || 0);
    set('EA_blink', weights.blink || 0);
    if (!eyes.length || !eyeTarget) return;
    for (let index = 0; index < eyes.length; index++) {
      const eye = eyes[index];
      if (!eyeBase[index]) continue;
      const axes = eyeAxes(eye, head);
      if (!axes) continue;
      applyEye(eye, eyeBase[index], {...eyeTarget, ...axes});
    }
  }

  return {
    get active() { return active; },
    get lift() { return maxLift; },
    get state() { return state; },
    get releaseId() { return releaseId; },
    setReducedMotion(value) { reduced = value === true; },
    hitTest,
    grab,
    moveRay,
    release,
    update,
    positionHat() {
      if (state === 'WORN') attachToHead();
    },
    applyFace,
    restoreFace,
    cancel,
    dispose() {
      cancel();
      if (hat.parent !== scene) scene.add(hat);
      faceApplied = [];
      eyes.length = 0;
    },
  };
}
