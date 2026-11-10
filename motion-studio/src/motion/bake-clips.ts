import {clipDuration,createClip,createTrack,evaluateProject,getModule} from './timeline.ts';
import type {KeyframeModule,MotionChannel,Pose,Project,RetargetReference} from './types.ts';

/** Bake selected clips as one reusable model-specific module at project FPS. */
export function bakeClips(project:Project,ids:string[],target?:RetargetReference):{project:Project;clipId:string}{
 const wanted=new Set(ids),picked=project.tracks.flatMap(track=>track.clips.filter(clip=>wanted.has(clip.id)).map(clip=>({track,clip})));
 if(picked.length<2)throw Error('请至少选择两个片段');
 if(picked.some(({track})=>track.locked||track.muted))throw Error('请先解锁并取消静音所选轨道');
 if(project.tracks.some(track=>track.solo&&!track.muted))throw Error('请先关闭轨道独奏，再合并片段');
 if(picked.some(({clip})=>!getModule(project,clip.moduleId)))throw Error('所选片段存在缺失的动作模块');
 const start=Math.min(...picked.map(({clip})=>clip.start)),begin=start/project.fps;
 const end=Math.max(...picked.map(({clip})=>clip.start/project.fps+clipDuration(clip))),duration=end-begin;
 if(duration<=0||duration>300)throw Error('合并时长须在 0 到 300 秒之间');
 if(project.tracks.some(track=>track.clips.some(clip=>!wanted.has(clip.id)&&clip.start/project.fps<end-1e-7&&clip.start/project.fps+clipDuration(clip)>begin+1e-7)))throw Error('时间范围内还有其他片段，请一并选中后合并');
 const filtered:Project={...project,tracks:project.tracks.map(track=>({...track,solo:false,clips:track.clips.filter(clip=>wanted.has(clip.id))}))};
 const count=Math.ceil(duration*project.fps),samples:{time:number;pose:Pose}[]=[];
 for(let i=0;i<=count;i++){const time=Math.min(duration,i/project.fps);samples.push({time,pose:evaluateProject(filtered,begin+Math.min(time,Math.max(0,duration-1e-6)),target)});}
 const channels:MotionChannel[]=[];
 for(const [property,type,fallback] of [['rotations','rotation',[0,0,0,1]],['translations','translation',[0,0,0]],['expressions','expression',0]] as const){
  const keys=new Set(samples.flatMap(({pose})=>Object.keys(pose[property])));
  for(const key of keys)channels.push({type,key,keys:samples.map(({time,pose})=>({time,value:pose[property][key]??fallback}))} as MotionChannel);
 }
 if(!channels.length)throw Error('所选片段没有可合并的有效通道');
 const module:KeyframeModule={id:crypto.randomUUID(),name:'合并动作',kind:'keyframes',duration,region:'all',modelId:project.modelId,channels};
 const clip=createClip(module,start);let destination=project.tracks.find(t=>!t.locked&&!t.muted&&!t.solo&&t.region==='all');
 if(!destination)destination=createTrack('合并动作','all');
 const destinationId=destination.id,tracks=project.tracks.map(track=>({...track,clips:track.clips.filter(item=>!wanted.has(item.id))}));
 if(!tracks.some(t=>t.id===destinationId))tracks.push(destination);
 return {project:{...project,modules:[...project.modules,module],tracks:tracks.map(track=>track.id===destinationId?{...track,clips:[...track.clips,clip]}:track)},clipId:clip.id};
}
