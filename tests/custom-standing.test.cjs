const assert = require('node:assert/strict');
const test = require('node:test');

const modules = Promise.all([
  import('three'), import('../src/ui/custom-standing.mjs'), import('../src/ui/model-runtime.mjs'),
]);

async function fixture({vrm = false, lowered = false} = {}) {
  const [THREE, {prepareCustomStanding}, {GlbAvatarRenderer}] = await modules;
  const scene = new THREE.Group();
  scene.rotation.y = .54;
  const rig = {};
  const addBone = (role, name, parent, position) => {
    const bone = new THREE.Bone();
    bone.name = vrm ? `joint_${Object.keys(rig).length}` : name;
    bone.position.set(...position);
    parent.add(bone);
    rig[role] = bone;
    return bone;
  };
  const hips = addBone('hips', 'mixamorigHips', scene, [0, .9, 0]);
  const torso = addBone('chest', 'mixamorigSpine2', hips, [0, .5, 0]);
  for (const [side, sign] of [['left', 1], ['right', -1]]) {
    const prefix = side === 'left' ? 'Left' : 'Right';
    const upper = addBone(side + 'UpperArm', 'mixamorig' + prefix + 'Arm', torso, [sign * .2, .13, 0]);
    const segment = lowered ? [sign * .07, -.4, 0] : [sign * .39, 0, 0];
    const lower = addBone(side + 'LowerArm', 'mixamorig' + prefix + 'ForeArm', upper, segment);
    addBone(side + 'Hand', 'mixamorig' + prefix + 'Hand', lower, segment);
  }
  const entry = {id: 'fixture', version: '1', label: '测试模型', custom: true, importMode: 'rigged', clips: {}, defaultClip: ''};
  const gltf = {scene, animations: [], userData: vrm ? {vrm: {humanoid: {getRawBoneNode: role => rig[role]}}} : {}};
  return {THREE, prepareCustomStanding, GlbAvatarRenderer, rig, entry, gltf};
}

function getArmY({THREE, rig}, side) {
  const arm = rig[side + 'UpperArm'].getWorldPosition(new THREE.Vector3());
  const elbow = rig[side + 'LowerArm'].getWorldPosition(new THREE.Vector3());
  return elbow.sub(arm).normalize().y;
}

test('bilateral T poses lower both arms using a renderer-only clip for GLB and VRM rigs', async () => {
  for (const vrm of [false, true]) {
    const model = await fixture({vrm});
    const {THREE, prepareCustomStanding, entry, gltf, rig} = model;
    const {kind, clip} = prepareCustomStanding(entry, gltf);
    assert.equal(kind, 't-pose');
    assert.equal(gltf.animations.length, 0);
    assert.equal(getArmY(model, 'left'), 0);
    const mixer = new THREE.AnimationMixer(gltf.scene);
    mixer.clipAction(clip).play();
    mixer.update(0);
    assert(getArmY(model, 'left') < -.95);
    assert(getArmY(model, 'right') < -.95);
    assert.equal(rig.hips.quaternion.w, 1);
    mixer.stopAllAction();
    assert.equal(getArmY(model, 'left'), 0);
  }
});

test('lowered arms, asymmetric poses, incomplete rigs, and static and built-in models are preserved', async () => {
  const neutral = await fixture({lowered: true});
  assert.deepEqual(neutral.prepareCustomStanding(neutral.entry, neutral.gltf), {kind: 'neutral'});
  const model = await fixture();
  const {prepareCustomStanding, entry, gltf, rig} = model;
  assert.equal(prepareCustomStanding({...entry, importMode: 'static'}, gltf), null);
  assert.equal(prepareCustomStanding({...entry, custom: false}, gltf), null);
  rig.leftLowerArm.position.set(.1, -.39, 0);
  assert.equal(prepareCustomStanding(entry, gltf), null);
  rig.rightLowerArm.removeFromParent();
  assert.equal(prepareCustomStanding(entry, gltf), null);
});

