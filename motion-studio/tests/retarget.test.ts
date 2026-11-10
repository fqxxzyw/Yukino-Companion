import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { ModelRig } from '../src/model-rig.ts';
import { createClip, createProject, createTrack, emptyPose, evaluateProject, readProject, readRuntime,
  retargetModulePose, sampleModule, setKeyframe, writeProject, writeRuntime, builtinModules } from '../src/motion/index.ts';
import type { KeyframeModule, Vec3 } from '../src/motion/index.ts';

const vector = (value: Vec3, rotation: readonly number[]) => new THREE.Vector3(...value)
  .applyQuaternion(new THREE.Quaternion().fromArray(rotation));
const source = { leftUpperArm: [0, -1, 0], rightUpperLeg: [0, -1, 0] } satisfies Record<string, Vec3>;
const target = { leftUpperArm: [1, 0, 0], rightUpperLeg: [0.5, -Math.sqrt(0.75), 0] } satisfies Record<string, Vec3>;
const motion = (modelId?: string): KeyframeModule => ({ id: 'test', name: 'test', duration: 1, region: 'all',
  kind: 'keyframes', channels: [], restDirections: source, ...(modelId ? { modelId } : {}) });

test('semantic recording preserves source rest angles when moved between different models', () => {
  let clip = setKeyframe(motion(), 'rotation', 'leftUpperArm', 0, [0, 0, 0, 1]);
  clip = setKeyframe(clip, 'rotation', 'rightUpperLeg', 0, [0, 0, 0, 1]);
  const project = createProject('target');
  project.modules.push(clip);
  const track = createTrack('pose');
  track.clips.push(createClip(clip));
  project.tracks.push(track);
  const adapted = evaluateProject(project, 0.5, target);
  assert.ok(vector(target.leftUpperArm, adapted.rotations.leftUpperArm).distanceTo(new THREE.Vector3(...source.leftUpperArm)) < 1e-6);
  assert.ok(vector(target.rightUpperLeg, adapted.rotations.rightUpperLeg).distanceTo(new THREE.Vector3(...source.rightUpperLeg)) < 1e-6);
  assert.deepEqual(evaluateProject(project, 0.5, source).rotations.leftUpperArm, [0, 0, 0, 1]);
  assert.deepEqual(readProject(writeProject(project)).modules[0], clip);
  assert.deepEqual(readRuntime(writeRuntime(project)).modules[0], clip);
  const legacy = { ...clip, restDirections: undefined };
  assert.deepEqual(retargetModulePose({ ...emptyPose(), rotations: { leftUpperArm: [0, 0, 0, 1] } }, legacy, 0, target)
    .rotations.leftUpperArm, [0, 0, 0, 1]);
});

test('model-bound native animation is untouched; procedural wave smoothly enters its relaxed reference', () => {
  const neutral = { ...emptyPose(), rotations: { leftUpperArm: [0, 0, 0, 1] as const } };
  const pose = { ...neutral, rotations: { leftUpperArm: [...neutral.rotations.leftUpperArm] as [number, number, number, number] } };
  assert.deepEqual(retargetModulePose(pose, motion('source'), 0.5, target), pose);
  const wave = builtinModules.find((module) => module.procedure === 'waveLeft')!;
  assert.deepEqual(retargetModulePose(sampleModule(wave, 0), wave, 0, target), sampleModule(wave, 0));
  const original = sampleModule(wave, wave.duration * 0.5);
  const result = retargetModulePose(original, wave, wave.duration * 0.5, target);
  assert.notDeepEqual(result.rotations.leftUpperArm, original.rotations.leftUpperArm);
  assert.deepEqual(result.rotations.leftLowerArm, original.rotations.leftLowerArm);
});

test('actual rig binding transfers animated limb direction across A and T reference poses', () => {
  function rigFor(direction: Vec3) {
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1)));
    const upper = new THREE.Bone(); upper.name = 'J_Bip_L_UpperArm';
    const lower = new THREE.Bone(); lower.name = 'J_Bip_L_LowerArm';
    lower.position.fromArray(direction);
    scene.add(upper); upper.add(lower);
    const rig = new ModelRig({ scene, animations: [] }, { id: 'rig', label: 'rig', asset: { filename: 'rig.glb', sha256: 'x' } }, {});
    const limb = () => {
      scene.updateMatrixWorld(true);
      return lower.getWorldPosition(new THREE.Vector3()).sub(upper.getWorldPosition(new THREE.Vector3())).normalize();
    };
    return { rig, limb };
  }
  const original = rigFor([0.6, -0.8, 0]);
  const other = rigFor([1, 0, 0]);
  assert.ok(original.rig.info.retarget?.leftUpperArm && other.rig.info.retarget?.leftUpperArm);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.4).toArray() as [number, number, number, number];
  const item = { ...motion(), restDirections: original.rig.info.retarget };
  const pose = { ...emptyPose(), rotations: { leftUpperArm: q } };
  original.rig.apply(pose, false);
  other.rig.apply(retargetModulePose(pose, item, 0.5, other.rig.info.retarget), false);
  assert.ok(original.limb().distanceTo(other.limb()) < 1e-6);
  const mapped = retargetModulePose(pose, item, 0.5, other.rig.info.retarget);
  const restored = retargetModulePose(mapped, { ...item, restDirections: other.rig.info.retarget }, 0.5, original.rig.info.retarget);
  assert.ok(Math.abs(new THREE.Quaternion().fromArray(restored.rotations.leftUpperArm)
    .dot(new THREE.Quaternion().fromArray(q))) > 1 - 1e-8);
});
