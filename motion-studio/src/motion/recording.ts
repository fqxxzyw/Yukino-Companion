import { clamp, emptyPose, identity, newId, normalizeQuaternion, timeEpsilon, zero } from './math.ts';
import type { ChannelType, Fps, Interpolation, Keyframe, KeyframeModule, MotionChannel, Pose, Quat, Vec3 } from './types.ts';

interface PoseSample {
  frame: number;
  pose: Pose;
}

export interface Recording {
  name: string;
  fps: Fps;
  baseline: Pose;
  samples: PoseSample[];
  stroke?: { time: number; frame: number };
}

export function createRecording(name: string, fps: Fps = 30, baseline = emptyPose()): Recording {
  return { name, fps, baseline: structuredClone(baseline), samples: [] };
}

export function endRecordingStroke(recording: Recording): void {
  recording.stroke = undefined;
}

function changedChannels<T>(
  input: Record<string, T> | undefined, previous: Record<string, T>, baseline: Record<string, T>,
  neutral: T, equal: (a: T, b: T) => boolean,
): Record<string, T> {
  return Object.fromEntries(Object.entries(input ?? {}).filter(([key, value]) =>
    !equal(value, previous[key] ?? baseline[key] ?? neutral)));
}

export function sampleRecording(recording: Recording, input: Partial<Pose>, now: number): number {
  const { samples, fps, baseline } = recording;
  const previous = samples.at(-1);
  const current = previous?.pose ?? emptyPose();
  const rotations = changedChannels(input.rotations, current.rotations, baseline.rotations, identity, equalRotations);
  const translations = changedChannels(input.translations, current.translations, baseline.translations, zero, equalVectors);
  const expressions = changedChannels(input.expressions, current.expressions, baseline.expressions, 0, equalWeights);
  if (!Number.isFinite(now) || ![rotations, translations, expressions].some((channels) => Object.keys(channels).length)) {
    return previous ? (previous.frame + 1) / fps : 0;
  }

  const stroke = recording.stroke ??= { time: now, frame: previous ? previous.frame + 1 : 0 };
  const frame = stroke.frame + Math.max(0, Math.round((now - stroke.time) * fps / 1000));
  if (previous && frame < previous.frame) return (previous.frame + 1) / fps;
  const delta = structuredClone({ rotations, translations, expressions });
  const pose = {
    rotations: { ...current.rotations, ...delta.rotations },
    translations: { ...current.translations, ...delta.translations },
    expressions: { ...current.expressions, ...delta.expressions },
  };
  if (frame === previous?.frame) {
    samples[samples.length - 1] = { frame, pose };
  } else {
    if (previous && frame > previous.frame + 1) samples.push({ ...previous, frame: frame - 1 });
    samples.push({ frame, pose });
  }
  return (frame + 1) / fps;
}

function compressKeys<T>(
  keys: Keyframe<T>[], equivalent: (a: T, b: T) => boolean,
): Keyframe<T>[] {
  return keys.filter(({ value }, index) => index === 0 || index === keys.length - 1
    || !equivalent(value, keys[index - 1].value) || !equivalent(value, keys[index + 1].value));
}

function equalVectors(a: Vec3, b: Vec3): boolean {
  return a.every((value, index) => Math.abs(value - b[index]) <= timeEpsilon);
}

function equalRotations(a: Quat, b: Quat): boolean {
  const dot = a.reduce((sum, value, index) => sum + value * b[index], 0);
  return Math.abs(dot) >= 1 - timeEpsilon;
}

function equalWeights(a: number, b: number): boolean {
  return Math.abs(a - b) <= timeEpsilon;
}

export function finishRecording(recording: Recording): KeyframeModule | null {
  const { samples, fps, baseline } = recording;
  const last = samples.at(-1);
  if (!last) return null;
  const duration = (last.frame + 1) / fps;
  const channels: MotionChannel[] = [];
  for (const key of new Set(samples.flatMap((sample) => Object.keys(sample.pose.rotations)))) {
    const keys = samples.map(({ frame, pose }) => ({ time: frame / fps, value: pose.rotations[key] ?? baseline.rotations[key] ?? identity }));
    channels.push({ type: 'rotation', key, keys: compressKeys(keys, equalRotations) });
  }
  for (const key of new Set(samples.flatMap((sample) => Object.keys(sample.pose.translations)))) {
    const keys = samples.map(({ frame, pose }) => ({ time: frame / fps, value: pose.translations[key] ?? baseline.translations[key] ?? zero }));
    channels.push({ type: 'translation', key, keys: compressKeys(keys, equalVectors) });
  }
  for (const key of new Set(samples.flatMap((sample) => Object.keys(sample.pose.expressions)))) {
    const keys = samples.map(({ frame, pose }) => ({ time: frame / fps, value: pose.expressions[key] ?? baseline.expressions[key] ?? 0 }));
    channels.push({ type: 'expression', key, keys: compressKeys(keys, equalWeights) });
  }
  return {
    id: newId(), kind: 'keyframes', name: recording.name, region: 'all', duration, channels, version: 1,
  };
}

function withKey<T>(keys: Keyframe<T>[], next: Keyframe<T>): Keyframe<T>[] {
  return [...keys.filter((key) => Math.abs(key.time - next.time) > timeEpsilon), next]
    .sort((a, b) => a.time - b.time);
}

export function setKeyframe(
  module: KeyframeModule,
  type: ChannelType,
  key: string,
  time: number,
  value: Quat | Vec3 | number,
  interpolation: Interpolation = 'linear',
): KeyframeModule {
  if (!key || !Number.isFinite(time) || time < 0) throw new Error('关键帧时间或通道无效。');
  const index = module.channels.findIndex((channel) => channel.type === type && channel.key === key);
  const channel = module.channels[index];
  let replacement: MotionChannel;
  switch (type) {
    case 'rotation':
      if (!Array.isArray(value) || value.length !== 4 || !value.every(Number.isFinite)) throw new Error('旋转需要有效的四元数。');
      replacement = {
        type, key, keys: withKey(channel?.type === type ? channel.keys : [], {
          time, value: normalizeQuaternion(value), interpolation,
        }),
      };
      break;
    case 'translation':
      if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) throw new Error('位移需要有效的三维坐标。');
      replacement = { type, key, keys: withKey(channel?.type === type ? channel.keys : [], { time, value: [...value], interpolation }) };
      break;
    case 'expression':
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('表情权重无效。');
      replacement = {
        type, key, keys: withKey(channel?.type === type ? channel.keys : [], { time, value: clamp(value), interpolation }),
      };
      break;
  }
  const channels = [...module.channels];
  if (index < 0) channels.push(replacement);
  else channels[index] = replacement;
  return { ...module, duration: Math.max(module.duration, time), channels };
}

export function removeKeyframe(module: KeyframeModule, type: ChannelType, key: string, time: number): KeyframeModule {
  const channels: MotionChannel[] = [];
  for (const channel of module.channels) {
    if (channel.type !== type || channel.key !== key) {
      channels.push(channel);
      continue;
    }
    const keep = (frame: Keyframe<unknown>) => Math.abs(frame.time - time) > timeEpsilon;
    switch (channel.type) {
      case 'rotation': channels.push({ ...channel, keys: channel.keys.filter(keep) }); break;
      case 'translation': channels.push({ ...channel, keys: channel.keys.filter(keep) }); break;
      case 'expression': channels.push({ ...channel, keys: channel.keys.filter(keep) }); break;
    }
  }
  return { ...module, channels: channels.filter((channel) => channel.keys.length > 0) };
}
