export type Quat = [number, number, number, number];
export type Vec3 = [number, number, number];
export type Fps = 24 | 30 | 60;
export type Interpolation = 'linear' | 'smooth' | 'hold';
export type BlendMode = 'override' | 'additive' | 'priority';
/** Rest-pose major limb directions in the model's reference coordinate system. */
export type RetargetReference = Partial<Record<'leftUpperArm' | 'rightUpperArm' | 'leftUpperLeg' | 'rightUpperLeg', Vec3>>;

export interface Pose {
  rotations: Record<string, Quat>;
  translations: Record<string, Vec3>;
  expressions: Record<string, number>;
}

export const regionLabels = {
  all: '全通道',
  root: '根节点',
  body: '身体',
  lowerBody: '下半身',
  upperBody: '上半身',
  leftArm: '左臂',
  rightArm: '右臂',
  head: '头颈',
  eyes: '眼部',
  brows: '眉部',
  mouth: '口型',
  face: '面部表情',
  lookAt: '视线',
  physics: '物理',
  audio: '音频',
} as const;

export type Region = keyof typeof regionLabels;

export interface Keyframe<T> {
  time: number;
  value: T;
  interpolation?: Interpolation;
}

export type MotionChannel =
  | { type: 'rotation'; key: string; keys: Keyframe<Quat>[] }
  | { type: 'translation'; key: string; keys: Keyframe<Vec3>[] }
  | { type: 'expression'; key: string; keys: Keyframe<number>[] };

export type ChannelType = MotionChannel['type'];
export type ChannelRequirement = Pick<MotionChannel, 'type' | 'key'>;

export interface MotionParameter {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  unit?: string;
}

export type Procedure = 'idle' | 'blink' | 'closed' | 'winkLeft' | 'winkRight' | 'smile'
  | 'headTilt' | 'nod' | 'waveLeft' | 'waveRight' | 'mouthOpen';

interface ModuleBase {
  id: string;
  name: string;
  duration: number;
  region: Region;
  version?: 1;
  description?: string;
  modelId?: string;
}

export interface KeyframeModule extends ModuleBase {
  kind: 'keyframes';
  channels: MotionChannel[];
  exclusiveGroup?: 'kimono-v4-skirt';
  restDirections?: RetargetReference;
}

export interface ProceduralModule extends ModuleBase {
  kind: 'procedural';
  procedure: Procedure;
  parameters: MotionParameter[];
}

export type MotionModule = KeyframeModule | ProceduralModule;

export interface Clip {
  id: string;
  moduleId: string;
  start: number;
  sourceIn: number;
  sourceOut: number;
  speed: number;
  loops: number;
  stretch: number | null;
  blendIn: number;
  blendOut: number;
  weight: number;
  mode: BlendMode;
  priority?: number;
  parameters: Record<string, number>;
  window?: { from: number; to: number };
}

export interface Track {
  id: string;
  name: string;
  region: Region;
  muted: boolean;
  solo: boolean;
  locked: boolean;
  clips: Clip[];
}

export interface AssetReference {
  name: string;
  path?: string;
  sha256?: string;
}

export interface ModelMapping {
  bones?: Record<string, string>;
  expressions?: Record<string, string>;
}

export interface Project {
  version: 1;
  id: string;
  name: string;
  modelId: string;
  fps: Fps;
  tracks: Track[];
  modules: MotionModule[];
  playhead?: number;
  asset?: AssetReference;
  mappings?: Record<string, ModelMapping>;
}
