// Genuine in-place gait contract. Net travel belongs only to the outer wrapper;
// authored Root sway/bob/contact tracks are never removed or rewritten.
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const smooth=x=>{const t=clamp(x,0,1);return t*t*(3-2*t)};
const integratedSmooth=x=>{const t=clamp(x,0,1);return t*t*t-.5*t*t*t*t};
const mod=(x,n)=>(x%n+n)%n;
export function walkingContract(entry,clips){
 const value=entry?.walking;if(!value)return null;
 const clip=clips?.get(value.clip),numbers=['durationSeconds','strideModelUnits','speedModelUnitsPerSecond','sourceHeight'];
 if(numbers.some(key=>!Number.isFinite(value[key])||value[key]<=0)||!clip||Math.abs(clip.duration-value.durationSeconds)>.002||entry.clips?.[value.clip]?.loop!==true||Math.abs(value.strideModelUnits/value.durationSeconds-value.speedModelUnitsPerSecond)>.00001)throw Error('行走动作或步幅合同不一致。');
 if(!Array.isArray(value.forwardAxis)||value.forwardAxis.length!==3||value.forwardAxis.some(x=>!Number.isFinite(x))||Math.abs(value.forwardAxis[1])>.0001||Math.abs(Math.hypot(...value.forwardAxis)-1)>.001||!Number.isFinite(value.floorOffsetModelUnits)||value.floorOffsetModelUnits<0||value.floorOffsetModelUnits>.01||!Array.isArray(value.contactAnchors)||!value.contactAnchors.length||value.contactAnchors.some(x=>!Number.isFinite(x)||x<0||x>=value.durationSeconds))throw Error('行走方向或接触合同无效。');
 return value;
}
export function travelDistance(bounds,camera){
 const radius=Math.hypot(bounds.size.x,bounds.size.z)/2;
 // Include the near edge of the avatar's radial bound, not only its centre.
 const halfWidth=(Math.abs(camera.position.z-bounds.center.z)+radius)*Math.tan(camera.fov*Math.PI/360)*camera.aspect;
 return Math.max(.25,halfWidth+radius+.12);
}
export function makeWalkingPlan({contract,kind,scale,distance,yaw=0}){
 if(!['exit','enter'].includes(kind)||![scale,distance,yaw].every(Number.isFinite)||scale<=0||distance<=0)throw Error('行走过渡参数无效。');
 const speed=contract.speedModelUnitsPerSecond*scale,equivalent=distance/speed;
 const acceleration=Math.min(.24,equivalent*.65),deceleration=Math.min(.30,equivalent*.65),cruise=equivalent-(acceleration+deceleration)/2;
 const moveDuration=acceleration+cruise+deceleration,turnDuration=.30;
 // +Z authored forward rotated toward stage-left (-X), for both exit and entry.
 const travelYaw=-Math.PI/2-Math.atan2(contract.forwardAxis[0],contract.forwardAxis[2]);
 const endPhase=contract.contactAnchors[0],initialPhase=mod(endPhase-equivalent,contract.durationSeconds);
 return {contract,kind,scale,distance,speed,equivalent,acceleration,deceleration,cruise,moveDuration,turnDuration,duration:moveDuration+turnDuration,travelYaw,yaw,initialPhase,endPhase};
}
export function sampleWalkingPlan(plan,time){
 const {kind,turnDuration,moveDuration,acceleration,deceleration,cruise,speed,distance,travelYaw,yaw}=plan;
 const bounded=clamp(Number.isFinite(time)?time:0,0,plan.duration),done=bounded>=plan.duration-1e-9,t=done?plan.duration:bounded,moveTime=done?moveDuration:clamp(t-(kind==='exit'?turnDuration:0),0,moveDuration);
 let rate,integral;
 if(moveTime<acceleration){const u=moveTime/acceleration;rate=smooth(u);integral=acceleration*integratedSmooth(u)}
 else if(moveTime<acceleration+cruise){rate=1;integral=acceleration/2+moveTime-acceleration}
 else{const u=(moveTime-acceleration-cruise)/deceleration;rate=1-smooth(u);integral=acceleration/2+cruise+deceleration*(u-integratedSmooth(u))}
 if(done){rate=0;integral=plan.equivalent;}
 const travelled=done?distance:clamp(speed*integral,0,distance),turn=kind==='exit'?smooth(t/turnDuration):smooth((t-moveDuration)/turnDuration);
 const shortAngle=(a,b)=>a+mod(b-a+Math.PI,Math.PI*2)-Math.PI;
 const angle=kind==='exit'?yaw+(shortAngle(yaw,travelYaw)-yaw)*turn:travelYaw+(shortAngle(travelYaw,yaw)-travelYaw)*turn;
 const phase=done?'complete':kind==='exit'&&t<turnDuration?'turn-out':moveTime<acceleration?'start':moveTime<acceleration+cruise?'walk':moveTime<moveDuration?'stop':kind==='enter'&&t<plan.duration?'turn-in':'complete';
 return {time:t,phase,done,x:kind==='exit'?-travelled:distance-travelled,yaw:angle,rate,gaitWeight:rate,gaitSeconds:integral,gaitTime:mod(plan.initialPhase+integral,plan.contract.durationSeconds)};
}
