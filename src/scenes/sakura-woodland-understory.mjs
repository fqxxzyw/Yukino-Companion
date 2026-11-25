import * as T from 'three';
import {randomSeed} from './diorama-kit.mjs';

// Subtle atmospheric depth for rear ridge trees using live scene fog colour.
export function ridgeAtmosphere(material,strength) {
 const compile=material.onBeforeCompile,key=material.customProgramCacheKey();
 material.onBeforeCompile=(shader,renderer)=>{
  compile.call(material,shader,renderer);
  shader.fragmentShader=shader.fragmentShader.replace('#include <fog_fragment>',`#include <fog_fragment>
   #ifdef USE_FOG
    gl_FragColor.rgb=mix(gl_FragColor.rgb,fogColor,${strength.toFixed(3)}*smoothstep(24.0,95.0,vFogDepth));
   #endif
  `);
 };
 material.customProgramCacheKey=()=>key+'|ridge-aerial:'+strength;
 return material;
}

// Procedurally paint feathery Japanese red-pine needle fans & layered spring
// deciduous leaf sprays with genuine transparent sky openings (no solid disks).
function woodlandFoliageTexture(kind) {
 const size=256,data=new Uint8Array(size*size*4),rng=randomSeed(kind==='pine'?884121:662913);
 const setPx=(x,y,r,g,b,a)=>{
  if(x<0||y<0||x>=size||y>=size)return;
  const k=(y*size+x)*4;
  if(a<=data[k+3])return;
  data[k]=Math.max(0,Math.min(255,Math.round(r)));
  data[k+1]=Math.max(0,Math.min(255,Math.round(g)));
  data[k+2]=Math.max(0,Math.min(255,Math.round(b)));
  data[k+3]=Math.max(0,Math.min(255,Math.round(a)));
 };
 const drawLine=(x0,y0,x1,y1,thick,r,g,b)=>{
  const steps=Math.max(4,Math.ceil(Math.hypot(x1-x0,y1-y0)*1.6));
  for(let s=0;s<=steps;s++){
   const t=s/steps,cx=x0+(x1-x0)*t,cy=y0+(y1-y0)*t;
   const rad=thick*(1-t*.35);
   for(let dy=-Math.ceil(rad);dy<=Math.ceil(rad);dy++)for(let dx=-Math.ceil(rad);dx<=Math.ceil(rad);dx++){
    const d=Math.hypot(dx,dy);if(d>rad)continue;
    setPx(Math.round(cx+dx),Math.round(cy+dy),r,g,b,255*Math.min(1,(rad-d+.6)));
   }
  }
 };
 // Inner woody twigs anchoring the spray so silhouettes never look like floating dots.
 for(let b=0;b<5;b++){
  const a=-Math.PI*.5+(b-2)*.48+(rng()-.5)*.2,len=size*(.22+rng()*.18);
  drawLine(size*.5,size*.66,size*.5+Math.cos(a)*len,size*.66+Math.sin(a)*len*.82,2.2,86,74,58);
 }
 if(kind==='pine'){
  // Japanese red pine (Akamatsu) feathery radial needle rosettes in 6 tiered sub-tufts.
  const tufts=[[.50,.32,.21],[.28,.44,.19],[.72,.43,.19],[.40,.54,.18],[.62,.55,.17],[.50,.22,.15]];
  for(const [tx,ty,tr] of tufts){
   const cx=tx*size,cy=ty*size,R=tr*size;
   for(let n=0;n<115;n++){
    const a=rng()*Math.PI*2,rad=Math.pow(rng(),.55)*R*.65;
    const ox=cx+Math.cos(a)*rad,oy=cy+Math.sin(a)*rad*.78;
    const na=a+(rng()-.5)*1.1,nlen=10+rng()*14;
    const tipBright=.78+.38*(1-oy/size)+rng()*.18;
    drawLine(ox,oy,ox+Math.cos(na)*nlen,oy+Math.sin(na)*nlen*.86,1.35,76*tipBright,112*tipBright,78*tipBright);
   }
  }
 }else{
  // Layered spring mountain broadleaf sprays (beech / oak / camphor).
  const clusters=[[.50,.33,.22],[.29,.46,.20],[.71,.45,.20],[.42,.58,.18],[.60,.57,.18],[.50,.22,.16]];
  for(const [tx,ty,tr] of clusters){
   const cx=tx*size,cy=ty*size,R=tr*size;
   for(let leaf=0;leaf<72;leaf++){
    const a=rng()*Math.PI*2,rad=Math.sqrt(rng())*R;
    const lx=cx+Math.cos(a)*rad,ly=cy+Math.sin(a)*rad*.82;
    const rx=4.2+rng()*4.8,ry=rx*(.52+rng()*.32),ang=rng()*Math.PI;
    const ca=Math.cos(ang),sa=Math.sin(ang);
    const shade=.74+.36*(1-ly/size)+rng()*.22;
    const rCol=98*shade,gCol=134*shade,bCol=74*shade;
    const ext=Math.ceil(rx+1);
    for(let dy=-ext;dy<=ext;dy++)for(let dx=-ext;dx<=ext;dx++){
     const u=(dx*ca+dy*sa)/rx,v=(-dx*sa+dy*ca)/ry;
     const dist=u*u+v*v;if(dist>1.05)continue;
     const alpha=Math.min(1,(1.05-dist)*3.2)*255;
     setPx(Math.round(lx+dx),Math.round(ly+dy),rCol,gCol,bCol,alpha);
    }
   }
  }
 }
 const texture=new T.DataTexture(data,size,size,T.RGBAFormat);
 texture.name='foliage:woodland-'+kind+'-sprays';
 texture.colorSpace=T.SRGBColorSpace;
 texture.minFilter=T.LinearMipmapLinearFilter;texture.magFilter=T.LinearFilter;
 texture.generateMipmaps=true;texture.needsUpdate=true;
 return texture;
}

