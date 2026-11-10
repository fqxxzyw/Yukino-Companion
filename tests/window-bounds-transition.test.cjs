'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {animateWindowBounds, interpolateBounds} = require('../electron/window-bounds-transition.cjs');

function windowAt(bounds) {
  return {bounds:{...bounds}, writes:[], isDestroyed:()=>false, getBounds(){return {...this.bounds};}, setBounds(value){this.bounds={...value};this.writes.push({...value});}};
}
test('moves and resizes on the same easing timeline and reaches exact target', async () => {
  const from={x:-600,y:20,width:200,height:300},to={x:-300,y:120,width:400,height:600};
  const win=windowAt(from);let time=0;
  assert.equal(await animateWindowBounds(win,to,{duration:100,now:()=>time,wait:async()=>{time+=25;}}),true);
  assert.deepEqual(win.writes[1],interpolateBounds(from,to,.5));
  assert.deepEqual(win.bounds,to);
  assert.ok(win.writes.every(item=>item.width>0&&item.height>0));
});
test('cancellation keeps the current bounds and does not write stale target', async () => {
  const from={x:0,y:0,width:200,height:300},to={x:200,y:100,width:400,height:600};
  const win=windowAt(from);let time=0,current=true;
  const result=await animateWindowBounds(win,to,{duration:100,now:()=>time,isCurrent:()=>current,wait:async()=>{time+=25;if(time===50)current=false;}});
  assert.equal(result,false);assert.deepEqual(win.bounds,interpolateBounds(from,to,.25));
});
test('unchanged bounds do not move, and reduced motion applies immediately', async () => {
  const from={x:5,y:8,width:200,height:300},win=windowAt(from);
  assert.equal(await animateWindowBounds(win,from),true);assert.equal(win.writes.length,0);
  const to={...from,x:35,width:250};assert.equal(await animateWindowBounds(win,to,{reducedMotion:true}),true);
  assert.deepEqual(win.writes,[to]);
});

test('growing and shrinking keep the canvas foot anchor stable within native pixel precision', () => {
  const insets={left:10,right:6,bottom:60};
  const small={x:420,y:450,width:179,height:310};
  // Same canvas bottom centre, with native integer coordinates.
  const large={x:330,y:150,width:359,height:610};
  const anchor=bounds=>({x:bounds.x+insets.left+(bounds.width-insets.left-insets.right)/2,y:bounds.y+bounds.height-insets.bottom});
  const start=anchor(small);
  for(const [from,to] of [[small,large],[large,small]])for(let n=0;n<=100;n++){
    const actual=anchor(interpolateBounds(from,to,n/100,insets));
    assert.ok(Math.abs(actual.x-start.x)<=.5,`horizontal anchor jitter at ${n}%`);
    assert.equal(actual.y,start.y,`vertical anchor jitter at ${n}%`);
  }
});

test('moving and resizing follow one smooth canvas anchor path on negative-coordinate monitors', () => {
  const from={x:-1200,y:420,width:179,height:310},to={x:-690,y:130,width:359,height:610},insets={left:10,right:6,bottom:60};
  const anchor=b=>({x:b.x+insets.left+(b.width-insets.left-insets.right)/2,y:b.y+b.height-insets.bottom});
  const a=anchor(from),b=anchor(to);let previous=from;
  for(let n=1;n<=100;n++){
    const t=n/100,eased=t*t*(3-2*t),current=interpolateBounds(from,to,t,insets),point=anchor(current);
    assert.ok(Math.abs(point.x-(a.x+(b.x-a.x)*eased))<=.5);
    assert.ok(Math.abs(point.y-(a.y+(b.y-a.y)*eased))<=.5);
    assert.ok(current.width>=previous.width&&current.height>=previous.height,'resize never reverses direction');
    previous=current;
  }
  assert.deepEqual(previous,to);
});
