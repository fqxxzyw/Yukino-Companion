import { AnimationClip, NumberKeyframeTrack, QuaternionKeyframeTrack, VectorKeyframeTrack } from 'three';
import type { Mesh } from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { readCatalogModel } from './local-model.ts';
import type { ModelSource } from './local-model.ts';
import { ModelRig } from './model-rig.ts';
import { channelAllowed, emptyPose, evaluateProject, getModule, moduleRequirements, projectDuration } from './motion/index.ts';
import type { ChannelRequirement, Project } from './motion/index.ts';
import { disposeModel } from './viewport.ts';

interface Capture {
  name: string;
  kind: ChannelRequirement['type'];
  value: () => readonly number[];
}

function captureTargets(project: Project, rig: ModelRig): Capture[] {
  const solo = project.tracks.some((track) => track.solo && !track.muted);
  const targets = new Map<string, Capture>();
  const addMorphs = (mesh: Mesh) => {
    if (!mesh.morphTargetInfluences?.length) return;
    const name = `${mesh.uuid}.morphTargetInfluences`;
    targets.set(name, { name, kind: 'expression', value: () => mesh.morphTargetInfluences! });
  };
  for (const track of project.tracks) {
    if (track.muted || (solo && !track.solo)) continue;
    for (const clip of track.clips) {
      const module = getModule(project, clip.moduleId);
      if (!module || !clip.weight || (module.modelId && module.modelId !== rig.info.id)) continue;
      for (const channel of moduleRequirements(module)) {
        if (!channelAllowed(module.kind === 'keyframes' && module.exclusiveGroup ? 'all' : track.region, channel)) continue;
        const { type, key } = channel;
        if (type === 'expression') {
          const binding = rig.expressionBindings.get(key);
          const meshes = binding?.targets ?? (key === 'blink'
            ? [...(rig.expressionBindings.get('blinkLeft')?.targets ?? []), ...(rig.expressionBindings.get('blinkRight')?.targets ?? [])]
            : []);
          for (const { node } of meshes) addMorphs(node);
          continue;
        }
        const bone = rig.boneBindings.get(key)?.node;
        if (!bone) continue;
        const name = `${bone.uuid}.${type === 'rotation' ? 'quaternion' : 'position'}`;
        targets.set(name, { name, kind: type, value: () => type === 'rotation' ? bone.quaternion.toArray() : bone.position.toArray() });
      }
    }
  }
  return [...targets.values()];
}

async function bake(project: Project, rig: ModelRig) {
  const duration = projectDuration(project);
  if (duration <= 0) throw new Error('先在时间线上添加一个动作片段，再导出 GLB。');
  const frames = Math.ceil(duration * project.fps);
  if (!Number.isFinite(frames) || frames > 36_000) throw new Error('GLB 导出最多烘焙 36,000 帧，请缩短工程后重试。');
  const times = Array.from({ length: frames }, (_, index) => index / project.fps)
    .filter((time) => Math.fround(time) < Math.fround(duration));
  times.push(duration);
  const targets = captureTargets(project, rig).map((target) => ({ ...target, rest: [...target.value()] }));
  const count = targets.reduce((sum, target) => sum + target.rest.length, 0) * times.length;
  if (count > 12_000_000) throw new Error('当前工程的烘焙通道过多，请分段导出 GLB。');
  const captures = targets.map((target) => ({ ...target, values: new Float32Array(target.rest.length * times.length), changed: false }));
  if (!captures.length) throw new Error('当前时间线没有此模型可用的动作通道。');

  for (let frame = 0; frame < times.length; frame++) {
    // Evaluate at double precision before storing timestamps as glTF float32.
    rig.apply(evaluateProject(project, times[frame], rig.info.retarget), false);
    for (const capture of captures) {
      const value = capture.value();
      const stride = capture.rest.length;
      const offset = frame * stride;
      const sign = capture.kind === 'rotation' && value.reduce((dot, part, axis) => dot
        + part * (frame ? capture.values[offset - stride + axis] : capture.rest[axis]), 0) < 0 ? -1 : 1;
      for (const [axis, part] of value.entries()) {
        capture.values[offset + axis] = part * sign;
        if (Math.abs(part * sign - capture.rest[axis]) > 1e-6) capture.changed = true;
      }
    }
    if (frame > 0 && frame % 120 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  const tracks = captures.filter(({ changed }) => changed).map(({ name, kind, values }) => {
    if (kind === 'rotation') return new QuaternionKeyframeTrack(name, times, values);
    if (kind === 'translation') return new VectorKeyframeTrack(name, times, values);
    return new NumberKeyframeTrack(name, times, values);
  });
  if (!tracks.length) throw new Error('选中的片段没有在此模型上产生可烘焙的动作。');
  rig.apply(emptyPose(), false);
  return new AnimationClip(project.name, duration, tracks);
}

export async function exportMotionGlb(project: Project, input: string | ModelSource): Promise<Blob> {
  const source = typeof input === 'string' ? await readCatalogModel(input) : input;
  let scene: Awaited<ReturnType<GLTFLoader['parseAsync']>>['scene'] | undefined;
  try {
    if (source.format === 'vrm') {
      throw new Error('VRM 的材质、表情和弹簧配置需要 VRM 格式。请保留原始 VRM 并导出动作 JSON。');
    }
    if (project.modelId !== source.id || (project.asset?.sha256 && project.asset.sha256.toLowerCase() !== source.asset.sha256)) {
      throw new Error('当前模型与工程绑定不一致，请重新定位工程中的模型。');
    }
    const gltf = await new GLTFLoader().parseAsync(source.data, '');
    scene = gltf.scene;
    const rig = new ModelRig(gltf, source, project.mappings?.[source.id] ?? {});
    const animation = await bake(project, rig);
    const result = await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: false, animations: [animation] });
    if (!(result instanceof ArrayBuffer)) throw new Error('GLB 二进制写入失败。');
    return new Blob([result], { type: 'model/gltf-binary' });
  } finally {
    if (scene) disposeModel(scene);
    source.release?.();
  }
}
