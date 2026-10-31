import {speechHint} from './motion.mjs';
// Bounded, engine-capability-aware admission. One GPU owner by default.
export const schedulingDefaults = Object.freeze({synthesisMode:'auto',maxConcurrentTasks:2,maxPendingSegments:12,maxPreparedSegments:4,maxBufferedAudioSeconds:20,failurePolicy:'abort'});
export function normalizeScheduling(input={}) {
  const cfg={...schedulingDefaults,...input};
  if(!['auto','serial','concurrent','batch'].includes(cfg.synthesisMode)||!['abort','skip','retry'].includes(cfg.failurePolicy))throw Error('无效语音调度策略');
  for(const [key,min,max] of [['maxConcurrentTasks',1,4],['maxPendingSegments',1,32],['maxPreparedSegments',1,8],['maxBufferedAudioSeconds',1,60]])if(!Number.isFinite(cfg[key])||cfg[key]<min||cfg[key]>max||(key!=='maxBufferedAudioSeconds'&&!Number.isInteger(cfg[key])))throw Error('无效语音队列上限：'+key);
  return cfg;
}
const clock=()=>globalThis.performance?.now?.()??Date.now();
export class OrderedSpeechScheduler {
  constructor({id,bridge,player,settings={},onState=()=>{},onCapacity=()=>{},now=clock}) {
    Object.assign(this,{id,bridge,player,onState,onCapacity,now});this.settings=normalizeScheduling(settings);
    this.tasks=new Map();this.sequence=0;this.nextPlay=0;this.active=0;this.playing=false;this.ended=false;this.closed=false;this.startedAt=now();
    this.capabilities={maxConcurrentTasks:1,nativeBatch:false};this.metrics={queuedPeak:0,preparedPeak:0,bufferedSeconds:0,totalSynthesisMs:0,firstSegmentMs:null,firstSynthesisMs:null,firstPlaybackMs:null,played:0,failed:0};
    this.completion=new Promise(resolve=>this.resolve=resolve);
  }
  setCapabilities(value={}) {this.capabilities={...this.capabilities,...value};}
  get hasCapacity(){return !this.closed&&this.tasks.size<this.settings.maxPendingSegments;}
  submit(text,{language='ja',voiceProfileId='current'}={}) {
    if(!this.hasCapacity||this.ended)return false;
    const sequence=this.sequence++,createdAt=this.now();
    this.tasks.set(sequence,{requestId:this.id,segmentId:this.id+':'+sequence,sequence,text,language,voiceProfileId,status:'queued',createdAt,startedAt:null,firstAudioAt:null,completedAt:null,audioDuration:null,error:null,attempts:0});
    this.metrics.firstSegmentMs??=createdAt-this.startedAt;this.metrics.queuedPeak=Math.max(this.metrics.queuedPeak,this.tasks.size);this.emit('waiting');this.pump();return true;
  }
  finish(){this.ended=true;this.pump();this.checkComplete();}
  snapshot(){return {id:this.id,pending:this.tasks.size,metrics:{...this.metrics},tasks:[...this.tasks.values()].map(({audio,prepared,...task})=>({...task})),capabilities:{...this.capabilities}};}
  emit(phase,extra={}){if(!this.closed){const current=this.tasks.get(this.nextPlay),audible=current?.status==='playing'&&current.playbackStartedAt!==undefined;this.onState({phase:audible?'playing':phase,...this.snapshot(),...(audible?{sentenceIndex:current.sequence,segmentText:current.text}:{}),...extra});}}
  pump(){
    if(this.closed)return;
    const cfg=this.settings;
    const limit=cfg.synthesisMode==='serial'||cfg.synthesisMode==='batch'?1:Math.max(1,Math.min(cfg.maxConcurrentTasks,Number(this.capabilities.maxConcurrentTasks)||1));
    let prepared=[...this.tasks.values()].filter(t=>t.status==='ready').length;
    // In-flight slots count against prepared capacity, including out-of-order results.
    while(this.active<limit&&prepared+this.active<cfg.maxPreparedSegments&&this.metrics.bufferedSeconds<cfg.maxBufferedAudioSeconds){
      const task=[...this.tasks.values()].find(t=>t.status==='queued');if(!task)break;
      this.active++;task.status='synthesizing';task.startedAt=this.now();task.attempts++;this.emit('synthesizing');
      void this.synthesize(task);
    }
    void this.playNext();
  }
  async synthesize(task){
    try{
      const audio=await this.bridge.synthesize(this.id,task.text);
      if(this.closed)return;
      task.firstAudioAt=this.now();task.audio=audio;
      // Decode before the prior sentence finishes; the device/context stays open.
      if(this.player.prepare)task.prepared=await this.player.prepare(audio);
      if(this.closed)return;
      const duration=task.prepared?.duration??0;
      task.audioDuration=Number.isFinite(duration)?duration:0;
      if(this.metrics.bufferedSeconds+task.audioDuration>this.settings.maxBufferedAudioSeconds)throw Error('已达到音频缓冲时长上限，请缩短片段或提高高级缓冲上限。');
      this.metrics.bufferedSeconds+=task.audioDuration;
      this.metrics.totalSynthesisMs+=task.firstAudioAt-task.startedAt;
      this.metrics.firstSynthesisMs??=task.firstAudioAt-this.startedAt;
      task.status='ready';task.completedAt=this.now();
      this.metrics.preparedPeak=Math.max(this.metrics.preparedPeak,[...this.tasks.values()].filter(t=>t.status==='ready').length);
    }catch(error){
      if(this.closed)return;
      task.error=String(error?.message||error);this.metrics.failed++;
      if(this.settings.failurePolicy==='retry'&&task.attempts<2){task.status='queued';}
      else if(this.settings.failurePolicy==='skip'){task.status='failed';}
      else{this.abort(task.error);return;}
    }finally{this.active--;if(!this.closed){this.pump();this.checkComplete();}}
  }
  async playNext(){
    if(this.closed||this.playing)return;
    const task=this.tasks.get(this.nextPlay);if(!task)return;
    if(task.status==='failed'){this.retire(task);this.pump();return;}
    if(task.status!=='ready')return;
    this.playing=true;task.status='playing';this.metrics.bufferedSeconds=Math.max(0,this.metrics.bufferedSeconds-task.audioDuration);
    const onStarted=()=>{if(this.closed)return;task.playbackStartedAt=this.now();this.metrics.firstPlaybackMs??=task.playbackStartedAt-this.startedAt;this.emit('playing',{sentenceIndex:task.sequence,segmentText:task.text});};
    try{
      const options={text:task.text,sequence:task.sequence,requestId:this.id,onStarted,hint:speechHint(task.text)};
      if(!this.player.prepare)onStarted(); // Legacy/testing players do not expose a device-start callback.
      await this.player.play(task.prepared??task.audio,options);
      if(this.closed)return;
      task.status='completed';task.playbackCompletedAt=this.now();this.metrics.played++;this.retire(task);
    }catch(error){if(!this.closed)this.abort(String(error?.message||error));}
    finally{this.playing=false;if(!this.closed){this.onCapacity();this.pump();this.checkComplete();}}
  }
  retire(task){task.audio=null;task.prepared=null;this.tasks.delete(task.sequence);this.nextPlay++;this.onCapacity();}
  checkComplete(){if(!this.closed&&this.ended&&!this.tasks.size&&!this.active&&!this.playing){const result={completed:this.metrics.played>0,id:this.id,synthesized:this.sequence>this.metrics.failed,played:this.metrics.played>0,metrics:{...this.metrics}};if(!result.completed)result.error='没有生成并播放可用的日语语音。';this.emit('idle');this.closed=true;this.resolve(result);}}
  abort(error){if(this.closed)return;this.onState({phase:'error',id:this.id,error,metrics:{...this.metrics}});this.cancel({error});}
  cancel(extra={}){if(this.closed)return;this.closed=true;for(const task of this.tasks.values()){task.status='cancelled';task.audio=null;task.prepared=null;}this.tasks.clear();this.metrics.bufferedSeconds=0;this.player.stop();Promise.resolve().then(()=>this.bridge.stop(this.id)).catch(()=>{});this.resolve({completed:false,id:this.id,cancelled:!extra.error,synthesized:this.metrics.firstSynthesisMs!==null,played:this.metrics.played>0,metrics:{...this.metrics},...extra});}
}
