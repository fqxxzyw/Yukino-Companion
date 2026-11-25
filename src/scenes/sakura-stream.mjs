import * as T from 'three';
import {Diorama} from './diorama-kit.mjs';
import {addClearStream} from './clear-stream.mjs';
import {addSakuraLife} from './sakura-stream-life.mjs';
import {addSakuraBankDetails} from './sakura-bank-details.mjs';
import {addRidgePines} from './sakura-woodland-understory.mjs';
import {finishMeadowGround,addMeadowBlades} from './sakura-ground.mjs';
import {STREAM_LEVEL,STREAM_BANK_RISE,STREAM_BANK_RUN,STREAM_START,STREAM_END,streamCenter,streamHalfWidth,streamBedY,pathCenter} from './sakura-stream-layout.mjs';

const mix=T.MathUtils.lerp,clamp=T.MathUtils.clamp;
const smooth=value=>{const t=clamp(value,0,1);return t*t*(3-2*t);};
const terrainNoise=(x,z)=>Math.sin(x*.73+z*.29)*.031+Math.sin(x*1.31-z*.43+.8)*.022;
const pathWidth=z=>1.68+.15*Math.sin(z*.17+.8)+.075*Math.sin(z*1.13)+.045*Math.sin(z*2.7+.3);
const scenePathCenter=z=>pathCenter(z)+.075*Math.sin(z*.77)+.04*Math.sin(z*1.6+.8);

// One bank height field owns rock, grass, path and landed-petal contact. The
// wet edge rises from the actual bed to the fixed waterline without a void,
// while the rear north margin rises into a wooded hillside inside the diorama.
export const DIORAMA_HALF_X=31;
export function terrainHeight(x,z){
 const d=Math.abs(x-streamCenter(z))-streamHalfWidth(z);
 if(d<=-.65)return streamBedY(x,z);
 if(d<0)return mix(streamBedY(x,z),STREAM_LEVEL+.035,smooth((d+.65)/.65));
 const crest=smooth(d/STREAM_BANK_RUN);
 const northRidge=smooth((-z-26.5)/15.5)*smooth((d-2.8)/5.8)*(3.4+1.15*Math.sin(x*.13+.6)+.65*Math.cos(x*.27-z*.08));
 return STREAM_LEVEL+.035+STREAM_BANK_RISE*crest+northRidge+terrainNoise(x,z)*smooth(d*1.4)+(.085*Math.sin(x*.21+z*.09)+.065*Math.sin(x*.12-z*.17))*smooth(d/2.4);
}
export const groundHeight=(x,z)=>terrainHeight(x,z)+(Math.abs(x-scenePathCenter(z))<pathWidth(z)/2?.023:0);

