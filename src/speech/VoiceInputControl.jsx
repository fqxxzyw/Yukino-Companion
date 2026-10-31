import React,{useEffect,useRef,useState} from 'react';
import {Mic,MicOff,Square,LoaderCircle} from 'lucide-react';
import {VoiceInputSession,VOICE_INPUT_DEFAULTS} from './voice-input-session.mjs';
import './voice-input.css';

export default function VoiceInputControl({api,settings={},disabled=false,variant='default',tools,trailing,onPartial=()=>{},onFinal=()=>{},onSubmit=()=>{},onInterrupt=()=>{},onStatus=()=>{}}){
 const [state,setState]=useState({phase:'idle',level:0,partial:'',final:''}),controller=useRef(null),callbacks=useRef({});
 callbacks.current={onPartial,onFinal,onSubmit,onInterrupt,onStatus};
 const value={...VOICE_INPUT_DEFAULTS,...settings},signature=JSON.stringify(value),compact=variant==='composer';
 useEffect(()=>{
  const session=new VoiceInputSession({api,onStatus:next=>{setState(next);callbacks.current.onStatus(next);},onPartial:(...args)=>callbacks.current.onPartial(...args),onFinal:(...args)=>callbacks.current.onFinal(...args),onSubmit:(...args)=>callbacks.current.onSubmit(...args),onInterrupt:(...args)=>callbacks.current.onInterrupt(...args)});
  controller.current=session;
  const hide=()=>{if(document.hidden)void session.cancel();},pagehide=()=>void session.cancel();
  document.addEventListener('visibilitychange',hide);window.addEventListener('pagehide',pagehide);
  return()=>{document.removeEventListener('visibilitychange',hide);window.removeEventListener('pagehide',pagehide);void session.dispose();controller.current=null;};
 },[api]);
 useEffect(()=>{void controller.current?.cancel();},[signature]);
 // Navigating away from the composer must not leave an invisible microphone running.
 useEffect(()=>{if(disabled)void controller.current?.cancel();},[disabled]);
 const active=['connecting','listening','finishing'].includes(state.phase);
 const available=typeof api?.asrStart==='function';
 const label=value.mode==='hold'?'按住说话':value.mode==='continuous'?'开启自由语音':'点击说话';
 const statusLabel=state.phase==='connecting'?'连接中…':state.phase==='finishing'?'等待转写…':'结束说话';
 const accessibleLabel=active?'结束本次语音输入':label;
 const buttonDisabled=disabled&&!active||!available||state.phase==='finishing';
 const reason=!available?'语音输入需要 Electron 桌面版':disabled&&!active?'当前无法开始语音输入':state.phase==='finishing'?'正在等待最终转写，可取消本次识别':accessibleLabel;
 function start(){const session=controller.current;if(disabled||!available||!session||['connecting','listening','finishing'].includes(session.state.phase))return;return session.start(value).catch(()=>{});}
 function finish(){const session=controller.current;if(!session||session.state.phase==='finishing')return;return session.finish().catch(()=>{});}
 function pointerDown(event){if(value.mode!=='hold'||buttonDisabled||event.button!==0||event.isPrimary===false)return;event.preventDefault();event.currentTarget.setPointerCapture?.(event.pointerId);void start();}
 function pointerUp(event){if(value.mode==='hold'&&event.button===0&&event.isPrimary!==false){event.preventDefault();void finish();}}
 return <div className={'voice-input-control'+(compact?' voice-input-composer':'')}>
  <div className={'voice-input-actions'+(compact?' composer-tools':'')}>
   <button type="button" className={active?'voice-mic active':'voice-mic'} disabled={buttonDisabled} title={reason} aria-label={accessibleLabel} aria-pressed={active} onPointerDown={pointerDown} onPointerUp={pointerUp} onPointerCancel={event=>{if(event.isPrimary!==false)void controller.current?.cancel();}} onLostPointerCapture={()=>{if(value.mode==='hold')void finish();}} onClick={()=>{if(value.mode!=='hold')active?void finish():void start();}} onKeyDown={event=>{if(value.mode==='hold'&&!event.repeat&&[' ','Enter'].includes(event.key)){event.preventDefault();void start();}}} onKeyUp={event=>{if(value.mode==='hold'&&[' ','Enter'].includes(event.key)){event.preventDefault();void finish();}}} onBlur={()=>{if(value.mode==='hold'&&active)void finish();}}>
    {['connecting','finishing'].includes(state.phase)?<LoaderCircle size={17} className="spin"/>:<Mic size={17}/>}<span>{active?statusLabel:compact&&value.mode==='click'?'说话':label}</span>
   </button>
   {active&&<><button type="button" className="icon" title={state.muted?'取消麦克风静音':'麦克风静音'} onClick={()=>controller.current?.setMuted(!state.muted)} aria-label={state.muted?'取消麦克风静音':'麦克风静音'}>{state.muted?<MicOff size={16}/>:<Mic size={16}/>}</button><button type="button" className="icon" title="停止监听并取消本次识别" onClick={()=>void controller.current?.cancel()} aria-label="停止监听并取消本次识别"><Square size={16}/></button></>}
   {active&&<meter min="0" max="1" value={state.level||0} aria-label="麦克风输入音量"/>}
   {tools}{trailing&&<div className="composer-submit">{trailing}</div>}
  </div>
  {(state.partial||state.final||state.error||active)&&<div className="voice-input-feedback">
   {state.partial&&<p className="asr-partial" aria-live="polite">{state.partial}<small>识别中</small></p>}
   {state.final&&<p className="asr-final" aria-live="polite">{state.final}<small>已确认</small></p>}
   {state.error&&<p role="alert" className="notice">{state.error}</p>}
   {active&&<small role="status">{state.phase==='connecting'?'正在连接所选语音识别服务…':state.phase==='finishing'?'录音已结束，正在等待最终文字。':state.muted?'麦克风已静音':value.mode==='continuous'?'正在向所选云端 ASR 发送声音；可随时停止。':'正在录音；结束后确认转写。'}</small>}
  </div>}
 </div>;
}
