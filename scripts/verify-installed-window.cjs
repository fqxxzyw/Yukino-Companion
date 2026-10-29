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
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',()=>reject(Error('Cannot connect to installed renderer')),{once:true})});
  socket.addEventListener('message',event=>{const response=JSON.parse(event.data),request=pending.get(response.id);if(request){pending.delete(response.id);response.error?request.reject(Error(response.error.message)):request.resolve(response.result);}});
  socket.addEventListener('close',()=>{for(const request of pending.values())request.reject(Error('Installed renderer disconnected'));pending.clear();});
  const send=(method,params)=>new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error('Installed renderer verification timed out'));},5000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value)},reject:error=>{clearTimeout(timer);reject(error)}});socket.send(JSON.stringify({id,method,params}));});
  let last;
  try{
    while(Date.now()<deadline){
      const result=await send('Runtime.evaluate',{returnByValue:true,expression:`(()=>{const skip=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='先跳过，稍后配置');if(skip)skip.click();const host=document.querySelector('.character-model-host'),canvas=host?.querySelector('canvas');return {model:host?.dataset.modelReady||'',rendered:canvas?.dataset.rendered==='true',width:canvas?.width||0,height:canvas?.height||0,error:document.querySelector('.model-status.error')?.textContent||''}})()`});
      if(result.exceptionDetails)throw Error('Installed renderer evaluation failed');last=result.result.value;
      if(last.model&&last.rendered&&last.width>0&&last.height>0){console.log(JSON.stringify(last));return last;}
      await pause(500);
    }
    throw Error('Installed character did not render: '+JSON.stringify(last));
  }finally{socket.close();}
}
if(require.main===module)verify(process.argv[2]).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={verify};
