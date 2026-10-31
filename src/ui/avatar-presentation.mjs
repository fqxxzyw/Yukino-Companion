import {defaultWallpaperConfig} from './bundled-wallpapers.mjs';
import {SCENES,sceneId} from './scene-catalog.mjs';
export {SCENES} from './scene-catalog.mjs';
export const PRESENTATION_DEFAULTS=Object.freeze({scene:'classroom',spread:false,gaze:true,wardrobeOpen:false,timeOfDay:'noon',renderStyle:'lit'});
export function presentationConfig(value={}){const raw=value.wallpaper||defaultWallpaperConfig(),seen=new Set(),items=(Array.isArray(raw.items)?raw.items:[]).filter(item=>item&&typeof item.id==='string'&&/^[a-f0-9]{64}$/.test(item.id)&&!seen.has(item.id)&&seen.add(item.id)).slice(0,20).map(item=>({id:item.id,name:typeof item.name==='string'?item.name.slice(0,120):'壁纸'}));const wallpaper={items,enabled:raw.enabled===true,rotation:raw.rotation===true,opacity:typeof raw.opacity==='number'&&Number.isFinite(raw.opacity)?Math.max(0,Math.min(1,raw.opacity)):1,intervalSeconds:Math.min(3600,Math.max(10,Number(raw.intervalSeconds)||300))};return {wallpaper,scene:sceneId(value.scene),spread:value.spread===true,gaze:value.gaze!==false,wardrobeOpen:value.wardrobeOpen===true,timeOfDay:['morning','noon','evening'].includes(value.timeOfDay)?value.timeOfDay:'noon',renderStyle:['natural','toon'].includes(value.renderStyle)?value.renderStyle:'lit'};}
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
export function gazeTarget(x,y,width,height,inside=true){
 if(!inside||!(width>0&&height>0)||![x,y].every(Number.isFinite))return {eyeX:0,eyeY:0,headYaw:0,headPitch:0};
 const nx=clamp(x/width*2-1,-1,1),ny=clamp(y/height*2-1,-1,1);
 return {eyeX:nx*.35,eyeY:ny*.25,headYaw:nx*12,headPitch:-ny*7};
}
export function smoothGaze(previous,target,elapsedMs){const alpha=1-Math.exp(-clamp(elapsedMs||0,0,100)/120);return Object.fromEntries(Object.keys(target).map(key=>[key,(previous[key]||0)+(target[key]-(previous[key]||0))*alpha]));}
export function revealOrigin(panel,viewport){if(!panel||!viewport?.width||!viewport?.height)return {x:50,y:50};return {x:clamp(((panel.left+panel.width/2-viewport.left)/viewport.width)*100,0,100),y:clamp(((panel.top+panel.height/2-viewport.top)/viewport.height)*100,0,100)};}
// Renderer contract shared by future VRM/GLB and Live2D adapters. No rig/model is
// synthesized here. All promises finish only when the adapter's animation ends.
export class AvatarPresentationController{
 constructor(renderer,{greet}={}){this.renderer=renderer;this.greet=greet||((options)=>renderer?.greet?.(options));this.active=null;this.outfit=null;}
 setEnvironment(id){const safeId=sceneId(id);this.renderer?.setEnvironment?.({id:safeId,lighting:SCENES[safeId].lighting});}
 setGaze(target){this.renderer?.setGaze?.(target);}
 changeOutfit(id,{reducedMotion=false}={}){
  if(!this.renderer)return Promise.reject(Error('人物模型尚未接入，暂时不能切换服装。'));
  if(this.disposed)return Promise.reject(Error('人物区域已关闭。'));
  if(!id||typeof id!=='string')return Promise.resolve(false);
  this.active?.abort();const prior=this.pending;
  const controller=new AbortController();this.active=controller;const signal=controller.signal;
  const job=(async()=>{
   // Latest selection wins. Wait for cancellation/disposal of a previous load
   // instead of rejecting the newly selected outfit and leaving it unloaded.
   if(prior)await prior.catch(()=>{});signal.throwIfAborted();
   if(id===this.outfit)return false;
   const previous=this.outfit;let prepared=null,committed=false;
   try{
    prepared=await this.renderer.prepareOutfit(id,{signal});signal.throwIfAborted();
    if(!reducedMotion)await this.renderer.exit({direction:'left',signal});signal.throwIfAborted();
    await this.renderer.commitOutfit(prepared,{signal});committed=true;this.outfit=id;signal.throwIfAborted();
    if(!reducedMotion)await this.renderer.enter({direction:'right',signal});signal.throwIfAborted();
    await this.greet({outfitId:id,signal});return true;
   }catch(error){this.renderer.resetTransition?.();if(prepared&&!committed)this.renderer.disposePrepared?.(prepared);if(!signal.aborted&&previous&&this.renderer.restoreOutfit)await this.renderer.restoreOutfit(previous).catch(()=>{});throw error;}
  })();
  this.pending=job;
  return job.finally(()=>{if(this.active===controller)this.active=null;if(this.pending===job)this.pending=null;});
 }

 dispose(){this.disposed=true;this.active?.abort();this.renderer?.setGaze?.(gazeTarget(0,0,0,0,false));}
}
