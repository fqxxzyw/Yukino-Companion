'use strict';
// Operates only on the isolated installed-app profile created by the Windows
// smoke test. No camera, provider, personal profile or network inference is used.
const fs=require('node:fs/promises'),path=require('node:path'),{execFileSync}=require('node:child_process');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function targets(port){return (await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(2000)})).json();}
async function waitTarget(port,name){for(let i=0;i<100;i++){const target=(await targets(port)).find(item=>item.type==='page'&&item.url.includes(name));if(target)return target;await pause(200)}throw Error('Installed renderer not found: '+name);}
async function connect(target){
 const socket=new WebSocket(target.webSocketDebuggerUrl),pending=new Map();let id=0;
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{try{socket.close()}catch{}reject(Error('Installed renderer connection timed out'))},10000);socket.addEventListener('open',()=>{clearTimeout(timer);resolve()},{once:true});socket.addEventListener('error',()=>{clearTimeout(timer);reject(Error('Cannot connect to installed renderer'))},{once:true})});
 socket.addEventListener('message',event=>{const result=JSON.parse(event.data),entry=pending.get(result.id);if(entry){pending.delete(result.id);result.error?entry.reject(Error(result.error.message)):entry.resolve(result.result);}});
 socket.addEventListener('close',()=>{for(const entry of pending.values())entry.reject(Error('Installed renderer disconnected'));pending.clear();});
 return {close:()=>socket.close(),evaluate:(expression,awaitPromise=false)=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(Error('Renderer check timed out'));},15000);pending.set(n,{resolve:value=>{clearTimeout(timer);value.exceptionDetails?reject(Error(value.exceptionDetails.text)):resolve(value.result.value)},reject:error=>{clearTimeout(timer);reject(error)}});socket.send(JSON.stringify({id:n,method:'Runtime.evaluate',params:{expression,awaitPromise,returnByValue:true}}));})};
}
async function verify(profile){
 const port=Number((await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split(/\r?\n/)[0]);if(!Number.isInteger(port)||port<1)throw Error('No isolated debugger port');
 console.log('Installed check: connect main renderer');
 const main=await connect(await waitTarget(port,'app.asar/dist/index.html'));let model,visual;
 try{
  let layout;
  for(let i=0;i<100;i++){
   layout=await main.evaluate(`(()=>{const panel=document.querySelector('.character-panel'),host=document.querySelector('.character-model-host'),action=document.querySelector('.model-action-picker'),a=action?.getBoundingClientRect(),b=panel.getBoundingClientRect();return {innerRadius:getComputedStyle(host).borderTopLeftRadius,outerRadius:getComputedStyle(panel).borderTopLeftRadius,arrows:!!document.querySelector('.character-dock-tools'),actionPresent:!!a,actionInside:!!a&&a.left>=b.left-1&&a.right<=b.right+1&&a.top>=b.top-1&&a.bottom<=b.bottom+1,contacts:document.querySelectorAll('.contact-select').length,expand:!!document.querySelector('.contact-expand')}})()`);
   if(layout.contacts&&layout.expand)break;await pause(200);
  }
  if(parseFloat(layout.innerRadius)<1||parseFloat(layout.outerRadius)<1||layout.arrows||layout.actionPresent||layout.contacts<1||!layout.expand)throw Error('Installed panel or contacts layout incorrect: '+JSON.stringify(layout));
  console.log('Installed check: panel and contacts verified');
  await main.evaluate(`window.desktop.copyText('Yukino clipboard verification')`,true);
  const copied=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Sta','-Command','Get-Clipboard -Raw'],{encoding:'utf8',timeout:15000}).trim();
  if(copied!=='Yukino clipboard verification')throw Error('Native Windows clipboard did not contain the requested text');
  const opened=await main.evaluate(`(()=>{const button=document.querySelector('button[title="声音与语音"]');button?.click();return !!button})()`);if(!opened)throw Error('Voice settings entry not found');
  let voiceReady=false;for(let i=0;i<80&&!voiceReady;i++){voiceReady=await main.evaluate(`[...document.querySelectorAll('button')].filter(button=>button.textContent.includes('下载此文件')).length===2`);if(!voiceReady)await pause(200);}if(!voiceReady)throw Error('Separate voice file download buttons not shown');
  await main.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='检查 / 一键配置').click()`);
  let setupReady=false;for(let i=0;i<80&&!setupReady;i++){setupReady=await main.evaluate(`!!document.querySelector('.setup-dialog')`);if(!setupReady)await pause(200);}if(!setupReady)throw Error('Setup dialog did not open');
  const switches=await main.evaluate(`(()=>{const items=[...document.querySelectorAll('.setup-features input[role="switch"]')];return {count:items.length,disabled:items.filter(item=>item.disabled).length}})()`);
  if(switches.count!==4||switches.disabled)throw Error('Setup feature switches are unavailable: '+JSON.stringify(switches));
  console.log('Installed check: voice settings and setup controls verified');
  await main.evaluate(`document.querySelector('.setup-dialog header button').click();document.querySelector('button[aria-label="关闭设置"]').click()`);
  await main.evaluate(`window.desktop.companionSet({mode:'model'})`,true);model=await connect(await waitTarget(port,'model-window.html'));
  let ready=false;for(let i=0;i<100&&!ready;i++){ready=await model.evaluate(`!!document.querySelector('.model-window-canvas')?.dataset.modelReady`);if(!ready)await pause(200);}if(!ready)throw Error('Installed desktop character did not load');
  console.log('Installed check: desktop model ready');
  const desktop=await model.evaluate(`(async()=>{const header=document.querySelector('.model-companion header'),before={width:window.outerWidth,height:window.outerHeight,header:header.getBoundingClientRect().width};const reply=document.createElement('div');reply.className='model-reply';reply.textContent='这是一条很长的中文回复。'.repeat(100);const button=header.querySelector('button');header.insertBefore(reply,button);const box=reply.getBoundingClientRect(),h=header.getBoundingClientRect(),firstButton=button.getBoundingClientRect();reply.scrollTop=reply.scrollHeight;const lastButton=button.getBoundingClientRect();await window.companion.call('drag-start');for(let n=0;n<20;n++)await window.companion.call('drag-move');await window.companion.call('drag-end');return {before,after:{width:window.outerWidth,height:window.outerHeight,header:header.getBoundingClientRect().width},replyWidth:box.width,replyHeight:box.height,replyInside:header.contains(reply)&&box.left>=h.left-1&&box.right<=h.right+1&&box.top>=h.top-1&&box.bottom<=h.bottom+1,scrollable:reply.scrollHeight>reply.clientHeight&&reply.scrollTop>0,wrapped:reply.scrollWidth<=reply.clientWidth+1,buttonFixed:Math.abs(firstButton.left-lastButton.left)<1&&Math.abs(firstButton.top-lastButton.top)<1,headerBottom:h.bottom,viewportHeight:innerHeight}})()`,true);
  if(desktop.before.width!==desktop.after.width||desktop.before.height!==desktop.after.height||desktop.before.header!==desktop.after.header||!desktop.replyInside||!desktop.scrollable||!desktop.wrapped||!desktop.buttonFixed||desktop.replyWidth<=0||desktop.replyHeight>161||desktop.headerBottom>desktop.viewportHeight-40)throw Error('Desktop header/reply or drag size incorrect: '+JSON.stringify(desktop));
  console.log('Installed check: desktop reply and drag verified');
  await model.evaluate(`window.companion.call('vision-open')`,true);visual=await connect(await waitTarget(port,'visual-window.html'));
  let visualReady=false;for(let i=0;i<100&&!visualReady;i++){visualReady=await visual.evaluate(`!!document.querySelector('.visual-panel header button')`);if(!visualReady)await pause(200);}if(!visualReady)throw Error('Visual companion shell did not load');
  const vision=await visual.evaluate(`({panel:!!document.querySelector('.visual-panel'),close:!!document.querySelector('.visual-panel header button'),background:getComputedStyle(document.querySelector('.visual-panel header')).backgroundColor})`);
  if(!vision.panel||!vision.close)throw Error('Visual companion shell missing');
  await main.evaluate(`window.desktop.companionSet({mode:'none'})`,true);console.log(JSON.stringify({layout,clipboard:true,voiceFiles:true,switches,desktop,vision}));
 }finally{visual?.close();model?.close();main.close();}
}
if(require.main===module){const watchdog=setTimeout(()=>{console.error('Installed feature check exceeded 150 seconds');process.exit(1)},150000);watchdog.unref();verify(process.argv[2]).then(()=>{clearTimeout(watchdog);process.stdout.write('',()=>process.exit(0))},error=>{clearTimeout(watchdog);console.error(error.message);process.stderr.write('',()=>process.exit(1));});}
module.exports={verify};
