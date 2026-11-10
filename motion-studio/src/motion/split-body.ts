import {newId} from './math.ts';
import {sampleModule} from './modules.ts';
import {channelAllowed,clipDuration,clipSourceTime,fullClipDuration} from './timeline.ts';
import type {Clip, Fps, KeyframeModule, MotionChannel, MotionModule, Region} from './types.ts';

export interface SplitBodyPart { key: string; label: string; module: KeyframeModule; clip: Clip }

/** Split only channels that change relative to this clip's first visible frame.
 * Existing keyframe tracks retain their source timing, interpolation, clip
 * trim, speed and blends; the original module and clip are never mutated. */
export function splitBodyClip(module: MotionModule, clip: Clip, fps: Fps, trackRegion: Region = 'all'): SplitBodyPart[] {
 const duration=clipDuration(clip);
 if(!Number.isFinite(duration)||duration<=0) return [];
 // Reject pathological inputs rather than silently sampling an incomplete clip.
 const count=Math.max(1,Math.ceil(duration*fps*4));
 if(count>240000) throw new Error('片段过长，请先截取较短的片段再按部位分解。');
 const times=new Set(Array.from({length:count+1},(_,i)=>duration*i/count));
 if(module.kind==='keyframes'){
  if(clip.loops>240000)throw new Error('循环次数过多，请先缩短片段再分解。');
  const from=clip.window?.from??0,to=clip.window?.to??1,span=clip.sourceOut-clip.sourceIn;
  if(span>0) for(const channel of module.channels) for(const key of channel.keys){
   const phase=(key.time-clip.sourceIn)/span;if(phase<0||phase>1)continue;
   for(let cycle=0;cycle<clip.loops;cycle++){
    const progress=(cycle+phase)/clip.loops;if(progress<from||progress>to)continue;
    const local=(progress-from)*fullClipDuration(clip);times.add(Math.max(0,Math.min(duration,local)));
    if(times.size>240000)throw new Error('关键帧过多，请先缩短片段再分解。');
   }
  }
 }
 const start=clipSourceTime(clip,0);if(start===undefined)throw new Error('片段时间无效，无法分解。');
 const first=sampleModule(module,start,clip.parameters),keys=[
  ...Object.keys(first.rotations).map(key=>({type:'rotation' as const,key})),
  ...Object.keys(first.translations).map(key=>({type:'translation' as const,key})),
  ...Object.keys(first.expressions).map(key=>({type:'expression' as const,key})),
 ].filter(channel=>channelAllowed(trackRegion,channel));
 const changedIds=new Set<string>();
 // Do not retain full poses for every frame: long motion files can contain
 // hundreds of channels. The first pose is the comparison reference only.
 for(const local of [...times].sort((a,b)=>a-b)){
  const source=clipSourceTime(clip,local);if(source===undefined)throw new Error('片段时间无效，无法分解。');
  const pose=sampleModule(module,source,clip.parameters);
  for(const {type,key} of keys){
   const id=type+':'+key;if(changedIds.has(id))continue;
   if(type==='rotation'){
    const a=first.rotations[key],b=pose.rotations[key];
    if(b&&1-Math.min(1,Math.abs(a.reduce((sum,v,i)=>sum+v*b[i],0)))>1e-9)changedIds.add(id);
   }else if(type==='translation'){
    const a=first.translations[key],b=pose.translations[key];if(b&&Math.hypot(...a.map((v,i)=>v-b[i]))>1e-5)changedIds.add(id);
   }else if(pose.expressions[key]!==undefined&&Math.abs(pose.expressions[key]-first.expressions[key])>1e-5)changedIds.add(id);
  }
  if(changedIds.size===keys.length)break;
 }
 const changed=keys.filter(({type,key})=>changedIds.has(type+':'+key));
 const groups=new Map<string,MotionChannel[]>();
 const bakedCount=Math.max(1,Math.ceil(module.duration*fps*4));
 if(module.kind==='procedural'&&bakedCount>240000)throw new Error('动作过长，请先缩短片段再分解。');
 const baked=module.kind==='procedural'?Array.from({length:bakedCount+1},(_,i)=>{
  const time=module.duration*i/bakedCount;return {time,pose:sampleModule(module,time,clip.parameters)};
 }):[];
 for(const {type,key} of changed){
  let channel: MotionChannel | undefined;
  if(module.kind==='keyframes') channel=module.channels.find(item=>item.type===type&&item.key===key);
  else if(type==='rotation')channel={type,key,keys:baked.map(({time,pose})=>({time,value:pose.rotations[key]}))};
  else if(type==='translation')channel={type,key,keys:baked.map(({time,pose})=>({time,value:pose.translations[key]}))};
  else channel={type,key,keys:baked.map(({time,pose})=>({time,value:pose.expressions[key]}))};
  if(!channel)continue;
  const id=(type==='expression'?'expression:':'bone:')+key,list=groups.get(id)||[];list.push(structuredClone(channel));groups.set(id,list);
 }
 return [...groups.entries()].map(([id,channels])=>{
  const key=id.slice(id.indexOf(':')+1),part:KeyframeModule={id:newId(),name:`${module.name} · ${key}`,kind:'keyframes',duration:module.duration,region:'all',channels,
   ...(module.modelId?{modelId:module.modelId}:{}),...(module.kind==='keyframes'&&module.restDirections?{restDirections:module.restDirections}:{})};
  const next={...structuredClone(clip),id:newId(),moduleId:part.id};
  return {key,label:key,module:part,clip:next};
 });
}
