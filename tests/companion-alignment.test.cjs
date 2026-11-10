'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {planDesktopAlignment,planDesktopAlignmentCandidates}=require('../electron/companion-geometry.cjs');
const base={workArea:{x:0,y:0,width:1920,height:1080},mainBounds:{x:0,y:0,width:1000,height:700},contentBounds:{x:0,y:0,width:1000,height:700},frame:{x:650,y:100,width:300,height:500},modelBounds:{x:1250,y:244,width:300,height:616},modelCanvas:{x:0,y:56,width:300,height:500}};
test('preserves a correctly positioned viewport without moving or resizing it',()=>{
 const p=planDesktopAlignment(base);
 assert.equal(p.strategy,'direct');
 assert.deepEqual(p.modelBounds,base.modelBounds);
 assert.deepEqual(p.mainBounds,{x:600,y:200,width:1000,height:700});
});
test('clamps the main window and moves the viewport before revealing it',()=>{
 const p=planDesktopAlignment({...base,modelBounds:{...base.modelBounds,x:20,y:244}});
 assert.equal(p.strategy,'move');assert.equal(p.mainBounds.x,0);
 assert.equal(p.canvas.x,650);assert.equal(p.modelBounds.x,650);
});
test('resizes while preserving the foot anchor where space allows',()=>{
 const p=planDesktopAlignment({...base,modelBounds:{x:1300,y:544,width:150,height:366},modelCanvas:{x:0,y:56,width:150,height:250}});
 assert.equal(p.resized,true);assert.equal(p.sourceCanvas.x+p.sourceCanvas.width/2,p.canvas.x+p.canvas.width/2);
 assert.equal(p.sourceCanvas.y+p.sourceCanvas.height,p.canvas.y+p.canvas.height);
 assert.equal(p.modelBounds.width,300);assert.equal(p.modelBounds.height,616);
});
test('uses negative display coordinates and keeps the main window in the selected work area',()=>{
 const p=planDesktopAlignment({...base,workArea:{x:-1600,y:-100,width:1600,height:900},modelBounds:{...base.modelBounds,x:-300,y:200}});
 assert.ok(p.mainBounds.x>=-1600&&p.mainBounds.x+p.mainBounds.width<=0);
 assert.ok(p.mainBounds.y>=-100&&p.mainBounds.y+p.mainBounds.height<=800);
});
test('rejects stale or impossible measurements instead of guessing a layout',()=>{
 assert.equal(planDesktopAlignment({...base,workArea:{x:0,y:0,width:800,height:600}}),null);
 assert.equal(planDesktopAlignment({...base,frame:{x:900,y:0,width:300,height:500}}),null);
 assert.equal(planDesktopAlignment({...base,modelCanvas:{x:0,y:0,width:301,height:500}}),null);
});

const frames={left:{x:50,y:100,width:300,height:500},right:base.frame};
test('selects the measured left or right frame to minimise movement near an edge',()=>{
 const left=planDesktopAlignmentCandidates({...base,frames,preferredSide:'right',modelBounds:{...base.modelBounds,x:100}});
 assert.equal(left.side,'left');assert.equal(left.strategy,'direct');assert.equal(left.modelBounds.x,100);
 const right=planDesktopAlignmentCandidates({...base,frames,preferredSide:'left',modelBounds:{...base.modelBounds,x:1450}});
 assert.equal(right.side,'right');assert.equal(right.strategy,'direct');assert.equal(right.modelBounds.x,1450);
});
test('chooses the obvious desktop side when both positions are possible, retaining preference near centre',()=>{
 const workArea={x:0,y:0,width:2560,height:1080};
 const left=planDesktopAlignmentCandidates({...base,workArea,frames,preferredSide:'right',modelBounds:{...base.modelBounds,x:650}});
 assert.equal(left.side,'left');assert.equal(left.strategy,'direct');
 const center=planDesktopAlignmentCandidates({...base,workArea,frames,preferredSide:'right',modelBounds:{...base.modelBounds,x:1130}});
 assert.equal(center.side,'right');assert.equal(center.strategy,'direct');
 const other=planDesktopAlignmentCandidates({...base,workArea,frames,preferredSide:'left',modelBounds:{...base.modelBounds,x:1130}});
 assert.equal(other.side,'left');assert.equal(other.strategy,'direct');
});
test('uses the character display work area including negative coordinates',()=>{
 const plan=planDesktopAlignmentCandidates({...base,workArea:{x:-1920,y:-100,width:1920,height:1080},frames,preferredSide:'right',modelBounds:{...base.modelBounds,x:-1800,y:144}});
 assert.equal(plan.side,'left');assert.equal(plan.modelBounds.x,-1800);assert.ok(plan.mainBounds.x>=-1920);
});
test('rejects unmeasured or invalid frames and never fabricates their positions',()=>{
 const plan=planDesktopAlignmentCandidates({...base,frames:{left:{...frames.left,x:-1}},preferredSide:'left'});
 assert.equal(plan,null);
 const onlyRight=planDesktopAlignmentCandidates({...base,frames:{right:frames.right},preferredSide:'left'});
 assert.equal(onlyRight.side,'right');
});
test('maximized window stays fixed while choosing the nearest actual frame',()=>{
 const mainBounds={x:-8,y:-8,width:1936,height:1056},contentBounds={x:0,y:0,width:1920,height:1040};
 const maximizedFrames={left:{x:50,y:100,width:300,height:500},right:{x:1570,y:100,width:300,height:500}};
 const input={...base,workArea:{x:0,y:0,width:1920,height:1040},mainBounds,contentBounds,frames:maximizedFrames,lockMain:true};
 const left=planDesktopAlignmentCandidates({...input,modelBounds:{x:100,y:144,width:300,height:616}});
 assert.equal(left.side,'left');assert.deepEqual(left.mainBounds,mainBounds);assert.equal(left.modelBounds.x,50);
 const right=planDesktopAlignmentCandidates({...input,modelBounds:{x:1500,y:144,width:300,height:616}});
 assert.equal(right.side,'right');assert.deepEqual(right.mainBounds,mainBounds);assert.equal(right.modelBounds.x,1570);
});
test('a fixed main window cannot use a frame outside the work area',()=>{
 const plan=planDesktopAlignmentCandidates({...base,lockMain:true,mainBounds:{...base.mainBounds,x:1800},contentBounds:{...base.contentBounds,x:1800},frames});
 assert.equal(plan,null);
});
