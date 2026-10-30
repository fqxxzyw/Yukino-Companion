'use strict';
// Qwen3-ASR Realtime WebSocket protocol. Credentials never leave the main process.
// Docs: https://help.aliyun.com/en/model-studio/qwen-asr-realtime-interaction-process
const {randomUUID}=require('node:crypto');
const LIMITS=Object.freeze({frameBytes:12800,bufferedBytes:1024*1024,eventBytes:65536,connectMs:20000,finishMs:20000,sessionMs:30*60000});
function endpoint(config={}){
 if(config.providerId!=='aliyun-asr')throw Error('请选择已接入的阿里云实时语音识别。');
 const fields=config.fields||{},region=fields.region||'cn-beijing',model=config.model||'qwen3-asr-flash-realtime';
 if(!['cn-beijing','ap-southeast-1'].includes(region))throw Error('阿里云语音识别仅支持北京或新加坡地域。');
 if(model!=='qwen3-asr-flash-realtime')throw Error('当前仅接入 qwen3-asr-flash-realtime 实时协议。');
 if(fields.audioFormat&&fields.audioFormat!=='pcm'||fields.sampleRate!==undefined&&Number(fields.sampleRate)!==16000)throw Error('当前语音输入固定使用 16kHz 单声道 PCM16，请恢复推荐音频格式。');
 const workspace=String(fields.workspaceId||'');if(workspace&&!/^[a-zA-Z0-9-]{1,80}$/.test(workspace))throw Error('工作空间 ID 格式无效。');
 const host=workspace?`${workspace}.${region}.maas.aliyuncs.com`:region==='cn-beijing'?'dashscope.aliyuncs.com':'dashscope-intl.aliyuncs.com';
 const publicBases=['wss://dashscope.aliyuncs.com/api-ws/v1/realtime','wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime'];const raw=fields.wsEndpoint||(!workspace&&!publicBases.includes(config.base)?config.base:'')||`wss://${host}/api-ws/v1/realtime`;let url;
 try{url=new URL(raw)}catch{throw Error('实时语音 WebSocket 地址无效。');}
 const permitted=new Set([region==='cn-beijing'?'dashscope.aliyuncs.com':'dashscope-intl.aliyuncs.com',...(workspace?[host]:[])]);
 if(url.protocol!=='wss:'||!permitted.has(url.hostname)||url.port||url.username||url.password||url.hash||url.pathname.replace(/\/$/,'')!=='/api-ws/v1/realtime'||[...url.searchParams.keys()].some(key=>key!=='model'))throw Error('请使用所选地域的阿里云官方实时语音地址，密钥不能放在 URL 中。');
 if(url.searchParams.has('model')&&url.searchParams.get('model')!==model)throw Error('WebSocket 地址中的模型与配置不一致。');
 url.searchParams.set('model',model);return {url:url.href,workspace,model,region};
}
function serviceError(code=''){
 const value=String(code).toLowerCase();
 if(/401|invalid_api_key|authentication|unauthorized/.test(value))return '阿里云 API Key 无效，请检查密钥及所属地域。';
 if(/403|permission|accessdenied|forbidden/.test(value))return '阿里云语音服务未开通或没有模型权限，请检查地域与工作空间。';
 if(/429|rate|quota|balance/.test(value))return '阿里云语音额度不足或请求过于频繁，请检查控制台。';
 if(/model|invalid_value|invalid_request/.test(value))return '实时语音模型或参数不受支持，请检查模型与地域设置。';
 return '实时语音连接未完成，请检查网络、模型权限和地域设置。';
}
class AliyunRealtimeAsr{
 constructor({notify=()=>{},createSocket=(url,options)=>new(require('ws'))(url,options),now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}={}){Object.assign(this,{notify,createSocket,now,setTimer,clearTimer});this.session=null;}
 emit(entry,type,extra={}){if(this.session!==entry)return;this.notify({sessionId:entry.id,type,phase:type==='ready'?'listening':type,...extra});}
 valid(sessionId){const entry=this.session;if(!entry||entry.id!==sessionId)throw Error('语音识别会话已停止，请重新开始。');return entry;}
 start({config,credential,locale='zh',mode='click',silenceDurationMs=400}={}){
  const connection=endpoint(config);if(!credential||typeof credential.apiKey!=='string'||!credential.apiKey.trim()||credential.apiKey.length>4096)throw Error('请在 API 管理中保存阿里云语音识别密钥。');
  if(!['click','hold','continuous'].includes(mode)||!['zh','ja','en','auto','yue'].includes(locale))throw Error('语音输入模式或语言无效。');
  if(!Number.isInteger(silenceDurationMs)||silenceDurationMs<300||silenceDurationMs>2000)throw Error('静音断句阈值需为 300–2000 毫秒。');
  this.stop({reason:'replaced'});const entry={id:randomUUID(),mode,ready:false,finishing:false,bytes:0,seen:new Set(),timers:new Set(),startedAt:this.now()};this.session=entry;
  return new Promise((resolve,reject)=>{
   entry.resolve=resolve;entry.reject=reject;
   const fail=message=>this.fail(entry,message);
   try{
    const headers={Authorization:`Bearer ${credential.apiKey.trim()}`};if(connection.workspace)headers['X-DashScope-WorkSpace']=connection.workspace;
    const ws=this.createSocket(connection.url,{headers,handshakeTimeout:LIMITS.connectMs,perMessageDeflate:false,maxPayload:LIMITS.eventBytes,followRedirects:false});entry.ws=ws;
    entry.timer=this.timer(entry,()=>fail('实时语音连接超时，请检查网络和服务地域。'),LIMITS.connectMs);
    ws.on('open',()=>{if(this.session!==entry)return;try{this.send(entry,{type:'session.update',session:{input_audio_format:'pcm',sample_rate:16000,input_audio_transcription:locale==='auto'?{}:{language:locale},turn_detection:mode==='continuous'?{type:'server_vad',threshold:0.0,silence_duration_ms:silenceDurationMs}:null}});}catch{fail('实时语音会话配置未能发送，连接已停止。');}});
    ws.on('message',data=>{if(this.session!==entry)return;try{this.receive(entry,data)}catch{fail('实时语音返回了无效协议数据，连接已停止。');}});
    ws.on('unexpected-response',(_request,response)=>{response?.resume?.();fail(serviceError(response?.statusCode));});
    ws.on('error',()=>fail('实时语音网络连接失败，请检查代理、网络和服务地域。'));
    ws.on('close',()=>{if(this.session!==entry)return;if(entry.completed)this.cleanup(entry);else fail('实时语音连接已断开，请重新开始；未完成的语音不会自动发送。');});
   }catch{fail('无法建立实时语音连接，请检查 WebSocket 依赖和网络设置。');}
  });
 }
 timer(entry,fn,ms){const timer=this.setTimer(()=>{entry.timers.delete(timer);if(this.session===entry)fn();},ms);entry.timers.add(timer);timer?.unref?.();return timer;}
 send(entry,value){if(this.session!==entry||entry.ws?.readyState!==1)throw Error('实时语音尚未连接。');if(entry.ws.bufferedAmount>LIMITS.bufferedBytes)throw Error('音频上传积压，已停止识别，请检查网络。');entry.ws.send(JSON.stringify({event_id:randomUUID(),...value}));}
 receive(entry,data){
  if((data?.length||0)>LIMITS.eventBytes)throw Error('oversized');let event=JSON.parse(Buffer.isBuffer(data)?data.toString('utf8'):String(data));if(!event||typeof event.type!=='string')throw Error('event');
  if(event.type==='error'||event.type==='conversation.item.input_audio_transcription.failed'){this.fail(entry,serviceError(event.error?.code||event.error?.type));return;}
  if(event.type==='session.updated'){
   if(entry.ready)return;entry.ready=true;this.clearTimer(entry.timer);entry.timers.delete(entry.timer);
   this.timer(entry,()=>this.fail(entry,'本次语音会话已达到 30 分钟，请重新开始。'),LIMITS.sessionMs);
   this.emit(entry,'ready',{protocolReady:true,transcriptionVerified:false});entry.resolve?.({sessionId:entry.id,phase:'listening',sampleRate:16000,audioFormat:'pcm'});entry.resolve=null;entry.reject=null;return;
  }
  if(!entry.ready)return;
  const itemId=typeof event.item_id==='string'?event.item_id.slice(0,160):'';
  if(event.type==='input_audio_buffer.speech_started')this.emit(entry,'speech-started',{itemId});
  if(event.type==='input_audio_buffer.speech_stopped')this.emit(entry,'speech-stopped',{itemId});
  if(event.type==='conversation.item.input_audio_transcription.text'){
   const text=String(event.text||'')+String(event.stash||'');if(text.length>24000)throw Error('text');this.emit(entry,'partial',{text,itemId});
  }
  if(event.type==='conversation.item.input_audio_transcription.completed'){
   if(typeof event.transcript!=='string'||event.transcript.length>24000)throw Error('text');const text=event.transcript.trim();
   if(text&&(!itemId||!entry.seen.has(itemId))){if(itemId)entry.seen.add(itemId);if(entry.seen.size>256)entry.seen.delete(entry.seen.values().next().value);this.emit(entry,'final',{text,itemId,transcriptionVerified:true});}
  }
  if(event.type==='session.finished'){entry.completed=true;this.emit(entry,'finished');entry.finishResolve?.({finished:true});entry.finishResolve=null;entry.finishReject=null;this.cleanup(entry);}
 }
 append({sessionId,pcm}={}){
  const entry=this.valid(sessionId);if(!entry.ready||entry.finishing)throw Error('语音会话尚未就绪或正在结束。');
  const bytes=pcm instanceof ArrayBuffer?Buffer.from(pcm):ArrayBuffer.isView(pcm)?Buffer.from(pcm.buffer,pcm.byteOffset,pcm.byteLength):null;
  if(!bytes||!bytes.length||bytes.length%2||bytes.length>LIMITS.frameBytes)throw Error('麦克风音频必须是有界的 16kHz 单声道 PCM16 帧。');
  try{this.send(entry,{type:'input_audio_buffer.append',audio:bytes.toString('base64')});entry.bytes+=bytes.length;return {accepted:true};}catch(error){this.fail(entry,error.message);throw error;}
 }
 finish({sessionId}={}){
  const entry=this.valid(sessionId);if(entry.finishing)return entry.finished;
  entry.finishing=true;entry.finished=new Promise((resolve,reject)=>{entry.finishResolve=resolve;entry.finishReject=reject;});
  try{if(entry.mode!=='continuous'&&entry.bytes)this.send(entry,{type:'input_audio_buffer.commit'});this.send(entry,{type:'session.finish'});this.emit(entry,'finishing');this.timer(entry,()=>this.fail(entry,'等待语音最终结果超时，请重新录音。'),LIMITS.finishMs);}catch(error){this.fail(entry,error.message);}
  return entry.finished;
 }
 fail(entry,message){if(this.session!==entry)return;this.emit(entry,'error',{error:message});entry.reject?.(Error(message));entry.finishReject?.(Error(message));entry.reject=null;entry.finishReject=null;this.cleanup(entry);}
 cleanup(entry){for(const timer of entry.timers)this.clearTimer(timer);entry.timers.clear();entry.resolve=null;entry.reject=null;entry.seen.clear();if(this.session===entry)this.session=null;try{entry.ws?.terminate?.();if(!entry.ws?.terminate)entry.ws?.close?.();}catch{}}
 stop({sessionId,reason='cancelled'}={}){const entry=this.session;if(!entry||sessionId&&sessionId!==entry.id)return {stopped:false};this.emit(entry,'closed',{reason:['cancelled','replaced','hidden','locked','shutdown'].includes(reason)?reason:'cancelled'});entry.reject?.(Error('本次语音识别已取消。'));entry.finishReject?.(Error('本次语音识别已取消。'));this.cleanup(entry);return {stopped:true};}
}
module.exports={AliyunRealtimeAsr,endpoint,serviceError,LIMITS};
