const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../src/avatar/natural-motion.mjs');
test('bounded finite signals over ten minutes, including blinks', async () => {
  const { NaturalMotion } = await load(); const m = new NaturalMotion(); let closed = false;
  m.setPointer(100, -100); m.setState('speaking'); m.setLipSync(10);
  for(let i=0;i<36000;i++) { const p=m.step(1/60); for(const v of Object.values(p)) assert.ok(Number.isFinite(v));
    assert.ok(p.eyeOpen>=0 && p.eyeOpen<=1); assert.ok(p.mouthOpen>=0 && p.mouthOpen<=1);
    assert.ok(Math.abs(p.headX)<=6); closed ||= p.eyeOpen<0.1;
  } assert.ok(closed);
});
test('stopping speech closes mouth; reduced motion suppresses idle motion', async () => {
 const { NaturalMotion }=await load(); const m=new NaturalMotion(); m.setState('speaking'); m.setLipSync(1);
 for(let i=0;i<60;i++) m.step(1/60); m.setState('idle'); let p;
 for(let i=0;i<120;i++) p=m.step(1/60,{reducedMotion:true});
 assert.ok(p.mouthOpen<0.001); assert.equal(p.bodyAngle,0); assert.equal(p.eyeOpen,1);
});
test('frame-rate independent tracking and hidden-tab gap handling', async () => {
 const { NaturalMotion }=await load(); const a=new NaturalMotion(), b=new NaturalMotion(); a.setPointer(1,1); b.setPointer(1,1);
 let pa,pb; for(let i=0;i<30;i++) pa=a.step(1/30); for(let i=0;i<120;i++) pb=b.step(1/120);
 assert.ok(Math.abs(pa.gazeX-pb.gazeX)<1e-10);
 assert.ok(Number.isFinite(a.step(Infinity).headX)); assert.ok(Number.isFinite(a.step(10000).headX));
 assert.throws(()=>a.setState('unknown'));
});
