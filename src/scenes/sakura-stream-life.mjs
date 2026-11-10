import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {randomSeed} from './diorama-kit.mjs';
import {STREAM_LEVEL,STREAM_START,STREAM_END,STREAM_HERO_TREES,streamCenter,streamHalfWidth} from './sakura-stream-layout.mjs';

const TAU=Math.PI*2,clamp=T.MathUtils.clamp,contactY=STREAM_LEVEL+.008;
const vector=value=>new T.Vector3(...value);
const insideWater=(x,z,margin=0)=>z>STREAM_START&&z<STREAM_END&&Math.abs(x-streamCenter(z))<streamHalfWidth(z)-margin;

// An airy notched petal, gently cupped along its midrib. Five copies share a
// rose-coloured throat, a small pollen centre, and fine cream stamen triangles.
function petalGeometry({flower=false,lowDetail=false}={}){
 const rows=lowDetail?2:3,positions=[],colors=[],indices=[],baseColor=new T.Color('#c97d9c'),edgeColor=new T.Color('#fff8f5');
 const vertex=(x,y,z,color)=>{positions.push(x,y,z);colors.push(color.r,color.g,color.b);return positions.length/3-1;};
 for(let p=0;p<(flower?5:1);p++){
  const angle=p*TAU/5,base=positions.length/3;
  if(!lowDetail){
   const shape=new T.Shape();shape.moveTo(0,.07);shape.bezierCurveTo(-.12,.09,-.39,.43,-.34,.73);shape.bezierCurveTo(-.32,.95,-.1,1.04,0,.94);shape.bezierCurveTo(.1,1.04,.32,.95,.34,.73);shape.bezierCurveTo(.39,.43,.12,.09,0,.07);
   const patch=new T.ShapeGeometry(shape,6),points=patch.attributes.position;
   for(let i=0;i<points.count;i++){const side=points.getX(i),radius=points.getY(i),u=clamp((radius-.07)/.93,0,1),vein=Math.pow(Math.max(0,Math.cos(side*29+u*2.8)),10)*.055*(1-u*.65),color=baseColor.clone().lerp(edgeColor,Math.pow(u,.38)).multiplyScalar(1-vein);vertex(Math.cos(angle)*radius-Math.sin(angle)*side,Math.sin(angle)*radius+Math.cos(angle)*side,.018+Math.sin(u*Math.PI)*.09+side*side*.27,color);}
   for(const i of patch.index.array)indices.push(base+i);patch.dispose();continue;
  }
  for(let row=0;row<=rows;row++)for(let side=-1;side<=1;side++){
   const u=row/rows,width=.34*Math.pow(Math.sin(u*Math.PI*.88),.8),s=side*width;
   const radius=.075+u*.9-(row===rows?.075*(1-Math.abs(side))+.035*side*side:0);
   const z=.025+Math.sin(u*Math.PI)*.075+side*side*.042*u;
   vertex(Math.cos(angle)*radius-Math.sin(angle)*s,Math.sin(angle)*radius+Math.cos(angle)*s,z,baseColor.clone().lerp(edgeColor,Math.pow(u,.34)));
  }
  for(let row=0;row<rows;row++)for(let col=0;col<2;col++){const i=base+row*3+col;indices.push(i,i+3,i+1,i+1,i+3,i+4);}
 }
 if(flower){
  const pollen=new T.Color('#bb9759'),middle=vertex(0,0,.045,pollen);
  const pollenSides=lowDetail?5:8;for(let i=0;i<pollenSides;i++){const a=i*TAU/pollenSides,b=(i+1)*TAU/pollenSides;indices.push(middle,vertex(Math.cos(a)*.072,Math.sin(a)*.072,.045,pollen),vertex(Math.cos(b)*.072,Math.sin(b)*.072,.045,pollen));}
  const stamen=new T.Color('#f4d79a'),calyx=new T.Color('#8c6862');
  for(let i=0;i<(lowDetail?0:12);i++){const a=i*TAU/12,r=.17+(i%3)*.017;indices.push(vertex(Math.cos(a)*.035,Math.sin(a)*.035,.05,stamen),vertex(Math.cos(a)*r-Math.sin(a)*.006,Math.sin(a)*r+Math.cos(a)*.006,.125,stamen),vertex(Math.cos(a)*r+Math.sin(a)*.006,Math.sin(a)*r-Math.cos(a)*.006,.125,stamen));}
  if(!lowDetail)for(let i=0;i<5;i++){const a=(i+.5)*TAU/5;indices.push(vertex(0,0,-.025,calyx),vertex(Math.cos(a-.24)*.19,Math.sin(a-.24)*.19,-.014,calyx),vertex(Math.cos(a+.24)*.19,Math.sin(a+.24)*.19,-.014,calyx));}
 }
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.setIndex(indices);g.computeVertexNormals();g.userData={petals:flower?5:1,notched:true,cupped:true,lowDetail};return g;
}

