/** Model06 front-apron pose-space contact correction, not cloth physics.
 * Call after mixer.update() and before rendering. Only the two named garment channels are owned.
 * Validated source six clips plus original Idle arm outward release0–8deg; no new inward motion/finger gesture. Both press and release are instantaneous functions of current geometry; no hidden time history.
 */
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const interpolate=(rows,x,key)=>{if(x<=rows[0].outwardDegrees)return rows[0][key];for(let i=1;i<rows.length;i++)if(x<=rows[i].outwardDegrees){const a=rows[i-1],b=rows[i],t=(x-a.outwardDegrees)/(b.outwardDegrees-a.outwardDegrees);if(Array.isArray(a[key]))return a[key].map((v,j)=>v+(b[key][j]-v)*t);return a[key]+(b[key]-a[key])*t;}return rows.at(-1)[key];};
function proxyDegrees(rows,x,side){const sign=side==='L'?1:-1;const a=rows.map(r=>({outwardDegrees:sign*r.palmOffsetRootGLTF[0],value:r.outwardDegrees}));return interpolate(a,x,'value');}
export function evaluateMaidContactWeights(metrics,config){
 const values=Object.fromEntries(config.targetNames.map(n=>[n,0])),warnings=[];
 for(const side of ['L','R']){const c=config.sides[side],m=metrics?.[side],name=c.targetName;
  if(!m||![m.outwardDegrees,m.palmOutwardDistance,m.trajectoryError,m.flexionError,m.sagittalError,m.localHandFingerAngleError].every(Number.isFinite)){warnings.push(`${side}:invalid-pose`);continue;}
  if(m.outwardDegrees<config.envelope.minOutwardDegrees||m.outwardDegrees>config.envelope.maxOutwardDegrees||m.palmOutwardDistance<config.envelope.minPalmOutwardDistance||m.trajectoryError>config.envelope.maxPalmTrajectoryError||Math.abs(m.flexionError)>.1||Math.abs(m.sagittalError)>config.envelope.maxSagittalErrorDegrees||m.localHandFingerAngleError>.1){warnings.push(`${side}:outside-validated-maid-contact-envelope`);continue;}
  const release=Math.min(Math.max(0,m.outwardDegrees),proxyDegrees(c.releaseTrajectory,Math.max(0,m.palmOutwardDistance),side));
  values[name]=1-smooth(config.release.fullPressureThroughDegrees,config.release.zeroPressureAtDegrees,release);
 }
 return {values,warnings};
}
export function createMaidContactDriver({root,THREE,config,assetSha256}){
 const bones={},targets=[],current=Object.fromEntries(config.targetNames.map(n=>[n,0]));let disposed=false;
 root.traverse(o=>{if(o.isBone)bones[o.name]=o;if(o.isMesh&&o.morphTargetDictionary&&o.morphTargetInfluences){const ids={};for(const n of config.targetNames)if(Number.isInteger(o.morphTargetDictionary[n]))ids[n]=o.morphTargetDictionary[n];if(Object.keys(ids).length)targets.push({mesh:o,ids});}});
 const required=['J_Bip_C_Hips',...['L','R'].flatMap(s=>['UpperArm','LowerArm','Hand','Middle1'].map(n=>`J_Bip_${s}_${n}`)),...Object.keys(config.referenceLocalQuaternions)];
 const compatible=assetSha256===config.assetSha256&&required.every(n=>bones[n])&&config.targetNames.every(n=>targets.some(t=>n in t.ids));
 const v=()=>new THREE.Vector3(),a=v(),e=v(),h=v(),m=v(),palm=v(),anchor=v(),up=v(),low=v();const refq=new THREE.Quaternion();
 const pos=(name,out)=>{bones[name].getWorldPosition(out);return root.worldToLocal(out);};
 const write=()=>{for(const t of targets)for(const[n,i]of Object.entries(t.ids))t.mesh.morphTargetInfluences[i]=current[n];};
 function reset(){for(const n of config.targetNames)current[n]=0;write();}
 reset();
 return {compatible,update(dt){
  if(disposed||!compatible||!Number.isFinite(dt)||dt<0){reset();return {active:false,weights:{...current},warnings:[disposed?'disposed':!compatible?'asset-or-capability-mismatch':'invalid-delta-time']};}
  root.updateWorldMatrix(true,true);const metrics={};
  for(const side of ['L','R']){const c=config.sides[side];pos(`J_Bip_${side}_UpperArm`,a);pos(`J_Bip_${side}_LowerArm`,e);pos(`J_Bip_${side}_Hand`,h);pos(`J_Bip_${side}_Middle1`,m);up.copy(e).sub(a);low.copy(h).sub(e);palm.copy(h).add(m).multiplyScalar(.5);
   const abduction=Math.atan2(Math.abs(up.x),-up.y)*180/Math.PI,sagittal=Math.atan2(-up.z,-up.y)*180/Math.PI,flexion=Math.acos(clamp(up.dot(low)/(up.length()*low.length()),-1,1))*180/Math.PI,outwardDegrees=abduction-c.reference.abduction;
   anchor.fromArray(c.anchorInHipsBone);bones.J_Bip_C_Hips.localToWorld(anchor);root.worldToLocal(anchor);const offset=palm.clone().sub(anchor),expected=interpolate(c.releaseTrajectory,clamp(outwardDegrees,0,8),'palmOffsetRootGLTF');
   let localHandFingerAngleError=0;for(const[n,q]of Object.entries(config.referenceLocalQuaternions))if(n.startsWith(`J_Bip_${side}_`)){refq.fromArray(q).normalize();localHandFingerAngleError=Math.max(localHandFingerAngleError,bones[n].quaternion.clone().normalize().angleTo(refq)*180/Math.PI);}
   metrics[side]={abduction,flexion,sagittal,outwardDegrees,palmOutwardDistance:offset.x*(side==='L'?1:-1),trajectoryError:offset.distanceTo(new THREE.Vector3(...expected)),flexionError:flexion-c.reference.flexion,sagittalError:sagittal-interpolate(c.releaseTrajectory,clamp(outwardDegrees,0,8),'sagittal'),localHandFingerAngleError};
  }
  const result=evaluateMaidContactWeights(metrics,config);for(const n of config.targetNames){const side=n.endsWith('_L')?'L':'R',invalid=result.warnings.some(w=>w.startsWith(`${side}:`)),target=result.values[n];current[n]=invalid?0:target;if(Math.abs(current[n])<1e-7)current[n]=0;}write();return {active:true,weights:{...current},warnings:result.warnings,metrics};
 },reset,dispose(){reset();disposed=true;targets.length=0;for(const n of Object.keys(bones))delete bones[n];}};
}
