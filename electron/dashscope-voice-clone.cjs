'use strict';
// Qwen-Audio voice enrollment: the selected recording remains in main-process
// memory and is sent only after an explicit authorization and create action.
const fs=require('node:fs/promises');
const path=require('node:path');
const {origin}=require('./dashscope-tts.cjs');
const {cleanPcmWave,extractVoiceTrack,MEDIA_EXTENSIONS,MAX_AUDIO,MAX_MEDIA}=require('./voice-clone-media.cjs');
const MODEL='qwen-audio-3.1-tts-flash',MAX_RESPONSE=256*1024;

function sameFile(left,right){
 return right.isFile()&&left.ino===right.ino&&left.dev===right.dev&&left.size===right.size&&left.mtimeMs===right.mtimeMs;
}

async function readSelectedWav(file,info){
 const handle=await fs.open(file,'r');
 try{
  if(!sameFile(info,await handle.stat()))throw Error('录音已改变，请重新选择。');
  const bytes=Buffer.alloc(info.size);
  for(let offset=0;offset<bytes.length;){
   const {bytesRead}=await handle.read(bytes,offset,bytes.length-offset,offset);
   if(!bytesRead)throw Error('录音已改变，请重新选择。');
   offset+=bytesRead;
  }
  return cleanPcmWave(bytes);
 }finally{await handle.close();}
}
async function readLimited(response){
 const length=Number(response.headers?.get?.('content-length'));if(length>MAX_RESPONSE)throw Error('百炼响应超过大小限制。');
 if(!response.body?.getReader){const b=Buffer.from(await response.arrayBuffer());if(b.length>MAX_RESPONSE)throw Error('百炼响应超过大小限制。');return b;}
 const reader=response.body.getReader(),parts=[];let total=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>MAX_RESPONSE){await reader.cancel();throw Error('百炼响应超过大小限制。');}parts.push(Buffer.from(value));}}finally{reader.releaseLock?.();}
 return Buffer.concat(parts,total);
}
class VoiceCloneService{
 constructor({fetcher,extractAudio=extractVoiceTrack}){
  if(typeof fetcher!=='function')throw Error('需要网络适配器');
  Object.assign(this,{fetcher,extractAudio,selected:null,pending:null,selection:null,selectionEpoch:0});
 }
 ticket(){return this.selectionEpoch;}
 isCurrent(ticket){return ticket===this.selectionEpoch;}
 async selectRecording(value){
  if(this.pending)throw Error('音色正在创建，请先取消或等待完成。');
  this.cancel();
  if(!(value instanceof Uint8Array)||value.byteLength<44||value.byteLength>MAX_AUDIO)throw Error('录音无效或超过 7 MiB。');
  const data=cleanPcmWave(Buffer.from(value));
  if(!data)throw Error('麦克风录音格式无效。');
  this.selected={name:'麦克风录音.wav',data};return {name:this.selected.name,bytes:data.length};
 }
 async selectFile(file){
  if(this.pending)throw Error('音色正在创建，请先取消或等待完成。');
  this.cancel();
  if(typeof file!=='string'||!path.isAbsolute(file)||/^[\\/]{2}/.test(file))throw Error('请选择本机录音或视频文件。');
  const extension=path.extname(file).slice(1).toLowerCase();
  if(!MEDIA_EXTENSIONS.includes(extension))throw Error('请选择支持的录音或视频格式。');
  const controller=new AbortController();this.selection=controller;
  try{
   const info=await fs.lstat(file);
   if(!info.isFile()||info.size<44||info.size>MAX_MEDIA)throw Error('录音或视频必须为有效文件且不超过 512 MiB。');
   const direct=extension==='wav'&&info.size<=MAX_AUDIO?await readSelectedWav(file,info):null;
   controller.signal.throwIfAborted();
   const extracted=direct||await this.extractAudio(file,{signal:controller.signal});
   if(!sameFile(info,await fs.lstat(file)))throw Error('源文件已改变，请重新选择。');
   controller.signal.throwIfAborted();
   const data=direct||(Buffer.isBuffer(extracted)&&extracted.length<=MAX_AUDIO?cleanPcmWave(extracted):null);
   if(!data)throw Error('没有可用于声音复刻的音频。');
   const name=path.basename(file);
   this.selected={name,data};
   return {name,bytes:data.length,extracted:!direct};
  }catch(error){
   if(controller.signal.aborted)throw Error('录音选择已取消。');
   throw error;
  }finally{if(this.selection===controller)this.selection=null;}
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
   const body={model:'voice-enrollment',input:{action:'create_voice',target_model:MODEL,prefix:'yukino',audio:`data:audio/wav;base64,${selected.data.toString('base64')}`,language_hints:[language]}};
   const response=await this.fetcher(base+'/api/v1/services/audio/tts/customization',{method:'POST',headers:{Authorization:`Bearer ${credentials.apiKey}`,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:controller.signal});check();
   if(!response.ok){if(response.status===401)throw Error('百炼 API Key 无效或地域不匹配。');if(response.status===403)throw Error('账户没有声音复刻权限。');if(response.status===429)throw Error('请求频率或账户额度受限，请检查百炼控制台。');throw Error(`声音复刻请求失败（HTTP ${response.status}），请检查录音和账户权限。`);}
   let result;try{result=JSON.parse((await readLimited(response)).toString('utf8'));}catch(error){if(/大小限制/.test(error.message))throw error;throw Error('百炼返回的音色结果无法解析。');}check();
   const voiceId=result?.output?.voice_id;if(result?.code||typeof voiceId!=='string'||!/^[A-Za-z0-9_.-]{1,128}$/.test(voiceId))throw Error('百炼没有返回有效音色 ID；请在控制台检查创建结果。');
   this.selected=null;return {voiceId,model:MODEL,requestId:typeof result.request_id==='string'?result.request_id.slice(0,128):''};
  }catch(error){if(controller.signal.aborted)throw Error('音色创建已取消或超时；请在百炼控制台检查是否已创建。');throw error;}
  finally{clearTimeout(timer);if(this.pending===controller)this.pending=null;}
 }
 cancel(){this.selectionEpoch++;this.selected=null;this.selection?.abort();this.selection=null;if(this.pending){this.pending.abort();this.pending=null;}return true;}
}
module.exports={VoiceCloneService,MODEL,MAX_AUDIO};
