// FLIP: preserve the visual rectangle across grid relocation, then settle locally.
// A new gesture rebases from the current painted position rather than an old endpoint.
export function dockTarget(x,left,width,previous){const midpoint=left+width/2,margin=Math.min(18,width*.025);if(previous==='left'&&x<midpoint+margin)return 'left';if(previous==='right'&&x>midpoint-margin)return 'right';return x<midpoint?'left':'right'}
export function snapFrames(from,to){const dx=from.left-to.left,dy=from.top-to.top,sx=from.width/to.width,sy=from.height/to.height;return [{transform:`translate(${dx}px,${dy}px) scale(${sx},${sy})`,offset:0},{transform:`translate(${-Math.max(-12,Math.min(12,dx*.025))}px,0) scale(.995,1.005)`,offset:.72},{transform:'translate(0,0) scale(1,1)',offset:1}]}
export class DockMotion{
 constructor(){this.animation=null}
 cancel(){this.animation?.cancel();this.animation=null}
 rebase(element){const before=element.getBoundingClientRect();this.cancel();const after=element.getBoundingClientRect();return before.left-after.left}
 settle(element,from,reduced=false){this.cancel();if(reduced||!element?.animate||!from)return;const to=element.getBoundingClientRect();if(!to.width||!to.height)return;const animation=element.animate(snapFrames(from,to),{duration:440,easing:'cubic-bezier(.18,.75,.25,1)',fill:'both'});this.animation=animation;animation.finished.catch(()=>{}).finally(()=>{if(this.animation===animation){animation.cancel();this.animation=null}})}
}
