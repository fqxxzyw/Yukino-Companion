import React,{useEffect,useRef,useState} from 'react';
export default function CompactDock({value,onChange,busy,visualActive,onSubmit,onVisual,label='与角色对话'}){
 const root=useRef(null),input=useRef(null),timer=useRef(null),composing=useRef(false),[hover,setHover]=useState(false),[focus,setFocus]=useState(false),[opened,setOpened]=useState(false);
 const held=focus||Boolean(value)||busy||visualActive;
 useEffect(()=>{clearTimeout(timer.current);if(hover||held)setOpened(true);else timer.current=setTimeout(()=>setOpened(false),320);return()=>clearTimeout(timer.current)},[hover,held]);
 function expand(){setOpened(true);requestAnimationFrame(()=>input.current?.focus())}
 return <div ref={root} className={`compact-dock ${opened?'expanded':''}`} onPointerEnter={()=>setHover(true)} onPointerLeave={()=>setHover(false)} onFocusCapture={()=>setFocus(true)} onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget))setFocus(false)}} onPointerDown={event=>event.stopPropagation()}>
  <button type="button" className="dock-handle" aria-label="展开人物输入框" aria-expanded={opened} tabIndex={opened?-1:0} onClick={expand} onFocus={expand}/>
  <form onSubmit={event=>{event.preventDefault();if(!composing.current)onSubmit(event)}} aria-label={label} aria-hidden={!opened}>
   <input ref={input} tabIndex={opened?0:-1} aria-label={label} placeholder={label} value={value} maxLength={24000} disabled={busy} onCompositionStart={()=>{composing.current=true}} onCompositionEnd={()=>{composing.current=false}} onKeyDown={event=>{if(event.key==='Enter'&&(event.nativeEvent.isComposing||composing.current||event.keyCode===229))event.preventDefault()}} onChange={event=>onChange(event.target.value.replace(/[\r\n]/g,' '))}/>
   <button type="button" tabIndex={opened?0:-1} className={visualActive?'vision-active':''} aria-label={visualActive?'停止视觉陪伴':'选择屏幕识别或摄像头预览'} title={visualActive?'停止视觉陪伴':'屏幕 / 摄像头（默认关闭）'} onClick={onVisual}>▣</button>
   <button type="submit" tabIndex={opened?0:-1} aria-label={busy?'停止回复':'发送消息'} disabled={!busy&&!value.trim()}>{busy?'■':'↑'}</button>
  </form>
 </div>
}
