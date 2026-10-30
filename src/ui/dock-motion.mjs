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
export function snapFrames(from,to){const dx=from.left-to.left,dy=from.top-to.top,sx=from.width/to.width,sy=from.height/to.height;return [{transform:`translate(${dx}px,${dy}px) scale(${sx},${sy})`,offset:0},{transform:`translate(${-Math.max(-12,Math.min(12,dx*.025))}px,0) scale(.995,1.005)`,offset:.72},{transform:'translate(0,0) scale(1,1)',offset:1}]}
export class DockMotion{
 constructor(){this.animation=null}
 cancel(){this.animation?.cancel();this.animation=null}
 rebase(element){const before=element.getBoundingClientRect();this.cancel();const after=element.getBoundingClientRect();return before.left-after.left}
 settle(element,from,reduced=false){this.cancel();if(reduced||!element?.animate||!from)return;const to=element.getBoundingClientRect();if(!to.width||!to.height)return;const animation=element.animate(snapFrames(from,to),{duration:440,easing:'cubic-bezier(.18,.75,.25,1)',fill:'both'});this.animation=animation;animation.finished.catch(()=>{}).finally(()=>{if(this.animation===animation){animation.cancel();this.animation=null}})}
}
