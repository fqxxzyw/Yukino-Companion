import * as T from 'three';

// All trunks and boughs share one tapered primitive. The red maples fork
// low into shallow overlapping fans; the cedars keep a single rising leader.
export function plantKyotoGrove(b,ground){
 const bark=b.mat('bark:kyoto-grove','#675243'),cherryBark=b.mat('bark:kyoto-cherry','#56423d'),r=b.rng;
 const branch=b.own(new T.CylinderGeometry(.58,1,1,8)),up=new T.Vector3(0,1,0);
 const maples=[],cedars=[],sakura=[],understory=[];
 function limb(a,c,radius,mat=bark){
  const delta=c.clone().sub(a);
  if(delta.lengthSq()<1e-5)return;
  const stem=b.mesh(branch,mat,a.clone().lerp(c,.5).toArray(),[radius,delta.length(),radius]);
  stem.quaternion.setFromUnitVectors(up,delta.normalize());
 }
 function leaves(points,tip,width,depth,baseHue,count,sizeBoost=1){
  const center=tip.toArray();
  for(let n=0;n<count;n++){
   const angle=r()*Math.PI*2,rad=Math.sqrt(r()),size=(.19+width*.13+r()*.16)*sizeBoost;
   points.push({x:tip.x+Math.cos(angle)*rad*width,y:tip.y+(r()-.48)*depth+.18*(1-rad),z:tip.z+Math.sin(angle)*rad*width*.82,
    rx:-1.37+(r()-.5)*1.05,ry:r()*.8,rz:r()*6.28,hue:baseHue+(r()-.5)*.038,size,center});
  }
 }
 function maple(x,z,h,spread,hue){
  const base=new T.Vector3(x,ground(x,z)-.03,z),lean=(r()-.5)*spread;
  const fork=base.clone().add(new T.Vector3(lean*.38,h*.30,.22)),az=r()*6.28;
  limb(base,fork,h*.05);
  for(let j=0;j<6;j++){
   const a=az+j*2.4,outer=j<4?1:.68,w=spread*(.72+r()*.32)*outer;
   const elbow=fork.clone().add(new T.Vector3(Math.cos(a)*w*.46,h*(.15+j*.026),Math.sin(a)*w*.46));
   limb(fork,elbow,h*(.026-j*.0018));
   for(let k=0;k<4;k++){
    const dir=a+(k-1.5)*.54;
    const tip=elbow.clone().add(new T.Vector3(Math.cos(dir)*w*.78,h*(.135+r()*.12),Math.sin(dir)*w*.78));
    limb(elbow,tip,h*.01);leaves(maples,tip,spread*(.38+r()*.14),h*.105,hue,52,1.04);
   }
  }
 }
 // Spring Yamazakura (mountain cherry) framing Kiyomizu West Gate & Pagoda.
 function cherry(x,z,h,spread){
  const base=new T.Vector3(x,ground(x,z)-.03,z),lean=(x<0?.22:-.22)*spread;
  const fork=base.clone().add(new T.Vector3(lean*.45,h*.34,.18)),az=r()*6.28;
  limb(base,fork,h*.048,cherryBark);
  for(let j=0;j<5;j++){
   const a=az+j*1.26+(r()-.5)*.3,w=spread*(.74+r()*.32);
   const elbow=fork.clone().add(new T.Vector3(Math.cos(a)*w*.48+lean*.25,h*(.18+j*.028),Math.sin(a)*w*.48));
   limb(fork,elbow,h*.024,cherryBark);
   for(let k=0;k<4;k++){
    const dir=a+(k-1.5)*.56;
    const tip=elbow.clone().add(new T.Vector3(Math.cos(dir)*w*.72,h*(.12+r()*.13),Math.sin(dir)*w*.72));
    limb(elbow,tip,h*.0095,cherryBark);
    leaves(sakura,tip,spread*(.42+r()*.14),h*.12,.94+(r()-.5)*.03,56,1.12);
   }
  }
 }
 // Lush Higashiyama Sugi cedars with full layered drooping boughs instead of bare poles.
 function cedar(x,z,h,spread){
  const base=new T.Vector3(x,ground(x,z)-.04,z),tip=base.clone().add(new T.Vector3((r()-.5)*.38,h,.12));
  limb(base,tip,h*.034);
  const az=r()*6.28;
  for(let tier=0;tier<12;tier++){
   const t=tier/11,origin=base.clone().lerp(tip,.18+.79*t);
   const branches=t>.85?5:7;
   for(let j=0;j<branches;j++){
    const a=az+j*(Math.PI*2/branches)+tier*1.37+r()*.26,w=spread*(1.12-t*.82)*(.76+r()*.34);
    const droop=-h*.025*(1-t)+h*.04*t;
    const end=origin.clone().add(new T.Vector3(w*Math.cos(a),droop,w*Math.sin(a)));
    limb(origin,end,h*.011*(1-t*.64));
    leaves(cedars,end,Math.max(.32,w*.68),h*.095,.285+(r()-.5)*.03,26,1.16);
   }
  }
  leaves(cedars,tip,spread*.36,h*.11,.29,24,1.08);
 }
 // Spring maples (Ao-momiji) framing both shrines.
 for(const [x,z,h,w,hue] of [[-12.1,-6.8,6.8,2.4,.24],[-11.4,-.6,4.8,2.25,.21],[-9.6,3.2,4.1,1.8,.20],
   [3.6,4.8,5.8,2.65,.22],[3.7,-1.5,6.6,2.2,.19],[12.1,7.0,5.0,2.35,.22],[11.9,-.9,6.8,2.9,.21],
   [9.9,-8.0,6.2,2.5,.22],[-5.1,-11.6,5.4,2.45,.24],[12.5,10.3,4.2,1.95,.215],[-12.2,8.4,4.3,2.0,.225]])maple(x,z,h,w,hue);
 // Mountain cherry blossoms tucked behind the West Gate, Pagoda shoulder, and hillside curve.
 for(const [x,z,h,w] of [[-10.8,-4.2,6.2,2.5],[-5.6,-9.8,6.7,2.6],[4.5,-6.4,5.9,2.35]])cherry(x,z,h,w);
 // Dense Sugi cedar backdrop across the rear ridge so the shrine sits on a wooded mountainside.
 for(const [x,z,h,w] of [[-12.4,-10.8,9.2,2.1],[-9.1,-12.2,8.4,1.95],[-5.5,-12.4,9.6,2.15],[-1.8,-12.3,9.2,2.05],
   [2.2,-12.1,8.6,2.0],[5.6,-12.2,10.2,2.3],[9.1,-12.0,9.4,2.1],[12.1,-10.2,8.8,2.1],[12.6,-5.8,8.5,2.05],[12.9,2.8,6.8,1.75]])cedar(x,z,h,w);
 // Layered Kyoto azalea/camellia shrubs grounding the left, center, and right flanks.
 const shrubBeds=[
  [-11.8,10.4,3.4,2.6,.95],[-11.3,6.4,3.2,3.4,1.05],[-11.6,1.8,2.8,3.6,.85],[-11.6,-3.2,2.8,3.8,1.05],
  [2.6,6.8,2.1,2.4,.82],[3.1,2.4,2.2,3.4,.95],[11.7,11.0,2.8,2.4,.85],[11.9,6.6,2.8,3.4,1.0],
  [12.1,1.6,2.6,4.0,1.05],[11.6,-4.2,3.2,4.4,1.15],[1.6,-11.2,5.4,2.4,1.1],[-8.6,-10.8,5.2,2.4,1.1]
 ];
 for(const [sx,sz,sw,sd,sh] of shrubBeds){
  const count=Math.round(sw*sd*72);
  for(let i=0;i<count;i++){
   const px=sx+(r()-.5)*sw,pz=sz+(r()-.5)*sd;
   const py=ground(px,pz)+.07+Math.pow(r(),.8)*sh;
   understory.push({x:px,y:py,z:pz,size:.13+r()*.15,hue:.24+r()*.06,center:[sx,ground(sx,sz)+sh*.55,sz]});
  }
 }
 const fan=b.leaves(maples,{name:'foliage:kyoto-maple-fans',color:'#9fc27a'});
 // Five pointed lobes and a folded centre distinguish individual maple
 // leaves at inspection distance. Keep the per-instance crown centres.
 const mapleLeaf=b.own(new T.BufferGeometry()),positions=[0,-.17,.07],uv=[.5,.33],indices=[];
 const outline=[[-.04,-.42],[-.36,-.15],[-.15,-.16],[-.48,.17],[-.18,.005],[-.28,.38],[-.07,.12],[0,.54],[.09,.095],[.32,.35],[.21,-.015],[.48,.11],[.17,-.17],[.34,-.22],[.045,-.42]];
 for(let i=0;i<outline.length;i++){
  const [x,y]=outline[i];positions.push(x,y,0);uv.push(x+.5,y+.45);indices.push(0,(i+1)%outline.length+1,i+1);
 }
 mapleLeaf.setAttribute('position',new T.Float32BufferAttribute(positions,3));mapleLeaf.setAttribute('uv',new T.Float32BufferAttribute(uv,2));mapleLeaf.setIndex(indices);mapleLeaf.computeVertexNormals();
 mapleLeaf.setAttribute('crownCenter',fan.geometry.getAttribute('crownCenter'));fan.geometry=mapleLeaf;fan.computeBoundingSphere();
 const blossom=b.leaves(sakura,{name:'foliage:kyoto-sakura-blossoms',color:'#f4d5dc'});
 if(blossom){
  const col=new T.Color();
  for(let i=0;i<sakura.length;i++){col.setHSL(.95+(r()-.5)*.025,.28+r()*.16,.80+r()*.12);blossom.setColorAt(i,col);}
  if(blossom.instanceColor)blossom.instanceColor.needsUpdate=true;
 }
 b.leaves(cedars,{name:'foliage:kyoto-cedar-sprays',color:'#5e8468',narrow:true});
 b.leaves(understory,{name:'foliage:kyoto-understory-shrubs',color:'#5a7c45'});
}
