import {clamp, emptyPose, eulerDegreesToQuat, multiplyQuaternion} from './motion/math.ts';
import type {KeyframeModule, MotionChannel, Pose, Quat, RetargetReference, Vec3} from './motion/types.ts';
import {limitJointQuaternion} from './joint-limits.ts';

/** Temporary preview pose. It never writes animation data or manual controls. */
export function samplePartPreview(input: {
  kind: 'bone' | 'expression'; id: string; elapsed: number; period: number;
  amplitude: number; axis: 0 | 1 | 2; rotation?: Quat; weight?: number; limitsEnabled?:boolean;
}): Pose {
  const pose=emptyPose(),phase=2*Math.PI*Math.max(0,input.elapsed)/Math.max(.2,input.period);
  if(input.kind==='bone'){
    const delta:Vec3=[0,0,0];delta[input.axis]=Math.sin(phase)*input.amplitude;
    const base=input.rotation??[0,0,0,1];const value=multiplyQuaternion(base,eulerDegreesToQuat(delta));
    pose.rotations[input.id]=input.limitsEnabled?limitJointQuaternion(input.id,value,base):value;
  }else {
    const baseline=clamp(input.weight??0),direction=baseline>=.5?-1:1;
    pose.expressions[input.id]=clamp(baseline+direction*(1-Math.cos(phase))*.5*input.amplitude);
  }
  return pose;
}

export function createPartPreviewModule(input: {
  kind:'bone'|'expression';id:string;label:string;period:number;amplitude:number;axis:0|1|2;
  rotation?:Quat;weight?:number;modelId:string;restDirections?:RetargetReference;limitsEnabled?:boolean;
}):KeyframeModule|null {
  if(!Number.isFinite(input.period)||input.period<.2||input.period>10||!Number.isFinite(input.amplitude)||input.amplitude<=0)return null;
  const count=Math.max(12,Math.ceil(input.period*30)),samples=Array.from({length:count+1},(_,i)=>{
    const time=input.period*i/count,pose=samplePartPreview({...input,elapsed:time});return {time,pose};
  });
  const channel:MotionChannel=input.kind==='bone'
    ? {type:'rotation',key:input.id,keys:samples.map(({time,pose})=>({time,value:pose.rotations[input.id],interpolation:'linear'}))}
    : {type:'expression',key:input.id,keys:samples.map(({time,pose})=>({time,value:pose.expressions[input.id],interpolation:'linear'}))};
  if(input.kind==='expression'&&samples.every(({pose})=>Math.abs(pose.expressions[input.id]-(input.weight??0))<1e-6))return null;
  return {id:crypto.randomUUID(),name:`${input.label} · 循环动作`,kind:'keyframes',version:1,region:'all',duration:input.period,channels:[channel],
    ...(input.id.startsWith('native:')?{modelId:input.modelId}:input.restDirections?{restDirections:input.restDirections}:{})};
}
