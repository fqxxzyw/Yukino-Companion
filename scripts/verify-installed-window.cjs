'use strict';
// Connect only to the temporary installed app launched by the native smoke test.
// Check the real renderer and real IPC path, including one completed WebGL frame.
const fs=require('node:fs/promises'),path=require('node:path');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function verify(profile){
  const deadline=Date.now()+90000,portFile=path.join(profile,'DevToolsActivePort');let port;
  while(Date.now()<deadline&&!port){try{port=Number((await fs.readFile(portFile,'utf8')).split(/\r?\n/)[0]);}catch{}if(!port)await pause(200);}
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('Installed app did not expose its temporary local verification port');
  let target;
  while(Date.now()<deadline&&!target){try{const items=await (await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(2000)})).json();target=items.find(x=>x.type==='page'&&x.url.includes('app.asar/dist/index.html'));}catch{}if(!target)await pause(200);}
  if(!target)throw Error('Installed main renderer was not found');
  const socket=new WebSocket(target.webSocketDebuggerUrl),pending=new Map();let next=0;
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{try{socket.close()}catch{}reject(Error('Installed renderer connection timed out'))},10000);socket.addEventListener('open',()=>{clearTimeout(timer);resolve()},{once:true});socket.addEventListener('error',()=>{clearTimeout(timer);reject(Error('Cannot connect to installed renderer'))},{once:true})});
  socket.addEventListener('message',event=>{const response=JSON.parse(event.data),request=pending.get(response.id);if(request){pending.delete(response.id);response.error?request.reject(Error(response.error.message)):request.resolve(response.result);}});
  socket.addEventListener('close',()=>{for(const request of pending.values())request.reject(Error('Installed renderer disconnected'));pending.clear();});
  const send=(method,params)=>new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error('Installed renderer verification timed out'));},5000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value)},reject:error=>{clearTimeout(timer);reject(error)}});socket.send(JSON.stringify({id,method,params}));});
  let last;
  try{
    while(Date.now()<deadline){
      const result=await send('Runtime.evaluate',{returnByValue:true,expression:`(()=>{const skip=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='先跳过，稍后配置');if(skip)skip.click();const host=document.querySelector('.character-model-host'),canvas=host?.querySelector('canvas');return {model:host?.dataset.modelReady||'',rendered:canvas?.dataset.rendered==='true',width:canvas?.width||0,height:canvas?.height||0,error:document.querySelector('.model-status.error')?.textContent||''}})()`});
      if(result.exceptionDetails)throw Error('Installed renderer evaluation failed');last=result.result.value;
      if(last.model&&last.rendered&&last.width>0&&last.height>0){
        const visual=await send('Runtime.evaluate',{returnByValue:true,expression:`(()=>{const panel=document.querySelector('.character-panel'),host=document.querySelector('.character-model-host'),canvas=host.querySelector('canvas'),gl=canvas.getContext('webgl2')||canvas.getContext('webgl');document.querySelector('.wardrobe-toggle').click();return {panelBackground:getComputedStyle(panel).backgroundColor,hostBackground:getComputedStyle(host).backgroundColor,webglAlpha:gl?.getContextAttributes()?.alpha,hostOpacity:getComputedStyle(host).opacity}})()`});
        if(visual.exceptionDetails)throw Error('Installed character transparency check failed');const v=visual.result.value;
        if(v.panelBackground!=='rgba(0, 0, 0, 0)'||v.hostBackground!=='rgba(0, 0, 0, 0)'||v.webglAlpha!==true||v.hostOpacity!=='1')throw Error('Installed viewport is not transparent with an opaque character: '+JSON.stringify(v));
        await pause(400);
        const wardrobe=await send('Runtime.evaluate',{returnByValue:true,expression:`(()=>{const panel=document.querySelector('.wardrobe-panel'),host=document.querySelector('.character-model-host'),a=panel?.getBoundingClientRect(),b=host.getBoundingClientRect(),cards=[...document.querySelectorAll('.wardrobe-panel .skin-card')];const value={count:cards.length,labels:cards.map(x=>x.getAttribute('aria-label')),overlap:!!a&&a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top,baseLabel:panel?.textContent.includes('基础版')};document.querySelector('.wardrobe-panel [aria-label="关闭服装面板"]')?.click();return value})()`});
        if(wardrobe.exceptionDetails)throw Error('Installed wardrobe check failed');const w=wardrobe.result.value;
        if(w.count!==7||w.overlap||w.baseLabel)throw Error('Installed wardrobe groups or placement incorrect: '+JSON.stringify(w));
        console.log(JSON.stringify({...last,transparency:v,wardrobe:w}));return {...last,transparency:v,wardrobe:w};
      }
      await pause(500);
    }
    throw Error('Installed character did not render: '+JSON.stringify(last));
  }finally{socket.close();}
}
if(require.main===module){const watchdog=setTimeout(()=>{console.error('Installed model check exceeded 150 seconds');process.exit(1)},150000);watchdog.unref();verify(process.argv[2]).then(()=>{clearTimeout(watchdog);process.stdout.write('',()=>process.exit(0))},error=>{clearTimeout(watchdog);console.error(error.message);process.stderr.write('',()=>process.exit(1))});}
module.exports={verify};
