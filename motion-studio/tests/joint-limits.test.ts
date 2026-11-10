import {test} from 'node:test';
import assert from 'node:assert/strict';
import {limitJointAngles,limitJointQuaternion} from '../src/joint-limits.ts';
import {eulerDegreesToQuat,quatToEulerDegrees} from '../src/motion/math.ts';
import {samplePartPreview} from '../src/part-preview.ts';

test('manual limits bound new edits while keeping an existing out-of-range pose',()=>{
 assert.deepEqual(limitJointAngles('head',[120,0,0],[0,0,0]),[65,0,0]);
 assert.deepEqual(limitJointAngles('head',[110,0,0],[100,0,0]),[100,0,0]);
 assert.deepEqual(limitJointAngles('head',[80,0,0],[100,0,0]),[80,0,0]);
 assert.deepEqual(limitJointAngles('head',[80,90,0],[100,90,0]),[80,90,0], 'editing one axis keeps other pre-existing outliers');
});
test('IK and temporary preview apply limits only when enabled',()=>{
 const base=eulerDegreesToQuat([60,0,0]),next=eulerDegreesToQuat([85,0,0]);
 assert.ok(Math.abs(quatToEulerDegrees(limitJointQuaternion('head',next,base))[0]-65)<1e-6);
 const outside=eulerDegreesToQuat([80,0,0]);
 assert.ok(Math.abs(quatToEulerDegrees(limitJointQuaternion('head',outside,outside))[0]-80)<1e-6,'unchanged IK pose is not forced back inside the range');
 const params={kind:'bone' as const,id:'head',elapsed:.5,period:2,amplitude:50,axis:0 as const,rotation:base};
 assert.ok(quatToEulerDegrees(samplePartPreview({...params,limitsEnabled:true}).rotations.head)[0]<=65.001);
 assert.ok(quatToEulerDegrees(samplePartPreview(params).rotations.head)[0]>65);
});
