import React,{useLayoutEffect,useRef,useState} from 'react';
import {SCENES,revealOrigin} from './avatar-presentation.mjs';
export default function SceneBackdrop({scene,enabled,reducedMotion}){
 const layer=useRef(null),[previous,setPrevious]=useState(null),previousRef=useRef(null);
 useLayoutEffect(()=>{
  const element=layer.current;if(!element)return;const active=enabled?(SCENES[scene]?scene:'studio'):null;
  setPrevious(previousRef.current);const old=previousRef.current;previousRef.current=active;
  const root=element.closest('.app'),model=root?.querySelector('.character-panel');
  if(!root)return;
  const {x,y}=revealOrigin(model?.getBoundingClientRect(),root.getBoundingClientRect());
  const reduce=reducedMotion||window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduce||!enabled||old===active||typeof element.animate!=='function'){setPrevious(null);return;}
  const animation=element.animate([{clipPath:`circle(0% at ${x}% ${y}%)`},{clipPath:`circle(150% at ${x}% ${y}%)`}],{duration:700,easing:'cubic-bezier(.2,.75,.2,1)',fill:'both'});
  animation.finished.then(()=>{setPrevious(null);animation.cancel()}).catch(()=>{});
  return()=>animation.cancel();
 },[scene,enabled,reducedMotion]);
 return <div className="scene-ui-backdrop" aria-hidden="true"><div style={{background:previous?SCENES[previous]?.background:'transparent'}}/><div ref={layer} style={{background:enabled?(SCENES[scene]||SCENES.studio).background:'transparent'}}/></div>;
}
