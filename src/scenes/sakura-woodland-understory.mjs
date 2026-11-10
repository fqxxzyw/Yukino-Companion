import * as T from 'three';
import {randomSeed} from './diorama-kit.mjs';

// Low, interlocking understory breaks up the otherwise perfectly bare forest
// floor. Plants are grounded against both overlapping terrain surfaces.
export function addSakuraWoodlandUnderstory(b,{mountainHeight,terrainHeight}){
 const random=randomSeed(981627),positions=[],indices=[];
 // A clump of pointed broad leaves seen from multiple directions. All shrubs
 // share this geometry and material; no per-shrub scene nodes are created.
 for(let leaf=0;leaf<7;leaf++){
  const a=leaf*Math.PI*2/7,rad=.42+(leaf%3)*.08,dx=Math.cos(a),dz=Math.sin(a),tx=-dz*.26,tz=dx*.26,start=positions.length/3;
  positions.push(0,.01,0,dx*rad*.5+tx,.40+leaf%2*.08,dz*rad*.5+tz,dx*rad,.37+leaf%3*.10,dz*rad,dx*rad*.5-tx,.40+leaf%2*.08,dz*rad*.5-tz,dx*rad*.45,.65+leaf%3*.08,dz*rad*.45);
  indices.push(start,start+1,start+4,start+1,start+2,start+4,start+2,start+3,start+4,start+3,start,start+4);
 }
 const geometry=b.own(new T.BufferGeometry());geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();
 const material=b.mat('foliage:sakura-woodland-understory','#ffffff',{side:T.DoubleSide,roughness:.98});material.userData.surfaceFinish={roughness:.98,metalness:0,envMapIntensity:.06};
 const plants=[];
 for(let i=0;i<7600;i++){
  const x=(random()-.5)*184,edge=-46-4*Math.sin(x*.07)-1.5*Math.sin(x*.19),z=edge-random()*72;
  const height=Math.max(mountainHeight(x,z),terrainHeight(x,z)),size=.75+random()*1.3;
  plants.push({x,y:height-.04,z,size,angle:random()*Math.PI*2,haze:T.MathUtils.clamp((-z-46)/145,0,.45),color:random()});
 }
 const mesh=new T.InstancedMesh(geometry,material,plants.length),object=new T.Object3D(),colors=['#314f32','#45633b','#607b4c'].map(color=>new T.Color(color)),hazeColor=new T.Color('#83a194'),color=new T.Color();
 mesh.name='sakura-stream:woodland-understory';
 for(let i=0;i<plants.length;i++){
  const p=plants[i];object.position.set(p.x,p.y,p.z);object.rotation.set(0,p.angle,0);object.scale.set(p.size,p.size*(.7+p.color*.4),p.size);object.updateMatrix();mesh.setMatrixAt(i,object.matrix);
  mesh.setColorAt(i,color.copy(colors[p.color<.33?0:p.color<.7?1:2]).lerp(hazeColor,p.haze).multiplyScalar(.83+p.color*.23));
 }
 mesh.castShadow=false;mesh.receiveShadow=true;mesh.computeBoundingSphere();b.root.add(mesh);b.instances.push(mesh);
 return mesh;
}
