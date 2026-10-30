// Card previews stay in memory. A single rendering slot avoids opening a WebGL
// context for every character; cancelled/failed jobs never populate the cache.
export function createModelPreviewQueue(render,{limit=20}={}){
 const cache=new Map();let tail=Promise.resolve();
 return {async get(entry,{signal,api}={}){
  if(!entry?.custom||!entry.ready||!entry.id||!entry.sha256)throw Error('模型暂不可预览');
  const key=entry.id+':'+entry.sha256;signal?.throwIfAborted();
  if(cache.has(key))return cache.get(key);
  const task=tail.catch(()=>{}).then(async()=>{
   signal?.throwIfAborted();if(cache.has(key))return cache.get(key);
   const result=await render(entry,{signal,api});signal?.throwIfAborted();
   if(typeof result!=='string'||!result.startsWith('data:image/png;base64,'))throw Error('模型截图未生成');
   cache.set(key,result);while(cache.size>limit)cache.delete(cache.keys().next().value);return result;
  });tail=task.catch(()=>{});return task;
 },clear(){cache.clear();}};
}
export async function renderModelCardPreview(entry,{signal,api}={}){
 const {GlbAvatarRenderer}=await import('./model-runtime.mjs');signal?.throwIfAborted();
 const host=document.createElement('div');host.setAttribute('aria-hidden','true');
 Object.assign(host.style,{position:'fixed',left:'-1000px',top:'0',width:'240px',height:'320px',pointerEvents:'none'});document.body.append(host);
 let renderer,prepared,timer;
 const cleanup=()=>{const active=renderer;renderer=null;if(active){active.dispose();active.gl.forceContextLoss?.();}host.remove();};
 const cancelled=()=>cleanup();signal?.addEventListener('abort',cancelled,{once:true});
 try{
  renderer=new GlbAvatarRenderer(host,{catalog:[entry],api,reducedMotion:true,renderEnvironment:false});
  const active=renderer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{cleanup();reject(Error('模型截图超时'));},20000);});
  return await Promise.race([(async()=>{
   prepared=await active.prepareOutfit(entry.id,{signal});signal?.throwIfAborted();
   if(active.disposed){active.disposePrepared(prepared);prepared=null;throw Error('模型截图已取消');}
   await active.commitOutfit(prepared);prepared=null;signal?.throwIfAborted();
   active.gl.render(active.scene,active.camera);
   return active.gl.domElement.toDataURL('image/png');
  })(),timeout]);
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancelled);if(prepared&&renderer&&!renderer.disposed)renderer.disposePrepared(prepared);cleanup();}
}
export const modelCardPreviews=createModelPreviewQueue(renderModelCardPreview);
