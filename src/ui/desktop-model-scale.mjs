// The persisted companion scale controls the native window size. Serialize
// updates so rapid wheel events cannot be overwritten by a late IPC response.
export function createDesktopModelScale({save,onError=()=>{}}){
 let current=1,desired=null,running=false,disposed=false;
 const clamp=value=>Math.round(Math.max(.6,Math.min(2,value))*1000)/1000;
 async function flush(){
  if(running||desired===null||disposed)return;
  running=true;
  while(desired!==null&&!disposed){
   const sent=desired;
   try{
    const result=await save(sent);
    current=clamp(Number(result?.preferences?.scale??result?.scale??sent)||sent);
    if(desired===sent)desired=null;
   }catch(error){
    if(desired===sent)desired=null;
    onError(error);
   }
  }
  running=false;
 }
 return {
  sync(value){if(desired===null&&Number.isFinite(value))current=clamp(value)},
  change(delta){if(!Number.isFinite(delta))return;desired=clamp((desired??current)+delta);void flush()},
  reset(){desired=1;void flush()},
  dispose(){disposed=true},
 };
}
