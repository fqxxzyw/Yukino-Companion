/** Exportable local corrective morphs, not cloth simulation. No pose/root mutation. */
const SIDES = ['L','R'];
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const distance=(a,b)=>Math.hypot(...a.map((x,i)=>x-b[i]));
const mix=(a,b,t)=>a.map((x,i)=>x+(b[i]-x)*t);
const validQuat=q=>Array.isArray(q)&&q.length===4&&q.every(Number.isFinite)&&Math.hypot(...q)>1e-8;
const quatAngle=(a,b)=>!validQuat(a)||!validQuat(b)?Infinity:2*Math.acos(clamp(Math.abs(a.reduce((sum,x,i)=>sum+x*b[i],0))/(Math.hypot(...a)*Math.hypot(...b)),0,1))*180/Math.PI;
const quatMix=(a,b,t)=>{const sign=a.reduce((sum,x,i)=>sum+x*b[i],0)<0?-1:1;const q=a.map((x,i)=>x+(sign*b[i]-x)*t),len=Math.hypot(...q);return q.map(x=>x/len);};
export function evaluateBoundedGarmentWeights(metrics,config){
 const values=Object.fromEntries(config.ownedTargetNames.map(n=>[n,0])),warnings=[];
 for(const side of SIDES){
  const c=config.sides[side],m=metrics?.[side];if(!c?.enabled)continue;
  if(!m||![m.upperDirection,m.lowerDirection,m.palm].every(a=>Array.isArray(a)&&a.length===3)||![m.abduction,m.sagittal,m.flexion,...m.upperDirection,...m.lowerDirection,...m.palm].every(Number.isFinite)){warnings.push(`${side}:invalid-pose`);continue;}
  const t=c.parameter==='adduction'?c.reference.abduction-m.abduction:m.flexion-c.reference.flexion;
  if(t<c.parameterRange[0]-1e-4||t>c.parameterRange[1]+1e-4){warnings.push(`${side}:outside-measured-pose-range`);continue;}
  const samples=c.samples;let i=samples.findIndex(s=>s.parameter>=t);if(i<0)i=samples.length-1;
  const a=samples[Math.max(0,i-1)],b=samples[i],blend=b.parameter>a.parameter?clamp((t-a.parameter)/(b.parameter-a.parameter),0,1):0;
  if(distance(m.upperDirection,mix(a.upperDirection,b.upperDirection,blend))>c.tolerances.unitDirection||distance(m.lowerDirection,mix(a.lowerDirection,b.lowerDirection,blend))>c.tolerances.unitDirection||distance(m.palm,mix(a.palm,b.palm,blend))>c.tolerances.palmPosition){warnings.push(`${side}:outside-measured-direction-contact-path`);continue;}
  const jointMismatch=['UpperArm','LowerArm'].some(k=>quatAngle(m.jointLocalQuaternions?.[k],quatMix(a.jointLocalQuaternions[k],b.jointLocalQuaternions[k],blend))>c.tolerances.localQuaternionDegrees);
  const fixedMismatch=Object.entries(c.reference.fixedLocalQuaternions).some(([name,q])=>quatAngle(m.fixedLocalQuaternions?.[name],q)>c.tolerances.localQuaternionDegrees);
  if(jointMismatch||fixedMismatch){warnings.push(`${side}:unsupported-joint-twist-wrist-or-finger-pose`);continue;}
  let w=smooth(c.activationRange[0],c.activationRange[1],t)*c.weightCap;
  if(c.kind==='palm-precontact'){
   const sign=side==='L'?1:-1;
   const gap=(m.palm[0]-c.contact.anchorRootLocal[0])*sign-c.contact.palmRadius;
   const radius=((m.palm[1]-c.contact.anchorRootLocal[1])/c.contact.halfHeight)**2+((m.palm[2]-c.contact.anchorRootLocal[2])/c.contact.halfDepth)**2;
   m.palmGap=gap;m.contactRadiusSquared=radius;
   w=radius<=1?smooth(c.contact.precontactOuterGap,c.contact.precontactInnerGap,gap)*c.weightCap:0;
  }
  values[c.targetName]=clamp(w,0,c.weightCap);
 }
 return{values,warnings};
}
export function measureGarmentMetrics({root,THREE,bones}){
 const metrics={},pos=n=>root.worldToLocal(bones[n].getWorldPosition(new THREE.Vector3()));
 for(const side of SIDES){
  const a=pos(`J_Bip_${side}_UpperArm`),e=pos(`J_Bip_${side}_LowerArm`),h=pos(`J_Bip_${side}_Hand`),middle=pos(`J_Bip_${side}_Middle1`),up=e.clone().sub(a),lo=h.clone().sub(e),len=up.length()*lo.length();
  metrics[side]={abduction:Math.atan2(Math.abs(up.x),-up.y)*180/Math.PI,sagittal:Math.atan2(-up.z,-up.y)*180/Math.PI,flexion:len>1e-10?Math.acos(clamp(up.dot(lo)/len,-1,1))*180/Math.PI:NaN,upperDirection:up.normalize().toArray(),lowerDirection:lo.normalize().toArray(),palm:h.add(middle).multiplyScalar(.5).toArray(),jointLocalQuaternions:Object.fromEntries(['UpperArm','LowerArm'].map(k=>[k,bones[`J_Bip_${side}_${k}`].quaternion.toArray()])),fixedLocalQuaternions:Object.fromEntries(Object.entries(bones).filter(([n])=>n.startsWith(`J_Bip_${side}_`)&&/(Shoulder|Hand|Thumb|Index|Middle|Ring|Little)/.test(n)).map(([n,b])=>[n,b.quaternion.toArray()]))};
 }
 return metrics;
}
export function createBoundedGarmentDriver({root,THREE,config,assetSha256}){
 let disposed=false;const targets=[],bones={};
 root.traverse(o=>{if(o.isBone)bones[o.name]=o;if(o.isMesh&&o.morphTargetDictionary&&o.morphTargetInfluences){const indices={};for(const n of config.ownedTargetNames){const i=o.morphTargetDictionary[n];if(Number.isInteger(i))indices[n]=i;}if(Object.keys(indices).length)targets.push({mesh:o,indices});}});
 const required=SIDES.flatMap(s=>['UpperArm','LowerArm','Hand','Middle1'].map(k=>`J_Bip_${s}_${k}`).concat(Object.keys(config.sides[s].reference.fixedLocalQuaternions??{})));
 const compatible=assetSha256===config.assetSha256&&config.runtimeAutoDriverEnabled===true&&required.every(n=>bones[n])&&targets.length>0&&config.ownedTargetNames.every(n=>targets.some(t=>n in t.indices));
 const zeros=Object.fromEntries(config.ownedTargetNames.map(n=>[n,0]));
 function write(values){for(const t of targets)for(const[n,i]of Object.entries(t.indices))t.mesh.morphTargetInfluences[i]=values[n]??0;}
 function reset(){write(zeros);}
 reset();
 return{compatible,update(dt){if(disposed)return{active:false,warnings:['disposed']};if(!compatible||!Number.isFinite(dt)||dt<0){reset();return{active:false,warnings:[compatible?'invalid-delta-time':'asset-or-capability-mismatch']};}root.updateWorldMatrix(true,true);const metrics=measureGarmentMetrics({root,THREE,bones}),r=evaluateBoundedGarmentWeights(metrics,config);write(r.values);return{active:true,weights:r.values,warnings:r.warnings,metrics};},reset,dispose(){if(disposed)return;reset();disposed=true;targets.length=0;for(const n of Object.keys(bones))delete bones[n];}};
}
