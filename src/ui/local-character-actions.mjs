import {AnimationClip, NumberKeyframeTrack, QuaternionKeyframeTrack, VectorKeyframeTrack} from 'three';

const MAX_ACTION_BYTES = 4 * 1024 ** 2;
const CLIP_NAMES = ['Idle_Breathe', 'Listen_Attentive', 'Nod_Subtle', 'Thoughtful_Glance', 'Speak_PhraseCadence', 'Gentle_Disagreement'];

function check(condition) {
  if (!condition) throw Error('本机人物动作与当前模型不匹配。');
}

function vector(values, width) {
  return Array.isArray(values) && values.length === width && values.every(Number.isFinite);
}

function rotations(values) {
  return vector(values, 4) && Math.abs(Math.hypot(...values) - 1) < .001;
}

async function bindActionPack(gltf, entry, pack) {
  check(pack.schema === 'yukino.local-actions.v1' && pack.modelSha256 === entry.sha256 &&
    pack.modelId === entry.runtimeCandidate && Array.isArray(pack.standing) && pack.standing.length > 0 &&
    pack.standing.length <= 512 && Array.isArray(pack.clips) && pack.clips.length === CLIP_NAMES.length);

  const parser = gltf.parser;
  const nodeCount = parser.json.nodes.length;
  const getNode = index => {
    check(Number.isInteger(index) && index >= 0 && index < nodeCount);
    return parser.getDependency('node', index);
  };
  const standing = new Map();
  for (const pose of pack.standing) {
    check(!standing.has(pose.node) && vector(pose.position, 3) && rotations(pose.quaternion) &&
      vector(pose.scale, 3) && pose.scale.every(value => value > 0));
    const bone = await getNode(pose.node);
    check(bone?.isBone && parser.json.nodes[pose.node].name === pose.name);
    standing.set(pose.node, {bone, pose});
  }

  const head = await getNode(pack.faceNode);
  const faceMeshIndex = parser.json.nodes[pack.faceNode].mesh;
  const faceMeshes = [];
  head.traverse(node => {
    if (node.isMesh && node.morphTargetDictionary && parser.associations.get(node)?.meshes === faceMeshIndex) faceMeshes.push(node);
  });
  check(Number.isInteger(faceMeshIndex) && faceMeshes.length > 0);

  const clips = pack.clips.map(({name, duration, times, bones, face}, index) => {
    check(name === CLIP_NAMES[index] && !gltf.animations.some(clip => clip.name === name) &&
      Number.isFinite(duration) && duration > 0 && duration <= 60 &&
      Math.abs((entry.clips?.[name]?.duration ?? -1) - duration) < .001 &&
      Array.isArray(times) && times.length >= 2 && times.length <= 1440 && times[0] === 0 &&
      times.every((time, i) => Number.isFinite(time) && (i === 0 || time > times[i - 1])) &&
      Math.abs(times.at(-1) - duration) < .001 && Array.isArray(bones) && Array.isArray(face));

    const tracks = [];
    const animatedBones = new Set();
    for (const channel of bones) {
      const target = standing.get(channel.node);
      check(target && !animatedBones.has(channel.node) && vector(channel.position, times.length * 3) &&
        vector(channel.quaternion, times.length * 4) && vector(channel.scale, times.length * 3) &&
        channel.scale.every(value => value > 0));
      animatedBones.add(channel.node);
      const id = target.bone.uuid;
      tracks.push(new VectorKeyframeTrack(id + '.position', times, channel.position));
      tracks.push(new QuaternionKeyframeTrack(id + '.quaternion', times, channel.quaternion));
      tracks.push(new VectorKeyframeTrack(id + '.scale', times, channel.scale));
    }

    const animatedShapes = new Set();
    for (const channel of face) {
      check(typeof channel.name === 'string' && !animatedShapes.has(channel.name) &&
        vector(channel.values, times.length) && channel.values.every(value => value >= 0 && value <= 1));
      animatedShapes.add(channel.name);
      for (const mesh of faceMeshes) {
        check(Object.hasOwn(mesh.morphTargetDictionary, channel.name));
        const slot = mesh.morphTargetDictionary[channel.name];
        tracks.push(new NumberKeyframeTrack(mesh.uuid + '.morphTargetInfluences[' + slot + ']', times, channel.values));
      }
    }
    check(tracks.length > 0);
    return new AnimationClip(name, duration, tracks);
  });

  for (const {bone, pose} of standing.values()) {
    bone.position.fromArray(pose.position);
    bone.quaternion.fromArray(pose.quaternion);
    bone.scale.fromArray(pose.scale);
  }
  return clips;
}

export async function loadLocalCharacterActions(gltf, entry, api, signal) {
  const expected = entry.actionPack;
  if (!expected) return [];
  check(entry.runtimeCandidate && api?.characterActionData && /^[a-f0-9]{64}$/.test(expected.sha256) &&
    Number.isInteger(expected.bytes) && expected.bytes > 0 && expected.bytes <= MAX_ACTION_BYTES);
  const bytes = new Uint8Array(await api.characterActionData(entry.id));
  signal?.throwIfAborted();
  check(bytes.length === expected.bytes);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  check(Array.from(digest, value => value.toString(16).padStart(2, '0')).join('') === expected.sha256);
  const pack = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
  const clips = await bindActionPack(gltf, entry, pack);
  signal?.throwIfAborted();
  gltf.userData.localActionFaceMeshIndex = gltf.parser.json.nodes[pack.faceNode].mesh;
  if (entry.runtimeCandidate === 'beret' && pack.beretIris) gltf.userData.beretIris = pack.beretIris;
  return clips;
}
