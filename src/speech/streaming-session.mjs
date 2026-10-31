import {spokenText} from './text.mjs';
import {SmartSentenceStream} from './segmenter.mjs';
import {OrderedSpeechScheduler} from './scheduler.mjs';
const kana=text=>/[ぁ-ゖァ-ヺｦ-ﾝ]/u.test(text);
// Demand-driven segmentation: up to 16k text in the input inbox, never an
// unbounded array of already-admitted TTS jobs. Providers keep displaying text.
export class StreamingSpeechSession {
  constructor({bridge,player,onState=()=>{},japaneseOnly=false,settings=()=>({})}){Object.assign(this,{bridge,player,onState,japaneseOnly,settings});this.current=null;}
  start(id){
    this.cancel();const config=typeof this.settings==='function'?this.settings():this.settings;
    const job={id,raw:'',spokenCursor:0,inbox:'',final:false,flushed:false,feeding:false,held:'',out:[],count:0,stream:new SmartSentenceStream(config)};
    const scheduler=new OrderedSpeechScheduler({id,bridge:this.bridge,player:this.player,settings:config,onState:state=>{if(this.current===job)this.onState(state);},onCapacity:()=>queueMicrotask(()=>this.feed(job))});
    job.scheduler=scheduler;job.completion=scheduler.completion;this.current=job;
    job.ready=Promise.resolve().then(()=>this.current===job?this.bridge.begin(id):null).then(()=>this.current===job?this.bridge.prewarm?.(id):null).then(status=>{if(this.current!==job)return;job.loaded=true;scheduler.setCapabilities(status?.metadata?.capabilities);this.feed(job);}).catch(error=>{if(this.current===job)scheduler.abort(error.message);});
    void job.completion.then(()=>{if(this.current===job)this.current=null;});this.onState({phase:'waiting',id});
  }
  push(text){const job=this.current;if(!job||job.final)return;try{if(typeof text!=='string')throw Error('无效语音文本');job.raw+=text;if(job.raw.length>16000)throw Error('语音文本超过 16000 字符，已停止朗读；文字不受影响。');this.capture(job);this.feed(job);}catch(e){job.scheduler.abort(e.message);}}
  capture(job){const clean=spokenText(job.raw,job.final);if(clean.length<job.spokenCursor)throw Error('语音文本前缀发生变化，已停止旧片段。');job.inbox+=clean.slice(job.spokenCursor);job.spokenCursor=clean.length;}
  finish(){const job=this.current;if(!job||job.final)return;job.final=true;try{this.capture(job);this.feed(job);}catch(e){job.scheduler.abort(e.message);}}
  feed(job){
    if(this.current!==job||!job.loaded||job.feeding||job.scheduler.closed)return;job.feeding=true;
    try{
      while(job.scheduler.hasCapacity){
        if(job.out.length){const text=job.out.shift().trim();if(!/[\p{L}\p{N}]/u.test(text))continue;
          if(this.japaneseOnly&&!kana(text)){job.held+=text;if(job.held.length>500)throw Error('连续无假名文字过长，已停止朗读；文字仍保留。');continue;}
          const segment=job.held+text;job.held='';if(segment.length>500)throw Error('日语片段超过推理上限');job.scheduler.submit(segment,{language:this.japaneseOnly?'ja':'auto'});continue;
        }
        if(job.inbox){const point=job.inbox.codePointAt(0),size=point>0xffff?2:1;const delta=job.inbox.slice(0,size);job.inbox=job.inbox.slice(size);job.out.push(...job.stream.push(delta));continue;}
        if(job.final&&!job.flushed){job.flushed=true;job.out.push(...job.stream.push('',true));continue;}
        if(job.final&&job.flushed){if(job.held)throw Error('译文末尾包含无法独立朗读的无假名片段；未朗读中文。');job.scheduler.finish();}
        break;
      }
    }catch(e){job.scheduler.abort(e.message);}finally{job.feeding=false;}
  }
  cancel(){const job=this.current;this.current=null;if(job){job.inbox='';job.out.length=0;job.raw='';job.stream=null;job.scheduler.cancel();}else this.player.stop();this.onState({phase:'idle'});}
}
