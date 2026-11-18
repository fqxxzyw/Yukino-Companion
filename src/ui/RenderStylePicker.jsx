import React from 'react';

// Character materials and scene styling are independent controls. "环境光"
// only follows the scene's lighting/time; it never turns character cel on.
const OPTIONS=Object.freeze([
 {value:'natural',label:'原始',title:'原始：保留模型自带材质与明暗',orb:'natural'},
 {value:'toon',label:'动漫',title:'动漫：人物使用赛璐璐分层渲染与黑色轮廓',orb:'toon'},
 {value:'lit',label:'环境光',title:'环境光：只跟随场景光线与时段，不改变人物赛璐璐开关',orb:'lit'},
]);

export default function RenderStylePicker({value='lit',onChange,compact=false}){
 const current=OPTIONS.some(option=>option.value===value)?value:'lit';
 return <div className={'render-style-picker'+(compact?' compact':'')} role="group" aria-label="人物渲染风格">
  {OPTIONS.map(option=>{
   const selected=option.value===current;
   return <button type="button" key={option.value} className={'render-style-choice'+(selected?' selected':'')} aria-pressed={selected} aria-label={option.title} title={option.title} onClick={()=>onChange?.(option.value)}>
    <span className={'render-style-orb '+option.orb} aria-hidden="true"/>
    <span>{option.label}</span>
   </button>;
  })}
 </div>;
}
