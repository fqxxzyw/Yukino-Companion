import {animeReplyCue} from './reaction-cue.mjs';

const expressionPose={
 heart:{ParamYukinoSmile:.42},broken_heart:{ParamBrowLY:.24,ParamBrowRY:.24},
 surprise:{ParamBrowLY:.62,ParamBrowRY:.62},confused:{ParamBrowLY:.36,ParamBrowRY:-.18},
 angry:{ParamBrowLY:-.50,ParamBrowRY:-.50},embarrassed:{ParamYukinoSmile:.12,ParamBrowLY:.15},
 shy_talking:{ParamYukinoSmile:.23},flustered:{ParamBrowLY:.35,ParamBrowRY:.22},
 happy:{ParamYukinoSmile:.62},pout:{ParamBrowLY:-.42,ParamBrowRY:-.42},
};
const smooth=value=>{const x=Math.max(0,Math.min(1,value));return x*x*(3-2*x);};

// The Windows shell provides the prepared, local-only Cubism viewer.
export async function createLive2DView(host,{audioPlayer,onStatus,viewerUrl,onFirstFrame,debug=false}={}){
 const url=viewerUrl===undefined?await window.desktop?.live2dViewer?.():viewerUrl;
 if(!url)throw Error('这台电脑还没有准备 Live2D 雪乃，可以切回 3D 服装。');
 if(!host)throw new DOMException('人物窗口已关闭','AbortError');
 const {Live2DAvatarRenderer}=await import('./live2d/renderer-ipc.mjs');
 const renderer=new Live2DAvatarRenderer(host,{viewerUrl:url,audioPlayer,debug,onError:error=>onStatus?.({phase:'error',message:error.message})});
 renderer.isLive2D=true;
 let frame=null,disposed=false;
 const dispose=renderer.dispose.bind(renderer);
 const reset=renderer.reset.bind(renderer);
 const clearReaction=()=>{if(frame!==null)cancelAnimationFrame(frame);frame=null;delete host.dataset.animeReaction;renderer.setPoseParameters?.({});};
 renderer.reset=options=>{clearReaction();reset(options);};
 renderer.setView=({zoom=1}={})=>{
  zoom=Math.max(1,Math.min(2.2,Number(zoom)||1));
  renderer.frame.style.transformOrigin='50% 38%';
  renderer.frame.style.transform=zoom===1?'':`scale(${zoom})`;
  return {zoom,yaw:0};
 };
 renderer.touchZone=(x,y)=>{
  if(!renderer.hitTest(x,y)||!renderer.silhouette)return null;
  const {width,height}=renderer.silhouette,rect=renderer.frame.getBoundingClientRect();
  const scale=Math.min(rect.width/width,rect.height/height);
  const u=(x-rect.left-(rect.width-width*scale)/2)/(width*scale);
  const v=(y-rect.top-(rect.height-height*scale)/2)/(height*scale);
  // These small zones belong to the supplied Yukino S0 artwork.
  if(v>=.025&&v<=.175&&Math.abs(u-.5)<=.15)return 'head';
  if(v>=.245&&v<=.34&&Math.abs(u-.5)<=.09)return 'face';
  if(v>=.36&&v<=.41&&Math.abs(u-.5)>=.115&&Math.abs(u-.5)<=.19)return 'near';
  return null;
 };
 renderer.reactToExpression=id=>{
  if(disposed||!Object.hasOwn(expressionPose,id))return false;
  clearReaction();
  const started=performance.now(),values=expressionPose[id];
  host.dataset.animeReaction=id;
  const update=now=>{
   if(disposed)return;
   const elapsed=(now-started)/1000;
   if(elapsed>=3.5){clearReaction();return;}
   const strength=smooth(elapsed/.35)*smooth((3.5-elapsed)/.55);
   const speech=audioPlayer?.getSnapshot?.();
   const speaking=speech?.playing&&!speech.paused;
   renderer.setPoseParameters?.(Object.fromEntries(Object.entries(values).filter(([key])=>!speaking||key!=='ParamYukinoSmile').map(([key,value])=>[key,value*strength])));
   frame=requestAnimationFrame(update);
  };
  frame=requestAnimationFrame(update);
  return true;
 };
 renderer.reactToTouch=renderer.reactToExpression;
 renderer.reactToReply=text=>renderer.reactToExpression(animeReplyCue(text));
 renderer.dispose=()=>{disposed=true;clearReaction();delete host.dataset.live2dReady;dispose();};
 renderer.ready.then(()=>{if(disposed)return;host.dataset.live2dReady='true';renderer.supportsAnimeReactions=true;onStatus?.({phase:'ready',message:'Live2D 雪乃'});onFirstFrame?.();},()=>{});
 return renderer;
}
