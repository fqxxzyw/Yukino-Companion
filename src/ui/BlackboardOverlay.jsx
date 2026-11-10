import React,{useEffect,useRef} from 'react';
import {BlackboardDrawingController} from './blackboard-drawing.mjs';
import {BlackboardIdle} from './blackboard-idle.mjs';
import './BlackboardOverlay.css';

const controls='button,a,input,textarea,select,summary,[contenteditable="true"],[role="button"],[role="combobox"],[role="listbox"],[role="slider"],.character-panel,.scene-quick-menu,.modal-backdrop,.settings-shell,.settings-page';

// Intentionally no visible affordance. The transparent polygon never steals
// native control input; document capture starts only on a real board raycast.
export default function BlackboardOverlay({rendererRef,enabled,controllerRef,onIdle,scopeKey=''}){
 const own=useRef(null),surface=useRef(null),gesture=useRef(null),idle=useRef(null);
 useEffect(()=>{
  const controller=controllerRef?.current||new BlackboardDrawingController();own.current=controller;if(controllerRef)controllerRef.current=controller;
  idle.current=new BlackboardIdle({controller,onIdle,scopeKey,enabled,visible:!document.hidden});
  return()=>{idle.current?.dispose();controller.dispose();};
 },[controllerRef]);
 useEffect(()=>{idle.current?.update({onIdle,scopeKey,enabled,visible:!document.hidden});},[onIdle,scopeKey,enabled]);
 useEffect(()=>{
  let frame=0,timer=0,closed=false,projection=null;
  function end(event){
   const active=gesture.current;if(!active||event?.pointerId!==undefined&&event.pointerId!==active.id)return;
   gesture.current=null;own.current?.end();idle.current?.end();if(active.element.hasPointerCapture?.(active.id))active.element.releasePointerCapture(active.id);
  }
  const update=()=>{
   if(closed)return;const controller=own.current;
   if(enabled&&!document.hidden&&controller?.attach(rendererRef?.current))projection=controller.project();else{projection=null;controller?.detach();end();}
   if(surface.current)surface.current.style.clipPath=projection?.clipPath||'polygon(0px 0px,0px 0px,0px 0px)';
   if(enabled&&!document.hidden&&projection)frame=requestAnimationFrame(update);else timer=setTimeout(update,200);
  };
  function down(event){
   if(!enabled||!projection||document.hidden||gesture.current||event.defaultPrevented||event.button!==0||event.isPrimary===false||event.ctrlKey||event.metaKey||event.target?.closest?.(controls))return;
   const controller=own.current;if(!controller?.begin(event.clientX,event.clientY))return;
   const element=surface.current;if(!element){controller.end();return;}
   idle.current?.start();gesture.current={id:event.pointerId,element};element.setPointerCapture?.(event.pointerId);event.preventDefault();event.stopPropagation();
  }
  function move(event){
   if(gesture.current?.id!==event.pointerId)return;idle.current?.move();event.preventDefault();event.stopPropagation();
   const samples=event.getCoalescedEvents?.();for(const sample of samples?.length?samples:[event])own.current?.move(sample.clientX,sample.clientY);
  }
  const reset=()=>{end();idle.current?.update({visible:!document.hidden});cancelAnimationFrame(frame);clearTimeout(timer);update();};
  document.addEventListener('pointerdown',down,true);document.addEventListener('pointermove',move,{capture:true,passive:false});document.addEventListener('pointerup',end,true);document.addEventListener('pointercancel',end,true);document.addEventListener('lostpointercapture',end,true);
  document.addEventListener('visibilitychange',reset);window.addEventListener('resize',reset);window.addEventListener('blur',end);update();
  return()=>{
   closed=true;end();clearTimeout(timer);cancelAnimationFrame(frame);own.current?.detach();
   document.removeEventListener('pointerdown',down,true);document.removeEventListener('pointermove',move,true);document.removeEventListener('pointerup',end,true);document.removeEventListener('pointercancel',end,true);document.removeEventListener('lostpointercapture',end,true);
   document.removeEventListener('visibilitychange',reset);window.removeEventListener('resize',reset);window.removeEventListener('blur',end);
  };
 },[enabled,rendererRef]);
 return enabled?<div className="blackboard-overlay" aria-hidden="true"><div ref={surface} className="blackboard-hit-surface"/></div>:null;
}
