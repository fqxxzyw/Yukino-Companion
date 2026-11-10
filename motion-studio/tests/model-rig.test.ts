import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { ModelRig } from '../src/model-rig.ts';
import type { ModelMapping, Pose, Quat } from '../src/motion/types.ts';

const source = { id: 'local:test.glb', label: 'Rig test', asset: { filename: 'test.glb', sha256: 'test' } };

function closeArray(actual: readonly number[], expected: readonly number[]) {
  assert.equal(actual.length, expected.length);
  for (const [index, value] of expected.entries()) assert.ok(Math.abs(value - actual[index]) < 1e-6);
}

function fixture(mapping: ModelMapping = {}) {
  const scene = new THREE.Group();
  const parent = new THREE.Group();
  parent.rotation.y = Math.PI / 2;
  parent.scale.set(2, 0.5, 1);
  scene.add(parent);
  const joint = new THREE.Bone();
  joint.name = 'J_Bip_C_Head';
  joint.rotation.x = 0.4;
  parent.add(joint);
  const geometry = new THREE.BoxGeometry(1, 2, 1);
  const position = geometry.getAttribute('position').clone();
  geometry.morphAttributes.position = [1, 2, 3].map((amount) => {
    const target = position.clone();
    target.setX(0, target.getX(0) + amount * .02);
    return target;
  });
  const mesh = new THREE.Mesh(geometry);
  mesh.name = 'Face';
  mesh.morphTargetDictionary = { Blink_L: 0, Blink_R: 1, CustomJaw: 2 };
  scene.add(mesh);
  const original = joint.quaternion.clone();
  const idle = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.5);
  const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.2);
  const idleTrack = new THREE.QuaternionKeyframeTrack('J_Bip_C_Head.quaternion', [0, 1], [...idle.toArray(), ...idle.toArray()]);
  const clipTrack = new THREE.QuaternionKeyframeTrack('J_Bip_C_Head.quaternion', [0, 1], [...idle.toArray(), ...turn.toArray()], THREE.InterpolateDiscrete);
  const rig = new ModelRig({ scene, animations: [
    new THREE.AnimationClip('Idle_Breathe', 1, [idleTrack]),
    new THREE.AnimationClip('Turn', 1, [clipTrack]),
  ] }, source, mapping);
  return { rig, joint, mesh, original, idle, turn };
}

test('adapter captures idle, applies normalized body deltas and restores source pose', () => {
  const { rig, joint, idle, original } = fixture();
  closeArray(joint.quaternion.toArray(), idle.toArray());
  const move: Pose = { rotations: { head: [0, 0, 0.5, Math.sqrt(0.75)] }, translations: { head: [0, 0.1, 0] }, expressions: {} };
  rig.apply(move, false);
  const current = rig.capture();
  closeArray(current.rotations.head, move.rotations.head);
  closeArray(current.translations.head, move.translations.head);
  closeArray(joint.position.toArray(), [0, 0.4, 0]);
  rig.apply(move, true);
  closeArray(joint.quaternion.toArray(), original.toArray());
  closeArray(joint.position.toArray(), [0, 0, 0]);
});

test('embedded quaternion conversion reproduces the source transform and STEP semantics', () => {
  const { rig, joint, turn } = fixture();
  const embedded = rig.info.clips.find((clip) => clip.name === 'Turn');
  assert.ok(embedded);
  const track = embedded.channels[0];
  assert.equal(track.key, 'head');
  assert.equal(track.type, 'rotation');
  assert.equal(track.keys[0].interpolation, 'hold');
  rig.apply({ rotations: { head: track.keys[1].value as Quat }, translations: {}, expressions: {} }, false);
  closeArray(joint.quaternion.toArray(), turn.toArray());
});

test('external actions import only with compatible bone names, hierarchy and bind pose', () => {
  const { rig, original, turn } = fixture();
  const scene = new THREE.Group(), parent = new THREE.Group(), joint = new THREE.Bone();
  parent.rotation.y = Math.PI / 2; parent.scale.set(2, 0.5, 1); scene.add(parent);
  joint.name = 'J_Bip_C_Head'; joint.quaternion.copy(original); parent.add(joint);
  const make = (name = joint.name) => new THREE.AnimationClip('Dance', 1, [
    new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, [0, 1], [...original.toArray(), ...turn.toArray()]),
  ]);
  const imported = rig.convertExternalAnimations({ scene, animations: [make()] });
  assert.equal(imported.length, 1);assert.equal(imported[0].modelId, source.id);
  assert.equal(imported[0].channels[0].key, 'head');
  assert.throws(() => rig.convertExternalAnimations({ scene, animations: [make('MissingBone')] }), /无法安全匹配/);
  parent.rotation.y = 0;
  assert.throws(() => rig.convertExternalAnimations({ scene, animations: [make()] }), /绑定姿势或层级不同/);
  parent.rotation.y = Math.PI / 2;
  joint.position.x = 1;
  assert.throws(() => rig.convertExternalAnimations({ scene, animations: [make()] }), /绑定姿势或层级不同/);
  assert.throws(() => rig.convertExternalAnimations({ scene, animations: [] }), /没有动画/);
});

