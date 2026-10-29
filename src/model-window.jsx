import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import CompactDock from './ui/CompactDock.jsx';
import {RemoteSpeechClock} from './speech/remote-clock.mjs';
import {useReducedMotion} from './ui/use-reduced-motion.mjs';
import {GlbAvatarRenderer} from './ui/model-runtime.mjs';
import {friendlyError} from './ui/errors.mjs';
import catalog from '../resources/character-models.json';
import './model-window.css';

function ModelWindow(){
 const host=useRef(null),renderer=useRef(null),mouth=useRef(0),speechClock=useRef(new RemoteSpeechClock());
 const drag=useRef(null),loadedIdentity=useRef(null),orbit=useRef(null),hit=useRef({last:null,time:0}),through=useRef(false);
 const replyBody=useRef(null),replyPinned=useRef(true),replyId=useRef(null);
 const [state,setState]=useState({character:{},preferences:{}}),[status,setStatus]=useState({phase:'idle'});
 const [text,setText]=useState(''),[error,setError]=useState(null),[view,setView]=useState({zoom:1,yaw:0});
 const api=window.companion,call=(action,payload)=>api?.call(action,payload)||Promise.resolve(false);
 through.current=state.preferences?.mouseThrough===true;
 const reply=state.preferences?.showBubbles===false||!state.reply?'':state.preferences?.bubbleLanguage==='ja'?(state.reply.ja||(state.reply.zh?`中文：${state.reply.zh}`:'')):state.preferences?.bubbleLanguage==='both'?[state.reply.zh,state.reply.ja].filter(Boolean).join('\n'):(state.reply.zh||state.reply.ja||'');
 const reducedMotion=useReducedMotion(state.preferences?.animation===false);

 useEffect(()=>{renderer.current?.setView(view)},[view,state.character?.modelId]);
 useEffect(()=>{const element=host.current;if(!element)return;const wheel=event=>{event.preventDefault();if(renderer.current?.walkingMotion||renderer.current?.walkExitHeld)return;setView(current=>({...current,zoom:Math.max(1,Math.min(2.2,current.zoom-event.deltaY*.0015))}))};element.addEventListener('wheel',wheel,{passive:false});return()=>element.removeEventListener('wheel',wheel)},[]);
 useEffect(()=>{const off=api?.onState(setState),actionOff=api?.onAction?.(value=>{if(value.name==='chat-error')setError({kind:value.kind||'chat',message:friendlyError(value.message)});else if(value.name==='capability-recovered')setError(current=>current?.kind===value.kind?null:current)}),mouthOff=api?.onMouth?.(value=>{mouth.current=value}),speechOff=api?.onSpeech?.(value=>{if(value)speechClock.current.receive(value);else{speechClock.current.clear();renderer.current?.resetSpeechClock?.()}});call('ready');return()=>{off?.();actionOff?.();mouthOff?.();speechOff?.();speechClock.current.clear()}},[]);
 useEffect(()=>{try{renderer.current=new GlbAvatarRenderer(host.current,{renderEnvironment:false,catalog:catalog.models,api:{characterModelData:id=>call('model-data',id)},audioPlayer:{getLevel:()=>speechClock.current.snapshot?speechClock.current.getLevel():mouth.current,getSnapshot:()=>speechClock.current.getSnapshot()},onStatus:setStatus});}catch(error){setStatus({phase:'error',message:error.message})}return()=>renderer.current?.dispose()},[]);
 useEffect(()=>{let active=true;if(loadedIdentity.current!==state.character?.id){renderer.current?.clear();setText('');setError(null);mouth.current=0;speechClock.current.clear();loadedIdentity.current=state.character?.id}renderer.current?.cancelLoad();if(!state.character?.modelId){renderer.current?.clear();return;}call('model-catalog').then(next=>{if(!active)return;if(next?.models)renderer.current.catalog=next.models;renderer.current?.load(state.character.modelId,{animate:true})}).catch(error=>{if(active)setStatus({phase:'error',message:error.message})});return()=>{active=false;renderer.current?.cancelLoad()}},[state.character?.id,state.character?.modelId]);
 useEffect(()=>{const value=state.character?.presentation||{};renderer.current?.setEnvironment({id:value.scene,timeOfDay:value.timeOfDay});renderer.current?.setRenderStyle(value.renderStyle)},[state.character?.presentation?.scene,state.character?.presentation?.timeOfDay,state.character?.presentation?.renderStyle]);
 useEffect(()=>{renderer.current?.setReducedMotion(reducedMotion);renderer.current?.setActivity(state.chatBusy?'thinking':'idle')},[reducedMotion,state.chatBusy]);
 useEffect(()=>{const stop=()=>{drag.current=null;orbit.current=null;call('drag-end').catch(()=>{})};window.addEventListener('blur',stop);return()=>window.removeEventListener('blur',stop)},[]);
 useLayoutEffect(()=>{if(replyId.current!==state.reply?.id){replyId.current=state.reply?.id;replyPinned.current=true}if(replyPinned.current&&replyBody.current)replyBody.current.scrollTop=replyBody.current.scrollHeight},[reply,state.reply?.id]);

 useEffect(()=>{
  // Electron forwards mouse movement even while clicks pass through. Keep the
  // controls interactive and test the animated model rather than its full canvas.
  function move(event){
   const control=event.target instanceof Element&&event.target.closest('header,.compact-dock,.model-window-status,.model-window-fallback');
   let interactive=!!control||!!drag.current||!!orbit.current;
   if(!interactive&&!through.current){
    const now=performance.now();if(now-hit.current.time<40)return;hit.current.time=now;
    interactive=!!renderer.current?.hitTest(event.clientX,event.clientY);
   }
   if(interactive!==hit.current.last){hit.current.last=interactive;call('hit-test',interactive).catch(()=>{hit.current.last=null})}
  }
  window.addEventListener('mousemove',move);return()=>window.removeEventListener('mousemove',move);
 },[]);
 async function submit(event){event.preventDefault();try{if(state.chatBusy)await call('chat-stop');else if(text.trim()){await call('chat-submit',text);setText('')}}catch(error){setError({kind:'chat',message:friendlyError(error)})}}
 const toggleThrough=()=>call('prefs',{mouseThrough:!through.current}).then(()=>{hit.current.last=null}).catch(error=>setError({kind:'operation',message:friendlyError(error)}));
 return <main className="model-companion" style={{opacity:state.preferences?.opacity||1}} onContextMenu={event=>{event.preventDefault();call('menu')}}>
  <header onPointerDown={event=>{if(event.target.closest('button,.model-reply')||event.button!==0)return;event.currentTarget.setPointerCapture(event.pointerId);drag.current={id:event.pointerId,busy:false};call('drag-start').catch(error=>setError({kind:'operation',message:friendlyError(error)}))}}
   onPointerMove={event=>{const active=drag.current;if(!active||active.id!==event.pointerId||active.busy)return;active.busy=true;call('drag-move').finally(()=>{active.busy=false})}}
   onPointerUp={event=>{if(!drag.current||drag.current.id!==event.pointerId)return;drag.current=null;call('drag-end');if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId)}}
   onPointerCancel={()=>{if(!drag.current)return;drag.current=null;call('drag-cancel')}}>
   <span className="model-name" title={state.character?.name||'人物模型'}>{state.character?.name||'人物模型'}</span>
   {reply&&<div ref={replyBody} className="model-reply" tabIndex={0} role="region" aria-label="角色回复" onScroll={event=>{const el=event.currentTarget;replyPinned.current=el.scrollHeight-el.scrollTop-el.clientHeight<24}}>{reply}</div>}
   <button aria-label="恢复全身正面" disabled={status.phase==='walking'} title="人物位置固定；滚轮缩放，拖动仅旋转；点击复位" onClick={()=>{if(!renderer.current?.walkingMotion&&!renderer.current?.walkExitHeld)setView({zoom:1,yaw:0})}}>↺</button>
   <button aria-label="人物设置" onClick={()=>call('settings')}>⚙</button>
   <button aria-label={through.current?'关闭人物鼠标穿透':'开启人物鼠标穿透'} aria-pressed={through.current} title={through.current?'人物穿透已开启':'人物可交互'} onClick={toggleThrough}>◎</button>
  </header>
  <div ref={host} className="model-window-canvas" tabIndex={0} role="group" aria-label="模型预览，左右键旋转，上下键缩放" onKeyDown={event=>{if(renderer.current?.walkingMotion||renderer.current?.walkExitHeld)return;if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(event.key))return;event.preventDefault();setView(current=>event.key==='Home'?{zoom:1,yaw:0}:{zoom:Math.max(1,Math.min(2.2,current.zoom+(event.key==='ArrowUp'?.1:event.key==='ArrowDown'?-.1:0))),yaw:((current.yaw+(event.key==='ArrowLeft'?-15:event.key==='ArrowRight'?15:0)+180)%360+360)%360-180})}} hidden={!state.character?.modelId}
   onPointerDown={event=>{if(through.current||event.button!==0||renderer.current?.walkingMotion||renderer.current?.walkExitHeld)return;event.currentTarget.setPointerCapture(event.pointerId);orbit.current={id:event.pointerId,x:event.clientX,yaw:view.yaw}}}
   onPointerMove={event=>{if(renderer.current?.walkingMotion||renderer.current?.walkExitHeld){orbit.current=null;return;}const active=orbit.current;if(active?.id===event.pointerId)setView(current=>({...current,yaw:((active.yaw+(event.clientX-active.x)*.4+180)%360+360)%360-180}))}} onPointerUp={()=>{orbit.current=null}} onPointerCancel={()=>{orbit.current=null}}/>
  {(!state.character?.modelId||status.phase==='error'&&!renderer.current?.entry)&&<div className="model-window-fallback"><img src="./yukino-q.png" alt="Q版角色"/><button onClick={()=>call('settings')}>选择人物模型</button></div>}
  {(status.phase==='loading'||status.phase==='error'||status.phase==='walking')&&<p className="model-window-status" role="status">{status.message}</p>}
  <CompactDock value={text} onChange={setText} busy={state.chatBusy} visualActive={state.visionActive} onSubmit={submit} label={`与${state.character?.name||'角色'}对话`} onVisual={()=>call(state.visionActive?'vision-stop':'vision-open').catch(error=>setError({kind:'vision',message:friendlyError(error)}))}/>
  {error&&<p className="model-window-status" role="alert">{error.message}</p>}
 </main>;
}
createRoot(document.getElementById('root')).render(<ModelWindow/>);
