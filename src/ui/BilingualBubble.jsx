import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {splitLocalReply} from '../companion/reply-segments.mjs';
export function LanguageSwitch({value,onChange,label='气泡显示语言',compact=false}) {
  return <div className={'segmented language-switch'+(compact?' compact':'')} role="group" aria-label={label}>{[['zh','中文'],['ja','日本語'],['both','双语']].map(([v,t])=><button key={v} type="button" aria-pressed={value===v} className={value===v?'active':''} onClick={()=>onChange(v)}>{t}</button>)}</div>;
}
export function messageCopy(message,language) {const zh=message.zh||message.content||'',ja=message.ja||'';return language==='both'&&zh&&ja?`${zh}\n\n${ja}`:language==='ja'&&ja?ja:zh||ja;}
export default function BilingualBubble({message,language,animate=false,reducedMotion=false,onReveal,onEntranceStart}) {
 const zh=message.zh||message.content||'',ja=message.ja||'',waiting=message.status==='streaming';
 const groups=[];
 if((language!=='ja'||!ja)&&zh)groups.push({parts:splitLocalReply(zh),lang:'zh-CN',label:'中文'});
 if((language!=='zh'||!zh)&&ja)groups.push({parts:splitLocalReply(ja),lang:'ja',label:'日本語'});
 const total=groups.reduce((sum,group)=>sum+group.parts.length,0);
 // Only replies that arrive in this view are staged; loading an existing chat
 // shows its history immediately. The source message remains untouched.
 const live=useRef(animate||waiting);
 const [visible,setVisible]=useState(()=>live.current?0:total);
 const revealCallback=useRef(onReveal);revealCallback.current=onReveal;
 useEffect(()=>{if(live.current)onEntranceStart?.();},[]);
 const pending=visible<total;
 useEffect(()=>{
  if(!live.current||!pending)return;
  const timer=setTimeout(()=>setVisible(count=>count+1),visible===0?0:420);
  return()=>clearTimeout(timer);
 },[visible,pending]);
 useLayoutEffect(()=>{if(live.current&&visible>0)revealCallback.current?.();},[visible]);
 if(message.role!=='assistant')return <div className="bubble">{typeof message.image==='string'&&message.image.length<2800000&&/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(message.image)&&<img className="blackboard-message-image" src={message.image} alt="教室黑板上的白色手绘"/>}{message.content}</div>;
 if(!zh&&!ja)return <div className="bubble thinking">{waiting?'正在思考…':message.status==='stopped'?'已停止':'没有收到回复'}</div>;
 let offset=0;
 return <div className="local-reply-parts">
  {groups.map(group=>{const start=offset;offset+=group.parts.length;const shown=live.current?Math.max(0,visible-start):group.parts.length;if(!shown)return null;return <section className="local-reply-language" lang={group.lang} key={group.lang}>
   {language==='both'&&<span className="language-label">{group.label}</span>}
   {group.parts.slice(0,shown).map((part,index)=><div className={'bubble local-reply-segment'+(live.current&&!reducedMotion?' is-entering':'')} key={index}>{part}</div>)}
  </section>})}
  {language==='ja'&&!ja&&<span className="translation-note">{waiting?'中文已返回，日文准备中':'尚无日文版本 · 以上显示中文原文'}</span>}
 </div>;
}
