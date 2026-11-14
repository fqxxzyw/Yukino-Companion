import {MathUtils, PropertyBinding, Quaternion, Vector3} from 'three';

const faceChannels = {
  beret: {blink: 'EA_blink', mouth: 'EA_aa'},
  'black-qipao': {blink: 'EA_blink', mouth: 'Qipao20261112_aa'},
  kimono: {blink: 'YK20_blink', mouth: 'AnimeV4_Talk_aa'},
  'summer-uniform': {blink: 'EA_blink', mouth: 'EA_aa'},
  swimsuit: {blink: 'EA_blink', mouth: 'SwimNarrow_aa'},
  'twin-tail': {blink: 'EA_blink', mouth: 'YK_Talk_AA'},
  'winter-uniform': {blink: 'EA_blink'},
};

// Calibrated against the kimono at eye height. Positive model X lowers the chin.
const neutralPitchDegrees = {
  'black-qipao': 9,
  swimsuit: 5,
  'summer-uniform': 2,
  'winter-uniform': 3,
};

function gazeJoint(node, modelRotation) {
  const base = node.quaternion.clone();
  const axes = node.parent.getWorldQuaternion(new Quaternion()).invert().multiply(modelRotation);
  const right = new Vector3(1, 0, 0).applyQuaternion(axes);
  const up = new Vector3(0, 1, 0).applyQuaternion(axes);
  const pitch = new Quaternion(), yaw = new Quaternion();
  return {
    capture() { base.copy(node.quaternion); },
    restore() { node.quaternion.copy(base); },
    apply(x, y, blend) {
      pitch.setFromAxisAngle(right, MathUtils.degToRad(y * blend));
      yaw.setFromAxisAngle(up, MathUtils.degToRad(x * blend));
      node.quaternion.copy(base).premultiply(pitch).premultiply(yaw);
    },
  };
}

function bindGaze(gltf, candidate) {
  const {scene, userData} = gltf;
  const vrm = userData?.vrm;
  // The seven supplied VRMs have empty look expressions, and their eye joints
  // are weighted to neck/clothing vertices. Leave those joints in the authored
  // pose. The separate beret iris morph belongs to its interaction binding.
  if (vrm?.lookAt) {
    vrm.lookAt.autoUpdate = false;
    vrm.lookAt.update(0);
  }
  scene.updateMatrixWorld(true);
  let neck = vrm?.humanoid?.getRawBoneNode('neck');
  scene.traverse(node => {
    if (!neck && node.isBone && node.name === 'neck') neck = node;
  });
  const orientation = scene.getWorldQuaternion(new Quaternion());
  const head = neck?.parent ? gazeJoint(neck, orientation) : null;
  return {
    capture() { head?.capture(); },
    restore() { head?.restore(); },
    apply(gaze, headBlend, {hat=false}={}) {
      const clamp = (value, bound) => MathUtils.clamp(Number.isFinite(value) ? value : 0, -bound, bound);
      const yaw=clamp(gaze.headYaw,12)*.7;
      const pitch = hat
        ? -clamp(gaze.headPitch, 20)
        : (neutralPitchDegrees[candidate] ?? 0) - clamp(gaze.headPitch, 7) * .72;
      head?.apply(yaw, pitch, headBlend);
    },
  };
}

function hasVisibleDelta(mesh, index) {
  const target = mesh.geometry?.morphAttributes?.position?.[index];
  const positions = mesh.geometry?.attributes?.position;
  if (!target || !positions || target.count !== positions.count) return false;
  for (let i = 0; i < target.count; i++) {
    for (let component = 0; component < 3; component++) {
      const baseline = mesh.geometry.morphTargetsRelative ? 0 : positions.getComponent(i, component);
      if (Math.abs(target.getComponent(i, component) - baseline) > 1e-8) return true;
    }
  }
  return false;
}

function morphBindings(scene, morph) {
  const bindings = [];
  if (!morph) return bindings;
  scene.traverse(mesh => {
    const index = mesh.morphTargetDictionary?.[morph];
    if (mesh.isMesh && Number.isInteger(index) && Number.isFinite(mesh.morphTargetInfluences?.[index]) && hasVisibleDelta(mesh, index)) {
      bindings.push({mesh, index, base: mesh.morphTargetInfluences[index]});
    }
  });
  return bindings;
}

function tracksOwnChannel(clip, scene, bindings, kind) {
  return clip.tracks.some(track => {
    const {nodeName, propertyName, propertyIndex} = PropertyBinding.parseTrackName(track.name);
    if (propertyName !== 'morphTargetInfluences') return false;
    const node = PropertyBinding.findNode(scene, nodeName);
    return bindings.some(({mesh}) => {
      if (node !== mesh) return false;
      if (propertyIndex === undefined) return true;
      const name = Object.keys(mesh.morphTargetDictionary).find(key => String(mesh.morphTargetDictionary[key]) === propertyIndex) || propertyIndex;
      // A smile or other emotion is not a spoken vowel. Leave the expression
      // authored while the audio envelope drives the separate mouth opening.
      return kind === 'blink' ? /blink/i.test(name) : /(?:viseme|mouth_?open|_(?:aa|ih|ou|ee|oh)(?:_|$))/i.test(name);
    });
  });
}

function bindFace(scene, animations, channels) {
  const blink = morphBindings(scene, channels.blink);
  const mouth = morphBindings(scene, channels.mouth);
  const bindings = [...blink, ...mouth];
  const authored = new Map(animations.map(clip => [clip.name, {
    blink: tracksOwnChannel(clip, scene, blink, 'blink'),
    mouth: tracksOwnChannel(clip, scene, mouth, 'mouth'),
  }]));
  const owned = (actions, kind) => [...actions].some(action => authored.get(action.getClip().name)?.[kind] &&
    action.enabled && action.isScheduled() && action.getEffectiveWeight() > 1e-4);
  return {
    hasBlink: blink.length > 0,
    restore() {
      for (const {mesh, index, base} of bindings) mesh.morphTargetInfluences[index] = base;
    },
    capture() {
      for (const binding of bindings) binding.base = binding.mesh.morphTargetInfluences[binding.index];
    },
    apply(actions, level, closure) {
      const blinkWeight = owned(actions, 'blink') ? 0 : MathUtils.clamp(closure, 0, 1);
      const mouthWeight = owned(actions, 'mouth') ? 0 : MathUtils.clamp(level, 0, 1) * .25;
      for (const {mesh, index, base} of blink) mesh.morphTargetInfluences[index] = Math.max(base, blinkWeight);
      for (const {mesh, index, base} of mouth) mesh.morphTargetInfluences[index] = Math.max(base, mouthWeight);
    },
  };
}

export function bindCandidateModelControls(gltf, candidate) {
  if (!Object.hasOwn(faceChannels, candidate)) return null;
  return {gaze: bindGaze(gltf, candidate), face: bindFace(gltf.scene, gltf.animations, faceChannels[candidate])};
}
