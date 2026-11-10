import * as THREE from 'three';
import { VRMExpressionMorphTargetBind } from '@pixiv/three-vrm';
import type { VRM } from '@pixiv/three-vrm';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { KeyframeModule, ModelMapping, MotionChannel, Pose, Quat, Region, RetargetReference, Vec3 } from './motion/types.ts';

export interface RigControl {
  id: string;
  label: string;
  source: string;
  region: Region;
  defaultValue?: number;
  internal?: boolean;
}

interface Definition {
  id: string;
  label: string;
  region: Region;
  names: string[];
}

const bones: Definition[] = [];
const expressions: Definition[] = [];
function define(target: Definition[], id: string, label: string, region: Region, ...names: string[]) {
  target.push({ id, label, region, names });
}

define(bones, 'root', '全身根节点', 'root', 'Root', 'RootMotion');
define(bones, 'hips', '骨盆', 'lowerBody', 'J_Bip_C_Hips', 'Hips', 'Pelvis');
define(bones, 'spine', '脊椎', 'upperBody', 'J_Bip_C_Spine', 'Spine', 'spine_01', 'DEF-spine');
define(bones, 'chest', '胸部', 'upperBody', 'J_Bip_C_Chest', 'Chest', 'Spine1', 'spine_02', 'DEF-spine.001');
define(bones, 'upperChest', '上胸', 'upperBody', 'J_Bip_C_UpperChest', 'UpperChest', 'Spine2', 'spine_03', 'DEF-spine.002');
define(bones, 'neck', '颈部', 'head', 'J_Bip_C_Neck', 'Neck', 'neck_01', 'DEF-neck');
define(bones, 'head', '头部', 'head', 'J_Bip_C_Head', 'Head');

for (const [letter, side, label, arm] of [['L', 'left', '左', 'leftArm'], ['R', 'right', '右', 'rightArm']] as const) {
  const limb: [string, string, Region, string?][] = [
    ['Shoulder', '肩', arm], ['UpperArm', '上臂', arm, 'Arm'], ['LowerArm', '前臂', arm, 'ForeArm'],
    ['Hand', '手腕', arm], ['UpperLeg', '大腿', 'lowerBody', 'UpLeg'], ['LowerLeg', '小腿', 'lowerBody', 'Leg'],
    ['Foot', '脚踝', 'lowerBody'], ['ToeBase', '脚趾', 'lowerBody', 'Toes'],
  ];
  for (const [part, name, region, alias] of limb) {
    const convention: Record<string, string[]> = {
      Shoulder: ['clavicle', 'shoulder'], UpperArm: ['upperarm', 'upper_arm'], LowerArm: ['lowerarm', 'forearm'],
      Hand: ['hand'], UpperLeg: ['thigh'], LowerLeg: ['calf', 'shin'], Foot: ['foot'], ToeBase: ['ball', 'toe'],
    };
    define(bones, `${side}${part}`, `${label}${name}`, region, `J_Bip_${letter}_${part}`, `${side}${part}`,
      `${part}.${letter}`, `${letter}_${part}`, ...(alias ? [`${side}${alias}`, `${alias}.${letter}`, `${letter}_${alias}`] : []),
      ...(convention[part] ?? []).flatMap((base) => [`${base}_${letter}`, `${base}.${letter}`, `${letter}_${base}`, `DEF-${base}.${letter}`]));
  }
  define(bones, `${side}Eye`, `${label}眼球`, 'lookAt', `J_Adj_${letter}_FaceEye`, `${side}Eye`);
  for (const [finger, name] of [['Thumb', '拇指'], ['Index', '食指'], ['Middle', '中指'], ['Ring', '无名指'], ['Little', '小指']]) {
    for (let segment = 1; segment <= 3; segment++) {
      define(bones, `${side}${finger}${segment}`, `${label}${name} ${segment}`, arm,
        `J_Bip_${letter}_${finger}${segment}`, `${side}Hand${finger === 'Little' ? 'Pinky' : finger}${segment}`,
        `${finger}_${['proximal', 'intermediate', 'distal'][segment - 1]}.${letter}`);
    }
  }
}

