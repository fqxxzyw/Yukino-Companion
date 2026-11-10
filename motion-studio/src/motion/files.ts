import { timeEpsilon } from './math.ts';
import { procedureByName } from './modules.ts';
import { fullClipDuration, getModule } from './timeline.ts';
import { regionLabels } from './types.ts';
import type { Clip, MotionModule, Project, Track } from './types.ts';

const projectFormat = 'yukino-motion-project';
const runtimeFormat = 'yukino-motion-runtime';
const invalidKeys = new Set(['__proto__', 'constructor', 'prototype']);
type JsonObject = Record<string, unknown>;

function requireValid(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(`文件中的${label}无效。`);
}

function object(value: unknown, label: string): JsonObject {
  requireValid(value !== null && typeof value === 'object' && !Array.isArray(value), label);
  return value as JsonObject;
}

function list(value: unknown, label: string): unknown[] {
  requireValid(Array.isArray(value), label);
  return value;
}

function string(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function identifier(value: unknown): value is string {
  return string(value) && !invalidKeys.has(value);
}

function number(value: unknown, min = -Infinity, max = Infinity): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function integer(value: unknown, min = 0): value is number {
  return number(value, min) && Number.isSafeInteger(value);
}

function flag(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function oneOf(value: unknown, values: string[]): boolean {
  return typeof value === 'string' && values.includes(value);
}

function region(value: unknown): boolean {
  return typeof value === 'string' && Object.hasOwn(regionLabels, value);
}

function unique(values: string[], label: string): void {
  requireValid(new Set(values).size === values.length, label);
}

function validateParameters(value: unknown, name: string): void {
  const reference = procedureByName(name);
  requireValid(reference, '程序动作类型');
  const keys = list(value, '动作参数').map((value) => {
    const param = object(value, '动作参数');
    const schema = reference.parameters.find(({ key }) => key === param.key);
    requireValid(schema && string(param.label) && number(param.min, schema.min, schema.max)
      && number(param.max, param.min, schema.max) && number(param.defaultValue, param.min, param.max)
      && number(param.step, Number.MIN_VALUE) && (param.unit === undefined || typeof param.unit === 'string'),
    '动作参数定义');
    return schema.key;
  });
  unique(keys, '重复的动作参数');
  requireValid(keys.length === reference.parameters.length, '动作参数数量');
}

function validateModule(value: unknown): MotionModule {
  const module = object(value, '动作模块');
  requireValid(identifier(module.id) && string(module.name) && region(module.region)
    && (module.version === 1 || module.version === undefined)
    && (module.modelId === undefined || identifier(module.modelId))
    && (module.description === undefined || typeof module.description === 'string')
    && number(module.duration, Number.MIN_VALUE), '动作模块属性');
  const { duration } = module;
  if (module.kind === 'procedural') {
    requireValid(string(module.procedure), '程序动作类型');
    validateParameters(module.parameters, module.procedure);
  } else {
    requireValid(module.kind === 'keyframes', '动作模块类型');
    requireValid(module.exclusiveGroup === undefined || module.exclusiveGroup === 'kimono-v4-skirt', '全身动作互斥组');
    if (module.restDirections !== undefined) {
      const directions = object(module.restDirections, '动作参考姿态');
      for (const [key, value] of Object.entries(directions)) {
        requireValid(['leftUpperArm', 'rightUpperArm', 'leftUpperLeg', 'rightUpperLeg'].includes(key), '动作参考关节');
        const vector = list(value, '动作参考方向');
        requireValid(vector.length === 3 && vector.every((part) => number(part, -1.001, 1.001))
          && Math.abs(Math.hypot(...vector as number[]) - 1) < 0.001, '动作参考方向');
      }
    }
    const channels = list(module.channels, '关键帧通道').map((value) => {
      const channel = object(value, '关键帧通道');
      requireValid(identifier(channel.key) && oneOf(channel.type, ['rotation', 'translation', 'expression']),
        '关键帧通道类型或名称');
      let previous = -Infinity;
      for (const value of list(channel.keys, '关键帧列表')) {
        const key = object(value, '关键帧');
        requireValid(number(key.time, 0, duration + timeEpsilon) && key.time > previous
          && (key.interpolation === undefined || oneOf(key.interpolation, ['linear', 'smooth', 'hold'])),
        '关键帧时间或插值');
        previous = key.time;
        if (channel.type === 'expression') {
          requireValid(number(key.value, 0, 1), '表情权重');
        } else {
          const vector = list(key.value, '骨骼数据');
          requireValid(vector.length === (channel.type === 'rotation' ? 4 : 3) && vector.every((item) => number(item)), '骨骼数据');
          if (channel.type === 'rotation') requireValid(Math.abs(Math.hypot(...vector as number[]) - 1) <= 1e-4, '单位四元数');
        }
      }
      return String(channel.type) + ':' + channel.key;
    });
    unique(channels, '重复的关键帧通道');
  }
  return value as MotionModule;
}

function validateClip(value: unknown): Clip {
  const clip = object(value, '时间线片段');
  requireValid(identifier(clip.id) && identifier(clip.moduleId) && integer(clip.start)
    && number(clip.sourceIn, 0) && number(clip.sourceOut, clip.sourceIn + timeEpsilon)
    && number(clip.speed, Number.MIN_VALUE) && integer(clip.loops, 1)
    && (clip.stretch === null || number(clip.stretch, timeEpsilon))
    && number(clip.blendIn, 0) && number(clip.blendOut, 0) && number(clip.weight, 0, 1)
    && oneOf(clip.mode, ['override', 'additive', 'priority'])
    && (clip.priority === undefined || number(clip.priority)), '片段属性');
  if (clip.window !== undefined) {
    const window = object(clip.window, '分割片段窗口');
    requireValid(number(window.from, 0, 1) && number(window.to, 0, 1) && window.to > window.from,
      '分割片段窗口');
  }
  for (const [key, value] of Object.entries(object(clip.parameters, '片段参数'))) {
    requireValid(identifier(key) && number(value), '片段参数值');
  }
  const result = value as Clip;
  requireValid(number(fullClipDuration(result), timeEpsilon), '片段播放长度');
  return result;
}

function validateTrack(value: unknown, runtime: boolean): Track {
  const track = object(value, '轨道');
  requireValid(identifier(track.id) && string(track.name) && region(track.region)
    && flag(track.muted) && flag(track.solo) && (runtime || flag(track.locked)), '轨道属性');
  const clips = list(track.clips, '轨道片段').map(validateClip);
  return { ...(value as Track), clips, locked: runtime ? false : track.locked as boolean };
}

function validateAsset(value: unknown): void {
  const asset = object(value, '资源引用');
  requireValid(string(asset.name) && (asset.path === undefined || string(asset.path))
    && (asset.sha256 === undefined || (typeof asset.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(asset.sha256))),
  '资源引用');
}

function validateMappings(value: unknown): void {
  for (const [modelId, entry] of Object.entries(object(value, '模型映射列表'))) {
    requireValid(identifier(modelId), '模型映射 ID');
    const mapping = object(entry, '模型映射');
    for (const key of ['bones', 'expressions']) {
      if (mapping[key] === undefined) continue;
      for (const [source, destination] of Object.entries(object(mapping[key], '模型通道映射'))) {
        requireValid(identifier(source) && identifier(destination), '模型通道映射');
      }
    }
  }
}

function decode(text: string, runtime: boolean): Project {
  let json: unknown;
  try {
    json = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('文件不是有效的 JSON。');
  }
  const file = object(json, '文件结构');
  requireValid(file.format === (runtime ? runtimeFormat : projectFormat), '文件类型');
  requireValid(file.version === 1, '版本');
  const id = runtime ? file.projectId : file.id;
  requireValid(identifier(id) && string(file.name) && identifier(file.modelId)
    && (file.fps === 24 || file.fps === 30 || file.fps === 60)
    && (file.playhead === undefined || integer(file.playhead)), '工程属性');
  const project: Project = {
    version: 1, id, name: file.name, modelId: file.modelId, fps: file.fps,
    tracks: list(file.tracks, '轨道列表').map((track) => validateTrack(track, runtime)),
    modules: list(file.modules, '动作模块列表').map(validateModule),
  };
  if (!runtime && typeof file.playhead === 'number') project.playhead = file.playhead;
  if (file.asset !== undefined) {
    validateAsset(file.asset);
    project.asset = file.asset as Project['asset'];
  }
  if (file.mappings !== undefined) {
    validateMappings(file.mappings);
    project.mappings = file.mappings as Project['mappings'];
  }
  unique(project.tracks.map((track) => track.id), '重复的轨道 ID');
  unique(project.modules.map((module) => module.id), '重复的动作 ID');
  const clips = project.tracks.flatMap((track) => track.clips);
  unique(clips.map((clip) => clip.id), '重复的片段 ID');
  for (const clip of clips) {
    const module = runtime ? project.modules.find((module) => module.id === clip.moduleId) : getModule(project, clip.moduleId);
    requireValid(module, '片段引用的动作模块');
    requireValid(clip.sourceOut <= module.duration + timeEpsilon, '片段裁剪范围');
    requireValid(module.kind !== 'keyframes' || !module.exclusiveGroup || clip.loops === 1, '互斥全身动作循环次数');
  }
  return project;
}

export const readProject = (text: string): Project => decode(text, false);
export const readRuntime = (text: string): Project => decode(text, true);

export function writeProject(project: Project): string {
  const text = JSON.stringify({ format: projectFormat, ...project }, null, 2);
  readProject(text);
  return text;
}

export function writeRuntime(project: Project): string {
  const { version, id: projectId, name, modelId, fps, asset, mappings } = project;
  const tracks = project.tracks.map(({ id, name, region, muted, solo, clips }) => ({ id, name, region, muted, solo, clips }));
  const references = new Set(tracks.flatMap((track) => track.clips.map((clip) => clip.moduleId)));
  const modules = [...references].map((id) => getModule(project, id));
  const text = JSON.stringify({
    format: runtimeFormat, version, projectId, name, modelId, fps, tracks, modules, asset, mappings,
  }, null, 2);
  readRuntime(text);
  return text;
}