test('renderer uses authored standing as its default and retains unrelated custom actions and source metadata', async () => {
  const model = await fixture();
  const {THREE, prepareCustomStanding, GlbAvatarRenderer, entry, gltf, rig} = model;
  const standing = new THREE.AnimationClip('Armature|Standing_Idle.001', 2, [
    new THREE.QuaternionKeyframeTrack(rig.leftUpperArm.name + '.quaternion', [0], [0, 0, -.5, Math.sqrt(.75)]),
    new THREE.QuaternionKeyframeTrack(rig.rightUpperArm.name + '.quaternion', [0], [0, 0, .5, Math.sqrt(.75)]),
  ]);
  const other = new THREE.AnimationClip('Stand Up', 1, [
    new THREE.VectorKeyframeTrack(rig.hips.name + '.position', [0], [0, .9, 0]),
  ]);
  gltf.animations.push(other);
  entry.clips[other.name] = {duration: 1, loop: false};
  assert.equal(prepareCustomStanding(entry, gltf).kind, 't-pose');
  const torsoOnly = new THREE.AnimationClip('Standing', 1, other.tracks);
  gltf.animations.push(torsoOnly, standing);
  entry.clips[torsoOnly.name] = {duration: 1, loop: false};
  entry.clips[standing.name] = {duration: 2, loop: false};
  assert.equal(prepareCustomStanding(entry, gltf).clip, standing);
  const renderer = Object.create(GlbAvatarRenderer.prototype);
  Object.assign(renderer, {
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(30, 1, .01, 100),
    container: {dataset: {}, style: {}}, gl: {domElement: {dataset: {}}},
    renderStyle: 'lit', zoom: 1, yaw: 0, onStatus() {}, activity: 'idle', meshes: [],
  });
  const sourceBounds = new THREE.Box3(new THREE.Vector3(-1, 0, -.3), new THREE.Vector3(1, 2, .3));
  await renderer.commitOutfit({entry, gltf, sourceBounds, size: sourceBounds.getSize(new THREE.Vector3())});
  assert.equal(renderer.currentAction.getClip(), standing);
  assert.equal(renderer.currentAction.loop, THREE.LoopRepeat);
  assert.equal(entry.defaultClip, '');
  assert.equal(entry.clips[standing.name].loop, false);
  assert.equal(renderer.play(other.name), true);
  assert.equal(renderer.currentAction.getClip(), other);
  assert.equal(renderer.currentAction.loop, THREE.LoopOnce);
});

test('pelvis-only standing and breathing idles keep their source motion and get neutral arm tracks', async () => {
  for (const name of ['Idle_Breathe', '站立']) {
    const model = await fixture();
    const {THREE, prepareCustomStanding, entry, gltf, rig} = model;
    const track = new THREE.VectorKeyframeTrack(rig.hips.name + '.position', [0, 1], [0, .9, 0, 0, 1, 0]);
    const source = new THREE.AnimationClip(name, 1, [track]);
    gltf.animations.push(source);
    entry.clips[name] = {duration: 1, loop: false};
    const {clip} = prepareCustomStanding(entry, gltf);
    assert.equal(clip.name, name);
    assert.equal(clip.tracks.length, 3);
    assert.equal(clip.tracks[0], track);
    assert.deepEqual(source.tracks, [track]);
    const mixer = new THREE.AnimationMixer(gltf.scene);
    mixer.clipAction(clip).play();
    mixer.update(.5);
    assert(Math.abs(rig.hips.position.y - .95) < 1e-5);
    assert(getArmY(model, 'left') < -.95);
    assert(getArmY(model, 'right') < -.95);
  }
});

test('GLB source associations recover Tripo and Mixamo bone namespaces', async () => {
  for (const vendor of ['TripoRig', 'mixamorig']) {
    const {prepareCustomStanding, entry, gltf, rig} = await fixture();
    const nodes = [], associations = new Map();
    for (const [role, bone] of Object.entries(rig)) {
      const original = vendor === 'TripoRig' ? role[0].toUpperCase() + role.slice(1) : bone.name.replace(/^mixamorig/, '');
      associations.set(bone, {nodes: nodes.length});
      nodes.push({name: `sourceAvatar|${vendor}:${original}`});
      bone.name = `sourceAvatar${vendor}${original}`;
    }
    gltf.parser = {associations, json: {nodes}};
    assert.equal(prepareCustomStanding(entry, gltf).kind, 't-pose');
  }
});

test('a labeled one-key standing pose loops without changing its source clip duration', async () => {
  const {THREE, prepareCustomStanding, entry, gltf, rig} = await fixture();
  const source = new THREE.AnimationClip('站立姿势', 0, [
    new THREE.QuaternionKeyframeTrack(rig.leftUpperArm.name + '.quaternion', [0], [0, 0, -.5, Math.sqrt(.75)]),
  ]);
  gltf.animations.push(source);
  entry.clips[source.name] = {duration: 0, loop: false};
  const {clip} = prepareCustomStanding(entry, gltf);
  assert.equal(source.duration, 0);
  assert.equal(clip.name, source.name);
  assert(clip.duration > 0);
  const mixer = new THREE.AnimationMixer(gltf.scene);
  mixer.clipAction(clip).play();
  mixer.update(1.2);
  assert(rig.leftUpperArm.quaternion.toArray().every(Number.isFinite));
});