export function createScene({scene,renderer}){
 const b=new Diorama(scene,renderer,'Sakura_Stream'),random=b.rng;
 const keep=(mesh,name)=>{mesh.name='sakura-stream:'+name;mesh.userData.keep=true;return mesh;};
 const finish=(material,roughness=.95,envMapIntensity=.15)=>{material.userData.surfaceFinish={roughness,metalness:0,envMapIntensity};return material;};
 const bedMaterial=finish(b.mat('stone:shallow-stream-bed','#ffffff',{vertexColors:true}),.94,.08);
 const bankMaterial=finish(b.mat('soil:stream-bank','#ffffff',{vertexColors:true,roughness:1,envMapIntensity:.02}),1,.02);
 const pathMaterial=finish(b.mat('soil:compacted-blossom-path','#ffffff',{vertexColors:true,roughness:1,envMapIntensity:.02}),1,.02);
 const palette={bed:['#8d8777','#aaa08a','#767f77','#a79a88','#8a9285'].map(c=>new T.Color(c)),grass:['#6a935b','#88a769','#688b59','#799b63'].map(c=>new T.Color(c)),shingle:['#a19c86','#858d77','#b1a78e'].map(c=>new T.Color(c)),path:['#9b9078','#a69a82','#938b76'].map(c=>new T.Color(c))};
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
 const grassPigment=(x,z,out)=>out.copy(mottled(palette.grass,x,z,.13));
 const makeBed=(name,options)=>strip(name,Array.from({length:25},(_,i)=>i/12-1),(u,z)=>{const x=streamCenter(z)+u*streamHalfWidth(z);return [x,streamBedY(x,z)-.008+terrainNoise(x*2,z*2)*.18,z];},(x,_y,z)=>mottled(palette.bed,x,z,.15),bedMaterial,options);
 const riverbed=makeBed('riverbed');
 const distances=[-.65,-.35,0,.18,.35,.55,.8,1,1.25,1.5,1.75,2,2.25,2.8,3.6,4.5,5.7,7.5,11,16,22];
 function makeBank(name,side,distances,options){
  const edgeCols=[...distances,'edge'];
  const columns=side<0?[...edgeCols].reverse():edgeCols;
  return strip(name,columns,(d,z)=>{
   const x=d==='edge'?side*DIORAMA_HALF_X:clamp(streamCenter(z)+side*(streamHalfWidth(z)+d),-DIORAMA_HALF_X,DIORAMA_HALF_X);
   return [x,terrainHeight(x,z),z];
  },(x,_y,z)=>{
   const d=Math.abs(x-streamCenter(z))-streamHalfWidth(z),shingle=mottled(palette.shingle,x,z,.12),grass=mottled(palette.grass,x,z,.13);return shingle.lerp(grass,smooth((d-.3)/1.85));
  },bankMaterial,options);
 }
 const banks=[makeBank('left-bank',-1,distances),makeBank('right-bank',1,distances)];
 const makePath=(name,options)=>strip(name,[-1,-.6,-.2,.2,.6,1],(u,z)=>{const x=scenePathCenter(z)+u*pathWidth(z)/2;return [x,terrainHeight(x,z)+.023,z];},(x,_y,z)=>mottled(palette.path,x,z,.13),pathMaterial,options);
 const path=makePath('blossom-path');

 // Rounded, buried pebbles supply the colours actually seen through refraction.
 const pebbleGeometry=b.own(new T.IcosahedronGeometry(1,1));
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
 instances('path-edge-gravel',b.own(new T.IcosahedronGeometry(1,0)),dryStone,pathGravel);
 const grass=[],patches=Array.from({length:760},(_,idx)=>{const z=mix(STREAM_START+.8,STREAM_END-.8,random()),side=random()<.5?-1:1,d=idx%3===0?(.5+random()*24.5):(.4+random()*13.5);return {x:clamp(streamCenter(z)+side*(streamHalfWidth(z)+d),-DIORAMA_HALF_X+.8,DIORAMA_HALF_X-.8),z,radius:.55+random()*1.65,fertility:random()};});
 for(let i=0;i<44000;i++){
  const patch=patches[i%patches.length],angle=random()*Math.PI*2,radius=Math.sqrt(random())*patch.radius,z=clamp(patch.z+Math.sin(angle)*radius,STREAM_START+.5,STREAM_END-.5),x=clamp(patch.x+Math.cos(angle)*radius,-DIORAMA_HALF_X+.5,DIORAMA_HALF_X-.5);
  const bankDistance=Math.abs(x-streamCenter(z))-streamHalfWidth(z);
  if(z < -24 && random() < smooth((-z-24)/20)*.35)continue;
  if(bankDistance<.22||(bankDistance<1.35&&random()<.52))continue;
  if(Math.abs(x-scenePathCenter(z))<pathWidth(z)*.47)continue;
  const height=.09+random()*(.145+patch.fertility*.135);grass.push({x,z,y:groundHeight(x,z)+height/2,size:height/2,rx:(random()-.5)*.34,ry:random()*6.28,rz:(random()-.5)*.42,hue:.21+random()*.055});
 }
 for(let i=0;i<3600;i++){
  const z=mix(STREAM_START+.5,STREAM_END-.5,random()),side=random()<.5?-1:1,x=scenePathCenter(z)+side*(pathWidth(z)/2+(random()-.2)*.22),height=.055+random()*.115;
  grass.push({x,z,y:groundHeight(x,z)+height/2,size:height/2,rx:(random()-.5)*.5,ry:random()*6.28,rz:(random()-.5)*.5});
 }
 addMeadowBlades(b,grass,{groundColor:grassPigment});
 // Scattered spring clover & meadow wildflower clusters across both grassy banks.
 const wildPositions=[],wildIndices=[];
 for(let p=0;p<5;p++){
  const a=p*Math.PI*2/5,tip=[Math.cos(a)*.085,0,Math.sin(a)*.085],sd=.036;
  const l=[Math.cos(a)*.052-Math.sin(a)*sd,.004,Math.sin(a)*.052+Math.cos(a)*sd];
  const r2=[Math.cos(a)*.052+Math.sin(a)*sd,.004,Math.sin(a)*.052-Math.cos(a)*sd];
  const s0=wildPositions.length/3;wildPositions.push(0,.01,0,...l,...tip,...r2);wildIndices.push(s0,s0+1,s0+2,s0,s0+2,s0+3);
 }
 const wildGeo=b.own(new T.BufferGeometry());wildGeo.setAttribute('position',new T.Float32BufferAttribute(wildPositions,3));wildGeo.setIndex(wildIndices);wildGeo.computeVertexNormals();
 const wildMat=finish(b.mat('flower:sakura-meadow-clover','#ffffff',{side:T.DoubleSide}),.98,.04);
 const wildItems=[];
 for(let c=0;c<145;c++){
  const cz=mix(STREAM_START+4,STREAM_END-1.5,random()),side=random()<.5?-1:1,cd=1.8+random()*21.5;
  const cx=clamp(streamCenter(cz)+side*(streamHalfWidth(cz)+cd),-DIORAMA_HALF_X+1.4,DIORAMA_HALF_X-1.4);
  if(Math.abs(cx-scenePathCenter(cz))<pathWidth(cz)*.65)continue;
  const n=4+Math.floor(random()*5),col=new T.Color(random()<.52?'#f4f1e2':random()<.82?'#ebd688':'#f0d0db');
  for(let k=0;k<n;k++){
   const x=clamp(cx+(random()-.5)*1.4,-DIORAMA_HALF_X+.8,DIORAMA_HALF_X-.8),z=clamp(cz+(random()-.5)*1.4,STREAM_START+1,STREAM_END-1);
   if(Math.abs(x-scenePathCenter(z))<pathWidth(z)*.52)continue;
   const sc=.65+random()*.65;
   wildItems.push({position:[x,groundHeight(x,z)+.11+random()*.07,z],scale:[sc,sc,sc],rotation:[(random()-.5)*.25,random()*6.28,(random()-.5)*.25],color:col});
  }
 }
 instances('meadow-wildflowers',wildGeo,wildMat,wildItems);
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
 // Sculpted square diorama enclosure: stratified geological soil/bedrock cut
 // walls around all four edges, crystal-clear water cross-section caps at the
 // stream ends, and feathery alpha-cut pine/broadleaf woodland on the rear ridge.
 const baseY=-2.35;
 const cutEarth=finish(b.mat('base:sakura-cut-earth','#ffffff',{vertexColors:true}),.96,.08);
 const topsoil=new T.Color('#5b503e'),clay=new T.Color('#73624c'),bedrock=new T.Color('#474948');
 function cutWall(name,samples,flip=false){
  const pos=[],col=[],uv=[],idx=[];
  for(let i=0;i<samples.length;i++){
   const [x,topY,z]=samples[i],u=i/(samples.length-1);
   const levels=[[topY,topsoil],[mix(baseY,topY,.62),clay],[baseY,bedrock]];
   for(let r=0;r<levels.length;r++){
    pos.push(x,levels[r][0],z);col.push(levels[r][1].r,levels[r][1].g,levels[r][1].b);uv.push(u*10,r*.5);
   }
   if(i){
    for(let r=0;r<2;r++){
     const a=(i-1)*3+r,c=i*3+r;
     if(flip)idx.push(a,c,a+1,a+1,c,c+1);
     else idx.push(a,a+1,c,a+1,c+1,c);
    }
   }
  }
  const g=b.own(new T.BufferGeometry());
  g.setAttribute('position',new T.Float32BufferAttribute(pos,3));
  g.setAttribute('color',new T.Float32BufferAttribute(col,3));
  g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
  g.setIndex(idx);g.computeVertexNormals();
  return keep(b.mesh(g,cutEarth),name);
 }
 const sampleX=Array.from({length:72},(_,i)=>mix(-DIORAMA_HALF_X,DIORAMA_HALF_X,i/71));
 const sampleZ=Array.from({length:72},(_,i)=>mix(STREAM_START,STREAM_END,i/71));
 cutWall('plinth-south-wall',sampleX.map(x=>[x,terrainHeight(x,STREAM_END),STREAM_END]),false);
 cutWall('plinth-north-wall',sampleX.map(x=>[x,terrainHeight(x,STREAM_START),STREAM_START]),true);
 cutWall('plinth-west-wall',sampleZ.map(z=>[-DIORAMA_HALF_X,terrainHeight(-DIORAMA_HALF_X,z),z]),false);
 cutWall('plinth-east-wall',sampleZ.map(z=>[DIORAMA_HALF_X,terrainHeight(DIORAMA_HALF_X,z),z]),true);
 // Dark chamfered architectural plinth footing sealing the underside.
 const plinthWidth=DIORAMA_HALF_X*2,plinthDepth=STREAM_END-STREAM_START,plinthCenterZ=(STREAM_START+STREAM_END)/2;
 const footing=finish(b.mat('base:sakura-plinth-footing','#363837'),.92,.14);
 const trimCollar=finish(b.mat('base:sakura-plinth-trim','#4b473e'),.88,.16);
 keep(b.box([0,baseY-.12,plinthCenterZ],[plinthWidth+.22,.24,plinthDepth+.22],trimCollar),'plinth-trim');
 keep(b.box([0,baseY-.34,plinthCenterZ],[plinthWidth-.45,.26,plinthDepth-.45],footing),'plinth-footing');
 // Translucent turquoise water cross-section slices sealing both river cuts.
 const waterSliceMat=b.mat('water:diorama-cross-section','#58a4b2',{transparent:true,opacity:.56,roughness:.12,metalness:0,side:T.DoubleSide,depthWrite:false});
 for(const [label,zEdge] of [['south',STREAM_END],['north',STREAM_START]]){
  const cx=streamCenter(zEdge),hw=streamHalfWidth(zEdge),pos=[],idx=[];
  for(let i=0;i<=20;i++){
   const u=i/20,x=cx+(u*2-1)*hw,bed=Math.min(STREAM_LEVEL-.02,streamBedY(x,zEdge));
   pos.push(x,STREAM_LEVEL,zEdge,x,bed,zEdge);
   if(i){const a=(i-1)*2,c=i*2;idx.push(a,a+1,c,a+1,c+1,c);}
  }
  const g=b.own(new T.BufferGeometry());g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setIndex(idx);g.computeVertexNormals();
  const slice=keep(b.mesh(g,waterSliceMat),'water-cut-'+label);slice.castShadow=false;slice.receiveShadow=false;
 }
 addRidgePines(b,(x,z)=>terrainHeight(x,z),{minX:-DIORAMA_HALF_X+2,maxX:DIORAMA_HALF_X-2,minZ:STREAM_START+1.8,maxZ:-25.5});

 const water=addClearStream(b,renderer,{downstreamEnd:STREAM_END}),life=addSakuraLife(b,{groundHeight});
 water.mesh.removeFromParent();
 const eyeZ=15.5,eyeX=scenePathCenter(eyeZ),eyeY=groundHeight(eyeX,eyeZ)+1.65;
 const closeZ=7,closeX=streamCenter(closeZ)-streamHalfWidth(closeZ)-2.55,closeY=groundHeight(closeX,closeZ)+1.45;
 const api=b.finish({w:plinthWidth,d:plinthDepth,photo:{position:[closeX,closeY,closeZ],target:[.5,.65,-6],fov:55},companion:{position:[eyeX,eyeY,eyeZ],target:[.7,2,-9.5],fov:53},overview:[-.7,.68,1.05],background:'#a8c9d9'});
 api.root.add(water.mesh);
 api.sunAzimuthOffset=110;
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
 api.root.userData.sakuraStream={level:STREAM_LEVEL,bankRise:STREAM_BANK_RISE,start:STREAM_START,end:STREAM_END,dioramaHalfX:DIORAMA_HALF_X,riverbed:riverbed.name,banks:banks.map(mesh=>mesh.name),path:path.name,stones:submergedStones.count,bridgeZ,groundHeight};
 api.streamWater=water;api.sakuraLife=life;
 return api;
}
