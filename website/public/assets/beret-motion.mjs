// Browser-space coordinate state. The head and eyes are separately baked from
// real Blender rig poses; only the detachable hat is translated on the page.
export const SCENE = {width:384,height:490};
export const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
const lerp=(a,b,t)=>a+(b-a)*t;
const ease=t=>1-Math.pow(1-t,3);
export function createBeret(home,box) {
  return {home:{...home},box:{...box},x:home.x,y:home.y,phase:'worn',owner:null,from:null,flight:null,firstHit:0};
}
export function hitBeret(s,x,y,margin=12) {
  return Math.abs(x-s.x)<=s.box.w/2+margin && Math.abs(y-s.y)<=s.box.h/2+margin;
}
export function holdBeret(s,id) {
  if(s.owner!==null || !['worn','ground'].includes(s.phase))return false;
  s.owner=id;s.from={x:s.x,y:s.y,phase:s.phase};s.phase='held';s.flight=null;return true;
}
export function moveBeret(s,id,x,y) {
  if(s.owner!==id || !Number.isFinite(x) || !Number.isFinite(y))return false;
  s.x=clamp(x,s.box.w/2+5,SCENE.width-s.box.w/2-5);
  s.y=clamp(y,s.box.h/2+7,SCENE.height-s.box.h/2-35);
  return true;
}
export function cancelBeret(s,id) {
  if(s.owner!==id || !s.from)return false;
  Object.assign(s,s.from,{owner:null,from:null,flight:null});
  return true;
}
export function releaseBeret(s,id,now,{reduced=false,quiet=false}={}) {
  if(s.owner!==id || !s.from)return null;
  const near=Math.abs(s.x-s.home.x)<=39 && Math.abs(s.y-s.home.y)<=52;
  const side=s.x-s.home.x;
  const edge=s.box.w/2+13;
  const offAxis=side<0 ? SCENE.width*.20 : SCENE.width*.80;
  const floorX=clamp(Math.abs(side)>SCENE.width*.22?s.x:offAxis,edge,SCENE.width-edge);
  const endpoint=near?s.home:{x:floorX,y:SCENE.height-s.box.h/2-35};
  s.owner=null;s.from=null;
  const duration=reduced?0:near?290:clamp(Math.sqrt(Math.max(0,endpoint.y-s.y))*.032*1000,235,610);
  if(!duration) {
    if(!near&&!quiet)s.firstHit++;
    Object.assign(s,endpoint,{phase:near?'worn':'ground',flight:null});
  } else {
    s.phase=near?'aligning':'falling';
    s.flight={now,duration,start:{x:s.x,y:s.y},endpoint,near,quiet};
  }
  return near?'near':'far';
}
export function stepBeret(s,now) {
  const f=s.flight;if(!f)return false;
  const t=clamp((now-f.now)/f.duration,0,1);
  s.x=lerp(f.start.x,f.endpoint.x,ease(t));s.y=lerp(f.start.y,f.endpoint.y,f.near?ease(t):t*t);
  if(t===1){
    if(!f.near&&!f.quiet)s.firstHit++;
    s.phase=f.near?'worn':'ground';s.flight=null;
  }
  return true;
}
export function gazeDirection(x,y,home) {
  const dx=x-home.x,dy=y-home.y;
  if(Math.abs(dx)>39&&Math.abs(dx)*1.04>=Math.abs(dy)*.74)return dx<0?'left':'right';
  if(dy<-15)return 'up';
  if(dy>44)return 'down';
  return Math.abs(dx)>16?(dx<0?'left':'right'):'idle';
}
