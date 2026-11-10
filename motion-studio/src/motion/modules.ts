import { clamp, emptyPose, eulerDegreesToQuat, lerp, slerp, smooth } from './math.ts';
import type {
  ChannelRequirement, Keyframe, MotionModule, MotionParameter, Pose, Procedure, ProceduralModule, Quat, Region, Vec3,
} from './types.ts';

const parameter = (
  key: string, label: string, defaultValue: number, min: number, max: number, step: number, unit?: string,
): MotionParameter => ({ key, label, defaultValue, min, max, step, ...(unit ? { unit } : {}) });

const intensity = parameter('intensity', '强度', 1, 0, 1, 0.01);
const eyelidParameters = [
  parameter('closing', '闭合', 0.1, 0.01, 2, 0.01, 's'),
  parameter('hold', '保持', 0.06, 0, 5, 0.01, 's'),
  parameter('opening', '睁开', 0.14, 0.01, 2, 0.01, 's'),
  intensity,
];
const waveParameters = [
  parameter('lift', '抬臂角度', 32, 0, 80, 1, '°'),
  parameter('bend', '屈肘角度', 95, 15, 140, 1, '°'),
  parameter('amplitude', '挥动幅度', 22, 0, 50, 1, '°'),
  parameter('frequency', '节奏倍率', 1, 0.25, 3, 0.05, '×'),
  parameter('cycles', '挥动次数', 3, 1, 12, 1),
];

function procedural(
  procedure: Procedure, name: string, region: Region, duration: number, parameters: MotionParameter[], description?: string,
): ProceduralModule {
  return {
    id: procedure, procedure, kind: 'procedural', version: 1, name, region, duration, parameters,
    ...(description ? { description } : {}),
  };
}

export const builtinModules: readonly ProceduralModule[] = [
  procedural('idle', '待机呼吸', 'body', 4, [parameter('amount', '呼吸幅度', 1, 0, 3, 0.05, '°')]),
  procedural('blink', '眨眼', 'eyes', 0.3, eyelidParameters, '闭合、保持和睁开的比例会适配片段长度。'),
  procedural('closed', '闭眼保持', 'eyes', 2, eyelidParameters.map((item) => ({
    ...item, defaultValue: item.key === 'hold' ? 1.76 : item.defaultValue,
  }))),
  procedural('winkLeft', '左眼 Wink', 'eyes', 0.42, eyelidParameters),
  procedural('winkRight', '右眼 Wink', 'eyes', 0.42, eyelidParameters),
  procedural('smile', '微笑', 'face', 2.6, [{ ...intensity, defaultValue: 0.78 }]),
  procedural('headTilt', '歪头', 'head', 2, [parameter('angle', '方向与角度', 16, -35, 35, 1, '°')]),
  procedural('nod', '点头', 'head', 0.9, [parameter('angle', '点头角度', 13, 0, 32, 1, '°')]),
  procedural('waveLeft', '左手挥动', 'leftArm', 2.6, waveParameters, '程序化挥手，可编辑抬臂、屈肘和摆动。'),
  procedural('waveRight', '右手挥动', 'rightArm', 2.6, waveParameters, '程序化挥手，可编辑抬臂、屈肘和摆动。'),
  procedural('mouthOpen', '张嘴', 'mouth', 1, [{ ...intensity, defaultValue: 0.7 }], '使用模型的张嘴形态键。'),
];

export function procedureByName(name: string): ProceduralModule | undefined {
  return builtinModules.find((module) => module.procedure === name);
}

function sampleKeyframes<T>(
  keys: Keyframe<T>[], time: number, interpolate: (a: T, b: T, t: number) => T,
): T | undefined {
  if (!keys.length) return undefined;
  if (time <= keys[0].time) return keys[0].value;
  if (time >= keys[keys.length - 1].time) return keys[keys.length - 1].value;
  let from = 0;
  let to = keys.length - 1;
  while (to - from > 1) {
    const midpoint = Math.floor((from + to) / 2);
    if (keys[midpoint].time > time) to = midpoint;
    else from = midpoint;
  }
  const previous = keys[from];
  const next = keys[to];
  if (previous.interpolation === 'hold') return previous.value;
  const ratio = (time - previous.time) / (next.time - previous.time);
  return interpolate(previous.value, next.value, previous.interpolation === 'smooth' ? smooth(ratio) : ratio);
}

function vecLerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function getParameters(module: ProceduralModule, overrides: Record<string, number>): Record<string, number> {
  return Object.fromEntries(module.parameters.map(({ key, min, max, defaultValue }) => [
    key, clamp(Number.isFinite(overrides[key]) ? overrides[key] : defaultValue, min, max),
  ]));
}

function eyelidWeight(progress: number, parameters: Record<string, number>): number {
  const { closing, hold, opening, intensity: strength } = parameters;
  const phase = progress * (closing + hold + opening);
  if (phase < closing) return strength * smooth(phase / closing);
  if (phase < closing + hold) return strength;
  return strength * (1 - smooth(clamp((phase - closing - hold) / opening)));
}

function evaluateProcedure(module: ProceduralModule, time: number, overrides: Record<string, number>): Pose {
  const progress = clamp(time / module.duration);
  const parameters = getParameters(module, overrides);
  const pose = emptyPose();
  const rotate = (key: string, x: number, y: number, z: number) => {
    pose.rotations[key] = eulerDegreesToQuat([x, y, z]);
  };
  switch (module.procedure) {
    case 'blink':
    case 'closed':
      pose.expressions.blink = eyelidWeight(progress, parameters);
      break;
    case 'winkLeft':
    case 'winkRight':
      pose.expressions[module.procedure === 'winkLeft' ? 'blinkLeft' : 'blinkRight'] = eyelidWeight(progress, parameters);
      break;
    case 'smile':
      pose.expressions.smile = parameters.intensity;
      break;
    case 'mouthOpen':
      pose.expressions.mouthOpen = parameters.intensity;
      break;
    case 'headTilt':
    case 'nod': {
      const envelope = smooth(clamp(progress / 0.3)) * smooth(clamp((1 - progress) / 0.3));
      const angle = parameters.angle * envelope;
      if (module.procedure === 'nod') {
        rotate('head', angle * 0.8, 0, 0);
        rotate('neck', angle * 0.2, 0, 0);
      } else {
        rotate('head', 0, 0, angle * 0.8);
        rotate('neck', 0, 0, angle * 0.2);
      }
      break;
    }
    case 'waveLeft':
    case 'waveRight': {
      const side = module.procedure === 'waveLeft' ? 'left' : 'right';
      const sign = side === 'left' ? 1 : -1;
      const lift = smooth(clamp(progress / 0.25)) * smooth(clamp((1 - progress) / 0.25));
      const stage = clamp((progress - 0.25) / 0.5);
      const swing = Math.sin(Math.PI * 2 * parameters.cycles * parameters.frequency * stage)
        * Math.sin(Math.PI * stage) * parameters.amplitude;
      rotate(side + 'UpperArm', -14 * lift, 0, sign * parameters.lift * lift);
      rotate(side + 'LowerArm', -25 * lift, 0, sign * (parameters.bend * lift + swing * 0.4));
      rotate(side + 'Hand', 0, sign * swing * 0.25, sign * swing * 0.6);
      break;
    }
    case 'idle': {
      const breath = (1 - Math.cos(progress * 2 * Math.PI)) * 0.5 * parameters.amount;
      rotate('spine', -breath, 0, 0);
      break;
    }
  }
  return pose;
}

export function sampleModule(module: MotionModule, time: number, parameters: Record<string, number> = {}): Pose {
  if (module.kind === 'procedural') return evaluateProcedure(module, time, parameters);
  const pose = emptyPose();
  for (const channel of module.channels) {
    switch (channel.type) {
      case 'rotation': {
        const value = sampleKeyframes<Quat>(channel.keys, time, slerp);
        if (value) pose.rotations[channel.key] = [...value];
        break;
      }
      case 'translation': {
        const value = sampleKeyframes<Vec3>(channel.keys, time, vecLerp);
        if (value) pose.translations[channel.key] = [...value];
        break;
      }
      case 'expression': {
        const value = sampleKeyframes(channel.keys, time, lerp);
        if (value !== undefined) pose.expressions[channel.key] = value;
        break;
      }
    }
  }
  return pose;
}

export function moduleRequirements(module: MotionModule): ChannelRequirement[] {
  if (module.kind === 'keyframes') return module.channels.filter((channel) => channel.keys.length)
    .map(({ type, key }) => ({ type, key }));
  const pose = evaluateProcedure(module, 0, {});
  return [
    ...Object.keys(pose.rotations).map((key) => ({ type: 'rotation' as const, key })),
    ...Object.keys(pose.translations).map((key) => ({ type: 'translation' as const, key })),
    ...Object.keys(pose.expressions).map((key) => ({ type: 'expression' as const, key })),
  ];
}
