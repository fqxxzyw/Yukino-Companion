import * as T from 'three';

// Branch-supported five-petal flowers. No opaque balls or spherical crown cores.
export function sakuraTree(b,x,z,{height=4.4,spread=1.8}={}){
 const r=b.rng,bark=b.mat('bark:cherry-tree','#64514b'),flowers=[],twigs=[];
 const stem=(points,radius)=>b.mesh(b.own(new T.TubeGeometry(new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p))),10,radius,7,false)),bark);
 stem([[x,.12,z],[x-.1,1,z+.1],[x+.14,height*.5,z],[x-.03,height*.77,z+.04]],.12);
 for(let branch=0;branch<12;branch++){
  const a=branch*2.399,reach=spread*(.48+r()*.52),end=[x+Math.cos(a)*reach,height*(.66+r()*.27),z+Math.sin(a)*reach];
  const start=[x,height*(.36+branch*.024),z];stem([start,[(start[0]+end[0])/2,height*.65,(start[2]+end[2])/2],end],.027+r()*.018);
  for(let k=0;k<7;k++){
   const tip=[end[0]+Math.cos(a+k*1.1)*.58,end[1]+(r()-.35)*.65,end[2]+Math.sin(a+k*1.1)*.58];b.tube(end,tip,.009,bark);twigs.push(tip);
   for(let n=0;n<40;n++){const t=r(),offset=.18+r()*.12;flowers.push([T.MathUtils.lerp(end[0],tip[0],t)+(r()-.5)*offset,T.MathUtils.lerp(end[1],tip[1],t)+(r()-.5)*offset,T.MathUtils.lerp(end[2],tip[2],t)+(r()-.5)*offset]);}
  }
 }
 const pos=[],colors=[],idx=[];const center=new T.Color('#bd6d83'),edge=new T.Color('#f1d6d5');
 for(let petal=0;petal<5;petal++){
  const angle=petal*Math.PI*2/5,base=pos.length/3;
  for(let j=0;j<=5;j++)for(let side=0;side<3;side++){
   const t=j/5,w=Math.sin(t*Math.PI)*.38,s=(side-1)*w,rad=.12+t*.9;
   pos.push(Math.cos(angle)*rad-Math.sin(angle)*s,Math.sin(angle)*rad+Math.cos(angle)*s,.06+Math.sin(t*Math.PI)*.13+(side===1?0:.06));
   const color=center.clone().lerp(edge,Math.pow(t,.4));colors.push(color.r,color.g,color.b);
  }
  for(let j=0;j<5;j++)for(let side=0;side<2;side++){const n=base+j*3+side;idx.push(n,n+1,n+3,n+1,n+4,n+3);}
 }
 const geo=b.own(new T.BufferGeometry());geo.setAttribute('position',new T.Float32BufferAttribute(pos,3));geo.setAttribute('color',new T.Float32BufferAttribute(colors,3));geo.setIndex(idx);geo.computeVertexNormals();
 const m=new T.MeshPhysicalMaterial({color:'#ffffff',vertexColors:true,side:T.DoubleSide,roughness:.96,metalness:0,specularIntensity:.14});m.name='paper:sakura-petal';b.materials.add(m);
 m.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>\n diffuseColor.rgb*=.96+.04*sin(vNormal.x*23.0+vNormal.y*17.0);`);};m.customProgramCacheKey=()=> 'sakura-petal-fold-v1';
 const mesh=new T.InstancedMesh(geo,m,flowers.length),o=new T.Object3D();mesh.name='sakura:individual-five-petal-flowers';
 flowers.forEach((p,i)=>{o.position.set(...p);o.rotation.set(r()*6.28,r()*6.28,r()*6.28);o.scale.setScalar(.045+r()*.035);o.updateMatrix();mesh.setMatrixAt(i,o.matrix);mesh.setColorAt(i,new T.Color().setHSL(.97+r()*.04,.05+r()*.13,.75+r()*.2));});
 mesh.castShadow=true;mesh.receiveShadow=true;mesh.computeBoundingSphere();b.root.add(mesh);b.instances.push(mesh);
 const leaves=twigs.filter((_,i)=>i%3===0).map(p=>({x:p[0],y:p[1],z:p[2],size:.13,hue:.21}));b.leaves(leaves,{color:'#87916b'});
 return mesh;
}
