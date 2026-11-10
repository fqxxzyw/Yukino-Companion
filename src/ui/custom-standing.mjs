import {AnimationClip, PropertyBinding, Quaternion, QuaternionKeyframeTrack, Vector3} from 'three';

const sides = ['left', 'right'];
const dropAngle = 14 * Math.PI / 180;

function standingName(value) {
  const name = value.split(/[|/:]/).at(-1).trim().replace(/[.\s_-]\d+$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').toLowerCase();
  return /^(?:(?:idle|neutral|relaxed|default) )?stand(?:ing)?(?: (?:idle|pose|relaxed|neutral|loop|animation))?$/.test(name) ||
    /^(?:站立(?:姿势|待机|动作)?|站姿|待机站姿|直立(?:姿势|待机)?|立ち姿|立ちポーズ|立ち待機)$/.test(name);
}

function animatedBones(clip, scene) {
  const bones = new Set();
  for (const track of clip.tracks) {
    let binding;
    try { binding = PropertyBinding.parseTrackName(track.name); } catch { continue; }
    const {nodeName, propertyName} = binding;
    if (!['quaternion', 'position', 'scale'].includes(propertyName)) continue;
    const node = PropertyBinding.findNode(scene, nodeName);
    if (node?.isBone) bones.add(node);
  }
  return bones;
}

function boneName(name) {
  return name.split(/[|:]/).at(-1).toLowerCase().replace(/[^a-z\d]/g, '')
    .replace(/^(?:mixamorig\d*|triporig|tripo3d|tripo|jbip|armature|def|bip\d*|bone)+/, '');
}

function namedRig(gltf) {
  const bones = new Map();
  gltf.scene.traverse(node => {
    if (!node.isBone) return;
    const sourceIndex = gltf.parser?.associations?.get(node)?.nodes;
    const sourceName = gltf.parser?.json?.nodes?.[sourceIndex]?.name;
    const name = boneName(typeof sourceName === 'string' && sourceName ? sourceName : node.name);
    if (bones.has(name)) bones.set(name, null);
    else bones.set(name, node);
  });
  const find = names => names.map(name => bones.get(name)).find(Boolean);
  const limb = (side, names) => find(names.flatMap(name => [side + name, name + side, side[0] + name, name + side[0]]));
  return {
    hips: find(['hips', 'chips', 'pelvis', 'cpelvis', 'hip']),
    torso: find(['upperchest', 'cupperchest', 'chest', 'cchest', 'spine2', 'spine02', 'spine1', 'spine01', 'spine', 'cspine', 'head', 'chead']),
    arms: sides.map(side => ({
      upper: limb(side, ['upperarm', 'armupper', 'arm']),
      lower: limb(side, ['lowerarm', 'armlower', 'forearm', 'elbow']),
      hand: limb(side, ['hand', 'wrist']),
    })),
  };
}

function rigBones(gltf) {
  const humanoid = gltf.userData?.vrm?.humanoid;
  if (!humanoid) return namedRig(gltf);
  const bone = name => humanoid.getRawBoneNode(name);
  return {
    hips: bone('hips'),
    torso: bone('upperChest') || bone('chest') || bone('spine') || bone('head'),
    arms: sides.map(side => ({upper: bone(side + 'UpperArm'), lower: bone(side + 'LowerArm'), hand: bone(side + 'Hand')})),
  };
}

function descendsFrom(node, parent) {
  for (let next = node?.parent; next; next = next.parent) if (next === parent) return true;
  return false;
}

function axis(from, to) {
  const delta = to.getWorldPosition(new Vector3()).sub(from.getWorldPosition(new Vector3()));
  const squaredLength = delta.lengthSq();
  return Number.isFinite(squaredLength) && squaredLength > 0 ? delta.normalize() : null;
}

function loweredTrack(upper, direction, outward, up) {
  const inverse = upper.parent.matrixWorld.clone();
  const determinant = inverse.determinant();
  if (!Number.isFinite(determinant) || determinant === 0) return null;
  inverse.invert();
  const target = outward.clone().multiplyScalar(Math.sin(dropAngle)).addScaledVector(up, -Math.cos(dropAngle));
  const from = direction.clone().transformDirection(inverse);
  const to = target.transformDirection(inverse);
  const rotation = new Quaternion().setFromUnitVectors(from, to).multiply(upper.quaternion).normalize();
  if (!rotation.toArray().every(Number.isFinite)) return null;
  return new QuaternionKeyframeTrack(upper.uuid + '.quaternion', [0], rotation.toArray());
}

function animatesUpperArm(bones, arms) {
  return arms.some(({upper}, index) => {
    const other = arms[1 - index].upper;
    // Shoulder controls can pose an upper arm. Shared torso/hips controls cannot
    // lower an individual arm relative to the rest of the body.
    for (let node = upper; node && !descendsFrom(other, node); node = node.parent) {
      if (bones.has(node)) return true;
    }
    return false;
  });
}

function inspectArmPose(scene, {hips, torso, arms}) {
  if (!hips || !descendsFrom(torso, hips) ||
      !arms.every(({upper, lower}) => descendsFrom(upper, hips) && descendsFrom(lower, upper))) return null;
  scene.updateMatrixWorld(true);
  const up = axis(hips, torso);
  const across = axis(arms[1].upper, arms[0].upper);
  if (!up || up.y < .8 || !across || Math.abs(across.dot(up)) > .26) return null;
  across.addScaledVector(up, -across.dot(up)).normalize();
  const directions = arms.map(({upper, lower}) => axis(upper, lower));
  if (directions.some(direction => !direction)) return null;
  if (directions.every(direction => direction.dot(up) < -.8)) return {kind: 'neutral'};

  const outward = [across, across.clone().negate()];
  const straight = arms.every(({lower, hand}, index) => {
    const direction = directions[index];
    const forearm = descendsFrom(hand, lower) ? axis(lower, hand) : null;
    return direction.dot(outward[index]) > .89 && Math.abs(direction.dot(up)) < .30 && (!forearm || forearm.dot(direction) > .76);
  });
  if (!straight) return null;
  const tracks = arms.map(({upper}, index) => loweredTrack(upper, directions[index], outward[index], up));
  return tracks.every(Boolean) ? {kind: 't-pose', tracks} : null;
}

function idleClip(source, extraTracks = []) {
  if (source.duration > 0 && !extraTracks.length) return source;
  // A single-key pose needs a positive playback period when used as the idle loop.
  return new AnimationClip(source.name, source.duration > 0 ? source.duration : 1, [...source.tracks, ...extraTracks], source.blendMode);
}

export function prepareCustomStanding(entry, gltf) {
  if (entry.custom !== true || entry.importMode !== 'rigged') return null;
  const clips = gltf.animations.filter(clip => Object.hasOwn(entry.clips || {}, clip.name));
  const explicit = clips.find(clip => clip.name === entry.defaultClip);
  if (explicit && explicit.name !== 'Idle_Breathe' && !standingName(explicit.name)) return null;
  const rig = rigBones(gltf);
  const labeled = clips.filter(clip => standingName(clip.name)).map(clip => ({clip, bones: animatedBones(clip, gltf.scene)}))
    .filter(({bones}) => bones.size > 0);
  const authored = labeled.find(({bones}) => animatesUpperArm(bones, rig.arms)) || labeled[0];
  const chosen = explicit || authored?.clip || clips.find(clip => clip.name === 'Idle_Breathe');
  const useAuthored = chosen && standingName(chosen.name);
  const armDriven = chosen && animatesUpperArm(chosen === authored?.clip ? authored.bones : animatedBones(chosen, gltf.scene), rig.arms);
  const pose = armDriven ? null : inspectArmPose(gltf.scene, rig);
  if (pose?.kind === 't-pose') {
    const clip = chosen ? idleClip(chosen, pose.tracks) : new AnimationClip('yukino-standing-' + gltf.scene.uuid, 1, pose.tracks);
    return {kind: pose.kind, clip};
  }
  if (useAuthored) return {kind: 'authored', clip: idleClip(chosen)};
  return pose;
}
