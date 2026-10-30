// Streaming box-filter resampler. PCM output is mono signed 16-bit little endian.
export class PcmResampler {
 constructor(inputRate,targetRate=16000,frameSamples=1600){if(!Number.isFinite(inputRate)||inputRate<8000||inputRate>192000)throw Error('Unsupported sample rate');this.ratio=inputRate/targetRate;this.frameSamples=frameSamples;this.reset();}
 reset(){this.weight=0;this.sum=0;this.frame=[];}
 push(input,gain=1){const frames=[];for(let index=0;index<input.length;index++){const value=Math.max(-1,Math.min(1,(Number(input[index])||0)*gain));let remaining=1;while(remaining>1e-9){const used=Math.min(remaining,this.ratio-this.weight);this.sum+=value*used;this.weight+=used;remaining-=used;if(this.weight+1e-9>=this.ratio){const mean=Math.max(-1,Math.min(1,this.sum/this.ratio));this.frame.push(mean<0?Math.round(mean*32768):Math.round(mean*32767));this.sum=0;this.weight=0;if(this.frame.length===this.frameSamples)frames.push(this.take());}}}return frames;}
 take(){const buffer=new ArrayBuffer(this.frame.length*2),view=new DataView(buffer);this.frame.forEach((sample,index)=>view.setInt16(index*2,sample,true));this.frame=[];return buffer;}
 flush(){return this.frame.length?this.take():null;}
}
