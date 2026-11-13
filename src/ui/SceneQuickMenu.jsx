import React,{useEffect,useId,useRef,useState} from 'react';
import {Map,SlidersHorizontal,X} from 'lucide-react';
import {SCENE_GROUPS,sceneEntries,sceneId,scenePreset} from './scene-catalog.mjs';
import SceneThumbnail from './SceneThumbnail.jsx';
export default function SceneQuickMenu({scene,importedScenes=[],onScene,onOverview,onReturn,onPhoto,onReset,onClose,onMotion,motionEnabled=true,overviewEnabled=true}){
 const [open,setOpen]=useState(false),host=useRef(null),trigger=useRef(null),holding=useRef(false),callbacks=useRef({onOverview,onReturn}),popoverId=useId(),selected=sceneId(scene);callbacks.current={onOverview,onReturn};
 function release(){if(!holding.current)return;holding.current=false;callbacks.current.onReturn?.()}
 function overview(){if(holding.current||!overviewEnabled)return;holding.current=true;callbacks.current.onOverview?.()}
 function close(restoreFocus=false){release();setOpen(false);if(restoreFocus)trigger.current?.focus({preventScroll:true})}
 useEffect(()=>{if(!open)return;const dismiss=event=>{if(event.type==='keydown'){if(event.key!=='Escape'||event.defaultPrevented)return;event.preventDefault();event.stopPropagation();close(true)}else if(!host.current?.contains(event.target))close()};document.addEventListener('pointerdown',dismiss);document.addEventListener('keydown',dismiss);return()=>{document.removeEventListener('pointerdown',dismiss);document.removeEventListener('keydown',dismiss)}},[open]);
 useEffect(()=>{const cancel=()=>release();window.addEventListener('blur',cancel);document.addEventListener('visibilitychange',cancel);return()=>{window.removeEventListener('blur',cancel);document.removeEventListener('visibilitychange',cancel);release()}},[]);
 useEffect(()=>{release()},[scene,overviewEnabled]);
 function key(event){if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();close(true)}}
 return <div className="scene-quick-menu" ref={host} onKeyDown={key}>
  <button ref={trigger} type="button" className="scene-menu-trigger" aria-label="场景小菜单" aria-expanded={open} aria-controls={open?popoverId:undefined} onClick={()=>open?close():setOpen(true)}><SlidersHorizontal size={15}/><span>{scenePreset(selected,importedScenes).label}</span></button>
  {onClose&&<button type="button" className="scene-menu-trigger scene-menu-close" aria-label="返回对话界面" title="返回对话界面" onClick={()=>{release();onClose()}}><X size={16}/></button>}
  {onPhoto&&<button type="button" className="scene-menu-trigger" onClick={()=>{release();close();onPhoto()}}>近景细看</button>}
  {onReset&&<button type="button" className="scene-menu-trigger" onClick={()=>{release();close();onReset()}}>完整微缩景观</button>}
  {open&&<section id={popoverId} className="scene-menu-popover" aria-label="场景与总览"><header><strong>场景</strong><small>微缩景观 · 随时间与天气变化</small></header>
   {SCENE_GROUPS.map(group=>{const entries=sceneEntries(importedScenes).filter(([,item])=>item.kind===group.kind);return entries.length>0&&<div key={group.kind} className="scene-menu-group" role="group" aria-label={group.label+'场景'}><strong>{group.label}</strong><div>{entries.map(([id,item])=><button type="button" key={id} aria-pressed={selected===id} onClick={()=>{release();onScene?.(id);setOpen(false);trigger.current?.focus({preventScroll:true})}}><SceneThumbnail scene={item}/><span>{item.label}</span></button>)}</div></div>})}
   <button type="button" className="scene-overview-hold" disabled={!overviewEnabled} onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();event.currentTarget.focus({preventScroll:true});event.currentTarget.setPointerCapture(event.pointerId);overview()}} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release} onKeyDown={event=>{if(event.key===' '||event.key==='Enter'){event.preventDefault();if(!event.repeat)overview()}}} onKeyUp={event=>{if(event.key===' '||event.key==='Enter'){event.preventDefault();release()}}} onBlur={release}><Map size={15}/>按住查看上帝视角</button>
   <p>{overviewEnabled?'Ctrl＋滚轮缩放全图，Ctrl＋拖动水平环视。松开 Ctrl 缓慢回位；普通滚轮仍用于页面滚动。':'选择场景后启用三维背景，可按住此按钮查看总览。'}</p>
   <label><span>缓慢场景动态</span><input className="scene-switch" type="checkbox" role="switch" checked={motionEnabled} onChange={event=>onMotion?.(event.target.checked)}/></label>
  </section>}
 </div>;
}
