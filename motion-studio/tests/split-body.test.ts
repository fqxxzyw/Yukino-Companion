import {test} from 'node:test';
import assert from 'node:assert/strict';
import {splitBodyClip} from '../src/motion/split-body.ts';
import {createClip,createProject,createTrack,evaluateProject} from '../src/motion/timeline.ts';
import {eulerDegreesToQuat} from '../src/motion/math.ts';
import {procedureByName} from '../src/motion/modules.ts';
import type {KeyframeModule} from '../src/motion/types.ts';

test('split preserves changed bone animation and ignores non-neutral static channels',()=>{
 const q=eulerDegreesToQuat([0,25,0]),end=eulerDegreesToQuat([0,55,0]);
 const original:KeyframeModule={id:'dance',name:'舞蹈',kind:'keyframes',region:'all',duration:2,modelId:'m',channels:[
  {type:'rotation',key:'leftUpperArm',keys:[{time:0,value:q},{time:1,value:end},{time:2,value:q}]},
  {type:'translation',key:'leftUpperArm',keys:[{time:0,value:[0,0,0]},{time:2,value:[.1,0,0]}]},
  {type:'rotation',key:'rightUpperArm',keys:[{time:0,value:q},{time:2,value:q}]},
  {type:'expression',key:'smile',keys:[{time:0,value:.6},{time:2,value:.6}]},
 ]};
 const clip=createClip(original,15),before=JSON.stringify({original,clip}),parts=splitBodyClip(original,clip,30);
 assert.equal(parts.length,1);assert.equal(parts[0].key,'leftUpperArm');assert.equal(parts[0].module.channels.length,2);assert.equal(JSON.stringify({original,clip}),before);
 const a=createProject('m');a.modules=[original];a.tracks=[{...createTrack('all'),clips:[clip]}];
 const b={...a,modules:parts.map(p=>p.module),tracks:parts.map(p=>({...createTrack(p.key),clips:[p.clip]}))};
 for(const t of [.5,.8,1.3,2.2])assert.deepEqual(evaluateProject(b,t).rotations.leftUpperArm,evaluateProject(a,t).rotations.leftUpperArm);
 assert.equal(evaluateProject(b,.8).rotations.rightUpperArm,undefined);
});

test('trimmed static region is ignored even if source moves outside visible clip',()=>{
 const m:KeyframeModule={id:'x',name:'x',kind:'keyframes',region:'all',duration:2,channels:[{type:'translation',key:'head',keys:[{time:0,value:[0,0,0],interpolation:'hold'},{time:1,value:[1,0,0]},{time:2,value:[2,0,0]}]}]};
 const clip={...createClip(m),sourceOut:.9};assert.deepEqual(splitBodyClip(m,clip,30),[]);
});

test('procedural output is baked at the clip timing',()=>{
 const module=procedureByName('waveLeft')!;const clip={...createClip(module,30),stretch:1.3};
 const parts=splitBodyClip(module,clip,30);assert.ok(parts.some(p=>p.key==='leftUpperArm'));assert.ok(parts.every(p=>p.clip.start===30&&p.clip.stretch===1.3&&p.module.duration===module.duration));
});

test('short subframe key pulses are detected even between sampling frames',()=>{
 const m:KeyframeModule={id:'x',name:'x',kind:'keyframes',region:'all',duration:1,channels:[{type:'expression',key:'smile',keys:[{time:0,value:0},{time:.501,value:1},{time:.502,value:0},{time:1,value:0}]}]};
 assert.equal(splitBodyClip(m,createClip(m),30).length,1);
});
