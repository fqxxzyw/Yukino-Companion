import * as T from 'three';
import {Diorama} from './diorama-kit.mjs';
import {architectureFinish} from './architecture-textures.mjs';

// A composed miniature: Kiyomizu west gate and its separate three-storey pagoda,
// joined to a winding Inari torii walk. These landmarks are not adjacent in reality.
export function createScene({scene,renderer}){
 const b=new Diorama(scene,renderer,'Kyoto_West_Gate_Pagoda_and_Torii');b.plinth(28,27,'#54594d');
 const red=b.mat('wood:vermilion-timber','#af4934'),black=b.mat('wood:black-post-foot','#292e2d'),wood=b.mat('wood:aged-structure','#6b4c36');
 const stone=b.mat('stone:terrace','#8c9185'),paving=b.mat('paving:temple-path','#aaa99a'),roof=b.mat('stone:ceramic-roof','#344145'),tile=b.mat('stone:tile-ridges','#4c5a5c'),gold=b.mat('paint:ochre-trim','#b6a075'),green=b.mat('paint:bracket-inlay','#4c7770'),soil=b.mat('soil:moss-ground','#656f50');
 for(const [m,rough,env]of [[red,.86,.24],[black,.89,.17],[wood,.94,.17],[stone,.96,.15],[paving,.94,.18],[roof,.79,.26],[tile,.83,.23],[gold,.77,.28],[soil,1,.1]])m.userData.surfaceFinish={roughness:rough,metalness:0,envMapIntensity:env};
 for(const m of [red,black,wood])architectureFinish(b,m,'wood',{scale:2.2});
 architectureFinish(b,stone,'stone',{scale:2.8,amount:.42});
 b.box([0,.11,0],[27.7,.2,26.7],soil);
 b.box([-3.7,.22,10.65],[14,.05,3.5],paving);
 for(let i=0;i<30;i++){const x=-10.8+i*.47;b.box([x,.26,8.82],[.43,.16,.18],stone);}
 const curve=(pts,r,m)=>b.mesh(b.own(new T.TubeGeometry(new T.CatmullRomCurve3(pts.map(p=>new T.Vector3(...p))),Math.max(12,pts.length*2),r,6,false)),m);
 // Continuous double-skin roofs: concave slopes, lifted corners, thick eaves,
 // real tile ribs, round end caps and visible supporting rafter ends.
 const roofAt=(x,y,z,w,d,rise)=>{
  const nx=40,nz=28,ridge=Math.max(.2,(w-d)*.5),height=(a,c)=>{
   const q=Math.min(1,Math.max(Math.abs(c)/(d/2),Math.max(0,Math.abs(a)-ridge)/(d/2)));
   return y+rise*Math.pow(1-q,1.65)+.32*Math.pow(Math.abs(a)/(w/2),6)*Math.pow(Math.abs(c)/(d/2),3);
  };
  for(const offset of [0,-.15]){
   const pos=[],uv=[],ids=[];
   for(let j=0;j<=nz;j++)for(let i=0;i<=nx;i++){const a=(i/nx-.5)*w,c=(j/nz-.5)*d;pos.push(x+a,height(a,c)+offset,z+c);uv.push(i/nx,j/nz);}
   for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){const a=j*(nx+1)+i;ids.push(...(offset===0?[a,a+nx+1,a+1,a+1,a+nx+1,a+nx+2]:[a,a+1,a+nx+1,a+1,a+nx+2,a+nx+1]));}
   const g=b.own(new T.BufferGeometry());g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(ids);g.computeVertexNormals();b.mesh(g,offset===0?roof:wood);
  }
  for(const side of [-1,1]){
   const edge=[];for(let i=0;i<=24;i++){const a=(i/24-.5)*w;edge.push([x+a,height(a,side*d/2)-.05,z+side*d/2]);}curve(edge,.105,black);
   for(let a=-w/2+.13;a<w/2;a+=.21){
    const pts=[];for(let j=0;j<=10;j++){const c=side*d/2*(1-j/10);pts.push([x+a,height(a,c)+.023,z+c]);}curve(pts,.032,tile);
    const cap=b.cylinderAt([x+a,height(a,side*d/2)+.02,z+side*(d/2+.015)],.055,.055,tile);cap.rotation.x=Math.PI/2;
    b.box([x+a,height(a,side*d/2)-.19,z+side*(d/2-.13)],[.075,.09,.32],gold);
   }
  }
  b.box([x,y+rise+.12,z],[ridge*2+.6,.25,.26],roof);
  for(const s of [-1,1])curve([[x+s*(ridge+.15),y+rise+.15,z],[x+s*(ridge+.4),y+rise+.23,z],[x+s*(ridge+.55),y+rise+.55,z]],.085,roof);
 };
 const bracket=(x,y,z)=>{for(let j=0;j<3;j++){b.box([x,y+j*.12,z],[.38+j*.19,.11,.22],j===1?green:red);b.box([x,y+j*.12+.05,z],[.15,.07,.46+j*.17],j===1?gold:red);}b.box([x,y+.38,z],[.83,.07,.83],wood);};
 // Raised hillside terrace, with individually shaped retaining stones.
 b.box([-4,1.15,-2.3],[13.5,2.05,12],stone);b.box([-4,2.23,-2.3],[13.8,.14,12.3],paving);
 for(let row=0;row<5;row++)for(let col=0;col<17;col++){
  const x=-10.4+col*.81+(row%2)*.27;if(x>2.6)continue;
  const shape=new T.Shape(),w=.68+b.rng()*.12,h=.33+b.rng()*.055;
  shape.moveTo(-w/2,-h*.35);shape.lineTo(-w*.4,h/2);shape.lineTo(w*.4,h*.45);shape.lineTo(w/2,-h*.32);shape.lineTo(w*.27,-h/2);shape.closePath();
  const g=b.own(new T.ExtrudeGeometry(shape,{depth:.12,bevelEnabled:true,bevelSize:.025,bevelThickness:.025,bevelSegments:1,steps:1}));g.setIndex(Array.from({length:g.attributes.position.count},(_,i)=>i));b.mesh(g,stone,[x,.38+row*.39,3.74]);
 }
 b.stairs({x:-4.4,z:9,y:.22,width:4.7,count:13,rise:.16,tread:.41,material:stone});
 for(const x of [-7,-1.8]){
  b.beam([x,.27,9.2],[x,2.31,3.8],.22,stone,b.root,.33);
  for(let j=0;j<7;j++){const z=8.95-j*.77,y=.3+j*.29;b.cylinderAt([x,y+.13,z],.065,.25,red);b.cylinderAt([x,y+.3,z],.065,.13,paving);}
 }
 // Broad open west gate; three bays, recessed lattice side screens and layered
 // decorative brackets. No solid slab obstructs the passage between columns.
 const gx=-4.4,gz=.15,gy=2.32;
 b.box([gx,gy+.13,gz],[8.1,.26,4.7],stone);
 for(const dx of [-3.4,-1.35,1.35,3.4])for(const dz of [-1.65,1.65]){
  b.cylinderAt([gx+dx,gy+.26,gz+dz],.27,.26,stone);
  b.cylinderAt([gx+dx,gy+1.96,gz+dz],.18,3.3,red);bracket(gx+dx,gy+3.57,gz+dz);
 }
 for(const dz of [-1.65,1.65])for(const yy of [gy+3.08,gy+3.48])b.box([gx,yy,gz+dz],[7.6,.2,.25],red);
 for(const dx of [-3.4,3.4])b.box([gx+dx,gy+3.5,gz],[.24,.2,3.5],red);
 for(const s of [-1,1]){
  const cx=gx+s*2.37;
  for(let k=0;k<10;k++)b.box([cx+(k-4.5)*.15,gy+1.85,gz-.25],[.035,2.3,.045],black);
  for(let k=0;k<12;k++)b.box([cx,gy+.8+k*.19,gz-.25],[1.58,.035,.045],black);
  b.rail([gx+s*1.55,gy+.3,gz+2],[gx+s*3.75,gy+.3,gz+2],.7,red,{spacing:.32});
 }
 for(let i=0;i<9;i++){
  const x=gx-3.18+i*.795;
  b.sign('◉',.69,.8,[x,gy+2.72,gz+1.81],{bg:'#d7cfb7',fg:'#62554a',size:350});
  b.box([x,gy+3.15,gz+1.84],[.7,.06,.045],wood);
 }
 roofAt(gx,gy+4,gz,10.2,6.1,1.6);
 b.sign('音羽山',1.15,.44,[gx,gy+3.35,gz+1.81],{bg:'#30423b',fg:'#c4b17a',size:190});
 // Separate pagoda beyond the gate's right shoulder, matching the photo's depth.
 const px=.5,pz=-6.15;
 b.box([px,2.4,pz],[5.5,.3,5.5],stone);
 for(let level=0;level<3;level++){
  const y=2.55+level*2.8,w=4.35-level*.65;
  b.box([px,y+1.05,pz],[w,2.1,w],black);
  for(const s of [-1,1]){for(let k=0;k<17;k++){const a=(k-8)*w*.052;b.box([px+a,y+1.1,pz+s*(w*.5+.01)],[.035,1.38,.035],wood);b.box([px+s*(w*.5+.01),y+1.1,pz+a],[.035,1.38,.035],wood);}}
  for(const s of [-1,1])for(const a of [-.45,-.15,.15,.45]){
   b.box([px+a*w,y+1.05,pz+s*w*.51],[.12,2.15,.14],red);b.box([px+s*w*.51,y+1.05,pz+a*w],[.14,2.15,.12],red);
  }
  for(const yy of [y+.12,y+.5,y+1.9]){b.box([px,yy,pz+w*.52],[w+.15,.12,.14],red);b.box([px,yy,pz-w*.52],[w+.15,.12,.14],red);b.box([px+w*.52,yy,pz],[.14,.12,w+.15],red);b.box([px-w*.52,yy,pz],[.14,.12,w+.15],red);}
  for(const sx of [-1,1])for(const sz of [-1,1])bracket(px+sx*w*.45,y+1.95,pz+sz*w*.45);
  roofAt(px,y+2.4,pz,w+2.2,w+2.2,1.05);
 }
 b.cylinderAt([px,12.9,pz],.045,3.9,black);
 for(let i=0;i<9;i++){const g=b.own(new T.TorusGeometry(.31-i*.019,.025,6,20));g.rotateX(Math.PI/2);b.mesh(g,black,[px,11.4+i*.28,pz]);}
 b.mesh(b.own(new T.SphereGeometry(.12,12,8)),gold,[px,14.9,pz]);
 const lantern=(x,y,z)=>{
  b.box([x,y+.1,z],[.74,.2,.74],stone);b.cylinderAt([x,y+.65,z],.17,.95,stone);b.box([x,y+1.16,z],[.65,.17,.65],stone);
  for(const dx of [-.23,.23])for(const dz of [-.23,.23])b.box([x+dx,y+1.47,z+dz],[.1,.52,.1],stone);
  const cap=b.mesh(b.own(new T.ConeGeometry(.68,.32,4)),stone,[x,y+1.89,z]);cap.rotation.y=Math.PI/4;b.cylinderAt([x,y+2.1,z],.09,.16,stone);
  b.lamp([x,y+1.48,z],{intensity:4,range:3,color:'#f0cd94',radius:.12});
 };
 for(const x of [-8,-.8])lantern(x,.22,6.1);
 for(const x of [-9.4,1.65])lantern(x,2.3,2.7);
 for(const [a,c] of [[[-10.5,2.3,3.4],[-7.2,2.3,3.4]],[[-1.5,2.3,3.4],[2.65,2.3,3.4]]])b.rail(a,c,.8,stone,{spacing:.43,depth:.075});
 b.box([.35,1.55,7],[.9,2.7,.48],stone);b.sign('清\n水\n寺',.62,2.1,[.35,1.6,7.25],{bg:'#8d9287',fg:'#414a43',size:520});
 // The torii walk bends around the hillside instead of a detached straight row.
 const walk=new T.CatmullRomCurve3([[7,.24,10.7],[7.4,.45,5.5],[8.4,.8,.4],[7.3,1.35,-5.1],[4.5,2.26,-8.9]].map(p=>new T.Vector3(...p)));
 // A continuous hillside meets the curved route; rising posts no longer sit
 // over a flat green display board with disconnected paving pads.
 const samples=Array.from({length:161},(_,i)=>walk.getPointAt(i/160));
 const hillHeight=(x,z)=>{let closest=samples[0],distance=Infinity;for(const p of samples){const d=(p.x-x)**2+(p.z-z)**2;if(d<distance){distance=d;closest=p;}}return Math.max(.215,closest.y-.09)+Math.min(.28,Math.sqrt(distance)*.018);};
 const hillPos=[],hillUv=[],hillIds=[],nx=44,nz=70;
 for(let j=0;j<=nz;j++)for(let i=0;i<=nx;i++){const x=2.9+i/nx*10.9,z=-13.35+j/nz*25.9;hillPos.push(x,hillHeight(x,z),z);hillUv.push(x,z);if(j&&i){const a=(j-1)*(nx+1)+i-1;hillIds.push(a,a+nx+1,a+1,a+1,a+nx+1,a+nx+2);}}
 const hill=b.own(new T.BufferGeometry());hill.setAttribute('position',new T.Float32BufferAttribute(hillPos,3));hill.setAttribute('uv',new T.Float32BufferAttribute(hillUv,2));hill.setIndex(hillIds);hill.computeVertexNormals();const hillside=b.mesh(hill,soil);hillside.name='kyoto:continuous-moss-hillside';hillside.userData.keep=true;
 const pathPos=[],pathUv=[],pathIds=[];
 for(let i=0;i<=160;i++){const p=samples[i],d=walk.getTangentAt(i/160),n=new T.Vector3(-d.z,0,d.x).normalize();for(const sign of [-1,1]){const q=p.clone().addScaledVector(n,sign*1.87);pathPos.push(q.x,q.y-.004,q.z);pathUv.push(q.x,q.z);}if(i){const a=(i-1)*2;pathIds.push(a,a+2,a+1,a+1,a+2,a+3);}}
 for(let i=0;i<pathIds.length;i+=3)[pathIds[i+1],pathIds[i+2]]=[pathIds[i+2],pathIds[i+1]];
 const pg=b.own(new T.BufferGeometry());pg.setAttribute('position',new T.Float32BufferAttribute(pathPos,3));pg.setAttribute('uv',new T.Float32BufferAttribute(pathUv,2));pg.setIndex(pathIds);pg.computeVertexNormals();const connected=b.mesh(pg,paving);connected.name='kyoto:continuous-torii-path';connected.userData.keep=true;
 const oldStone=b.mat('stone:mossy-path-coping','#737b69');architectureFinish(b,oldStone,'stone',{scale:1.5,amount:.6});
 const rock=b.own(new T.SphereGeometry(1,8,6));
 for(let i=0;i<90;i++){const t=i/89,p=walk.getPointAt(t),d=walk.getTangentAt(t),n=new T.Vector3(-d.z,0,d.x).normalize();for(const sign of [-1,1]){const q=p.clone().addScaledVector(n,sign*(2.02+b.rng()*.15));b.mesh(rock,oldStone,[q.x,hillHeight(q.x,q.z)+.04,q.z],[.12+b.rng()*.16,.09+b.rng()*.1,.14+b.rng()*.13]);}}
 const postGeometry=b.own(new T.CylinderGeometry(1,1,1,24));
 const toriiPost=(a,c,r,material,parent)=>{const start=new T.Vector3(...a),end=new T.Vector3(...c),mesh=b.mesh(postGeometry,material,start.clone().add(end).multiplyScalar(.5).toArray(),[r,start.distanceTo(end),r],parent);mesh.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),end.sub(start).normalize());return mesh;};
 for(let i=0;i<26;i++){
  const t=i/25,p=walk.getPointAt(t),dir=walk.getTangentAt(t),angle=Math.atan2(-dir.x,-dir.z),group=b.group('torii:joined-timber',[p.x,p.y,p.z]);group.rotation.y=angle;
  const w=i===0?3.4:2.85,h=i===0?4.2:3.55;
  b.box([0,-.04,0],[3.75,.14,.83],paving,group);
  for(const s of [-1,1]){toriiPost([s*w/2,0,0],[s*w*.46,h,0],.16,red,group);b.mesh(postGeometry,black,[s*w/2,.26,0],[.175,.52,.175],group);b.cylinderAt([s*w/2,.035,0],.25,.07,stone,group);}
  b.box([0,h-.63,0],[w+.6,.18,.24],red,group);b.box([0,h-.26,0],[.18,.7,.25],red,group);
  for(let k=0;k<10;k++){const a=-1+k*.2,c=a+.2;for(const [offset,width,material]of [[0,.23,red],[.15,.12,black]])b.beam([a*(w+1)/2,h+.24*a*a+offset,0],[c*(w+1)/2,h+.24*c*c+offset,0],width,material,group,.35);}
  if(i%3===0){
   // The posts lean slightly inward: put the writing on that actual post,
   // not at a constant x where it floats beside the tapered timber.
   const y=2.1,x=-w/2+w*.04*y/h,lean=-Math.atan(w*.04/h);
   const mounting=b.box([x,y,.153],[.17,.67,.018],red,group,'torii:post-inscription-backing');mounting.rotation.z=lean;
   const inscription=b.sign('奉\n納',.155,.64,[x,y,.163],{bg:'#af4934',fg:'#272b28',size:650,parent:group});inscription.name='torii:post-inscription';inscription.rotation.z=lean;
  }
  if(i===0){
   // The central title sits on a real wooden plaque fastened to the central
   // upright and crosspiece; its painted face lies directly on the plaque.
   b.box([0,h-.46,.158],[.44,.81,.07],wood,group,'torii:title-plaque');
   const title=b.sign('稲\n荷\n大\n神',.4,.77,[0,h-.46,.194],{bg:'#555640',fg:'#c6b270',size:400,parent:group});title.name='torii:title-inscription';
  }
  if(i%4===1){
   const n=new T.Vector3(-dir.z,0,dir.x).normalize(),q=p.clone().addScaledVector(n,2.42);
   const y=hillHeight(q.x,q.z);b.box([q.x,y+.1,q.z],[.48,.2,.48],oldStone);b.box([q.x,y+.43,q.z],[.22,.65,.22],wood);b.box([q.x,y+.89,q.z],[.36,.38,.36],black);
   const glow=b.mat('lamp:torii-paper','#e0c18e',{emissive:'#ffd39b',emissiveIntensity:.3});
   for(const side of [-1,1]){b.box([q.x,y+.89,q.z+side*.185],[.26,.27,.008],glow);b.box([q.x+side*.185,y+.89,q.z],[.008,.27,.26],glow);}
   const cap=b.mesh(b.own(new T.ConeGeometry(.34,.18,4)),roof,[q.x,y+1.16,q.z]);cap.rotation.y=Math.PI/4;
   const light=new T.PointLight('#ffd39b',9,4.7,2);light.position.set(q.x,y+.89,q.z);b.root.add(light);b.lamps.push({light,material:glow,intensity:9,day:.015,night:1});
  }
 }
 // Framing woods are branch-and-leaf crowns, with a varied silhouette and gaps.
 for(const [x,z,h,s] of [[-12,-9,6.8,1.8],[-12,-4,5.8,1.4],[-12,1,5,1.3],[11.8,-10,7,1.6],[11.8,-5,6,1.6],[11.9,0,5.5,1.3],[11.8,6,4.8,1.2],[-6,-11,6.5,1.6],[-2,-11.8,6.8,1.4],[5,-11.6,6.3,1.5]])b.tree(x,z,h,s);
 b.shrubs(-10.8,6,2.3,6,.85);b.shrubs(3.5,2,1.4,7,.7);b.shrubs(11,8.5,2,3,.7);
 // Irregular, overlapping tree layers form the forest envelope instead of a
 // few isolated stick trees. Canopy openings still admit directional sunlight.
 for(const [x,z,h,s]of [[4.1,7,7,2.1],[3.7,1.3,8.8,2.2],[3.8,-3,9.5,2.3],[10.8,8,8,2.1],[12.5,3,9.6,2.5],[12.1,-2,10.5,2.5],[11.7,-8.5,10,2.5],[9.6,-12.3,10,2.7],[5.2,-12.5,10.8,2.8],[.9,-12.4,9.4,2.2],[-5.7,-12.5,9,2.4],[-10.8,-10.9,8.8,2.1]]){
  const previous=new Set(b.root.children);b.tree(x,z,h,s);const rise=x>2.9?hillHeight(x,z):.2;for(const child of b.root.children)if(!previous.has(child))child.position.y+=rise;
 }
 const ferns=[];
 for(let i=0;i<70;i++){
  const t=b.rng(),p=walk.getPointAt(t),d=walk.getTangentAt(t),n=new T.Vector3(-d.z,0,d.x).normalize(),q=p.clone().addScaledVector(n,(i%2?1:-1)*(2.3+b.rng()*1.1));const base=hillHeight(q.x,q.z);
  for(let j=0;j<9;j++){const a=j*2.4;for(let k=1;k<=5;k++)ferns.push({x:q.x+Math.cos(a)*k*.045,y:base+.03+Math.sin(k/6*Math.PI)*.25,z:q.z+Math.sin(a)*k*.045,rx:Math.PI*.35,ry:a,rz:a,size:.055+k*.006,hue:.22});}
 }
 b.leaves(ferns,{narrow:true,color:'#526b39',name:'foliage:torii-forest-ferns'});
 const litter=b.mat('leaf:fallen-camphor','#766242',{side:T.DoubleSide});const leafGeo=b.own(new T.BufferGeometry());
 leafGeo.setAttribute('position',new T.Float32BufferAttribute([0,-.065,0,-.027,-.012,0,-.018,.041,0,0,.065,0,.025,.003,0,0,0,.008],3));leafGeo.setAttribute('uv',new T.Float32BufferAttribute([.5,0,0,.4,.18,.8,.5,1,1,.5,.5,.5],2));leafGeo.setIndex([0,1,5,1,2,5,2,3,5,3,4,5,4,0,5]);leafGeo.computeVertexNormals();
 for(let i=0;i<240;i++){const t=b.rng(),p=walk.getPointAt(t),d=walk.getTangentAt(t),n=new T.Vector3(-d.z,0,d.x).normalize(),q=p.clone().addScaledVector(n,(b.rng()-.5)*3.55);const leaf=b.mesh(leafGeo,litter,[q.x,q.y+.039,q.z]);leaf.rotation.set(-Math.PI/2,0,b.rng()*Math.PI*2);leaf.castShadow=false;}
 // Main chat view: look across both halves of this composite scene. The
 // former eye at the torii entrance hid Kiyomizu's west gate on the left.
 const companion={position:[.8,5.4,23],target:[1.5,4.2,0],fov:60};
 const api=b.finish({w:28,d:27,photo:{position:[18,10,30],target:[-1,4.7,-1],fov:44},companion,overview:[.75,.7,1.4],background:'#94aaa5'});
 api.lightResponse={ambient:.72,environment:.66};
 return api;
}

