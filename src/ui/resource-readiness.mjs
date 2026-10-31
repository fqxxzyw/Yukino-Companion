export const DEPLOYMENT_FEATURES=Object.freeze(['chat','translation','voice','pet']);
export const RESOURCE_STEPS=Object.freeze(['runtime','chat','translation','voiceCore','voicePreset','pet']);
const activeStates=new Set(['installing','downloading','extracting','verifying','preparing','checking','refreshing']);

// Skipped steps belong to a deployment selection, not to an all-resource check.
// File readiness is deliberately not a claim that inference has been verified.
export function resourceReadiness(status){
 const steps=RESOURCE_STEPS.map(id=>status?.steps?.find(step=>step.id===id));
 if(status?.scope!=='all')return {kind:'unknown'};
 if(status.phase==='installing'||steps.some(step=>activeStates.has(step?.state)))return {kind:'active'};
 const missing=steps.filter(step=>step?.state==='missing').length;
 const waiting=steps.filter(step=>step?.state==='waiting-runtime').length;
 const failed=steps.filter(step=>step?.state==='error').length;
 if(missing||waiting||failed)return {kind:'incomplete',missing,waiting,failed};
 return {kind:steps.every(step=>step?.state==='ready')?'ready':'unknown'};
}

// One read at a time; coalesce progress events without polling or changing the
// selected features. A late promise cannot update an unmounted settings page.
export function observeResourceReadiness(api,onChange,{schedule=setTimeout,unschedule=clearTimeout}={}){
 if(typeof api?.setupStatus!=='function'){onChange({kind:'unavailable'});return ()=>{};}
 let disposed=false,running=false,queued=false,timer=null;
 function enqueue(){
  if(disposed)return;
  if(running){queued=true;return;}
  if(timer===null)timer=schedule(()=>{timer=null;check();},1000);
 }
 async function check(){
  if(disposed)return;
  running=true;queued=false;
  try{
   const status=await api.setupStatus({scope:'all'});
   if(!disposed)onChange(resourceReadiness(status));
  }catch{if(!disposed)onChange({kind:'error'});}
  finally{running=false;if(queued)enqueue();}
 }
 const off=api.onSetupStatus?.(enqueue);
 check();
 return ()=>{disposed=true;if(timer!==null)unschedule(timer);off?.();};
}
