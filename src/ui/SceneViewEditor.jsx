import React,{useCallback,useEffect,useRef,useState} from 'react';
import {DEFAULT_SCENE_VIEW} from './scene-view.mjs';
import {saveScenePreview} from './scene-preview-store.mjs';
import SceneBackdrop from './SceneBackdrop.jsx';

const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
const round=value=>Math.round(value);
const normalizeAngle=value=>((value+180)%360+360)%360-180;
const normalizeView=value=>({...DEFAULT_SCENE_VIEW,...value});
const VIEW_KEYS=['horizontal','vertical','azimuth','elevation','scale'];

// The five former sliders are now one direct manipulation surface. Dragging
// orbits, Shift+drag shifts the frame, and the wheel zooms. Every settled edit
// writes the exact rendered frame back as this scene's thumbnail.
export default function SceneViewEditor({sceneId:id,view,onView,importedScenes,timeOfDay,weather,reducedMotion,sceneToon=false}){
 const host=useRef(null),rendererRef=useRef(null);
 const gestureRef=useRef(null),commitTimer=useRef(null),captureTimer=useRef(null),moved=useRef(false);
 const [draft,setDraft]=useState(null);
 const active=draft||normalizeView(view);
 const activeRef=useRef(active),idRef=useRef(id),onViewRef=useRef(onView);
 activeRef.current=active;idRef.current=id;onViewRef.current=onView;
 const signature=id+':'+VIEW_KEYS.map(key=>view?.[key]??DEFAULT_SCENE_VIEW[key]).join(',');

 useEffect(()=>{setDraft(null)},[signature]);
 const capture=useCallback(()=>{
  const data=rendererRef.current?.snapshot?.({width:640,quality:.74});
  if(data)saveScenePreview(idRef.current,data);
 },[]);
 const scheduleCapture=useCallback((delay=220)=>{
  clearTimeout(captureTimer.current);
  captureTimer.current=setTimeout(capture,delay);
 },[capture]);
 const persist=useCallback((next,delay=0)=>{
  const apply=()=>onViewRef.current?.(idRef.current,next);
  if(delay>0){clearTimeout(commitTimer.current);commitTimer.current=setTimeout(apply,delay);}
  else{clearTimeout(commitTimer.current);apply();}
 },[ ]);
 useEffect(()=>()=>{clearTimeout(commitTimer.current);clearTimeout(captureTimer.current)},[]);

 function pointerDown(event){
  if(event.button!==0||gestureRef.current)return;
  event.currentTarget.focus?.({preventScroll:true});
  event.currentTarget.setPointerCapture?.(event.pointerId);
  gestureRef.current={pointerId:event.pointerId,x:event.clientX,y:event.clientY,base:activeRef.current,shift:event.shiftKey,width:event.currentTarget.clientWidth||1,height:event.currentTarget.clientHeight||1};
  moved.current=false;
  event.preventDefault();
 }
 function pointerMove(event){
  const gesture=gestureRef.current;
  if(!gesture||gesture.pointerId!==event.pointerId)return;
  const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;
  if(!moved.current&&Math.hypot(dx,dy)<3)return;
  moved.current=true;
  const next={...gesture.base};
  if(event.shiftKey||gesture.shift){
   // Direct manipulation: the point under the cursor follows the pointer.
   next.horizontal=round(clamp(gesture.base.horizontal+dx/gesture.width*80,-40,40));
   next.vertical=round(clamp(gesture.base.vertical+dy/gesture.height*70,-35,35));
  }else{
   // Drag the scene, not the orbit rig: moving the pointer left rotates the
   // miniature left. The camera therefore orbits in the opposite direction.
   next.azimuth=round(normalizeAngle(gesture.base.azimuth-dx*.38));
   next.elevation=round(clamp(gesture.base.elevation+dy*.30,-60,60));
  }
  setDraft(next);
  event.preventDefault();
 }
 function releasePointer(event){
  const gesture=gestureRef.current;
  if(!gesture||gesture.pointerId!==event.pointerId)return;
  gestureRef.current=null;
  if(event.currentTarget.hasPointerCapture?.(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
  if(!moved.current)return;
  moved.current=false;
  const next=normalizeView(activeRef.current);
  setDraft(null);
  persist(next);
  scheduleCapture(260);
 }
 function keyDown(event){
  const base=normalizeView(activeRef.current);
  let next=null;
  if(event.key==='ArrowLeft')next={...base,azimuth:round(normalizeAngle(base.azimuth-6))};
  else if(event.key==='ArrowRight')next={...base,azimuth:round(normalizeAngle(base.azimuth+6))};
  else if(event.key==='ArrowUp')next={...base,elevation:round(clamp(base.elevation+4,-60,60))};
  else if(event.key==='ArrowDown')next={...base,elevation:round(clamp(base.elevation-4,-60,60))};
  else if(event.key==='+'||event.key==='=')next={...base,scale:round(clamp(base.scale+8,50,200))};
  else if(event.key==='-')next={...base,scale:round(clamp(base.scale-8,50,200))};
  else if(event.key==='Home'){event.preventDefault();setDraft(null);onViewRef.current?.(idRef.current,null);scheduleCapture(320);return;}
  if(!next)return;
  event.preventDefault();
  setDraft(next);
  persist(next,130);
  scheduleCapture(480);
 }

 useEffect(()=>{
  const element=host.current;
  if(!element)return;
  const wheel=event=>{
   event.preventDefault();
   const base=normalizeView(activeRef.current);
   const next={...base,scale:round(clamp(base.scale-event.deltaY*.06,50,200))};
   setDraft(next);
   persist(next,170);
   scheduleCapture(520);
  };
  element.addEventListener('wheel',wheel,{passive:false});
  return()=>element.removeEventListener('wheel',wheel);
 },[persist,scheduleCapture]);

 return <div
  ref={host}
  className="scene-composition-preview scene-view-editor"
  tabIndex={0}
  role="group"
  aria-label="场景构图预览。拖动旋转，滚轮或加减号缩放，Shift 拖动平移，方向键调整视角，Home 还原默认构图。松手后自动保存预览图。"
  onPointerDown={pointerDown}
  onPointerMove={pointerMove}
  onPointerUp={releasePointer}
  onPointerCancel={releasePointer}
  onKeyDown={keyDown}
 >
  <SceneBackdrop preview scene={id} view={active} importedScenes={importedScenes} timeOfDay={timeOfDay} weather={weather} enabled reducedMotion={reducedMotion} motionEnabled={false} sceneToon={sceneToon} rendererRef={rendererRef}/>
  <p className="scene-view-editor-hint">拖动旋转 · 滚轮缩放 · Shift＋拖动平移 · 松手自动保存预览</p>
 </div>;
}