define(expressions, 'blink', '双眼闭合', 'eyes', 'Blink', 'EyeBlink', 'YK20_blink');
define(expressions, 'blinkLeft', '左眼闭合', 'eyes', 'BlinkLeft', 'Blink_L', 'EyeBlinkLeft', 'YK20_blink_L');
define(expressions, 'blinkRight', '右眼闭合', 'eyes', 'BlinkRight', 'Blink_R', 'EyeBlinkRight', 'YK20_blink_R');
define(expressions, 'smile', '微笑', 'face', 'MouthSmile', 'Smile', 'happy', 'YK20_happy_mouth');
define(expressions, 'frown', '嘴角下压', 'face', 'MouthFrown', 'Frown', 'YK20_sad_mouth');
define(expressions, 'mouthOpen', '张嘴', 'mouth', 'mouth_open_small', 'MouthOpen', 'JawOpen');
for (const [id, letter] of [['aa', 'A'], ['ih', 'I'], ['ou', 'U'], ['ee', 'E'], ['oh', 'O'], ['mbp', 'MBP']]) {
  define(expressions, id, `口型 ${letter}`, 'mouth', `viseme_${letter}`, id, `YK20_${id}`);
}
for (const [key, label] of [['happy', '喜悦'], ['angry', '生气'], ['sad', '悲伤'], ['relaxed', '放松'], ['surprised', '惊讶']]) {
  const suffix = key[0].toUpperCase() + key.slice(1);
  if (key !== 'happy' && key !== 'sad') define(expressions, `mouth${suffix}`, `${label}嘴部`, 'mouth', `YK20_${key}_mouth`);
  define(expressions, `eye${suffix}`, `${label}眼部`, 'eyes', `YK20_${key}_eye`);
  define(expressions, `brow${suffix}`, `${label}眉部`, 'brows', `YK20_brow_${key}`);
}

// Namespace and common armature prefixes are not part of the bone identity.
// Never use substring matches: e.g. an arm twist/helper is not the upper arm.
const normalized = (name: string) => name.toLowerCase().split(/[|/]/).pop()!.replace(/^(?:mixamorig|bip0?1|bip001)[:_ .-]*/, '').replace(/[^a-z0-9]/g, '');
const boneDefinitions = new Map(bones.flatMap((definition) => definition.names.map((name) => [normalized(name), definition])));
const expressionDefinitions = new Map(expressions.flatMap((definition) => definition.names.map((name) => [normalized(name), definition])));
const boneInfo = new Map(bones.map((definition) => [definition.id, definition]));
const expressionInfo = new Map(expressions.map((definition) => [definition.id, definition]));
const sourceName = (node: THREE.Object3D): string => typeof node.userData.name === 'string' ? node.userData.name : node.name;
const defaultLabel = (source: string, id: string) => `${source || id}`;

interface Transform {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
}

interface BoneBinding extends RigControl {
  node: THREE.Object3D;
  neutral: Transform;
  frame: THREE.Quaternion;
  inverseFrame: THREE.Quaternion;
  parentBasis: THREE.Matrix3;
  inverseParentBasis: THREE.Matrix3;
}

interface MorphBinding {
  node: THREE.Mesh;
  index: number;
  weight: number;
}

interface ExpressionBinding extends RigControl {
  targets: MorphBinding[];
  managed?: string;
}

const kimonoV4Hash = '9f3df2014a64895fe8072c8de0aa724b584357024db1668becf337586d61d84b';
const kimonoArmature = 'CharaKit_Weights_143b05ca_Rig';
const eyelids = new Set(['blink', 'blinkLeft', 'blinkRight']);
const internalMorph = /^(?:garment_|Actual_NewCloth_|YK_Hide|Kimono_|Repair_|Artist_|YK20_hair_constant$)/i;

function deformsTarget(node: THREE.Mesh, index: number) {
  for (const [name, list] of Object.entries(node.geometry.morphAttributes)) {
    const target = list?.[index];
    const base = node.geometry.getAttribute(name);
    // GLTFLoader may reuse the base attribute for an omitted target component.
    if (!target || target === base) continue;
    const relative = node.geometry.morphTargetsRelative;
    for (let row = 0; row < target.count; row++) {
      for (let axis = 0; axis < target.itemSize; axis++) {
        const delta = target.getComponent(row, axis) - (relative ? 0 : base?.getComponent(row, axis) ?? 0);
        if (Math.abs(delta) > 1e-6) return true;
      }
    }
  }
  return false;
}

