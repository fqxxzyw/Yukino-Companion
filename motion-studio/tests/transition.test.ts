import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPoseTransition} from '../src/motion/transition.ts';
import {sampleModule} from '../src/motion/modules.ts';

test('a captured start and edited end produce a real smooth interpolated clip with only changed channels',()=>{
 const initial={rotations:{},translations:{},expressions:{smile:.2}},end={rotations:{},translations:{},expressions:{smile:.8}};
 const clip=createPoseTransition(initial,end,2,{},'model');assert.ok(clip);
 assert.equal(clip.channels.length,1);assert.equal(sampleModule(clip,0).expressions.smile,.2);
 assert.ok(Math.abs(sampleModule(clip,1).expressions.smile-.5)<1e-6);assert.equal(sampleModule(clip,2).expressions.smile,.8);
 assert.equal(createPoseTransition(initial,initial,1,{},'model'),null);
});
test('native channels bind to the current model and missing channels begin at rest',()=>{
 const start={rotations:{},translations:{},expressions:{}},end={rotations:{'native:arm':[0,0,1,0] as [number,number,number,number]},translations:{},expressions:{}};
 const clip=createPoseTransition(start,end,1,{},'current');assert.ok(clip);assert.equal(clip.modelId,'current');
 assert.deepEqual(sampleModule(clip,0).rotations['native:arm'],[0,0,0,1]);
});
test('equivalent quaternion signs do not create a false motion',()=>{
 const start={rotations:{head:[0,0,0,1] as [number,number,number,number]},translations:{},expressions:{}};
 const end={rotations:{head:[0,0,0,-1] as [number,number,number,number]},translations:{},expressions:{}};
 assert.equal(createPoseTransition(start,end,1,{},'model'),null);
});
