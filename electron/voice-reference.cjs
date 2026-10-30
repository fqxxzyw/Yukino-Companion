const fs=require('node:fs/promises');
const path=require('node:path');

const MAX_REFERENCE_BYTES=8*1024*1024;
const MIN_REFERENCE_SECONDS=3;
const MAX_REFERENCE_SECONDS=10;

function wavMetadata(bytes){
  if(bytes.length<12||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')throw Error('参考音频不是有效的 WAV 文件。');
  const end=bytes.readUInt32LE(4)+8;
  if(end<12||end>bytes.length)throw Error('WAV 文件不完整，请重新选择原始音频。');
  let fmt=null,dataBytes=0,dataChunks=0;
  for(let offset=12;offset<end;){
    if(offset+8>end)throw Error('WAV 文件块头不完整。');
    const kind=bytes.toString('ascii',offset,offset+4),length=bytes.readUInt32LE(offset+4),start=offset+8;
    if(start+length>end)throw Error('WAV 文件块被截断。');
    if(kind==='fmt '){
      if(fmt||length<16)throw Error('WAV 格式信息无效。');
      let encoding=bytes.readUInt16LE(start);
      if(encoding===0xfffe){
        if(length<40||bytes.readUInt16LE(start+16)<22)throw Error('WAV 扩展格式信息不完整。');
        const subtype=bytes.subarray(start+24,start+40);
        if(!subtype.subarray(2).equals(Buffer.from('000000001000800000aa00389b71','hex')))throw Error('当前仅支持 PCM 或浮点 WAV 参考音频。');
        encoding=subtype.readUInt16LE(0);
      }
      const channels=bytes.readUInt16LE(start+2),sampleRate=bytes.readUInt32LE(start+4),byteRate=bytes.readUInt32LE(start+8),blockAlign=bytes.readUInt16LE(start+12),bitsPerSample=bytes.readUInt16LE(start+14);
      if(![1,3].includes(encoding)||!channels||channels>8||sampleRate<8000||sampleRate>384000||!(encoding===1?[8,16,24,32]:[32,64]).includes(bitsPerSample)||blockAlign!==channels*bitsPerSample/8||byteRate!==sampleRate*blockAlign)throw Error('WAV 编码参数不受支持或文件已损坏。');
      fmt={format:'wav',mimeType:'audio/wav',channels,sampleRate,bitsPerSample,byteRate,blockAlign};
    }
    if(kind==='data'){dataChunks++;dataBytes+=length;}
    const next=start+length+(length&1);
    if(next>end)throw Error('WAV 文件块的填充字节不完整。');
    offset=next;
  }
  if(!fmt||dataChunks!==1||!dataBytes||dataBytes%fmt.blockAlign)throw Error('WAV 音频数据不完整。');
  const {byteRate,blockAlign,...metadata}=fmt;
  return {...metadata,durationSeconds:dataBytes/byteRate};
}

function flacMetadata(bytes){
  if(bytes.length<42||bytes.toString('ascii',0,4)!=='fLaC')throw Error('参考音频不是有效的 FLAC 文件。');
  let offset=4,stream=null,last=false,blocks=0;
  while(!last){
    if(offset+4>bytes.length)throw Error('FLAC 元数据不完整。');
    const header=bytes[offset],kind=header&0x7f,length=bytes.readUIntBE(offset+1,3),start=offset+4;
    if(kind===127||start+length>bytes.length)throw Error('FLAC 文件已损坏或被截断。');
    if(blocks===0&&kind!==0)throw Error('FLAC 缺少首个 STREAMINFO 元数据块。');
    if(kind===0){
      if(stream||length!==34)throw Error('FLAC STREAMINFO 信息无效。');
      const packed=bytes.readBigUInt64BE(start+10),sampleRate=Number(packed>>44n),channels=Number((packed>>41n)&7n)+1,bitsPerSample=Number((packed>>36n)&31n)+1,totalSamples=Number(packed&0xfffffffffn);
      if(sampleRate<8000||sampleRate>384000||bitsPerSample<4||bitsPerSample>32||totalSamples<=0)throw Error('FLAC 未提供有效采样率或音频时长。');
      stream={format:'flac',mimeType:'audio/flac',sampleRate,channels,bitsPerSample,durationSeconds:totalSamples/sampleRate};
    }
    offset=start+length;last=Boolean(header&0x80);blocks++;
  }
  if(!stream||bytes.length-offset<2||bytes[offset]!==0xff||(bytes[offset+1]&0xfe)!==0xf8)throw Error('FLAC 音频帧缺失或文件不完整。');
  return stream;
}

function referenceAudioMetadata(bytes){
  if(!Buffer.isBuffer(bytes)||bytes.length>MAX_REFERENCE_BYTES)throw Error('参考音频过大，请选择不超过 8 MiB 的 3–10 秒录音。');
  const signature=bytes.toString('ascii',0,4);
  if(signature==='RIFF')return wavMetadata(bytes);
  if(signature==='fLaC')return flacMetadata(bytes);
  throw Error('仅支持 WAV 或 FLAC 参考音频，请重新选择。');
}

// Only the main process should supply allowedPaths, from saved settings or an
// explicit native file picker. Renderer input must never become this allowlist.
async function inspectReferenceAudio({filename,allowedPaths=[],includeAudio=false}={}){
  if(typeof filename!=='string'||!path.isAbsolute(filename)||filename.includes('\0')||filename.length>4096)throw Error('参考音频路径无效。');
  const resolved=path.resolve(filename);
  if(!Array.isArray(allowedPaths)||!allowedPaths.some(candidate=>typeof candidate==='string'&&path.isAbsolute(candidate)&&path.resolve(candidate)===resolved))throw Error('请先选择并保存参考音频，再检查或播放。');
  let handle;
  try{
    const selected=await fs.lstat(resolved);
    if(selected.isSymbolicLink()||!selected.isFile())throw Error('参考音频必须是本机普通音频文件，不能是链接或目录。');
    if(!selected.size||selected.size>MAX_REFERENCE_BYTES)throw Error('参考音频过大或为空，请选择不超过 8 MiB 的 3–10 秒录音。');
    handle=await fs.open(resolved,'r');
    const opened=await handle.stat();
    if(!opened.isFile()||opened.size!==selected.size||opened.dev!==selected.dev||opened.ino!==selected.ino)throw Error('参考音频在读取期间发生变化，请重新选择。');
    // Read only the bounded size we inspected. A concurrently growing file must
    // not cause an unbounded readFile allocation.
    const bytes=Buffer.alloc(opened.size);let read=0;
    while(read<bytes.length){const result=await handle.read(bytes,read,bytes.length-read,read);if(!result.bytesRead)throw Error('参考音频读取不完整，请重试。');read+=result.bytesRead;}
    const after=await handle.stat();if(after.size!==opened.size||after.mtimeMs!==opened.mtimeMs)throw Error('参考音频在读取期间发生变化，请重试。');
    const metadata=referenceAudioMetadata(bytes),validDuration=metadata.durationSeconds>=MIN_REFERENCE_SECONDS&&metadata.durationSeconds<=MAX_REFERENCE_SECONDS;
    return {...metadata,path:resolved,name:path.basename(resolved),bytes:bytes.length,readable:true,validDuration,usable:validDuration,playbackVerified:false,
      message:validDuration?'文件可读，时长符合 3–10 秒要求；点击播放检查内容。':`参考音频时长为 ${metadata.durationSeconds.toFixed(2)} 秒，请选择 3–10 秒的录音。`,
      ...(includeAudio?{preview:{mimeType:metadata.mimeType,base64:bytes.toString('base64')}}:{})};
  }catch(error){
    if(error.code==='ENOENT')throw Error('参考音频不存在，请重新选择文件。');
    if(['EACCES','EPERM'].includes(error.code))throw Error('无法读取参考音频，请检查文件权限或重新选择。');
    throw error;
  }finally{await handle?.close();}
}

module.exports={inspectReferenceAudio,referenceAudioMetadata,MAX_REFERENCE_BYTES,MIN_REFERENCE_SECONDS,MAX_REFERENCE_SECONDS};
