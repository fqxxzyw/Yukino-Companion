import React,{useEffect,useId,useRef,useState} from 'react';
import {Map,SlidersHorizontal,X} from 'lucide-react';
import {SCENES,SCENE_GROUPS,sceneId} from './scene-catalog.mjs';
export default function SceneQuickMenu({scene,onScene,onOverview,onReturn,onClose,onMotion,motionEnabled=true,overviewEnabled=true}){
 const [open,setOpen]=useState(false),host=useRef(null),trigger=useRef(null),holding=useRef(false),callbacks=useRef({onOverview,onReturn}),popoverId=useId(),selected=sceneId(scene);callbacks.current={onOverview,onReturn};
 function release(){if(!holding.current)return;holding.current=false;callbacks.current.onReturn?.()}
 function overview(){if(holding.current||!overviewEnabled)return;holding.current=true;callbacks.current.onOverview?.()}
 function close(restoreFocus=false){release();setOpen(false);if(restoreFocus)trigger.current?.focus({preventScroll:true})}
 useEffect(()=>{if(!open)return;const dismiss=event=>{if(event.type==='keydown'){if(event.key!=='Escape'||event.defaultPrevented)return;event.preventDefault();event.stopPropagation();close(true)}else if(!host.current?.contains(event.target))close()};document.addEventListener('pointerdown',dismiss);document.addEventListener('keydown',dismiss);return()=>{document.removeEventListener('pointerdown',dismiss);document.removeEventListener('keydown',dismiss)}},[open]);
 useEffect(()=>{const cancel=()=>release();window.addEventListener('blur',cancel);document.addEventListener('visibilitychange',cancel);return()=>{window.removeEventListener('blur',cancel);document.removeEventListener('visibilitychange',cancel);release()}},[]);
 useEffect(()=>{release()},[scene,overviewEnabled]);
 function key(event){if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();close(true)}}
 return <div className="scene-quick-menu" ref={host} onKeyDown={key}>
  <button ref={trigger} type="button" className="scene-menu-trigger" aria-label="场景小菜单" aria-expanded={open} aria-controls={open?popoverId:undefined} onClick={()=>open?close():setOpen(true)}><SlidersHorizontal size={15}/><span>{SCENES[selected].label}</span></button>
  {onClose&&<button type="button" className="scene-menu-trigger scene-menu-close" aria-label="返回对话界面" title="返回对话界面" onClick={()=>{release();onClose()}}><X size={16}/></button>}
  {open&&<section id={popoverId} className="scene-menu-popover" aria-label="场景与总览"><header><strong>场景</strong><small>模型为可随时替换的定位草稿</small></header>
   {SCENE_GROUPS.map(group=><div key={group.kind} className="scene-menu-group" role="group" aria-label={group.label+'场景'}><strong>{group.label}</strong><div>{Object.entries(SCENES).filter(([,item])=>item.kind===group.kind).map(([id,item])=><button type="button" key={id} aria-pressed={selected===id} onClick={()=>{release();onScene?.(id);setOpen(false);trigger.current?.focus({preventScroll:true})}}>{item.label}</button>)}</div></div>)}
   <button type="button" className="scene-overview-hold" disabled={!overviewEnabled} onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();event.currentTarget.focus({preventScroll:true});event.currentTarget.setPointerCapture(event.pointerId);overview()}} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release} onKeyDown={event=>{if(event.key===' '||event.key==='Enter'){event.preventDefault();if(!event.repeat)overview()}}} onKeyUp={event=>{if(event.key===' '||event.key==='Enter'){event.preventDefault();release()}}} onBlur={release}><Map size={15}/>按住查看上帝视角</button>
   <p>{overviewEnabled?'Ctrl＋滚轮缩放全图，Ctrl＋拖动水平环视。松开 Ctrl 缓慢回位；普通滚轮仍用于页面滚动。':'选择场景后启用三维背景，可按住此按钮查看总览。'}</p>
   <label><span>缓慢场景动态</span><input type="checkbox" role="switch" checked={motionEnabled} onChange={event=>onMotion?.(event.target.checked)}/></label>
  </section>}
 </div>;
}
