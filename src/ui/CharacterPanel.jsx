import React, {useEffect, useRef, useState} from 'react';
import {ArrowLeftToLine, ArrowRightToLine, GripHorizontal, SlidersHorizontal, Snowflake, Shirt, X} from 'lucide-react';
import {SCENES,presentationConfig,gazeTarget,smoothGaze,AvatarPresentationController} from './avatar-presentation.mjs';
import {duration} from './theme.mjs';
import {clampCharacterWidth, sideFromPointer} from './panel-layout.mjs';

export default function CharacterPanel({side, width, onChange, onSettings, usage, containerRef, presentation, onPresentationChange, reducedMotion=false, renderer=null, outfits=[]}) {
  const panel = useRef(null), gesture = useRef(null), changeRef = useRef(onChange);
  const [dragging, setDragging] = useState(false), [target, setTarget] = useState(null), [offset, setOffset] = useState(0);
  changeRef.current = onChange;
  const display=presentationConfig(presentation),gaze=useRef(gazeTarget(0,0,0,0,false)),gazeAim=useRef(gaze.current),adapter=useRef(null);
  const [wardrobe,setWardrobe]=useState(false),[changing,setChanging]=useState(false),[outfitError,setOutfitError]=useState('');
  useEffect(()=>{adapter.current=new AvatarPresentationController(renderer);return()=>adapter.current?.dispose()},[renderer]);
  useEffect(()=>{adapter.current?.setEnvironment(display.scene)},[display.scene,renderer]);
  useEffect(()=>{if(!renderer)return;let frame,last=performance.now();function update(now){const target=display.gaze?gazeAim.current:gazeTarget(0,0,0,0,false);gaze.current=reducedMotion?target:smoothGaze(gaze.current,target,now-last);last=now;adapter.current?.setGaze(gaze.current);frame=requestAnimationFrame(update)}frame=requestAnimationFrame(update);return()=>cancelAnimationFrame(frame)},[renderer,display.gaze,reducedMotion]);
  function track(event){const rect=panel.current?.getBoundingClientRect();if(rect)gazeAim.current=gazeTarget(event.clientX-rect.left,event.clientY-rect.top,rect.width,rect.height,display.gaze);}
  async function dress(id){setChanging(true);setOutfitError('');try{await adapter.current?.changeOutfit(id,{reducedMotion})}catch(error){setOutfitError(error.message)}finally{setChanging(false)}}
  useEffect(() => () => { gesture.current = null; }, []);
  function start(event, kind) {
    if (event.button !== 0) return;
    if (kind === 'move' && event.target.closest('button')) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = {kind, pointerId:event.pointerId, startX:event.clientX, width:panel.current?.getBoundingClientRect().width || width, side};
    if(kind === 'move') { setDragging(true); setTarget(side); }
  }
  function move(event) {
    const current = gesture.current, main = containerRef.current;
    if(!current || current.pointerId !== event.pointerId || !main) return;
    const rect = main.getBoundingClientRect(), style = getComputedStyle(main);
    const available = main.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const gap = parseFloat(style.columnGap) || 18;
    if(current.kind === 'resize') {
      const delta = (event.clientX - current.startX) * (current.side === 'right' ? -1 : 1);
      changeRef.current({width:clampCharacterWidth(current.width + delta, available, gap)});
    } else {
      setOffset(Math.max(-rect.width / 2, Math.min(rect.width / 2,event.clientX - current.startX)));
      setTarget(sideFromPointer(event.clientX,rect.left,rect.width));
    }
  }
  function end(event, cancel = false) {
    const current = gesture.current;
    if(!current || current.pointerId !== event.pointerId) return;
    if(current.kind === 'move' && !cancel && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      changeRef.current({side:sideFromPointer(event.clientX,rect.left,rect.width)});
    }
    gesture.current = null; setDragging(false); setTarget(null); setOffset(0);
    if(event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  const handlers = {onPointerMove:move,onPointerUp:event=>end(event),onPointerCancel:event=>end(event,true),onLostPointerCapture:event=>{if(gesture.current)end(event,true);}};
  return <>
    {dragging && <div className={'character-drop-zone '+target} aria-hidden="true"><span>松开后停靠{target === 'left' ? '左侧' : '右侧'}</span></div>}
    <section ref={panel} className={'avatar-stage character-panel '+(dragging?'is-dragging ':'')+(width<220?'compact-character':'')} style={{background:display.scene==='studio'?undefined:SCENES[display.scene].background,...(dragging?{transform:`translateX(${offset}px)`}:{})}} onPointerMove={track} onPointerLeave={()=>{gazeAim.current=gazeTarget(0,0,0,0,false)}} aria-label="人物区域">
      <div className="stage-top character-drag-handle" onPointerDown={event=>start(event,'move')} {...handlers} title="拖动到左侧或右侧停靠">
        <span className="character-grip"><GripHorizontal size={16}/><span>人物空间</span></span>
        <button type="button" className="icon" aria-label="形象设置" title="形象设置" onClick={onSettings}><SlidersHorizontal size={16}/></button>
      </div>
      <div className="character-dock-tools" aria-label="人物停靠位置"><button className="icon" type="button" title="停靠左侧" aria-label="人物停靠左侧" aria-pressed={side==='left'} onClick={()=>onChange({side:'left'})}><ArrowLeftToLine size={15}/></button><span>拖动顶部 · 拖动边缘调宽</span><button className="icon" type="button" title="停靠右侧" aria-label="人物停靠右侧" aria-pressed={side==='right'} onClick={()=>onChange({side:'right'})}><ArrowRightToLine size={15}/></button></div>
      <button type="button" className="wardrobe-toggle" aria-label="打开服装面板" aria-expanded={wardrobe} onClick={()=>setWardrobe(old=>!old)}><Shirt size={17}/></button>
      <div className="scene-picker" aria-label="人物场景">{Object.entries(SCENES).map(([id,scene])=><button type="button" key={id} className={display.scene===id?'selected':''} aria-pressed={display.scene===id} onClick={()=>onPresentationChange?.({...display,scene:id})}>{scene.label}</button>)}</div>
      {wardrobe&&<aside className="wardrobe-panel" aria-label="服装"><header><strong>服装</strong><button type="button" className="icon" aria-label="关闭服装面板" onClick={()=>setWardrobe(false)}><X size={15}/></button></header>{outfits.length?outfits.map(outfit=><button key={outfit.id} type="button" disabled={changing||!outfit.ready} onClick={()=>dress(outfit.id)}>{outfit.label}{!outfit.ready?' · 尚未准备':''}</button>):<p>服装资源还在制作。<br/>正式模型接入后可在这里切换。</p>}{outfitError&&<p role="alert">{outfitError}</p>}</aside>}
      <div className="abstract-avatar"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="snow-core"><Snowflake size={58} strokeWidth={.8}/></div><span className="orbital-dot"/></div>
      <div className="stage-caption"><span className="eyebrow">YUKINOSHITA YUKINO</span><h2>静候，与你相见。</h2><p>为她留一个位置。<br/>3D 形象与动作仍在制作。</p><button className="text-link" onClick={onSettings}>形象与展示</button></div>
      <div className="stage-footer"><span className="tiny-dot"/>今天陪伴 {duration(usage?.todayMs)}</div>
      <div className={'character-resizer '+side} role="separator" tabIndex={0} aria-label="调整人物区域宽度" aria-orientation="vertical" aria-valuemin={168} aria-valuemax={460} aria-valuenow={Math.round(width)} title="拖动调整宽度；方向键微调" onPointerDown={event=>start(event,'resize')} {...handlers} onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const amount=(event.key==='ArrowRight'?1:-1)*(side==='right'?-1:1);onChange({width:event.key==='Home'?168:event.key==='End'?460:width+amount*(event.shiftKey?40:12)})}}><i/></div>
    </section>
  </>;
}
