// Fictional UI preview. No capture, file picker, permissions, persistence or API.
export const VISION_CUES = Object.freeze([2050,2190,2350,2550,2720,2980,3150]);
const lerp=(a,b,t)=>a+(b-a)*t;
const progress=(n,a,b)=>Math.min(1,Math.max(0,(n-a)/(b-a)));
const ease=t=>t*t*(3-2*t);

export function visionFrame(elapsed) {
  let phase='desktop';
  if(elapsed>=3660) phase='done';
  else if(elapsed>=3310) phase='reading';
  else if(elapsed>=1710) phase='typing';
  else if(elapsed>=1040) phase='opening';
  const toFile=ease(progress(elapsed,150,880));
  const toLine=ease(progress(elapsed,1380,1970));
  return {
    phase,
    count:VISION_CUES.filter(at=>elapsed>=at).length,
    press:(elapsed>=905&&elapsed<1015)||(elapsed>=1880&&elapsed<1990),
    x:lerp(77,15,toFile)+17*toLine,
    y:lerp(72,28,toFile)+18*toLine,
  };
}

export function bindVision(root) {
  const stage=root.querySelector('[data-vision-stage]');
  const current=stage?.querySelector('[data-vision-typed]');
  const pointer=stage?.querySelector('.vision-pointer');
  if(!stage||!current||!pointer||typeof IntersectionObserver!=='function')return;
  const motion=matchMedia('(prefers-reduced-motion: reduce)');
  const text=Array.from(current.textContent||'');
  let visible=false, done=false, raf=0, played=0, anchor=0, phase='', chars=-1, pressed=false;
  const watch=new IntersectionObserver(([entry])=>{
    // Observe the illustration, not the large Memory section or stacked mobile copy.
    visible=entry.isIntersecting&&entry.intersectionRatio>=.42;
    sync();
  },{threshold:[0,.42]});

  function paint(frame){
    if(phase!==frame.phase){phase=frame.phase;stage.dataset.visionPhase=phase;}
    const count=phase==='done'?text.length:frame.count;
    if(chars!==count){chars=count;current.textContent=text.slice(0,count).join('');}
    if(pressed!==frame.press){pressed=frame.press;stage.toggleAttribute('data-vision-press',pressed);}
    if(frame.phase!=='reading'&&frame.phase!=='done')pointer.style.transform='translate3d('+frame.x+'%,'+frame.y+'%,0)';
  }

  function finish(){
    if(done)return;
    done=true;watch.disconnect();document.removeEventListener('visibilitychange',sync);
    motion.removeEventListener?.('change',sync);
    if(raf)cancelAnimationFrame(raf);
    raf=0;anchor=0;
    paint(visionFrame(3660));
  }

  function tick(now){
    raf=0;
    if(!visible||document.hidden||motion.matches){sync();return;}
    if(!anchor)anchor=now;
    const at=played+now-anchor;
    if(at>=3660){finish();return;}
    paint(visionFrame(at));
    raf=requestAnimationFrame(tick);
  }

  function sync(){
    if(done)return;
    if(motion.matches){finish();return;}
    if(!visible||document.hidden){
      if(raf)cancelAnimationFrame(raf);raf=0;
      if(anchor){played+=Math.max(0,performance.now()-anchor);anchor=0;}
      return;
    }
    if(!raf)raf=requestAnimationFrame(tick);
  }

  if(motion.matches){finish();return;}
  // Leave complete HTML before the observer is registered, then stage the intro
  // synchronously to avoid a flash before the first IntersectionObserver tick.
  paint(visionFrame(0));watch.observe(stage);
  document.addEventListener('visibilitychange',sync);
  motion.addEventListener?.('change',sync);
}

if(typeof document!=='undefined'){
  for(const part of document.querySelectorAll('[data-vision-demo]'))bindVision(part);
}
