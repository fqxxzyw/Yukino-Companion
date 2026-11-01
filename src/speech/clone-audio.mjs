// Existing microphone worklet yields mono little-endian 16-bit PCM at 16 kHz.
// Store only the real samples that were captured; never synthesize missing audio.
export function encodeCloneWav(frames){
 const limit=16000*2*60;
 if(!Array.isArray(frames))throw Error('录音数据无效。');
 const parts=frames.map(value=>value instanceof ArrayBuffer?new Uint8Array(value):value instanceof Uint8Array?value:null);
 if(parts.some(value=>!value||value.byteLength%2))throw Error('录音数据无效。');
 const length=Math.min(limit,parts.reduce((n,part)=>n+part.byteLength,0));
 if(length<16000*2*5)throw Error('录音至少需要 5 秒，请重新录制。');
 const bytes=new Uint8Array(44+length),view=new DataView(bytes.buffer);
 const ascii=(offset,text)=>{for(let i=0;i<text.length;i++)bytes[offset+i]=text.charCodeAt(i)};
 ascii(0,'RIFF');view.setUint32(4,36+length,true);ascii(8,'WAVE');ascii(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);ascii(36,'data');view.setUint32(40,length,true);
 let offset=44;for(const part of parts){const count=Math.min(part.length,bytes.length-offset);bytes.set(part.subarray(0,count),offset);offset+=count;if(offset===bytes.length)break;}
 return bytes;
}
