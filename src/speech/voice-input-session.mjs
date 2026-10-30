import {MicrophoneCapture} from './microphone-capture.mjs';
export const VOICE_INPUT_DEFAULTS=Object.freeze({mode:'click',deviceId:'',gain:1,echoCancellation:true,noiseSuppression:true,autoSubmit:true,language:'zh',interruptOnSpeech:true,silenceDurationMs:400});
export class VoiceInputSession {
 constructor({api,createCapture=options=>new MicrophoneCapture(options),onStatus=()=>{},onPartial=()=>{},onFinal=()=>{},onSubmit=()=>{},onInterrupt=()=>{}}={}){Object.assign(this,{api,createCapture,onStatus,onPartial,onFinal,onSubmit,onInterrupt});this.epoch=0;this.state={phase:'idle',level:0,partial:'',final:'',muted:false};this.off=api?.onAsrStatus?.(event=>this.event(event));this.offRevoked=api?.onMicrophoneRevoked?.(()=>void this.cancel());this.sequence=Promise.resolve();this.pending=0;this.submitted=new Set();}
 emit(patch){this.state={...this.state,...patch};this.onStatus({...this.state});}
 async start(settings={}){if(this.state.phase==='connecting'||this.id)throw Error('语音输入已开启。');this.settings={...VOICE_INPUT_DEFAULTS,...settings};this.submitted.clear();const epoch=++this.epoch;this.emit({phase:'connecting',error:'',partial:'',final:'',level:0,muted:false});
  try{const grant=await this.api.asrStart({consent:true,mode:this.settings.mode,locale:this.settings.language,silenceDurationMs:this.settings.silenceDurationMs});if(epoch!==this.epoch){await this.api.asrStop({sessionId:grant.sessionId});return;}this.id=grant.sessionId;
   this.capture=this.createCapture({onFrame:pcm=>this.append(pcm,epoch),onLevel:level=>this.emit({level}),onEnded:error=>this.cancel(error)});
   await this.capture.start({consent:true,...this.settings});if(epoch!==this.epoch)return;this.emit({phase:'listening',permission:'granted'});
  }catch(error){if(epoch===this.epoch){await this.cancel(error.message||'语音输入未能启动。');}throw error;}
 }
 append(pcm,epoch){if(epoch!==this.epoch||!this.id||this.state.muted)return;if(++this.pending>10){this.pending--;void this.cancel('音频上传速度不足，已停止监听，请检查网络。');return;}const sessionId=this.id;this.sequence=this.sequence.then(async()=>{if(epoch===this.epoch&&this.id===sessionId)await this.api.asrAudio({sessionId,pcm});}).catch(error=>{if(epoch===this.epoch)void this.cancel(error.message||'音频发送失败。');}).finally(()=>{this.pending--;});}
 event(event){if(!this.id||event.sessionId!==this.id)return;if(event.type==='partial'){this.emit({partial:event.text});this.onPartial(event.text,event);}
  if(event.type==='final'){const key=event.itemId||event.text;if(this.submitted.has(key))return;this.submitted.add(key);if(this.submitted.size>256)this.submitted.delete(this.submitted.values().next().value);this.emit({partial:'',final:event.text,transcriptionVerified:true});this.onFinal(event.text,event);if(this.settings.autoSubmit)Promise.resolve(this.onSubmit(event.text,event)).catch(error=>this.emit({error:error.message||'识别成功，聊天发送失败。'}));}
  if(event.type==='speech-started'&&this.settings.mode==='continuous'&&this.settings.interruptOnSpeech)this.onInterrupt(event);
  if(event.type==='error')void this.cancel(event.error||'语音识别连接失败。');
  if(event.type==='finished'||event.type==='closed'){this.capture?.stop();this.capture=null;this.id=null;this.emit({phase:'idle',level:0});}
 }
 async finish(){const sessionId=this.id;if(!sessionId){await this.cancel();return;}this.emit({phase:'finishing'});await this.capture?.flush();this.capture?.stop();this.capture=null;await this.sequence;try{await this.api.asrFinish({sessionId});}catch(error){if(this.id===sessionId)await this.cancel(error.message);} }
 setMuted(value){this.capture?.setMuted(value);this.emit({muted:value===true,level:0});}
 async cancel(error=''){const sessionId=this.id;this.id=null;this.epoch++;this.capture?.stop();this.capture=null;this.emit({phase:error?'error':'idle',error,level:0,partial:'',muted:false});if(sessionId)try{await this.api.asrStop({sessionId})}catch{}}
 dispose(){this.off?.();this.offRevoked?.();return this.cancel();}
}
