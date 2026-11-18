import {SCENE,clamp,createBeret,holdBeret,moveBeret,cancelBeret,releaseBeret,stepBeret,gazeDirection} from './beret-motion.mjs';
import {warmImage} from './media-warm.mjs?v=14';

const ROOT=new URL('./character-touch/',import.meta.url).href;
const reduce=matchMedia('(prefers-reduced-motion: reduce)');
const q=(node,sel)=>node.querySelector(sel);
const ping=(root,name,detail)=>root.closest('.ykh-stage-section')?.dispatchEvent(new CustomEvent('ykh-'+name,{detail}));
const svg=(vb,inside)=>'<svg viewBox="'+vb+'" aria-hidden="true" fill="none">'+inside+'</svg>';
function overlay(stage,className,markup=''){
  const n=document.createElement('div');n.className=className;n.setAttribute('aria-hidden','true');n.innerHTML=markup;stage.append(n);return n;
}
const symbolic={
  angry:svg('0 0 40 40','<path d="M6 14c9 1 11-1 10-10m18 10c-9 1-11-1-10-10M6 24c9-1 11 1 10 10m18-10c-9-1-11 1-10 10" stroke="#ff828c" stroke-width="3" stroke-linecap="round"/>'),
  shy:svg('0 0 40 40','<path d="m7 21 5-9m5 10 5-9m5 10 5-9" stroke="#ffa9c4" stroke-width="2.6" stroke-linecap="round"/>'),
  surprise:svg('0 0 40 40','<path d="m20 6 0 16m0 7v1M8 10l3 4m20-4-3 4" stroke="#fcdc85" stroke-width="3.2" stroke-linecap="round"/>'),
  doubt:svg('0 0 40 40','<path d="M12 12a8 8 0 0 1 16 1c0 6-7 6-8 12m0 5v1" stroke="#c4aaff" stroke-width="3" stroke-linecap="round"/>'),
  gentle:svg('0 0 40 40','<path d="M20 31C7 22 5 15 10 11c4-3 8-1 10 3 2-4 6-6 10-3 5 4 3 11-10 20Z" stroke="#ffabcf" stroke-width="3" stroke-linejoin="round"/>')
};
const MOUSE=svg('0 0 22 27','<path d="m2 2 1 21 5-6 4 8 4-2-4-8 7-1Z" stroke="#17232e" stroke-width="1.5" fill="#f6fbff"/>');
function showCursor(node,x,y,click){
  node.classList.add('ykh-cursor-active');
  node.classList.toggle('ykh-cursor-tap',Boolean(click));
  node.style.transform='translate3d('+x+'%,'+y+'%,0)';
}
function hideCursor(node){node.classList.remove('ykh-cursor-active','ykh-cursor-tap');}
function symbol(node,key){
  node.innerHTML=symbolic[key]||'';
  if(typeof node.animate!=='function')return;
  node.getAnimations().forEach(a=>a.cancel());
  if(reduce.matches){
    node.animate([{opacity:1},{opacity:1}],{duration:1400});
    return;
  }
  node.animate([{opacity:0,transform:'translateY(4px) scale(.82)'},{opacity:1,transform:'translateY(0) scale(1)',offset:.13},{opacity:1,offset:.77},{opacity:0}],{duration:1680,easing:'ease-out'});
}
// Hold only real decoded frames from the existing app renders. A failed
// speculative load can be retried by a user action, without showing a blank.
const imageCache=new Map();
const decodedFrames=new Map();
const BASE=['07-worn','06-iris-gaze-cc','02-idle'];
const AXES=['06-iris-gaze-lc','06-iris-gaze-rc','06-iris-gaze-cu','06-iris-gaze-cd'];
const EYE_LEAD=['06-iris-lead-lc','06-iris-lead-rc','06-iris-lead-cu','06-iris-lead-cd'];
const REACTIONS=['02-gentle','02-doubt','02-angry'];
const REQUIRED_HAT=['touch-shy','shy-bare','annoyed','left','right','up','down'];
const FIRST=['07-idle','07-hat',...REQUIRED_HAT.map(name=>'07-'+name),...REACTIONS,...AXES,...EYE_LEAD];
const HAT_CORE=['worn','idle','hat'];
const SIDE_DEMO=[...REACTIONS,...AXES,...EYE_LEAD];
let metaRequest;
function image(name,priority='low') {
  if(decodedFrames.has(name))return Promise.resolve(decodedFrames.get(name));
  if(!imageCache.has(name)){
    const pending=Promise.resolve(warmImage(ROOT+name+'.webp',{priority})).then(pic=>{
      if(pic)decodedFrames.set(name,pic);
      return pic||null;
    },()=>null).finally(()=>imageCache.delete(name));
    imageCache.set(name,pending);
  }else if(priority==='high'){
    // The shared queue deduplicates by URL; this only promotes queued work.
    void warmImage(ROOT+name+'.webp',{priority});
  }
  return imageCache.get(name);
}
function getMeta() {
  if(!metaRequest)metaRequest=fetch(ROOT+'beret.json').then(res=>{
    if(!res.ok)throw new Error('互动资源暂未载入');
    return res.json();
  }).catch(()=>null);
  return metaRequest;
}
function onApproach(node,run) {
  if(typeof IntersectionObserver!=='function'){return;}
  const observer=new IntersectionObserver(entries=>{
    if(!entries.some(e=>e.isIntersecting))return;
    observer.disconnect(); run();
  },{rootMargin:'220px 0px'});
  observer.observe(node);
}
function afterPaint(run) {
  if(document.hidden || typeof requestAnimationFrame!=='function'){setTimeout(run,0);return;}
  requestAnimationFrame(()=>requestAnimationFrame(run));
}
let prep, warmPriority='low';
function prepareInteraction(priority='low') {
  if(priority==='high')warmPriority='high';
  if(prep){
    if(priority==='high')for(const name of [...BASE,...FIRST]){
      if(imageCache.has(name))void image(name,'high');
    }
    return prep;
  }
  const meta=getMeta();
  // The three neutral poses come first, then only frames used by the first
  // gestures. The warmer enforces the shared concurrent image limit.
  const base=Promise.all(BASE.map(name=>image(name,priority)));
  const first=base.then(()=>Object.fromEntries(FIRST.map(name=>[name,image(name,warmPriority)])));
  prep={meta,first};
  return prep;
}
async function setupBeret(root,prep) {
  const section=root.closest('.ykh-stage-section');
  const fallback=q(root,'.ykh-rest'), hit=q(root,'[data-ykh-grab]'), status=q(root,'[data-ykh-status]');
  if(!fallback||!hit)return;
  const announcer=status||document.createElement('span');
  announcer.classList.add('ykh-visually-hidden');announcer.setAttribute('role','status');
  if(!status)root.append(announcer);
  const expression=overlay(hit.parentElement,'ykh-symbol');
  const cursor=overlay(hit.parentElement,'ykh-demo-cursor',MOUSE);
  const hatNode=document.createElement('img');
  hatNode.alt='';hatNode.setAttribute('aria-hidden','true');hatNode.draggable=false;
  hatNode.className='ykh-moving-hat';hatNode.hidden=true;
  hit.before(hatNode);
  const meta=await prep.meta;
  if(!meta){announcer.textContent='帽子互动暂未载入，保留角色画面。';return;}
  const {home,box}=meta;
  if(!home||!box||![home.x,home.y,box.x,box.y,box.w,box.h].every(Number.isFinite))return;
  const first=await prep.first;
  const images={};
  const load=async name=>{images[name]=await (first['07-'+name]||image('07-'+name));return images[name];};
  await Promise.all(HAT_CORE.map(load));
  if(!images.worn||!images.idle||!images.hat){announcer.textContent='帽子互动暂未载入，保留角色画面。';return;}
  const frames=(Array.isArray(meta.frames)?meta.frames:[]).filter(name=>!HAT_CORE.includes(name));
  // Landing/first touch frames precede intermediate gaze steps in the queue.
  const readyNative=Promise.all(REQUIRED_HAT.map(name=>frames.includes(name)?load(name):null));
  // Short intermediate gaze frames are optional and must not delay the demo.
  void readyNative.then(()=>Promise.all(frames.filter(name=>/^eyes-|[-]half$/.test(name)).map(load)));
  const readySide=Promise.all(SIDE_DEMO.map(name=>image(name)));
  const st=createBeret(home,box);
  let pointer=null,ghost=null,raf=0,dir='idle',gazeAt=0;
  let lastModelFrame='',poseTimer=0,lastHatState='';
  let reaction=null, didAuto=false, inView=false, readyAuto=false;
  const claim=()=>{if(section)section.dataset.ykhUser='true';ping(root,'user');};
  section?.addEventListener('ykh-user',()=>{section.dataset.ykhUser='true';if(ghost)finishDemo(performance.now());});
  function reactHat(type,duration){
    const at=performance.now();reaction={type,at,until:at+duration};
    symbol(expression,type);
    clearTimeout(poseTimer);
    poseTimer=setTimeout(()=>{reaction=null;schedule();},duration+25);
    schedule();
  }
  const hatWidth=box.w,hatHeight=box.h,hitWidth=Math.max(box.w+18,55),hitHeight=Math.max(box.h+16,46);
  const percentage=(value,total)=>(value/total*100)+'%';
  const translate=(x,y,w,h)=>'translate3d('+percentage(x,w)+','+percentage(y,h)+',0)';
  hatNode.style.width=percentage(hatWidth,SCENE.width);
  hatNode.style.height=percentage(hatHeight,SCENE.height);
  hatNode.src=images.hat.src;
  hit.style.setProperty('--ykh-hit-w',percentage(hitWidth,SCENE.width));
  hit.style.setProperty('--ykh-hit-h',percentage(hitHeight,SCENE.height));
  const words=line=>{if(announcer.textContent!==line)announcer.textContent=line;};
  function draw(now) {
    const next=st.phase==='worn'?'idle':gazeDirection(st.x,st.y,home);
    if(next!==dir){dir=next;gazeAt=now;}
    const age=now-gazeAt;
    let key='idle';
    const active=Boolean(reaction&&now<reaction.until);
    if(st.phase==='worn')key=active&&reaction.type==='shy'?'touch-shy':'worn';
    else if(st.phase==='ground'||st.phase==='falling')key=images.annoyed?'annoyed':'down';
    else if(dir!=='idle'){
      key=age<65?'eyes-'+dir:age<160?dir+'-half':dir;
      if(!images[key])key=dir;
      if(active&&reaction.type==='shy'&&(st.phase==='aligning'||now-reaction.at<175))key='shy-bare';
    }else if(active&&reaction.type==='shy')key='shy-bare';
    const selected=images[key]||images.idle;
    if(lastModelFrame!==selected.src){fallback.src=selected.src;lastModelFrame=selected.src;}
    const currentHat=st.phase+':'+st.x+':'+st.y;
    if(lastHatState!==currentHat){
      lastHatState=currentHat;
      hatNode.hidden=st.phase==='worn';
      if(!hatNode.hidden){
        hatNode.style.transform=translate(st.x-hatWidth/2,st.y-hatHeight/2,hatWidth,hatHeight);
        hatNode.dataset.ykhGround=String(st.phase==='ground');
      }
      hit.style.transform=translate(st.x-hitWidth/2,st.y-hitHeight/2,hitWidth,hitHeight);
      hit.dataset.ykhHeld=String(st.phase==='held');
    }
    if(ghost?.cursor){
      const [x,y]=ghost.cursor;
      showCursor(cursor,x/SCENE.width*100,y/SCENE.height*100,ghost.grabbing);
    }else hideCursor(cursor);
    return !reduce.matches&&dir!=='idle'&&age<182;
  }
  function point(e){
    const b=fallback.getBoundingClientRect();
    return [(e.clientX-b.left)*SCENE.width/b.width,(e.clientY-b.top)*SCENE.height/b.height];
  }
  function schedule(){if(!raf&&!document.hidden)raf=requestAnimationFrame(tick);}
  function speakLanded(near){
    words(near?'帽子戴回去了。':'帽子落在一旁。拖起来，放回头顶。');
  }
  function release(id,time,quiet=false){
    const result=releaseBeret(st,id,time,{reduced:reduce.matches,quiet});
    if(result) {
      if(result==='near')reactHat('shy',850);else reactHat('angry',1100);
      words(result==='near'?'对齐了，帽子正在戴回。':'松手了，帽子往旁边落。');
      if(!st.flight)speakLanded(result==='near');
      schedule();
    }
  }
  function finishDemo(now){
    if(!ghost)return;
    if(st.owner==='demo'||st.flight?.quiet||st.phase==='ground'){
      Object.assign(st,st.home,{owner:null,from:null,flight:null,phase:'worn'});
    }
    if(reaction){reaction=null;clearTimeout(poseTimer);}
    expression.getAnimations?.().forEach(a=>a.cancel());
    hideCursor(cursor);ghost=null;ping(root,'demo-stop');delete root.dataset.ykhDemoActive;
    schedule();
  }
  const interpolate=(a,b,t)=>a+(b-a)*clamp(t,0,1);
  function guide(now){
    const g=ghost;
    const t=now-g.start;
    if(reduce.matches){finishDemo(now); return;}
    if(t<590){
      g.cursor=[interpolate(home.x+130,home.x,t/590),interpolate(home.y+90,home.y,t/590)];g.grabbing=false;return;
    }
    if(!g.lifted){
      if(!holdBeret(st,'demo')){finishDemo(now);return;}
      g.lifted=true;reactHat('shy',780);words('按住帽子，向上提。');
    }
    const sideX=SCENE.width*.79, high=Math.max(box.h/2+10,home.y-72);
    if(t<1550){
      const lift=(t-590)/580, side=(t-1110)/440;
      moveBeret(st,'demo',interpolate(home.x,sideX,side),interpolate(home.y,high,lift));
      g.cursor=[st.x,st.y];g.grabbing=true;return;
    }
    if(!g.dropped){g.dropped=true;release('demo',now,true);g.cursor=[st.x,st.y];g.grabbing=false;}
    if(st.flight||t<2270)return;
    if(!g.picked){
      const k=clamp((t-2270)/320,0,1);
      g.cursor=[interpolate(sideX,st.x,k),interpolate(high,st.y,k)];
      if(k<1)return;
      if(holdBeret(st,'demo')){g.picked=true;reactHat('shy',780);g.pickAt=now;g.floor={x:st.x,y:st.y};words('把掉下的帽子拖回头顶。');}
      else {finishDemo(now);return;}
    }
    if(!g.reseated){
      const i=clamp((now-g.pickAt)/1020,0,1);
      moveBeret(st,'demo',interpolate(g.floor.x,home.x,i),interpolate(g.floor.y,home.y,i));
      g.cursor=[st.x,st.y];g.grabbing=true;
      if(i>=1){g.reseated=true;release('demo',now,true);g.grabbing=false;}
      return;
    }
    if(!st.flight&&t>=4360)finishDemo(now);
  }
  function tick(now){
    raf=0;
    if(document.hidden)return;
    if(ghost)guide(now);
    const prior=st.phase;
    const moved=stepBeret(st,now);
    if(moved&&prior!==st.phase)speakLanded(st.phase==='worn');
    const needsGaze=draw(now);
    if(ghost||st.flight||needsGaze)schedule();
  }
  function stopUser(){
    if(pointer){cancelBeret(st,pointer.id);pointer=null;}
    if(st.owner==='keyboard')cancelBeret(st,'keyboard');
    if(ghost)finishDemo(performance.now());
    schedule();
  }
  hit.addEventListener('pointerdown',e=>{
    if(e.button!==0||(!e.isPrimary&&e.pointerType!=='mouse'))return;
    claim();
    if(st.owner!==null||!['worn','ground'].includes(st.phase))return;
    const [x,y]=point(e);
    pointer={id:e.pointerId,dx:st.x-x,dy:st.y-y,x,y,moved:false};
    e.preventDefault();
    hit.setPointerCapture(e.pointerId);
    words('拖动帽子，雪乃会看过去。');
    schedule();
  });
  hit.addEventListener('pointermove',e=>{
    if(!pointer||pointer.id!==e.pointerId)return;
    const [x,y]=point(e);
    if(!pointer.moved&&Math.hypot(x-pointer.x,y-pointer.y)<5)return;
    if(!pointer.moved){
      if(!holdBeret(st,pointer.id))return;
      pointer.moved=true;reactHat('shy',780);
    }
    moveBeret(st,pointer.id,x+pointer.dx,y+pointer.dy);schedule();
  });
  hit.addEventListener('pointerup',e=>{
    if(!pointer||pointer.id!==e.pointerId)return;
    const p=pointer; pointer=null;
    if(!p.moved)return;
    release(p.id,performance.now());
  });
  for(const ev of ['pointercancel','lostpointercapture'])hit.addEventListener(ev,e=>{
    if(pointer?.id!==e.pointerId)return;
    cancelBeret(st,e.pointerId);pointer=null;words('拖动已取消。');schedule();
  });
  hit.addEventListener('keydown',e=>{
    if(e.key==='Escape'){e.preventDefault();stopUser();words('拖动已取消。');return;}
    if(st.owner!=='keyboard'||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(e.key))return;
    e.preventDefault();
    const step=e.shiftKey?45:22;
    if(e.key==='Home')moveBeret(st,'keyboard',home.x,home.y);
    else moveBeret(st,'keyboard',st.x+(e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0),st.y+(e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0));
    schedule();
  });
  hit.addEventListener('click',e=>{
    if(e.detail!==0)return;
    claim();
    if(st.owner==='keyboard'){release('keyboard',performance.now());return;}
    if(holdBeret(st,'keyboard')){reactHat('shy',780);words('已拿起。方向键移动，再按 Enter 放下。');}
    schedule();
  });
  function startDemo(){
    if(ghost||st.phase!=='worn'||pointer||reduce.matches)return;
    root.dataset.ykhDemoActive='true';ghost={start:performance.now()};ping(root,'demo-start',ghost.start);
    schedule();
  }
  let settled=0;
  function maybeAuto(){
    if(settled){clearTimeout(settled);settled=0;}
    if(!inView||document.hidden||didAuto||section?.dataset.ykhUser||!readyAuto||reduce.matches)return;
    // Do not spend the one automatic pass while the user is still scrolling by.
    settled=setTimeout(()=>{
      settled=0;
      if(!inView||document.hidden||didAuto||section?.dataset.ykhUser||reduce.matches||st.phase!=='worn'||pointer)return;
      didAuto=true;startDemo();
    },160);
  }
  if(section&&typeof IntersectionObserver==='function'){
    const portraits=[...section.querySelectorAll('.ykh-model-stage')];
    const visibility=new Map();
    const view=new IntersectionObserver(entries=>{
      for(const entry of entries)visibility.set(entry.target,entry.intersectionRatio);
      inView=portraits.length>0&&portraits.every(portrait=>(visibility.get(portrait)||0)>=.72);
      if(ghost&&portraits.some(portrait=>(visibility.get(portrait)||0)<.48))finishDemo(performance.now());
      if(inView&&!readyAuto&&!reduce.matches)prepareInteraction('high');
      maybeAuto();
    },{threshold:[0,.48,.72]});
    for(const portrait of portraits)view.observe(portrait);
    Promise.all([readyNative,readySide]).then(([native,side])=>{
      readyAuto=native.every(Boolean)&&side.every(Boolean);
      maybeAuto();
    });
  }
  window.addEventListener('blur',stopUser);
  document.addEventListener('visibilitychange',()=>{if(document.hidden){stopUser();if(raf){cancelAnimationFrame(raf);raf=0;}}else{maybeAuto();schedule();}});
  reduce.addEventListener?.('change',()=>{if(ghost)finishDemo(performance.now());maybeAuto();schedule();});
  fallback.hidden=false;hit.hidden=false;
  draw(performance.now());
}
// The middle portrait displays native head and eye renders; the cursor is
// composited independently and never moves or deforms the artwork itself.
function setupGaze(card){
  const art=q(card,'[data-ykh-gaze-img]');
  const stage=art?.parentElement;
  const section=card.closest('.ykh-stage-section');
  if(!stage||!section)return;
  const cursor=overlay(stage,'ykh-demo-cursor',MOUSE);
  const neutral=art.getAttribute('src');
  let pose='gaze-cc',request=0,raf=0,takeover=false,rect,prewarmed=false,previous=0;
  let enteredAt=null;
  let pointerX=.5,pointerY=.38,x=.5,y=.38;
  const near=()=>Math.abs(pointerX-x)+Math.abs(pointerY-y);
  const sector=(a,b)=>{
    const horizontal=(a-.5)/.15,vertical=(b-.38)/(b<.38?.14:.19);
    if(Math.max(Math.abs(horizontal),Math.abs(vertical))<1)return 'cc';
    if(Math.abs(horizontal)>=Math.abs(vertical))return horizontal<0?'lc':'rc';
    return vertical<0?'cu':'cd';
  };
  function show(wanted){
    if(wanted===pose)return;
    pose=wanted;
    const token=++request;
    if(wanted==='gaze-cc'){art.src=neutral;return;}
    const name='06-iris-'+wanted;
    const immediate=decodedFrames.get(name);
    if(immediate)art.src=immediate.src;
    if(decodedFrames.has(name))return;
    void image(name,'high').then(pic=>{if(pic&&token===request)art.src=pic.src;});
  }
  function frame(now){
    raf=0;
    const dt=previous?Math.max(8,Math.min(32,now-previous)):16;previous=now;
    const amount=reduce.matches?1:1-Math.exp(-dt/132);
    x+=(pointerX-x)*amount;
    y+=(pointerY-y)*amount;
    const head=sector(x,y);
    const aim=sector(pointerX,pointerY);
    const eyeOnly=aim[0]!=='c'?aim[0]+'c':'c'+aim[1];
    const hasLead=eyeOnly!=='cc'&&decodedFrames.has('06-iris-lead-'+eyeOnly);
    const lead=head==='cc'&&aim!=='cc'&&hasLead&&!reduce.matches;
    show(lead?'lead-'+eyeOnly:'gaze-'+head);
    if(near()>.003)raf=requestAnimationFrame(frame);
    else previous=0;
  }
  function move(a,b){
    pointerX=clamp(a,0,1);pointerY=clamp(b,0,1);
    if(!raf)raf=requestAnimationFrame(frame);
  }
  function stop(){
    if(raf)cancelAnimationFrame(raf);raf=0;previous=0;
    hideCursor(cursor);
    x=pointerX=.5;y=pointerY=.38;show('gaze-cc');
  }
  function returnHome(){
    rect=null;
    hideCursor(cursor);
    move(.5,.38);
  }
  function take(){
    if(!prewarmed){prewarmed=true;EYE_LEAD.forEach(name=>void image(name));}
    if(!takeover){
      takeover=true;section.dataset.ykhUser='true';ping(card,'user');
    }
  }
  const point=event=>{
    take();
    rect=rect||stage.getBoundingClientRect();
    if(rect.width&&rect.height)move((event.clientX-rect.left)/rect.width,(event.clientY-rect.top)/rect.height);
  };
  stage.addEventListener('pointerenter',e=>{
    rect=stage.getBoundingClientRect();enteredAt=[e.clientX,e.clientY];
  });
  stage.addEventListener('pointermove',e=>{
    // A scroll can fire pointerenter under a stationary mouse. It is not input.
    if(enteredAt&&Math.hypot(e.clientX-enteredAt[0],e.clientY-enteredAt[1])<2)return;
    enteredAt=null;point(e);
  },{passive:true});
  stage.addEventListener('pointerdown',e=>{enteredAt=null;rect=stage.getBoundingClientRect();point(e);},{passive:true});
  stage.addEventListener('pointerleave',()=>{enteredAt=null;if(takeover)returnHome();});
  stage.addEventListener('pointercancel',returnHome);
  window.addEventListener('resize',()=>{rect=null;},{passive:true});
  window.addEventListener('scroll',()=>{rect=null;},{passive:true});
  stage.addEventListener('blur',returnHome);
  onApproach(stage,()=>EYE_LEAD.forEach(name=>void image(name)));
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
  stage.addEventListener('keydown',event=>{
    const directions={ArrowLeft:[.16,.38],ArrowRight:[.84,.38],ArrowUp:[.5,.14],ArrowDown:[.5,.76],Home:[.5,.38],Escape:[.5,.38]};
    if(!Object.hasOwn(directions,event.key))return;
    event.preventDefault();take();move(...directions[event.key]);
  });
  section.addEventListener('ykh-demo-stop',()=>{if(!takeover)stop();});
  let demoFrame=0;
  section.addEventListener('ykh-user',()=>{if(demoFrame)cancelAnimationFrame(demoFrame);demoFrame=0;hideCursor(cursor);});
  section.addEventListener('ykh-demo-stop',()=>{if(demoFrame)cancelAnimationFrame(demoFrame);demoFrame=0;});
  section.addEventListener('ykh-demo-start',e=>{
    if(takeover||reduce.matches)return;
    stop();
    const start=e.detail;
    const path=[[0,.5,.38],[510,.17,.38],[1140,.5,.15],[1830,.83,.38],[2480,.5,.76],[3100,.21,.38],[3680,.5,.38]];
    function step(now){
      if(document.hidden||reduce.matches){stop();return;}
      const t=now-start, next=path.findIndex(p=>p[0]>t);
      if(next<=0){stop();return;}
      const [t0,x0,y0]=path[next-1], [t1,x1,y1]=path[next];
      const progress=clamp((t-t0)/(t1-t0),0,1);
      const ease=progress*progress*(3-2*progress);
      const px=x0+(x1-x0)*ease,py=y0+(y1-y0)*ease;
      showCursor(cursor,px*100,py*100,false);move(px,py);
      demoFrame=requestAnimationFrame(step);
    }
    demoFrame=requestAnimationFrame(step);
  });
}
function setupMood(card){
  const id=card.dataset.ykhMood, art=q(card,'[data-ykh-mood-img]');
  const stage=art?.parentElement;if(!stage)return;
  const section=card.closest('.ykh-stage-section');
  const trigger=q(card,'[data-ykh-touch]');
  if(!trigger||!section)return;
  trigger.classList.add('ykh-mood-head');
  trigger.setAttribute('aria-label','触碰雪乃头部');
  const cursor=overlay(stage,'ykh-demo-cursor',MOUSE);
  const reaction=overlay(stage,'ykh-symbol');
  const idle=art.src;
  const faces=['gentle','doubt','angry'];
  let generation=0,timer=0,raf=0,tapTimes=[],did=[],single=0;
  function activate(face){
    const current=++generation;clearTimeout(timer);
    const name=id+'-'+face;
    const display=pic=>{
      if(!pic||current!==generation)return;
      art.src=pic.src;
      symbol(reaction,face);
      timer=setTimeout(()=>{if(current===generation)art.src=idle;},1720);
    };
    if(decodedFrames.has(name))display(decodedFrames.get(name));
    else void image(name,'high').then(display);
  }
  function stop(){
    if(raf)cancelAnimationFrame(raf);raf=0;hideCursor(cursor);
  }
  trigger.addEventListener('click',()=>{
    section.dataset.ykhUser='true';ping(card,'user');
    const now=performance.now();tapTimes=tapTimes.filter(at=>at>now-750);tapTimes.push(now);
    void activate(tapTimes.length>=2?'angry':faces[single++%2]);
  });
  section.addEventListener('ykh-demo-stop',()=>{
    stop();++generation;clearTimeout(timer);art.src=idle;
    reaction.getAnimations?.().forEach(a=>a.cancel());
  });
  section.addEventListener('ykh-demo-start',e=>{
    stop();did=[];const start=e.detail;
    if(reduce.matches)return;
    const duration=3980;
    const move=now=>{
      const t=now-start;
      if(t>=duration){stop();return;}
      const from=clamp(t/570,0,1),out=clamp((t-3270)/710,0,1);
      const x=50+27*(1-from)+19*out,y=42+14*(1-from)+13*out;
      const marks=[690,1840,2990];
      for(let i=0;i<marks.length;i++)if(!did[i]&&t>=marks[i]){
        did[i]=true;void activate(faces[i]);
      }
      showCursor(cursor,x,y,marks.some(mark=>t>=mark&&t<mark+175));
      raf=requestAnimationFrame(move);
    };
    raf=requestAnimationFrame(move);
  });
}
export function bootBeret(node=document){
  const roots=[];
  for(const root of node.querySelectorAll('[data-ykh-beret]'))if(!root.dataset.ykhBound){
    root.dataset.ykhBound='true';roots.push(root);
  }
  for(const card of node.querySelectorAll('[data-ykh-gaze]'))if(!card.dataset.ykhBound){card.dataset.ykhBound='true';setupGaze(card);}
  for(const card of node.querySelectorAll('[data-ykh-mood]'))if(!card.dataset.ykhBound){card.dataset.ykhBound='true';setupMood(card);}
  if(!roots.length)return;
  let started=false;
  const start=priority=>{
    if(started){if(priority==='high')prepareInteraction(priority);return;}
    started=true;
    const work=prepareInteraction(priority);
    for(const root of roots)void setupBeret(root,work);
  };
  // Standard visits warm immediately after paint; anchor jumps can promote
  // the same work before paint without creating duplicate requests.
  for(const root of roots)onApproach(root,()=>start('high'));
  afterPaint(()=>start('low'));
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>bootBeret(),{once:true});
else bootBeret();
