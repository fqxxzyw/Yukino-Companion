import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {STREAM_START,STREAM_END,streamCenter,streamHalfWidth,pathCenter} from './sakura-stream-layout.mjs';

// Grounded clusters give the creek banks a spring understory without putting
// flowers on the footpath or into the water. Instances share three draw calls.
export function addSakuraBankDetails(b,groundHeight){
 const random=b.rng,petals=[];
 for(let i=0;i<5;i++){
  const petal=new T.SphereGeometry(1,7,5),angle=i*Math.PI*2/5;
  petal.scale(.38,.12,.68);petal.rotateY(angle);petal.translate(Math.sin(angle)*.46,0,Math.cos(angle)*.46);petals.push(petal);
 }
 const flowerGeometry=b.own(mergeGeometries(petals));petals.forEach(g=>g.dispose());
 const stemGeometry=b.own(new T.CylinderGeometry(.005,.007,1,5));
 const centerGeometry=b.own(new T.SphereGeometry(1,7,5));
 const flowerMaterial=b.mat('foliage:stream-wildflower-petals','#ffffff',{roughness:.9});
 const stemMaterial=b.mat('foliage:stream-wildflower-stems','#5b7945');
 const centerMaterial=b.mat('foliage:stream-wildflower-centers','#e4b952');
 const heads=[],leaves=[],palette=['#fff7f1','#fff3dd','#f2d6e3','#ead9f3','#ffed9b'].map(c=>new T.Color(c));
 for(let patch=0;patch<125;patch++){
  const z0=-33+random()*60,side=random()<.5?-1:1,edge=streamHalfWidth(z0)+.8+random()*5.8,x0=streamCenter(z0)+side*edge;
  for(let i=0;i<13+Math.floor(random()*18);i++){
   const a=random()*Math.PI*2,r=Math.sqrt(random())*(.28+random()*.55),x=x0+Math.cos(a)*r,z=Math.max(STREAM_START,Math.min(STREAM_END,z0+Math.sin(a)*r));
   if(Math.abs(x-streamCenter(z))<streamHalfWidth(z)+.35||Math.abs(x-pathCenter(z))<1.12)continue;
   const y=groundHeight(x,z),height=.11+random()*.17,size=.038+random()*.034;
   heads.push({x,y,z,height,size,color:palette[(patch+Math.floor(random()*2))%palette.length]});
   if(i%3===0)leaves.push({x,y:y+height*.22,z,size:.04+random()*.035,rx:.65,ry:random()*Math.PI*2,rz:(random()-.5)*1.4});
  }
 }
 const scratch=new T.Object3D();
 function addInstances(name,geometry,material,place){
  const mesh=new T.InstancedMesh(geometry,material,heads.length);mesh.name=name;
  heads.forEach((item,i)=>{place(scratch,item);scratch.updateMatrix();mesh.setMatrixAt(i,scratch.matrix);if(item.color&&name.endsWith('petals'))mesh.setColorAt(i,item.color);});
  mesh.computeBoundingSphere();mesh.castShadow=false;mesh.receiveShadow=true;b.root.add(mesh);b.instances.push(mesh);
 }
 addInstances('sakura-stream:wildflower-stems',stemGeometry,stemMaterial,(o,p)=>{o.position.set(p.x,p.y+p.height/2,p.z);o.rotation.set(0,0,0);o.scale.set(1,p.height,1);});
 addInstances('sakura-stream:wildflower-petals',flowerGeometry,flowerMaterial,(o,p)=>{o.position.set(p.x,p.y+p.height,p.z);o.rotation.set(0,0,0);o.scale.setScalar(p.size);});
 addInstances('sakura-stream:wildflower-centers',centerGeometry,centerMaterial,(o,p)=>{o.position.set(p.x,p.y+p.height+.006,p.z);o.rotation.set(0,0,0);o.scale.set(p.size*.2,p.size*.1,p.size*.2);});
 b.leaves(leaves,{name:'foliage:stream-wildflower-leaves'});

 // A small seat is placed off the walking path and follows the local ground.
 const z=8.2,x=pathCenter(z)-2.1,y=groundHeight(x,z),wood=b.mat('wood:stream-park-bench','#80634d'),metal=b.mat('metal:stream-park-bench','#454b44',{metalness:.45});
 const bench=b.group('sakura-stream:bench',[x,y,z]);
 for(const offset of [-.49,.49]){
  for(const side of [-.17,.17])b.box([side,.22,offset],[.045,.44,.045],metal,bench);
  b.box([-.20,.67,offset],[.055,.56,.055],metal,bench);
 }
 for(let i=0;i<4;i++)b.box([-.18+i*.12,.47,0],[.105,.055,1.24],wood,bench);
 for(let i=0;i<3;i++)b.box([-.22,.67+i*.12,0],[.055,.095,1.24],wood,bench);
 return {flowers:heads.length,bench};
}
