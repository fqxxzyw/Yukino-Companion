import {test} from 'node:test';
import assert from 'node:assert/strict';
import {samplePartPreview,createPartPreviewModule} from '../src/part-preview.ts';
import {sampleModule} from '../src/motion/modules.ts';

test('temporary bone preview begins and returns to original pose without touching other channels',()=>{
 const input={kind:'bone' as const,id:'head',axis:2 as const,period:2,amplitude:30,rotation:[0,.2,0,Math.sqrt(.96)] as [number,number,number,number]};
 const start=samplePartPreview({...input,elapsed:0}),middle=samplePartPreview({...input,elapsed:.5}),end=samplePartPreview({...input,elapsed:2});
 assert.deepEqual(Object.keys(start.rotations),['head']);assert.deepEqual(start.expressions,{});
 const dot=(a:number[],b:number[])=>Math.abs(a.reduce((n,v,i)=>n+v*b[i],0));
 assert.ok(dot(start.rotations.head,input.rotation)>1-1e-10);assert.ok(dot(middle.rotations.head,input.rotation)<.999);assert.ok(dot(end.rotations.head,input.rotation)>1-1e-10);
 const module=createPartPreviewModule({...input,label:'头',modelId:'test'});assert.ok(module);
 const actual=sampleModule(module,.5).rotations.head;assert.ok(dot(actual,middle.rotations.head)>1-1e-7);
});
test('expression preview clamps weights and only exports selected expression',()=>{
 const input={kind:'expression' as const,id:'smile',label:'微笑',axis:0 as const,period:2,amplitude:.8,weight:.2,modelId:'test'};
 assert.equal(samplePartPreview({...input,elapsed:1}).expressions.smile,1);
 const module=createPartPreviewModule(input);assert.ok(module);assert.deepEqual(module.channels.map(c=>[c.type,c.key]),[['expression','smile']]);
 assert.equal(sampleModule(module,0).expressions.smile,.2);assert.equal(sampleModule(module,2).expressions.smile,.2);
 assert.equal(samplePartPreview({...input,weight:1,elapsed:1}).expressions.smile,.2-Number.EPSILON/4);
});