function vrmBoneId(name: string) {
  if (name.endsWith('Toes')) return name.replace(/Toes$/, 'ToeBase');
  const finger = /^(.*?(Thumb|Index|Middle|Ring|Little))(Metacarpal|Proximal|Intermediate|Distal)$/.exec(name);
  if (!finger) return name;
  const part = finger[3];
  const index = part === 'Distal' ? 3 : part === 'Intermediate' || (finger[2] === 'Thumb' && part === 'Proximal') ? 2 : 1;
  return finger[1] + index;
}

const transformOf = (node: THREE.Object3D): Transform => ({
  position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone(),
});

function writeTransform(node: THREE.Object3D, transform: Transform) {
  node.position.copy(transform.position);
  node.quaternion.copy(transform.quaternion);
  node.scale.copy(transform.scale);
}

function restFrame(node: THREE.Object3D) {
  const rotation = node.quaternion.clone();
  for (let parent = node.parent; parent; parent = parent.parent) rotation.premultiply(parent.quaternion);
  return rotation.normalize();
}

const blankPose = (): Pose => ({ rotations: {}, translations: {}, expressions: {} });

interface RigAsset {
  filename: string;
  sha256: string;
  path?: string;
}

export interface RigInfo {
  id: string;
  label: string;
  bones: RigControl[];
  expressions: RigControl[];
  clips: KeyframeModule[];
  physics: string[];
  warnings: string[];
  asset: RigAsset;
  format: 'glb' | 'gltf' | 'vrm';
  retarget?: RetargetReference;
}

type RigSource = Pick<RigInfo, 'id' | 'label' | 'asset'> & Partial<Pick<RigInfo, 'format'>>;

function descriptor(id: string, source: string, definition: Definition | undefined, defaultRegion: Region): RigControl {
  return { id, source, label: definition?.label || defaultLabel(source, id), region: definition?.region || defaultRegion };
}

function captureIdle(gltf: Pick<GLTF, 'scene' | 'animations'>) {
  const idle = gltf.animations.find((clip) => clip.name === 'Idle_Breathe');
  if (!idle) return () => {};
  const mixer = new THREE.AnimationMixer(gltf.scene);
  mixer.clipAction(idle).play();
  mixer.update(0);
  return () => { mixer.stopAllAction(); mixer.uncacheRoot(gltf.scene); };
}

export class ModelRig {
  readonly boneBindings = new Map<string, BoneBinding>();
  readonly expressionBindings = new Map<string, ExpressionBinding>();
  readonly info: RigInfo;
  readonly originalBounds: THREE.Box3;
  readonly bounds: THREE.Box3;
  readonly height: number;
  private readonly original = new Map<THREE.Object3D, Transform>();
  private readonly neutral = new Map<THREE.Object3D, Transform>();
  private readonly morphs = new Map<THREE.Mesh, { original: number[]; neutral: number[] }>();
  private readonly tempQuat = new THREE.Quaternion();
  private readonly tempVec = new THREE.Vector3();
  private readonly manager?: VRM['expressionManager'];
  private readonly kimonoV4: boolean;