// Builds realistic, breathable Japanese mountain pine & broadleaf groves inside
// the square diorama's rear hillside ridge. Crossed alpha-cut spray cards with
// real branches and per-bough crownCenter keep silhouettes crisp in lit & toon.
export function addRidgePines(b,heightAt,{minX=-31,maxX=31,minZ=-39.5,maxZ=-24.5}={}) {
 const rng=randomSeed(446812),trunks=[],pineCards=[],leafCards=[],transform=new T.Object3D();
 const up=new T.Vector3(0,1,0);
 function limb(a,c,r) {
  const direction=c.clone().sub(a);
  transform.position.copy(a).addScaledVector(direction,.5);
  transform.quaternion.setFromUnitVectors(up,direction.clone().normalize());
  transform.scale.set(r,direction.length(),r);transform.updateMatrix();trunks.push(transform.matrix.clone());
 }
 // Staggered, organic grove clusters along the diorama's wooded north ridge
 // (leaving the central stream gorge & green bridge corridor open!).
 const trees=[];
 for(let i=0;i<54;i++){
  const u=(i+.5)/54,x=T.MathUtils.lerp(minX,maxX,u)+(rng()-.5)*2.4;
  const z=T.MathUtils.lerp(minZ,maxZ,Math.pow(rng(),.85));
  // Keep the creek channel itself clear while letting boughs frame both banks.
  const creekCenter=-1.6*Math.sin((z-6)*.065)-.55*Math.sin(z*.16+1.1);
  if(Math.abs(x-creekCenter)<4.8&&z>-35.5)continue;
  const pine=i%3!==0;
  const edgeTaper=1-Math.max(0,(Math.abs(x)-27)/7)*.35;
  const h=(pine?(6.5+rng()*5.2):(4.6+rng()*3.8))*edgeTaper;
  const w=h*(pine?.30:.40)*(.82+rng()*.36);
  trees.push({x,z,h,w,pine,seed:rng()});
 }
 const pineTone=new T.Color('#7ca27a'),broadTone=new T.Color('#97b57c'),mist=new T.Color('#b6c8c3'),tone=new T.Color();
 for(const tree of trees){
  const {x,z,h,w,pine}=tree;
  const y=heightAt(x,z);
  const leanX=(rng()-.5)*h*.18,leanZ=(rng()-.5)*h*.12;
  const foot=new T.Vector3(x,y-.2,z),mid=foot.clone().add(new T.Vector3(leanX*.5,h*.48,leanZ*.5));
  const top=foot.clone().add(new T.Vector3(leanX,h*.88,leanZ));
  limb(foot,mid,h*(pine?.024:.028));
  limb(mid,top,h*(pine?.016:.019));
  const haze=T.MathUtils.clamp((-z-24)/28,.04,.34);
  const tiers=pine?6:5;
  for(let tier=0;tier<tiers;tier++){
   const t=tier/(tiers-1);
   const origin=foot.clone().lerp(top,.24+t*.70);
   const branches=tier===tiers-1?2:(pine?4:4);
   for(let j=0;j<branches;j++){
    const a=tree.seed*6.28+tier*2.1+j*(Math.PI*2/branches)+(rng()-.5)*.5;
    const reach=w*(1-t*.52)*(.70+rng()*.45);
    const rise=h*(pine?(.03+t*.07):(.08+t*.11));
    const end=origin.clone().add(new T.Vector3(Math.cos(a)*reach,rise,Math.sin(a)*reach));
    limb(origin,end,h*.011*(1-t*.52));
    const cardScale=w*(pine?.88:.92)*(1-t*.32)*(.88+rng()*.32);
    const col=tone.copy(pine?pineTone:broadTone).lerp(mist,haze).multiplyScalar(.82+t*.24+(rng()-.5)*.14).clone();
    const bucket=pine?pineCards:leafCards;
    // Two crossed angled planes + one tilted crown top plane give full 3D
    // volume from both companion eye level and high diorama overview!
    for(let p=0;p<3;p++){
     const rx=p===2?(-Math.PI*.36+(rng()-.5)*.22):((rng()-.5)*.34);
     const ry=a+p*1.08+(rng()-.5)*.35;
     const rz=(rng()-.5)*.28;
     const off=p===2?new T.Vector3(0,cardScale*.16,0):new T.Vector3((rng()-.5)*.24,(rng()-.5)*.18,(rng()-.5)*.24);
     bucket.push({pos:end.clone().add(off),center:end,rot:[rx,ry,rz],scale:[cardScale*(p===2?1.12:1),cardScale*(pine?.76:.92),1],color:col});
    }
   }
  }
 }
 const bark=ridgeAtmosphere(b.mat('bark:ridge-pines','#6b5d4e',{roughness:.96}),.32);
 const wood=new T.InstancedMesh(b.own(new T.CylinderGeometry(.62,1,1,6,1,true)),bark,trunks.length);
 wood.name='sakura-stream:wooded-distant-branches';
 trunks.forEach((m,i)=>wood.setMatrixAt(i,m));
 wood.castShadow=true;wood.receiveShadow=true;wood.computeBoundingSphere();
 b.root.add(wood);b.instances.push(wood);

 const buildCanopy=(name,kind,cards)=>{
  if(!cards.length)return null;
  const texture=woodlandFoliageTexture(kind);b.textures.add(texture);
  const material=ridgeAtmosphere(b.mat(name,'#ffffff',{map:texture,alphaTest:.36,alphaToCoverage:true,side:T.DoubleSide,roughness:.96,metalness:0}),.30);
  material.userData.surfaceFinish={roughness:.96,metalness:0,envMapIntensity:.08};
  const geometry=b.own(new T.PlaneGeometry(1,1));
  const centers=new Float32Array(cards.length*3);
  cards.forEach((c,i)=>c.center.toArray(centers,i*3));
  geometry.setAttribute('crownCenter',new T.InstancedBufferAttribute(centers,3));
  const mesh=new T.InstancedMesh(geometry,material,cards.length);
  mesh.name='sakura-stream:'+name.split(':')[1];
  cards.forEach((c,i)=>{
   transform.position.copy(c.pos);transform.rotation.set(...c.rot);transform.scale.set(...c.scale);
   transform.updateMatrix();mesh.setMatrixAt(i,transform.matrix);mesh.setColorAt(i,c.color);
  });
  mesh.castShadow=true;mesh.receiveShadow=true;mesh.computeBoundingSphere();
  b.root.add(mesh);b.instances.push(mesh);
  return mesh;
 };
 buildCanopy('foliage:wooded-distant-leaves','pine',pineCards);
 buildCanopy('foliage:wooded-distant-broadleaf','broadleaf',leafCards);
}
