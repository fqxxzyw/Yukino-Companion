import assert from 'node:assert/strict';
import test from 'node:test';
import {
  builtinModules, changeProjectFps, clipDuration, clipSourceTime, createClip, createExampleProject, createProject,
  createRecording, createTrack, emptyPose, endRecordingStroke, eulerDegreesToQuat, evaluateProject, findConflicts, finishRecording,
  projectDuration, quatToEulerDegrees, readProject, readRuntime, removeKeyframe, sampleModule, sampleRecording,
  setKeyframe, splitClip, writeProject, writeRuntime,
} from '../src/motion/index.ts';
import type { KeyframeModule, Pose, Project, Quat, Region } from '../src/motion/index.ts';

function builtin(id: string) {
  const item = builtinModules.find((item) => item.id === id);
  assert.ok(item);
  return item;
}

function moduleFor(name: string, duration = 4, region: Region = 'all'): KeyframeModule {
  return { id: name, name, region, duration, kind: 'keyframes', channels: [] };
}

function append(project: Project, module: KeyframeModule, region: Region = 'all') {
  const track = createTrack(module.name, region);
  const clip = createClip(module);
  track.clips.push(clip);
  project.modules.push(module);
  project.tracks.push(track);
  return { track, clip };
}

function close(actual: number | undefined, expected: number, margin = 1e-8) {
  assert.ok(typeof actual === 'number' && Math.abs(actual - expected) <= margin, `Expected ${expected}, received ${actual}`);
}

function sameQuaternion(actual: Quat, expected: Quat) {
  close(Math.abs(actual.reduce((sum, component, index) => sum + component * expected[index], 0)), 1);
}

test('overlapping baked skirt actions use one full strength clip and keep separate face tracks', () => {
  const project = createProject('kimono');
  const walk = append(project, setKeyframe({ ...moduleFor('walk'), exclusiveGroup: 'kimono-v4-skirt' },
    'expression', 'native:morph:WalkSkirt', 0, 1), 'rightArm');
  const greeting = append(project, setKeyframe({ ...moduleFor('greeting'), exclusiveGroup: 'kimono-v4-skirt' },
    'expression', 'native:morph:GreetingSkirt', 0, 1), 'head');
  const face = setKeyframe(moduleFor('smile-overlay'), 'expression', 'smile', 0, 0.32);
  append(project, face, 'face');
  greeting.clip.start = project.fps;
  greeting.clip.blendIn = 2;
  greeting.clip.weight = 0.4;
  greeting.clip.mode = 'additive';

  assert.deepEqual(evaluateProject(project, 1.1).expressions, { 'native:morph:GreetingSkirt': 1, smile: 0.32 });
  walk.clip.priority = 1;
  assert.deepEqual(evaluateProject(project, 1.1).expressions, { 'native:morph:WalkSkirt': 1, smile: 0.32 });
});

test('maps trimmed, accelerated and repeated clips into source time with optional stretch', () => {
  const clip = {
    ...createClip(moduleFor('four')), sourceIn: 1, sourceOut: 3, speed: 2, loops: 3,
  };
  close(clipDuration(clip), 3);
  close(clipSourceTime(clip, 0.5), 2);
  close(clipSourceTime(clip, 1), 1);
  close(clipSourceTime(clip, 3), 3);
  assert.equal(clipSourceTime(clip, -0.001), undefined);
  assert.equal(clipSourceTime(clip, 3.001), undefined);
  const stretched = { ...clip, stretch: 6 };
  close(clipDuration(stretched), 6);
  close(clipSourceTime(stretched, 1), 2);
  close(clipSourceTime(stretched, 2), 1);
});

test('splitting inside a loop keeps the source phase and original fades on both sides', () => {
  const project = createProject('07');
  let module = setKeyframe(moduleFor('smile-test', 2), 'expression', 'smile', 0, 0);
  module = setKeyframe(module, 'expression', 'smile', 2, 1);
  const { track, clip } = append(project, module);
  Object.assign(clip, { start: 15, loops: 2, stretch: 3, blendIn: 1, blendOut: 0.7 });
  const before = structuredClone(project);
  const split = splitClip(clip, 67, project.fps);
  assert.ok(split);
  track.clips = split;
  for (let frame = 15; frame <= 105; frame++) {
    const expected = evaluateProject(before, frame / 30).expressions.smile ?? 0;
    close(evaluateProject(project, frame / 30).expressions.smile ?? 0, expected);
  }
  close(projectDuration(project), projectDuration(before));
  assert.equal(splitClip(clip, clip.start, project.fps), null);
});

