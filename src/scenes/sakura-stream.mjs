import * as T from 'three';
import {Diorama} from './diorama-kit.mjs';
import {addClearStream} from './clear-stream.mjs';
import {addSakuraLife} from './sakura-stream-life.mjs';
import {addSakuraBankDetails} from './sakura-bank-details.mjs';
import {addSakuraWoodlandUnderstory} from './sakura-woodland-understory.mjs';
import {finishMeadowGround,addMeadowBlades} from './sakura-ground.mjs';
import {STREAM_LEVEL,STREAM_BANK_RISE,STREAM_BANK_RUN,STREAM_START,STREAM_END,streamCenter,streamHalfWidth,streamBedY,pathCenter} from './sakura-stream-layout.mjs';

const mix=T.MathUtils.lerp,clamp=T.MathUtils.clamp;
const smooth=value=>{const t=clamp(value,0,1);return t*t*(3-2*t);};
const terrainNoise=(x,z)=>Math.sin(x*.73+z*.29)*.031+Math.sin(x*1.31-z*.43+.8)*.022;
const pathWidth=z=>1.68+.15*Math.sin(z*.17+.8)+.075*Math.sin(z*1.13)+.045*Math.sin(z*2.7+.3);
const scenePathCenter=z=>pathCenter(z)+.075*Math.sin(z*.77)+.04*Math.sin(z*1.6+.8);

// One bank height field owns rock, grass, path and landed-petal contact. The
// wet edge rises from the actual bed to the fixed waterline without a void.
export function terrainHeight(x,z){
 const d=Math.abs(x-streamCenter(z))-streamHalfWidth(z);
 if(d<=-.65)return streamBedY(x,z);
 if(d<0)return mix(streamBedY(x,z),STREAM_LEVEL+.035,smooth((d+.65)/.65));
 const crest=smooth(d/STREAM_BANK_RUN);
 return STREAM_LEVEL+.035+STREAM_BANK_RISE*crest+terrainNoise(x,z)*smooth(d*1.4)+(.085*Math.sin(x*.21+z*.09)+.065*Math.sin(x*.12-z*.17))*smooth(d/2.4);
}
export const groundHeight=(x,z)=>terrainHeight(x,z)+(Math.abs(x-scenePathCenter(z))<pathWidth(z)/2?.023:0);

