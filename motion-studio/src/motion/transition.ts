import type { MotionChannel, Pose, Quat, RetargetReference, Vec3, KeyframeModule } from './types.ts';

// Only edited channels enter the clip, leaving the rest of the timeline free.
export function createPoseTransition(start: Pose, end: Pose, duration: number, defaults: Record<string, number>, modelId: string, restDirections?: RetargetReference): KeyframeModule | null {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const channels: MotionChannel[] = [];
  const changed = (a: number[], b: number[]) => a.some((v, i) => Math.abs(v - b[i]) > 1e-5);
  const keys = (a: Record<string, unknown>, b: Record<string, unknown>) => new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys(start.rotations, end.rotations)) {
    const from: Quat = start.rotations[key] ?? [0,0,0,1], to: Quat = end.rotations[key] ?? [0,0,0,1];
    // Quaternions q and -q represent the same orientation.
    const fromLength=Math.hypot(...from),toLength=Math.hypot(...to);
    const same=fromLength>0&&toLength>0&&Math.abs(from.reduce((sum,v,i)=>sum+v*to[i],0)/(fromLength*toLength))>1-1e-6;
    if (!same && changed(from, to)) channels.push({type:'rotation', key, keys:[{time:0,value:[...from],interpolation:'smooth'},{time:duration,value:[...to],interpolation:'smooth'}]});
  }
  for (const key of keys(start.translations, end.translations)) {
    const from: Vec3 = start.translations[key] ?? [0,0,0], to: Vec3 = end.translations[key] ?? [0,0,0];
    if (changed(from, to)) channels.push({type:'translation', key, keys:[{time:0,value:[...from],interpolation:'smooth'},{time:duration,value:[...to],interpolation:'smooth'}]});
  }
  for (const key of keys(start.expressions, end.expressions)) {
    const from = start.expressions[key] ?? defaults[key] ?? 0, to = end.expressions[key] ?? defaults[key] ?? 0;
    if (Math.abs(from - to) > 1e-5) channels.push({type:'expression', key, keys:[{time:0,value:from,interpolation:'smooth'},{time:duration,value:to,interpolation:'smooth'}]});
  }
  if (!channels.length) return null;
  return {id:crypto.randomUUID(),name:'姿势过渡',kind:'keyframes',version:1,region:'all',duration,channels,
    ...(channels.some(channel=>channel.key.startsWith('native:')) ? {modelId} : {restDirections})};
}
