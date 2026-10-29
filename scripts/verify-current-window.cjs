'use strict';
// Operates only on the isolated installed-app profile created by the Windows
// smoke test. No camera, provider, personal profile or network inference is used.
const fs=require('node:fs/promises'),path=require('node:path');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function targets(port){return (await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(2000)})).json();}
async function waitTarget(port,name){for(let i=0;i<100;i++){const target=(await targets(port)).find(item=>item.type==='page'&&item.url.includes(name));if(target)return target;await pause(200)}throw Error('Installed renderer not found: '+name);}
async function connect(target){
 const socket=new WebSocket(target.webSocketDebuggerUrl),pending=new Map();let id=0;
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',()=>reject(Error('Cannot connect to installed renderer')),{once:true})});
 socket.addEventListener('message',event=>{const result=JSON.parse(event.data),entry=pending.get(result.id);if(entry){pending.delete(result.id);result.error?entry.reject(Error(result.error.message)):entry.resolve(result.result);}});
 socket.addEventListener('close',()=>{for(const entry of pending.values())entry.reject(Error('Installed renderer disconnected'));pending.clear();});
 return {close:()=>socket.close(),evaluate:(expression,awaitPromise=false)=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(Error('Renderer check timed out'));},15000);pending.set(n,{resolve:value=>{clearTimeout(timer);value.exceptionDetails?reject(Error(value.exceptionDetails.text)):resolve(value.result.value)},reject:error=>{clearTimeout(timer);reject(error)}});socket.send(JSON.stringify({id:n,method:'Runtime.evaluate',params:{expression,awaitPromise,returnByValue:true}}));})};
}
async function verify(profile){
 const port=Number((await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split(/\r?\n/)[0]);if(!Number.isInteger(port)||port<1)throw Error('No isolated debugger port');
 const main=await connect(await waitTarget(port,'app.asar/dist/index.html'));let model,visual;
 try{
  const layout=await main.evaluate(`(()=>{const panel=document.querySelector('.character-panel'),host=document.querySelector('.character-model-host'),action=document.querySelector('.model-action-picker'),a=action?.getBoundingClientRect(),b=panel.getBoundingClientRect();return {innerRadius:getComputedStyle(host).borderTopLeftRadius,outerRadius:getComputedStyle(panel).borderTopLeftRadius,arrows:!!document.querySelector('.character-dock-tools'),outside:!!a&&(a.right<=b.left||a.left>=b.right),contacts:document.querySelectorAll('.contact-select').length,expand:!!document.querySelector('.contact-expand')}})()`);
  if(parseFloat(layout.innerRadius)<1||parseFloat(layout.outerRadius)<1||layout.arrows||!layout.outside||layout.contacts<1||!layout.expand)throw Error('Installed panel or contacts layout incorrect: '+JSON.stringify(layout));
  await main.evaluate(`window.desktop.companionSet({mode:'model'})`,true);model=await connect(await waitTarget(port,'model-window.html'));
  let ready=false;for(let i=0;i<100&&!ready;i++){ready=await model.evaluate(`!!document.querySelector('.model-window-canvas')?.dataset.modelReady`);if(!ready)await pause(200);}if(!ready)throw Error('Installed desktop character did not load');
  const desktop=await model.evaluate(`(async()=>{const header=document.querySelector('.model-companion header'),canvas=document.querySelector('.model-window-canvas'),before={width:window.outerWidth,height:window.outerHeight,header:header.getBoundingClientRect().width};const reply=document.createElement('span');reply.className='model-reply';reply.textContent='这是一条很长的中文回复。'.repeat(100);header.insertBefore(reply,header.querySelector('button'));const box=reply.getBoundingClientRect(),h=header.getBoundingClientRect(),c=canvas.getBoundingClientRect();await window.companion.call('drag-start');for(let n=0;n<20;n++)await window.companion.call('drag-move');await window.companion.call('drag-end');return {before,after:{width:window.outerWidth,height:window.outerHeight,header:header.getBoundingClientRect().width},replyWidth:box.width,replyHeight:box.height,headerBottom:h.bottom,canvasTop:c.top,replyInside:header.contains(reply)}})()`,true);
  if(desktop.before.width!==desktop.after.width||desktop.before.height!==desktop.after.height||desktop.before.header!==desktop.after.header||!desktop.replyInside||desktop.replyWidth>221||desktop.replyHeight>35||desktop.headerBottom>desktop.canvasTop)throw Error('Desktop header/reply or drag size incorrect: '+JSON.stringify(desktop));
  await model.evaluate(`window.companion.call('vision-open')`,true);visual=await connect(await waitTarget(port,'visual-window.html'));
  let visualReady=false;for(let i=0;i<100&&!visualReady;i++){visualReady=await visual.evaluate(`!!document.querySelector('.visual-panel header button')`);if(!visualReady)await pause(200);}if(!visualReady)throw Error('Visual companion shell did not load');
  const vision=await visual.evaluate(`({panel:!!document.querySelector('.visual-panel'),close:!!document.querySelector('.visual-panel header button'),background:getComputedStyle(document.querySelector('.visual-panel header')).backgroundColor})`);
  if(!vision.panel||!vision.close)throw Error('Visual companion shell missing');
  await main.evaluate(`window.desktop.companionSet({mode:'none'})`,true);console.log(JSON.stringify({layout,desktop,vision}));
 }finally{visual?.close();model?.close();main.close();}
}
if(require.main===module)verify(process.argv[2]).then(()=>process.stdout.write('',()=>process.exit(0)),error=>{console.error(error.message);process.stderr.write('',()=>process.exit(1));});
module.exports={verify};
