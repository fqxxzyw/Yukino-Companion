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
 const size=256,data=new Uint8Array(size*size*4),random=randomSeed(90127),flowers=156;
 for(let flower=0;flower<flowers;flower++){
  const a=random()*TAU,r=Math.sqrt(random()),lobe=flower%4,clusterAngle=lobe*TAU/4+.27,cx=size*.5+Math.cos(clusterAngle)*34+Math.cos(a)*r*72,cy=size*.5+Math.sin(clusterAngle)*35+Math.sin(a)*r*73,radius=6.8+random()*4.4,turn=random()*TAU;
  for(let y=Math.floor(cy-radius-1);y<=Math.ceil(cy+radius+1);y++)for(let x=Math.floor(cx-radius-1);x<=Math.ceil(cx+radius+1);x++){
   if(x<0||y<0||x>=size||y>=size)continue;
   const dx=x+.5-cx,dy=y+.5-cy,angle=Math.atan2(dy,dx)-turn,distance=Math.hypot(dx,dy),lobe=Math.cos(angle*5),boundary=radius*(.78+.22*lobe-.055*Math.exp(-((Math.sin(angle*5)/.16)**2))*Math.max(0,lobe));
   const alpha=clamp(boundary-distance+.6,0,1);if(!alpha)continue;const t=clamp(distance/radius,0,1),i=(y*size+x)*4;
   if(alpha*255<data[i+3])continue;
   const centre=1-clamp(distance/(radius*.23),0,1);data[i]=Math.round(255-centre*55);data[i+1]=Math.round(179+68*Math.pow(t,.36)-centre*32);data[i+2]=Math.round(193+55*Math.pow(t,.34)-centre*34);data[i+3]=Math.round(alpha*255);
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
  colour[k]=clamp(148+variation,0,255);colour[k+1]=clamp(132+variation*.86,0,255);colour[k+2]=clamp(123+variation*.8,0,255);colour[k+3]=255;
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
 const sprayTexture=blossomSprayTexture();textures.add(sprayTexture);const sprayMaterial=material('paper:sakura-transparent-blossom-sprays',{color:'#ffffff',map:sprayTexture,alphaTest:.3,alphaToCoverage:true,side:T.DoubleSide,roughness:.95,metalness:0}),sprayGeometry=own(new T.PlaneGeometry(1,1,3,3));let sprayCount=0;
 const sprayPoints=sprayGeometry.attributes.position;
 for(let i=0;i<sprayPoints.count;i++){
  const x=sprayPoints.getX(i),y=sprayPoints.getY(i);
  sprayPoints.setZ(i,.17*(1-2.6*(x*x+y*y))+.05*Math.sin(6*x+3*y));
 }
 sprayGeometry.computeVertexNormals();
 for(const material of [bloom,sprayMaterial,loose]){
  material.onBeforeCompile=shader=>{
   shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_end>',`#include <lights_fragment_end>
    #if NUM_DIR_LIGHTS > 0
     // A paper-thin petal transmits warm sunlight when viewed against the sky.
     float petalBack=smoothstep(-.28,.79,dot(-normal,directionalLights[0].direction));
     reflectedLight.indirectDiffuse+=diffuseColor.rgb*directionalLights[0].color*(.055+.19*petalBack);
    #endif
   `);
  };
  material.customProgramCacheKey=()=> 'edo-higan-petal-transmission-v1';
 }
 const mesh=(g,m,parent,name)=>{const o=new T.Mesh(g,m);o.name=name;o.userData.keep=true;o.castShadow=true;o.receiveShadow=true;parent.add(o);return o;};
 const scratch=new T.Object3D(),tone=new T.Color();let blossomCount=0;

 function tree(spec,index) {
  const hero = index === 0;
  const treeRoot = new T.Group();
  treeRoot.name = `sakura:tree-${index}`;
  treeRoot.position.set(spec.x, groundHeight(spec.x,spec.z)-.1, spec.z);
  root.add(treeRoot);
  const h=spec.height, spread=spec.spread, lean=hero?1:Math.sin(index*2.41);
  const trunk=taperedBranch([[0,0,0],[-.28*lean,h*.12,.12],[-.56*lean,h*.24,-.13],
   [lean*.24,h*.37,-.25],[lean*.63,h*.54,.04],[lean*.28,h*.72,.24]], h*(hero?.073:.033),hero?.085:.025,24);
  mesh(own(trunk.geometry),bark,treeRoot,`sakura:tree-${index}:trunk`);
  const roots=[];
  for(let i=0;i<(hero?8:5);i++){
   const angle=i*2.39996+index*.63, reach=(hero?1.2:.42)*(.67+rng()*.64);
   const x=Math.cos(angle)*reach,z=Math.sin(angle)*reach;
   const tip=new T.Vector3(x,groundHeight(spec.x+x,spec.z+z)-treeRoot.position.y-.09,z);
   roots.push(taperedBranch([[0,hero?.30:.14,0], [x*.45,.07,z*.48],tip], h*(hero?.029:.012),.011,7).geometry);
  }
  const foot=mergeGeometries(roots,false);roots.forEach(g=>g.dispose());
  mesh(own(foot),bark,treeRoot,`sakura:tree-${index}:root-flare`);

  // The old Edo-higan opens around a heavy low lateral and a taller,
  // forked scaffold. Each tuple defines azimuth, reach, fork and tip height.
  const arms=hero?[[.06,1.12,.27,.43],[-.53,.87,.41,.61],[.64,.73,.53,.70],
   [-1.28,.59,.57,.84],[1.54,.44,.56,.68],[2.55,.39,.45,.63],[-2.47,.53,.62,.91],[-.27,.43,.73,.94]]
   :Array.from({length:3+index%3},(_,j)=>[j*2.40+index*1.7,.55+rng()*.45,.30+j*.085,.64+rng()*.20]);
  for(const [branch,[angle,reachScale,fork,top]] of arms.entries()){
   const reach=spread*reachScale,start=trunk.curve.getPointAt(fork);
   const dx=Math.cos(angle),dz=Math.sin(angle),side=new T.Vector3(-dz,0,dx);
   const armPoint=(t,y,offset)=>new T.Vector3(dx*reach*t, h*y-start.y, dz*reach*t).addScaledVector(side,offset);
   const low=hero&&branch===0;
   const arm=taperedBranch([new T.Vector3(),armPoint(.22,low?.30:top*.73,.12),
    armPoint(.52,low?.30:top*.83,-.24),armPoint(.79,low?.35:top*.96,.10),
    armPoint(1,top,-.17)], h*(low?.046:hero?.026:.014)*(1-.26*fork),.018,18);
   const group=new T.Group();
   group.name=`sakura:tree-${index}:bough-${branch}`;group.position.copy(start);treeRoot.add(group);
   if(low){
    // Authentic Garyu-zakura weathered timber crutch props (支柱) cradling
    // the massive low horizontal limb along the grassy bank beside the stream.
    const propMat=material('wood:garyu-crutch-prop',{color:'#796856',roughness:.94,metalness:0});
    propMat.userData.surfaceFinish={roughness:.94,metalness:0,envMapIntensity:.12};
    const propParts=[];
    for(const u of [.33]){
     const cradle=arm.curve.getPointAt(u).clone().add(start);
     const wx=spec.x+cradle.x,wz=spec.z+cradle.z;
     if(!insideWater(wx,wz,.45)){
      const footY=groundHeight(wx,wz)-treeRoot.position.y-.10;
      const topY=cradle.y-.04;
      for(const s of [-1,1]){
       const leg=taperedBranch([
        new T.Vector3(cradle.x,footY,cradle.z+s*.34),
        new T.Vector3(cradle.x,topY+.08,cradle.z+s*.06)
       ],.050,.040,4);
       propParts.push(leg.geometry);
      }
      const tie=taperedBranch([
       new T.Vector3(cradle.x,topY-.18,cradle.z-.24),
       new T.Vector3(cradle.x,topY-.18,cradle.z+.24)
      ],.034,.034,3);
      propParts.push(tie.geometry);
     }
    }
    if(propParts.length){
     const mergedProps=mergeGeometries(propParts,false);
     propParts.forEach(g=>g.dispose());
     mesh(own(mergedProps),propMat,treeRoot,`sakura:tree-${index}:crutch-props`);
    }
   }
   const woody=[arm.geometry],flowers=[],sprays=[];
   const twigCount=hero?(low?12:8):4+index%3;
   for(let twig=0;twig<twigCount;twig++){
    const u=.25+(twig+.4)/twigCount*.73,base=arm.curve.getPointAt(u);
    const direction=angle+(twig%2?1:-1)*(.46+rng()*.86);
    const length=h*(hero?.21:.15)*(.56+rng()*.77);
    const delta=new T.Vector3(Math.cos(direction)*length,h*(.10+rng()*.11),Math.sin(direction)*length);
    const end=base.clone().add(delta);
    const forkBranch=taperedBranch([base,base.clone().addScaledVector(delta,.42).addScaledVector(side,.14),
      end.clone().addScaledVector(side,-.08)],hero?.043:.023,.005,8);
    woody.push(forkBranch.geometry);
    for(let spur=0;spur<(hero?5:3);spur++){
     const foot=forkBranch.curve.getPointAt(.19+.77*(spur+.25)/(hero?5:3));
     const a=direction+(spur%2?1:-1)*(.60+rng()*.68);
     const r=h*(.085+rng()*.08),tip=foot.clone().add(new T.Vector3(Math.cos(a)*r,h*(.045+rng()*.09),Math.sin(a)*r));
     const mid=foot.clone().lerp(tip,.55);mid.y-=.06;
     const spurWood=taperedBranch([foot,mid,tip],hero?.019:.013,.0025,5);woody.push(spurWood.geometry);
     // Each flower fan has a volumetric centre just inside its outer blossoms.
     // The cards bend around this centre; light follows the fan, not its cards.
     const centre=spurWood.curve.getPointAt(.59);
     centre.y-=.13;
     for(let k=0;k<(hero?4:3);k++){
      const n=k*2.39996+cardRandom()*.45, point=spurWood.curve.getPointAt(.29+k*.17);
      const fan=(hero?(low?.82:.73):.42)*(.76+cardRandom()*.48);
      point.x+=Math.cos(n)*fan*.36;point.y+=.05+Math.sin(k*.98)*fan*.39;point.z+=Math.sin(n)*fan*.38;
      sprays.push({point,centre,width:fan*1.62,height:fan*1.33,rotation:[-.39-cardRandom()*.68,n+angle,(cardRandom()-.5)*.51]});
     }
     for(let k=0;k<(hero?4:2);k++){
      const p=spurWood.curve.getPointAt(.43+k*.14);
      p.x+=(rng()-.5)*.10;p.y+=rng()*.12;p.z+=(rng()-.5)*.10;
      flowers.push({p,centre,size:.036+rng()*.019,rotation:[(rng()-.5)*2.1,rng()*TAU,rng()*TAU]});
     }
     if(spur%2===0)emitters.push({group,point:tip,tree:index});
    }
   }
   const wood=mergeGeometries(woody,false);woody.forEach(g=>g.dispose());
   mesh(own(wood),bark,group,`sakura:tree-${index}:wood-${branch}`);
   function makeBlossoms(template,entries,mat,label,isSpray){
    // The small geometry is branch-owned because its centre attribute is
    // per-instance. Changing a sibling's wind pose cannot disturb these fans.
    const geometry=own(template.clone());
    const centres=new Float32Array(entries.length*3);
    const batch=new T.InstancedMesh(geometry,mat,entries.length);
    batch.name=`sakura:tree-${index}:${label}-${branch}`;batch.userData.windOwner=group.name;
    entries.forEach((entry,i)=>{
     scratch.position.copy(isSpray?entry.point:entry.p);scratch.rotation.set(...entry.rotation);
     if(isSpray)scratch.scale.set(entry.width,entry.height,1);else scratch.scale.setScalar(entry.size);
     scratch.updateMatrix();batch.setMatrixAt(i,scratch.matrix);
     tone.set('#fff8f2').lerp(pink,rng()*(hero?.25:.14));batch.setColorAt(i,tone);
     entry.centre.toArray(centres,i*3);
    });
    geometry.setAttribute('crownCenter',new T.InstancedBufferAttribute(centres,3));
    batch.computeBoundingSphere();batch.castShadow=isSpray;batch.receiveShadow=true;group.add(batch);instances.add(batch);
   }
   makeBlossoms(hero?flowerGeometry:farFlowerGeometry,flowers,bloom,'flowers',false);
   makeBlossoms(sprayGeometry,sprays,sprayMaterial,'flower-sprays',true);
   blossomCount+=flowers.length;sprayCount+=sprays.length;
   boughs.push({group,phase:rng()*TAU,amplitude:(hero?.005:.009)*(1+branch/arms.length)});
  }
  trees.push({index,x:spec.x,z:spec.z,height:h,spread,form:hero?'garyu':'companion',weeping:false,rootY:treeRoot.position.y,boughs:arms.length});
 }
 const pink=new T.Color('#e6b1c1');
 STREAM_HERO_TREES.forEach(tree);

 const metadata={version:1,trees,blossomCount,sprayCount,sprayFlowers:sprayTexture.userData.flowers,fivePetals:true,opaqueCrownCores:false,emitterCount:emitters.length,falling:0,floating:0,landed:0,contacts:0,waterContacts:0,landContacts:0,releases:0,waterContactY:contactY,phase:0,motionEnabled:true,wind:.45,petals:[]};
 root.updateWorldMatrix(true,true);const inverseRoot=new T.Matrix4().copy(root.matrixWorld).invert();
 const emitterPosition=emitter=>emitter.point.clone().applyMatrix4(emitter.group.matrixWorld).applyMatrix4(inverseRoot);
 const waterEmitters=emitters.filter(emitter=>{const p=emitterPosition(emitter);return insideWater(p.x,p.z,.12);});
 metadata.waterEmitterCount=waterEmitters.length;
 const nearEmitters=emitters.filter(emitter=>emitter.tree===0),nearWater=waterEmitters.filter(emitter=>emitter.tree===0);
 const count=240,states=[],petalsMesh=new T.InstancedMesh(singleGeometry,loose,count);petalsMesh.name='sakura:falling-and-stream-floating-petals';petalsMesh.instanceMatrix.setUsage(T.DynamicDrawUsage);petalsMesh.frustumCulled=false;petalsMesh.renderOrder=2;root.add(petalsMesh);instances.add(petalsMesh);
 // Narrow companion windows move the physical camera farther from the tree.
 // Retain a small readable airborne silhouette while water/ground contacts
 // keep their authored size. Reflection captures use their own viewport.
 const airborne=new T.InstancedBufferAttribute(new Float32Array(count),1).setUsage(T.DynamicDrawUsage);
 singleGeometry.setAttribute('petalAirborne',airborne);
 const viewport=new T.Vector4(),viewHeight={value:720};
 petalsMesh.onBeforeRender=renderer=>{
  renderer.getCurrentViewport(viewport);
  viewHeight.value=viewport.w/(renderer.getRenderTarget()?1:renderer.getPixelRatio());
 };
 const looseCompile=loose.onBeforeCompile;
 loose.onBeforeCompile=shader=>{
  looseCompile(shader);
  shader.uniforms.uPetalViewHeight=viewHeight;
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute float petalAirborne; uniform float uPetalViewHeight;')
   .replace('#include <begin_vertex>',`#include <begin_vertex>
    float viewDepth=-(modelViewMatrix*vec4(instanceMatrix[3].xyz,1.)).z;
    float metrePerPixel=2.0*max(viewDepth,0.)/(max(1.,uPetalViewHeight)*projectionMatrix[1][1]);
    float authoredSize=length(modelMatrix[0].xyz)*length(instanceMatrix[0].xyz);
    float readable=clamp(5.2*metrePerPixel/max(.001,authoredSize),1.0,4.0);
    transformed*=mix(1.0,readable,petalAirborne);
   `);
 };
 loose.customProgramCacheKey=()=> 'falling-petal-flutter-v2';
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
  const close=state.id%5!==0,wet=state.id%4!==0;
  const list=wet&&waterEmitters.length?(close&&nearWater.length?nearWater:waterEmitters):(close?nearEmitters:emitters);
  const emitter=list[Math.floor(rng()*list.length)];
  state.position.copy(emitterPosition(emitter));state.kind='falling';state.age=0;state.fade=1;state.recycle=false;if(!initial)metadata.releases++;state.velocity.set((rng()-.45)*.14,-.32-rng()*.15,.19+rng()*.37);state.water=insideWater(state.position.x,state.position.z);state.emitterTree=emitter.tree;
 }
 for(let id=0;id<count;id++){
  const state={id,kind:'falling',position:new T.Vector3(),velocity:new T.Vector3(),age:0,seed:rng()*TAU,size:.064+rng()*.048,turn:rng()*TAU,lateral:0,normal:new T.Vector3(0,1,0),fade:1,recycle:false};spawn(state,true);
  if(id%3===0){state.kind='floating';state.age=15+rng()*70;state.position.z=STREAM_START+5+rng()*(STREAM_END-STREAM_START-12);state.lateral=(rng()-.5)*1.75;state.position.set(streamCenter(state.position.z)+state.lateral*streamHalfWidth(state.position.z),contactY,state.position.z);}
  else if(id%7===0){state.kind='landed';state.age=20+rng()*60;state.position.x=streamCenter(state.position.z)-streamHalfWidth(state.position.z)-.4-rng()*3.2;seatLandedPetal(state);}
  else {
   // Seed the existing trajectories throughout the open air below the crown.
   // A new camera sees petals already drifting clear of the dense blossom fans.
   const elapsed=1.5+rng()*6.6;
   state.position.x+=state.velocity.x*elapsed;
   state.position.z+=state.velocity.z*elapsed;
   const surface=insideWater(state.position.x,state.position.z)?contactY:groundHeight(state.position.x,state.position.z)+.008;
   state.position.y=Math.max(surface+.20+rng()*.24,state.position.y+state.velocity.y*elapsed-.012*elapsed*elapsed);
  }
  states.push(state);metadata.petals.push({id,kind:state.kind,x:0,y:0,z:0,contactY:0});
 }
 function drawPetals(){
  metadata.falling=metadata.floating=metadata.landed=0;
  for(const state of states){
   airborne.setX(state.id,state.kind==='falling'?1:0);
   scratch.position.copy(state.position);scratch.scale.setScalar(state.size*state.fade);
   if(state.kind==='falling')scratch.rotation.set(state.turn+simTime*.8+Math.sin(simTime*.75+state.seed)*.5,state.seed+simTime*.4,Math.sin(simTime*.9+state.seed)*1.2);
   else if(state.kind==='floating'){yaw.setFromAxisAngle(yawAxis,state.turn+simTime*.055);scratch.quaternion.copy(yaw).multiply(flat);}
   else{yaw.setFromAxisAngle(state.normal,state.turn);scratch.quaternion.setFromUnitVectors(petalNormal,state.normal).premultiply(yaw);}
   scratch.updateMatrix();petalsMesh.setMatrixAt(state.id,scratch.matrix);metadata[state.kind]++;
   Object.assign(metadata.petals[state.id],{kind:state.kind,x:state.position.x,y:state.position.y,z:state.position.z,contactY:state.kind==='floating'?contactY:state.kind==='landed'?groundHeight(state.position.x,state.position.z)+.008:null});
  }
  airborne.needsUpdate=true;petalsMesh.instanceMatrix.needsUpdate=true;metadata.phase=simTime;metadata.wind=wind;
 }
 drawPetals();
 let lastShadowPose=-Infinity;
 function update(time){
  if(disposed||!Number.isFinite(time))return;if(lastHost===null){lastHost=time;return;}
  const dt=Math.max(0,Math.min(.08,time-lastHost));lastHost=time;if(!enabled||!dt)return;
  simTime+=dt;wind+=(targetWind-wind)*(1-Math.exp(-dt/1.7));
  for(const bough of boughs){const wave=Math.sin(simTime*.72+bough.phase)-Math.sin(bough.phase);bough.group.rotation.z=wave*bough.amplitude*wind;bough.group.rotation.y=(Math.sin(simTime*.48+bough.phase*.7)-Math.sin(bough.phase*.7))*bough.amplitude*.5*wind;}
  root.updateWorldMatrix(true,true);inverseRoot.copy(root.matrixWorld).invert();
  // The host parks shadow maps between frames. Moving wood and attached
  // blossoms must invalidate their actual shadows with the same pose.
  if(b.renderer?.shadowMap && simTime-lastShadowPose>=.12){
   b.renderer.shadowMap.needsUpdate=true;lastShadowPose=simTime;
  }
  for(const state of states){
   state.age+=dt;if(state.recycle){state.fade=Math.max(0,state.fade-dt*1.5);if(!state.fade)spawn(state);}
   if(state.kind==='falling'){
    state.velocity.y=Math.max(-.58,state.velocity.y-.035*dt);state.position.y+=state.velocity.y*dt;
    state.position.x+=(state.velocity.x+Math.sin(simTime*1.6+state.seed)*.21+wind*.048)*dt;
    state.position.z+=(state.velocity.z*(.68+wind*.70)+Math.cos(simTime*1.17+state.seed)*.11)*dt;
    const water=insideWater(state.position.x,state.position.z),surface=water?contactY:groundHeight(state.position.x,state.position.z)+.008;
    if(state.position.y<=surface){state.position.y=surface;state.kind=water?'floating':'landed';state.lateral=clamp((state.position.x-streamCenter(state.position.z))/streamHalfWidth(state.position.z),-.95,.95);if(water)state.position.x=streamCenter(state.position.z)+state.lateral*streamHalfWidth(state.position.z);else seatLandedPetal(state);state.age=0;metadata.contacts++;if(water)metadata.waterContacts++;else metadata.landContacts++;}
   }else if(state.kind==='floating'){
    state.position.z+=(.17+wind*.09+.035*Math.sin(simTime*.45+state.seed))*dt;
    state.position.x=streamCenter(state.position.z)+clamp(state.lateral+Math.sin(simTime*.5+state.seed)*.012,-.93,.93)*streamHalfWidth(state.position.z);state.position.y=contactY;
    if(state.position.z>STREAM_END-.8)spawn(state);
   }else if(state.age>95)state.recycle=true;
  }
  emissionCredit+=dt*(7.7+wind*1.8);
  while(emissionCredit>=1){const candidate=states.filter(state=>state.kind!=='falling'&&!state.recycle&&state.age>18).sort((a,b)=>b.age-a.age)[0];if(!candidate){emissionCredit=Math.min(1,emissionCredit);break;}candidate.recycle=true;emissionCredit--; }
  drawPetals();
 }
 return {update,setMotion({enabled:value}={}){const next=value!==false;if(next!==enabled){enabled=next;lastHost=null;}metadata.motionEnabled=enabled;},setWind(value){targetWind=Number.isFinite(value)?clamp(value,0,1.5):.45;},metadata,
  dispose(){if(disposed)return;disposed=true;root.removeFromParent();for(const instance of instances)instance.dispose();for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const texture of textures)texture.dispose();},
 };
}