  constructor(gltf: Pick<GLTF, 'scene' | 'animations'>, source: RigSource, mapping: ModelMapping, vrm?: VRM) {
    this.kimonoV4 = source.asset.sha256 === kimonoV4Hash;
    this.manager = vrm?.expressionManager;
    const humanoid = new Map(Object.entries(vrm?.humanoid.rawHumanBones ?? {}).map(([id, binding]) => [binding.node, vrmBoneId(id)]));
    const rigBones: THREE.Object3D[] = [];
    const skinBones = new Set<THREE.Object3D>();
    const targetsByName = new Map<string, MorphBinding[]>();
    gltf.scene.traverse((node) => {
      this.original.set(node, transformOf(node));
      if (node instanceof THREE.Bone || humanoid.has(node) || (this.kimonoV4 && sourceName(node) === kimonoArmature)) rigBones.push(node);
      if (node instanceof THREE.Mesh && node.morphTargetInfluences && node.morphTargetDictionary) {
        this.morphs.set(node, { original: [...node.morphTargetInfluences], neutral: [] });
      }
      // Keep a skinned mesh visible when an authored joint leaves its bind-pose bounds.
      if (node instanceof THREE.SkinnedMesh) { node.frustumCulled = false; for (const bone of node.skeleton?.bones ?? []) skinBones.add(bone); }
    });
    gltf.scene.updateMatrixWorld(true);
    this.originalBounds = new THREE.Box3().setFromObject(gltf.scene, true);
    const restoreIdle = captureIdle(gltf);
    gltf.scene.updateMatrixWorld(true);
    this.bounds = new THREE.Box3().setFromObject(gltf.scene, true);
    this.height = this.bounds.getSize(new THREE.Vector3()).y;
    if (!Number.isFinite(this.height) || this.height <= 0.00001) {
      restoreIdle();
      throw new Error('模型高度无效，请检查 GLB 内的网格。');
    }

    gltf.scene.traverse((node) => this.neutral.set(node, transformOf(node)));
    const managedTargets = new Set<string>();
    const managed = new Map<string, MorphBinding[]>();
    const morphKey = (node: THREE.Mesh, index: number) => `${node.uuid}:${index}`;
    for (const [name, expression] of Object.entries(this.manager?.expressionMap ?? {})) {
      const targets: MorphBinding[] = [];
      let hasOtherBind = false;
      for (const bind of expression.binds) {
        if (!(bind instanceof VRMExpressionMorphTargetBind)) { hasOtherBind = true; continue; }
        for (const node of bind.primitives) {
          managedTargets.add(morphKey(node, bind.index));
          if (bind.weight > 0 && deformsTarget(node, bind.index)) targets.push({ node, index: bind.index, weight: 0 });
        }
      }
      if (targets.length || hasOtherBind) managed.set(name, targets);
    }
    const ignoredMorphs = new Set<string>();
    for (const [node, weights] of this.morphs) {
      weights.neutral = [...node.morphTargetInfluences!];
      for (const [name, index] of Object.entries(node.morphTargetDictionary!)) {
        if (managedTargets.has(morphKey(node, index))) continue;
        if (/^YK69_request_/i.test(name) || !deformsTarget(node, index)) { ignoredMorphs.add(name); continue; }
        const targets = targetsByName.get(name) || [];
        targets.push({ node, index, weight: weights.neutral[index] });
        targetsByName.set(name, targets);
      }
    }

    const warnings: string[] = [];
    const ignoredCount = [...ignoredMorphs].filter((name) => !targetsByName.has(name)).length;
    if (ignoredCount) warnings.push(`${ignoredCount} 个零形变或请求占位形态未列为可控表情。`);
    if (vrm && !this.manager) warnings.push('VRM 未提供可用的运行时表情管理器。');
    const manualBones = Object.entries(mapping.bones ?? {});
    const manualExpressions = Object.entries(mapping.expressions ?? {});
    const validBones = manualBones.filter(([id, name]) => {
      const valid = rigBones.some((node) => node.name === name || sourceName(node) === name);
      if (!valid) warnings.push(`手动骨骼映射 ${id} 缺少目标 ${name}`);
      return valid;
    });
    const validExpressions = manualExpressions.filter(([id, name]) => {
      const valid = targetsByName.has(name) || managed.has(name);
      if (!valid) warnings.push(`手动表情映射 ${id} 缺少目标 ${name}`);
      return valid;
    });
    const reservedBones = new Set(validBones.map(([id]) => id));
    const reservedExpressions = new Set(validExpressions.map(([id]) => id));
    const bindKimonoRoot = this.kimonoV4 && !reservedBones.has('root') && rigBones.some((node) => sourceName(node) === kimonoArmature);
    if (bindKimonoRoot) reservedBones.add('root');

    // Prefer deforming skeletons over auxiliary rig controls. If two equally
    // plausible joints claim the same role, retain both native controls and
    // request manual mapping instead of guessing based on traversal order.
    const candidates = new Map<string, THREE.Object3D[]>();
    for (const node of rigBones) {
      if (humanoid.has(node)) continue;
      const id = boneDefinitions.get(normalized(sourceName(node)))?.id;
      if (id) candidates.set(id, [...(candidates.get(id) ?? []), node]);
    }
    const resolved = new Map<THREE.Object3D, string>();
    const humanoidRoles = new Set(humanoid.values());
    for (const [id, nodes] of candidates) {
      if (reservedBones.has(id) || humanoidRoles.has(id)) continue;
      const deforming = nodes.filter(node => skinBones.has(node));
      const choices = deforming.length ? deforming : nodes;
      if (choices.length === 1) resolved.set(choices[0], id);
      else warnings.push(`骨骼 ${boneInfo.get(id)?.label ?? id} 存在多个候选，请在模型映射中选择。`);
    }

    for (const [index, node] of rigBones.entries()) {
      const name = sourceName(node);
      const manual = validBones.find(([, value]) => value === node.name || value === name);
      const automatic = humanoid.get(node) ?? resolved.get(node);
      const preferred = manual?.[0] ?? (bindKimonoRoot && name === kimonoArmature ? 'root'
        : automatic && !reservedBones.has(automatic) ? automatic : undefined);
      const fallback = node.name || `node-${index + 1}`;
      let id = preferred && !this.boneBindings.has(preferred) ? preferred : `native:bone:${fallback}`;
      if (this.boneBindings.has(id)) id = `native:bone:${fallback}:${node.uuid}`;
      const frame = restFrame(node);
      const parentBasis = node.parent ? new THREE.Matrix3().setFromMatrix4(node.parent.matrixWorld) : new THREE.Matrix3();
      if (parentBasis.determinant() === 0) {
        restoreIdle();
        throw new Error(`骨骼 ${name || node.name} 的父级缩放为零，无法建立姿态映射。`);
      }
      this.boneBindings.set(id, {
        ...descriptor(id, name || fallback, boneInfo.get(id), 'body'), node,
        neutral: this.neutral.get(node)!, frame,
        inverseFrame: frame.clone().invert(), parentBasis, inverseParentBasis: parentBasis.clone().invert(),
      });
    }

    const addExpression = (name: string, targets: MorphBinding[], managedName?: string) => {
      const manual = validExpressions.find(([, value]) => value === name);
      const automatic = expressionDefinitions.get(normalized(name));
      const preferred = manual?.[0] ?? (automatic && !reservedExpressions.has(automatic.id) ? automatic.id : undefined);
      const id = preferred && !this.expressionBindings.has(preferred) ? preferred : `native:${managedName ? 'vrm' : 'morph'}:${name}`;
      const internal = internalMorph.test(name);
      this.expressionBindings.set(id, { ...descriptor(id, name, expressionInfo.get(id), internal ? 'physics' : 'face'), targets,
        defaultValue: managedName ? 0 : targets[0]?.weight ?? 0, ...(internal ? { internal: true } : {}), managed: managedName });
    };
    for (const [name, targets] of managed) addExpression(name, targets, name);
    for (const [name, targets] of targetsByName) addExpression(name, targets);

    if (!this.boneBindings.size) warnings.push('这个模型没有可编辑骨骼。');
    if (!this.expressionBindings.has('blink') && !(this.expressionBindings.has('blinkLeft') && this.expressionBindings.has('blinkRight'))) {
      warnings.push('缺少双眼闭合通道。');
    }
    if (!this.expressionBindings.has('smile')) warnings.push('缺少微笑通道。');
    if (source.id.startsWith('yukino-')) warnings.push('眼球骨骼缺少蒙皮权重，视线旋转不可用。');
    const retarget: RetargetReference = {};
    for (const [side, limb] of [['left', 'Arm'], ['right', 'Arm'], ['left', 'Leg'], ['right', 'Leg']] as const) {
      const upper = this.boneBindings.get(`${side}Upper${limb}`)?.node;
      const lower = this.boneBindings.get(`${side}Lower${limb}`)?.node;
      if (!upper || !lower) continue;
      const from = upper.getWorldPosition(new THREE.Vector3());
      const direction = lower.getWorldPosition(new THREE.Vector3()).sub(from);
      if (direction.lengthSq() > 1e-10) retarget[`${side}Upper${limb}`] = direction.normalize().toArray() as Vec3;
    }
    restoreIdle();
    const clips = this.convertClips(gltf.animations, source.id, warnings);
    const plain = ({ id, label, source, region, defaultValue, internal }: RigControl): RigControl => ({ id, label, source, region, defaultValue, internal });
    const boneOrder = bones.map((definition) => definition.id);
    const order = (control: RigControl) => boneOrder.includes(control.id) ? boneOrder.indexOf(control.id) : boneOrder.length;
    const controls = [...this.boneBindings.values()]
      .filter(({ id }) => !source.id.startsWith('yukino-') || (id !== 'leftEye' && id !== 'rightEye'))
      .map(plain).sort((left, right) => order(left) - order(right));
    const format = source.format ?? (vrm ? 'vrm' : /\.gltf$/i.test(source.asset.filename) ? 'gltf' : 'glb');
    this.info = {
      ...source, clips, warnings, bones: controls,
      expressions: [...this.expressionBindings.values()].map(plain),
      format,
      retarget,
      physics: vrm ? [`VRM ${vrm.meta.metaVersion === '1' ? '1.0' : '0.x'} 骨骼蒙皮`,
        `弹簧关节 ${vrm.springBoneManager?.joints.size ?? 0} 个，碰撞组 ${vrm.springBoneManager?.colliderGroups.length ?? 0} 个`]
        : this.kimonoV4 ? ['GLB 骨骼蒙皮', '裙摆为逐帧烘焙回放'] : ['GLB 骨骼蒙皮', '弹簧与碰撞求解不可用'],
    };
    this.apply(blankPose(), false);
  }

