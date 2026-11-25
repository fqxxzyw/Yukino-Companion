import * as T from 'three';
import {Diorama} from './diorama-kit.mjs';
import {canopyRays} from './canopy-rays.mjs';
import {bambooSway} from './bamboo-sway.mjs';

export function createScene({scene,renderer}){
 const b=new Diorama(scene,renderer,'Arashiyama_Bamboo_Path'),r=b.rng;
 b.plinth(25,29,'#4e4c3d');
 // Procedural mossy woodland earth & authentic Moso bamboo culm texture (vertical fibers + powdery node rings).
 const bambooTex=(()=>{
  const c=document.createElement('canvas');c.width=256;c.height=512;const ctx=c.getContext('2d');
  const grad=ctx.createLinearGradient(0,512,0,0);
  grad.addColorStop(0,'#6d7d52');grad.addColorStop(.28,'#9cb474');grad.addColorStop(.75,'#b8cf8a');grad.addColorStop(1,'#c7dc98');
  ctx.fillStyle=grad;ctx.fillRect(0,0,256,512);
  for(let i=0;i<180;i++){
   const x=(i*137)%256;ctx.fillStyle=i%2?'rgba(40,58,28,0.12)':'rgba(225,240,192,0.11)';
   ctx.fillRect(x,0,1.5+(i%3)*.8,512);
  }
  const segs=23;
  for(let j=1;j<segs;j++){
   const y=Math.round(512*(1-j/segs));
   // Dark node crease + pale powdery Moso-chiku bloom band just below each ring.
   ctx.fillStyle='rgba(44,54,30,0.48)';ctx.fillRect(0,y-2,256,3);
   ctx.fillStyle='rgba(232,238,214,0.34)';ctx.fillRect(0,y+1,256,5);
   ctx.fillStyle='rgba(58,68,38,0.22)';ctx.fillRect(0,y-4,256,2);
  }
  const tex=new T.CanvasTexture(c);tex.colorSpace=T.SRGBColorSpace;tex.wrapS=T.RepeatWrapping;tex.wrapT=T.ClampToEdgeWrapping;tex.anisotropy=4;b.textures.add(tex);return tex;
 })();
 const mossTex=(()=>{
  const c=document.createElement('canvas');c.width=512;c.height=512;const ctx=c.getContext('2d');
  ctx.fillStyle='#5c5a42';ctx.fillRect(0,0,512,512);
  for(let i=0;i<280;i++){
   const x=((i*197)%512),y=((i*311)%512),rad=14+(i%34);
   const g=ctx.createRadialGradient(x,y,2,x,y,rad);
   g.addColorStop(0,i%3===0?'rgba(74,98,52,0.44)':i%3===1?'rgba(84,74,52,0.38)':'rgba(56,74,42,0.42)');
   g.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=g;ctx.fillRect(x-rad,y-rad,rad*2,rad*2);
  }
  for(let i=0;i<5000;i++){
   const x=(i*73+19)%512,y=(i*139+37)%512;
   ctx.fillStyle=i%2?'rgba(42,46,28,0.18)':'rgba(154,142,102,0.16)';ctx.fillRect(x,y,2,2);
  }
  const tex=new T.CanvasTexture(c);tex.colorSpace=T.SRGBColorSpace;tex.wrapS=tex.wrapT=T.RepeatWrapping;tex.repeat.set(5,6);tex.anisotropy=4;b.textures.add(tex);return tex;
 })();
 const pathTex=(()=>{
  const c=document.createElement('canvas');c.width=512;c.height=512;const ctx=c.getContext('2d');
  ctx.fillStyle='#72766d';ctx.fillRect(0,0,512,512);
  for(let i=0;i<9000;i++){
   const x=(i*97+11)%512,y=(i*173+29)%512,v=92+(i%54);
   ctx.fillStyle=`rgba(${v},${v+2},${v-3},0.34)`;ctx.fillRect(x,y,1.6,1.6);
  }
  const tex=new T.CanvasTexture(c);tex.colorSpace=T.SRGBColorSpace;tex.wrapS=tex.wrapT=T.RepeatWrapping;tex.repeat.set(2,12);tex.anisotropy=4;b.textures.add(tex);return tex;
 })();
 const earth=b.mat('soil:mossy-bank','#b8b69c',{map:mossTex,roughness:1});earth.userData.surfaceFinish={roughness:1,metalness:0,envMapIntensity:.04};
 const path=b.mat('asphalt:forest-aggregate','#b6bab2',{map:pathTex,roughness:.94});path.userData.surfaceFinish={roughness:.94,metalness:0,envMapIntensity:.12};
 const culm=new T.MeshPhysicalMaterial({color:'#c0d49a',map:bambooTex,roughness:.84,metalness:0,specularIntensity:.20,envMapIntensity:.16});culm.name='bamboo:culm';b.materials.add(culm);
 const twigMaterial=b.mat('bamboo:twig','#3f5633',{roughness:1});
 const twigGeometry=[b.own(new T.CylinderGeometry(.6,1,1,6)),b.own(new T.CylinderGeometry(1/6,1,1,6))];
 const twig=(start,end,radius=.018)=>{const a=new T.Vector3(...start),c=new T.Vector3(...end),mid=a.clone().lerp(c,.55);mid.y+=.12;const points=[a,mid,c];for(let i=0;i<2;i++){const u=points[i],v=points[i+1],rad=radius*(i===0?1:.6);const o=b.mesh(twigGeometry[i],twigMaterial,u.clone().add(v).multiplyScalar(.5).toArray(),[rad,u.distanceTo(v),rad]);o.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),v.clone().sub(u).normalize());}};
 const fence=b.mat('wood:bamboo-fence','#9a8f6c',{roughness:.86}),brush=b.mat('wood:brush-fence','#584639',{roughness:.96}),rope=b.mat('fabric:shuronawa-knot','#23201d',{roughness:.96}),stone=b.mat('stone:drainage','#697262',{roughness:.95});
 const center=z=>.8*Math.sin(z*.2)+.35*Math.sin(z*.4+1);
 const apertures=[[2.8,9.2,9.1],[6.9,9.4,4.6],[-4.6,9.7,-1.7]];
 const inOpening=(x,z)=>apertures.some(([ax,,az])=>((x-ax)/1.35)**2+((z-az)/1.85)**2<1);
 const strip=(width,y,m)=>{
  const pos=[],uv=[],idx=[];for(let j=0;j<=112;j++){const z=14.1-j*.205;for(let side of [-1,1]){pos.push(center(z)+side*width/2,y,z);uv.push((side+1)/2,j/112);}}
  for(let j=0;j<112;j++){const n=j*2;idx.push(n,n+1,n+2,n+1,n+3,n+2);}
  const g=b.own(new T.BufferGeometry());g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();b.mesh(g,m);
 };
 b.box([0,.1,0],[24.7,.2,28.7],earth);strip(3.5,.245,path);
 b.box([0,.22,-9],[24.5,.045,2.35],path);
 // Sculpted mossy banks rising smoothly along both sides and behind the rear T-junction to enclose the grove.
 const bankY=(x,z)=>{
  if(z<-10.25){const back=Math.min(1,(-10.25-z)/3.6);return .22+back*(1.45+.28*Math.sin(x*.55+z*.8));}
  if(z<-7.8)return .18;
  const edge=Math.abs(x-center(z));
  const flank=Math.max(0,Math.min(1,(edge-1.8)*.72));
  const outerLift=Math.max(0,Math.min(1,(edge-5.4)/5.5))*.85;
  return .18+flank*(.40+.14*Math.sin(x*1.6+z*.55))+outerLift;
 };
 const bankGeometry=b.own(new T.PlaneGeometry(24.6,28.6,72,84));bankGeometry.rotateX(-Math.PI/2);
 const bankPosition=bankGeometry.attributes.position;
 for(let i=0;i<bankPosition.count;i++){const x=bankPosition.getX(i),z=bankPosition.getZ(i);bankPosition.setY(i,bankY(x,z));}
 bankGeometry.computeVertexNormals();b.mesh(bankGeometry,earth);
 // Seal all four outer edges of the sculpted hillside bank down to the plinth rim
 // so overview angles show a solid stratified earth block with zero floating lip.
 {
  const wallMat=b.mat('base:forest-bank-cut','#4e4c3d',{roughness:.96});
  const addSkirt=(pts,flip)=>{
   const pos=[],uv=[],idx=[];
   for(let i=0;i<pts.length;i++){
    const [x,z]=pts[i],yTop=bankY(x,z)+.01,u=i/(pts.length-1);
    pos.push(x,-.02,z,x,yTop,z);uv.push(u,0,u,1);
    if(i){const a=(i-1)*2;idx.push(...(flip?[a,a+1,a+2,a+1,a+3,a+2]:[a,a+2,a+1,a+1,a+2,a+3]));}
   }
   const g=b.own(new T.BufferGeometry());
   g.setAttribute('position',new T.Float32BufferAttribute(pos,3));
   g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
   g.setIndex(idx);g.computeVertexNormals();b.mesh(g,wallMat);
  };
  const N=48;
  addSkirt(Array.from({length:N+1},(_,i)=>[-12.3,-14.3+28.6*i/N]),false);
  addSkirt(Array.from({length:N+1},(_,i)=>[12.3,-14.3+28.6*i/N]),true);
  addSkirt(Array.from({length:N+1},(_,i)=>[-12.3+24.6*i/N,-14.3]),true);
  addSkirt(Array.from({length:N+1},(_,i)=>[-12.3+24.6*i/N,14.3]),false);
 }
 // Nodes are part of the culm profile, with crisp flared node rings and taper.
 const profile=[];const segments=23;
 for(let j=0;j<segments;j++){const y=j/segments,rad=.09*(1-y*.42);profile.push(new T.Vector2(rad,y),new T.Vector2(rad*1.16,y+.0035),new T.Vector2(rad*.94,y+.009),new T.Vector2(rad*.97,(j+1)/segments-.002));}
 profile.push(new T.Vector2(.045,1));
 const bambooGeometry=b.own(new T.LatheGeometry(profile,10)),transforms=[],colors=[],leafPoints=[],o=new T.Object3D();
 // 468 dense Moso bamboo culms: rich corridor flanks + thick rear grove wall so zero horizon sky leaks through.
 for(let j=0;j<468;j++){
  const rear=j>=326;
  const z=rear?-10.55-Math.pow(r(),.85)*3.55:-7.65+r()*21.6,side=j%2?1:-1;
  const x=rear?-11.8+r()*23.6:center(z)+side*(2.15+Math.pow(r(),1.12)*9.2);
  if(Math.abs(x)>11.95||inOpening(x,z))continue;
  const grove=.5+.5*Math.sin(z*.69+side*2.1),girth=.54+r()*.62+grove*.18;
  const h=9.2+girth*2.5+r()*3.8,tilt=(r()-.5)*.075;
  const baseY=bankY(x,z)-.06;
  o.position.set(x,baseY,z);o.rotation.set((r()-.5)*.055,r()*6.28,tilt);o.scale.set(girth,h,girth);o.updateMatrix();transforms.push(o.matrix.clone());
  const shadeFactor=rear||Math.abs(x-center(z))>6.5?.88:1;
  colors.push(new T.Color().setHSL(.24+r()*.065,.20+r()*.16,(.29+r()*.19)*shadeFactor));
  const branchTiers=rear||Math.abs(x-center(z))>5.8?3:2;
  for(let k=0;k<branchTiers;k++){
   const localY=branchTiers===3?(.36+k*.22):(.68+k*.17);
   const start=new T.Vector3(0,localY,0).applyMatrix4(o.matrix),a=r()*6.28,end=[start.x+Math.cos(a)*.92,start.y+.65,start.z+Math.sin(a)*.92];
   twig(start.toArray(),end,.012);
   const cnt=branchTiers===3&&k===0?44:36;
   for(let n=0;n<cnt;n++)leafPoints.push({x:end[0]+(r()-.5)*1.75,y:end[1]+(r()-.5)*.78,z:end[2]+(r()-.5)*1.4,center:end,size:.24+r()*.17,hue:.235+r()*.055});
  }
  const top=new T.Vector3(0,1,0).applyMatrix4(o.matrix).toArray();
  for(let n=0;n<22;n++)leafPoints.push({x:top[0]+(r()-.5)*1.5,y:top[1]+(r()-.5)*.65,z:top[2]+(r()-.5)*1.5,center:top,size:.24+r()*.15});
 }
 const stems=new T.InstancedMesh(bambooGeometry,culm,transforms.length);stems.name='bamboo:segmented-culms';transforms.forEach((m,i)=>{stems.setMatrixAt(i,m);stems.setColorAt(i,colors[i]);});stems.castShadow=true;stems.receiveShadow=true;stems.computeBoundingSphere();b.instances.push(stems);b.root.add(stems);
 // Branches grow from actual culm nodes, sweep upward and taper into a cathedral arch overhead.
 const nearPath=transforms.filter(m=>{const p=new T.Vector3().setFromMatrixPosition(m);return Math.abs(p.x-center(p.z))<3.6&&p.z>-8;});
 for(const matrix of nearPath.filter((_,i)=>i%2===0)){
  const start=new T.Vector3(0,.68,0).applyMatrix4(matrix),z=start.z;
  const end=[T.MathUtils.lerp(start.x,center(z),.56),start.y+.88,z+.32];twig(start.toArray(),end,.016);
  for(let k=0;k<168;k++)leafPoints.push({x:end[0]+(r()-.5)*2.4,y:end[1]+(r()-.5)*.72,z:end[2]+(r()-.5)*1.9,center:end,size:.26+r()*.17,hue:.235+r()*.05});
 }
 b.leaves(leafPoints.filter(p=>!inOpening(p.x,p.z)),{narrow:true,name:'bamboo:leaf-sprays',color:'#7aa066'});
 // Authentic Arashiyama Kuroki-gaki woven brushwood fence with horizontal split-bamboo rails and black shuronawa rope knots.
 const rock=b.own(new T.DodecahedronGeometry(.14,0));
 for(let side of [-1,1]){
  for(let j=0;j<73;j++){
   const z=13.9-j*.3,x=center(z)+side*1.88,nextZ=z-.3,nx=center(nextZ)+side*1.88;
   for(const y of [.64,1.34])b.tube([x,y,z],[nx,y,nextZ],.042,fence);
   if(j%4===0){
    b.tube([x,.2,z],[x,1.58,z],.062,fence);
    for(const ky of [.64,1.34])b.box([x,ky,z],[.14,.065,.14],rope);
   }
   b.mesh(rock,stone,[x-side*.10,.24,z],[.85+r()*.5,.48,.9+r()*.6]);
   for(let k=0;k<11;k++){
    const tz=z-k*.027,tx=center(tz)+side*1.96,h=1.45+r()*.42;
    b.tube([tx,.2,tz],[tx+(r()-.5)*.14,h,tz+(r()-.5)*.12],.014,brush);
    if(k%3===0)b.tube([tx,.85,tz],[tx+side*.10,h+.18,tz+.14],.008,brush);
   }
  }
 }
 // T junction: mossy retaining stones, dense rear brush fence & dark woodland camellia/bamboo hedge wall behind it.
 for(let i=0;i<64;i++){const x=-12.2+i*.39;b.mesh(rock,stone,[x,.46,-10.22],[1.65,1.85+r(),1.85]);}
 for(let i=0;i<720;i++){const x=-12.2+i*.034;b.tube([x,.55,-10.5],[x+(r()-.5)*.14,1.72+r()*.45,-10.5+(r()-.5)*.18],.014,brush);}
 for(const y of [.84,1.52])b.tube([-12.2,y,-10.44],[12.2,y,-10.44],.045,fence);
 for(let x=-11.5;x<=11.5;x+=1.8){
  b.tube([x,.45,-10.44],[x,1.82,-10.44],.062,fence);
  for(const ky of [.84,1.52])b.box([x,ky,-10.44],[.14,.065,.14],rope);
 }
 // Lush Japanese woodland ferns (radiating rosettes) & mossy groundcover along both banks.
 const undergrowth=[];
 for(let i=0;i<160;i++){
  const z=-7.4+r()*21.2,side=i%2?1:-1,x=center(z)+side*(2.15+r()*4.2);
  if(Math.abs(x)>11.8)continue;
  const base=bankY(x,z);
  for(let f=0;f<8;f++){const a=f*2.399+r()*.4;for(let k=1;k<=4;k++)undergrowth.push({x:x+Math.cos(a)*k*.055,y:base+.04+Math.sin(k/5*Math.PI)*.28,z:z+Math.sin(a)*k*.055,rx:Math.PI*.34,ry:a,rz:a,size:.065+k*.008,hue:.235+r()*.04});}
 }
 for(let i=0;i<3600;i++){
  const z=-7.4+r()*21.2,x=center(z)+(i%2?1:-1)*(2.1+r()*3.4);
  if(Math.abs(x)>11.8)continue;
  undergrowth.push({x,y:bankY(x,z)+.08+r()*.26,z,size:.085+r()*.085,hue:.22+r()*.055});
 }
 b.leaves(undergrowth,{narrow:true,name:'ground:fern-leaves',color:'#5b7644'});
 // Fine fallen bamboo leaves and irregular moss stones soften the aggregate verge.
 const litter=[];for(let i=0;i<2800;i++){const z=-7.8+r()*21.6,x=center(z)+(i%2?1:-1)*(1.42+r()*.36);litter.push({x,y:.254+r()*.007,z,size:.055+r()*.09,rx:Math.PI/2,ry:0,rz:r()*6.28,hue:.108+r()*.038});}
 b.leaves(litter,{narrow:true,name:'ground:fallen-bamboo-leaves',color:'#b8a276'}).material.userData.windUniforms.uWindStrength.value=0;
 for(let i=0;i<56;i++){const z=-7+r()*20.5,x=center(z)+(i%2?1:-1)*(2.35+r()*3.8);if(Math.abs(x)<11.8)b.mesh(rock,stone,[x,bankY(x,z)+.12,z],[1.8+r()*2.2,1.0+r()*1.1,1.8+r()*1.5]);}
 // Deep woodland shade shrubs & evergreen screen behind the rear fence and outer flanks so zero sky leaks at eye level.
 const shadeWall=[];
 for(let i=0;i<4400;i++){
  const rear=i<2800;
  const x=rear?-12.0+r()*24.0:(i%2?1:-1)*(7.4+r()*4.5);
  const z=rear?-10.75-r()*3.3:-7.2+r()*21.0;
  const base=bankY(x,z);
  shadeWall.push({x,y:base+.2+r()*3.6,z,size:.24+r()*.28,hue:.25+r()*.06,center:[x,base+2.0,z]});
 }
 b.leaves(shadeWall,{name:'foliage:arashiyama-shade-understory',color:'#425f37'});
 for(const [x,z,w,h] of [[-9.6,-12.2,4.4,2.8],[-4.8,-12.0,4.8,2.6],[.2,-12.2,5.0,2.8],[5.2,-12.0,4.8,2.7],[9.8,-12.2,4.4,2.8]])b.shrubs(x,z,w,2.2,h);
 // Broadleaf hillside trees behind the rear T-junction close the vanishing point in dappled green shade.
 for(const [tx,tz,th,ts] of [[-8.6,-11.5,7.4,1.9],[-4.0,-12.4,6.4,1.8],[.1,-12.8,6.8,1.9],[4.2,-12.3,6.5,1.8],[8.8,-11.4,7.6,1.9]])b.tree(tx,tz,th,ts);
 const lampHousing=b.mat('metal:path-lamp','#303730',{metalness:.22});
 for(let i=0;i<6;i++){const z=10-i*3.5,x=center(z)+(i%2?1:-1)*1.72;
  b.box([x,.43,z],[.22,.37,.22],lampHousing);b.box([x,.65,z],[.32,.06,.32],lampHousing);
  b.lamp([x,.59,z],{color:'#ffd9a1',intensity:6,range:3.8,radius:.11});b.lamps[b.lamps.length-1].day=0;
 }
 const setSunlight=canopyRays(b,{centers:apertures,onPath:(x,z)=>z> -8&&z<11.7&&Math.abs(x-center(z))<1.47});
 const api=b.finish({w:25,d:29,photo:{position:[0,2.3,15.2],target:[-.3,2.6,-7],fov:52},companion:{position:[.55,2.6,14.2],target:[-.15,2.75,-5.8],fov:48},overview:[.72,.80,1.48],background:'#5a6d56'});
 api.setSunlight=setSunlight;
 api.setWind=bambooSway(b,api.root);
 api.lightResponse={sun:.82,ambient:.78,environment:.36};
 api.fidelityDifferences=['Arashiyama-inspired miniature; photographed path and brush fence, not a surveyed map.'];return api;
}
