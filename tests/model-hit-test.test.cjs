'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
test('screen hit testing follows visible 3D geometry and rejects transparent canvas margins',async()=>{
 const THREE=await import('three');const {modelHitTest}=await import('../src/ui/model-hit-test.mjs');
 const scene=new THREE.Group(),material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
 const mesh=new THREE.Mesh(new THREE.BoxGeometry(1,2,.5),material);scene.add(mesh);
 const camera=new THREE.PerspectiveCamera(45,1,.1,100);camera.position.set(0,0,5);camera.lookAt(0,0,0);camera.updateProjectionMatrix();
 const raycaster=new THREE.Raycaster(),rect={left:10,top:20,right:210,bottom:220,width:200,height:200};
 const hit=(x,y)=>modelHitTest({x,y,rect,camera,root:scene,raycaster});
 assert.equal(hit(110,120),true);assert.equal(hit(12,22),false);assert.equal(hit(9,120),false);
 mesh.position.x=1;assert.equal(hit(110,120),false);assert.equal(hit(158,120),true);
 mesh.visible=false;assert.equal(hit(158,120),false);mesh.visible=true;material.visible=false;assert.equal(hit(158,120),false);
 material.dispose();mesh.geometry.dispose();
});
