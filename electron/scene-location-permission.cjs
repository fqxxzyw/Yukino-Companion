// Location permission is independent of the existing time-limited microphone
// grant. Only the main app's exact trusted top-frame URL may ask. Nothing is
// persisted, and external pages/secondary windows/frames remain denied.
function createSceneLocationPermission({getWindow,trustedURL,confirm}){
 let allowed=null,pending=null;
 const matches=value=>{try{const url=new URL(value),trusted=new URL(trustedURL);url.hash='';trusted.hash='';return url.href===trusted.href;}catch{return false;}};
 function eligible(contents,details={}){
  const win=getWindow();
  return Boolean(win&&!win.isDestroyed()&&contents===win.webContents&&details.isMainFrame!==false&&matches(contents.getURL())&&matches(details.requestingUrl||details.securityOrigin||contents.getURL()));
 }
 function check(contents,permission,details={}){return permission==='geolocation'&&eligible(contents,details)&&allowed===contents;}
 function request(contents,permission,callback,details={}){
  if(permission!=='geolocation'||!eligible(contents,details)){callback(false);return;}
  if(allowed===contents){callback(true);return;}
  // Coalesce native prompts rather than letting repeated requests stack dialogs.
  if(!pending)pending=Promise.resolve().then(()=>confirm(getWindow())).then(value=>{
   const accepted=value===true&&eligible(contents,details);if(accepted)allowed=contents;return accepted;
  }).catch(()=>false).finally(()=>{pending=null;});
  pending.then(value=>callback(value&&eligible(contents,details)));
 }
 return {check,request};
}
module.exports={createSceneLocationPermission};
