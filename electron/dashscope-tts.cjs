'use strict';

// Qwen3-TTS-Flash non-streaming API. The audio URL is a temporary signed OSS
// URL; never forward the bearer credential to that host or to redirects.
const MAX_AUDIO = 16 * 1024 * 1024;
const BASES = {'cn-beijing':'https://dashscope.aliyuncs.com','ap-southeast-1':'https://dashscope-intl.aliyuncs.com'};
function origin(config){
 const region=config.fields?.region||'cn-beijing',base=BASES[region];
 if(!base)throw Error('不支持的百炼地域');
 const workspace=config.fields?.workspaceId?.trim();if(!workspace)return base;
 if(!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$/.test(workspace))throw Error('业务空间 ID 无效');
 return `https://${workspace}.${region}.maas.aliyuncs.com`;
}
function audioUrl(value){
 let url;try{url=new URL(value);}catch{throw Error('云端未返回有效音频地址');}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.port||!/^dashscope-result-[a-z0-9-]+\.oss-[a-z0-9-]+\.aliyuncs\.com$/i.test(url.hostname))throw Error('云端返回了不受信任的音频地址');
 url.protocol='https:';return url.href;
}
async function limited(response,limit){
 const declared=Number(response.headers?.get?.('content-length'));if(declared>limit)throw Error('云端响应超过大小限制');
 if(!response.body?.getReader){const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>limit)throw Error('云端响应超过大小限制');return bytes;}
 const reader=response.body.getReader(),parts=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw Error('云端响应超过大小限制');}parts.push(Buffer.from(value));}}finally{reader.releaseLock?.();}
 return Buffer.concat(parts,size);
}
function errorFor(status){if(status===401)return '百炼 API Key 无效，或与所选地域不匹配。';if(status===403)return '百炼账户没有此模型的使用权限。';if(status===429)return '百炼额度不足或请求过于频繁，请检查账户和计费。';return `百炼语音请求失败（HTTP ${status}），请检查网络、模型和音色。`;}
class DashScopeSpeech {
 constructor({fetcher}){this.fetcher=fetcher;this.session=null;}
 begin(id,config,key){if(typeof id!=='string'||!id||id.length>128)throw Error('无效语音会话');if(!key)throw Error('请先保存百炼 API Key。');origin(config);if(!/^(?:qwen3-tts-flash(?:-[0-9-]+)?|qwen-audio-3\.1-tts-flash)$/.test(config.model||''))throw Error('当前仅接入 qwen3-tts-flash 与 qwen-audio-3.1-tts-flash；请检查模型 ID。');this.stop();this.session={id,config:structuredClone(config),key,controllers:new Set()};}
 prewarm(id){this.current(id);return {phase:'ready',metadata:{engine:'dashscope-tts',capabilities:{maxConcurrentTasks:2,nativeBatch:false,audioStreaming:false}}};}
 current(id){if(!this.session||this.session.id!==id)throw Error('语音会话已过期');return this.session;}
 async synthesize(id,text){
  const session=this.current(id);if(typeof text!=='string'||!text.trim()||text.length>500)throw Error('无效语音片段，最长 500 字符。');
  const audioModel=session.config.model==='qwen-audio-3.1-tts-flash',voice=session.config.fields?.voice?.trim()||(audioModel?'longanhuan_v3.1':'Cherry');if(!/^[A-Za-z0-9_.-]{1,128}$/.test(voice))throw Error('音色 ID 无效。');
  const controller=new AbortController();session.controllers.add(controller);const timeout=setTimeout(()=>controller.abort(),60000);
  const check=()=>{if(this.session!==session||controller.signal.aborted)throw Error('语音会话已取消或超时');};
  try{
   const language=session.config.speechLanguage,endpoint=audioModel?'/api/v1/services/audio/tts/SpeechSynthesizer':'/api/v1/services/aigc/multimodal-generation/generation',input=audioModel?{text,voice,format:'wav',sample_rate:24000,...(language==='zh'||language==='ja'?{language_hints:[language]}:{})}:{text,voice,language_type:language==='zh'?'Chinese':language==='ja'?'Japanese':'Auto'};
   const response=await this.fetcher(origin(session.config)+endpoint,{method:'POST',headers:{Authorization:'Bearer '+session.key,'Content-Type':'application/json'},body:JSON.stringify({model:session.config.model,input}),signal:controller.signal,redirect:'error'});check();
   if(!response.ok)throw Error(errorFor(response.status));
   let body;try{body=JSON.parse((await limited(response,1024*1024)).toString('utf8'));}catch(error){if(/大小限制/.test(error.message))throw error;throw Error('百炼返回的响应无法解析。');}check();
   if(body.code||!body.output?.audio?.url)throw Error('百炼未返回有效音频，请检查模型、音色与账户权限。');
   const audio=await this.fetcher(audioUrl(body.output.audio.url),{signal:controller.signal,redirect:'error'});check();if(!audio.ok)throw Error('下载合成音频失败，请重试。');
   const bytes=await limited(audio,MAX_AUDIO);check();if(bytes.length<44||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')throw Error('百炼未返回有效 WAV 音频。');return bytes;
  }catch(error){if(controller.signal.aborted)throw Error('语音会话已取消或超时');throw error;}finally{clearTimeout(timeout);session.controllers.delete(controller);}
 }
 stop(id){if(!this.session||id&&this.session.id!==id)return;const session=this.session;this.session=null;for(const controller of session.controllers)controller.abort();session.key='';}
}
module.exports={DashScopeSpeech,origin,audioUrl};
