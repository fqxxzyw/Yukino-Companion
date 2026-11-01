'use strict';
// Qwen-Audio voice enrollment: the selected recording remains in main-process
// memory and is sent only after an explicit authorization and create action.
const fs=require('node:fs/promises');
const path=require('node:path');
const {origin}=require('./dashscope-tts.cjs');
const MODEL='qwen-audio-3.1-tts-flash',MAX_AUDIO=7*1024*1024,MAX_RESPONSE=256*1024;
function audioKind(data){
 if(data.length>=44&&data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WAVE')return 'audio/wav';
 if(data.length>=4&&(data.toString('ascii',0,3)==='ID3'||data[0]===0xff&&(data[1]&0xe0)===0xe0))return 'audio/mpeg';
 if(data.length>=12&&data.toString('ascii',4,8)==='ftyp')return 'audio/mp4';
 throw Error('请选择有效的 WAV、MP3 或 M4A 录音。');
}
function validateWav(data){
 let fmt=null,audioBytes=0;
 for(let offset=12;offset+8<=data.length;){
  const kind=data.toString('ascii',offset,offset+4),length=data.readUInt32LE(offset+4),start=offset+8,end=start+length;
  if(end>data.length)throw Error('WAV 文件不完整，请重新选择。');
  if(kind==='fmt '&&length>=16)fmt={format:data.readUInt16LE(start),channels:data.readUInt16LE(start+2),rate:data.readUInt32LE(start+4),byteRate:data.readUInt32LE(start+8),bits:data.readUInt16LE(start+14)};
  if(kind==='data')audioBytes+=length;
  offset=end+(length%2);
 }
 if(!fmt||fmt.format!==1||fmt.bits!==16||![1,2].includes(fmt.channels)||fmt.rate<16000||fmt.byteRate!==fmt.rate*fmt.channels*2||!audioBytes)throw Error('WAV 需为 16 位 PCM、至少 16 kHz，单声道或双声道。');
 const seconds=audioBytes/fmt.byteRate;
 if(seconds<5||seconds>60)throw Error('录音应包含至少 5 秒人声，且总时长不超过 60 秒。');
}
async function readLimited(response){
 const length=Number(response.headers?.get?.('content-length'));if(length>MAX_RESPONSE)throw Error('百炼响应超过大小限制。');
 if(!response.body?.getReader){const b=Buffer.from(await response.arrayBuffer());if(b.length>MAX_RESPONSE)throw Error('百炼响应超过大小限制。');return b;}
 const reader=response.body.getReader(),parts=[];let total=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>MAX_RESPONSE){await reader.cancel();throw Error('百炼响应超过大小限制。');}parts.push(Buffer.from(value));}}finally{reader.releaseLock?.();}
 return Buffer.concat(parts,total);
}
class VoiceCloneService{
 constructor({fetcher}){if(typeof fetcher!=='function')throw Error('需要网络适配器');this.fetcher=fetcher;this.selected=null;this.pending=null;this.selectionEpoch=0;}
 ticket(){return this.selectionEpoch;}
 isCurrent(ticket){return ticket===this.selectionEpoch;}
 async selectRecording(value){
  if(this.pending)throw Error('音色正在创建，请先取消或等待完成。');
  ++this.selectionEpoch;this.selected=null;
  if(!(value instanceof Uint8Array)||value.byteLength<44||value.byteLength>MAX_AUDIO)throw Error('录音无效或超过 7 MiB。');
  const data=Buffer.from(value);if(audioKind(data)!=='audio/wav')throw Error('麦克风录音格式无效。');validateWav(data);
  this.selected={name:'麦克风录音.wav',data,mime:'audio/wav'};return {name:this.selected.name,bytes:data.length};
 }
 async selectFile(file){
  if(this.pending)throw Error('音色正在创建，请先取消或等待完成。');
  const epoch=++this.selectionEpoch;this.selected=null;
  if(typeof file!=='string'||!path.isAbsolute(file))throw Error('请选择本机录音文件。');
  const info=await fs.lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.size<44||info.size>MAX_AUDIO)throw Error('录音必须是有效文件且不超过 7 MiB。');
  const handle=await fs.open(file,'r');let data;
  try{const opened=await handle.stat();if(!opened.isFile()||opened.size!==info.size||opened.ino!==info.ino||opened.dev!==info.dev)throw Error('录音已改变，请重新选择。');data=await handle.readFile();}finally{await handle.close();}
  if(data.length!==info.size)throw Error('录音已改变，请重新选择。');
  if(epoch!==this.selectionEpoch)throw Error('录音选择已取消。');
  const mime=audioKind(data);if(mime==='audio/wav')validateWav(data);
  this.selected={name:path.basename(file),data,mime};return {name:this.selected.name,bytes:data.length};
 }
 async create({config,credentials,authorized,language='ja'}={}){
  if(this.pending)throw Error('音色正在创建，请等待或取消。');
  if(authorized!==true)throw Error('请先确认你有权使用并上传此录音。');
  if(!this.selected)throw Error('请先选择录音。');
  if(config?.providerId!=='dashscope-tts'||!credentials?.apiKey)throw Error('请先保存百炼语音服务与 API Key。');
  if(!['zh','ja','en'].includes(language))throw Error('请选择录音语言。');
  const base=origin(config),selected=this.selected,controller=new AbortController();this.pending=controller;
  const timer=setTimeout(()=>controller.abort(),60000);
  const check=()=>{if(controller.signal.aborted||this.pending!==controller)throw Error('音色创建已取消或超时；请在百炼控制台检查是否已创建。');};
  try{
   const body={model:'voice-enrollment',input:{action:'create_voice',target_model:MODEL,prefix:'yukino',audio:`data:${selected.mime};base64,${selected.data.toString('base64')}`,language_hints:[language]}};
   const response=await this.fetcher(base+'/api/v1/services/audio/tts/customization',{method:'POST',headers:{Authorization:`Bearer ${credentials.apiKey}`,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:controller.signal});check();
   if(!response.ok){if(response.status===401)throw Error('百炼 API Key 无效或地域不匹配。');if(response.status===403)throw Error('账户没有声音复刻权限。');if(response.status===429)throw Error('请求频率或账户额度受限，请检查百炼控制台。');throw Error(`声音复刻请求失败（HTTP ${response.status}），请检查录音和账户权限。`);}
   let result;try{result=JSON.parse((await readLimited(response)).toString('utf8'));}catch(error){if(/大小限制/.test(error.message))throw error;throw Error('百炼返回的音色结果无法解析。');}check();
   const voiceId=result?.output?.voice_id;if(result?.code||typeof voiceId!=='string'||!/^[A-Za-z0-9_.-]{1,128}$/.test(voiceId))throw Error('百炼没有返回有效音色 ID；请在控制台检查创建结果。');
   this.selected=null;return {voiceId,model:MODEL,requestId:typeof result.request_id==='string'?result.request_id.slice(0,128):''};
  }catch(error){if(controller.signal.aborted)throw Error('音色创建已取消或超时；请在百炼控制台检查是否已创建。');throw error;}
  finally{clearTimeout(timer);if(this.pending===controller)this.pending=null;}
 }
 cancel(){this.selectionEpoch++;this.selected=null;if(this.pending){this.pending.abort();this.pending=null;}return true;}
}
module.exports={VoiceCloneService,MODEL,MAX_AUDIO};
