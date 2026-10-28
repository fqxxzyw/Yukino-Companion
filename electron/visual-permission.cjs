// Camera-only, short-lived permission grants for an exact trusted main frame.
class VisualPermissionGate{
 constructor({now=Date.now}={}){this.now=now;this.grants=new Map();}
 grant(contents,url,token){this.grants.set(contents,{url,token,expires:this.now()+15000,requested:false});}
 revoke(contents,token){const grant=this.grants.get(contents);if(!token||grant?.token===token)this.grants.delete(contents);}
 owner(contents,details){const g=this.grants.get(contents);return g&&g.expires>this.now()&&!contents.isDestroyed?.()&&contents.getURL()===g.url&&details?.isMainFrame===true&&details.requestingUrl===g.url?g:null;}
 check(contents,permission,_origin,details){return permission==='media'&&details?.mediaType==='video'&&Boolean(this.owner(contents,details));}
 request(contents,permission,callback,details){const grant=this.owner(contents,details),allowed=Boolean(grant&&!grant.requested&&permission==='media'&&Array.isArray(details?.mediaTypes)&&details.mediaTypes.length===1&&details.mediaTypes[0]==='video');if(allowed)grant.requested=true;callback(allowed);}
}
module.exports={VisualPermissionGate};
