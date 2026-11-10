export const BLACKBOARD_IDLE_MS=180000;

// Own only the idle deadline. Persistence, request serialization and accepted
// snapshot clearing remain in the existing chat submission callback.
export class BlackboardIdle{
 constructor({controller,onIdle,scopeKey='',enabled=true,visible=true,now=()=>Date.now(),setTimer=(fn,delay)=>setTimeout(fn,delay),clearTimer=timer=>clearTimeout(timer)}){
  Object.assign(this,{controller,onIdle,scopeKey,enabled,visible,now,setTimer,clearTimer});
  this.deadline=null;this.timer=null;this.drawing=false;this.pending=null;this.attempted=null;this.disposed=false;
  this.unsubscribe=controller.subscribe?.(()=>{if(!controller.hasInk()){this.deadline=null;this.cancel();}else this.schedule();});
 }
 cancel(){if(this.timer!==null)this.clearTimer(this.timer);this.timer=null;}
 update({onIdle=this.onIdle,scopeKey=this.scopeKey,enabled=this.enabled,visible=this.visible}={}){
  if(this.disposed)return;
  if(scopeKey!==this.scopeKey){this.deadline=null;this.cancel();}
  Object.assign(this,{onIdle,scopeKey,enabled,visible});this.schedule();
 }
 start(){
  if(this.disposed)return;this.drawing=true;this.strokeScope=this.scopeKey;this.deadline=null;this.cancel();
 }
 move(){
  if(this.disposed)return;
  // No idle deadline may expire while a pointer is held, including when it
  // temporarily leaves the board. End/release begins the full three minutes.
  if(this.drawing){this.cancel();return;}
 }
 end(){
  if(this.disposed||!this.drawing)return;this.drawing=false;
  if(this.strokeScope!==this.scopeKey||!this.controller.hasInk()){this.deadline=null;this.cancel();return;}
  this.deadline=this.now()+BLACKBOARD_IDLE_MS;this.schedule();
 }
 schedule(){
  this.cancel();
  if(this.disposed||!this.enabled||!this.visible||this.drawing||this.pending||this.deadline===null||!this.controller.hasInk()||typeof this.onIdle!=='function')return;
  this.timer=this.setTimer(()=>{this.timer=null;this.fire();},Math.max(0,this.deadline-this.now()));
  this.timer?.unref?.();
 }
 fire(){
  if(this.disposed||!this.enabled||!this.visible||this.drawing||this.pending||this.deadline===null)return;
  if(this.now()<this.deadline){this.schedule();return;}
  const snapshot=this.controller.snapshot();this.deadline=null;if(!snapshot)return;
  const key=`${snapshot.owner}:${snapshot.revision}`;
  if(this.attempted===key)return;this.attempted=key;
  let result;try{result=this.onIdle(snapshot);}catch{result=false;}
  const pending=Promise.resolve(result).catch(()=>false).finally(()=>{if(this.pending===pending){this.pending=null;this.schedule();}});
  this.pending=pending;
 }
 dispose(){if(this.disposed)return;this.disposed=true;this.cancel();this.deadline=null;this.unsubscribe?.();}
}
