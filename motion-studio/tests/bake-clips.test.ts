import test from 'node:test';
import assert from 'node:assert/strict';
import {bakeClips} from '../src/motion/bake-clips.ts';
import {createClip,createTrack,evaluateProject} from '../src/motion/timeline.ts';
import {createProject,readProject,setKeyframe,writeProject,readRuntime,writeRuntime} from '../src/motion/index.ts';
import type {KeyframeModule} from '../src/motion/types.ts';

test('merging independently animated channels preserves each sampled pose and survives project/runtime serialization',()=>{
 const p=createProject('example');
 const base=(id:string):KeyframeModule=>({id,name:id,duration:2,kind:'keyframes',region:'all',channels:[]});
 let a=setKeyframe(base('smile'),'expression','smile',0,0);a=setKeyframe(a,'expression','smile',2,1);
 let b=setKeyframe(base('blink'),'expression','blinkLeft',0,.2);b=setKeyframe(b,'expression','blinkLeft',2,.8);
 const one=createTrack('one','all'),two=createTrack('two','all');const ca=createClip(a,0),cb=createClip(b,0);one.clips=[ca];two.clips=[cb];p.modules=[a,b];p.tracks=[one,two];
 const result=bakeClips(p,[ca.id,cb.id]).project;
 const saved=readProject(writeProject(result)),runtime=readRuntime(writeRuntime(result));
 for(let frame=0;frame<2*p.fps;frame++){
  const expected=evaluateProject(p,frame/p.fps).expressions;
  for(const restored of [result,saved,runtime]){
   const actual=evaluateProject(restored,frame/p.fps).expressions;
   for(const key of ['smile','blinkLeft'])assert.ok(Math.abs((expected[key]??0)-(actual[key]??0))<1e-6,`${key} at ${frame}`);
  }
 }
});
