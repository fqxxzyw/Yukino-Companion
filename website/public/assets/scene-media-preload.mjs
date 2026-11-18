// Compressed assets only. The actual scene modules own the active decoders.
import {isDataConstrained} from './media-warm.mjs?v=14';

const queued=new Map(), stored=new Map(), failed=new Set();
const narrow=matchMedia('(max-width:680px)').matches;
const budget=(narrow?22:52)*1024*1024;
let used=0, active=0, background=0, scheduled=false;
const home=()=>location.pathname==='/'&&!document.hidden;
function schedule(){
  if(scheduled)return;
  scheduled=true;
  setTimeout(()=>{scheduled=false; drain();},0);
}
function drain(){
  if(!home())return;
  while(active<2){
    const next=[...queued.values()].filter(x=>!x.running&&(x.high||background<1))
      .sort((a,b)=>Number(b.high)-Number(a.high))[0];
    if(!next)return;
    const low=!next.high;
    if(isDataConstrained()){
      queued.delete(next.url);next.done(null);continue;
    }
    next.running=true;
    active++;
    if(low)background++;
    const signal=typeof AbortSignal.timeout==='function'?AbortSignal.timeout(next.video?35000:12000):undefined;
    void fetch(next.url,{credentials:'same-origin',cache:'force-cache',signal})
      .then(async response=>{
        if(!response.ok)return null;
        const max=next.video?14*1024*1024:2*1024*1024;
        const length=Number(response.headers.get('content-length')||0);
        if(length>max)return null;
        const type=response.headers.get('content-type')||'';
        if(/text\/html|application\/json/i.test(type))return null;
        const blob=await response.blob();
        if(!blob.size||blob.size>max)return null;
        const mime=next.video?'video/mp4':'image/webp';
        return blob.type.startsWith(next.video?'video/':'image/')?blob:new Blob([blob],{type:mime});
      }).catch(()=>null).then(blob=>{
        queued.delete(next.url);
        active--;
        if(low)background--;
        if(blob){
          while(used+blob.size>budget&&stored.size){
            const url=stored.keys().next().value;
            used-=stored.get(url).size;
            stored.delete(url);
          }
          stored.set(next.url,blob);used+=blob.size;
        }else failed.add(next.url);
        next.done(blob);
        schedule();
      });
  }
}

export function getSceneMedia(path,priority='low'){
  if(!path||isDataConstrained())return Promise.resolve(null);
  const url=new URL(path,location.href);
  if(url.origin!==location.origin)return Promise.resolve(null);
  const key=url.href, item=stored.get(key);
  if(item){
    stored.delete(key);stored.set(key,item);
    return Promise.resolve(item);
  }
  if(failed.has(key))return Promise.resolve(null);
  const known=queued.get(key), high=priority==='high';
  if(known){if(high)known.high=true;schedule();return known.promise;}
  const next={url:key,video:url.pathname.endsWith('.mp4'),high,running:false};
  next.promise=new Promise(resolve=>{next.done=resolve;});
  queued.set(key,next);schedule();
  return next.promise;
}

// A viewport/aspect change replaces the pending background plan, but never
// cancels a selected shot or touches any video currently playing.
export function prefetchScenePlan(paths){
  const plan=new Set(paths.filter(Boolean).map(path=>new URL(path,location.href).href));
  for(const [key,item] of queued){
    if(!item.high&&!item.running&&!plan.has(key)){
      queued.delete(key);item.done(null);
    }
  }
  for(const path of plan)void getSceneMedia(path);
  schedule();
}
document.addEventListener('visibilitychange',schedule);
window.addEventListener('popstate',schedule);
