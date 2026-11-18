import {DockMotion,DOCK_SETTLE_MS,dockTarget,dragOffset,dragStretch,advanceDragStretch} from './overview-dock-motion.mjs';

const CURSOR='<svg viewBox="0 0 26 33" fill="none" aria-hidden="true"><path d="M2 2.4 3.4 27l6-6.2 4.8 10 4.4-2.2-4.8-9.6 8.8-1.1L2 2.4Z" fill="#fff" stroke="#142331" stroke-width="1.8" stroke-linejoin="round"/></svg>';
const APPROACH=600,HOLD=170,DRAG=780;
const DROP=APPROACH+HOLD+DRAG;
const END=DROP+DOCK_SETTLE_MS;
const clamp=n=>Math.min(1,Math.max(0,n));
const ease=n=>(n=clamp(n),n*n*(3-2*n));

export function previewGesture(t) {
  if(t<APPROACH)return {stage:'approach',move:0,approach:ease(t/APPROACH)};
  if(t<APPROACH+HOLD)return {stage:'grab',move:0,approach:1};
  if(t<DROP)return {stage:'drag',move:ease((t-APPROACH-HOLD)/DRAG),approach:1};
  return {stage:t<END?'dock':'done',move:1,approach:1};
}
export function bootOverviewDrag(doc=document) {
  const app=doc.querySelector('#overview .v4-app-preview');
  const body=app?.querySelector('.v4-app-body');
  const actor=body?.querySelector('.v4-app-actor');
  const composer=body?.querySelector('.v4-app-compose');
  const model=actor?.querySelector('img');
  if(!app||!body||!actor||!composer||!model||app.dataset.overviewDemoBound||typeof IntersectionObserver!=='function')return;
  app.dataset.overviewDemoBound='true';
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const gestureCursor=doc.createElement('div');
  gestureCursor.className='v18-dock-cursor';gestureCursor.setAttribute('aria-hidden','true');gestureCursor.innerHTML=CURSOR;
  body.append(gestureCursor);
  const snap=new DockMotion(), chatSnap=new DockMotion();
  let raf=0,startAt=0,dockedAt=0,last=0,priorX=0,geometry,stretch,stage='',target='left';
  let visible=false,armed=true,token=0;
  const setStage=value=>{if(stage!==value){stage=value;app.dataset.overviewDemoPhase=value;}};
  function clearDrag(){
    actor.style.removeProperty('transform');actor.style.removeProperty('--v18-grip-x');
    delete app.dataset.overviewDock;
    delete app.dataset.overviewDockTarget;
  }
  function end(){
    ++token;
    if(raf)cancelAnimationFrame(raf);
    raf=0;geometry=null;
    snap.cancel();chatSnap.cancel();clearDrag();
    gestureCursor.style.removeProperty('transform');delete app.dataset.overviewDemoPhase;stage='';
  }
  function positionCursor(x,y) {
    gestureCursor.style.transform=`translate3d(${x-geometry.body.left}px,${y-geometry.body.top}px,0)`;
  }
  function commit(now) {
    const pane=actor.getBoundingClientRect(), chat=composer.getBoundingClientRect();
    clearDrag();setStage('dock');dockedAt=now;
    snap.settle(actor,pane,false);
    chatSnap.settle(composer,chat,false,{rebound:false});
  }
  function tick(now){
    raf=0;
    if(!geometry||!visible||doc.hidden||reduced.matches){end();return;}
    const elapsed=now-startAt;
    const motion=previewGesture(elapsed);
    if(motion.stage==='done'&&stage==='dock'&&now-dockedAt>=DOCK_SETTLE_MS){end();return;}
    if(motion.stage==='dock'||motion.stage==='done'){
      if(stage!=='dock')commit(now);
    }else{
      const {body:b,grabX,grabY,travel,gesture,bounds}=geometry;
      const x=motion.stage==='approach'?b.left+b.width*.035+(grabX-b.left-b.width*.035)*motion.approach:grabX+travel*motion.move;
      const y=motion.stage==='approach'?grabY+Math.min(b.height*.16,60)*(1-motion.approach):grabY;
      if(motion.stage==='grab'||motion.stage==='drag'){
        const entry=Math.min(32,now-last), dx=x-priorX;
        const amount=motion.stage==='drag'?dragStretch(dx,entry):0;
        stretch=advanceDragStretch(stretch,amount,entry);
        const offset=dragOffset(x,gesture,bounds);
        target=dockTarget(x,b.left,b.width,target);
        app.dataset.overviewDockTarget=target;
        actor.style.transform=`translate3d(${offset}px,0,0) scale(${1+stretch.position},${1-stretch.position*.65})`;
        actor.style.setProperty('--v18-grip-x',`${((x-gesture.left-offset)/gesture.width)*100}%`);
      }
      positionCursor(x,y);priorX=x;
      setStage(motion.stage);
    }
    last=now;
    raf=requestAnimationFrame(tick);
  }
  function play(){
    if(!visible||!armed||doc.hidden||reduced.matches)return;
    armed=false;
    const key=++token;
    // Wait for the real winter image, never animate a blank shell on an anchor jump.
    Promise.resolve(model.decode?.()).catch(()=>{}).then(()=>{
      if(key!==token||!visible||doc.hidden||reduced.matches)return;
      const final=actor.getBoundingClientRect(), b=body.getBoundingClientRect();
      if(!model.naturalWidth||!b.width||!final.width)return;
      app.dataset.overviewDock='left';setStage('approach');
      const start=actor.getBoundingClientRect();
      const grabX=start.left+start.width*.5;
      const grabY=start.top+start.height*.047+1.5;
      geometry={body:b,grabX,grabY,travel:(final.left-start.left)*.87,
        gesture:{left:start.left,width:start.width,startX:grabX},bounds:{left:start.left,right:final.right}};
      stretch={position:0,velocity:0};target='left';priorX=grabX;last=startAt=performance.now();
      raf=requestAnimationFrame(tick);
    });
  }
  const observer=new IntersectionObserver(([entry])=>{
    if(!entry.isIntersecting||entry.intersectionRatio<.12){
      visible=false;armed=true;end();
    }else if(entry.intersectionRatio>=.52){
      visible=true;play();
    }else if(entry.intersectionRatio<.35){
      visible=false;end();
    }
  },{threshold:[0,.12,.35,.52]});
  observer.observe(app);
  doc.addEventListener('visibilitychange',()=>{
    if(doc.hidden)end();else play();
  });
  reduced.addEventListener?.('change',()=>{
    if(reduced.matches){end();}else play();
  });
  if(typeof ResizeObserver==='function'){
    let size=app.clientWidth;
    new ResizeObserver(()=>{
      if(app.clientWidth===size)return;
      size=app.clientWidth;
      if(geometry)end();
    }).observe(app);
  }
}
if(typeof document!=='undefined'){
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>bootOverviewDrag(),{once:true});
  else bootOverviewDrag();
}