  apply(pose: Pose, reference: boolean) {
    this.manager?.resetValues();
    if (reference) this.manager?.update();
    for (const [node, transform] of reference ? this.original : this.neutral) writeTransform(node, transform);
    for (const [node, weights] of this.morphs) {
      const source = reference ? weights.original : weights.neutral;
      const values = node.morphTargetInfluences!;
      source.forEach((value, index) => { values[index] = value; });
    }
    const missing = new Set<string>();
    if (reference) return { missing: [] as string[] };

    for (const [id, value] of Object.entries(pose.rotations)) {
      const bone = this.boneBindings.get(id);
      if (!bone) { missing.add(id); continue; }
      this.tempQuat.fromArray(value).normalize().premultiply(bone.inverseFrame).multiply(bone.frame);
      bone.node.quaternion.multiply(this.tempQuat).normalize();
    }
    for (const [id, value] of Object.entries(pose.translations)) {
      const bone = this.boneBindings.get(id);
      if (!bone) { missing.add(id); continue; }
      this.tempVec.fromArray(value).multiplyScalar(this.height).applyMatrix3(bone.inverseParentBasis);
      bone.node.position.add(this.tempVec);
    }
    for (const [id, value] of Object.entries(pose.expressions)) {
      if (eyelids.has(id)) continue;
      if (!this.setExpression(id, value)) missing.add(id);
    }
    const { blink, blinkLeft, blinkRight } = pose.expressions;
    const bilateral = this.expressionBindings.has('blink');
    if (bilateral && (blink !== undefined || blinkLeft !== undefined || blinkRight !== undefined)) this.setExpression('blink', blink ?? 0);
    if (bilateral && (blink ?? 0) > 0) {
      this.setExpression('blinkLeft', 0);
      this.setExpression('blinkRight', 0);
    } else {
      for (const [id, side] of [['blinkLeft', blinkLeft], ['blinkRight', blinkRight]] as const) {
        if (side === undefined && (bilateral || blink === undefined)) continue;
        const value = Math.max(side ?? 0, bilateral ? 0 : blink ?? 0);
        if (!this.setExpression(id, value)) missing.add(!bilateral && blink !== undefined ? 'blink' : id);
      }
    }
    this.manager?.update();
    return { missing: [...missing] };
  }

