'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');

test('scene navigation only permits the authored clear area and a complete footprint',async()=>{
 const {navigationFromAnchor,isSafePoint,isSafeSegment,chooseSceneDestination}=await import('../src/ui/scene-navigation.mjs');
 const anchor={position:{x:0,y:0,z:.9},userData:{floorY:0,standingArea:{minX:-2,maxX:2,minZ:-.6,maxZ:2.4},clearRadius:.58}};
 const nav=navigationFromAnchor(anchor,{radius:.18});
 assert.ok(nav);
 assert.equal(isSafePoint(nav,{x:.39,z:.9}),true);
 assert.equal(isSafePoint(nav,{x:.41,z:.9}),false);
 assert.equal(isSafeSegment(nav,{x:-.35,z:.9},{x:.35,z:.9}),true);
 assert.equal(isSafeSegment(nav,{x:-.35,z:.9},{x:.45,z:.9}),false);
 const numbers=[0,.64];let i=0;
 const destination=chooseSceneDestination(nav,{x:0,z:.9},()=>numbers[i++%numbers.length]);
 assert.ok(destination);assert.equal(destination.y,0);assert.equal(isSafeSegment(nav,{x:0,z:.9},destination),true);
 assert.equal(navigationFromAnchor(anchor,{radius:.59}),null);
 assert.equal(navigationFromAnchor({position:anchor.position,userData:{...anchor.userData,clearRadius:undefined}}),null);
 assert.equal(chooseSceneDestination(nav,{x:9,z:9}),null);
});

test('navigation clips the authored safety circle to the standing rectangle',async()=>{
 const {navigationFromAnchor,isSafePoint}=await import('../src/ui/scene-navigation.mjs');
 const nav=navigationFromAnchor({position:{x:0,y:0,z:0},userData:{floorY:0,standingArea:{minX:-.2,maxX:.2,minZ:-1,maxZ:1},clearRadius:1}},{radius:.05});
 assert.ok(nav);assert.equal(isSafePoint(nav,{x:.16,z:0}),false);assert.equal(isSafePoint(nav,{x:.1,z:0}),true);
});
