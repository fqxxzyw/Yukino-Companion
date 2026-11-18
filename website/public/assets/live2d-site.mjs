const panel=document.querySelector('[data-live2d-preview]');
if(panel){
  let frame,active=false,near=false,expiry=0;
  const tell=()=>{
    if(frame?.contentWindow)frame.contentWindow.postMessage({source:'yukino-site-live2d',visible:active&&!document.hidden},location.origin);
  };
  function mount(){
    if(frame)return;
    frame=document.createElement('iframe');frame.title='雪之下雪乃 · Live2D 形象';
    frame.setAttribute('sandbox','allow-same-origin allow-scripts');
    frame.setAttribute('allow',"camera 'none'; microphone 'none'; geolocation 'none'");
    frame.addEventListener('load',tell);frame.src='/live2d/';
    frame.inert=true;
    panel.append(frame);
  }
  function draw(){
    if(active&&!document.hidden)mount();
    tell();
    clearTimeout(expiry);
    if(!near&&frame)expiry=setTimeout(()=>{
      if(near)return;
      frame?.remove();frame=null;panel.classList.remove("is-live2d-ready");
    },15000);
  }
  window.addEventListener('message',event=>{
    if(event.origin!==location.origin||event.source!==frame?.contentWindow||event.data?.source!=='yukino-site-live2d')return;
    if(event.data.ready===true){
      panel.classList.add('is-live2d-ready');frame.inert=false;tell();
    }else if(event.data.ready===false){
      panel.classList.remove('is-live2d-ready');frame.inert=true;
    }
  });
  if('IntersectionObserver' in window){
    new IntersectionObserver(([r])=>{active=r.isIntersecting&&r.intersectionRatio>=.12;draw();},{threshold:[0,.12]}).observe(panel);
    new IntersectionObserver(([r])=>{near=r.isIntersecting;draw();},{rootMargin:'100% 0px'}).observe(panel);
  }else{active=near=true;draw();}
  document.addEventListener('visibilitychange',draw);
}
