import { clamp, emptyPose, identity, lerp, multiplyQuaternion, newId, slerp, timeEpsilon, zero } from './math.ts';
import { builtinModules, sampleModule } from './modules.ts';
import { retargetModulePose } from './retarget.ts';
import type { ChannelRequirement, Clip, Fps, MotionModule, Pose, Project, Region, RetargetReference, Track } from './types.ts';

export function createTrack(name: string, region: Region = 'all'): Track {
  return { id: newId(), name, region, muted: false, solo: false, locked: false, clips: [] };
}

export function createProject(modelId: string): Project {
  return {
    version: 1, id: newId(), name: '未命名动作', modelId, fps: 30, playhead: 0, modules: [],
    tracks: [
      createTrack('身体', 'body'),
      createTrack('右臂', 'rightArm'),
      createTrack('头颈', 'head'),
      createTrack('眼部', 'eyes'),
      createTrack('表情', 'face'),
      createTrack('口型', 'mouth'),
      createTrack('动作录制', 'all'),
    ],
  };
}

export function createClip(module: MotionModule, start = 0): Clip {
  const fade = module.kind === 'procedural' && ['smile', 'mouthOpen'].includes(module.procedure) ? 0.2 : 0;
  return {
    id: newId(), moduleId: module.id, start: Math.max(0, Math.round(start)), sourceIn: 0, sourceOut: module.duration,
    speed: 1, loops: 1, stretch: null, blendIn: fade, blendOut: fade, weight: 1, mode: 'override',
    priority: module.kind === 'procedural' && module.procedure === 'closed' ? 10 : 0,
    parameters: module.kind === 'procedural'
      ? Object.fromEntries(module.parameters.map(({ key, defaultValue }) => [key, defaultValue]))
      : {},
  };
}

export function getModule(project: Project, id: string): MotionModule | undefined {
  return project.modules.find((module) => module.id === id) ?? builtinModules.find((module) => module.id === id);
}

export function createExampleProject(modelId: string): Project {
  const project = { ...createProject(modelId), name: '雪乃 · 动作示例' };
  const placements: [string, Region, number][] = [
    ['idle', 'body', 0], ['waveRight', 'rightArm', 1.1], ['headTilt', 'head', 0.8],
    ['blink', 'eyes', 0.6], ['blink', 'eyes', 3.4], ['smile', 'face', 0.9],
  ];
  for (const [moduleId, region, seconds] of placements) {
    const track = project.tracks.find((item) => item.region === region);
    const module = getModule(project, moduleId);
    if (!track || !module) continue;
    track.clips.push(createClip(module, seconds * project.fps));
    if (!project.modules.some((item) => item.id === moduleId)) project.modules.push(module);
  }
  return project;
}

export function fullClipDuration(clip: Clip): number {
  return clip.stretch ?? (clip.sourceOut - clip.sourceIn) / clip.speed * clip.loops;
}

export function clipDuration(clip: Clip): number {
  const portion = clip.window ? clip.window.to - clip.window.from : 1;
  return fullClipDuration(clip) * portion;
}

export function projectDuration(project: Project): number {
  let duration = 0;
  for (const track of project.tracks) {
    for (const clip of track.clips) duration = Math.max(duration, clip.start / project.fps + clipDuration(clip));
  }
  return duration;
}

export function clipSourceTime(clip: Clip, localSeconds: number): number | undefined {
  const full = fullClipDuration(clip);
  if (full <= 0 || !Number.isFinite(localSeconds)
    || localSeconds < -timeEpsilon || localSeconds > clipDuration(clip) + timeEpsilon) return undefined;
  const progress = clamp((clip.window?.from ?? 0) + clamp(localSeconds, 0, clipDuration(clip)) / full);
  if (progress >= 1 - timeEpsilon) return clip.sourceOut;
  const cycles = progress * clip.loops;
  const phase = Math.abs(cycles - Math.round(cycles)) <= timeEpsilon ? 0 : cycles % 1;
  return lerp(clip.sourceIn, clip.sourceOut, phase);
}

