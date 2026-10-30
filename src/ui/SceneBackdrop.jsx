import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {SCENES,revealOrigin} from './avatar-presentation.mjs';
export default function SceneBackdrop({scene,timeOfDay,enabled,reducedMotion}){
 const currentScene=useRef({scene,timeOfDay});currentScene.current={scene,timeOfDay};
 const canvasHost=useRef(null),renderer=useRef(null),layer=useRef(null),[previous,setPrevious]=useState(null),previousRef=useRef(null);
 useEffect(()=>{let cancelled=false,instance=null;if(!enabled)return;import('./environment-backdrop.mjs').then(({EnvironmentBackdrop})=>{if(cancelled)return;try{instance=new EnvironmentBackdrop(canvasHost.current);renderer.current=instance;instance.update(currentScene.current.scene,currentScene.current.timeOfDay)}catch{canvasHost.current?.setAttribute('data-fallback','true')}});return()=>{cancelled=true;instance?.dispose();renderer.current=null}},[enabled]);
 useEffect(()=>{renderer.current?.update(scene,timeOfDay)},[scene,timeOfDay]);
 useLayoutEffect(()=>{
  const element=layer.current;if(!element)return;const active=enabled?(SCENES[scene]?scene:'studio'):null;
  setPrevious(previousRef.current);const old=previousRef.current;previousRef.current=active;
  const root=element.closest('.app'),model=root?.querySelector('.character-panel');
  if(!root)return;
  const {x,y}=revealOrigin(model?.getBoundingClientRect(),root.getBoundingClientRect());
  const reduce=reducedMotion||window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduce||!enabled||old===active||typeof element.animate!=='function'){setPrevious(null);return;}
  let current=true;const animation=element.animate([{clipPath:`circle(0% at ${x}% ${y}%)`},{clipPath:`circle(150% at ${x}% ${y}%)`}],{duration:700,easing:'cubic-bezier(.2,.75,.2,1)',fill:'both'});
  animation.finished.then(()=>{if(current){setPrevious(null);animation.cancel()}}).catch(()=>{});
  return()=>{current=false;animation.cancel()};
 },[scene,enabled,reducedMotion]);
 return <div className="scene-ui-backdrop" aria-hidden="true"><div style={{background:previous?SCENES[previous]?.background:'transparent'}}/><div ref={layer} style={{background:enabled?(SCENES[scene]||SCENES.studio).background:'transparent'}}><div className="environment-backdrop-canvas" ref={canvasHost}/></div></div>;
}
