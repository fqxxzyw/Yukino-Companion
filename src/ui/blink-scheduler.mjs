import {BLINK_REVIEW_V5} from './blink-review-contract.mjs';
// Capability-gated support for future, validated eyelid assets. No shipped
// character gains a blink merely by importing this module.
const clamp=value=>Math.max(0,Math.min(1,value));
const smooth=value=>{const x=clamp(value);return x*x*(3-2*x)};
export class BlinkScheduler {
 constructor({random=Math.random}={}){this.random=random;this.disposed=false;this.reset();}
 draw(){try{const value=Number(this.random());return Number.isFinite(value)?clamp(value):.5;}catch{return .5;}}
 interval(){return 2600+4800*(.65*this.draw()+.35*this.draw());}
 reset(){this.last=null;this.next=null;this.active=null;this.pendingDouble=false;this.lastBlink=-Infinity;this.normalSinceDouble=3;}
 stop(){this.reset();return 0;}
 dispose(){this.stop();this.disposed=true;}
 begin(now,double=false){this.active={start:now,close:75+this.draw()*35,hold:15+this.draw()*30,open:115+this.draw()*65,double};this.lastBlink=now;}
 // A dialogue boundary is only a timing hint, never a command to force a blink.
 hintBoundary(now){if(this.disposed||!Number.isFinite(now)||this.active||this.next===null||now-this.lastBlink<1500)return;this.next=Math.min(this.next,now+300+this.draw()*400);}
 update(now,{enabled=false,visible=true,reducedMotion=false,paused=false}={}){
  if(this.disposed||!enabled||!visible||reducedMotion||paused||!Number.isFinite(now)||now<0){return this.stop();}
  if(this.last===null||now<this.last||now-this.last>500){this.reset();this.last=now;this.next=now+this.interval();return 0;}
  this.last=now;
  if(!this.active){if(now<this.next)return 0;this.begin(now,this.pendingDouble===true);this.pendingDouble=false;return 0;}
  const phase=this.active,elapsed=now-phase.start,total=phase.close+phase.hold+phase.open;
  if(elapsed<phase.close)return smooth(elapsed/phase.close);
  if(elapsed<phase.close+phase.hold)return 1;
  if(elapsed<total)return 1-smooth((elapsed-phase.close-phase.hold)/phase.open);
  this.active=null;
  // At most one second closure. No catch-up loop and no queued blink backlog.
  if(!phase.double&&this.normalSinceDouble>=3&&this.draw()<.08){this.next=now+80+this.draw()*70;this.pendingDouble=true;this.normalSinceDouble=0;}
  else{this.next=now+this.interval();this.pendingDouble=false;this.normalSinceDouble++;}
  return 0;
 }
}

// Binding deliberately accepts only explicit morph contracts tied to an exact
// GLB digest. It never rotates empty eye bones or substitutes mouth channels.
function bindChannels(meshes,contract,assetSha256){
 if(!Array.isArray(meshes)||!contract||contract.schemaVersion!==1||contract.assetSha256!==assetSha256||!/^[a-f0-9]{64}$/i.test(assetSha256||'')||contract.bothEyes!==true||!Array.isArray(contract.channels)||!contract.channels.length||contract.channels.length>32)return null;
 const bindings=[],seen=new Set(),eyes=new Set();
 for(const channel of contract.channels){
  if(!channel||typeof channel.mesh!=='string'||typeof channel.morph!=='string'||/mouth|viseme/i.test(channel.morph)||!['both','left','right'].includes(channel.eye)||!Number.isFinite(channel.closedWeight)||channel.closedWeight<=0||channel.closedWeight>1)return null;
  const matches=meshes.filter(mesh=>mesh.name===channel.mesh);if(matches.length!==1)return null;const mesh=matches[0],index=mesh.morphTargetDictionary?.[channel.morph];
  if(!Number.isInteger(index)||index<0||!mesh.morphTargetInfluences||index>=mesh.morphTargetInfluences.length)return null;
  const base=mesh.geometry?.attributes?.position,target=mesh.geometry?.morphAttributes?.position?.[index];if(!base||!target||!Number.isInteger(target.count)||target.count<1||target.count>500000||target.count!==base.count||!['getX','getY','getZ'].every(key=>typeof target[key]==='function'&&typeof base[key]==='function'))return null;let changed=false;for(let i=0;i<target.count;i++)for(const key of ['getX','getY','getZ']){const value=target[key](i),origin=mesh.geometry.morphTargetsRelative?0:base[key](i);if(!Number.isFinite(value)||!Number.isFinite(origin))return null;if(Math.abs(value-origin)>1e-8)changed=true;}if(!changed)return null;
  const key=channel.mesh+'\0'+index;if(seen.has(key))return null;seen.add(key);eyes.add(channel.eye);bindings.push({mesh,index,closedWeight:channel.closedWeight});
 }
 if(!eyes.has('both')&&!(eyes.has('left')&&eyes.has('right')))return null;
 let disposed=false;
 const apply=closure=>{const value=Number.isFinite(closure)?clamp(closure):0;for(const {mesh,index,closedWeight}of bindings)mesh.morphTargetInfluences[index]=disposed?0:value*closedWeight;};
 return {apply,clear:()=>apply(0),dispose(){apply(0);disposed=true;bindings.length=0;}};
}

export function bindValidatedBlink(meshes,contract,assetSha256){
 if(contract?.status!=='validated'||assetSha256===BLINK_REVIEW_V5.assetSha256)return null;
 return bindChannels(meshes,contract,assetSha256);
}
export function bindIsolatedReviewBlink(meshes,contract,assetSha256,{reviewOptIn=false}={}){
 if(reviewOptIn!==true||contract?.status!=='isolated-review'||assetSha256!==BLINK_REVIEW_V5.assetSha256||contract.assetSha256!==assetSha256||contract.bothEyes!==true||contract.equalBilateralWeightsOnly!==true||JSON.stringify(contract.channels)!==JSON.stringify(BLINK_REVIEW_V5.channels))return null;
 return bindChannels(meshes,contract,assetSha256);
}