export function splitClip(clip: Clip, atFrame: number, fps: Fps): [Clip, Clip] | null {
  const split = Math.round(atFrame);
  const seconds = (split - clip.start) / fps;
  if (seconds <= timeEpsilon || seconds >= clipDuration(clip) - timeEpsilon) return null;
  const from = clip.window?.from ?? 0;
  const to = clip.window?.to ?? 1;
  const splitFraction = from + seconds / fullClipDuration(clip);
  return [
    { ...clip, window: { from, to: splitFraction } },
    { ...clip, id: newId(), start: split, window: { from: splitFraction, to } },
  ];
}

export function changeProjectFps(project: Project, fps: Fps): Project {
  if (fps === project.fps) return project;
  const convert = (frame: number) => Math.round(frame * fps / project.fps);
  return {
    ...project, fps, playhead: project.playhead === undefined ? undefined : convert(project.playhead),
    tracks: project.tracks.map((track) => ({
      ...track, clips: track.clips.map((clip) => ({ ...clip, start: convert(clip.start) })),
    })),
  };
}

export function channelAllowed(region: Region, { type, key }: ChannelRequirement): boolean {
  if (region === 'all') return true;
  if (type === 'expression') {
    const eye = /^(blink|eye|wink|look)/i.test(key);
    const brow = /^brow/i.test(key);
    const mouth = /^(mouth|viseme|jaw|aa$|ih$|ou$|ee$|oh$|mbp$)/i.test(key);
    switch (region) {
      case 'eyes': return eye;
      case 'brows': return brow;
      case 'mouth': return mouth;
      case 'lookAt': return /^look/i.test(key);
      case 'face': return !eye && !brow && !mouth;
      default: return false;
    }
  }
  const root = key === 'root';
  const lower = /^(hips$|(?:left|right)(?:upperLeg|lowerLeg|foot|toe))/i.test(key);
  const arm = /^(left|right)(?:clavicle|shoulder|upperArm|lowerArm|hand|thumb|index|middle|ring|little)/i.test(key);
  const head = /^(head|neck)/i.test(key);
  switch (region) {
    case 'body': return !root;
    case 'root': return root;
    case 'head': return head;
    case 'lowerBody': return lower;
    case 'upperBody': return arm || head || /^(spine|chest|upperChest)/i.test(key);
    case 'leftArm': return arm && key.startsWith('left');
    case 'rightArm': return arm && key.startsWith('right');
    case 'lookAt': return /^(leftEye|rightEye)/i.test(key);
    default: return false;
  }
}

interface ActiveClip {
  clip: Clip;
  region: Region;
  weight: number;
  time: number;
  module: MotionModule;
}

const exclusiveGroup = (module: MotionModule) => module.kind === 'keyframes' ? module.exclusiveGroup : undefined;

function activeClips(project: Project, seconds: number): ActiveClip[] {
  if (!Number.isFinite(seconds) || seconds < 0) return [];
  const solo = project.tracks.some((track) => track.solo && !track.muted);
  const active: ActiveClip[] = [];
  for (const track of project.tracks) {
    if (track.muted || (solo && !track.solo)) continue;
    for (const clip of track.clips) {
      const local = seconds - clip.start / project.fps;
      if (local < -timeEpsilon || local >= clipDuration(clip) - timeEpsilon) continue;
      const module = getModule(project, clip.moduleId);
      if (!module || (module.modelId && module.modelId !== project.modelId)) continue;
      const full = fullClipDuration(clip);
      const elapsed = Math.max(0, local) + full * (clip.window?.from ?? 0);
      const incoming = clip.blendIn > 0 ? elapsed / clip.blendIn : 1;
      const outgoing = clip.blendOut > 0 ? (full - elapsed) / clip.blendOut : 1;
      const exclusive = exclusiveGroup(module);
      const weight = exclusive && clip.weight > 0 ? 1 : clamp(Math.min(incoming, outgoing)) * clamp(clip.weight);
      const time = clipSourceTime(clip, local);
      if (weight > 0 && time !== undefined) active.push({ clip, region: exclusive ? 'all' : track.region, weight, module, time });
    }
  }
  return active.sort((a, b) => (a.clip.priority ?? 0) - (b.clip.priority ?? 0));
}

