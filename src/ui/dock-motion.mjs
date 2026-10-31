// FLIP: preserve the visual rectangle across grid relocation, then settle locally.
// A new gesture rebases from the current painted position rather than an old endpoint.
export function dockTarget(x,left,width,previous){const midpoint=left+width/2,margin=Math.min(18,width*.025);if(previous==='left'&&x<midpoint+margin)return 'left';if(previous==='right'&&x>midpoint-margin)return 'right';return x<midpoint?'left':'right'}
// The frame follows the pointer exactly; its *shape* alone gently stretches
// with the speed of the drag and springs back when the pointer stops. Keeping
// the response bounded avoids a tilted or visibly distorted character.
export function dragStretch(dx,dt){return Math.min(.035,Math.abs(Number(dx)||0)/Math.max(8,Math.min(80,Number(dt)||16))*.014)}
export function advanceDragStretch(state,target,elapsed){
 const dt=Math.max(0,Math.min(32,Number(elapsed)||0));
 const position=Number.isFinite(state?.position)?state.position:0,velocity=Number.isFinite(state?.velocity)?state.velocity:0;
 const goal=Math.max(0,Math.min(.035,Number(target)||0));
 const nextVelocity=(velocity+(goal-position)*.00022*dt)*Math.exp(-.014*dt);
 return {position:Math.max(-.012,Math.min(.045,position+nextVelocity*dt)),velocity:nextVelocity};
}
export function dragOffset(pointerX,gesture,bounds){
 const left=bounds.left,right=Math.max(left,bounds.right-gesture.width);
 const position=gesture.left+pointerX-gesture.startX;
 return Math.max(left,Math.min(right,position))-gesture.left;
}
export const DOCK_SETTLE_MS=720;
export function snapFrames(from,to,{rebound=true}={}){
 const dx=from.left-to.left,dy=from.top-to.top,sx=from.width/to.width,sy=from.height/to.height;
 // Ease into the move rather than launching at full speed. Most time belongs
 // to the approach; the small, bounded rebound has its own gentle deceleration.
 return [
  {transform:`translate(${dx}px,${dy}px) scale(${sx},${sy})`,offset:0,easing:'cubic-bezier(.32,0,.2,1)'},
  {transform:rebound?`translate(${-Math.max(-6,Math.min(6,dx*.015))}px,0) scale(.998,1.002)`:'translate(0,0) scale(1,1)',offset:.82,easing:'cubic-bezier(.2,.65,.3,1)' },
  {transform:'translate(0,0) scale(1,1)',offset:1}
 ];
}
export class DockMotion{
 constructor(){this.animation=null}
 cancel(){this.animation?.cancel();this.animation=null}
 rebase(element){const before=element.getBoundingClientRect();this.cancel();const after=element.getBoundingClientRect();return before.left-after.left}
 settle(element,from,reduced=false,options={}){this.cancel();if(reduced||!element?.animate||!from)return;const to=element.getBoundingClientRect();if(!to.width||!to.height||from.left===to.left&&from.top===to.top&&from.width===to.width&&from.height===to.height)return;const animation=element.animate(snapFrames(from,to,options),{duration:DOCK_SETTLE_MS,easing:'linear',fill:'both'});this.animation=animation;animation.finished.catch(()=>{}).finally(()=>{if(this.animation===animation){animation.cancel();this.animation=null}})}
}
