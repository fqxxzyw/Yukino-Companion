import React from 'react';

// The three material modes are deliberately visual rather than a select menu.
// "随环境" follows the scene: when the environment is cel-shaded the character
// is cel-shaded too; a lit environment keeps the normal lit materials.
const OPTIONS=Object.freeze([
 {value:'natural',label:'原始',title:'原始：保留模型自带材质与明暗',orb:'natural'},
 {value:'toon',label:'动漫',title:'动漫：人物使用赛璐璐分层渲染',orb:'toon'},
 {value:'lit',label:'随环境',title:'随环境渲染：跟随场景光线；场景为赛璐璐时人物也使用赛璐璐',orb:'lit'},
]);

export default function RenderStylePicker({value='lit',sceneToon=false,onChange,compact=false}){
 const current=OPTIONS.some(option=>option.value===value)?value:'lit';
 return <div className={'render-style-picker'+(compact?' compact':'')} role="group" aria-label="人物渲染风格">
  {OPTIONS.map(option=>{
   const selected=option.value===current;
   const followsToon=option.value==='lit'&&sceneToon;
   return <button type="button" key={option.value} className={'render-style-choice'+(selected?' selected':'')+(followsToon?' follows-toon':'')} aria-pressed={selected} aria-label={option.title} title={option.title} onClick={()=>onChange?.(option.value)}>
    <span className={'render-style-orb '+option.orb} aria-hidden="true"/>
    <span>{option.label}</span>
   </button>;
  })}
 </div>;
}
