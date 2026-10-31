import * as THREE from 'three';
const ease=t=>t*t*(3-2*t);
// Temporary inspection never changes the saved camera or scene preference.
export class SceneOverview {
 constructor(camera,target,{duration=1.65,reducedMotion=false}={}){Object.assign(this,{camera,target,duration,reducedMotion});this.amount=0;this.desired=0;}
 reset(home,overview){this.home={position:home.position.clone(),target:home.target.clone()};this.overview={position:overview.position.clone(),target:overview.target.clone()};this.amount=0;this.desired=0;this.apply();}
 wheel(delta){if(!this.home)return false;this.desired=THREE.MathUtils.clamp(this.desired+Math.sign(delta)*.22,0,1);return true;}
 show(){this.desired=1;}
 rotate(delta){if(!this.overview||!Number.isFinite(delta))return false;const offset=this.overview.position.clone().sub(this.overview.target);offset.applyAxisAngle(new THREE.Vector3(0,1,0),delta);this.overview.position.copy(this.overview.target).add(offset);this.apply();return true;}
 release(){this.desired=0;}
 step(dt){if(!this.home)return false;const previous=this.amount,alpha=this.reducedMotion?1:1-Math.exp(-Math.max(0,Math.min(.1,dt))*4/this.duration);this.amount+=(this.desired-this.amount)*alpha;if(Math.abs(this.amount-this.desired)<.0005)this.amount=this.desired;this.apply();return previous!==this.amount;}
 apply(){if(!this.home)return;const t=ease(this.amount);this.camera.position.lerpVectors(this.home.position,this.overview.position,t);this.target.lerpVectors(this.home.target,this.overview.target,t);this.camera.lookAt(this.target);this.camera.updateMatrixWorld(true);}
 get active(){return this.amount>0||this.desired>0;}
}
