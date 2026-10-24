import React,{useEffect,useRef,useState} from 'react';
import {loadSprite} from '../public/avatars/yukino-sprite/player.js';
export default function SpriteCompanion({reduced=false,thinking=false}){
 const image=useRef(null),player=useRef(null);const [error,setError]=useState(''),[loaded,setLoaded]=useState(false),[state,setState]=useState('idle'),[paused,setPaused]=useState(false);
 const reducedRef=useRef(reduced);reducedRef.current=reduced;
 useEffect(()=>{
  let dead=false;const media=matchMedia('(prefers-reduced-motion: reduce)');
  const sync=()=>player.current?.setReduced(reducedRef.current||media.matches);
  loadSprite(image.current,new URL('avatars/yukino-sprite/',document.baseURI),{onState:setState}).then(p=>{
   if(dead){p.dispose();return;}player.current=p;sync();setLoaded(true);
  }).catch(e=>{if(!dead)setError(e.message);});
  media.addEventListener('change',sync);
  return()=>{dead=true;player.current?.dispose();player.current=null;media.removeEventListener('change',sync);};
 },[]);
 useEffect(()=>{player.current?.setReduced(reduced||matchMedia('(prefers-reduced-motion: reduce)').matches);},[reduced]);
 function act(s){if(!loaded||paused)return;player.current.setState(s);}
 return <div className="sprite-companion">
  <button className="sprite-character" title="点击雪乃打招呼" aria-label="点击雪乃打招呼" disabled={!loaded||paused} onClick={()=>act('greet')}><img ref={image} alt="雪乃全身动漫桌宠" hidden={!loaded}/></button>
  <span className="sprite-status" role="status">{error||(!loaded?'正在载入形象…':thinking?'正在思考…':state==='greet'?'你好。':state==='talk'?'说话动作演示 · 无声音':'陪你待一会儿。')}</span>
  <div className="sprite-controls"><button disabled={!loaded||paused} onClick={()=>act(state==='talk'?'idle':'talk')}>{state==='talk'?'结束演示':'说话演示'}</button><button disabled={!loaded} onClick={()=>{player.current.setPaused(!paused);setPaused(!paused);}}>{paused?'继续':'暂停'}</button></div>
 </div>;
}
