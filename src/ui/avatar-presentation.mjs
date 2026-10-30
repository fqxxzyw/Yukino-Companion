import {defaultWallpaperConfig} from './bundled-wallpapers.mjs';
export const SCENES=Object.freeze({
 classroom:{label:'教室',background:'linear-gradient(145deg,#f6ebd5,#dce6df 58%,#f8f6eb)',lighting:{ambient:.8,key:1.1,color:'#fff1d1',direction:[-3,5,2]}},
 studio:{label:'静室',background:'linear-gradient(145deg,#f3f7fd,#eaf1fb 58%,#f7faff)',lighting:{ambient:0.75,key:1.1,color:'#eaf3ff',direction:[-2,3,4]}},
 forest:{label:'森林',background:'radial-gradient(ellipse at 20% 0%,#fff9db 0,transparent 48%),linear-gradient(145deg,#edf4e8,#bfd2c0 58%,#e4eddd)',lighting:{ambient:0.55,key:1.2,color:'#fff2c9',direction:[-3,6,2]}},
 beach:{label:'海边',background:'linear-gradient(175deg,#d7eef9 0%,#b9deee 48%,#d5eced 49%,#f5ead8 85%)',lighting:{ambient:0.85,key:1.35,color:'#fff8e9',direction:[3,5,4]}},
 city:{label:'城市',background:'radial-gradient(ellipse at 85% 20%,#f1e4ee,transparent 55%),linear-gradient(155deg,#e7ecf8,#b8c6dd 65%,#dce3ee)',lighting:{ambient:0.55,key:0.9,color:'#dce7ff',direction:[-4,3,3]}}
});
export const PRESENTATION_DEFAULTS=Object.freeze({scene:'studio',spread:false,gaze:true,wardrobeOpen:false,timeOfDay:'noon',renderStyle:'lit'});
export function presentationConfig(value={}){const raw=value.wallpaper||defaultWallpaperConfig(),seen=new Set(),items=(Array.isArray(raw.items)?raw.items:[]).filter(item=>item&&typeof item.id==='string'&&/^[a-f0-9]{64}$/.test(item.id)&&!seen.has(item.id)&&seen.add(item.id)).slice(0,20).map(item=>({id:item.id,name:typeof item.name==='string'?item.name.slice(0,120):'壁纸'}));const wallpaper={items,enabled:raw.enabled===true,rotation:raw.rotation===true,opacity:typeof raw.opacity==='number'&&Number.isFinite(raw.opacity)?Math.max(0,Math.min(1,raw.opacity)):1,intervalSeconds:Math.min(3600,Math.max(10,Number(raw.intervalSeconds)||300))};return {wallpaper,scene:SCENES[value.scene]?value.scene:'studio',spread:value.spread===true,gaze:value.gaze!==false,wardrobeOpen:value.wardrobeOpen===true,timeOfDay:['morning','noon','evening'].includes(value.timeOfDay)?value.timeOfDay:'noon',renderStyle:['natural','toon'].includes(value.renderStyle)?value.renderStyle:'lit'};}
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
 setEnvironment(id){const scene=SCENES[id]||SCENES.studio;this.renderer?.setEnvironment?.({id:SCENES[id]?id:'studio',lighting:scene.lighting});}
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
