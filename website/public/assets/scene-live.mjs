// Loaded only by explicit user interaction. Reuses the real app camera and factories.
import {EnvironmentBackdrop} from './scene-engine/engine.mjs';

export async function openSceneInteraction({article, trigger, id, hour, signal, onExit}) {
  if (signal.aborted) return;
  const title = article.querySelector('h3')?.textContent?.trim() || '场景';
  const shell = document.createElement('section');
  shell.className = 'scene-orbit-layer';
  shell.setAttribute('aria-label', title + '的互动视图');
  const viewport = document.createElement('div');
  viewport.className = 'scene-orbit-viewport';
  const toolbar = document.createElement('div');
  toolbar.className = 'scene-orbit-toolbar';
  const hint = document.createElement('span');
  hint.textContent = '拖动或使用方向键转动视角';
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '退出互动';
  toolbar.append(hint,close);
  shell.append(viewport,toolbar);
  article.append(shell);
  let renderer, frame = 0, showing = false, engineError = null;
  let ptr = null, motion = null;
  const local = new AbortController();
  const listen = (target,type,fn,opts={})=>target.addEventListener(type,fn,{...opts,signal:local.signal});
  function cleanup() {
    if (local.signal.aborted) return;
    local.abort();
    if (frame) cancelAnimationFrame(frame);
    renderer?.dispose();
    shell.remove();
    if(showing) onExit?.();
  }
  signal.addEventListener('abort',cleanup,{once:true,signal:local.signal});
  listen(close,'click',()=>{
    const pending=!showing;
    cleanup();
    if(pending)onExit?.();
    trigger.focus({preventScroll:true});
  });
  try {
    renderer = new EnvironmentBackdrop(viewport,{
      interactive:false,reducedMotion:true,
      onError:error=>{
        engineError=error;
        if(showing){cleanup();trigger.focus({preventScroll:true});}
      }
    });
    renderer.setAnimationEnabled(false);
    // The main desktop app's Ctrl gestures don't belong in this isolated panel.
    document.removeEventListener('wheel',renderer.wheel,true);
    renderer.pointerSurface?.removeEventListener('pointerdown',renderer.pointerDown,true);
    window.removeEventListener('pointermove',renderer.pointerMove,true);
    window.removeEventListener('pointerup',renderer.pointerUp,true);
    window.removeEventListener('pointercancel',renderer.pointerUp,true);
    const ready=await renderer.update(id,hour,{cloud:0,rain:0,fog:0,snow:0,wind:0});
    if(signal.aborted || local.signal.aborted){cleanup();return;}
    if(!ready||engineError)throw engineError||new Error('互动场景暂时无法载入。');
    renderer.render();
    const canvas=renderer.gl.domElement;
    canvas.tabIndex=0;
    canvas.setAttribute('aria-label',title+'，拖动或使用方向键转动视角');
    const queue=()=>{
      if(frame)return;
      frame=requestAnimationFrame(()=>{
        frame=0;
        if(local.signal.aborted||!motion)return;
        const {dx,dy}=motion;motion=null;
        const target=renderer.target,camera=renderer.camera;
        const x=camera.position.x-target.x,y=camera.position.y-target.y,z=camera.position.z-target.z;
        const length=Math.hypot(x,y,z);
        if(length<.1)return;
        const azimuth=Math.atan2(x,z)-dx*.006;
        const polar=Math.min(1.66,Math.max(.23,Math.acos(Math.max(-1, Math.min(1,y/length)))-dy*.0045));
        const plane=length*Math.sin(polar);
        camera.position.set(target.x+plane*Math.sin(azimuth),target.y+length*Math.cos(polar),target.z+plane*Math.cos(azimuth));
        camera.lookAt(target);
        renderer.render();
      });
    };
    const nudge=(dx,dy)=>{
      motion={dx:(motion?.dx||0)+dx,dy:(motion?.dy||0)+dy};queue();
    };
    listen(canvas,'pointerdown',event=>{
      if(ptr||event.button!==0)return;
      ptr={id:event.pointerId,x:event.clientX,y:event.clientY};
      canvas.setPointerCapture(event.pointerId);
      shell.classList.add('is-dragging');
      event.preventDefault();
    });
    listen(canvas,'pointermove',event=>{
      if(!ptr||ptr.id!==event.pointerId)return;
      nudge(event.clientX-ptr.x,event.clientY-ptr.y);
      ptr.x=event.clientX;ptr.y=event.clientY;
    });
    for(const name of ['pointerup','pointercancel','lostpointercapture'])
      listen(canvas,name,event=>{
        if(!ptr||ptr.id!==event.pointerId)return;
        ptr=null;shell.classList.remove('is-dragging');
      });
    const keys={ArrowLeft:[-16,0],ArrowRight:[16,0],ArrowUp:[0,-18],ArrowDown:[0,18]};
    listen(canvas,'keydown',event=>{
      const change=keys[event.key];
      if(!change)return;
      event.preventDefault();nudge(...change);
    });
    showing=true;
    shell.classList.add('is-ready');
    canvas.focus({preventScroll:true});
    return cleanup;
  }catch(error){
    cleanup();throw error;
  }
}
