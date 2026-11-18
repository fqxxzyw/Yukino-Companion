const test=require('node:test'),assert=require('node:assert/strict');

test('head gestures bind only neck/head and expose the extracted clips',async()=>{
 const THREE=await import('three');
 const {bindHeadGesture,HEAD_GESTURE_IDS}=await import('../src/ui/head-gesture.mjs');
 const scene=new THREE.Scene(),neck=new THREE.Object3D(),head=new THREE.Object3D();
 neck.name='neck';head.name='head';scene.add(neck);neck.add(head);
 const gesture=bindHeadGesture({scene});
 assert.ok(gesture);
 assert.deepEqual(HEAD_GESTURE_IDS,['tilt','look-left','look-right']);
 assert.equal(gesture.play('look-left'),true);
 assert.equal(gesture.active,true);
 const state=gesture.update(1);
 assert.equal(state.name,'look-left');
 assert.equal(state.running,true);
 gesture.cancel();
 assert.equal(gesture.active,false);
 assert.equal(gesture.play('missing'),false);
});

test('head gestures refuse a rig without head and neck bones',async()=>{
 const THREE=await import('three');
 const {bindHeadGesture}=await import('../src/ui/head-gesture.mjs');
 assert.equal(bindHeadGesture({scene:new THREE.Scene()}),null);
});
