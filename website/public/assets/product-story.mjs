const routeOptions = {
  chat:{
    local:['雪乃本地模型','下载到电脑后，不用填 API Key。'],
    online:['在线对话','可接 OpenAI、DeepSeek 等服务。'],
  },
  translation:{
    local:['本地中日翻译','用电脑里的腾讯混元翻译模型。'],
    online:['在线翻译','可以和聊天共用一个服务，也可以另选。'],
  },
  voice:{
    local:['本地语音','用 GPT-SoVITS 在电脑上生成雪乃的日语语音。'],
    online:['在线配音','可配置阿里云百炼语音合成。'],
  },
};
const still = matchMedia('(prefers-reduced-motion: reduce)');
for (const demo of document.querySelectorAll('[data-route-demo]')) {
  const routes=[...demo.querySelectorAll('[data-route-pick]')];
  const sources=[...demo.querySelectorAll('[data-route-source]')];
  const selected={chat:'local',translation:'local',voice:'local'};
  let active='chat';
  function update(){
    const source=selected[active];
    demo.dataset.route=active;
    demo.dataset.source=source;
    for(const b of routes)b.setAttribute('aria-pressed',String(b.dataset.routePick===active));
    for(const b of sources)b.setAttribute('aria-pressed',String(b.dataset.routeSource===source));
    const [title,description]=routeOptions[active][source];
    demo.querySelector('[data-route-title]').textContent=title;
    demo.querySelector('[data-route-sub]').textContent=description;
  }
  demo.addEventListener('click',event=>{
    const button=event.target.closest('[data-route-pick],[data-route-source]');
    if(!button||!demo.contains(button))return;
    const {routePick,routeSource}=button.dataset;
    if(Object.hasOwn(routeOptions,routePick))active=routePick;
    else if(Object.hasOwn(routeOptions[active],routeSource))selected[active]=routeSource;
    else return;
    update();
  });
  update();
}
for(const demo of document.querySelectorAll('[data-vision-story]')){
  if(still.matches||!('IntersectionObserver' in window)){demo.dataset.visionState='2';continue;}
  let timer, visible=false, step=0;
  const schedule=()=>{
    clearTimeout(timer);
    if(!visible||document.hidden||step>=2)return;
    timer=setTimeout(()=>{
      if(!visible||document.hidden)return;
      demo.dataset.visionState=String(++step);
      schedule();
    },step===0?550:1050);
  };
  const watch=new IntersectionObserver(([entry])=>{
    visible=entry.isIntersecting&&entry.intersectionRatio>=.4;
    schedule();
    if(step>=2)watch.disconnect();
  },{threshold:.4});
  watch.observe(demo);
  document.addEventListener('visibilitychange',schedule);
  still.addEventListener('change',()=>{
    if(still.matches){step=2;demo.dataset.visionState='2';clearTimeout(timer);watch.disconnect();}
  });
}