// Dense distant sprays use real alpha-cut five-petal silhouettes, leaving
// transparent gaps. The close blossoms remain cupped geometry; neither layer
// needs an opaque sphere or a filled crown core.
function blossomSprayTexture(){
 const size=256,data=new Uint8Array(size*size*4),random=randomSeed(90127),flowers=220;
 for(let flower=0;flower<flowers;flower++){
  const a=random()*TAU,r=Math.sqrt(random()),lobe=flower%4,clusterAngle=lobe*TAU/4+.27,cx=size*.5+Math.cos(clusterAngle)*34+Math.cos(a)*r*76,cy=size*.5+Math.sin(clusterAngle)*35+Math.sin(a)*r*80,radius=3.8+random()*2.5,turn=random()*TAU;
  for(let y=Math.floor(cy-radius-1);y<=Math.ceil(cy+radius+1);y++)for(let x=Math.floor(cx-radius-1);x<=Math.ceil(cx+radius+1);x++){
   if(x<0||y<0||x>=size||y>=size)continue;
   const dx=x+.5-cx,dy=y+.5-cy,angle=Math.atan2(dy,dx)-turn,distance=Math.hypot(dx,dy),lobe=Math.cos(angle*5),boundary=radius*(.78+.22*lobe-.055*Math.exp(-((Math.sin(angle*5)/.16)**2))*Math.max(0,lobe));
   const alpha=clamp(boundary-distance+.6,0,1);if(!alpha)continue;const t=clamp(distance/radius,0,1),i=(y*size+x)*4;
   if(alpha*255<data[i+3])continue;
   const centre=1-clamp(distance/(radius*.23),0,1);data[i]=Math.round(255-centre*55);data[i+1]=Math.round(143+100*Math.pow(t,.36)-centre*18);data[i+2]=Math.round(174+70*Math.pow(t,.34)-centre*33);data[i+3]=Math.round(alpha*255);
  }
 }
 const texture=new T.DataTexture(data,size,size);texture.name='sakura:transparent-individual-five-petal-sprays';texture.colorSpace=T.SRGBColorSpace;texture.magFilter=T.LinearFilter;texture.minFilter=T.LinearMipmapLinearFilter;texture.generateMipmaps=true;texture.needsUpdate=true;texture.userData={flowers,petals:5,transparentGaps:true};return texture;
}

