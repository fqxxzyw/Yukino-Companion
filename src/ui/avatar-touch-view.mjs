import {createAvatarTouchGesture} from './avatar-touch.mjs';

export const touchReactionId = Object.freeze({
 shy:'shy_talking', happy:'happy', chide:'pout', boundary:'angry',
});

export function playTouchReaction(renderer,feedback){
 const id=touchReactionId[feedback?.reaction];
 if(id)renderer?.reactToTouch?.(id);
}

export function startAvatarGesture(event,renderer,enabled,yaw){
 const gesture=createAvatarTouchGesture({hitZone:(x,y)=>enabled?renderer?.touchZone?.(x,y):null});
 gesture.begin(event);
 return {id:event.pointerId,x:event.clientX,yaw,gesture,renderer};
}

export function moveAvatarGesture(event,gesture){
 return gesture.gesture.move(event);
}

export function finishAvatarGesture(event,gesture,renderer){
 return gesture.renderer===renderer?gesture.gesture.end(event):null;
}