test('explicit mapping and independent eyelids use real morph targets and expose missing controls', () => {
  const { rig, mesh } = fixture({ expressions: { mouthOpen: 'CustomJaw', smile: 'absent' } });
  assert.match(rig.info.warnings.join(' '), /手动表情映射 smile 缺少目标 absent/);
  const result = rig.apply({ rotations: {}, translations: {}, expressions: { blink: 0.5, blinkLeft: 0.8, mouthOpen: 0.2, smile: 0.5 } }, false);
  assert.deepEqual(result.missing, ['smile']);
  closeArray(mesh.morphTargetInfluences!, [0.8, 0.5, 0.2]);
  rig.apply({ rotations: {}, translations: {}, expressions: {} }, false);
  closeArray(mesh.morphTargetInfluences!, [0, 0, 0]);
});

test('Blender-style limb and finger names bind to body diagram and timeline roles', () => {
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1)));
  const expected = { 'shoulder.L': 'leftShoulder', 'upper_arm.R': 'rightUpperArm', 'lower_arm.R': 'rightLowerArm',
    'hand.R': 'rightHand', 'upper_leg.L': 'leftUpperLeg', 'lower_leg.L': 'leftLowerLeg',
    'foot.L': 'leftFoot', 'toes.R': 'rightToeBase', 'index_distal.R': 'rightIndex3' };
  for (const name of Object.keys(expected)) {
    const bone = new THREE.Bone();
    bone.name = name.replace('.', '');
    bone.userData.name = name;
    scene.add(bone);
  }
  const rig = new ModelRig({ scene, animations: [] }, source, {});
  assert.deepEqual(Object.fromEntries(rig.info.bones.map(({ source, id }) => [source, id])), expected);
});

test('common namespaced and Biped joints map without treating twist bones as limbs', () => {
  const scene = new THREE.Group(); scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1)));
  for (const name of ['Armature|mixamorig:LeftArm','Bip001 R ForeArm','Bip001 L Thigh','LeftArmTwist']) {
    const bone = new THREE.Bone(); bone.name = name; scene.add(bone);
  }
  const rig = new ModelRig({scene,animations:[]},source,{});
  const mapped=Object.fromEntries(rig.info.bones.map(({source,id})=>[source,id]));
  assert.equal(mapped['Armature|mixamorig:LeftArm'],'leftUpperArm');
  assert.equal(mapped['Bip001 R ForeArm'],'rightLowerArm');
  assert.equal(mapped['Bip001 L Thigh'],'leftUpperLeg');
  assert.match(mapped.LeftArmTwist,/^native:bone:/);
});

test('ambiguous automatic candidates are not guessed and stay manually accessible', () => {
  const scene = new THREE.Group(); scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1)));
  for (const name of ['LeftArm','upper_arm.L']) {const bone=new THREE.Bone();bone.name=name;scene.add(bone);}
  const rig = new ModelRig({scene,animations:[]},source,{});
  assert.equal(rig.info.bones.some(item=>item.id==='leftUpperArm'),false);
  assert.equal(rig.info.bones.filter(item=>item.id.startsWith('native:bone:')).length,2);
  assert.match(rig.info.warnings.join(' '),/多个候选/);
  const mapped = new ModelRig({scene,animations:[]},source,{bones:{leftUpperArm:'LeftArm'}});
  assert.equal(mapped.info.bones.find(item=>item.id==='leftUpperArm')?.source,'LeftArm');
});

test('when a helper duplicates a role the actual skin joint is chosen', () => {
  const scene = new THREE.Group();
  const helper=new THREE.Bone(); helper.name='LeftArm';scene.add(helper);
  const joint=new THREE.Bone(); joint.name='upper_arm.L';scene.add(joint);
  const geometry=new THREE.BoxGeometry(1,2,1), count=geometry.attributes.position.count;
  geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(new Uint16Array(count*4),4));
  const weights=new Float32Array(count*4);for(let i=0;i<count;i++)weights[i*4]=1;
  geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
  const mesh=new THREE.SkinnedMesh(geometry);mesh.bind(new THREE.Skeleton([joint]));scene.add(mesh);
  const rig=new ModelRig({scene,animations:[]},source,{});
  assert.equal(rig.info.bones.find(item=>item.id==='leftUpperArm')?.source,'upper_arm.L');
  assert.match(rig.info.bones.find(item=>item.source==='LeftArm')!.id,/^native:bone:/);
});