function eachChannel(
  { module, region, time, clip }: ActiveClip,
  callback: (type: ChannelRequirement['type'], key: string, source: Pose) => void,
  target?: RetargetReference,
): void {
  const pose = retargetModulePose(sampleModule(module, time, clip.parameters), module, time, target);
  for (const key of Object.keys(pose.rotations)) if (channelAllowed(region, { type: 'rotation', key })) callback('rotation', key, pose);
  for (const key of Object.keys(pose.translations)) if (channelAllowed(region, { type: 'translation', key })) callback('translation', key, pose);
  for (const key of Object.keys(pose.expressions)) if (channelAllowed(region, { type: 'expression', key })) callback('expression', key, pose);
}

export function evaluateProject(project: Project, seconds: number, target?: RetargetReference): Pose {
  const pose = emptyPose();
  const contributions = activeClips(project, seconds);
  const winners = new Map<string, ActiveClip>();
  for (const active of contributions) {
    const group = exclusiveGroup(active.module);
    if (!group) continue;
    const current = winners.get(group);
    if (!current || (active.clip.priority ?? 0) > (current.clip.priority ?? 0) ||
      ((active.clip.priority ?? 0) === (current.clip.priority ?? 0) && active.clip.start >= current.clip.start)) winners.set(group, active);
  }
  for (const active of contributions) {
    const { weight, clip } = active;
    const group = exclusiveGroup(active.module);
    if (group && winners.get(group) !== active) continue;
    const additive = !group && clip.mode === 'additive';
    const priority = !!group || clip.mode === 'priority';
    eachChannel(active, (type, key, source) => {
      switch (type) {
        case 'rotation': {
          const previous = priority ? identity : pose.rotations[key] ?? identity;
          const next = source.rotations[key];
          pose.rotations[key] = additive
            ? multiplyQuaternion(previous, slerp(identity, next, weight))
            : slerp(previous, next, weight);
          break;
        }
        case 'translation': {
          const previous = priority ? zero : pose.translations[key] ?? zero;
          const [x, y, z] = source.translations[key];
          pose.translations[key] = additive
            ? [previous[0] + x * weight, previous[1] + y * weight, previous[2] + z * weight]
            : [lerp(previous[0], x, weight), lerp(previous[1], y, weight), lerp(previous[2], z, weight)];
          break;
        }
        case 'expression': {
          if (key === 'blink') {
            delete pose.expressions.blinkLeft;
            delete pose.expressions.blinkRight;
          } else if (key === 'blinkLeft' || key === 'blinkRight') {
            delete pose.expressions.blink;
          }
          const previous = priority ? 0 : pose.expressions[key] ?? 0;
          const value = source.expressions[key];
          const eyelid = key === 'blink' || key === 'blinkLeft' || key === 'blinkRight';
          pose.expressions[key] = clamp(additive
            ? eyelid ? Math.max(previous, value * weight) : previous + value * weight
            : lerp(previous, value, weight));
          break;
        }
      }
    }, target);
  }
  return pose;
}

export interface ChannelConflict extends ChannelRequirement {
  clipIds: string[];
}

export function findConflicts(project: Project, seconds: number): ChannelConflict[] {
  const conflicts = new Map<string, ChannelConflict>();
  for (const active of activeClips(project, seconds)) {
    eachChannel(active, (type, key) => {
      const keys = type === 'expression' && key === 'blink' ? ['blinkLeft', 'blinkRight'] : [key];
      for (const name of keys) {
        const id = type + ':' + name;
        const existing = conflicts.get(id) ?? { type, key: name, clipIds: [] };
        if (!existing.clipIds.includes(active.clip.id)) existing.clipIds.push(active.clip.id);
        conflicts.set(id, existing);
      }
    });
  }
  return [...conflicts.values()].filter(({ clipIds }) => clipIds.length > 1);
}