// Branch-local metres keep the cherry bark's horizontal lenticels following a
// curved limb. These authored maps provide fine relief without extra shells.
function cherryBarkTextures(){
 const width=256,height=512,colour=new Uint8Array(width*height*4),bump=new Uint8Array(width*height*4),roughness=new Uint8Array(width*height*4),random=randomSeed(118051);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const u=x/width*TAU,v=y/height*TAU,grain=Math.sin(u*17+Math.sin(v*3)*.9)*.45+Math.sin(u*43+Math.sin(v*7)*.6)*.17,flake=Math.sin(u*5+Math.sin(v*4)*1.8)*Math.sin(v*11+u)*.45,k=(y*width+x)*4,variation=grain*5+flake*10;
  colour[k]=clamp(128+variation,0,255);colour[k+1]=clamp(110+variation*.86,0,255);colour[k+2]=clamp(102+variation*.8,0,255);colour[k+3]=255;
  const relief=clamp(128+grain*19+flake*13,0,255),rough=clamp(227-grain*9+flake*8,0,255);for(let channel=0;channel<3;channel++){bump[k+channel]=relief;roughness[k+channel]=rough;}bump[k+3]=roughness[k+3]=255;
 }
 for(let scar=0;scar<155;scar++){
  const cx=random()*width,cy=random()*height,rx=4+random()*20,ry=.6+random()*1.7;
  for(let dy=-Math.ceil(ry+1);dy<=Math.ceil(ry+1);dy++)for(let dx=-Math.ceil(rx+1);dx<=Math.ceil(rx+1);dx++){
   const d=Math.hypot(dx/rx,dy/ry);if(d>1.25)continue;const x=(Math.round(cx)+dx+width)%width,y=(Math.round(cy)+dy+height)%height,k=(y*width+x)*4,rim=clamp((d-.55)*2.1,0,1),alpha=clamp((1.25-d)*3.5,0,1);
   const target=[73+rim*78,60+rim*74,56+rim*68];for(let channel=0;channel<3;channel++){colour[k+channel]=Math.round(colour[k+channel]*(1-alpha)+target[channel]*alpha);bump[k+channel]=Math.round(bump[k+channel]*(1-alpha)+(94+rim*61)*alpha);roughness[k+channel]=Math.round(roughness[k+channel]*(1-alpha)+(208+rim*28)*alpha);}
  }
 }
 return [colour,bump,roughness].map((data,i)=>{const texture=new T.DataTexture(data,width,height);texture.name='sakura:cherry-bark-'+['albedo','relief','roughness'][i];if(i===0)texture.colorSpace=T.SRGBColorSpace;texture.wrapS=texture.wrapT=T.RepeatWrapping;texture.minFilter=T.LinearMipmapLinearFilter;texture.magFilter=T.LinearFilter;texture.generateMipmaps=true;texture.needsUpdate=true;return texture;});
}

function taperedBranch(points,startRadius,endRadius,segments=12){
 const curve=new T.CatmullRomCurve3(points.map(p=>p.isVector3?p:vector(p)),false,'catmullrom',.35),frames=curve.computeFrenetFrames(segments,false);
 const positions=[],colors=[],uvs=[],indices=[],dark=new T.Color('#b8aaa0'),light=new T.Color('#f0e6db'),radial=startRadius>.1?14:8,length=curve.getLength();
 for(let j=0;j<=segments;j++){
  const u=j/segments,center=curve.getPointAt(u),radius=(endRadius+(startRadius-endRadius)*Math.pow(1-u,.8))*(startRadius>.1?1+.38*Math.exp(-u*21):1);
  for(let k=0;k<=radial;k++){
   const a=k*TAU/radial,r=radius*(1+.055*Math.sin(a*3+u*7)),p=center.clone().addScaledVector(frames.normals[j],Math.cos(a)*r).addScaledVector(frames.binormals[j],Math.sin(a)*r);
   positions.push(p.x,p.y,p.z);const c=dark.clone().lerp(light,.45+.19*Math.sin(a*2.1+u*10));colors.push(c.r,c.g,c.b);uvs.push(k/radial*TAU*radius/.52,u*length/.92);
   if(j<segments&&k<radial){const n=j*(radial+1)+k;indices.push(n,n+1,n+radial+1,n+1,n+radial+2,n+radial+1);}
  }
 }
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));geometry.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();return {geometry,curve};
}

