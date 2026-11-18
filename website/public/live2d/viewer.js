(() => {
  const canvas=document.querySelector('#model'), status=document.querySelector('#status');
  if(!canvas || !status) return;
  const reduce=matchMedia('(prefers-reduced-motion: reduce)');
  let ready=false,running=false,timer=0,last=0,clock=0,mood=0,emoteAt=-1000;
  let tx=0,ty=0,ex=0,ey=0,hx=0,hy=0;
  const clip=(n,min=-1,max=1)=>Math.max(min,Math.min(max,n));
  const params=new Map();
  function place(values,id,n){const p=params.get(id);if(p)values[id]=clip(n,p.min,p.max);}
  function draw(now,force=false){
    if(!ready||!running||document.hidden)return;
    const dt=last?Math.min(80,Math.max(0,now-last)):33;
    if(!force&&now-last<29)return;
    last=now;clock+=dt;
    const idle=!reduce.matches;
    const ease=t=>idle?1-Math.exp(-dt/t):1;
    ex+=(tx-ex)*ease(72);ey+=(ty-ey)*ease(72);
    hx+=(tx-hx)*ease(220);hy+=(ty-hy)*ease(220);
    const t=clock/1000, since=clock-emoteAt, amount=since<0?0:reduce.matches?1:
      clip(Math.min(1,since/165)*(1-clip((since-1300)/420,0,1)),0,1);
    const bp=(t+1.38)%4.9;
    const blink=idle?Math.max(0,1-Math.abs(bp-.10)/.10):0;
    const w=idle?Math.sin(t*1.85):0;
    const values={};
    place(values,'ParamEyeBallX',ex*.76);place(values,'ParamEyeBallY',ey*.68);
    place(values,'ParamAngleX',hx*12);place(values,'ParamAngleY',hy*9);
    place(values,'ParamAngleZ',hx*2+(mood===2?4*amount:0));
    place(values,'ParamBreath',idle?.52+.30*w:.52);
    place(values,'ParamEyeLOpen',Math.max(.05,1-blink*.95-(mood===1?.08*amount:0)));
    place(values,'ParamEyeROpen',Math.max(.05,1-blink*.95-(mood===1?.08*amount:0)));
    place(values,'ParamYukinoSmile',mood===1?amount:0);
    place(values,'ParamMouthForm',mood===1?.35*amount:0);
    place(values,'ParamMouthOpenY',mood===2?.17*amount*(idle?.55+.45*Math.sin(since/88):1):0);
    place(values,'ParamBrowLY',mood===2?.36*amount:0);
    place(values,'ParamBrowRY',mood===2?-.18*amount:0);
    place(values,'ParamHairFront',idle?hx*.10+w*.025:0);
    place(values,'ParamHairBack',idle?hx*.08+w*.02:0);
    window.yukino.drawPose(values);
  }
  function next(t){
    timer=0;if(!ready||!running||document.hidden||reduce.matches)return;
    draw(t);timer=requestAnimationFrame(next);
  }
  function ensure(){
    if(!ready||!running||document.hidden){if(timer)cancelAnimationFrame(timer);timer=0;return;}
    if(reduce.matches&&timer){cancelAnimationFrame(timer);timer=0;}
    if(!timer){last=0;draw(performance.now(),true);if(!reduce.matches)timer=requestAnimationFrame(next);}
  }
  function aim(x,y){tx=clip(x);ty=clip(y);if(reduce.matches)draw(performance.now(),true);}
  canvas.addEventListener('pointermove',event=>{
    if(event.pointerType==='touch')return;
    const r=canvas.getBoundingClientRect();
    if(r.width&&r.height)aim((event.clientX-r.left)/r.width*2-1,1-(event.clientY-r.top)/r.height*2);
  },{passive:true});
  canvas.addEventListener('pointerleave',()=>aim(0,0));
  canvas.addEventListener('blur',()=>aim(0,0));
  function express(){mood=(mood+1)%3;emoteAt=clock;if(reduce.matches)draw(performance.now(),true);}
  canvas.addEventListener('click',express);
  canvas.addEventListener('keydown',event=>{
    const point={ArrowLeft:[-.8,0],ArrowRight:[.8,0],ArrowUp:[0,.7],ArrowDown:[0,-.7],Home:[0,0]}[event.key];
    if(point){event.preventDefault();aim(...point);}
    if(event.key===' '||event.key==='Enter'){event.preventDefault();express();}
  });
  canvas.addEventListener('webglcontextlost',()=>{
    ready=false;status.hidden=false;status.textContent='模型显示中断，请重新进入这一节。';ensure();if(parent!==window)parent.postMessage({source:'yukino-site-live2d',ready:false},location.origin);
  });
  document.addEventListener('visibilitychange',ensure);
  reduce.addEventListener?.('change',ensure);
  window.addEventListener('message',event=>{
    if(event.origin!==location.origin||event.source!==parent||event.data?.source!=='yukino-site-live2d'||typeof event.data.visible!=='boolean')return;
    running=event.data.visible;ensure();
  });
  const fail=()=>{status.hidden=false;status.textContent='当前浏览器暂时无法显示 Live2D。';};
  if(!window.yukino?.ready){fail();return;}
  window.yukino.ready().then(list=>{
    for(const p of list)if(p.id&&Number.isFinite(p.min)&&Number.isFinite(p.max))params.set(p.id,p);
    if(!params.has('ParamEyeBallX')||!params.has('ParamMouthOpenY'))throw Error('Required rig parameters missing.');
    ready=true;status.hidden=true;
    // The renderer has already painted the neutral model; the parent enables idle motion in view.
    running=parent===window;ensure();
    if(parent!==window)parent.postMessage({source:'yukino-site-live2d',ready:true},location.origin);
  }).catch(fail);
})();
