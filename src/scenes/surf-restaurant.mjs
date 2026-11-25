import * as T from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

const seeded=seed=>()=>{seed=(Math.imul(seed,1664525)+1013904223)|0;return (seed>>>0)/4294967296;};

// Architectural companion compound for THE SURF OCEAN TERRACE (Chiba Inage
// Seaside Park):
//  - Main Wedding Hall & 26-step stairs sit at x ∈ [-5.4, 5.4], z ∈ [-8, +8.6]
//  - Restaurant Building sits on the -X side (x ∈ [-34.2, -20.2]), oriented
//    facing +Z toward the front/viewer:
//      • Main 2-story white ribbed block & corrugated roof at z ∈ [-14.2, -2.8]
//      • 2F Open-Air Ocean Terrace (dark steel pergola, glass railings, 4 woven
//        rattan sofa sets, cycad planters) + 1F dark-wood CAFE & DELI facade
//        projecting forward at z ∈ [-2.8, +4.8] facing +Z
//  - 1F Outdoor Lawn Milk-Tea Lounge (3 parallel dark-rattan sofa sets enclosed
//    by coastal hedges) sits directly in FRONT (+Z) of the left restaurant at
//    x ∈ [-35.2, -19.2], z ∈ [+8.8, +16.0]
export function addSurfRestaurantCompound(root){
 const group=new T.Group();
 group.name='wedding:surf-restaurant-compound';
 const geometries=new Set(),materials=new Set(),textures=new Set(),instances=new Set();
 const ownG=g=>(geometries.add(g),g);
 const ownM=m=>(materials.add(m),m);
 const ownT=t=>(textures.add(t),t);
 const rng=seeded(20250806);

 function canvasTex(name,w,h,draw,{repeat=[1,1]}={}){
  const c=document.createElement('canvas');c.width=w;c.height=h;
  draw(c.getContext('2d'),w,h);
  const tex=new T.CanvasTexture(c);
  tex.name=name;tex.colorSpace=T.SRGBColorSpace;
  tex.wrapS=tex.wrapT=T.RepeatWrapping;tex.repeat.set(repeat[0],repeat[1]);
  tex.anisotropy=4;tex.needsUpdate=true;
  return ownT(tex);
 }

 // Procedural architectural textures matching the real photographs.
 const ribbedWhiteTex=canvasTex('surf:ribbed-white',256,256,(ctx,w,h)=>{
  ctx.fillStyle='#ede9e0';ctx.fillRect(0,0,w,h);
  for(let y=0;y<h;y+=8){
   ctx.fillStyle='rgba(120,114,104,0.16)';ctx.fillRect(0,y,w,2);
   ctx.fillStyle='rgba(255,254,248,0.22)';ctx.fillRect(0,y+2,w,1.5);
  }
 },{repeat:[4,3]});

 const darkTimberTex=canvasTex('surf:dark-timber',256,256,(ctx,w,h)=>{
  ctx.fillStyle='#4e3a2e';ctx.fillRect(0,0,w,h);
  for(let y=0;y<h;y+=24){
   const shade=(rng()-.5)*14;
   ctx.fillStyle=`rgb(${78+shade},${58+shade*.8},${46+shade*.6})`;
   ctx.fillRect(0,y+1,w,22);
   ctx.fillStyle='rgba(20,13,9,0.52)';ctx.fillRect(0,y,w,2);
  }
 },{repeat:[3,2]});

 const plankDeckTex=canvasTex('surf:terrace-planks',256,256,(ctx,w,h)=>{
  ctx.fillStyle='#d8cebc';ctx.fillRect(0,0,w,h);
  const cols=8,cw=w/cols;
  for(let i=0;i<cols;i++){
   const d=(rng()-.5)*12;
   ctx.fillStyle=`rgb(${216+d},${205+d},${187+d})`;
   ctx.fillRect(i*cw+1,0,cw-2,h);
   ctx.fillStyle='rgba(110,98,82,0.34)';ctx.fillRect(i*cw,0,1.6,h);
  }
  for(let y=64;y<h;y+=96){ctx.fillStyle='rgba(110,98,82,0.24)';ctx.fillRect(0,y,w,1.4);}
 },{repeat:[4,3]});

 const wickerTex=canvasTex('surf:woven-rattan',128,128,(ctx,w,h)=>{
  ctx.fillStyle='#7e7366';ctx.fillRect(0,0,w,h);
  for(let y=0;y<h;y+=8)for(let x=0;x<w;x+=16){
   const off=(y/8)%2?8:0;
   ctx.fillStyle='rgba(218,208,194,0.22)';ctx.fillRect((x+off)%w,y,10,5);
   ctx.fillStyle='rgba(44,36,28,0.26)';ctx.fillRect((x+off+10)%w,y+4,6,4);
  }
 },{repeat:[3,2]});

 const darkWickerTex=canvasTex('surf:dark-rattan',128,128,(ctx,w,h)=>{
  ctx.fillStyle='#524136';ctx.fillRect(0,0,w,h);
  for(let y=0;y<h;y+=8)for(let x=0;x<w;x+=16){
   const off=(y/8)%2?8:0;
   ctx.fillStyle='rgba(145,120,98,0.22)';ctx.fillRect((x+off)%w,y,10,5);
   ctx.fillStyle='rgba(24,18,14,0.32)';ctx.fillRect((x+off+10)%w,y+4,6,4);
  }
 },{repeat:[3,2]});

 const roofMetalTex=canvasTex('surf:corrugated-roof',256,256,(ctx,w,h)=>{
  ctx.fillStyle='#d2d5d2';ctx.fillRect(0,0,w,h);
  for(let x=0;x<w;x+=16){
   ctx.fillStyle='rgba(90,96,98,0.24)';ctx.fillRect(x,0,2.5,h);
   ctx.fillStyle='rgba(255,255,255,0.22)';ctx.fillRect(x+3,0,2,h);
  }
 },{repeat:[5,4]});

 const signCafeTex=canvasTex('surf:cafe-deli-sign',1024,256,(ctx,w,h)=>{
  ctx.fillStyle='#89cde6';ctx.fillRect(0,0,w,h);
  ctx.fillStyle='rgba(255,255,255,0.16)';ctx.fillRect(0,0,w,10);
  ctx.fillStyle='#244b5e';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.font='600 66px "Segoe UI", sans-serif';ctx.fillText('THE SURF',w/2,h*.36);
  ctx.font='500 28px "Segoe UI", sans-serif';ctx.fillText('OCEAN TERRACE   CAFE & DELI',w/2,h*.69);
 });

 const lacePanelTex=canvasTex('surf:lace-panel',512,512,(ctx,w,h)=>{
  ctx.fillStyle='#f0ece2';ctx.fillRect(0,0,w,h);
  const drawBurst=(cx,cy,rad)=>{
   ctx.strokeStyle='#8e8c84';ctx.lineWidth=2.6;
   for(let i=0;i<24;i++){
    const a=i/24*Math.PI*2;
    ctx.beginPath();ctx.moveTo(cx+Math.cos(a)*rad*.18,cy+Math.sin(a)*rad*.18);
    ctx.lineTo(cx+Math.cos(a)*rad,cy+Math.sin(a)*rad);ctx.stroke();
   }
   ctx.beginPath();ctx.arc(cx,cy,rad*.55,0,Math.PI*2);ctx.stroke();
  };
  drawBurst(w*.34,h*.38,w*.22);drawBurst(w*.68,h*.68,w*.17);
 });

 // Materials (matte architecture, crisp metal/glass accents).
 const mat=(name,color,{env=.2,...opts}={})=>{
  const m=new T.MeshStandardMaterial({color,roughness:.88,metalness:0,envMapIntensity:env,...opts});
  m.name=name;m.userData.surfaceFinish={roughness:opts.roughness??.88,metalness:opts.metalness??0,envMapIntensity:env};
  return ownM(m);
 };
 const plinthSide=mat('base:side-ext','#8e8578',{roughness:.96,env:.12});
 const plinthTop=mat('base:top-ext','#b4ab9a',{roughness:1,env:.08});
 const plinthFoot=mat('base:foot-ext','#6f685d',{roughness:1,env:.08});
 const plinthJoint=mat('base:joint-ext','#726b60',{roughness:1,env:.06});
 const lawnMat=mat('garden:surf-lawn-ext','#688449',{roughness:1,env:.04});
 const pavingMat=mat('paving:surf-plaza-ext','#ccc5b7',{roughness:.92,env:.14});
 const asphaltMat=mat('asphalt:surf-walkway','#4c5359',{roughness:.94,env:.12});
 const curbMat=mat('stone:surf-curb','#c5bdb0',{roughness:.92,env:.14});
 const wallWhite=mat('wall:surf-ribbed-white','#ffffff',{map:ribbedWhiteTex,roughness:.86,env:.18});
 const wallWood=mat('wood:surf-dark-cladding','#ffffff',{map:darkTimberTex,roughness:.86,env:.16});
 const trimWhite=mat('trim:surf-white','#f0ece2',{roughness:.82,env:.2});
 const roofMat=mat('roof:surf-corrugated','#ffffff',{map:roofMetalTex,roughness:.74,metalness:.14,env:.28});
 const pergolaSteel=mat('metal:surf-pergola','#322823',{roughness:.52,metalness:.58,env:.36});
 const whiteSteel=mat('paint:surf-white-rail','#e7e5de',{roughness:.56,metalness:.22,env:.26});
 const soffitWood=mat('wood:surf-soffit','#6f503a',{roughness:.84,env:.16});
 const deckMat=mat('wood:surf-2f-deck','#ffffff',{map:plankDeckTex,roughness:.86,env:.16});
 const awningCanvas=mat('fabric:surf-awning','#f0ece0',{roughness:.94,env:.1,side:T.DoubleSide});
 const cafeBlue=mat('sign:surf-cafe-blue','#ffffff',{map:signCafeTex,emissive:'#e8f6ff',emissiveMap:signCafeTex,emissiveIntensity:0,roughness:.64,env:.22});
 const blueFascia=mat('paint:surf-cafe-fascia','#89cde6',{roughness:.68,env:.2});
 const glassDark=mat('glass:surf-restaurant','#3b515c',{transparent:true,opacity:.42,roughness:.12,metalness:.25,depthWrite:false,env:.75,side:T.DoubleSide});
 const glassRail=mat('glass:surf-balustrade','#a9c4cf',{transparent:true,opacity:.24,roughness:.10,metalness:.12,depthWrite:false,env:.7,side:T.DoubleSide});
 const tableGlass=mat('glass:surf-table-top','#c5dce0',{transparent:true,opacity:.48,roughness:.12,metalness:.1,depthWrite:false,env:.65});
 const warmLobby=mat('interior:surf-lobby-glow','#e5c89b',{emissive:'#ffbf72',emissiveIntensity:.16,roughness:.9,env:.1});
 const terraceBulb=mat('lamp:surf-terrace-bulb','#fff1d4',{emissive:'#ffc97c',emissiveIntensity:.06,roughness:.45,env:.15});
 const candleGlow=mat('lamp:surf-table-candle','#ffe9bd',{emissive:'#ffbc62',emissiveIntensity:.08,roughness:.5,env:.12});
 const wickerLight=mat('fabric:surf-rattan-2f','#ffffff',{map:wickerTex,roughness:.92,env:.12});
 const wickerDark=mat('fabric:surf-rattan-1f','#ffffff',{map:darkWickerTex,roughness:.92,env:.12});
 const cushionGrey=mat('fabric:surf-cushion-grey','#96a0a8',{roughness:.95,env:.08});
 const cushionWarm=mat('fabric:surf-cushion-warm','#d5cec2',{roughness:.95,env:.08});
 const planterGrey=mat('stone:surf-planter-grey','#9b988f',{roughness:.92,env:.14});
 const milkTea=mat('interior:milk-tea-drink','#caa177',{roughness:.38,env:.2});
 const cupGlass=mat('glass:iced-tea-cup','#e8f2f4',{transparent:true,opacity:.52,roughness:.14,env:.5});
 const strawDark=mat('paint:cup-straw','#282d31',{roughness:.65,env:.12});
 const laceMat=mat('paint:surf-lace-panel','#ffffff',{map:lacePanelTex,roughness:.84,env:.16});
 const hedgeCore=mat('hedge:surf-core','#476535',{roughness:1,env:.04});
 const leafMat=mat('foliage:surf-compound-leaves','#56763f',{roughness:.92,env:.06,side:T.DoubleSide});
 const palmBark=mat('tree:surf-palm-bark','#766858',{roughness:.96,env:.08});
 const palmCollar=mat('tree:surf-palm-skirt','#8c7859',{roughness:.96,env:.06});
 const palmLeaf=mat('foliage:surf-fan-palm','#4e703c',{roughness:.90,env:.08,side:T.DoubleSide});

 const unitBox=ownG(new T.BoxGeometry(1,1,1));
 const addBox=(parent,sx,sy,sz,x,y,z,m,ry=0,rx=0,rz=0)=>{
  const o=new T.Mesh(unitBox,m);o.scale.set(sx,sy,sz);o.position.set(x,y,z);
  if(ry)o.rotation.y=ry;if(rx)o.rotation.x=rx;if(rz)o.rotation.z=rz;
  o.castShadow=true;o.receiveShadow=true;parent.add(o);return o;
 };

 // 1. Seamless western plinth extension (x: -38.0..-17.8, z: -18..+18)
 // matching the existing 36x36 Base at x = -18 so the combined 56.0x36
 // diorama reads as one balanced, museum-grade architectural block.
 const extW=20.2,extX=-17.8-extW/2,extD=36;
 const baseSlab=new T.Mesh(ownG(new RoundedBoxGeometry(extW,2.3,extD,2,.14)),plinthSide);
 baseSlab.position.set(extX,-1.15,0);baseSlab.castShadow=true;baseSlab.receiveShadow=true;group.add(baseSlab);
 addBox(group,extW-.16,.28,extD-.32,extX,-.12,0,plinthTop);
 addBox(group,extW-.35,.22,extD-.60,extX,-2.1,0,plinthFoot);
 addBox(group,extW-.2,.09,.04,extX,-.18,17.99,plinthJoint);
 addBox(group,extW-.2,.09,.04,extX,-.18,-17.99,plinthJoint);
 addBox(group,.04,.09,extD-.4,-37.99,-.18,0,plinthJoint);
 // Ground surfaces on extension: lush coastal lawn, seaside promenade & plaza walkways.
 addBox(group,20.0,.08,34.4,extX,.04,0,lawnMat);
 // Rear promenade & low seawall along -Z.
 addBox(group,54.0,.09,2.1,-10.0,.055,-16.1,asphaltMat);
 addBox(group,54.0,.42,.28,-10.0,.22,-17.25,curbMat);
 // Crazy-paving patio directly in front of 1F CAFE & DELI (+Z walkway connecting to Wedding plaza).
 addBox(group,20.4,.09,4.8,-26.4,.052,6.8,pavingMat);
 // Crazy-paving connector between Restaurant east wall and Wedding Hall stepped garden.
 addBox(group,4.6,.09,22.0,-18.8,.052,-1.2,pavingMat);
 // Front perimeter apron strip & curbs.
 addBox(group,20.2,.09,1.8,-27.4,.052,16.4,pavingMat);
 // Black asphalt entrance accent strip shown in IMG_165154 & IMG_161629.
 addBox(group,10.5,.095,3.2,-14.8,.056,12.2,asphaltMat);
 addBox(group,19.6,.08,.5,-27.8,.06,17.05,curbMat);
 addBox(group,.5,.08,34.4,-37.3,.06,0,curbMat);

 // 2. Wedding Hall side details seen in IMG_165154 & IMG_180341:
 //    White floral lace-circle panel on left lawn + metal side service stair.
 const laceSign=new T.Mesh(ownG(new T.BoxGeometry(2.2,2.1,.08)),laceMat);
 laceSign.position.set(-5.7,1.12,8.45);laceSign.rotation.y=.12;laceSign.castShadow=true;laceSign.receiveShadow=true;group.add(laceSign);
 // Side metal service stair on -X flank of Wedding Hall (visible in IMG_180341).
 const serviceStair=new T.Group();serviceStair.name='wedding:side-service-stair';
 addBox(serviceStair,.95,.12,1.6,-5.88,4.3,-3.2,whiteSteel);
 addBox(serviceStair,.14,.22,6.4,-5.88,2.2,-6.8,whiteSteel,0,.58);
 for(let i=0;i<14;i++)addBox(serviceStair,.88,.04,.28,-5.88,.3+i*.28,-9.2+i*.39,whiteSteel);
 for(let i=0;i<6;i++)addBox(serviceStair,.04,.95,.04,-6.32,.85+i*.68,-9.0+i*1.05,whiteSteel);
 addBox(serviceStair,.05,.05,6.4,-6.32,2.75,-6.8,whiteSteel,0,.58);
 group.add(serviceStair);

 // 3. ③ RESTAURANT BUILDING (THE SURF OCEAN TERRACE RESTAURANT & CAFE&DELI)
 //    Flipped 180° so the iconic 2F Open-Air Ocean Terrace & 1F CAFE & DELI
 //    face FORWARD (+Z toward the viewer), while the 2-story white block sits at -Z!
 const rest=new T.Group();rest.name='wedding:restaurant-building';group.add(rest);
 const rx=-27.2,rw=14.0,rz=-8.5,rd=11.4,rh=7.6; // Main 2-story building block (back, z ∈ [-14.2, -2.8])
 // Main white ribbed 2-story volume + corrugated silver-grey pitched roof.
 addBox(rest,rw,rh,rd,rx,rh/2,rz,wallWhite);
 addBox(rest,rw+.35,.24,rd+.35,rx,rh+.14,rz,trimWhite);
 const roofSlab=addBox(rest,rw-.2,.16,rd-.2,rx,rh+.32,rz,roofMat,0,-.04);
 roofSlab.castShadow=false;
 // Corrugated roof standing ribs + rooftop service equipment.
 for(let x=rx-rw/2+.9;x<rx+rw/2-.4;x+=1.4)addBox(rest,.06,.12,rd-.5,x,rh+.42,rz,trimWhite);
 addBox(rest,1.5,.68,1.1,rx-2.6,rh+.62,rz-1.5,planterGrey);

 // Rear (-Z) 2-story dark-wood glass atrium lobby (z = -14.28).
 const lobbyX=-23.6,lobbyW=6.4,lobbyZ=rz-rd/2-.08;
 addBox(rest,lobbyW,rh,.24,lobbyX,rh/2,lobbyZ,wallWood);
 addBox(rest,lobbyW-1.2,rh-1.6,.08,lobbyX,rh/2-.1,lobbyZ-.02,warmLobby);
 addBox(rest,lobbyW-1.1,rh-1.5,.05,lobbyX,rh/2-.1,lobbyZ-.12,glassDark);
 for(let c=0;c<=4;c++)addBox(rest,.07,rh-1.45,.12,lobbyX-(lobbyW-1.1)/2+c*(lobbyW-1.1)/4,rh/2-.1,lobbyZ-.14,pergolaSteel);
 for(let r=0;r<=3;r++)addBox(rest,lobbyW-1.1,.07,.12,lobbyX,.65+r*(rh-1.5)/3,lobbyZ-.14,pergolaSteel);
 // Small dark wood pergola entrance arbor beside the rear lobby.
 for(const px of [-19.6,-18.3])for(const pz of [-14.4,-12.8,-11.2])addBox(rest,.12,2.9,.12,px,1.45,pz,pergolaSteel);
 for(let pz=-14.4;pz<=-11.2;pz+=.64)addBox(rest,1.6,.10,.09,-18.95,2.92,pz,pergolaSteel);
 // Upper row of small white wall vents on outer -X wall.
 for(let vz=-12.6;vz<=-5.6;vz+=1.15)addBox(rest,.18,.28,.22,-34.28,6.4,vz,trimWhite);

 // 4. 2F OPEN-AIR OCEAN TERRACE + 1F CAFE & DELI (projecting FORWARD to +Z: x ∈ [-33.5, -20.9], z ∈ [-2.8, +4.8])
 //    Facing straight toward the viewer and the front lawn milk-tea lounge!
 const tX=-27.2,tW=12.6,tZ=1.0,tD=7.6,deckY=3.65;
 // 1F dark horizontal wood base directly beneath the 2F Ocean Terrace.
 addBox(rest,11.6,3.15,tD-.2,tX,1.58,tZ-.05,wallWood);
 addBox(rest,11.8,.55,tD-.05,tX,3.38,tZ-.05,trimWhite);
 // Prominent light-blue "THE SURF OCEAN TERRACE CAFE & DELI" signboard facing FRONT (+Z)!
 addBox(rest,6.6,.94,.18,tX,3.24,tZ+tD/2+.02,blueFascia);
 const signFront=new T.Mesh(ownG(new T.PlaneGeometry(6.4,.88)),cafeBlue);
 signFront.position.set(tX,3.24,tZ+tD/2+.12);rest.add(signFront);
 // Secondary light-blue fascia sign facing Wedding Hall plaza (+X).
 addBox(rest,.16,.92,5.0,tX+5.92,3.24,tZ+.3,blueFascia);
 const signSide=new T.Mesh(ownG(new T.PlaneGeometry(4.8,.86)),cafeBlue);
 signSide.position.set(tX+6.02,3.24,tZ+.3);signSide.rotation.y=Math.PI/2;rest.add(signSide);
 // 1F Front (+Z) CAFE & DELI canopy, takeaway counter window, entrance doors & bistro tables.
 addBox(rest,10.6,.12,1.6,tX,2.76,tZ+tD/2+.72,trimWhite);
 // Takeaway window (left) + glass double entrance doors (right).
 addBox(rest,3.4,1.65,.08,tX-2.8,1.55,tZ+tD/2-.06,warmLobby);
 addBox(rest,3.4,1.65,.06,tX-2.8,1.55,tZ+tD/2-.01,glassDark);
 for(const dx of [-1.7,0,1.7])addBox(rest,.07,2.4,.07,tX-2.8+dx,1.2,tZ+tD/2+.01,pergolaSteel);
 addBox(rest,3.0,2.35,.08,tX+2.4,1.25,tZ+tD/2-.06,warmLobby);
 addBox(rest,3.0,2.35,.06,tX+2.4,1.25,tZ+tD/2-.01,glassDark);
 for(const dx of [-1.5,0,1.5])addBox(rest,.07,2.45,.07,tX+2.4+dx,1.25,tZ+tD/2+.01,pergolaSteel);
 // Two small dark café bistro tables right outside the 1F takeaway window.
 for(const [tx,tz] of [[tX-3.4,tZ+tD/2+1.05],[tX-1.7,tZ+tD/2+1.05]]){
  addBox(rest,.78,.04,.78,tx,.74,tz,pergolaSteel);
  addBox(rest,.06,.72,.06,tx,.36,tz,pergolaSteel);
  for(const s of [-1,1])addBox(rest,.38,.45,.38,tx+s*.52,.24,tz,pergolaSteel);
 }

 // L-shaped dark-brown steel exterior staircase on outer -X flank climbing up to 2F Ocean Terrace.
 const extStair=new T.Group();extStair.name='wedding:restaurant-exterior-stair';rest.add(extStair);
 const midY=1.88;
 addBox(extStair,1.35,.14,1.6,-34.9,midY,2.1,pergolaSteel);
 for(const px of [-35.5,-34.3])addBox(extStair,.10,midY,.10,px,midY/2,2.1,pergolaSteel);
 // Lower flight ascending from front walkway z = +5.2 up to mid-landing z = +2.8.
 for(let i=0;i<9;i++)addBox(extStair,1.25,.05,.26,-34.9,.2+i*(midY/9),5.15-i*.28,pergolaSteel);
 addBox(extStair,.08,.22,2.9,-35.52,midY/2+.1,3.9,pergolaSteel,0,.58);
 // Upper flight ascending from mid-landing z = +1.3 up to 2F deck entry z = -2.2 at y = 3.65.
 for(let i=0;i<10;i++)addBox(extStair,1.25,.05,.28,-34.9,midY+i*((deckY-midY)/10),1.25-i*.34,pergolaSteel);
 addBox(extStair,.08,.22,4.1,-35.52,(midY+deckY)/2+.1,-.5,pergolaSteel,0,.43);
 for(let i=0;i<14;i++){
  const u=i/13,sz=5.1-u*7.3,sy=sz>2.1?(.2+(5.1-sz)/3.0*midY):(midY+(2.1-sz)/4.3*(deckY-midY));
  addBox(extStair,.035,1.02,.035,-35.52,sy+.54,sz,pergolaSteel);
 }
 addBox(extStair,.05,.05,3.1,-35.52,midY/2+1.06,3.8,pergolaSteel,0,.58);
 addBox(extStair,.05,.05,4.2,-35.52,(midY+deckY)/2+1.06,-.5,pergolaSteel,0,.43);

 // 2F Terrace pale timber plank floor slab (y = 3.65m).
 addBox(rest,tW,.14,tD,tX,deckY-.07,tZ,deckMat);
 // 2F Indoor dining room glass sliding doors + warm wooden soffit overhang + 4 white steps facing +Z!
 addBox(rest,11.6,.22,2.1,tX,7.2,-1.85,soffitWood);
 addBox(rest,10.8,2.9,.08,tX,5.45,-2.76,warmLobby);
 addBox(rest,10.8,2.9,.06,tX,5.45,-2.70,glassDark);
 for(let c=0;c<=6;c++)addBox(rest,.07,2.95,.11,tX-5.4+c*1.8,5.45,-2.68,pergolaSteel);
 // 4 short white steps & slender white handrail connecting 2F interior forward onto terrace.
 for(let s=0;s<4;s++)addBox(rest,2.2,.14,.32,-22.4,deckY+.07+s*.14,-1.65-s*.32,trimWhite);
 for(const sx of [-23.45,-21.35]){
  addBox(rest,.04,.95,.04,sx,deckY+.55,-1.50,whiteSteel);
  addBox(rest,.04,.95,.04,sx,deckY+1.05,-2.60,whiteSteel);
  addBox(rest,.04,.04,1.35,sx,deckY+1.25,-2.05,whiteSteel,0,.42);
 }

 // Tall dark-bronze steel pergola frame overhead (facing +Z, fully visible from front!).
 const pH=3.45,pTop=deckY+pH;
 const pXs=[tX-tW/2+.35,tX-.2,tX+tW/2-.35],pZs=[tZ-tD/2+.45,tZ+tD/2-.35];
 for(const px of pXs)for(const pz of pZs)addBox(rest,.16,pH,.16,px,deckY+pH/2,pz,pergolaSteel);
 for(const pz of pZs)addBox(rest,tW-.4,.22,.16,tX,pTop,pz,pergolaSteel);
 for(const px of pXs)addBox(rest,.16,.22,tD-.5,px,pTop,tZ,pergolaSteel);
 for(let gx=tX-tW/2+1.6;gx<tX+tW/2-1.2;gx+=2.4)addBox(rest,.07,.09,tD-.8,gx,pTop-.06,tZ,pergolaSteel);
 addBox(rest,tW-1.0,.18,1.5,tX,pTop-.14,-1.65,awningCanvas);

 // Dark-frame clear glass balustrades enclosing the FRONT (+Z) and both sides of 2F terrace.
 const railH=1.08;
 addBox(rest,tW,.06,.06,tX,deckY+railH,tZ+tD/2-.06,pergolaSteel);
 addBox(rest,tW-.1,railH-.08,.03,tX,deckY+railH/2,tZ+tD/2-.06,glassRail);
 for(let gx=tX-tW/2+.1;gx<=tX+tW/2;gx+=1.55)addBox(rest,.045,railH,.045,gx,deckY+railH/2,tZ+tD/2-.06,pergolaSteel);
 for(const sx of [tX-tW/2+.06,tX+tW/2-.06]){
  addBox(rest,.06,.06,tD,sx,deckY+railH,tZ,pergolaSteel);
  addBox(rest,.03,railH-.08,tD-.1,sx,deckY+railH/2,tZ,glassRail);
  for(let gz=tZ-tD/2+.1;gz<=tZ+tD/2;gz+=1.5)addBox(rest,.045,railH,.045,sx,deckY+railH/2,gz,pergolaSteel);
 }

 // Helper for woven rattan lounge sofa sets (reused on 2F Ocean Terrace & 1F Front Lawn Lounge!).
 const cupGeo=ownG(new T.CylinderGeometry(.044,.033,.13,10));
 const teaGeo=ownG(new T.CylinderGeometry(.040,.030,.10,10));
 const strawGeo=ownG(new T.CylinderGeometry(.0045,.0045,.19,5));
 function addMilkTeas(parent,cx,cy,cz){
  for(const [dx,dz,tilt] of [[-.20,-.04,.09],[.20,.05,-.08]]){
   const drink=new T.Mesh(teaGeo,milkTea);drink.position.set(cx+dx,cy+.055,cz+dz);parent.add(drink);
   const cup=new T.Mesh(cupGeo,cupGlass);cup.position.set(cx+dx,cy+.065,cz+dz);cup.castShadow=true;parent.add(cup);
   const straw=new T.Mesh(strawGeo,strawDark);straw.position.set(cx+dx+.008,cy+.13,cz+dz);straw.rotation.z=tilt;parent.add(straw);
  }
 }
 function addRattanSet(parent,cx,baseY,cz,{dark=false,rotY=0,milkTeaSpot=false,ottomans=true}={}){
  const set=new T.Group();set.position.set(cx,baseY,cz);set.rotation.y=rotY;parent.add(set);
  const wMat=dark?wickerDark:wickerLight,cMat=dark?cushionWarm:cushionGrey;
  for(const side of [-1,1]){
   const sx=side*1.28;
   addBox(set,.78,.34,1.98,sx,.17,0,wMat);
   addBox(set,.14,.64,1.98,sx+side*.32,.34,0,wMat);
   for(const az of [-.92,.92])addBox(set,.78,.54,.14,sx,.27,az,wMat);
   addBox(set,.62,.12,1.72,sx-side*.04,.38,0,cMat);
   addBox(set,.16,.34,1.68,sx+side*.20,.56,0,cMat);
  }
  addBox(set,.72,.34,1.32,0,.17,0,wMat);
  addBox(set,.70,.025,1.30,0,.355,0,tableGlass);
  if(ottomans){
   for(const oz of [-1.25,1.25]){
    addBox(set,.54,.30,.54,0,.15,oz,wMat);
    addBox(set,.52,.10,.52,0,.35,oz,cMat);
   }
  }
  if(milkTeaSpot)addMilkTeas(set,0,.37,0);
 }

 // 4 neat light-rattan sofa sets on the front-facing 2F Open-Air Ocean Terrace.
 addRattanSet(rest,-30.5,deckY,2.8,{dark:false,rotY:0,milkTeaSpot:true,ottomans:false});
 addRattanSet(rest,-24.0,deckY,2.8,{dark:false,rotY:0,milkTeaSpot:false,ottomans:false});
 addRattanSet(rest,-30.5,deckY,-.3,{dark:false,rotY:0,milkTeaSpot:false,ottomans:true});
 addRattanSet(rest,-24.0,deckY,-.3,{dark:false,rotY:0,milkTeaSpot:false,ottomans:true});
 // Rectangular grey stone planters with cycad fronds along terrace edges.
 const leafPositions=[],leafColors=[],leafCenters=[];
 const pushLeaf=(x,y,z,sz,cx,cy,cz,hue=.24)=>{
  const o=new T.Object3D();o.position.set(x,y,z);
  o.rotation.set((rng()-.5)*1.2,rng()*Math.PI*2,(rng()-.5)*1.1);
  o.scale.set(sz,sz*1.45,sz);o.updateMatrix();
  leafPositions.push(o.matrix.clone());
  leafCenters.push(cx,cy,cz);
  leafColors.push(new T.Color().setHSL(hue+rng()*.04,.26+rng()*.16,.24+rng()*.13));
 };
 for(const [px,pz,pw,pd] of [[-30.5,-2.2,1.6,.55],[-26.5,-2.2,1.6,.55],[-32.9,4.2,.6,.6],[-27.2,4.2,.9,.5],[-21.5,4.2,.6,.6]]){
  addBox(rest,pw,.56,pd,px,deckY+.28,pz,planterGrey);
  for(let k=0;k<Math.round(pw*28);k++)pushLeaf(px+(rng()-.5)*(pw-.1),deckY+.65+rng()*.38,pz+(rng()-.5)*(pd-.1),.14+rng()*.12,px,deckY+.82,pz,.26);
 }

 // 5. FRONT 1F OUTDOOR LAWN MILK-TEA LOUNGE (directly in FRONT +Z of the left restaurant!)
 //    3 parallel dark-brown woven rattan sofa sets sitting on a trimmed green lawn
 //    enclosed by coastal hedges right across the front CAFE & DELI walkway.
 const lounge=new T.Group();lounge.name='wedding:milk-tea-lawn-lounge';group.add(lounge);
 addBox(lounge,15.6,.07,6.2,-27.2,.058,12.4,lawnMat);
 const hedgeSpecs=[
  [-35.0,12.4,.90,.84,6.8],  // outer -X hedge
  [-19.4,12.4,.90,.84,6.8],  // inner +X hedge (beside plaza)
  [-27.2,15.5,16.2,.84,.90], // front +Z hedge border
 ];
 for(const [hx,hz,hw,hh,hd] of hedgeSpecs){
  addBox(lounge,hw,hh*.82,hd,hx,hh*.41,hz,hedgeCore);
  const cnt=Math.round((hw+hd)*26);
  for(let k=0;k<cnt;k++){
   pushLeaf(hx+(rng()-.5)*hw,hh*(.32+rng()*.72),hz+(rng()-.5)*hd,.12+rng()*.11,hx,hh*.6,hz,.24);
  }
 }
 // 3 parallel dark-brown rattan lounge sofa sets lined up in front of the left restaurant
 // (center set holds Yukino & Hachiman's two iced milk teas!).
 for(const [i,lx] of [-31.8,-27.2,-22.6].entries()){
  addRattanSet(lounge,lx,.095,12.1,{dark:true,rotY:0,milkTeaSpot:i===1,ottomans:false});
 }

 // Flush instanced shrub/hedge/cycad leaf mesh.
 if(leafPositions.length){
  const lGeo=ownG(new T.BufferGeometry());
  lGeo.setAttribute('position',new T.Float32BufferAttribute([0,-.42,0,-.24,0,0,0,.52,.06,.24,0,0,0,0,.10],3));
  lGeo.setIndex([0,1,4,1,2,4,2,3,4,3,0,4]);lGeo.computeVertexNormals();
  lGeo.setAttribute('crownCenter',new T.InstancedBufferAttribute(new Float32Array(leafCenters),3));
  const lMesh=new T.InstancedMesh(lGeo,leafMat,leafPositions.length);
  lMesh.name='wedding:compound-greenery';
  leafPositions.forEach((m,i)=>{lMesh.setMatrixAt(i,m);lMesh.setColorAt(i,leafColors[i]);});
  lMesh.castShadow=true;lMesh.receiveShadow=true;lMesh.computeBoundingSphere();
  instances.add(lMesh);group.add(lMesh);
 }

 // 6. Authentic Tall Washingtonia Fan Palms (ワシントンヤシ) framing the 2F Ocean Terrace & plazas!
 const frondGeo=ownG(new T.BufferGeometry());
 const fp=[],fi=[];
 for(let s=0;s<=6;s++){
  const t=s/6,z=t*2.25,y=Math.sin(t*Math.PI*.74)*.44-t*t*.56,w=Math.sin(Math.PI*Math.pow(t,.68))*.38;
  fp.push(-w,y-.06,z, 0,y,z, w,y-.06,z);
  if(s<6){const a=s*3;fi.push(a,a+1,a+3,a+1,a+4,a+3, a+1,a+2,a+4,a+2,a+5,a+4);}
 }
 frondGeo.setAttribute('position',new T.Float32BufferAttribute(fp,3));
 frondGeo.setIndex(fi);frondGeo.computeVertexNormals();
 const palmSpecs=[
  [-36.2,6.2,8.2,-.12,1],   // Tall front-left palm framing 2F Ocean Terrace
  [-36.0,-4.2,7.2,.10,2],   // Outer left palm beside restaurant flank
  [-18.6,6.6,7.6,.12,3],    // Palm framing right corner of 2F Terrace & plaza
  [-18.4,-8.5,7.8,-.10,4],  // Rear palm between Wedding Hall & Restaurant
  [-24.2,-15.2,7.4,.08,5],  // Rear seaward palm behind Restaurant
  [-8.6,12.8,7.2,.11,6],    // Hero foreground plaza palm
  [6.4,-1.4,6.4,-.08,7],    // Palm flanking right Banquet Wing
  [10.2,1.6,5.8,.09,8],     // Second right palm
 ];
 const pMatrices=[],pColors=[],pCenters=[],pObj=new T.Object3D();
 for(const [px,pz,ph,lean,seed] of palmSpecs){
  const segs=8;
  for(let s=0;s<segs;s++){
   const t0=s/segs,t1=(s+1)/segs,y0=.08+t0*ph,y1=.08+t1*ph;
   const x0=px+lean*t0*t0*1.4,x1=px+lean*t1*t1*1.4;
   const seg=new T.Mesh(ownG(new T.CylinderGeometry(.17-t1*.045,.19-t0*.045,Math.hypot(x1-x0,y1-y0)+.05,8)),palmBark);
   seg.position.set((x0+x1)/2,(y0+y1)/2,pz);seg.rotation.z=-Math.atan2(x1-x0,y1-y0);
   seg.castShadow=true;seg.receiveShadow=true;group.add(seg);
  }
  const crownX=px+lean*1.4,crownY=.08+ph;
  // Characteristic dry-frond skirt collar below the green fan crown (IMG_161436, 165154).
  const skirt=new T.Mesh(ownG(new T.CylinderGeometry(.26,.34,.75,8)),palmCollar);
  skirt.position.set(crownX,crownY-.36,pz);skirt.castShadow=true;group.add(skirt);
  const fronds=18;
  for(let f=0;f<fronds;f++){
   const a=f/fronds*Math.PI*2+seed*.7+(rng()-.5)*.22,tier=f%3;
   const pitch=-.34+tier*.28+(rng()-.5)*.12;
   pObj.position.set(crownX,crownY-.08+tier*.12,pz);
   pObj.rotation.set(pitch,a,(rng()-.5)*.2,'YXZ');
   const sc=.86+rng()*.32;pObj.scale.set(sc,sc,sc);pObj.updateMatrix();
   pMatrices.push(pObj.matrix.clone());
   pCenters.push(crownX,crownY+.35,pz);
   pColors.push(new T.Color().setHSL(.25+rng()*.04,.28+rng()*.14,.28+tier*.07+rng()*.05));
  }
 }
 frondGeo.setAttribute('crownCenter',new T.InstancedBufferAttribute(new Float32Array(pCenters),3));
 const palmMesh=new T.InstancedMesh(frondGeo,palmLeaf,pMatrices.length);
 palmMesh.name='wedding:coastal-fan-palms';
 pMatrices.forEach((m,i)=>{palmMesh.setMatrixAt(i,m);palmMesh.setColorAt(i,pColors[i]);});
 palmMesh.castShadow=true;palmMesh.receiveShadow=true;palmMesh.computeBoundingSphere();
 instances.add(palmMesh);group.add(palmMesh);

 // Batch static non-instanced boxes/cylinders by material to keep draw calls low.
 // 7. Warm dusk & night architectural lighting for the Restaurant, 2F Ocean Terrace,
 //    1F CAFE & DELI canopy, exterior stair, and front lawn milk-tea lounge.
 const practicals=[];
 const addLampLight=(x,y,z,color,duskI,nightI,distance=14)=>{
  const pl=new T.PointLight(color,0,distance,2);
  pl.position.set(x,y,z);group.add(pl);
  practicals.push({light:pl,dusk:duskI,night:nightI});
 };
 const bulbGeo=ownG(new T.SphereGeometry(.072,8,6));
 const lanternGeo=ownG(new T.CylinderGeometry(.065,.075,.16,10));
 // 2F Wooden soffit recessed downlights + pergola column spotlights + festoon string bulbs.
 for(const lx of [-31.8,-29.5,-27.2,-24.9,-22.6]){
  addBox(rest,.18,.04,.18,lx,7.08,-1.75,terraceBulb);
 }
 for(const px of pXs)for(const pz of pZs){
  // Twin dark steel column spotlights (matching real dusk photo of 2F terrace).
  addBox(rest,.11,.22,.16,px+(px<tX?.12:-.12),deckY+2.42,pz+(pz<tZ?.10:-.10),pergolaSteel,0,.35);
  addBox(rest,.08,.07,.08,px+(px<tX?.12:-.12),deckY+2.32,pz+(pz<tZ?.14:-.14),terraceBulb);
 }
 // Warm resort string-light bulbs along the front & mid overhead pergola beams.
 for(const bz of [tZ+tD/2-.42,tZ+.2]){
  for(let bx=tX-tW/2+1.1;bx<=tX+tW/2-1.0;bx+=1.55){
   const bMesh=new T.Mesh(bulbGeo,terraceBulb);
   bMesh.position.set(bx,pTop-.18,bz);group.add(bMesh);
  }
 }
 // 1F CAFE & DELI white canopy recessed downlights + exterior stair sconce.
 for(const lx of [-31.4,-28.6,-25.8,-23.0])addBox(rest,.18,.04,.18,lx,2.69,tZ+tD/2+.72,terraceBulb);
 addBox(rest,.10,.30,.14,-34.26,3.02,2.1,pergolaSteel);
 addBox(rest,.06,.20,.10,-34.31,3.02,2.1,terraceBulb);
 // Front lawn milk-tea lounge: 4 low garden bollards along the walkway + 3 tabletop candle lanterns.
 for(const bx of [-34.0,-29.5,-24.9,-20.4]){
  addBox(lounge,.14,.58,.14,bx,.32,9.08,pergolaSteel);
  addBox(lounge,.12,.14,.12,bx,.54,9.08,terraceBulb);
  addBox(lounge,.16,.04,.16,bx,.63,9.08,pergolaSteel);
 }
 for(const [i,lx] of [-31.8,-27.2,-22.6].entries()){
  const cx=lx+(i===1?.0:.0),cz=12.1+(i===1?-.38:0);
  const cMesh=new T.Mesh(lanternGeo,candleGlow);
  cMesh.position.set(cx,.54,cz);group.add(cMesh);
  addBox(lounge,.16,.03,.16,cx,.46,cz,pergolaSteel);
  addBox(lounge,.15,.03,.15,cx,.63,cz,pergolaSteel);
 }
 // Balanced warm PointLights illuminating 2F terrace deck, 2F indoor dining glass,
 // 1F CAFE & DELI facade/walkway, exterior stair, and front milk-tea lawn lounge.
 addLampLight(-30.2,6.2,1.6,'#ffd091',11,22,15);   // 2F Terrace left pergola glow
 addLampLight(-24.2,6.2,1.6,'#ffd091',11,22,15);   // 2F Terrace right pergola glow
 addLampLight(-27.2,5.4,-2.1,'#ffc67d',7,14,12);   // 2F Dining room doorway spill
 addLampLight(-29.2,2.5,5.8,'#ffd49b',9,18,13);    // 1F CAFE & DELI takeaway & sign wash
 addLampLight(-24.6,2.5,5.8,'#ffd49b',9,18,13);    // 1F CAFE entrance doors & walkway
 addLampLight(-34.9,3.0,2.2,'#ffcf8e',5,10,9);     // Exterior steel staircase glow
 addLampLight(-27.2,2.1,11.6,'#ffd194',9,18,15);   // Front lawn milk-tea lounge glow
 addLampLight(-23.6,3.8,-14.8,'#ffc882',6,12,11);  // Rear glass atrium lobby glow

 const setLighting=preset=>{
  const night=preset==='night',dusk=preset==='dusk';
  warmLobby.emissiveIntensity=night?2.1:dusk?1.05:.14;
  terraceBulb.emissiveIntensity=night?3.6:dusk?1.8:.05;
  candleGlow.emissiveIntensity=night?3.2:dusk?1.7:.06;
  cafeBlue.emissiveIntensity=night?.78:dusk?.36:0;
  for(const p of practicals)p.light.intensity=night?p.night:dusk?p.dusk:0;
 };
 setLighting('day');

 group.updateMatrixWorld(true);
 const batches=new Map();
 group.traverse(o=>{
  if(o.isMesh&&!o.isInstancedMesh&&o.geometry!==unitBox.parent&&o.material!==cafeBlue&&o.material!==laceMat){
   const list=batches.get(o.material)||[];list.push(o);batches.set(o.material,list);
  }
 });
 for(const [material,meshes] of batches){
  if(meshes.length<2)continue;
  const copies=meshes.map(m=>m.geometry.clone().applyMatrix4(m.matrixWorld));
  const merged=mergeGeometries(copies,false);
  copies.forEach(g=>g.dispose());
  if(!merged)continue;
  const batched=new T.Mesh(ownG(merged),material);
  batched.name=`surf-compound:${material.name}`;
  batched.castShadow=meshes.some(m=>m.castShadow);
  batched.receiveShadow=meshes.some(m=>m.receiveShadow);
  meshes.forEach(m=>m.removeFromParent());
  group.add(batched);
 }
 root.add(group);
 return {
  group,
  setLighting,
  dispose(){
   group.removeFromParent();
   for(const i of instances)i.dispose();
   for(const g of geometries)g.dispose();
   for(const m of materials)m.dispose();
   for(const t of textures)t.dispose();
  }
 };
}
