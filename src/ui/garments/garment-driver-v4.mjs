/** Pose-space garment correction only. Not a cloth simulation or an arbitrary-pose collision solver. */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const SIDES = ['L', 'R'];
const kinds = ['underarm_compress', 'elbow_fold', 'hand_contact'];
const names = SIDES.flatMap(s => kinds.map(k => `garment_${k}_${s}`));
export function evaluateGarmentWeights(metrics, config) {
  const values = Object.fromEntries(names.map(n => [n, 0])); const warnings = [];
  for (const side of SIDES) {
    const m = metrics?.[side], c = config?.sides?.[side];
    if (!m || !c || ![m.abduction, m.flexion, m.sagittal, m.shoulderDrop].every(Number.isFinite)) { warnings.push(`${side}:invalid-pose`); continue; }
    const close = c.reference.abduction - m.abduction;
    const flex = m.flexion - c.reference.flexion;
    const sagittal = Math.abs(m.sagittal - c.reference.sagittal);
    const bounded = m.abduction >= 0 && m.abduction <= 35 && m.flexion <= 60 && sagittal <= 25;
    if (!bounded) { warnings.push(`${side}:outside-corrective-envelope`); continue; }
    // Shoulder-coordinated compression: pure upper-arm adduction is a distinct geometry.
    const drop = m.shoulderDrop - c.reference.shoulderDrop;
    const shoulderCoherent = drop >= .025 && drop <= 1.75 && close <= 5.05;
    values[`garment_underarm_compress_${side}`] = shoulderCoherent ? smooth(.5, 6, close) * smooth(.025, .1, drop) : 0;
    if (close > .5 && !shoulderCoherent) warnings.push(`${side}:underarm-shoulder-coordination-unsupported`);
    values[`garment_elbow_fold_${side}`] = smooth(2, 25, flex);
    // This is a calibrated side-skirt palm proxy, not a general collision detector.
    // Fail closed outside the measured arm/hand envelope rather than pretending a shape key can solve it.
    if (c.contact?.enabled && Number.isFinite(m.palmGap) && Number.isFinite(m.contactRadiusSquared)) {
      const contactPose = close >= -0.001 && close <= 8.001 && Math.abs(flex) <= .05 && sagittal <= .15 && Math.abs(drop) <= .01 && Number.isFinite(m.handPoseDeparture) && m.handPoseDeparture <= .25;
      if (contactPose && m.contactRadiusSquared <= 1) values[`garment_hand_contact_${side}`] = smooth(0, .007, -m.palmGap);
      else if (m.palmGap < 0 && m.contactRadiusSquared <= 1) warnings.push(`${side}:contact-outside-validated-envelope`);
      if (m.palmGap < -.007) warnings.push(`${side}:contact-correction-saturated`);
    }
  }
  return {values, warnings};
}
export function createGarmentDriver({root, THREE, config, assetSha256}) {
  let disposed = false; const targets = []; const bones = {}; const current = Object.fromEntries(names.map(n => [n, 0]));
  root.traverse(o => {
    if (o.isBone) bones[o.name] = o;
    if (o.isMesh && o.morphTargetDictionary && o.morphTargetInfluences) {
      const indices = {};
      for (const name of names) { const i = o.morphTargetDictionary[name]; if (Number.isInteger(i)) indices[name] = i; }
      if (Object.keys(indices).length) targets.push({mesh:o,indices});
    }
  });
  const required = SIDES.flatMap(s => ['Shoulder','UpperArm','LowerArm','Hand','Middle1'].map(k=>`J_Bip_${s}_${k}`)).concat('J_Bip_C_Hips');
  const handReferences = SIDES.flatMap(s => Object.keys(config.sides[s].contact.handLocalQuaternions || {}));
  const compatible = handReferences.every(n => bones[n]) && assetSha256 === config.assetSha256 && required.every(n => bones[n]) && targets.length > 0 && names.every(n => targets.some(t => n in t.indices));
  const v = () => new THREE.Vector3(); const a=v(), shoulder=v(), e=v(), h=v(), middle=v(), anchor=v(), up=v(), low=v();
  function position(name, out) { bones[name].getWorldPosition(out); return root.worldToLocal(out); }
  function write(vals) { for (const t of targets) for (const [n,i] of Object.entries(t.indices)) t.mesh.morphTargetInfluences[i] = vals[n] || 0; }
  function reset() { for (const n of names) current[n]=0; write(current); }
  reset();
  return {
    compatible,
    update(dt) {
      if (disposed || !compatible) { reset(); return {active:false,warnings:[disposed?'disposed':'asset-or-capability-mismatch']}; }
      if (!Number.isFinite(dt) || dt < 0) { reset(); return {active:false,warnings:['invalid-delta-time']}; }
      root.updateWorldMatrix(true,true); const metrics={};
      for (const side of SIDES) {
        const c=config.sides[side]; position(`J_Bip_${side}_UpperArm`,a);position(`J_Bip_${side}_LowerArm`,e);position(`J_Bip_${side}_Hand`,h);position(`J_Bip_${side}_Middle1`,middle);
        position(`J_Bip_${side}_Shoulder`,shoulder);shoulder.subVectors(a,shoulder);
        up.copy(e).sub(a);low.copy(h).sub(e);
        const abduction=Math.atan2(Math.abs(up.x),-up.y)*180/Math.PI;
        const sagittal=Math.atan2(-up.z,-up.y)*180/Math.PI;
        const denom=up.length()*low.length();const flexion=denom>1e-10?Math.acos(clamp(up.dot(low)/denom,-1,1))*180/Math.PI:NaN;
        const shoulderDrop=Math.atan2(-shoulder.y,Math.abs(shoulder.x))*180/Math.PI;
        const m={abduction,flexion,sagittal,shoulderDrop};
        if(c.contact?.enabled) {
          m.handPoseDeparture=0;
          for(const [name,ref] of Object.entries(c.contact.handLocalQuaternions)){const q=bones[name].quaternion; const denom=q.length()*Math.hypot(...ref);const dot=denom>1e-12?Math.abs(q.x*ref[0]+q.y*ref[1]+q.z*ref[2]+q.w*ref[3])/denom:NaN; m.handPoseDeparture=Math.max(m.handPoseDeparture,2*Math.acos(clamp(dot,-1,1))*180/Math.PI);}
          anchor.fromArray(c.contact.anchorInHipsBone);bones.J_Bip_C_Hips.localToWorld(anchor);root.worldToLocal(anchor);
          h.add(middle).multiplyScalar(.5);
          m.palmGap=(h.x-anchor.x)*(side==='L'?1:-1)-c.contact.palmRadius;
          m.contactRadiusSquared=((h.y-anchor.y)/c.contact.halfHeight)**2+((h.z-anchor.z)/c.contact.halfDepth)**2;
        }
        metrics[side]=m;
      }
      const result=evaluateGarmentWeights(metrics,config);
      // Pose curves already interpolate. Immediate application prevents temporal lag from invalidating contact clearance.
      for(const n of names) current[n]=result.values[n];
      write(current);return {active:true,weights:{...current},warnings:result.warnings,metrics};
    },
    reset,
    dispose(){reset();disposed=true;targets.length=0;for(const key of Object.keys(bones))delete bones[key];root=null;},
  };
}
