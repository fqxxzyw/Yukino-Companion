import React,{useEffect,useRef,useState} from 'react';
import {CheckCircle2,LoaderCircle,Mic} from 'lucide-react';
import Select from '../ui/Select.jsx';
import {MicrophoneCapture} from './microphone-capture.mjs';
import {encodeCloneWav} from './clone-audio.mjs';
import './cloud-voice-clone.css';

export default function CloudVoiceClone({api,configs=[],onPrepare,onCreated}){
 const [configId,setConfigId]=useState(''),[language,setLanguage]=useState('ja'),[selected,setSelected]=useState(null),[authorized,setAuthorized]=useState(false),[phase,setPhase]=useState('idle'),[error,setError]=useState(''),[result,setResult]=useState(null);
 const mounted=useRef(true),attempt=useRef(0),capture=useRef(null),starting=useRef(false),picking=useRef(null),creating=useRef(null),frames=useRef([]),size=useRef(0),stopping=useRef(false),finishRef=useRef(null);
 const chosen=configs.some(item=>item.id===configId)?configId:configs[0]?.id||'',pending=phase==='creating'||phase==='selecting'||phase==='starting'||phase==='finishing',recording=phase==='recording';
 useEffect(()=>{
  mounted.current=true;
  const stopCapture=()=>{if(!capture.current&&!starting.current)return;attempt.current++;capture.current?.stop();capture.current=null;starting.current=false;frames.current=[];size.current=0;stopping.current=false;setPhase('idle');setError('麦克风已停止，请重新录音。');api?.microphoneRelease?.().catch(()=>{});};
  const hidden=()=>{if(document.hidden)stopCapture()};document.addEventListener('visibilitychange',hidden);
  const off=api?.onMicrophoneRevoked?.(stopCapture);
  return()=>{mounted.current=false;attempt.current++;capture.current?.stop();capture.current=null;api?.microphoneRelease?.().catch(()=>{});api?.voiceCloneCancel?.().catch(()=>{});document.removeEventListener('visibilitychange',hidden);off?.();};
 },[api]);
 const clear=()=>{setSelected(null);setAuthorized(false);setResult(null);setError('')};
 async function pick(){if(pending||recording||picking.current||!api?.voiceClonePick)return;const id=++attempt.current;picking.current=id;clear();setPhase('selecting');try{const file=await api.voiceClonePick();if(mounted.current&&attempt.current===id){setSelected(file||null);setPhase('idle')}}catch(e){if(mounted.current&&attempt.current===id){setError(e.message||'无法选择录音。');setPhase('idle')}}finally{if(picking.current===id)picking.current=null;}}
 async function finish(){
  if(stopping.current||!capture.current)return;stopping.current=true;const mic=capture.current,id=attempt.current;setPhase('finishing');
  try{await mic.flush();mic.stop();capture.current=null;const wav=encodeCloneWav(frames.current);frames.current=[];size.current=0;const file=await api.voiceCloneRecording(wav);if(mounted.current&&attempt.current===id){setSelected(file);setPhase('idle')}}
  catch(e){mic.stop();capture.current=null;frames.current=[];size.current=0;if(mounted.current&&attempt.current===id){setError(e.message||'录音未完成。');setPhase('idle')}}finally{api?.microphoneRelease?.().catch(()=>{});stopping.current=false;}
 }
 finishRef.current=finish;
 async function record(){
  if(pending||recording||starting.current||!api?.microphonePermission||!api?.voiceCloneRecording)return;
  const id=++attempt.current;clear();frames.current=[];size.current=0;starting.current=true;setPhase('starting');let mic;
  try{await api.voiceCloneCancel?.();await api.microphonePermission({consent:true});if(!mounted.current||id!==attempt.current){api?.microphoneRelease?.().catch(()=>{});return;}
   mic=new MicrophoneCapture({onFrame:data=>{if(id!==attempt.current||!mounted.current)return;const bytes=new Uint8Array(data);frames.current.push(bytes);size.current+=bytes.length;if(size.current>=16000*2*60)void finishRef.current?.();},onEnded:message=>{if(id!==attempt.current)return;capture.current=null;frames.current=[];size.current=0;api?.microphoneRelease?.().catch(()=>{});if(mounted.current){setError(message);setPhase('idle')}}});
   capture.current=mic;await mic.start({consent:true,echoCancellation:false,noiseSuppression:false});if(!mounted.current||id!==attempt.current){mic.stop();return;}starting.current=false;setPhase('recording');
  }catch(e){mic?.stop();if(capture.current===mic)capture.current=null;if(id===attempt.current){starting.current=false;api?.microphoneRelease?.().catch(()=>{});if(mounted.current){setError(e.message||'无法使用麦克风。');setPhase('idle')}}}
 }
 async function create(){
  if(pending||recording||creating.current||!authorized||!selected||!chosen||!api?.voiceCloneCreate)return;
  const id=++attempt.current;creating.current=id;setError('');setPhase('creating');
  try{await onPrepare?.();if(!mounted.current||id!==attempt.current)return;const value=await api.voiceCloneCreate({configId:chosen,authorized:true,language});if(!mounted.current||id!==attempt.current)return;setPhase('idle');setSelected(null);setAuthorized(false);setResult(value);if(value?.configId)onCreated?.(value);}
  catch(e){if(mounted.current&&id===attempt.current){setError(e.message||'音色创建失败。');setPhase('idle')}}finally{if(creating.current===id)creating.current=null;}
 }
 function cancel(){attempt.current++;capture.current?.stop();capture.current=null;starting.current=false;picking.current=null;creating.current=null;frames.current=[];size.current=0;stopping.current=false;clear();setPhase('idle');api?.microphoneRelease?.().catch(()=>{});api?.voiceCloneCancel?.().catch(()=>{});}
 return <div className="cloud-voice-clone">
  <div className="cloud-voice-clone-title"><Mic size={16}/><strong>从录音创建云端音色</strong></div>
  <p>选择 5–60 秒清晰人声。支持 WAV、MP3、M4A、FLAC、OGG、MP4、MOV、WebM 等本机文件（最多 512 MiB）。视频与压缩音频由本机 FFmpeg 提取为 WAV。确认后只将处理过的声音上传到阿里云百炼，服务可能产生费用。</p>
  <label className="field">百炼语音服务<Select aria-label="声音复刻使用的百炼服务" value={chosen} disabled={!configs.length||pending||recording} onChange={event=>{setConfigId(event.target.value);setAuthorized(false)}}>{!configs.length&&<option value="">请先添加百炼语音服务</option>}{configs.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>
  <label className="field">录音语言<Select aria-label="录音语言" value={language} disabled={pending||recording} onChange={event=>setLanguage(event.target.value)}><option value="ja">日语</option><option value="zh">中文</option><option value="en">英语</option></Select></label>
  <div className="cloud-voice-clone-actions"><button type="button" className="secondary" disabled={pending||recording||!api?.voiceClonePick} onClick={pick}>选择录音</button>{recording?<button type="button" className="secondary" onClick={finish}>结束录音</button>:<button type="button" className="secondary" disabled={pending||!api?.voiceCloneRecording||!api?.microphonePermission} onClick={record}><Mic size={14}/>开始录音</button>}{(pending||recording||selected)&&<button type="button" className="secondary" onClick={cancel}>取消</button>}</div>
  {recording&&<span role="status" className="cloud-voice-clone-status"><Mic size={14}/>正在录音，最长 60 秒</span>}
  {selected&&<span role="status" className="cloud-voice-clone-status"><CheckCircle2 size={14}/>{selected.name} · {(selected.bytes/1048576).toFixed(1)} MiB WAV{selected.extracted?' · 已在本机提取音轨':''} · 尚未上传</span>}
  <label className="cloud-voice-clone-consent"><input type="checkbox" checked={authorized} disabled={!selected||pending||recording} onChange={event=>setAuthorized(event.target.checked)}/>我确认有权使用并上传这段声音，了解可能产生费用。</label>
  <button type="button" className="primary" disabled={!chosen||!selected||!authorized||pending||recording||!api?.voiceCloneCreate} aria-busy={phase==='creating'||undefined} onClick={create}>{phase==='creating'?<LoaderCircle size={14} className="spin"/>:null}{phase==='creating'?'正在创建…':'上传并创建音色'}</button>
  {phase==='creating'&&<p role="status">正在上传并创建音色；取消后请到百炼控制台确认是否已产生记录。</p>}
  {result?.configId&&<p role="status">音色已创建并绑定到独立语音配置；实际播放仍需试听验证。</p>}
  {result&&!result.configId&&<p role="alert">{result.message||'音色已创建，但保存配置失败。'} 请记录音色 ID：{result.voiceId}，模型：{result.model}，在「模型与 API」中手动配置。</p>}
  {error&&<p role="alert">{error}</p>}
 </div>;
}
