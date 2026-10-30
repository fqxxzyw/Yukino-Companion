import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {SCENES,revealOrigin,presentationConfig} from './avatar-presentation.mjs';
import {bundledWallpaper} from './bundled-wallpapers.mjs';
const sceneBackground=scene=>(SCENES[scene]||SCENES.studio).background;
const styleFor=entry=>({background:entry?.url?'var(--bg)':entry?.scene?sceneBackground(entry.scene):'transparent'});
function WallpaperImage({entry,opacity}){return entry?.url?<div className="wallpaper-image-layer" style={{position:'absolute',inset:0,backgroundImage:`url("${entry.url}")`,backgroundSize:'cover',backgroundPosition:'center',opacity}}/>:null;}
export default function SceneBackdrop({scene,timeOfDay,enabled,reducedMotion,wallpaper,selectionRevision=0,onCurrentWallpaper}){
 const settings=presentationConfig({wallpaper}).wallpaper,ids=settings.items.map(item=>item.id),idKey=ids.join(','),wallpaperMode=settings.enabled&&ids.length>0;
 const [index,setIndex]=useState(0),[current,setCurrent]=useState({key:null,scene:null}),[previous,setPrevious]=useState(null),cache=useRef(new Map()),previousRef=useRef(null);
 const currentScene=useRef({scene,timeOfDay});currentScene.current={scene,timeOfDay};
 const canvasHost=useRef(null),renderer=useRef(null),layer=useRef(null);
 useEffect(()=>{setIndex(0)},[idKey,selectionRevision]);
 useEffect(()=>{if(!wallpaperMode||!settings.rotation||ids.length<2)return;const timer=setInterval(()=>setIndex(value=>(value+1)%ids.length),settings.intervalSeconds*1000);return()=>clearInterval(timer)},[wallpaperMode,settings.rotation,settings.intervalSeconds,idKey,selectionRevision]);
 const selected=ids[index%Math.max(ids.length,1)];
 useEffect(()=>{let cancelled=false;if(!wallpaperMode){setCurrent({key:enabled?`scene:${scene}`:null,scene:enabled?scene:null});return;}const builtin=bundledWallpaper(selected);if(builtin){setCurrent({key:`wallpaper:${selected}`,url:builtin.url});return;}if(!selected||!window.desktop?.wallpaperRead)return;
  const cached=cache.current.get(selected);if(cached){setCurrent({key:`wallpaper:${selected}`,url:cached});return;}
  window.desktop.wallpaperRead(selected).then(({data,mime})=>{if(cancelled)return;const url=URL.createObjectURL(new Blob([data],{type:mime}));cache.current.set(selected,url);setCurrent({key:`wallpaper:${selected}`,url});}).catch(()=>{if(!cancelled)setCurrent({key:enabled?`scene:${scene}`:null,scene:enabled?scene:null})});return()=>{cancelled=true};
 },[wallpaperMode,selected,enabled,scene]);
 useEffect(()=>()=>{for(const url of cache.current.values())URL.revokeObjectURL(url);cache.current.clear()},[]);
 useEffect(()=>{onCurrentWallpaper?.(wallpaperMode&&current.key?.startsWith('wallpaper:')?current.key.slice('wallpaper:'.length):null)},[wallpaperMode,current.key,onCurrentWallpaper]);
 const sceneEnabled=Boolean(current.scene);
 useEffect(()=>{let cancelled=false,instance=null;if(!sceneEnabled)return;import('./environment-backdrop.mjs').then(({EnvironmentBackdrop})=>{if(cancelled)return;try{instance=new EnvironmentBackdrop(canvasHost.current);renderer.current=instance;instance.update(currentScene.current.scene,currentScene.current.timeOfDay)}catch{canvasHost.current?.setAttribute('data-fallback','true')}});return()=>{cancelled=true;instance?.dispose();renderer.current=null}},[sceneEnabled]);
 useEffect(()=>{renderer.current?.update(scene,timeOfDay)},[scene,timeOfDay]);
 useLayoutEffect(()=>{
  const element=layer.current;if(!element)return;const old=previousRef.current;previousRef.current=current;setPrevious(old);
  const root=element.closest('.app'),model=root?.querySelector('.character-panel');if(!root)return;
  const {x,y}=revealOrigin(model?.getBoundingClientRect(),root.getBoundingClientRect());
  const reduce=reducedMotion||window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduce||!current.key||old?.key===current.key||typeof element.animate!=='function'){setPrevious(null);return;}
  let live=true;const animation=element.animate([{clipPath:`circle(0% at ${x}% ${y}%)`},{clipPath:`circle(150% at ${x}% ${y}%)`}],{duration:700,easing:'cubic-bezier(.2,.75,.2,1)',fill:'both'});
  animation.finished.then(()=>{if(live){setPrevious(null);animation.cancel()}}).catch(()=>{});return()=>{live=false;animation.cancel()};
 },[current.key,reducedMotion]);
 // Each transitioning plane first paints the theme base, then its image. This
 // avoids stacking two translucent wallpapers and changing the chosen opacity
 // while the circular scene reveal or slideshow animation runs.
 return <div className="scene-ui-backdrop" aria-hidden="true"><div style={styleFor(previous)}><WallpaperImage entry={previous} opacity={settings.opacity}/></div><div ref={layer} style={styleFor(current)}><WallpaperImage entry={current} opacity={settings.opacity}/><div className="environment-backdrop-canvas" ref={canvasHost} style={{display:sceneEnabled?'':'none'}}/></div></div>;
}
