'use strict';

const {execFile}=require('node:child_process');
const path=require('node:path');
const {promisify}=require('node:util');

const run=promisify(execFile);
const SAMPLE_RATE=24000;
const MAX_AUDIO=7*1024*1024;
const MAX_MEDIA=512*1024*1024;
const FORMATS=new Map([
  ['wav','wav'], ['mp3','mp3'], ['m4a','mov'], ['aac','aac'], ['flac','flac'],
  ['ogg','ogg'], ['opus','ogg'], ['mp4','mov'], ['m4v','mov'], ['mov','mov'],
  ['mkv','matroska'], ['webm','matroska'], ['avi','avi'],
]);
const MEDIA_EXTENSIONS=[...FORMATS.keys()];

function pcmWave(samples, sampleRate, channels) {
  const blockAlign=channels*2;
  const byteRate=sampleRate*blockAlign;
  if(!samples.length||samples.length%blockAlign)throw Error('音轨不完整或没有可用音频。');
  const seconds=samples.length/byteRate;
  if(seconds<5||seconds>60)throw Error('录音应包含至少 5 秒人声，且总时长不超过 60 秒。');
  const header=Buffer.alloc(44);
  header.write('RIFF',0);
  header.writeUInt32LE(36+samples.length,4);
  header.write('WAVEfmt ',8);
  header.writeUInt32LE(16,16);
  header.writeUInt16LE(1,20);
  header.writeUInt16LE(channels,22);
  header.writeUInt32LE(sampleRate,24);
  header.writeUInt32LE(byteRate,28);
  header.writeUInt16LE(blockAlign,32);
  header.writeUInt16LE(16,34);
  header.write('data',36);
  header.writeUInt32LE(samples.length,40);
  return Buffer.concat([header,samples]);
}

function cleanPcmWave(data) {
  if(data.length<44||data.toString('ascii',0,4)!=='RIFF'||data.toString('ascii',8,12)!=='WAVE')return null;
  const end=data.readUInt32LE(4)+8;
  if(end<44||end>data.length)return null;
  let format, samples;
  for(let offset=12;offset+8<=end;){
    const kind=data.toString('ascii',offset,offset+4);
    const length=data.readUInt32LE(offset+4);
    const start=offset+8, next=start+length+(length%2);
    if(next>end)return null;
    if(kind==='fmt '){
      if(format||length<16||data.readUInt16LE(start)!==1||data.readUInt16LE(start+14)!==16)return null;
      const channels=data.readUInt16LE(start+2), sampleRate=data.readUInt32LE(start+4);
      if(![1,2].includes(channels)||sampleRate<16000||sampleRate>384000||data.readUInt32LE(start+8)!==sampleRate*channels*2||data.readUInt16LE(start+12)!==channels*2)return null;
      format={channels,sampleRate};
    }
    if(kind==='data'){
      if(samples)return null;
      samples=data.subarray(start,start+length);
    }
    offset=next;
  }
  return format&&samples?pcmWave(samples,format.sampleRate,format.channels):null;
}

async function extractVoiceTrack(file, {ffmpeg='',signal}={}) {
  const format=FORMATS.get(path.extname(file).slice(1).toLowerCase());
  if(!format)throw Error('请选择支持的录音或视频格式。');
  const args=[
    '-hide_banner','-loglevel','error','-nostdin','-xerror','-protocol_whitelist','file,pipe',
    '-f',format,'-i',`file:${file}`,'-map','0:a:0','-vn','-sn','-dn','-map_metadata','-1',
    '-t','60.1','-ac','1','-ar',String(SAMPLE_RATE),'-c:a','pcm_s16le','-f','s16le','pipe:1',
  ];
  const options={encoding:'buffer',windowsHide:true,timeout:30000,maxBuffer:3*1024*1024,signal};
  for(const executable of path.isAbsolute(ffmpeg)?[ffmpeg,'ffmpeg']:['ffmpeg']){
    let stdout;
    try{({stdout}=await run(executable,args,options));}
    catch(error){
      signal?.throwIfAborted();
      if(error.code==='ENOENT')continue;
      if(error.killed)throw Error('提取音轨超时，请先在本地裁剪为 5–60 秒的录音或视频。');
      throw Error('无法提取音轨。请确认文件包含可播放的声音，或导出为 WAV 后重试。');
    }
    return pcmWave(stdout,SAMPLE_RATE,1);
  }
  throw Error('此格式需要本地 FFmpeg。请在语音设置中配置 FFmpeg、安装语音运行环境，或选择 16 位 PCM WAV。');
}

module.exports={cleanPcmWave,extractVoiceTrack,MEDIA_EXTENSIONS,MAX_AUDIO,MAX_MEDIA};