test('slerps along the short quaternion path and retains editable outgoing interpolation', () => {
  let module = setKeyframe(moduleFor('turn'), 'rotation', 'head', 0, eulerDegreesToQuat([0, 0, 170]));
  module = setKeyframe(module, 'rotation', 'head', 1, eulerDegreesToQuat([0, 0, -170]));
  sameQuaternion(sampleModule(module, 0.5).rotations.head, eulerDegreesToQuat([0, 0, 180]));
  const rotation = eulerDegreesToQuat([23, -46, 88]);
  sameQuaternion(eulerDegreesToQuat(quatToEulerDegrees(rotation)), rotation);
  module = setKeyframe(module, 'expression', 'smile', 0, 0.25, 'hold');
  module = setKeyframe(module, 'expression', 'smile', 1, 0.85);
  close(sampleModule(module, 0.9).expressions.smile, 0.25);
  close(sampleModule(module, 1).expressions.smile, 0.85);
  module = removeKeyframe(module, 'expression', 'smile', 0);
  close(sampleModule(module, 0.1).expressions.smile, 0.85);
});

test('mixes disjoint limb and morph channels, including MBP, and releases them at the endpoint', () => {
  const project = createProject('07');
  let arm = setKeyframe(moduleFor('arm'), 'rotation', 'rightHand', 0, eulerDegreesToQuat([10, 0, 0]));
  arm = setKeyframe(arm, 'rotation', 'head', 0, eulerDegreesToQuat([45, 0, 0]));
  append(project, arm, 'rightArm');
  append(project, setKeyframe(moduleFor('face'), 'expression', 'smile', 0, 0.6), 'face');
  append(project, setKeyframe(moduleFor('lips'), 'expression', 'mbp', 0, 0.4), 'mouth');
  const pose = evaluateProject(project, 0);
  sameQuaternion(pose.rotations.rightHand, eulerDegreesToQuat([10, 0, 0]));
  assert.equal(pose.rotations.head, undefined);
  assert.deepEqual(pose.expressions, { smile: 0.6, mbp: 0.4 });
  assert.deepEqual(evaluateProject(project, 4), emptyPose());
  assert.deepEqual(findConflicts(project, 0), []);
});

test('adds rotation deltas, obeys solo and mute, and reports the active channel conflict', () => {
  const project = createProject('07');
  const make = (name: string, angle: number) => setKeyframe(
    moduleFor(name), 'rotation', 'head', 0, eulerDegreesToQuat([0, angle, 0]),
  );
  const base = append(project, make('base', 10), 'head');
  const layer = append(project, make('layer', 30), 'head');
  layer.clip.mode = 'additive';
  layer.clip.weight = 0.5;
  sameQuaternion(evaluateProject(project, 0.5).rotations.head, eulerDegreesToQuat([0, 25, 0]));
  assert.deepEqual(findConflicts(project, 0.5), [{ type: 'rotation', key: 'head', clipIds: [base.clip.id, layer.clip.id] }]);
  layer.clip.mode = 'priority';
  sameQuaternion(evaluateProject(project, 0.5).rotations.head, eulerDegreesToQuat([0, 15, 0]));
  base.track.solo = true;
  sameQuaternion(evaluateProject(project, 0.5).rotations.head, eulerDegreesToQuat([0, 10, 0]));
  base.track.muted = true;
  sameQuaternion(evaluateProject(project, 0.5).rotations.head, eulerDegreesToQuat([0, 15, 0]));
});

test('uses closed-eye priority without stacking bilateral and unilateral lids', () => {
  const project = createProject('07');
  const track = createTrack('眼睛', 'eyes');
  project.tracks.push(track);
  track.clips = [createClip(builtin('closed')), createClip(builtin('winkLeft')), createClip(builtin('blink'))];
  close(evaluateProject(project, 0.15).expressions.blink, 1);
  assert.equal(evaluateProject(project, 0.15).expressions.blinkLeft, undefined);
  const conflicts = findConflicts(project, 0.15);
  assert.deepEqual(conflicts.map(({ key, clipIds }) => [key, clipIds.length]), [['blinkLeft', 3], ['blinkRight', 2]]);
  assert.deepEqual(evaluateProject(project, 2), emptyPose());
});

test('evaluates procedural angle, eyelid phase and wrist amplitude from editable parameters', () => {
  const blink = builtin('blink');
  close(sampleModule(blink, 0.1).expressions.blink, 1);
  const slowClosure = sampleModule(blink, 0.1, { closing: 0.25, intensity: 0.6 });
  assert.ok(slowClosure.expressions.blink > 0 && slowClosure.expressions.blink < 0.6);
  const tilt = builtin('headTilt');
  sameQuaternion(sampleModule(tilt, 1, { angle: -20 }).rotations.head, eulerDegreesToQuat([0, 0, -16]));
  const wave = builtin('waveRight');
  const animated = sampleModule(wave, 1.2, { amplitude: 30, cycles: 2 });
  const stable = sampleModule(wave, 1.2, { amplitude: 0, cycles: 2 });
  assert.notDeepEqual(animated.rotations.rightHand, stable.rotations.rightHand);
  sameQuaternion(sampleModule(wave, wave.duration).rotations.rightUpperArm, [0, 0, 0, 1]);
});

