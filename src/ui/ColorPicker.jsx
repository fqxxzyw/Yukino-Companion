import React, {useEffect, useId, useState} from 'react';
import {Check, ChevronDown} from 'lucide-react';

function toHsl(hex) {
  const normalized = /^#[\da-f]{6}$/i.test(hex) ? hex : '#477fd1';
  const [r,g,b] = normalized.slice(1).match(/../g).map(value => parseInt(value,16)/255);
  const high = Math.max(r,g,b), low = Math.min(r,g,b), difference = high-low, lightness = (high+low)/2;
  let hue = 0, saturation = 0;
  if (difference) {
    saturation = difference/(1-Math.abs(2*lightness-1));
    hue = (high===r ? ((g-b)/difference)%6 : high===g ? (b-r)/difference+2 : (r-g)/difference+4)*60;
  }
  return [(hue+360)%360,saturation*100,lightness*100];
}
function toHex([hue,saturation,lightness]) {
  const s=saturation/100,l=lightness/100,a=s*Math.min(l,1-l);
  return '#'+[0,8,4].map(offset => {
    const k=(offset+hue/30)%12;
    return Math.round(255*(l-a*Math.max(-1,Math.min(k-3,9-k,1)))).toString(16).padStart(2,'0');
  }).join('');
}

export default function ColorPicker({label, description, value, onChange}) {
  const [open,setOpen] = useState(false),[hex,setHex] = useState(value);
  const id = useId();
  const [hsl,setHsl] = useState(() => toHsl(value));
  useEffect(() => {setHex(value);setHsl(previous => {
    const next=toHsl(value);
    // Preserve the selected hue while white, black or a neutral is being edited.
    return [next[1]===0?previous[0]:next[0],next[2]===0||next[2]===100?previous[1]:next[1],next[2]];
  });},[value]);
  function update(index,next) {
    const color=hsl.map((part,i) => i===index?Number(next):part);
    setHsl(color);onChange(toHex(color));
  }
  const valid=/^#[\da-f]{6}$/i.test(hex);
  return <div className={`color-setting ${open?'expanded':''}`}>
    <div className="row"><div><strong>{label}</strong><small>{description}</small></div>
      <button type="button" className="color-trigger" aria-label={label} aria-expanded={open} aria-controls={id} onClick={()=>setOpen(!open)}>
        <i style={{background:value}}/><span>{value.toUpperCase()}</span><ChevronDown size={13}/></button></div>
    {open&&<div className="color-panel" id={id}>
      <div className="color-preview" style={{background:value}}><span>你的颜色</span></div>
      <div className="color-controls">
        {[['色相',360,`linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)`],['饱和度',100,`linear-gradient(90deg,hsl(${hsl[0]} 0% 50%),hsl(${hsl[0]} 100% 50%))`],['明度',100,`linear-gradient(90deg,#000,hsl(${hsl[0]} ${hsl[1]}% 50%),#fff)`]].map(([name,max,gradient],index)=><label className="color-slider" key={name}>
          <span>{name}<small>{Math.round(hsl[index])}{index===0?'°':'%'}</small></span><input type="range" aria-label={`${label}${name}`} min="0" max={max} value={hsl[index]} onChange={event=>update(index,event.target.value)} style={{background:gradient}}/></label>)}
        <label className="color-hex">HEX<input aria-label={`${label} HEX`} maxLength={7} value={hex} spellCheck={false} aria-invalid={!valid} onChange={event=>{const next=event.target.value;setHex(next);if(/^#[\da-f]{6}$/i.test(next))onChange(next)}} onBlur={()=>{if(!valid)setHex(value)}}/>{valid&&<Check size={14}/>}</label>
      </div></div>}
  </div>;
}
