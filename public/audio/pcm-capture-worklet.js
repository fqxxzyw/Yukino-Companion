import {PcmResampler} from './pcm-resampler.js';
class YukinoPcmCapture extends AudioWorkletProcessor {
 constructor(options){super();this.resampler=new PcmResampler(sampleRate);this.gain=options.processorOptions?.gain??1;this.active=true;this.port.onmessage=({data})=>{if(data.type==='gain')this.gain=Math.max(0,Math.min(2,Number(data.value)||0));if(data.type==='flush'){const pcm=this.resampler.flush();if(pcm)this.port.postMessage({type:'pcm',pcm},[pcm]);this.port.postMessage({type:'flushed',id:data.id});}};}
 process(inputs){if(!this.active)return false;const channels=inputs[0];if(!channels?.length)return true;const mono=new Float32Array(channels[0].length);let square=0;for(let i=0;i<mono.length;i++){for(const channel of channels)mono[i]+=(channel[i]||0)/channels.length;square+=mono[i]*mono[i];}const level=Math.min(1,Math.sqrt(square/Math.max(1,mono.length))*this.gain);for(const pcm of this.resampler.push(mono,this.gain))this.port.postMessage({type:'pcm',pcm,level},[pcm]);return true;}
}
registerProcessor('yukino-pcm-capture',YukinoPcmCapture);