  private setExpression(id: string, weight: number) {
    const binding = this.expressionBindings.get(id);
    if (!binding) return false;
    const clamped = THREE.MathUtils.clamp(weight, 0, 1);
    if (binding.managed) {
      this.manager?.setValue(binding.managed, clamped);
      return true;
    }
    for (const { node, index } of binding.targets) {
      node.morphTargetInfluences![index] = clamped;
    }
    return true;
  }

  capture(): Pose {
    const pose = blankPose();
    const inverseNeutral = new THREE.Quaternion();
    for (const [id, bone] of this.boneBindings) {
      pose.rotations[id] = this.tempQuat.copy(bone.node.quaternion).premultiply(inverseNeutral.copy(bone.neutral.quaternion).invert())
        .premultiply(bone.frame).multiply(bone.inverseFrame).normalize().toArray() as Quat;
      pose.translations[id] = this.tempVec.copy(bone.node.position).sub(bone.neutral.position)
        .applyMatrix3(bone.parentBasis).divideScalar(this.height).toArray() as Vec3;
    }
    for (const [id, binding] of this.expressionBindings) {
      if (binding.managed) {
        pose.expressions[id] = this.manager?.getExpression(binding.managed)?.outputWeight ?? 0;
        continue;
      }
      const target = binding.targets[0];
      pose.expressions[id] = target.node.morphTargetInfluences![target.index];
    }
    return pose;
  }