export function addSakuraLife(b,{groundHeight=()=>.62}={}){
 const rng=randomSeed(731904),root=new T.Group();root.name='sakura:stream-life';b.root.add(root);
 const geometries=new Set(),materials=new Set(),textures=new Set(),instances=new Set(),boughs=[],emitters=[],trees=[],cardRandom=randomSeed(55017);
 const own=g=>(geometries.add(g),g),material=(name,options)=>{const m=new T.MeshStandardMaterial(options);m.name=name;m.userData.weatherExposure=false;materials.add(m);return m;};
 const barkMaps=cherryBarkTextures();barkMaps.forEach(texture=>textures.add(texture));
 const bark=material('bark:sakura-weathered',{color:'#ffffff',map:barkMaps[0],bumpMap:barkMaps[1],bumpScale:.003,roughnessMap:barkMaps[2],vertexColors:true,roughness:.98,metalness:0});bark.userData.surfaceFinish={roughness:.94,metalness:0,envMapIntensity:.12};
 const bloom=material('paper:sakura-delicate-five-petal',{color:'#ffffff',vertexColors:true,side:T.DoubleSide,roughness:.94,metalness:0});
 const loose=material('paper:sakura-water-and-falling-petal',{color:'#fff4f4',vertexColors:true,side:T.DoubleSide,roughness:.9,metalness:0});
 const flowerGeometry=own(petalGeometry({flower:true})),farFlowerGeometry=own(petalGeometry({flower:true,lowDetail:true})),singleGeometry=own(petalGeometry());
 const sprayTexture=blossomSprayTexture();textures.add(sprayTexture);const sprayMaterial=material('paper:sakura-transparent-blossom-sprays',{color:'#ffffff',map:sprayTexture,alphaTest:.3,alphaToCoverage:true,side:T.DoubleSide,roughness:.95,metalness:0}),sprayGeometry=own(new T.PlaneGeometry(1,1));let sprayCount=0;
 const mesh=(g,m,parent,name)=>{const o=new T.Mesh(g,m);o.name=name;o.userData.keep=true;o.castShadow=true;o.receiveShadow=true;parent.add(o);return o;};
 const scratch=new T.Object3D(),tone=new T.Color();let blossomCount=0;

 function tree(spec,index,weeping){
  const treeRoot=new T.Group();treeRoot.name=`sakura:tree-${index}`;treeRoot.position.set(spec.x,groundHeight(spec.x,spec.z)-.1,spec.z);root.add(treeRoot);
  const h=spec.height,spread=spec.spread,lean=index%2?-1:1,trunk=taperedBranch([[0,0,0],[-.16*lean,h*.12,.11],[-.07*lean,h*.3,.17],[.3*lean,h*.48,-.07],[.5*lean,h*.63,.1],[.2*lean,h*.75,.18]],h*.027,.038,23);
  mesh(own(trunk.geometry),bark,treeRoot,`sakura:tree-${index}:trunk`);
  const roots=[];
  for(let i=0;i<6;i++){
   const angle=i*2.39996+index*.63,reach=.43+rng()*.43,tip=new T.Vector3(Math.cos(angle)*reach,groundHeight(spec.x+Math.cos(angle)*reach,spec.z+Math.sin(angle)*reach)-treeRoot.position.y-.075,Math.sin(angle)*reach),origin=new T.Vector3(-.02,.095,.03);
   roots.push(taperedBranch([origin,origin.clone().lerp(tip,.48),tip],h*.0075,.007,7).geometry);
  }
  const rootWood=mergeGeometries(roots,false);roots.forEach(g=>g.dispose());mesh(own(rootWood),bark,treeRoot,`sakura:tree-${index}:root-flare`);
  const count=weeping?9:7;
  for(let branch=0;branch<count;branch++){
   const towardsWater=spec.x<streamCenter(spec.z)?0:Math.PI;
   const angle=branch===0?towardsWater+.04:branch*2.39996+index*.7;
   const reach=spread*(branch===0?1.19:.62+rng()*.4),start=trunk.curve.getPointAt(.36+branch/(count-1)*.43);
   const end=new T.Vector3(Math.cos(angle)*reach,h*(.65+rng()*.16),Math.sin(angle)*reach);
   const branchPoints=[new T.Vector3(),new T.Vector3(Math.cos(angle)*reach*.25,h*.65-start.y,Math.sin(angle)*reach*.32),new T.Vector3(Math.cos(angle)*reach*.72,h*.82-start.y,Math.sin(angle)*reach*.75),end.clone().sub(start)];
   const arm=taperedBranch(branchPoints,(.077+rng()*.023)*(h/8),.01,18),group=new T.Group();group.name=`sakura:tree-${index}:bough-${branch}`;group.position.copy(start);treeRoot.add(group);
   const woody=[arm.geometry],flowers=[],sprays=[],phase=rng()*TAU,twigCount=weeping?14:10;
   const spray=(point,width,height)=>{sprays.push({point,width,height,rotation:[(cardRandom()-.5)*.7,cardRandom()*TAU,(cardRandom()-.5)*.55]});};
   const flowerCluster=(stem,n,radius=.07)=>{for(let f=0;f<n;f++){const a=f*2.399+rng()*.9,offset=.016+rng()*radius,p=stem.clone().add(new T.Vector3(Math.cos(a)*offset,(rng()-.5)*radius,Math.sin(a)*offset));flowers.push({p,size:(weeping?.026:.024)+rng()*.014,rotation:[(rng()-.5)*2.4,rng()*TAU,rng()*TAU]});}};
   for(let cluster=0;cluster<22;cluster++)flowerCluster(arm.curve.getPointAt(.18+cluster/22*.82),weeping?6:5,.095);
   for(let cluster=0;cluster<10;cluster++)spray(arm.curve.getPointAt(.15+(cluster+cardRandom()*.7)*.08),.48+cardRandom()*.24,.35+cardRandom()*.24);
   for(let twig=0;twig<twigCount;twig++){
    const u=.23+(twig+.35)/twigCount*.75,base=arm.curve.getPointAt(u),hang=weeping?h*(.22+rng()*.32):h*(.1+rng()*.16),out=.25+rng()*.9,strandAngle=angle+(rng()-.5)*1.4;
    const tip=base.clone().add(new T.Vector3(Math.cos(strandAngle)*out,-hang,Math.sin(strandAngle)*out)),tipX=spec.x+start.x+tip.x,tipZ=spec.z+start.z+tip.z,clearance=(insideWater(tipX,tipZ)?STREAM_LEVEL:groundHeight(tipX,tipZ))+.45;
    tip.y=Math.max(clearance-treeRoot.position.y-start.y,tip.y);
    const side=new T.Vector3(-Math.sin(strandAngle),0,Math.cos(strandAngle)),bow=.1+rng()*.3;
    const strand=taperedBranch([base,base.clone().add(new T.Vector3(Math.cos(strandAngle)*.35,.12,Math.sin(strandAngle)*.35)),base.clone().lerp(tip,.43).addScaledVector(side,bow),base.clone().lerp(tip,.76).addScaledVector(side,-bow*.35),tip],.011+rng()*.003,.0022,12);woody.push(strand.geometry);
    const gap=.24+rng()*.42,sprayBands=weeping?6+Math.floor(rng()*3):4;
    for(let cluster=0;cluster<sprayBands;cluster++){
     const t=.08+(cluster+.25+cardRandom()*.55)/sprayBands*.86;if(Math.abs(t-gap)<.07)continue;const taper=.68+.32*Math.sin(t*Math.PI);
     const fullness=t<.6?1.15:1;spray(strand.curve.getPointAt(t),(.32+cardRandom()*.24)*taper*fullness,(.44+cardRandom()*.32)*taper*fullness);
    }
    const clusters=weeping?23:17;
    for(let cluster=0;cluster<clusters;cluster++){
     const t=.06+(cluster+.15+rng()*.7)/clusters*.91,stem=strand.curve.getPointAt(t);if(Math.abs(t-gap)<.06&&rng()>.28)continue;flowerCluster(stem,3+Math.floor(rng()*3),.055+rng()*.033);
     if(cluster%5===1)emitters.push({group,point:stem.clone(),tree:index});
    }
    // Small lateral forks break the parallel-string silhouette; flowers remain
    // supported by real fine wood instead of filling an opaque crown volume.
    for(let spur=0;spur<(weeping?3:2);spur++){
     const origin=strand.curve.getPointAt(.28+spur*.22),a=strandAngle+(spur%2?1:-1)*(1+rng()*.6),reach=.24+rng()*.4,finish=origin.clone().add(new T.Vector3(Math.cos(a)*reach,-.3-rng()*.3,Math.sin(a)*reach));
     const side=taperedBranch([origin,origin.clone().lerp(finish,.45).add(new T.Vector3(0,.07,0)),finish],.0045,.0012,5);woody.push(side.geometry);
     for(let bloom=0;bloom<5;bloom++)flowerCluster(side.curve.getPointAt(.15+bloom*.17),3,.052);
    }
   }
   const wood=mergeGeometries(woody,false);for(const g of woody)g.dispose();mesh(own(wood),bark,group,`sakura:tree-${index}:wood-${branch}`);
   const flowersMesh=new T.InstancedMesh(index===0?flowerGeometry:farFlowerGeometry,bloom,flowers.length);flowersMesh.name=`sakura:tree-${index}:flowers-${branch}`;flowersMesh.castShadow=true;flowersMesh.receiveShadow=true;flowersMesh.userData.windOwner=group.name;
   flowers.forEach((flower,i)=>{scratch.position.copy(flower.p);scratch.rotation.set(...flower.rotation);scratch.scale.setScalar(flower.size);scratch.updateMatrix();flowersMesh.setMatrixAt(i,scratch.matrix);tone.set(weeping?'#fff1f1':'#fffdf5').lerp(new T.Color('#eeb5cb'),rng()*(weeping?.32:.06));flowersMesh.setColorAt(i,tone);});
   flowersMesh.computeBoundingSphere();group.add(flowersMesh);instances.add(flowersMesh);blossomCount+=flowers.length;
   const sprayMesh=new T.InstancedMesh(sprayGeometry,sprayMaterial,sprays.length);sprayMesh.name=`sakura:tree-${index}:flower-sprays-${branch}`;sprayMesh.userData.windOwner=group.name;sprayMesh.castShadow=true;sprayMesh.receiveShadow=true;
   sprays.forEach((entry,i)=>{scratch.position.copy(entry.point);scratch.rotation.set(...entry.rotation);scratch.scale.set(entry.width,entry.height,1);scratch.updateMatrix();sprayMesh.setMatrixAt(i,scratch.matrix);tone.set(weeping?'#fff1f3':'#fffdfa');sprayMesh.setColorAt(i,tone);});sprayMesh.computeBoundingSphere();group.add(sprayMesh);instances.add(sprayMesh);sprayCount+=sprays.length;
   boughs.push({group,phase,amplitude:(weeping?.013:.009)*(1+branch/count)});
  }
  trees.push({index,x:spec.x,z:spec.z,height:h,spread,weeping,rootY:treeRoot.position.y,boughs:count});
 }
 STREAM_HERO_TREES.forEach((spec,i)=>tree(spec,i,true));
 for(const [i,z]of [-9,-23].entries())tree({x:streamCenter(z)+streamHalfWidth(z)+2.25,z,height:6.3-i*.5,spread:3.9-i*.3},STREAM_HERO_TREES.length+i,false);

 const metadata={version:1,trees,blossomCount,sprayCount,sprayFlowers:sprayTexture.userData.flowers,fivePetals:true,opaqueCrownCores:false,emitterCount:emitters.length,falling:0,floating:0,landed:0,contacts:0,waterContacts:0,landContacts:0,releases:0,waterContactY:contactY,phase:0,motionEnabled:true,wind:.45,petals:[]};
 root.updateWorldMatrix(true,true);const inverseRoot=new T.Matrix4().copy(root.matrixWorld).invert();
 const emitterPosition=emitter=>emitter.point.clone().applyMatrix4(emitter.group.matrixWorld).applyMatrix4(inverseRoot);
 const waterEmitters=emitters.filter(emitter=>{const p=emitterPosition(emitter);return insideWater(p.x,p.z,.12);});
 metadata.waterEmitterCount=waterEmitters.length;
 const count=204,states=[],petalsMesh=new T.InstancedMesh(singleGeometry,loose,count);petalsMesh.name='sakura:falling-and-stream-floating-petals';petalsMesh.instanceMatrix.setUsage(T.DynamicDrawUsage);petalsMesh.frustumCulled=false;petalsMesh.renderOrder=2;root.add(petalsMesh);instances.add(petalsMesh);
 let enabled=true,disposed=false,lastHost=null,simTime=0,wind=.45,targetWind=.45,emissionCredit=0;
 const flat=new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,0),-Math.PI/2),yawAxis=new T.Vector3(0,1,0),petalNormal=new T.Vector3(0,0,1),yaw=new T.Quaternion();
 const landNormal=(x,z)=>new T.Vector3(-(groundHeight(x+.03,z)-groundHeight(x-.03,z))/.06,1,-(groundHeight(x,z+.03)-groundHeight(x,z-.03))/.06).normalize();
 const contactPoint=new T.Vector3();
 function seatLandedPetal(state){
  state.position.y=groundHeight(state.position.x,state.position.z)+.008;state.normal.copy(landNormal(state.position.x,state.position.z));
  yaw.setFromAxisAngle(state.normal,state.turn);scratch.position.copy(state.position);scratch.scale.setScalar(state.size);scratch.quaternion.setFromUnitVectors(petalNormal,state.normal).premultiply(yaw);scratch.updateMatrix();
  // A tangent plane can cross the raised path's edge. Seat the actual curved
  // petal against every sampled vertex, rather than burying its outer lobe.
  let lift=0;for(let i=0;i<singleGeometry.attributes.position.count;i++){contactPoint.fromBufferAttribute(singleGeometry.attributes.position,i).applyMatrix4(scratch.matrix);lift=Math.max(lift,groundHeight(contactPoint.x,contactPoint.z)+.002-contactPoint.y);}state.position.y+=lift;
 }
 function spawn(state,initial=false){
  const preferWater=state.id%4!==0&&waterEmitters.length>0,list=preferWater?waterEmitters:emitters,emitter=list[Math.floor(rng()*list.length)];
  state.position.copy(emitterPosition(emitter));state.kind='falling';state.age=0;state.fade=1;state.recycle=false;if(!initial)metadata.releases++;state.velocity.set((rng()-.5)*.04,-.25-rng()*.16,(rng()-.5)*.025);state.water=insideWater(state.position.x,state.position.z);state.emitterTree=emitter.tree;
 }
 for(let id=0;id<count;id++){
  const state={id,kind:'falling',position:new T.Vector3(),velocity:new T.Vector3(),age:0,seed:rng()*TAU,size:.027+rng()*.025,turn:rng()*TAU,lateral:0,normal:new T.Vector3(0,1,0),fade:1,recycle:false};spawn(state,true);
  if(id%3===0){state.kind='floating';state.age=15+rng()*70;state.position.z=STREAM_START+5+rng()*(STREAM_END-STREAM_START-12);state.lateral=(rng()-.5)*1.75;state.position.set(streamCenter(state.position.z)+state.lateral*streamHalfWidth(state.position.z),contactY,state.position.z);}
  else if(id%7===0){state.kind='landed';state.age=20+rng()*60;state.position.x=streamCenter(state.position.z)-streamHalfWidth(state.position.z)-.4-rng()*3.2;seatLandedPetal(state);}
  else state.position.y=Math.max((state.water?contactY:groundHeight(state.position.x,state.position.z)+.008)+.15,state.position.y-rng()*2.7);
  states.push(state);metadata.petals.push({id,kind:state.kind,x:0,y:0,z:0,contactY:0});
 }
 function drawPetals(){
  metadata.falling=metadata.floating=metadata.landed=0;
  for(const state of states){
   scratch.position.copy(state.position);scratch.scale.setScalar(state.size*state.fade);
   if(state.kind==='falling')scratch.rotation.set(state.turn+simTime*.8+Math.sin(simTime*.75+state.seed)*.5,state.seed+simTime*.4,Math.sin(simTime*.9+state.seed)*1.2);
   else if(state.kind==='floating'){yaw.setFromAxisAngle(yawAxis,state.turn+simTime*.055);scratch.quaternion.copy(yaw).multiply(flat);}
   else{yaw.setFromAxisAngle(state.normal,state.turn);scratch.quaternion.setFromUnitVectors(petalNormal,state.normal).premultiply(yaw);}
   scratch.updateMatrix();petalsMesh.setMatrixAt(state.id,scratch.matrix);metadata[state.kind]++;
   Object.assign(metadata.petals[state.id],{kind:state.kind,x:state.position.x,y:state.position.y,z:state.position.z,contactY:state.kind==='floating'?contactY:state.kind==='landed'?groundHeight(state.position.x,state.position.z)+.008:null});
  }
  petalsMesh.instanceMatrix.needsUpdate=true;metadata.phase=simTime;metadata.wind=wind;
 }
 drawPetals();
 function update(time){
  if(disposed||!Number.isFinite(time))return;if(lastHost===null){lastHost=time;return;}
  const dt=Math.max(0,Math.min(.08,time-lastHost));lastHost=time;if(!enabled||!dt)return;
  simTime+=dt;wind+=(targetWind-wind)*(1-Math.exp(-dt/1.7));
  for(const bough of boughs){const wave=Math.sin(simTime*.72+bough.phase)-Math.sin(bough.phase);bough.group.rotation.z=wave*bough.amplitude*wind;bough.group.rotation.y=(Math.sin(simTime*.48+bough.phase*.7)-Math.sin(bough.phase*.7))*bough.amplitude*.5*wind;}
  root.updateWorldMatrix(true,true);inverseRoot.copy(root.matrixWorld).invert();
  // The host parks shadow maps between frames. Moving wood and attached
  // blossoms must invalidate their actual shadows with the same pose.
  if(b.renderer?.shadowMap)b.renderer.shadowMap.needsUpdate=true;
  for(const state of states){
   state.age+=dt;if(state.recycle){state.fade=Math.max(0,state.fade-dt*1.5);if(!state.fade)spawn(state);}
   if(state.kind==='falling'){
    state.velocity.y=Math.max(-.58,state.velocity.y-.035*dt);state.position.y+=state.velocity.y*dt;
    state.position.x+=(state.velocity.x+Math.sin(simTime*1.4+state.seed)*.025+wind*.025)*dt;state.position.z+=(state.velocity.z+Math.cos(simTime*.8+state.seed)*.025)*dt;
    const water=insideWater(state.position.x,state.position.z),surface=water?contactY:groundHeight(state.position.x,state.position.z)+.008;
    if(state.position.y<=surface){state.position.y=surface;state.kind=water?'floating':'landed';state.lateral=clamp((state.position.x-streamCenter(state.position.z))/streamHalfWidth(state.position.z),-.95,.95);if(water)state.position.x=streamCenter(state.position.z)+state.lateral*streamHalfWidth(state.position.z);else seatLandedPetal(state);state.age=0;metadata.contacts++;if(water)metadata.waterContacts++;else metadata.landContacts++;}
   }else if(state.kind==='floating'){
    state.position.z+=(.17+wind*.09+.035*Math.sin(simTime*.45+state.seed))*dt;
    state.position.x=streamCenter(state.position.z)+clamp(state.lateral+Math.sin(simTime*.5+state.seed)*.012,-.93,.93)*streamHalfWidth(state.position.z);state.position.y=contactY;
    if(state.position.z>STREAM_END-.8)spawn(state);
   }else if(state.age>95)state.recycle=true;
  }
  emissionCredit+=dt*(4.2+wind*1.2);
  while(emissionCredit>=1){const candidate=states.filter(state=>state.kind!=='falling'&&!state.recycle&&state.age>18).sort((a,b)=>b.age-a.age)[0];if(!candidate){emissionCredit=Math.min(1,emissionCredit);break;}candidate.recycle=true;emissionCredit--; }
  drawPetals();
 }
 return {update,setMotion({enabled:value}={}){const next=value!==false;if(next!==enabled){enabled=next;lastHost=null;}metadata.motionEnabled=enabled;},setWind(value){targetWind=Number.isFinite(value)?clamp(value,0,1.5):.45;},metadata,
  dispose(){if(disposed)return;disposed=true;root.removeFromParent();for(const instance of instances)instance.dispose();for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const texture of textures)texture.dispose();},
 };
}
