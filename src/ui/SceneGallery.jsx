import React,{useEffect,useLayoutEffect,useRef} from 'react';
import {scenePreset} from './scene-catalog.mjs';
import SceneQuickMenu from './SceneQuickMenu.jsx';

// The app is hidden/inert in collector mode; a compact scene menu remains
// keyboard-reachable without trapping Tab or involving the fullscreen API.
export default function SceneGallery({scene,timeOfDay,weather=null,reducedMotion=false,motionEnabled=true,onMotion,onScene,returnFocus,onClose,onError}){
 const host=useRef(null),canvasHost=useRef(null),renderer=useRef(null),latest=useRef({scene,timeOfDay,weather,motionEnabled,onClose,onError});latest.current={scene,timeOfDay,weather,motionEnabled,onClose,onError};
 useLayoutEffect(()=>{host.current?.focus({preventScroll:true});return()=>{requestAnimationFrame(()=>{if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true})})}},[returnFocus]);
 useEffect(()=>{
  let cancelled=false,instance=null,failed=false;
  const fail=error=>{if(cancelled||failed)return;failed=true;latest.current.onError?.(error)};
  import('./environment-backdrop.mjs').then(({EnvironmentBackdrop})=>{
   if(cancelled)return;
   try{instance=new EnvironmentBackdrop(canvasHost.current,{interactive:true,reducedMotion,onError:fail});renderer.current=instance;instance.setAnimationEnabled(latest.current.motionEnabled);instance.update(latest.current.scene,latest.current.timeOfDay,latest.current.weather)}
   catch(error){instance?.dispose();renderer.current=null;fail(error)}
  }).catch(fail);
  return()=>{cancelled=true;instance?.dispose();renderer.current=null};
 },[reducedMotion]);
 useEffect(()=>{try{renderer.current?.update(scene,timeOfDay,weather)}catch(error){latest.current.onError?.(error)}},[scene,timeOfDay,weather]);
 useEffect(()=>{renderer.current?.setAnimationEnabled(motionEnabled)},[motionEnabled]);
 function key(event){
  if(event.defaultPrevented)return;
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();latest.current.onClose?.()}
  else if(!event.target.closest('.scene-quick-menu')&&renderer.current?.key(event.key)){event.preventDefault();event.stopPropagation()}
 }
 return <div ref={host} className="scene-gallery" tabIndex={0} role="region" aria-label={`${scenePreset(scene).label}，三维微缩景观。拖拽旋转，滚轮或双指缩放，方向键调整视角，加减号缩放，Home 复位，Tab 前往场景菜单，Escape 返回。`} style={{background:scenePreset(scene).background}} onKeyDown={key}>
  <div ref={canvasHost} className="scene-gallery-stage"/>
  <SceneQuickMenu scene={scene} onScene={onScene} motionEnabled={motionEnabled} onMotion={onMotion} onOverview={()=>renderer.current?.showOverview()} onReturn={()=>renderer.current?.releaseOverview()} onClose={onClose}/>
 </div>;
}