test('records changed channels on a continuous clock across strokes with idle gaps removed', () => {
  const baseline: Pose = { ...emptyPose(), expressions: { smile: 0.2, mouthOpen: 0.5 } };
  const recording = createRecording('pose', 24, baseline);
  const first = eulerDegreesToQuat([0, 12, 0]);
  const last = eulerDegreesToQuat([0, 48, 0]);
  close(sampleRecording(recording, { rotations: { head: first } }, 1000), 1 / 24);
  sampleRecording(recording, { rotations: { head: last } }, 1500);
  endRecordingStroke(recording);
  close(sampleRecording(recording, { expressions: { smile: 0.6 } }, 6500), 14 / 24);
  sampleRecording(recording, { expressions: { smile: 0.8 } }, 6750);
  endRecordingStroke(recording);
  close(sampleRecording(recording, { expressions: { smile: 0.8 } }, 12000), 20 / 24);
  const module = finishRecording(recording);
  assert.ok(module);
  close(module.duration, 20 / 24);
  sameQuaternion(sampleModule(module, 0).rotations.head, first);
  sameQuaternion(sampleModule(module, 11 / 24).rotations.head, first);
  sameQuaternion(sampleModule(module, 12 / 24).rotations.head, last);
  close(sampleModule(module, 12 / 24).expressions.smile, 0.2);
  close(sampleModule(module, 13 / 24).expressions.smile, 0.6);
  close(sampleModule(module, 19 / 24).expressions.smile, 0.8);
  assert.deepEqual(module.channels.map(({ key }) => key), ['head', 'smile']);
  const project = createProject('07');
  const { clip } = append(project, module);
  clip.speed = 0.5;
  close(projectDuration(project), 40 / 24);
  close(evaluateProject(project, 38 / 24).expressions.smile, 0.8);
});

test('a recording with no changed controls is empty and a discrete edit plays for one frame', () => {
  const recording = createRecording('pose', 60, { ...emptyPose(), expressions: { smile: 0.4 } });
  sampleRecording(recording, { expressions: { smile: 0.4 } }, 3000);
  endRecordingStroke(recording);
  assert.equal(finishRecording(recording), null);

  sampleRecording(recording, { expressions: { smile: 0.8 } }, 9000);
  endRecordingStroke(recording);
  const module = finishRecording(recording);
  assert.ok(module);
  close(module.duration, 1 / 60);
  const project = createProject('07');
  append(project, module);
  close(evaluateProject(project, 0).expressions.smile, 0.8);
});

test('retains absolute timing when changing project frame rate', () => {
  const project = createProject('07');
  const { clip } = append(project, moduleFor('one', 1));
  clip.start = 30;
  project.playhead = 60;
  for (const fps of [24, 60] as const) {
    const updated = changeProjectFps(project, fps);
    close(projectDuration(updated), 2);
    assert.equal(updated.playhead, 2 * fps);
  }
});

test('project save restores editor data and runtime exports resolve versioned motion without editor state', () => {
  const project = createExampleProject('07');
  project.tracks[0].locked = true;
  project.playhead = 37;
  project.asset = { name: 'local.glb', sha256: '0'.repeat(64) };
  project.mappings = { '07': { bones: { head: 'Head' } } };
  append(project, setKeyframe(moduleFor('recorded'), 'translation', 'hips', 0, [0, 0.1, 0]));
  const restored = readProject(writeProject(project));
  assert.deepEqual(restored, project);
  const exported = writeRuntime(restored);
  const runtime = readRuntime(exported);
  assert.equal(runtime.playhead, undefined);
  assert.ok(runtime.tracks.every(({ locked }) => !locked));
  assert.deepEqual(runtime.asset, project.asset);
  assert.ok(runtime.modules.some(({ id, version }) => id === 'waveRight' && version === 1));
  for (const seconds of [3, 0, 2.2, 0.73, 4, 1.3, 2.2]) {
    assert.deepEqual(evaluateProject(runtime, seconds), evaluateProject(project, seconds));
  }
  assert.throws(() => readProject(exported), /类型/);
  assert.throws(() => readRuntime(writeProject(project)), /类型/);
});

test('rejects missing module references, out-of-range sources and corrupt keyframes', () => {
  const project = createExampleProject('07');
  const valid = JSON.parse(writeProject(project));
  const invalidRef = structuredClone(valid);
  invalidRef.tracks[0].clips[0].moduleId = 'missing';
  assert.throws(() => readProject(JSON.stringify(invalidRef)), /引用/);
  const invalidTrim = structuredClone(valid);
  invalidTrim.tracks[0].clips[0].sourceOut = 500;
  assert.throws(() => readProject(JSON.stringify(invalidTrim)), /裁剪/);
  append(project, setKeyframe(moduleFor('bad quat'), 'rotation', 'head', 0, [0, 0, 0, 1]));
  const invalidKey = JSON.parse(writeProject(project));
  invalidKey.modules.at(-1).channels[0].keys[0].value = [0, 0, 0, 0];
  assert.throws(() => readProject(JSON.stringify(invalidKey)), /四元数/);
});