  /** Import only clips whose source skeleton matches this model's original bind pose. */
  convertExternalAnimations(gltf: Pick<GLTF, 'scene' | 'animations'>): KeyframeModule[] {
    if (!gltf.animations.length) throw new Error('该 GLB 没有动画，请选择包含动作的 GLB 文件。');
    const bones = new Map([...this.boneBindings.values()].map((bone) => [bone.node.name, bone]));
    const nodes = new Map<string, THREE.Object3D[]>();
    gltf.scene.traverse((node) => { const list = nodes.get(node.name) ?? []; list.push(node); nodes.set(node.name, list); });
    gltf.scene.updateMatrixWorld(true);
    const originalWorld = (node: THREE.Object3D | null): THREE.Matrix4 => {
      if (!node) return new THREE.Matrix4();
      const rest = this.original.get(node);
      if (!rest) return new THREE.Matrix4();
      return originalWorld(node.parent).multiply(new THREE.Matrix4().compose(rest.position, rest.quaternion, rest.scale));
    };
    for (const clip of gltf.animations) for (const track of clip.tracks) {
      let parsed: ReturnType<typeof THREE.PropertyBinding.parseTrackName>;
      try { parsed = THREE.PropertyBinding.parseTrackName(track.name); }
      catch { throw new Error(`无法识别动作通道：${track.name}`); }
      const binding = bones.get(parsed.nodeName), matching = nodes.get(parsed.nodeName) ?? [];
      if (!binding || matching.length !== 1 || !['quaternion', 'position'].includes(parsed.propertyName)) {
        throw new Error(`动作通道 ${track.name} 无法安全匹配当前模型；请使用同一骨架的 GLB 动作。`);
      }
      const interpolation = track.getInterpolation();
      if (interpolation !== THREE.InterpolateDiscrete && interpolation !== THREE.InterpolateLinear) {
        throw new Error(`动作通道 ${track.name} 使用未支持的插值方式，请重新导出为线性或阶梯插值。`);
      }
      const original = this.original.get(binding.node), source = matching[0];
      const sourceParent = source.parent instanceof THREE.Bone ? source.parent.name : '';
      const targetParent = binding.node.parent instanceof THREE.Bone ? binding.node.parent.name : '';
      const sourceFrame = source.parent?.matrixWorld ?? new THREE.Matrix4(), targetFrame = originalWorld(binding.node.parent);
      const frameMismatch = sourceFrame.elements.some((value, index) => Math.abs(value - targetFrame.elements[index]) > 1e-4);
      if (!original || sourceParent !== targetParent || source.position.distanceToSquared(original.position) > 1e-8
        || frameMismatch || source.scale.distanceToSquared(original.scale) > 1e-8 || 1 - Math.abs(source.quaternion.dot(original.quaternion)) > 1e-6) {
        throw new Error(`骨骼 ${parsed.nodeName} 的绑定姿势或层级不同，不能直接导入此动作。`);
      }
    }
    const warnings: string[] = [];
    const converted = this.convertClips(gltf.animations, this.info.id, warnings);
    if (warnings.length) throw new Error(`动作包含无法安全转换的通道：${warnings.join('；')}`);
    if (!converted.length) throw new Error('动作未包含可用于当前模型的有效骨骼变化。');
    return converted.map((clip) => ({ ...clip, id: crypto.randomUUID(), name: clip.name || '导入动作', description: '从 GLB 导入的模型绑定动作' }));
  }

