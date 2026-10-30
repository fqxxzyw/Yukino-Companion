const stopTracks=stream=>{for(const track of stream?.getTracks?.()||[])try{track.stop()}catch{}};
export class MicrophoneCapture {
 constructor({mediaDevices=globalThis.navigator?.mediaDevices,AudioContext=globalThis.AudioContext,AudioWorkletNode=globalThis.AudioWorkletNode,workletUrl=new URL('audio/pcm-capture-worklet.js',globalThis.document?.baseURI||'file:///'),onFrame=()=>{},onLevel=()=>{},onEnded=()=>{}}={}){Object.assign(this,{mediaDevices,AudioContext,AudioWorkletNode,workletUrl,onFrame,onLevel,onEnded});this.epoch=0;this.flushes=new Map();this.sequence=0;}
 async start({consent,deviceId='',gain=1,echoCancellation=true,noiseSuppression=true}={}){
  if(consent!==true)throw Error('请先允许本次使用麦克风。');if(this.stream||this.starting)throw Error('麦克风已开启。');
  if(!this.mediaDevices?.getUserMedia||!this.AudioContext||!this.AudioWorkletNode)throw Error('当前环境不支持实时麦克风输入。');
  const epoch=++this.epoch;this.starting=true;
  try{const stream=await this.mediaDevices.getUserMedia({video:false,audio:{channelCount:1,echoCancellation:!!echoCancellation,noiseSuppression:!!noiseSuppression,autoGainControl:false,...(deviceId?{deviceId:{exact:deviceId}}:{})}});if(epoch!==this.epoch){stopTracks(stream);throw Error('麦克风启动已取消。');}this.stream=stream;
   const tracks=stream.getTracks();if(!tracks.length||tracks.some(track=>track.kind!=='audio'))throw Error('麦克风未提供有效音频轨。');
   this.ended=()=>{if(epoch===this.epoch){this.stop();this.onEnded('麦克风已断开，请重新选择设备。');}};tracks.forEach(track=>track.addEventListener?.('ended',this.ended));
   const context=new this.AudioContext();this.context=context;await context.audioWorklet.addModule(this.workletUrl);if(epoch!==this.epoch)throw Error('麦克风启动已取消。');
   this.source=context.createMediaStreamSource(stream);this.node=new this.AudioWorkletNode(context,'yukino-pcm-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],processorOptions:{gain}});this.mute=context.createGain();this.mute.gain.value=0;
   this.node.port.onmessage=({data})=>{if(epoch!==this.epoch)return;if(data.type==='flushed'){this.flushes.get(data.id)?.();this.flushes.delete(data.id);return;}if(data.type==='pcm'){this.onLevel(data.level||0);if(!this.muted)this.onFrame(data.pcm);}};
   this.source.connect(this.node);this.node.connect(this.mute);this.mute.connect(context.destination);await context.resume();if(epoch!==this.epoch)throw Error('麦克风启动已取消。');return {sampleRate:16000,sourceSampleRate:context.sampleRate,channels:1,audioFormat:'pcm'};
  }catch(error){if(epoch===this.epoch)this.stop();if(error?.name==='NotAllowedError')throw Error('麦克风权限未获允许，请检查 Windows 隐私设置。');if(error?.name==='NotFoundError')throw Error('未找到所选麦克风。');if(error?.name==='NotReadableError')throw Error('麦克风被占用或无法读取。');throw error;}finally{if(epoch===this.epoch)this.starting=false;}
 }
 flush(){if(!this.node)return Promise.resolve();return new Promise(resolve=>{const id=++this.sequence;let timer=setTimeout(()=>{this.flushes.delete(id);resolve();},1000);this.flushes.set(id,()=>{clearTimeout(timer);resolve();});this.node.port.postMessage({type:'flush',id});});}
 setMuted(value){this.muted=value===true;for(const track of this.stream?.getAudioTracks?.()||[])track.enabled=!this.muted;this.onLevel(0);}
 stop(){this.epoch++;this.starting=false;for(const track of this.stream?.getTracks?.()||[])track.removeEventListener?.('ended',this.ended);stopTracks(this.stream);this.stream=null;for(const name of ['source','node','mute']){try{this[name]?.disconnect()}catch{}this[name]=null;}const context=this.context;this.context=null;context?.close?.().catch(()=>{});for(const resolve of this.flushes.values())resolve();this.flushes.clear();this.onLevel(0);}
}
export async function microphoneDevices(mediaDevices=globalThis.navigator?.mediaDevices){if(!mediaDevices?.enumerateDevices)return [];return(await mediaDevices.enumerateDevices()).filter(device=>device.kind==='audioinput').map((device,index)=>({id:device.deviceId,label:device.label||`麦克风 ${index+1}`}));}
