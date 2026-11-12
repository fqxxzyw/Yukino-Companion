// Test the dragged panel's swept rectangle against the projected board polygon.
// The board can be perspective-skewed, so bounding-box overlap alone is not enough.
export function intersectsBoard(rect,points){
 if(!rect||![rect.left,rect.right,rect.top,rect.bottom].every(Number.isFinite)||rect.right<=rect.left||rect.bottom<=rect.top||!Array.isArray(points)||points.length!==4||points.some(point=>!Number.isFinite(point?.x)||!Number.isFinite(point?.y)))return false;
 const panel=[{x:rect.left,y:rect.top},{x:rect.right,y:rect.top},{x:rect.right,y:rect.bottom},{x:rect.left,y:rect.bottom}];
 const axes=[{x:1,y:0},{x:0,y:1},...points.map((point,index)=>{const next=points[(index+1)%points.length];return {x:next.y-point.y,y:point.x-next.x};})];
 return axes.every(axis=>{
  const board=points.map(point=>point.x*axis.x+point.y*axis.y),frame=panel.map(point=>point.x*axis.x+point.y*axis.y);
  return Math.max(...board)>Math.min(...frame)&&Math.max(...frame)>Math.min(...board);
 });
}

export function sweepBoard(controller,rect,submit){
 if(!controller||!intersectsBoard(rect,controller.project()?.points))return false;
 // The receipt includes both layers as they appeared before the wipe.
 const snapshot=controller.snapshot();
 controller.setAssistantText('');
 if(snapshot)submit(snapshot);
 return true;
}
