import * as T from 'three';
import {Diorama} from './diorama-kit.mjs';
import {canopyRays} from './canopy-rays.mjs';
import {bambooSway} from './bamboo-sway.mjs';

export function createScene({scene,renderer}){
 const b=new Diorama(scene,renderer,'Arashiyama_Bamboo_Path'),r=b.rng;
 b.plinth(21,25,'#5b5845');
 const earth=b.mat('soil:mossy-bank','#73674f'),path=b.mat('asphalt:forest-aggregate','#74776e');
 const culm=new T.MeshPhysicalMaterial({color:'#c2cba6',roughness:.98,metalness:0,specularIntensity:.12,envMapIntensity:.12});culm.name='bamboo:culm';b.materials.add(culm);
 const twigMaterial=b.mat('bamboo:twig','#465b38',{roughness:1});
 const twigGeometry=[b.own(new T.CylinderGeometry(.6,1,1,6)),b.own(new T.CylinderGeometry(1/6,1,1,6))];
 const twig=(start,end,radius=.018)=>{const a=new T.Vector3(...start),c=new T.Vector3(...end),mid=a.clone().lerp(c,.55);mid.y+=.12;const points=[a,mid,c];for(let i=0;i<2;i++){const u=points[i],v=points[i+1],r=radius*(i===0?1:.6);const o=b.mesh(twigGeometry[i],twigMaterial,u.clone().add(v).multiplyScalar(.5).toArray(),[r,u.distanceTo(v),r]);o.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),v.clone().sub(u).normalize());}};
 const fence=b.mat('wood:bamboo-fence','#8f8464'),brush=b.mat('wood:brush-fence','#685344'),stone=b.mat('stone:drainage','#6c7364');
 const center=z=>.8*Math.sin(z*.2)+.35*Math.sin(z*.4+1);
 const strip=(width,y,m)=>{
  const pos=[],uv=[],idx=[];for(let j=0;j<=100;j++){const z=12-j*.208;for(let side of [-1,1]){pos.push(center(z)+side*width/2,y,z);uv.push((side+1)/2,j/100);}}
  for(let j=0;j<100;j++){const n=j*2;idx.push(n,n+1,n+2,n+1,n+3,n+2);}
  const g=b.own(new T.BufferGeometry());g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();b.mesh(g,m);
 };
 b.box([0,.1,0],[20.8,.2,24.8],earth);strip(3.5,.245,path);
 b.box([0,.22,-9],[20.5,.045,2.25],path);
 const bankGeometry=b.own(new T.PlaneGeometry(20.7,24.6,60,70));bankGeometry.rotateX(-Math.PI/2);
 const bankPosition=bankGeometry.attributes.position;
 for(let i=0;i<bankPosition.count;i++){const x=bankPosition.getX(i),z=bankPosition.getZ(i),edge=Math.abs(x-center(z));bankPosition.setY(i,z< -7.8?.18:.18+Math.max(0,Math.min(1,(edge-1.8)*.9))*(.35+.15*Math.sin(x*1.8+z*.6)));}
 bankGeometry.computeVertexNormals();b.mesh(bankGeometry,earth);
 // Nodes are part of the culm profile, with slightly flared joints and taper.
 const profile=[];const segments=23;
 for(let j=0;j<segments;j++){const y=j/segments,rad=.095*(1-y*.42);profile.push(new T.Vector2(rad,y),new T.Vector2(rad*1.1,y+.003),new T.Vector2(rad*.96,y+.008),new T.Vector2(rad*.97,(j+1)/segments-.002));}
 profile.push(new T.Vector2(.048,1));
 const bambooGeometry=b.own(new T.LatheGeometry(profile,14)),transforms=[],colors=[],leafPoints=[],o=new T.Object3D();
 for(let j=0;j<355;j++){
  const rear=j>=300,z=rear?-10.6-r()*.9:-7.7+r()*19.3,side=j%2?1:-1,x=rear?-9+r()*18:center(z)+side*(2.25+r()*7.1),h=9+r()*5.2,tilt=(r()-.5)*.055;
  o.position.set(x,.2,z);o.rotation.set((r()-.5)*.04,r()*6.28,tilt);o.scale.set(.8+r()*.55,h,.8+r()*.55);o.updateMatrix();transforms.push(o.matrix.clone());colors.push(new T.Color().setHSL(.23+r()*.055,.18+r()*.13,.36+r()*.14));
  for(let k=0;k<2;k++){
   const localY=.69+k*.17,start=new T.Vector3(0,localY,0).applyMatrix4(o.matrix),a=r()*6.28,end=[start.x+Math.cos(a)*.85,start.y+.65,start.z+Math.sin(a)*.85];twig(start.toArray(),end,.012);
   for(let n=0;n<44;n++)leafPoints.push({x:end[0]+(r()-.5)*1.5,y:end[1]+(r()-.5)*.7,z:end[2]+(r()-.5)*1.5,size:.23+r()*.16,hue:.22+r()*.055});
  }
  for(let n=0;n<22;n++)leafPoints.push({x:x+(r()-.5)*1.4,y:h-.3+r()*.6,z:z+(r()-.5)*1.4,size:.24+r()*.14});
 }
 const stems=new T.InstancedMesh(bambooGeometry,culm,transforms.length);stems.name='bamboo:segmented-culms';transforms.forEach((m,i)=>{stems.setMatrixAt(i,m);stems.setColorAt(i,colors[i]);});stems.castShadow=true;stems.receiveShadow=true;stems.computeBoundingSphere();b.instances.push(stems);b.root.add(stems);
 // Branches grow from actual culm nodes, sweep upward and taper into foliage.
 // Only near-path culms form an arch; no disconnected horizontal cross-bars.
 const nearPath=transforms.filter(m=>{const p=new T.Vector3().setFromMatrixPosition(m);return Math.abs(p.x-center(p.z))<3.5&&p.z>-8;});
 for(const matrix of nearPath.filter((_,i)=>i%2===0)){
  const start=new T.Vector3(0,.7,0).applyMatrix4(matrix),z=start.z;
  const end=[T.MathUtils.lerp(start.x,center(z),.55),start.y+.85,z+.35];twig(start.toArray(),end,.016);
  for(let k=0;k<250;k++)leafPoints.push({x:end[0]+(r()-.5)*2.3,y:end[1]+(r()-.5)*.7,z:end[2]+(r()-.5)*1.8,size:.24+r()*.17});
 }
 b.leaves(leafPoints,{narrow:true,name:'bamboo:leaf-sprays',color:'#6f855a'});
 const rock=b.own(new T.DodecahedronGeometry(.14,0));
 for(let side of [-1,1]){
  for(let j=0;j<65;j++){
   const z=11.8-j*.3,x=center(z)+side*1.9,nextZ=z-.3,nx=center(nextZ)+side*1.9;
   for(const y of [.72,1.43])b.tube([x,y,z],[nx,y,nextZ],.043,fence);
   if(j%4===0)b.tube([x,.2,z],[x,1.65,z],.065,fence);
   b.mesh(rock,stone,[x-side*.08,.24,z],[.75+r()*.5,.45,.8+r()*.6]);
   for(let k=0;k<8;k++){const tz=z-k*.0375,tx=center(tz)+side*1.97,h=1.4+r()*.6;b.tube([tx,.2,tz],[tx+(r()-.5)*.22,h,tz+(r()-.5)*.16],.012,brush);if(k%2===0)b.tube([tx,.9,tz],[tx+side*.12,h+.2,tz+.2],.007,brush);}
  }
 }
 // T junction: a cross path, mossy retaining stones and a rear brush fence.
 for(let i=0;i<52;i++){const x=-10+i*.39;b.mesh(rock,stone,[x,.45,-10.22],[1.6,1.8+r(),1.8]);}
 for(let i=0;i<580;i++){const x=-10+i*.0345;b.tube([x,.55,-10.5],[x+(r()-.5)*.18,1.65+r()*.5,-10.5+(r()-.5)*.24],.012,brush);}
 for(const y of [.85,1.55])b.tube([-10,y,-10.45],[10,y,-10.45],.045,fence);
 const undergrowth=[];
 for(let i=0;i<6200;i++){const z=-7.5+r()*19,x=center(z)+(i%2?1:-1)*(2.1+r()*1.2);undergrowth.push({x,y:.5+r()*.28,z,size:.08+r()*.08,hue:.21+r()*.06});}
 b.leaves(undergrowth,{name:'ground:fern-leaves',color:'#748051'});
 // Fine fallen bamboo leaves and irregular moss stones break the clean verge.
 const litter=[];for(let i=0;i<1800;i++){const z=-7.5+r()*19,x=center(z)+(i%2?1:-1)*(1.52+r()*.25);litter.push({x,y:.255+r()*.008,z,size:.055+r()*.09,rx:Math.PI/2,ry:0,rz:r()*6.28,hue:.105+r()*.04});}
 b.leaves(litter,{narrow:true,name:'ground:fallen-bamboo-leaves',color:'#b5a17b'}).material.userData.windUniforms.uWindStrength.value=0;
 for(let i=0;i<38;i++){const z=-7+r()*18,x=center(z)+(i%2?1:-1)*(2.4+r()*.8);b.mesh(rock,stone,[x,.46,z],[2+r()*2,1+r(),2+r()]);}
 for(const x of [-6,-3,0,3,6]){b.shrubs(x,-11,2.6,1.2,2.4);b.tree(x,-11.2,5.5+r()*1.4,1.5);}
 // The central path remains open; canopy leaves frame the vanishing point.
 b.tree(-7,-9,6.8,1.4);b.tree(8,-10,7,1.5);
 const lampHousing=b.mat('metal:path-lamp','#343b34',{metalness:.2});
 for(let i=0;i<6;i++){const z=10-i*3.5,x=center(z)+(i%2?1:-1)*1.72;
  b.box([x,.43,z],[.22,.37,.22],lampHousing);b.box([x,.65,z],[.32,.06,.32],lampHousing);
  b.lamp([x,.59,z],{color:'#ffd9a1',intensity:6,range:3.8,radius:.11});b.lamps[b.lamps.length-1].day=0;
 }
 const setSunlight=canopyRays(b);
 const api=b.finish({w:21,d:25,photo:{position:[0,2.3,15.2],target:[-.3,2.6,-7],fov:52},companion:{position:[.8,3,17],target:[0,3,-4],fov:46},overview:[.7,.82,1.5],background:'#72856c'});
 api.setSunlight=setSunlight;
 api.setWind=bambooSway(b,api.root);
 api.lightResponse={sun:.53,ambient:.61,environment:.27};
 api.fidelityDifferences=['Arashiyama-inspired miniature; photographed path and brush fence, not a surveyed map.'];return api;
}
