import * as T from 'three';

// Small street trees keep their crowns outside both shop entrances. Flower
// sprays grow along lateral twigs, with a different leading limb for each tree.
export function sakuraTree(b,x,z,{height=4.4,spread=1.8,heading=0}={}){
 const r=b.rng,bark=b.mat('bark:cherry-tree','#635349'),flowers=[],centers=[],leaves=[];
 function limb(points,baseRadius,tipRadius){
  const curve=new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p)));
  const rings=7,sides=7,geometry=b.own(new T.TubeGeometry(curve,rings,baseRadius,sides,false));
  const positions=geometry.attributes.position,point=new T.Vector3(),axis=new T.Vector3();
  for(let ring=0;ring<=rings;ring++){
   const t=ring/rings;curve.getPointAt(t,axis);
   const taper=T.MathUtils.lerp(1,tipRadius/baseRadius,t);
   for(let side=0;side<=sides;side++){
    const i=ring*(sides+1)+side;
    point.fromBufferAttribute(positions,i).sub(axis).multiplyScalar(taper).add(axis);
    positions.setXYZ(i,point.x,point.y,point.z);
   }
  }
  geometry.computeVertexNormals();return b.mesh(geometry,bark);
 }
 const trunkTop=[x+.17*Math.cos(heading),height*.76,z+.17*Math.sin(heading)];
 limb([[x,.11,z],[x-.08,height*.21,z+.08],[x+.12,height*.5,z],trunkTop],height*.041,height*.014);
 for(let branch=0;branch<11;branch++){
  const angle=heading+branch*2.39996+(r()-.5)*.37;
  const reach=spread*(.62+.32*Math.cos(angle-heading)+r()*.36);
  const start=[x+.07,height*(.34+branch*.026),z+.04];
  const end=[x+Math.cos(angle)*reach,height*(.69+r()*.24),z+Math.sin(angle)*reach*.83];
  limb([start,[start[0]+(end[0]-start[0])*.52,end[1]-.36,start[2]+(end[2]-start[2])*.59],end],.055+r()*.027,.018);
  for(let spray=0;spray<5;spray++){
   const bearing=angle+(spray-2)*.63,reachTip=.38+r()*.34;
   const tip=[end[0]+Math.cos(bearing)*reachTip,end[1]+.13+r()*.39,end[2]+Math.sin(bearing)*reachTip];
   b.tube(end,tip,.012,bark);
   const center=tip.map((v,k)=>(v+end[k])*.5);
   for(let n=0;n<33;n++){
    const t=r(),rad=.09+.13*Math.sin(Math.PI*t),a=r()*Math.PI*2,offset=rad*Math.sqrt(r());
    flowers.push([T.MathUtils.lerp(end[0],tip[0],t)+Math.cos(a)*offset,
     T.MathUtils.lerp(end[1],tip[1],t)+(r()-.5)*rad*1.7,T.MathUtils.lerp(end[2],tip[2],t)+Math.sin(a)*offset]);
    centers.push(...center);
   }
   if(spray%2===0)leaves.push({x:tip[0],y:tip[1]-.04,z:tip[2],size:.12,hue:.19,center});
  }
 }
 // The petals remain cupped and notched from close range. Their short outer
 // fans cost 35 triangles per flower and keep both street trees in two draws.
 const pos=[],colors=[],indices=[],inner=new T.Color('#c47d91'),rim=new T.Color('#ffebeb');
 const profile=[[.42,0,.04],[.12,-.04,.01],[.55,-.30,.12],[.94,-.20,.25],[.88,0,.22],[.98,.18,.25],[.56,.31,.12],[.12,.04,.01]];
 for(let petal=0;petal<5;petal++){
  const a=petal*2*Math.PI/5,first=pos.length/3;
  for(const [rad,tangent,h] of profile){
   pos.push(Math.cos(a)*rad-Math.sin(a)*tangent,Math.sin(a)*rad+Math.cos(a)*tangent,h);
   const color=inner.clone().lerp(rim,Math.min(1,rad));colors.push(color.r,color.g,color.b);
  }
  for(let vertex=1;vertex<=7;vertex++)indices.push(first,first+vertex,first+(vertex%7+1));
 }
 const geo=b.own(new T.BufferGeometry());
 geo.setAttribute('position',new T.Float32BufferAttribute(pos,3));geo.setAttribute('color',new T.Float32BufferAttribute(colors,3));
 geo.setAttribute('crownCenter',new T.InstancedBufferAttribute(new Float32Array(centers),3));geo.setIndex(indices);geo.computeVertexNormals();
 const mat=new T.MeshPhysicalMaterial({color:'#fff9f4',vertexColors:true,side:T.DoubleSide,roughness:.95,specularIntensity:.13});
 mat.name='paper:sakura-petal';b.materials.add(mat);
 mat.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>\n diffuseColor.rgb*=.97+.03*sin(vNormal.x*23.0+vNormal.y*17.0);`);};mat.customProgramCacheKey=()=> 'street-cherry-petal-fold-v2';
 const mesh=new T.InstancedMesh(geo,mat,flowers.length),o=new T.Object3D();mesh.name='sakura:individual-five-petal-flowers';
 flowers.forEach((p,i)=>{
  o.position.set(...p);o.rotation.set(r()*Math.PI*2,r()*Math.PI*2,r()*Math.PI*2);o.scale.setScalar(.061+r()*.032);o.updateMatrix();
  mesh.setMatrixAt(i,o.matrix);mesh.setColorAt(i,new T.Color().setHSL(.972+r()*.025,.055+r()*.06,.84+r()*.12));
 });
 mesh.castShadow=true;mesh.receiveShadow=true;mesh.computeBoundingSphere();b.root.add(mesh);b.instances.push(mesh);
 b.leaves(leaves,{color:'#8a976c'});return mesh;
}
