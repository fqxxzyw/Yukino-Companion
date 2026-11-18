// Still renders are the scrolling page. The 3D renderer is strictly opt-in.
import {afterHero,isDataConstrained,warmImage} from './media-warm.mjs?v=14';
import {getSceneMedia,prefetchScenePlan} from './scene-media-preload.mjs?v=19';
import {sceneFrames} from './scene-frames.mjs?v=full-native-solar-27';
import {createSolarPlayback} from './scene-solar-playback.mjs?v=full-native-solar-27';
const run=document.querySelector('.scene-run');
const stage=run?.querySelector('.scene-stage');
if(run&&stage&&'IntersectionObserver' in window){
  stage.querySelector('.scene-live')?.remove();
  stage.querySelector('canvas')?.remove();
  initScenes(run,stage);
}

function initScenes(run,stage){
  const scenes=[...run.querySelectorAll('[data-scene-id]')];
  if(!scenes.length)return;
  const lastScene=scenes.at(-1);
  // The sticky renderer is a decoration, never part of document flow. An
  // absolute rail bounds its travel to the articles without negative margins.
  const rail=document.createElement('div');
  rail.className='scene-stage-rail';
  rail.setAttribute('aria-hidden','true');
  stage.before(rail);
  rail.append(stage);
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const cache=new Map(),decoded=new WeakSet();
  const aspectForStage=()=>stage.clientWidth/Math.max(1,stage.clientHeight)<=1?'mobile':'wide';
  let preloadReady=false;
  let format=aspectForStage(),running=false,raf=0,active=-1,shownSince=0,interaction=null;
  let firstLayer,secondLayer;
  const clamp=x=>Math.min(1,Math.max(0,x));
  const smooth=x=>(x=clamp(x),x*x*(3-2*x));
  const isReady=img=>Boolean(img?.complete&&img.naturalWidth&&decoded.has(img));
  const playback=createSolarPlayback(requestTick);
  run.classList.add('scene-enhanced');

  function makeLayer(){
    const el=document.createElement('div');
    el.className='scene-poster-layer';
    stage.append(el);
    return {el,a:null};
  }
  firstLayer=makeLayer();
  secondLayer=makeLayer();
  function posterURL(index){
    const frame=sceneFrames[scenes[index].dataset.sceneId];
    const shot=frame?.[format]||frame?.wide;
    const arrival=index%2===1?(shot?.night||shot?.morning):shot?.morning;
    return (reduced.matches ? shot?.noon : arrival) || scenes[index].dataset.fallback;
  }
  function arrivalHour(index){
    if(reduced.matches)return 13;
    const image=posterURL(index)||'';
    if(image.endsWith('-night-native.webp'))return 21.5;
    if(image.endsWith('-dawn-native.webp'))return 6.15;
    return 8;
  }
  function preferredPoster(index){
    const base=posterURL(index);
    if(!base||format!=='wide'||reduced.matches||isDataConstrained()||
        stage.clientWidth*(devicePixelRatio||1)<=1500)return base;
    if(base.endsWith('/forest-wide-night-native.webp'))return '/assets/scenes-app/forest-wide-night-native-hd.webp';
    if(base.endsWith('/forest-wide-morning.webp'))return '/assets/scenes-app/forest-wide-morning-hd.webp';
    return base;
  }
  function imageFor(index,priority='low',variant) {
    const path=variant||preferredPoster(index);
    if(!path)return null;
    const existing=cache.get(path);
    if(existing){
      if(priority==='high'&&existing.priority!=='high'&&!existing.img&&!existing.failed){
        existing.priority='high';
        void getSceneMedia(path,priority);
      }
      return existing.img;
    }
    const record={img:null,index,format,priority,failed:false};
    cache.set(path,record);
    getSceneMedia(path,priority).then(async blob=>{
      if(cache.get(path)!==record)return null;
      if(!blob)return warmImage(path,{priority:record.priority});
      const img=new Image();
      img.decoding='async';
      const local=URL.createObjectURL(blob);
      img.src=local;
      try{
        await img.decode();
        return img;
      }catch{
        return warmImage(path,{priority:record.priority});
      }finally{URL.revokeObjectURL(local);}
    }).then(img=>{
      if(cache.get(path)!==record)return;
      if(!img){record.failed=true;requestTick();return;}
      img.className='scene-poster-paint';
      img.alt='';
      img.draggable=false;
      decoded.add(img);
      record.img=img;
      requestTick();
    }).catch(()=>{
      if(cache.get(path)===record){record.failed=true;requestTick();}
    });
    return null;
  }
  function updateAspect(){
    const next=aspectForStage();
    if(next===format)return;
    format=next;
    playback.clear();
    cache.clear();
    run.classList.remove('is-rendered');
    if(preloadReady)planPreload();
  }
  function prime(index,priority='low'){
    if(!scenes[index])return;
    imageFor(index,priority);
  }
  function planPreload(){
    if(isDataConstrained()){
      prefetchScenePlan([]);
      return;
    }
    const jump=scenes.findIndex(scene=>`#${scene.id}`===location.hash);
    const order=scenes.map((_,i)=>i);
    const first=jump>=0?jump:Math.max(0,active);
    order.sort((a,b)=>Math.abs(a-first)-Math.abs(b-first));
    const posters=order.map(preferredPoster);
    const clips=reduced.matches?[]:order.map(index=>playback.source(scenes[index].dataset.sceneId,format));
    // Fetch in document order after the first paint. Only byte storage is
    // touched here; no new <video> or decoded scene bitmap for the queue.
    prefetchScenePlan([...posters,...clips]);
  }
  function primeDestination(index){
    if(!scenes[index])return;
    prime(index,'high');
    if(!reduced.matches)playback.warm(scenes[index].dataset.sceneId,format,'high');
  }
  function markDecoded(img) {
    Promise.resolve(img.decode?.()).then(()=>{decoded.add(img);requestTick();}).catch(()=>{});
  }
  function setOpacity(el,alpha){const value=alpha.toFixed(3);if(el.style.opacity!==value)el.style.opacity=value;}
  function paint(layer,index) {
    // The matching HTML picture/primer remains until this selected
    // responsive resolution decodes; don't issue a second source request.
    const first=imageFor(index,'high');
    if(!isReady(first))return false;
    if(layer.a!==first||first.parentNode!==layer.el){
      layer.a?.remove();
      layer.el.prepend(first);
      layer.a=first;
    }
    return true;
  }
  function requestTick(){if(running&&!raf&&!document.hidden)raf=requestAnimationFrame(tick);}
  function visibleRatio(el,h){
    const rect=el.getBoundingClientRect();
    return Math.max(0,Math.min(h,rect.bottom)-Math.max(0,rect.top))/Math.max(1,h);
  }
  function setReady(i,ready) {
    if(i<0)return;
    scenes[i].classList.toggle('scene-ready',ready);
  }
  function tick(now){
    raf=0;
    const {height:h,width:w}=stage.getBoundingClientRect();
    if(!h||!w)return;
    const runRect=run.getBoundingClientRect();
    const visible=runRect.bottom>0&&runRect.top<h;
    updateAspect();
    const index=clamp(-runRect.top/Math.max(1,h*(scenes.length-1)))*(scenes.length-1);
    const lower=Math.floor(index);
    const upper=Math.min(lower+1,scenes.length-1);
    const mix=reduced.matches?0:smooth((index-lower-.31)/.38);
    const front=reduced.matches?Math.round(index):(mix>=1?upper:lower);
    const centered=Math.round(index);
    const sceneVisible=visibleRatio(scenes[centered],h);
    const finalRect=lastScene.getBoundingClientRect();
    // The last frame leaves with its own article, not with the sticky backdrop.
    const finalExit=front===scenes.length-1&&finalRect.top<=0&&finalRect.bottom>0;
    const entering=Math.abs(index-centered)<.31&&(sceneVisible>=.64||finalExit)?centered:-1;
    let waitingCaption=false;
    if(active!==entering){
      setReady(active,false);
      active=entering;shownSince=0;
    }
    if(visible){
      // Bound full-resolution prefetch to the current vicinity and direction.
      prime(front,'high');
      if(upper!==front)prime(upper);
      else prime(Math.min(scenes.length-1, front+1));
      if(lower<front)prime(lower);
      const available=paint(firstLayer,front);
      const attachedToFinal=finalExit&&available;
      const anchor=attachedToFinal?lastScene:stage;
      if(firstLayer.el.parentNode!==anchor){
        if(attachedToFinal)lastScene.append(firstLayer.el);
        else stage.insertBefore(firstLayer.el,secondLayer.el);
        firstLayer.el.classList.toggle('scene-exit-poster',attachedToFinal);
      }
      const blending=available&&upper!==front&&mix>0&&mix<1&&paint(secondLayer,upper);
      setOpacity(secondLayer.el,blending?mix:0);
      // On a fast jump, use the real responsive progressive-enhancement poster
      // instead of painting a neighboring image under the centered caption.
      const composited=available&&(centered===front||blending);
      run.classList.toggle('is-rendered',composited);
      // The dominant visible scene owns the only player, even before a
      // small overshoot settles. Never start it on another scene's art.
      const dominantLayer=sceneVisible>.55&&composited
        ? (centered===front?firstLayer:(blending&&centered===upper?secondLayer:null)) : null;
      if(dominantLayer&&!reduced.matches&&!interaction){
        playback.sync(scenes[centered].dataset.sceneId,format,dominantLayer.el);
      } else playback.pause(scenes[front].dataset.sceneId,format);
      if(entering>=0){
        const htmlPoster=scenes[entering].querySelector('.scene-capture img');
        const sceneOnStage=composited&&(front===entering||(blending&&upper===entering));
        const frameShown=sceneOnStage||(!composited&&(isReady(htmlPoster)||Boolean(posterURL(entering))));
        if(!frameShown)shownSince=0;
        else if(!shownSince)shownSince=now;
        waitingCaption=frameShown&&!reduced.matches&&now-shownSince<66;
        setReady(entering,frameShown&&!waitingCaption);
      }
      for(const [path,{img,index:sourceIndex,format:sourceFormat}] of cache){
        if((sourceFormat!==format||Math.abs(sourceIndex-centered)>1)&&!img?.isConnected)cache.delete(path);
      }
    }
    if(interaction&&visibleRatio(scenes[interaction.index],h)<.34)closeInteraction(interaction);
    if(waitingCaption)requestTick();
  }

  function closeInteraction(record){
    if(interaction!==record)return;
    interaction=null;
    record.abort.abort();
    record.trigger.disabled=false;
    record.trigger.removeAttribute('aria-busy');
    if(record.status)record.status.textContent='';
    scenes[record.index].classList.remove('scene-modal-active');
    requestTick();
  }
  for(const [index,scene] of scenes.entries()){
    const poster=scene.querySelector('.scene-capture img');
    poster?.addEventListener('load',()=>markDecoded(poster));
    if(poster?.complete&&poster.naturalWidth)markDecoded(poster);
    const trigger=scene.querySelector('[data-scene-interact]');
    if(!trigger)continue;
    trigger.addEventListener('click',async()=>{
      if(interaction)closeInteraction(interaction);
      const abort=new AbortController();
      const record={abort,index,trigger};
      interaction=record;
      playback.pause();
      scene.classList.add('scene-modal-active');
      trigger.disabled=true;
      trigger.setAttribute('aria-busy','true');
      const status=scene.querySelector('.scene-interact-status')||document.createElement('span');
      status.className='scene-interact-status';
      status.setAttribute('role','status');
      if(!status.isConnected)trigger.after(status);
      status.textContent='正在载入互动视图…';
      record.status=status;
      // Escape is available during import and shader warm-up, too. Removing
      // this listener with the record prevents a late resolve from reopening.
      document.addEventListener('keydown',event=>{
        if(event.key!=='Escape'||interaction!==record)return;
        event.preventDefault();closeInteraction(record);trigger.focus({preventScroll:true});
      },{signal:abort.signal});
      try {
        // Avoid even making the scene-engine request on browsers without WebGL.
        const context=document.createElement('canvas').getContext('webgl2');
        if(!context)throw new Error('当前浏览器不支持 3D 拖动。');
        context.getExtension('WEBGL_lose_context')?.loseContext();
        const {openSceneInteraction}=await import('./scene-live.mjs');
        if(abort.signal.aborted)return;
        await openSceneInteraction({
          article:scene,trigger,id:scene.dataset.sceneId,hour:playback.posterHour(scene.dataset.sceneId,format,arrivalHour(index)),signal:abort.signal,
          onExit:()=>{status.textContent='';closeInteraction(record);}
        });
        if(!abort.signal.aborted)status.textContent='';
      } catch(error) {
        if(!abort.signal.aborted) {
          closeInteraction(record);
          status.textContent=error?.message?.startsWith('当前浏览器')?error.message:'暂时无法载入互动视图，原画面已保留。';
        }
      }
    });
  }
  // Start warming before the scene region is visible. Jump links prewarm
  // their intended shot only, and retain the low-resolution CSS safety net.
  const approach=new IntersectionObserver(entries=>{
    const nearby=entries.filter(entry=>entry.isIntersecting);
    if(!nearby.length)return;
    updateAspect();
    for(const entry of nearby)prime(scenes.indexOf(entry.target));
    nearby.sort((a,b)=>Math.abs(a.boundingClientRect.top)-Math.abs(b.boundingClientRect.top));
    if(!reduced.matches&&!isDataConstrained()&&running===false)playback.warm(nearby[0].target.dataset.sceneId,format,'high');
  },{rootMargin:'720px 0px'});
  for(const article of scenes)approach.observe(article);
  const section=run.closest('#scenes');
  const warmJump=(event)=>{
    const link=event.target.closest?.('a[href^="#scene-"]');
    if(!link)return;
    updateAspect();
    primeDestination(scenes.findIndex(scene=>`#${scene.id}`===link.hash));
  };
  for(const event of ['pointerover','focusin','click'])section?.addEventListener(event,warmJump);
  const warmHash=()=>{
    updateAspect();
    primeDestination(scenes.findIndex(scene=>`#${scene.id}`===location.hash));
  };
  warmHash();
  void afterHero.then(()=>{
    preloadReady=true;
    updateAspect();
    planPreload();
  });
  window.addEventListener('hashchange',warmHash);

  new IntersectionObserver(([entry])=>{
    running=entry.isIntersecting;
    if(running)requestTick();
    else {
      if(raf)cancelAnimationFrame(raf);raf=0;
      playback.clear();
      setReady(active,false);active=-1;shownSince=0;
      if(interaction)closeInteraction(interaction);
      for(const layer of [firstLayer,secondLayer]){layer.el.replaceChildren();layer.a=null;}
      if(firstLayer.el.parentNode!==stage){
        stage.insertBefore(firstLayer.el,secondLayer.el);
        firstLayer.el.classList.remove('scene-exit-poster');
      }
      cache.clear();
      run.classList.remove('is-rendered');
    }
  },{rootMargin:'160px 0px'}).observe(run);
  addGentleScrollSettle(run,scenes,reduced,()=>Boolean(interaction));
  window.addEventListener('scroll',requestTick,{passive:true});
  window.addEventListener('resize',requestTick,{passive:true});
  if('ResizeObserver' in window)new ResizeObserver(requestTick).observe(stage);
  window.addEventListener('pagehide',()=>{if(interaction)closeInteraction(interaction);});
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){
      playback.pause();
      if(interaction)closeInteraction(interaction);
    }
    requestTick();
  });
  reduced.addEventListener('change',()=>{if(reduced.matches)playback.clear();if(preloadReady)planPreload();requestTick();});
}