export function createScene({scene,renderer}){
 const b=new Diorama(scene,renderer,'Sakura_Stream'),random=b.rng;
 const keep=(mesh,name)=>{mesh.name='sakura-stream:'+name;mesh.userData.keep=true;return mesh;};
 const finish=(material,roughness=.95,envMapIntensity=.15)=>{material.userData.surfaceFinish={roughness,metalness:0,envMapIntensity};return material;};
 const bedMaterial=finish(b.mat('stone:shallow-stream-bed','#ffffff',{vertexColors:true}),.93,.13);
 const bankMaterial=finish(b.mat('soil:stream-bank','#ffffff',{vertexColors:true}),.99,.1);
 const pathMaterial=finish(b.mat('soil:compacted-blossom-path','#ffffff',{vertexColors:true}),.98,.1);
 const palette={bed:['#8d8777','#aaa08a','#767f77','#a79a88','#8a9285'].map(c=>new T.Color(c)),grass:['#657f45','#789050','#5f7948','#6c844c'].map(c=>new T.Color(c)),shingle:['#a19c86','#858d77','#b1a78e'].map(c=>new T.Color(c)),path:['#9b9078','#a69a82','#938b76'].map(c=>new T.Color(c))};
 // Root fibres and mineral grain are sampled at world scale beneath the real
 // curved blades; bare soil, dry grass and moss meet across irregular patches.
 finishMeadowGround(b,bankMaterial,pathMaterial);

 function strip(name,columns,point,color,material,{rows=144,start=STREAM_START,end=STREAM_END}={}){
  const positions=[],colors=[],uvs=[],indices=[];
  for(let row=0;row<=rows;row++){
   const z=mix(start,end,row/rows);
   for(let col=0;col<columns.length;col++){
    const p=point(columns[col],z),c=color(p[0],p[1],z,col,row);positions.push(...p);colors.push(c.r,c.g,c.b);uvs.push(p[0]*.2,z*.2);
    if(row&&col){const a=(row-1)*columns.length+col-1,c=row*columns.length+col-1;indices.push(a,c,a+1,a+1,c,c+1);}
   }
  }
  const geometry=b.own(new T.BufferGeometry());geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new T.Float32BufferAttribute(new Float32Array(positions.length),3));geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));geometry.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();return keep(b.mesh(geometry,material),name);
 }
 const mottled=(colors,x,z,scale=.12)=>{const blend=clamp(.5+.22*Math.sin(x*.22+z*.11)+.18*Math.cos(x*.13-z*.19),0,1);return colors[0].clone().lerp(colors[1],blend).lerp(colors[2],.22+.12*Math.sin(x*.12+z*.08)).multiplyScalar(.97+scale*.3*Math.sin(x*.7+z*.5));};
 const riverbed=strip('riverbed',Array.from({length:25},(_,i)=>i/12-1),(u,z)=>{const x=streamCenter(z)+u*streamHalfWidth(z);return [x,streamBedY(x,z)-.008+terrainNoise(x*2,z*2)*.18,z];},(x,_y,z)=>mottled(palette.bed,x,z,.15),bedMaterial);
 const distances=[-.65,-.35,0,.18,.35,.55,.8,1,1.25,1.5,1.75,2,2.25,2.8,4.5,7,11,18,28];
 const banks=[];
 for(const side of [-1,1]){
  const columns=side<0?[...distances].reverse():distances;
  banks.push(strip(side<0?'left-bank':'right-bank',columns,(d,z)=>{const x=streamCenter(z)+side*(streamHalfWidth(z)+d);return [x,terrainHeight(x,z),z];},(x,_y,z)=>{
   const d=Math.abs(x-streamCenter(z))-streamHalfWidth(z),shingle=mottled(palette.shingle,x,z,.12),grass=mottled(palette.grass,x,z,.13);return shingle.lerp(grass,smooth((d-.3)/1.85));
  },bankMaterial));
 }
 const path=strip('blossom-path',[-1,-.6,-.2,.2,.6,1],(u,z)=>{const x=scenePathCenter(z)+u*pathWidth(z)/2;return [x,terrainHeight(x,z)+.023,z];},(x,_y,z)=>mottled(palette.path,x,z,.13),pathMaterial);

 // Rounded, buried pebbles supply the colours actually seen through refraction.
 const pebbleGeometry=b.own(new T.IcosahedronGeometry(1,2));
 const position=pebbleGeometry.attributes.position;
 for(let i=0;i<position.count;i++){
  const x=position.getX(i),y=position.getY(i),z=position.getZ(i),scale=1+.065*Math.sin(x*8+z*6)+.045*Math.cos(z*9-y*7);position.setXYZ(i,x*scale,y*scale,z*scale);
 }
 // Retain the original radial smooth normals after a small coherent shape
 // perturbation; non-indexed face normals would turn rounded stones faceted.
 pebbleGeometry.attributes.normal.needsUpdate=true;
 const wetStone=finish(b.mat('stone:submerged-rounded-pebbles','#ffffff'),.7,.19);wetStone.userData.weatherExposure=false;
 const dryStone=finish(b.mat('stone:bank-pebbles','#ffffff'),.93,.1);
 const stoneColors=['#b1a592','#908f85','#7b837d','#b8b1a0','#858c88','#b19e8c'].map(c=>new T.Color(c));
 function instances(name,geometry,material,items){
  const mesh=new T.InstancedMesh(geometry,material,items.length),object=new T.Object3D();mesh.name='sakura-stream:'+name;
  items.forEach((item,i)=>{object.position.set(...item.position);object.rotation.set(...(item.rotation||[0,0,0]));object.scale.set(...item.scale);object.updateMatrix();mesh.setMatrixAt(i,object.matrix);if(item.color)mesh.setColorAt(i,item.color);});
  mesh.castShadow=true;mesh.receiveShadow=true;mesh.computeBoundingSphere();b.root.add(mesh);b.instances.push(mesh);return mesh;
 }
 const submerged=[];
 for(let i=0;i<2450;i++){
  const z=mix(STREAM_START,STREAM_END,random()),u=(random()*2-1)*.95,x=streamCenter(z)+u*streamHalfWidth(z),size=.055+Math.pow(random(),1.7)*.25;
  const y=Math.min(streamBedY(x,z)+.014,terrainHeight(x,z)-.012);submerged.push({position:[x,y,z],scale:[size,.032+size*.3,size*(.75+random()*.5)],rotation:[random()*.5,random()*6.28,random()*.4],color:stoneColors[i%stoneColors.length]});
 }
 const submergedStones=instances('submerged-pebbles',pebbleGeometry,wetStone,submerged);
 const loose=[];
 for(let i=0;i<1050;i++){
  const z=mix(STREAM_START,STREAM_END,random()),side=random()<.5?-1:1,d=.05+random()*1.7,x=streamCenter(z)+side*(streamHalfWidth(z)+d),boulder=i%7===0,size=boulder?.16+random()*.24:.025+random()*.12;
  // Larger half-buried cobbles expose the bank's height and eroded shoulder;
  // they share the height field instead of hovering over a decorative rim.
  const dx=.02,gradient=(terrainHeight(x+dx,z)-terrainHeight(x-dx,z))/(dx*2);
  loose.push({position:[x,terrainHeight(x,z)+size*.08,z],scale:[size,size*(boulder?.55:.32),size*(.75+random()*.4)],rotation:[random()*.25,random()*6.28,Math.atan(gradient)+(random()-.5)*.12],color:stoneColors[(i+3)%stoneColors.length]});
 }
 instances('shore-shingle',pebbleGeometry,dryStone,loose);
 const pathGravel=[];
 for(let i=0;i<1050;i++){
  const z=mix(STREAM_START,STREAM_END,random()),side=random()<.5?-1:1,edge=random()<.86,u=edge?side*(.66+random()*.38):random()*1.7-.85,x=scenePathCenter(z)+u*pathWidth(z)/2,size=.009+random()*.026;
  pathGravel.push({position:[x,groundHeight(x,z)+.002,z],scale:[size,size*.25,size*(.75+random()*.6)],rotation:[random()*.3,random()*6.28,random()*.2],color:stoneColors[(i+1)%stoneColors.length].clone().multiplyScalar(.82)});
 }
 instances('path-edge-gravel',pebbleGeometry,dryStone,pathGravel);
 const grass=[],patches=Array.from({length:340},()=>{const z=mix(STREAM_START,STREAM_END,random()),side=random()<.45?-1:1,d=.6+random()*12;return {x:streamCenter(z)+side*(streamHalfWidth(z)+d),z,radius:.45+random()*1.3,fertility:random()};});
 for(let i=0;i<14500;i++){
  const patch=patches[i%patches.length],angle=random()*Math.PI*2,radius=Math.sqrt(random())*patch.radius,z=clamp(patch.z+Math.sin(angle)*radius,STREAM_START,STREAM_END),x=patch.x+Math.cos(angle)*radius;
  const bankDistance=Math.abs(x-streamCenter(z))-streamHalfWidth(z);
  if(bankDistance<.25||(bankDistance<1.7&&random()<.66))continue;
  if(Math.abs(x-scenePathCenter(z))<pathWidth(z)*.47)continue;
  const height=.075+random()*(.11+patch.fertility*.1);grass.push({x,z,y:groundHeight(x,z)+height/2,size:height/2,rx:(random()-.5)*.32,ry:random()*6.28,rz:(random()-.5)*.4,hue:.2+random()*.055});
 }
 for(let i=0;i<2500;i++){
  const z=mix(STREAM_START,STREAM_END,random()),side=random()<.5?-1:1,x=scenePathCenter(z)+side*(pathWidth(z)/2+(random()-.2)*.19),height=.035+random()*.09;
  grass.push({x,z,y:groundHeight(x,z)+height/2,size:height/2,rx:(random()-.5)*.5,ry:random()*6.28,rz:(random()-.5)*.5});
 }
 addMeadowBlades(b,grass);
 const reeds=[];
 for(let i=0;i<450;i++){
  const z=mix(-39,28,random()),side=random()<.5?-1:1,x=streamCenter(z)+side*(streamHalfWidth(z)+.24+random()*.45),height=.22+random()*.33;
  reeds.push({x,z,y:terrainHeight(x,z)+height/2,size:height/2,rx:(random()-.5)*.4,ry:random()*6.28,rz:(random()-.5)*.45});
 }
 addMeadowBlades(b,reeds,{reed:true,name:'foliage:stream-edge-reeds'});

 // Irregular scattered petals sit on the path instead of a painted pink ribbon.
 const petalGeometry=b.own(new T.BufferGeometry());petalGeometry.setAttribute('position',new T.Float32BufferAttribute([0,0,-.5,-.32,.055,-.05,-.2,.03,.38,0,.015,.5,.24,.03,.31,.31,.04,-.1],3));petalGeometry.setIndex([0,1,5,1,2,5,2,4,5,2,3,4]);petalGeometry.computeVertexNormals();
 const fallenMaterial=finish(b.mat('paper:fallen-sakura-petals','#ffffff',{side:T.DoubleSide}),.98,.1),petals=[];
 for(let i=0;i<2600;i++){
  const z=mix(STREAM_START,STREAM_END,random()),x=scenePathCenter(z)+(random()-.5)*(pathWidth(z)+1.8),size=.035+random()*.03;
  petals.push({position:[x,groundHeight(x,z)+.0035,z],scale:[size,size,size],rotation:[0,random()*6.28,0],color:new T.Color().setHSL(.96+random()*.06,.07+random()*.13,.78+random()*.16)});
 }
 instances('path-fallen-petals',petalGeometry,fallenMaterial,petals);

 // A low, open green footbridge is a distant landmark, not a wall across water.
 const bridgeZ=-29,center=streamCenter(bridgeZ),half=streamHalfWidth(bridgeZ),span=half*2+4.3;
 const deckY=Math.max(terrainHeight(center-span/2,bridgeZ),terrainHeight(center+span/2,bridgeZ))+.16;
 const green=b.mat('paint:stream-footbridge','#526e5c',{roughness:.82,metalness:.03}),deck=b.mat('wood:stream-bridge-deck','#8c8872'),pier=b.mat('stone:stream-bridge-pier','#8c9481');
 green.userData.surfaceFinish={roughness:.82,metalness:.03,envMapIntensity:.15};
 keep(b.box([center,deckY-.11,bridgeZ],[span,.22,1.65],green),'bridge-deck');
 for(let i=0;i<24;i++)b.box([center-span/2+(i+.5)*span/24,deckY+.015,bridgeZ],[span/24-.022,.03,1.54],deck);
 for(const side of [-1,1]){
  const x=center+side*(half+1.2),base=terrainHeight(x,bridgeZ),height=deckY-.22-base;b.box([x,base+height/2,bridgeZ],[.48,height,1.5],pier);
  b.beam([x-.6,deckY-.22,bridgeZ],[x+.6,deckY-.22,bridgeZ],.14,green,b.root,.16);
 }
 for(const z of [bridgeZ-.78,bridgeZ+.78])b.rail([center-span/2,deckY,z],[center+span/2,deckY,z],.84,green,{spacing:.78,depth:.025});
 function bridgeApproach(side){
  const outer=center+side*(half+4.2),inner=center+side*span/2,points=side<0?[[outer,terrainHeight(outer,bridgeZ)+.03],[inner,deckY]]:[[inner,deckY],[outer,terrainHeight(outer,bridgeZ)+.03]];
  const columns=[0,.5,1],g=strip('bridge-approach-'+(side<0?'left':'right'),columns,(t,z)=>{const x=mix(points[0][0],points[1][0],t);return [x,mix(points[0][1],points[1][1],t),z];},()=>new T.Color('#8e8e79'),pathMaterial,{rows:1,start:bridgeZ-.78,end:bridgeZ+.78});g.userData.bridgeApproach=true;
 }
 bridgeApproach(-1);bridgeApproach(1);
 addSakuraBankDetails(b,groundHeight);
 const water=addClearStream(b,renderer),life=addSakuraLife(b,{groundHeight});
 const eyeZ=15.5,eyeX=scenePathCenter(eyeZ),eyeY=groundHeight(eyeX,eyeZ)+1.65;
 const closeZ=7,closeX=streamCenter(closeZ)-streamHalfWidth(closeZ)-2.55,closeY=groundHeight(closeX,closeZ)+1.45;
 const api=b.finish({w:68,d:76,photo:{position:[closeX,closeY,closeZ],target:[.5,.65,-6],fov:55},companion:{position:[eyeX,eyeY,eyeZ],target:[.7,2,-9.5],fov:53},overview:[-.7,.65,1],background:'#a8c9d9'});
 api.sunAzimuthOffset=110;

 // Backdrop meshes stay outside finite landscape framing so Home does not
 // turn the creek and individual blossom branches into a distant dot.
 const outer=strip('outer-left-bank',[26,95,230],(d,z)=>{const x=streamCenter(z)-streamHalfWidth(z)-d;return [x,terrainHeight(x,z),z];},(x,_y,z)=>mottled(palette.grass,x,z,.08),bankMaterial,{rows:16,start:-90,end:70});
 const outerRight=strip('outer-right-bank',[26,95,230],(d,z)=>{const x=streamCenter(z)+streamHalfWidth(z)+d;return [x,terrainHeight(x,z),z];},(x,_y,z)=>mottled(palette.grass,x,z,.08),bankMaterial,{rows:16,start:-90,end:70});
 // The left strip runs from its near bank outwards, so reverse its winding.
 const oi=outer.geometry.index;for(let i=0;i<oi.count;i+=3){const second=oi.getX(i+1);oi.setX(i+1,oi.getX(i+2));oi.setX(i+2,second);}outer.geometry.computeVertexNormals();
 for(const mesh of [outer,outerRight]){mesh.removeFromParent();api.root.add(mesh);mesh.castShadow=false;}
 strip('rear-ground',[-40,-20,0,20,40],(x,z)=>[x,terrainHeight(x,z),z],(x,_y,z)=>mottled(palette.grass,x,z,.08),bankMaterial,{rows:12,start:-95,end:STREAM_START-.02});
 const mountainHeight=(x,z,far=0)=>{const rise=smooth((-z-46-far*40)/85),rolling=.74+.17*Math.sin(x*.026+z*.012+far)+.13*Math.cos(x*.049-z*.021);return STREAM_LEVEL+STREAM_BANK_RISE+rise*(28+far*12)*rolling;};
 addSakuraWoodlandUnderstory(b,{mountainHeight,terrainHeight});
 for(const [i,start,end,palette]of [[0,-145,-43,['#52715c','#66846d','#739185']],[1,-260,-110,['#789aa2','#87a9b2','#9ab7be']]]){
  const [near,mid,far]=palette.map(color=>new T.Color(color));
  const material=finish(b.mat('soil:wooded-mountain-'+i,'#ffffff',{vertexColors:true}),1,.06),mountain=strip('mountain-layer-'+i,Array.from({length:85},(_,j)=>-220+j*440/84),(x,z)=>[x,mountainHeight(x,z,i),z],(x,_y,z)=>near.clone().lerp(far,smooth((-z-50)/210)).lerp(mid,.12+.1*Math.sin(x*.07+z*.08)),material,{rows:60,start,end});mountain.castShadow=false;
 }
 // Distant forest has porous, folded-leaf silhouettes and branch-supported
 // crowns. No opaque spheres stand in for foliage at the mountain's foot.
 const canopyGeometry=b.own(new T.BufferGeometry());canopyGeometry.setAttribute('position',new T.Float32BufferAttribute([0,-.5,0,-.3,-.05,0,0,.5,.045,.3,-.05,0,0,0,.13],3));canopyGeometry.setIndex([0,1,4,1,2,4,2,3,4,3,0,4]);canopyGeometry.computeVertexNormals();
 const canopyMaterial=finish(b.mat('foliage:wooded-mountain-leaves','#ffffff',{side:T.DoubleSide}),.99,.06),distantBark=finish(b.mat('bark:wooded-distant-trunks','#625c4b'),.98,.08),forestBranches=[];
 // Write the fixed-size forest directly to GPU instance buffers. Retaining
 // hundreds of thousands of intermediate objects and colour strings causes a
 // long garbage-collection pause when entering this scene.
 const canopy=new T.InstancedMesh(canopyGeometry,canopyMaterial,450*5*150),leafObject=new T.Object3D(),leafColor=new T.Color();let leafIndex=0;
 canopy.name='sakura-stream:wooded-distant-leaves';
 const distantBranchGeometry=b.own(new T.CylinderGeometry(.64,1,1,7)),forestNear=new T.Color('#4d704b'),forestHaze=new T.Color('#92aeb1');
 const branch=(a,c,radius)=>{const p=new T.Vector3(...a),q=new T.Vector3(...c),length=p.distanceTo(q),object=new T.Object3D();object.position.copy(p).add(q).multiplyScalar(.5);object.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),q.sub(p).normalize());object.scale.set(radius,length,radius);object.updateMatrix();forestBranches.push(object.matrix.clone());};
 for(let i=0;i<450;i++){
  const x=(random()-.5)*168,z=-49-random()*96,base=mountainHeight(x,z),height=6.8+random()*6.4,spread=height*(.27+random()*.12),haze=smooth((-z-48)/170),forestColor=forestNear.clone().lerp(forestHaze,haze);
  branch([x,base,z],[x+.09,base+height*.81,z+.06],height*.018);
  for(let limb=0;limb<5;limb++){
   const a=limb*2.39996+i*.7,end=[x+Math.cos(a)*spread*.63,base+height*(.6+limb*.065),z+Math.sin(a)*spread*.63];branch([x,base+height*.48,z],end,height*.006);
   for(let leaf=0;leaf<150;leaf++){
    const theta=random()*Math.PI*2,u=random()*2-1,ring=Math.sqrt(1-u*u),rad=Math.pow(random(),.3),size=.29+random()*.3;
    leafObject.position.set(end[0]+Math.cos(theta)*ring*spread*.62*rad,end[1]+u*height*.19*rad,end[2]+Math.sin(theta)*ring*spread*.62*rad);
    leafObject.scale.set(size,size*(1.1+random()*.5),size);leafObject.rotation.set(random()*3.14,random()*6.28,random()*6.28);leafObject.updateMatrix();
    canopy.setMatrixAt(leafIndex,leafObject.matrix);canopy.setColorAt(leafIndex,leafColor.copy(forestColor).multiplyScalar(.75+random()*.5));leafIndex++;
   }
  }
 }
 const branches=new T.InstancedMesh(distantBranchGeometry,distantBark,forestBranches.length);branches.name='sakura-stream:wooded-distant-branches';forestBranches.forEach((matrix,i)=>branches.setMatrixAt(i,matrix));branches.computeBoundingSphere();branches.castShadow=false;branches.receiveShadow=true;b.root.add(branches);b.instances.push(branches);
 canopy.computeBoundingSphere();canopy.castShadow=false;canopy.receiveShadow=true;b.root.add(canopy);b.instances.push(canopy);
 const skyMaterial=new T.ShaderMaterial({name:'sky:sakura-stream',side:T.BackSide,depthWrite:false,fog:false,uniforms:{zenithTint:{value:new T.Color('#4b9bce')},horizonTint:{value:new T.Color('#b6d7e5')}},vertexShader:'varying vec3 vSkyDirection;void main(){vSkyDirection=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:'varying vec3 vSkyDirection;uniform vec3 zenithTint;uniform vec3 horizonTint;void main(){float h=clamp(vSkyDirection.y,0.0,1.0);vec3 color=mix(horizonTint,zenithTint,smoothstep(0.0,.42,h));gl_FragColor=vec4(color,1.0);#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}'});
 // Shader chunk directives must begin on their own line.
 skyMaterial.fragmentShader=skyMaterial.fragmentShader.replace(';#include',';\n#include');b.materials.add(skyMaterial);
 const sky=b.mesh(b.own(new T.SphereGeometry(450,32,16)),skyMaterial,[0,0,0]);sky.name='sakura-stream:sky';sky.renderOrder=-10;sky.castShadow=false;sky.receiveShadow=false;sky.frustumCulled=false;

 const base={update:api.update,setMotion:api.setMotion,dispose:api.dispose};let disposed=false;
 api.update=(dt,t)=>{if(disposed)return;base.update(dt,t);water.update(t);life.update(t);};
 api.setMotion=value=>{base.setMotion(value);water.setMotion(value);life.setMotion(value);};
 api.setWind=wind=>{water.setWind(wind);life.setWind(wind);};
 api.setSunlight=(direction,brightness,cloud)=>{water.setSunlight(direction,brightness,cloud);const day=clamp(brightness,0,1),overcast=clamp(cloud||0,0,1);skyMaterial.uniforms.zenithTint.value.set('#4b9bce').lerp(new T.Color('#aebec5'),overcast*.88).multiplyScalar(.08+.92*day);skyMaterial.uniforms.horizonTint.value.set('#b6d7e5').lerp(new T.Color('#b4c1c6'),overcast*.7).multiplyScalar(.08+.92*day);};
 api.dispose=()=>{if(disposed)return;disposed=true;water.dispose();life.dispose();base.dispose();};
 api.root.userData.sakuraStream={level:STREAM_LEVEL,bankRise:STREAM_BANK_RISE,start:STREAM_START,end:STREAM_END,riverbed:riverbed.name,banks:banks.map(mesh=>mesh.name),path:path.name,stones:submergedStones.count,bridgeZ,groundHeight};
 api.streamWater=water;api.sakuraLife=life;
 return api;
}
