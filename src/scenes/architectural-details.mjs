import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

const seeded=seed=>()=>{seed=(Math.imul(seed,1664525)+1013904223)|0;return (seed>>>0)/4294967296;};

// Leaf surfaces replace the visible low-poly hedge lumps, following their
// existing placement. Geometry changes silhouettes; the shader supplies grain.
export function refineArchitecture(root,id){
 const added=new THREE.Group();added.name='architectural-refinements';
 const geometries=new Set(),materials=new Set(),instances=new Set();
 const ownG=g=>(geometries.add(g),g),ownM=m=>(materials.add(m),m);
 root.updateMatrixWorld(true);
 if(['school','wedding','kasai'].includes(id)){
  const clusters=[];
  root.traverse(o=>{if(o.isMesh&&['hedge:leaves','shrub:leaves','planting:leaf'].includes(o.material?.name))clusters.push(o)});
  const leaf=new THREE.BufferGeometry();
  leaf.setAttribute('position',new THREE.Float32BufferAttribute([0,-.5,0,-.32,0,0,0,.5,.07,.32,0,0,0,0,.12],3));
  leaf.setIndex([0,1,4,1,2,4,2,3,4,3,0,4]);leaf.computeVertexNormals();ownG(leaf);
  const material=ownM(new THREE.MeshStandardMaterial({color:'#627b47',roughness:.91,side:THREE.DoubleSide}));material.name='hedge:fine-leaves';
  const transforms=[],colors=[],random=seeded(7821),matrix=new THREE.Matrix4(),world=new THREE.Matrix4();
  const object=new THREE.Object3D(),point=new THREE.Vector3(),normal=new THREE.Vector3(),up=new THREE.Vector3(0,0,1);
  const inverse=root.matrixWorld.clone().invert();
  for(const cluster of clusters){
   cluster.geometry.computeBoundingSphere();const sphere=cluster.geometry.boundingSphere;
   for(let i=0;i<(cluster.isInstancedMesh?cluster.count:1);i++){
    if(cluster.isInstancedMesh)cluster.getMatrixAt(i,matrix);else matrix.identity();
    world.copy(inverse).multiply(cluster.matrixWorld).multiply(matrix);
    const scale=new THREE.Vector3().setFromMatrixScale(world);
    const radius=sphere.radius*Math.max(scale.x,scale.y,scale.z);
    const count=Math.min(160,Math.max(40,Math.round(radius*radius*300)));
    for(let j=0;j<count;j++){
     const y=1-2*(j+.5)/count,angle=j*2.399963229728653,ring=Math.sqrt(1-y*y);
     normal.set(Math.cos(angle)*ring,y,Math.sin(angle)*ring);
     point.copy(normal).multiplyScalar(sphere.radius*(.9+random()*.12)).add(sphere.center).applyMatrix4(world);
     if(normal.y<-.65)continue;
     object.position.copy(point);object.quaternion.setFromUnitVectors(up,normal.transformDirection(world));
     object.rotateZ(random()*Math.PI*2);const size=.08+random()*.08;object.scale.set(size,size*1.4,size);object.updateMatrix();
     transforms.push(object.matrix.clone());colors.push(new THREE.Color().setHSL(.23+random()*.035,.25+random()*.2,.19+random()*.11));
    }
   }
   // Retain dark internal mass and original resource ownership, but remove the
   // faceted green surface from the render. The existing hedge core remains.
   cluster.visible=false;
  }
  if(transforms.length){
   const leaves=new THREE.InstancedMesh(leaf,material,transforms.length);leaves.name='hedge:individual-leaves';
   transforms.forEach((m,i)=>{leaves.setMatrixAt(i,m);leaves.setColorAt(i,colors[i]);});
   leaves.castShadow=true;leaves.receiveShadow=true;leaves.computeBoundingSphere();instances.add(leaves);added.add(leaves);
  }
 }
 if(id==='school'){
  const frame=ownM(new THREE.MeshStandardMaterial({color:'#b8bfbd',roughness:.38,metalness:.7}));frame.name='window:aluminium';
  const curtain=ownM(new THREE.MeshStandardMaterial({color:'#a5aaa0',roughness:1}));curtain.name='window:interior-blinds';
  const interior=ownM(new THREE.MeshStandardMaterial({color:'#4b5351',roughness:.94}));interior.name='window:interior-depth';
  const unit=ownG(new THREE.BoxGeometry(1,1,1));
  let windowIndex=0;
  root.traverse(o=>{
   if(!['classroom-window','center-window'].includes(o.name))return;
   const pane=o.children.find(n=>n.material?.name==='school:glass');if(!pane)return;
   pane.position.z=.10;
   const {width,height}=pane.geometry.parameters,columns=width>10?8:4;
   const windowRoot=new THREE.Group();windowRoot.matrixAutoUpdate=false;windowRoot.matrix.copy(o.matrixWorld);windowRoot.name='window:recess-detail';
   // The glass remains a surface. These shallow interior layers explain its
   // depth without claiming a surveyed classroom plan behind the facade.
   const back=new THREE.Mesh(ownG(new THREE.BoxGeometry(width,height,.012)),interior);back.position.z=.025;windowRoot.add(back);
   for(let c=0;c<columns;c++){
    const widthPerPane=width/columns,x=-width/2+(c+.5)*widthPerPane;
    const blindWidth=widthPerPane*(.28+((c+windowIndex)%3)*.14);
    const blind=new THREE.Mesh(ownG(new THREE.BoxGeometry(blindWidth,height*.84,.012)),curtain);
    blind.position.set(x-widthPerPane*.22,.04,.045);windowRoot.add(blind);
    for(let f=0;f<4;f++){
     const fold=new THREE.Mesh(unit,curtain);fold.scale.set(.018,height*.84,.018);fold.position.set(blind.position.x-blindWidth/2+(f+.5)*blindWidth/4,.04,.055);windowRoot.add(fold);
    }
    const transom=new THREE.Mesh(unit,frame);transom.scale.set(widthPerPane,.032,.045);transom.position.set(x,-height*.22,.135);windowRoot.add(transom);
    const divider=new THREE.Mesh(unit,frame);divider.scale.set(.025,height,.045);divider.position.set(x,0,.135);windowRoot.add(divider);
   }
   added.add(windowRoot);windowIndex++;
  });
  // The supplied red gate is horizontal painted panels, not brick bond.
  const seams=ownM(new THREE.MeshStandardMaterial({color:'#643f3c',roughness:.96}));seams.name='gate:panel-recess';
  const caps=ownM(new THREE.MeshStandardMaterial({color:'#a26861',roughness:.83}));caps.name='gate:panel-cap';
  root.traverse(o=>{
   if(o.name!=='red-wall')return;
   const box=new THREE.Box3().setFromObject(o),size=box.getSize(new THREE.Vector3());
   for(let y=box.min.y+.42;y<box.max.y-.05;y+=.42){
    const joint=new THREE.Mesh(ownG(new THREE.BoxGeometry(size.x,.018,.018)),seams);
    joint.position.set(o.position.x,y,box.max.z+.003);joint.name='gate:horizontal-panel-joint';added.add(joint);
   }
   const cap=new THREE.Mesh(ownG(new THREE.BoxGeometry(size.x+.025,.045,size.z+.06)),caps);
   cap.position.set(o.position.x,box.max.y+.018,o.position.z);cap.name='gate:weather-cap';cap.castShadow=true;added.add(cap);
  });
 }
 if(id==='wedding'){
  // Stainless tread edge and grout joints at actual step heights, not a slope
  // overlay. Group follows the factory's 26 linked steps and top landing.
  const steps=root.getObjectByName('grand-stair')?.getObjectByName('stairs:steps');
  if(steps?.isInstancedMesh){
   const grout=ownM(new THREE.MeshStandardMaterial({color:'#8d8b81',roughness:.92}));grout.name='stairs:tile-grout';
   const unit=ownG(new THREE.BoxGeometry(.012,1,.012));
   const mesh=new THREE.InstancedMesh(unit,grout,steps.count*5);mesh.name='stairs:vertical-tile-joints';
   const matrix=new THREE.Matrix4(),world=new THREE.Matrix4(),t=new THREE.Object3D(),inverse=root.matrixWorld.clone().invert();
   for(let i=0;i<steps.count;i++){
    steps.getMatrixAt(i,matrix);world.copy(inverse).multiply(steps.matrixWorld).multiply(matrix);
    const p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();world.decompose(p,q,s);
    for(let j=0;j<5;j++){
     t.position.set(p.x+(j-2)*.94+(i%2)*.22,p.y+s.y/2-.0825,p.z+s.z/2+.002);
     t.scale.set(1,.15,1);t.updateMatrix();mesh.setMatrixAt(i*5+j,t.matrix);
    }
   }
   mesh.receiveShadow=true;instances.add(mesh);added.add(mesh);
  }
 }
 // Static window folds, frames and panel joints are batched by finish. Detail
 // must not add hundreds of draw calls to the companion background renderer.
 added.updateMatrixWorld(true);
 const batches=new Map();
 added.traverse(o=>{if(o.isMesh&&!o.isInstancedMesh){const list=batches.get(o.material)||[];list.push(o);batches.set(o.material,list);}});
 for(const [material,meshes]of batches){
  if(meshes.length<2)continue;
  const copies=meshes.map(m=>m.geometry.clone().applyMatrix4(m.matrixWorld));
  const merged=mergeGeometries(copies);copies.forEach(g=>g.dispose());
  if(!merged)continue;
  const mesh=new THREE.Mesh(ownG(merged),material);mesh.name=`detail:${material.name}`;
  mesh.castShadow=true;mesh.receiveShadow=true;
  meshes.forEach(m=>m.removeFromParent());added.add(mesh);
 }
 root.add(added);
 return {root:added,dispose(){added.removeFromParent();for(const i of instances)i.dispose();for(const g of geometries)g.dispose();for(const m of materials)m.dispose();}};
}