// A small finishing nudge near a real article edge. Native wheel, touch,
// keyboard, anchor and scrollbar scrolling otherwise stay fully in charge.
function addGentleScrollSettle(run,scenes,reduced,isInteracting){
  const first=scenes[0],last=scenes.at(-1);
  let nudged=null;
  let timer=0,armed=0,blockedUntil=0,lastY=scrollY,direction=0,touch=false,gestureStart=scrollY;
  const now=()=>performance.now();
  const passive={passive:true};
  function reset(){clearTimeout(timer);timer=0;armed=0;direction=0;}
  function suppress(){
    reset();
    blockedUntil=now()+1100;
  }
  function userIntent(){
    if(reduced.matches||isInteracting()||document.hidden)return;
    if(now()<blockedUntil)return;
    if(!armed||now()>armed)gestureStart=lastY;
    armed=now()+500;
  }
  function settle(){
    timer=0;
    if(!armed||touch||reduced.matches||isInteracting()||document.hidden||now()>armed||now()<blockedUntil)return;
    const rect=run.getBoundingClientRect();
    if(rect.bottom<=0||rect.top>=innerHeight)return;
    const candidates=scenes.map(el=>({el,offset:el.getBoundingClientRect().top}));
    if(nudged&&Math.abs(nudged.getBoundingClientRect().top)>165)nudged=null;
    const {el,offset}=candidates.reduce((a,b)=>Math.abs(a.offset)<=Math.abs(b.offset)?a:b);
    const limit=Math.min(110,Math.max(64,innerHeight*.12));
    const distance=Math.abs(offset);
    if(!direction||el===nudged||distance<1||distance>limit)return;
    // Arrival at either end may align; departure to the surrounding page
    // never rubber-bands back into the scene strip.
    const edgeAtGestureStart=offset+scrollY-gestureStart;
    if(el===first&&direction<0&&edgeAtGestureStart>=-1)return;
    if(el===last&&direction>0&&edgeAtGestureStart<=1)return;
    reset();
    nudged=el;
    blockedUntil=now()+360;
    window.scrollTo({top:Math.floor(scrollY+offset+.01),behavior:'smooth'});
  }
  window.addEventListener('wheel',event=>{
    if(!event.ctrlKey&&Math.abs(event.deltaY)>Math.abs(event.deltaX))userIntent();
  },passive);
  window.addEventListener('touchstart',()=>{touch=true;userIntent();},passive);
  window.addEventListener('touchmove',userIntent,passive);
  window.addEventListener('touchend',()=>{
    touch=false;
    if(!armed)return;
    userIntent();clearTimeout(timer);timer=setTimeout(settle,180);
  },passive);
  window.addEventListener('touchcancel',()=>{touch=false;reset();},passive);
  // A mouse press, including a scrollbar drag, is never snap intent.
  window.addEventListener('pointerdown',event=>{if(event.pointerType!=='touch')reset();},passive);
  window.addEventListener('keydown',event=>{
    if(event.defaultPrevented||event.ctrlKey||event.altKey||event.metaKey||
       event.target?.closest?.('button,input,select,textarea,[contenteditable],a,summary'))return;
    if(['ArrowDown','ArrowUp','PageDown','PageUp',' '].includes(event.key))userIntent();
    else if(event.key==='Home'||event.key==='End')reset();
  });
  window.addEventListener('scroll',()=>{
    const y=scrollY;
    if(y!==lastY){
      direction=Math.sign(y-lastY);
      if(nudged&&Math.abs(nudged.getBoundingClientRect().top)>165)nudged=null;
    }
    lastY=y;
    if(now()<blockedUntil){
      // An in-flight anchor can take longer on a busy main thread.
      blockedUntil=Math.max(blockedUntil,now()+230);
      return;
    }
    if(!armed||touch)return;
    clearTimeout(timer);timer=setTimeout(settle,180);
  },passive);
  // The section and header links use native/controlled smooth anchor travel.
  // Suppress nudges during that navigation, including button clicks while it
  // is in progress or a subsequent hash change.
  document.addEventListener('click',event=>{
    if(event.target.closest?.('a[href^="#"],a[href^="/#"]'))suppress();
  },true);
  window.addEventListener('hashchange',suppress);
  window.addEventListener('popstate',suppress);
  window.addEventListener('resize',reset,passive);
  reduced.addEventListener('change',reset);
}