  private convertClips(animations: THREE.AnimationClip[], modelId: string, warnings: string[]) {
    const clips: KeyframeModule[] = [];
    const omitted = new Set<string>();
    const findBone = new Map<string, BoneBinding>();
    for (const bone of this.boneBindings.values()) {
      findBone.set(bone.node.name, bone);
      findBone.set(bone.node.uuid, bone);
    }
    const rotation = new THREE.Quaternion();
    const displacement = new THREE.Vector3();
    for (const [index, clip] of animations.entries()) {
      if (!Number.isFinite(clip.duration) || clip.duration <= 0) continue;
      const handoffBlink = this.kimonoV4 && clip.name === 'Blink';
      const handoffSkirt = this.kimonoV4 && ['SmallStepWalk', 'GentleGreeting'].includes(clip.name);
      const channels: MotionChannel[] = [];
      const expressionChannels = new Map<string, Extract<MotionChannel, { type: 'expression' }>>();
      for (const track of clip.tracks) {
        const binding = THREE.PropertyBinding.parseTrackName(track.name);
        const bone = findBone.get(binding.nodeName);
        const interpolation = track.getInterpolation();
        if (interpolation !== THREE.InterpolateDiscrete && interpolation !== THREE.InterpolateLinear) {
          omitted.add('三次样条');
          continue;
        }
        const mode = interpolation === THREE.InterpolateDiscrete ? 'hold' as const : 'linear' as const;
        const stride = track.getValueSize();
        const data = track.values;
        if (binding.propertyName === 'quaternion' && bone && stride === 4) {
          const inverse = bone.neutral.quaternion.clone().invert();
          const keys = Array.from(track.times, (time, sample) => ({ time, interpolation: mode,
            value: rotation.fromArray(data, sample * stride).normalize().premultiply(inverse)
              .premultiply(bone.frame).multiply(bone.inverseFrame).normalize().toArray() as Quat,
          }));
          if (keys.some(({ value }) => Math.hypot(value[0], value[1], value[2]) > 1e-6)) {
            channels.push({ type: 'rotation', key: bone.id, keys });
          }
        } else if (binding.propertyName === 'position' && bone && stride === 3) {
          const keys = Array.from(track.times, (time, sample) => ({ time, interpolation: mode,
            value: displacement.fromArray(data, sample * stride).sub(bone.neutral.position)
              .applyMatrix3(bone.parentBasis).divideScalar(this.height).toArray() as Vec3,
          }));
          if (keys.some(({ value }) => Math.hypot(...value) > 1e-6)) {
            channels.push({ type: 'translation', key: bone.id, keys });
          }
        } else if (binding.propertyName === 'morphTargetInfluences') {
          for (const expression of this.expressionBindings.values()) {
            if (handoffBlink && !eyelids.has(expression.id)) continue;
            const target = expression.targets.find(({ node }) => node.name === binding.nodeName || node.uuid === binding.nodeName);
            if (!target || target.index >= stride) continue;
            const bakedFrame = handoffSkirt && expression.source.startsWith('Actual_NewCloth_');
            const keepSkirtDefault = handoffSkirt && /^(?:YK_Hide|Kimono_)/.test(expression.source);
            const keys = Array.from(track.times, (time, sample) => ({ time, interpolation: bakedFrame ? 'hold' as const : mode,
              value: THREE.MathUtils.clamp(data[sample * stride + target.index], 0, 1),
            }));
            if (!keepSkirtDefault && !keys.some(({ value }) => Math.abs(value - target.weight) > 1e-6)) continue;
            const previous = expressionChannels.get(expression.id);
            if (!previous) expressionChannels.set(expression.id, { type: 'expression', key: expression.id, keys });
            else if (JSON.stringify(previous.keys) !== JSON.stringify(keys)) omitted.add('同名形态的独立网格权重');
          }
        } else if (binding.propertyName === 'scale' && bone && stride === 3) {
          const differs = Array.from(track.times, (_, sample) => displacement.fromArray(data, sample * stride)
            .distanceToSquared(bone.neutral.scale) > 1e-6).some(Boolean);
          if (differs) omitted.add('动画缩放');
        } else {
          omitted.add('非骨骼变换');
        }
      }
      channels.push(...expressionChannels.values());
      if (channels.length) {
        const idle = clip.name === 'Idle_Breathe';
        const walk = clip.name === 'Walk_Slow_Loop';
        const description = handoffBlink ? '只驱动有效的眼睑权重，保留原有嘴部和其他表情。'
          : handoffSkirt ? `${clip.name === 'SmallStepWalk' ? '前进约 1.2 米的单次动作。' : '保留两项裙摆修正。'}全身动作按互斥顺序播放，裙摆为烘焙回放。`
          : walk ? '模型内置 CMU 慢步循环，未单独验证其它服装与地面接触。' : `GLB 内置动作 ${clip.name}`;
        clips.push({
          id: `embedded:${modelId}:${index}`, kind: 'keyframes', modelId, duration: clip.duration,
          name: idle ? '待机呼吸' : walk ? '原地慢步（评审）' : clip.name,
          description, ...(handoffSkirt ? { exclusiveGroup: 'kimono-v4-skirt' as const } : {}),
          region: handoffBlink ? 'eyes' : 'all', channels,
        });
      }
    }
    if (omitted.size) warnings.push(`内置动作转换受限（${[...omitted].join('、')}）。`);
    return clips;
  }
}
