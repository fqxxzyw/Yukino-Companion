// The persisted companion scale controls the native window size. Serialize
// updates so rapid wheel events cannot be overwritten by a late IPC response.
export function createDesktopModelScale({save,onError=()=>{},delay=80}){
 let current=1,desired=null,running=false,disposed=false,timer=null;
 const clamp=value=>Math.round(Math.max(.6,Math.min(2,value))*1000)/1000;
 function schedule(){
  if(disposed)return;
  clearTimeout(timer);
  timer=setTimeout(()=>{timer=null;void flush()},delay);
 }
 async function flush(){
  if(running||desired===null||disposed)return;
  running=true;
  const sent=desired;
  try{
   const result=await save(sent);
   current=clamp(Number(result?.preferences?.scale??result?.scale??sent)||sent);
   if(desired===sent)desired=null;
  }catch(error){
   if(desired===sent)desired=null;
   if(!disposed)onError(error);
  }
  running=false;
  if(desired!==null&&!disposed&&timer===null)schedule();
 }
 return {
  sync(value){if(desired===null&&Number.isFinite(value))current=clamp(value)},
  change(delta){if(!Number.isFinite(delta))return;desired=clamp((desired??current)+delta);schedule()},
  reset(){desired=1;schedule()},
  dispose(){disposed=true;clearTimeout(timer);timer=null},
 };
}
