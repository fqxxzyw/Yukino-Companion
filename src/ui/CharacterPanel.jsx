import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {GripHorizontal, House, RotateCcw, School, SlidersHorizontal, Shirt, Store, Sunset, Trees, Waves, X} from 'lucide-react';
import {SCENES,presentationConfig,gazeTarget,smoothGaze,AvatarPresentationController} from './avatar-presentation.mjs';
import PetAvatar from './PetAvatar.jsx';
import SkinPicker from './SkinPicker.jsx';
import {getSkinStatus} from '../companion/skin-unlocks.mjs';
import {DockMotion,dockTarget,dragOffset,dragStretch,advanceDragStretch} from './dock-motion.mjs';
import {clampCharacterWidth} from './panel-layout.mjs';
import Select from './Select.jsx';

const sceneIcons={classroom:School,forest:Trees,city:Store,bookshop:House,school:School,wedding:Sunset,kasai:Waves};

export default function CharacterPanel({side, width, onChange, onSettings, usage, containerRef, presentation, onPresentationChange, reducedMotion=false, renderer=null, outfits=[], character={},models=[],relationship,usedDates,onModelChange,activity='idle',audioPlayer,daylightHour=12,active=true,sceneStage=false,sceneWeather=null}) {
  const modelHost=useRef(null),menuRef=useRef(null),[menuOpen,setMenuOpen]=useState(false),[runtime,setRuntime]=useState(null),[modelStatus,setModelStatus]=useState({phase:'idle'});
  const modelId=character.modelId||'',selectedUnlocked=!modelId||getSkinStatus(models.find(item=>item.id===modelId),{relationship,usedDates}).unlocked, availableOutfits=outfits.length?outfits:models,activeRenderer=renderer||runtime;
  const panel = useRef(null), gesture = useRef(null), changeRef = useRef(onChange),snapFrom=useRef(null),snap=useRef(new DockMotion()),chatSnap=useRef(new DockMotion()),targetRef=useRef(side);
  const [dragging, setDragging] = useState(false), [target, setTarget] = useState(null);
  const jelly=useRef({lastX:0,lastTime:0,amount:0,state:{position:0,velocity:0}});
  changeRef.current = onChange;
  const display=presentationConfig(presentation),gaze=useRef(gazeTarget(0,0,0,0,false)),gazeAim=useRef(gaze.current),adapter=useRef(null);
  const [reload,setReload]=useState(0),[view,setView]=useState({zoom:1,yaw:0});const orbit=useRef(null);
  function changeView(patch){setView(current=>{const next={...current,...patch};next.yaw=((next.yaw+180)%360+360)%360-180;return runtime?.setView(next)||next})}
  useEffect(()=>{runtime?.setView(view)},[runtime,modelId]);
  useEffect(()=>{const host=modelHost.current;if(!host)return;const wheel=event=>{if(event.ctrlKey)return;event.preventDefault();setView(current=>{const next={...current,zoom:Math.max(1,Math.min(2.2,current.zoom-event.deltaY*.0015))};return runtime?.setView(next)||next})};host.addEventListener('wheel',wheel,{passive:false});return()=>host.removeEventListener('wheel',wheel)},[runtime]);
  const [wardrobe,setWardrobe]=useState(false),[changing,setChanging]=useState(false),[outfitError,setOutfitError]=useState('');
  const wardrobeRef=useRef(null),wardrobeTrigger=useRef(null);
  useEffect(()=>{if(!active){end(null,true);setMenuOpen(false);setWardrobe(false);orbit.current=null;snap.current.cancel();chatSnap.current.cancel();}},[active]);
  useEffect(()=>{if(!wardrobe)return;wardrobeRef.current?.querySelector('header button')?.focus({preventScroll:true});const close=event=>{if(event.type==='keydown'){if(event.key!=='Escape'||event.defaultPrevented)return;event.preventDefault();event.stopPropagation();setWardrobe(false);wardrobeTrigger.current?.focus();}else if(!wardrobeRef.current?.contains(event.target)&&!wardrobeTrigger.current?.contains(event.target)&&!event.target.closest?.('[role="listbox"]'))setWardrobe(false);};document.addEventListener('keydown',close);document.addEventListener('pointerdown',close);return()=>{document.removeEventListener('keydown',close);document.removeEventListener('pointerdown',close)}},[wardrobe]);
  useEffect(()=>{let cancelled=false,instance=null;if(!modelId||renderer)return;import('./model-runtime.mjs').then(({GlbAvatarRenderer})=>{if(cancelled)return;try{instance=new GlbAvatarRenderer(modelHost.current,{renderEnvironment:false,catalog:models,api:window.desktop,reducedMotion,audioPlayer,onStatus:setModelStatus});setRuntime(instance)}catch(error){setModelStatus({phase:'error',message:error.message})}});return()=>{cancelled=true;instance?.dispose();setRuntime(null)}},[Boolean(modelId),renderer]);
  useEffect(()=>{adapter.current=new AvatarPresentationController(activeRenderer);return()=>adapter.current?.dispose()},[activeRenderer]);
  useEffect(()=>{activeRenderer?.setVisible?.(active)},[activeRenderer,active]);
  useEffect(()=>{if(!activeRenderer||!modelId)return;if(!selectedUnlocked){runtime?.clear();if(adapter.current)adapter.current.outfit=null;setChanging(false);setModelStatus({phase:'locked',message:getSkinStatus(models.find(item=>item.id===modelId),{relationship,usedDates}).reason});return;}if(runtime)runtime.catalog=models;let current=true;setChanging(true);setOutfitError('');adapter.current.changeOutfit(modelId,{reducedMotion}).catch(error=>{if(current){setOutfitError(error.message);setModelStatus({phase:'error',message:error.message})}}).finally(()=>{if(current)setChanging(false)});return()=>{current=false;adapter.current?.active?.abort()}},[modelId,activeRenderer,reload,models,selectedUnlocked]);
  useEffect(()=>{if(runtime)runtime.catalog=models},[runtime,models]);
  useEffect(()=>{runtime?.setActivity(activity)},[runtime,activity]);
  useEffect(()=>{runtime?.setReducedMotion(reducedMotion)},[runtime,reducedMotion]);
  useEffect(()=>{if(!menuOpen)return;const close=event=>{
    if(event.type==='keydown'&&event.key!=='Escape')return;
    if(event.type==='pointerdown'){
      if(menuRef.current?.contains(event.target))return;
      // Select renders its listbox in a portal. Its option pointerdown is
      // inside this menu when the owning combobox controls that listbox.
      const popup=event.target?.closest?.('[role="listbox"]');
      if(popup?.id&&Array.from(menuRef.current?.querySelectorAll('[aria-controls]')||[]).some(control=>control.getAttribute('aria-controls')===popup.id))return;
    }
    setMenuOpen(false);
  };document.addEventListener('pointerdown',close);document.addEventListener('keydown',close);return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',close)}},[menuOpen]);
  useEffect(()=>{activeRenderer?.setSceneStage?.(sceneStage);activeRenderer?.setSceneWeather?.(sceneWeather);activeRenderer?.setEnvironment?.({id:display.scene,timeOfDay:daylightHour});activeRenderer?.setRenderStyle?.(display.renderStyle)},[display.scene,daylightHour,display.renderStyle,activeRenderer,sceneStage,sceneWeather]);
  useEffect(()=>{if(!activeRenderer||!active)return;let frame,last=performance.now();function update(now){const target=display.gaze?gazeAim.current:gazeTarget(0,0,0,0,false);gaze.current=reducedMotion?target:smoothGaze(gaze.current,target,now-last);last=now;adapter.current?.setGaze(gaze.current);frame=requestAnimationFrame(update)}frame=requestAnimationFrame(update);return()=>cancelAnimationFrame(frame)},[activeRenderer,display.gaze,reducedMotion,active]);
  function track(event){const rect=panel.current?.getBoundingClientRect();if(rect){gazeAim.current=gazeTarget(event.clientX-rect.left,event.clientY-rect.top,rect.width,rect.height,display.gaze);if(!reducedMotion&&rect.width&&rect.height){panel.current.style.setProperty('--glass-light-x',`${Math.max(0,Math.min(100,100*(event.clientX-rect.left)/rect.width))}%`);panel.current.style.setProperty('--glass-light-y',`${Math.max(0,Math.min(100,100*(event.clientY-rect.top)/rect.height))}%`);}}}
  function dress(id){onModelChange?.(id)}
  useEffect(()=>{
    const cancel=()=>end(null,true),hidden=()=>{if(document.hidden)cancel();},escape=event=>{if(event.key==='Escape'&&gesture.current){event.preventDefault();cancel();}};
    window.addEventListener('blur',cancel);document.addEventListener('visibilitychange',hidden);document.addEventListener('keydown',escape);
    return()=>{const current=gesture.current;gesture.current=null;if(current?.owner?.hasPointerCapture?.(current.pointerId))current.owner.releasePointerCapture(current.pointerId);snap.current.cancel();chatSnap.current.cancel();window.removeEventListener('blur',cancel);document.removeEventListener('visibilitychange',hidden);document.removeEventListener('keydown',escape);};
  },[]);
  useEffect(()=>{
    const element=panel.current;
    if(!element||!dragging||reducedMotion)return;
    let frame,last=performance.now();
    const tick=now=>{
      const next=advanceDragStretch(jelly.current.state,now-jelly.current.lastTime<90?jelly.current.amount:0,now-last);
      jelly.current.state=next;last=now;
      element.style.setProperty('--drag-stretch-x',String(1+next.position));
      element.style.setProperty('--drag-stretch-y',String(1-next.position*.65));
      frame=requestAnimationFrame(tick);
    };
    frame=requestAnimationFrame(tick);
    return()=>{cancelAnimationFrame(frame);element.style.removeProperty('--drag-stretch-x');element.style.removeProperty('--drag-stretch-y')};
  },[dragging,reducedMotion]);
  useLayoutEffect(()=>{
    if(reducedMotion||!active){snap.current.cancel();chatSnap.current.cancel();}
    if(!active){snapFrom.current=null;return;}
    if(!dragging&&snapFrom.current){
      const from=snapFrom.current;snapFrom.current=null;
      // The grid commits to its final columns once. FLIP both live regions in
      // the same layout effect so chat text cannot jump ahead of the person.
      snap.current.settle(panel.current,from.panel,reducedMotion);
      chatSnap.current.settle(from.chat,from.chatRect,reducedMotion,{rebound:false});
    }
  },[side,dragging,width,reducedMotion,active]);
  function start(event, kind) {
    if (event.button !== 0 || event.isPrimary===false || gesture.current || !active || !panel.current || !containerRef.current) return;
    // Portal events also bubble through the React drag handle even though the
    // option is mounted under body; selecting an option must not start a drag.
    if (kind === 'move' && event.target.closest('button,input,label,select,.character-scene-menu,[role="listbox"]')) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rebase=kind==='move'?snap.current.rebase(panel.current):0,rect=panel.current.getBoundingClientRect();
    gesture.current = {kind, owner:event.currentTarget, pointerId:event.pointerId, startX:event.clientX-rebase, lastX:event.clientX, left:rect.left, width:rect.width || width, side};
    if(kind === 'move') { setMenuOpen(false);setWardrobe(false);jelly.current={lastX:event.clientX,lastTime:performance.now(),amount:0,state:{position:0,velocity:0}};panel.current.style.setProperty('--drag-offset-x',`${rebase}px`);setDragging(true);targetRef.current=side; setTarget(side); }
  }
  function move(event) {
    const current = gesture.current, main = containerRef.current;
    if(!current || current.pointerId !== event.pointerId || !main) return;
    const rect = main.getBoundingClientRect(), style = getComputedStyle(main);
    const paddingLeft=parseFloat(style.paddingLeft)||0,paddingRight=parseFloat(style.paddingRight)||0;
    const available = main.clientWidth - paddingLeft - paddingRight;
    current.lastX=event.clientX;
    const gap = parseFloat(style.columnGap) || 18;
    if(current.kind === 'resize') {
      const delta = (event.clientX - current.startX) * (current.side === 'right' ? -1 : 1);
      changeRef.current({width:clampCharacterWidth(current.width + delta, available, gap)});
    } else {
      const now=performance.now(),j=jelly.current;
      j.amount=dragStretch(event.clientX-j.lastX,now-j.lastTime);j.lastX=event.clientX;j.lastTime=now;
      // Paint the offset directly during pointer movement: no React/WebGL
      // rerender on every pixel, and no half-workspace clamp stopping the drag.
      panel.current.style.setProperty('--drag-offset-x',`${dragOffset(event.clientX,current,{left:rect.left+paddingLeft,right:rect.left+rect.width-paddingRight})}px`);
      const next=dockTarget(event.clientX,rect.left,rect.width,targetRef.current);
      if(next!==targetRef.current){targetRef.current=next;setTarget(next);}
    }
  }
  function end(event, cancel = false) {
    const current = gesture.current;
    if(!current || event&&current.pointerId !== event.pointerId) return;
    if(current.kind==='move'){
      const chat=containerRef.current?.querySelector('.chat');
      snapFrom.current={panel:panel.current?.getBoundingClientRect(),chat,chatRect:chat?.getBoundingClientRect()};
    }
    // Clear before releasing capture: lostpointercapture must not finish twice.
    gesture.current = null;
    if(current.kind === 'move' && !cancel && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      changeRef.current({side:dockTarget(event?.clientX??current.lastX,rect.left,rect.width,targetRef.current)});
    }
    setDragging(false);setTarget(null);
    if(current.owner.hasPointerCapture?.(current.pointerId))current.owner.releasePointerCapture(current.pointerId);
  }
  const handlers = {onPointerMove:move,onPointerUp:event=>end(event),onPointerCancel:event=>end(event,true),onLostPointerCapture:event=>{if(gesture.current)end(event,true);}};
  return <>
    <section ref={panel} className={'avatar-stage character-panel '+(dragging?'is-dragging ':'')+(width<220?'compact-character ':'')+(display.spread?'is-spread':'')} data-side={side} style={{...(dragging?{transform:reducedMotion?'translate3d(var(--drag-offset-x, 0px),0,0)':'translate3d(var(--drag-offset-x, 0px),0,0) scale(var(--drag-stretch-x, 1), var(--drag-stretch-y, 1))'}:{})}} onPointerMove={track} onPointerLeave={()=>{gazeAim.current=gazeTarget(0,0,0,0,false)}} aria-label="人物区域">
      <div className="stage-top character-drag-handle" onPointerDown={event=>start(event,'move')} {...handlers} title="拖动到左侧或右侧停靠">
        <span className="character-grip" aria-label="拖动人物面板"><GripHorizontal size={16}/></span><button ref={wardrobeTrigger} type="button" className="icon wardrobe-toggle" aria-label="打开服装面板" title="服装与模型" aria-expanded={wardrobe} onClick={()=>{setMenuOpen(false);setWardrobe(old=>!old)}}><Shirt size={16}/></button><button type="button" className="icon" aria-label="恢复全身正面" title="恢复全身正面" disabled={changing} onClick={()=>changeView({zoom:1,yaw:0})}><RotateCcw size={15}/></button>
        <div className="character-menu-anchor" ref={menuRef}><button type="button" className="icon" aria-label="人物场景选项" title="人物场景选项" aria-expanded={menuOpen} onClick={()=>{setWardrobe(false);setMenuOpen(value=>!value)}}><SlidersHorizontal size={16}/></button>{menuOpen&&<div className="character-scene-menu"><strong>人物场景</strong><div className="scene-picker" role="group" aria-label="选择场景">{Object.entries(SCENES).map(([id,scene])=>{const SceneIcon=sceneIcons[id];return <button type="button" key={id} data-scene={id} className={'scene-choice'+(display.scene===id?' selected':'')} aria-label={scene.label} aria-pressed={display.scene===id} title={scene.description} onClick={()=>onPresentationChange?.({...presentation,...display,scene:id})}><span className="scene-choice-swatch" style={{background:scene.background}} aria-hidden="true"><SceneIcon size={22} strokeWidth={1.4}/></span><span className="scene-choice-name">{scene.label}</span></button>})}</div><p className="hint">{daylightHour?.kind==='solar'?'按位置日光（离线）':'本地时间模拟日光'}</p><label><span>渲染风格</span><Select aria-label="人物渲染风格" value={display.renderStyle} onChange={event=>onPresentationChange?.({...presentation,...display,renderStyle:event.target.value})}><option value="lit">补光渲染</option><option value="natural">原始材质（保留 unlit）</option><option value="toon">赛璐璐分层（预览）</option></Select></label><label><span>环境扩展至整个窗口</span><input type="checkbox" checked={display.spread} onChange={event=>onPresentationChange?.({...presentation,...display,spread:event.target.checked})}/></label><label><span>头部跟随</span><input type="checkbox" checked={display.gaze} onChange={event=>onPresentationChange?.({...presentation,...display,gaze:event.target.checked})}/></label><button className="text-link" onClick={()=>{setMenuOpen(false);onSettings()}}>更多形象设置</button></div>}</div>
      </div>
      {dragging&&<div className={"character-dock-cue "+target} role="status">{target==='left'?'← 松开后停靠左侧':'松开后停靠右侧 →'}</div>}
      {wardrobe&&<aside ref={wardrobeRef} className="wardrobe-panel" aria-label="服装"><header><strong>服装</strong><button type="button" className="icon" aria-label="关闭服装面板" onClick={()=>{setWardrobe(false);wardrobeTrigger.current?.focus()}}><X size={18}/></button></header><div className="wardrobe-body"><SkinPicker models={availableOutfits} relationship={relationship} usedDates={usedDates} selectedId={modelId} onSelect={dress} busy={changing} compact/>{outfitError&&<p role="alert">{outfitError}</p>}</div></aside>}
      <div className="character-model-host" ref={modelHost} hidden={!modelId} tabIndex={0} role="group" aria-label="人物预览：拖动旋转，滚轮缩放，Home 复位" onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(event.key))return;event.preventDefault();if(event.key==='Home')changeView({zoom:1,yaw:0});else changeView({zoom:Math.max(1,Math.min(2.2,view.zoom+(event.key==='ArrowUp'?.1:event.key==='ArrowDown'?-.1:0))),yaw:view.yaw+(event.key==='ArrowLeft'?-15:event.key==='ArrowRight'?15:0)});}} onPointerDown={event=>{if(event.button!==0||changing)return;event.currentTarget.setPointerCapture(event.pointerId);orbit.current={id:event.pointerId,x:event.clientX,yaw:view.yaw};}} onPointerMove={event=>{const active=orbit.current;if(active?.id===event.pointerId)changeView({yaw:(active.yaw+(event.clientX-active.x)*.4)%360})}} onPointerUp={()=>{orbit.current=null}} onPointerCancel={()=>{orbit.current=null}}/>
      {(!modelId||!selectedUnlocked||modelStatus.phase==='error'&&!runtime?.entry)&&<div className="character-fallback"><PetAvatar reducedMotion={reducedMotion}/><strong>{character.name||'雪之下雪乃'}</strong><button className="secondary" onClick={()=>setWardrobe(true)}>选择 3D 模型</button></div>}
      {modelId&&(changing||['error','loading','walking'].includes(modelStatus.phase))&&<div className={'model-status '+modelStatus.phase} role="status">{modelStatus.phase==='walking'?modelStatus.message:changing?'正在加载人物模型…':modelStatus.message||'正在初始化 3D 渲染器'}{modelStatus.phase==='error'&&window.desktop?.characterModelImport&&<button className="text-link" onClick={async()=>{try{if(await window.desktop.characterModelImport(modelId))setReload(value=>value+1)}catch(error){setOutfitError(error.message)}}}>导入此版本 GLB</button>}{modelStatus.phase==='error'&&<button className="text-link" onClick={()=>onModelChange?.('')}>改用 Q 版形象</button>}</div>}
      <div className={'character-resizer '+side} role="separator" tabIndex={0} aria-label="调整人物区域宽度" aria-orientation="vertical" aria-valuemin={168} aria-valuemax={460} aria-valuenow={Math.round(width)} title="拖动调整宽度；方向键微调" onPointerDown={event=>start(event,'resize')} {...handlers} onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const amount=(event.key==='ArrowRight'?1:-1)*(side==='right'?-1:1);onChange({width:event.key==='Home'?168:event.key==='End'?460:width+amount*(event.shiftKey?40:12)})}}><i/></div>
    </section>
  </>;
}
