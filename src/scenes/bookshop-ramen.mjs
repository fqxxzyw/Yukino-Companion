import * as T from 'three';
import {createScene as createBookshop} from './bookshop.mjs';
import {Diorama} from './diorama-kit.mjs';
import {sakuraTree} from './sakura-tree.mjs';
import {addStreetContext} from './street-context.mjs';

// Authored finishes retain a physical construction scale in the inspected
// storefront, rather than using glossy, uniformly coloured building boxes.
function shopTextures(b){
 let seed=713;const random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);
 function canvasTexture(name,width,height,draw,{color=true}={}){
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;draw(canvas.getContext('2d'),width,height);
  const texture=new T.CanvasTexture(canvas);texture.name=name;texture.colorSpace=color?T.SRGBColorSpace:T.NoColorSpace;texture.anisotropy=4;texture.wrapS=texture.wrapT=T.RepeatWrapping;b.textures.add(texture);return texture;
 }
 const tile=canvasTexture('shop:ceramic-tile-and-recessed-mortar',1024,1024,(c,W,H)=>{
  c.fillStyle='#777c77';c.fillRect(0,0,W,H);
  for(let row=0;row<42;row++)for(let col=0;col<27;col++){
   const xx=col*W/27,yy=row*H/42,v=176+Math.floor(random()*20);c.fillStyle=`rgb(${v+11},${v+9},${v+1})`;c.fillRect(xx+1.15,yy+1.1,W/27-2.3,H/42-2.2);
   c.fillStyle='rgba(246,243,226,.23)';c.fillRect(xx+1.2,yy+1.2,W/27-2.4,.8);c.fillStyle='rgba(73,76,67,.15)';c.fillRect(xx+1.3,yy+H/42-2.1,W/27-2.6,1);
  }
  for(let i=0;i<11000;i++){const v=120+random()*90;c.fillStyle=`rgba(${v},${v},${v-7},.035)`;c.fillRect(random()*W,random()*H,.8+random()*2,.8+random()*2);}
 });
 const grain=canvasTexture('shop:aged-timber-longitudinal-grain',512,1024,(c,W,H)=>{
  c.fillStyle='#c7aa7e';c.fillRect(0,0,W,H);
  for(let i=0;i<260;i++){const xx=random()*W;c.strokeStyle=`rgba(${random()>.4?'73,48,25':'247,220,173'},${.025+random()*.13})`;c.lineWidth=.4+random()*1.3;c.beginPath();c.moveTo(xx,0);for(let yy=0;yy<=H;yy+=30)c.lineTo(xx+Math.sin(yy*.009+i)*(.5+random()*4),yy);c.stroke();}
  for(let i=0;i<9;i++){const xx=random()*W,yy=random()*H;c.strokeStyle='rgba(77,48,27,.12)';c.lineWidth=1;for(let ring=0;ring<4;ring++){c.beginPath();c.ellipse(xx,yy,3+ring*2,10+ring*5,.03,0,Math.PI*2);c.stroke();}}
 });
 const plaster=canvasTexture('shop:lime-plaster-grain',512,512,(c,W,H)=>{
  c.fillStyle='#cec4b0';c.fillRect(0,0,W,H);for(let i=0;i<24000;i++){const v=120+random()*120;c.fillStyle=`rgba(${v},${v-2},${v-7},.08)`;c.fillRect(random()*W,random()*H,.5+random()*2,.5+random()*2);}
 });
 return {tile,grain,plaster};
}

export function createScene({scene,renderer}){
 const original=createBookshop({scene,renderer}),b=new Diorama(scene,renderer,'Bookshop_and_Tenkaippin');
 const x=7.25,z=1.8,w=7.3,d=5.1,front=z+d/2;
 // The supplied bookshop already owns its ground block. A second plinth made
 // the combined street read as a floating display slab in the chat backdrop.
 const textures=shopTextures(b);
 const wall=b.mat('wall:ramen-tile','#ffffff',{map:textures.tile,bumpMap:textures.tile,bumpScale:.006,roughness:.78}),wood=b.mat('wood:ramen-lattice','#92734e',{map:textures.grain,roughness:.83}),trim=b.mat('wood:ramen-joinery','#a88b63',{map:textures.grain,roughness:.8});
 const dark=b.mat('paint:ramen-awning','#303a36',{metalness:.04,roughness:.82}),paper=b.mat('interior:shoji-paper','#c9c2ac',{roughness:.97}),floor=b.mat('interior:ramen-floor','#aaa18a'),steel=b.mat('metal:stool-frame','#8d9592',{metalness:.85,roughness:.3}),red=b.mat('interior:vinyl-stool-seat','#97392f',{roughness:.64}),counter=b.mat('interior:wood-counter','#c3a16d',{map:textures.grain,roughness:.7});
 const glass=b.mat('glass:ramen-upper','#607775',{transparent:true,opacity:.45,roughness:.2,depthWrite:false});
 const interior=b.mat('interior:plaster','#c5b99e',{map:textures.plaster,roughness:.96}),shadow=b.mat('interior:ramen-upper-room','#383d35',{roughness:.95}),curtain=b.mat('interior:ramen-linen-curtain','#a89e83',{map:textures.plaster,roughness:1});
 for(const [material,roughness,metalness,environment]of [[wall,.84,0,.3],[wood,.83,0,.28],[trim,.8,0,.3],[dark,.84,.02,.3],[paper,.97,0,.2],[steel,.36,.82,.65],[red,.76,0,.3],[counter,.77,0,.35],[glass,.22,0,.45],[interior,.96,0,.2],[shadow,.96,0,.2],[curtain,1,0,.18]])material.userData.surfaceFinish={roughness,metalness,envMapIntensity:environment};
 b.box([x,.18,z],[w+.2,.25,d+.4],floor);
 b.box([x,3.45,z-d/2],[w,6.5,.2],wall);for(const side of [-1,1])b.box([x+side*w/2,3.45,z],[.2,6.5,d],wall);
 b.box([x,3.17,z],[w,.16,d],wall);b.box([x,6.62,z],[w+.25,.17,d+.25],dark);
 b.box([x,3.65,front],[w,.8,.15],wall);b.box([x,6.4,front],[w,.3,.15],wall);
 // Upper floor: actual sash divisions, deep reveals and visible rear room.
 b.box([x,4.8,z-d/2+.14],[w-.4,2.5,.07],shadow);
 b.box([x,6.48,z],[w-.35,.12,d-.25],shadow);
 for(let i=0;i<5;i++){
  const xx=x-w/2+.76+i*1.45;
  b.box([xx,5.1,front+.035],[1.37,2.1,.025],glass);
  for(const edge of [-.7,.7])b.box([xx+edge,5.1,front+.09],[.055,2.18,.12],dark);
  b.box([xx,4.05,front+.12],[1.45,.08,.18],dark);b.box([xx,6.15,front+.12],[1.45,.08,.15],dark);
  b.box([xx,4.64,front+.08],[1.4,.035,.07],dark);
  // Recessed rooms and fabric are visible behind separate glazing; the panes
  // are no longer a uniform opaque-looking grey insert in the wall.
  b.box([xx-.49,5.12,front-.27],[.32,1.94,.045],curtain);
  for(let pleat=0;pleat<4;pleat++)b.box([xx-.61+pleat*.078,5.12,front-.24],[.022,1.94,.035],interior);
  if(i%2===0)b.box([xx+.48,5.12,front-.28],[.29,1.94,.045],curtain);
  b.box([xx,4.1,front-.34],[1.34,.05,.58],trim);
  if(i===1||i===3){b.box([xx,4.46,front-.9],[.85,.55,.58],shadow);b.box([xx,4.77,front-.9],[.92,.06,.63],trim);}
 }
 const upstairs=b.mat('lamp:ramen-upper-ceiling','#dfd9c7',{emissive:'#e4d3ad',emissiveIntensity:.08});b.lamps.push({material:upstairs,day:.08,night:.7});b.box([x,6.31,z+1.0],[2.1,.035,.36],upstairs);b.lamp([x,6.19,z+1.0],{intensity:11,range:5,color:'#e5cc9d',radius:.1});
 // Open entrance right; timber-and-paper bays occupy the larger left frontage.
 for(let bay=0;bay<4;bay++){
  const xx=x-2.88+bay*1.22;
  b.box([xx,1.52,front+.06],[1.14,2.3,.035],paper);
  for(let k=0;k<5;k++)b.box([xx-.56+k*.28,1.52,front+.11],[.04,2.38,.07],wood);
  for(let k=0;k<8;k++)b.box([xx,.4+k*.32,front+.11],[1.18,.043,.07],wood);
 }
 for(const xx of [x+1.48,x+3.48])b.box([xx,1.5,front+.06],[.13,2.5,.2],trim);
 // Right-hand door is partly slid open; glimpse counter and red stools.
 for(let k=0;k<5;k++)b.box([x+3.05+k*.1,1.48,front+.15],[.035,2.35,.09],wood);
 for(let k=0;k<7;k++)b.box([x+3.24,.45+k*.34,front+.15],[.45,.035,.09],wood);
 for(let i=0;i<4;i++){const xx=x+1.75+i*.37;b.box([xx,2.48,front+.19],[.35,.55,.03],paper);b.sign('中華そば'[i],.27,.3,[xx,2.49,front+.22],{bg:'#c9b692',fg:'#813a2a',size:240});}
 // Sloping metal awning with fascia, supports and continuous fluorescent strip.
 const awning=b.box([x,2.99,front+.48],[w+.8,.1,1.35],dark);awning.rotation.x=.08;
 for(const xx of [x-3.2,x,x+3.2])b.beam([xx,2.6,front],[xx,2.95,front+1.08],.045,dark);
 b.box([x,2.94,front+1.13],[w+.85,.12,.11],dark);
 const tube=b.mat('lamp:fluorescent','#e9e1ce',{emissive:'#eee4cf',emissiveIntensity:.3});b.lamps.push({material:tube,day:.25,night:1.2});b.box([x,2.92,front+.85],[w+.3,.035,.04],tube);
 b.box([x,3.55,front+.45],[w+.7,1.05,.24],dark);
 b.sign('天下一品 総本店',w+.48,.85,[x,3.55,front+.582],{emissive:true,draw(c,W,H){
  c.fillStyle='#dedfc7';c.fillRect(0,0,W,H);c.fillStyle='#b82731';c.beginPath();c.arc(W*.31,H*.5,H*.35,0,Math.PI*2);c.fill();
  c.strokeStyle='#e9e8d1';c.lineWidth=7;c.beginPath();c.moveTo(W*.278,H*.56);c.lineTo(W*.34,H*.44);c.stroke();
  c.fillStyle='#222d27';c.textAlign='center';c.textBaseline='middle';c.font='bold 91px "Yu Mincho",serif';c.fillText('天下一品',W*.64,H*.55,W*.48);
  c.font='18px serif';c.fillText('昭和四十六年創業',W*.13,H*.4,W*.22);c.fillText('中華そば専門店',W*.13,H*.65,W*.22);
  c.font='17px serif';c.fillText('TENKAIPPIN',W*.61,H*.18);c.font='23px serif';c.fillText('総本店',W*.94,H*.55,W*.1);
 }});
 const vertical=b.group('tenkaippin:projecting-sign',[x+3.48,5.3,front+.55]);vertical.rotation.y=.12;
 b.box([0,0,0],[1.02,3.4,.27],dark,vertical);
 b.sign('天下一品 縦看板',.87,3.2,[0,0,.15],{emissive:true,parent:vertical,draw(c,W,H){
  c.fillStyle='#dddcc2';c.fillRect(0,0,W,H);c.fillStyle='#b82a31';c.beginPath();c.arc(W*.5,H*.13,W*.32,0,6.28);c.fill();c.strokeStyle='#e9e8d1';c.lineWidth=17;c.beginPath();c.moveTo(W*.25,H*.14);c.lineTo(W*.75,H*.12);c.stroke();
  c.fillStyle='#243129';c.font='bold 500px "Yu Mincho",serif';c.textAlign='center';[...'天下一品'].forEach((letter,i)=>c.fillText(letter,W*.5,H*(.34+i*.16)));
 }});
 // Weathered exhaust hood and rooftop service units match the photographed shop.
 const hood=b.box([x-3.85,3.47,front-.12],[.65,.7,.72],dark);hood.rotation.x=-.1;
 b.box([x-3.85,4.3,front-.12],[.4,1.05,.4],dark);
 for(const xx of [x-2.1,x-.9]){b.box([xx,6.98,z],[1.02,.6,.55],wall);for(let k=0;k<10;k++)b.box([xx-.42+k*.09,6.98,z+.29],[.025,.45,.025],dark);}
 const profile=[];for(let i=0;i<=44;i++){const t=i/44;profile.push(new T.Vector2(.11+.18*Math.sin(Math.PI*t)+.008*Math.cos(i*Math.PI),t*.68-.34));}
 const lanternGeo=b.own(new T.LatheGeometry(profile,24)),lanternMat=b.mat('paper:lantern','#cdb17c',{emissive:'#e4b776',emissiveIntensity:.12});b.lamps.push({material:lanternMat,day:.12,night:.62});
 const captions=[...'中華そば天下一品'];
 for(let i=0;i<8;i++){const xx=x-3.12+i*.87;b.mesh(lanternGeo,lanternMat,[xx,2.52,front+.85]);b.cylinderAt([xx,2.89,front+.85],.06,.08,dark);b.cylinderAt([xx,2.17,front+.85],.09,.05,dark);const label=b.sign(captions[i],.28,.31,[xx,2.52,front+1.15],{draw(c,W,H){c.clearRect(0,0,W,H);c.fillStyle='#42372b';c.font='bold 760px serif';c.textAlign='center';c.textBaseline='middle';c.fillText(captions[i],W/2,H/2);}});label.material.transparent=true;label.material.alphaTest=.1;}
 for(const xx of [x-2.4,x,x+2.5])b.lamp([xx,2.86,front+.55],{intensity:9,range:4,color:'#ffd4a0',radius:.14});
 b.box([x,.97,z-.1],[w-.7,.16,.8],counter);b.box([x,.59,z-.1],[w-.8,.65,.6],interior);
 const bowl=b.own(new T.LatheGeometry([new T.Vector2(.07,0),new T.Vector2(.12,.04),new T.Vector2(.23,.13),new T.Vector2(.25,.2),new T.Vector2(.23,.21),new T.Vector2(.08,.04)],20)),ceramic=b.mat('interior:bowl-ceramic','#ded4ba',{roughness:.4});
 for(let i=0;i<6;i++){const xx=x-2.6+i*1.02;
  b.cylinderAt([xx,.45,z+.87],.04,.66,steel);b.cylinderAt([xx,.16,z+.87],.26,.06,steel);b.cylinderAt([xx,.81,z+.87],.27,.1,red);b.cylinderAt([xx,.75,z+.87],.29,.04,steel);
  b.mesh(bowl,ceramic,[xx,1.08,z-.1]);b.cylinderAt([xx,1.23,z-.5],.045,.28,dark);for(const dz of [0,.04])b.tube([xx-.24,1.3,z-.1+dz],[xx+.24,1.3,z-.1+dz],.008,wood);
 }
 b.sign('営業中',.42,.65,[x+3.46,1.6,front+.22],{bg:'#963a30',fg:'#eee3c9',size:140});
 // Remove both old blob crowns; the right one was inside the new restaurant.
 for(const name of ['Left_Front_Cherry','Right_Garden_Cherry']){const old=original.root.getObjectByName(name);if(old)old.visible=false;}
 sakuraTree(b,-12.6,4.1,{height:4.4,spread:1.8});sakuraTree(b,12.4,4.6,{height:4.1,spread:1.3});
 // Clear the bookshop frontage while retaining its original side house as a
 // neighbouring building behind the shop, rather than blocking its windows.
 const sideHouse=original.root.getObjectByName('Building_Left_Pale_House');if(sideHouse)sideHouse.position.set(-11.6,.22,-3.2);
 // The original little lane ends at the new cross street. Clip its pavement,
 // curbs and front garden here so no old sidewalk or planter projects into the
 // carriageway. Intersections interpolate the actual UVs/normals, not just the
 // vertex positions, and the replacement buffers join this wrapper's disposal.
 original.root.updateMatrixWorld(true);
 for(const groupName of ['Road_And_Street','Pavement_And_Forecourt','Vegetation','Props_And_Street_Furniture'])original.root.getObjectByName(groupName)?.traverse(o=>{
  if(!o.isMesh)return;
  if(o.isInstancedMesh){
   const instance=new T.Matrix4(),world=new T.Matrix4(),point=new T.Vector3();
   for(let i=0;i<o.count;i++){o.getMatrixAt(i,instance);world.multiplyMatrices(o.matrixWorld,instance);point.setFromMatrixPosition(world);if(point.z>7.3){instance.makeScale(0,0,0);o.setMatrixAt(i,instance);}}
   o.instanceMatrix.needsUpdate=true;o.computeBoundingSphere();return;
  }
  const old=o.geometry;if(!old?.attributes.position)return;
  old.computeBoundingBox();const bounds=old.boundingBox.clone().applyMatrix4(o.matrixWorld);if(bounds.max.z<=7.3)return;if(bounds.min.z>7.3){o.visible=false;return;}
  const plane=new T.Plane(new T.Vector3(0,0,-1),7.3).applyMatrix4(o.matrixWorld.clone().invert()),attributes=Object.entries(old.attributes),output=Object.fromEntries(attributes.map(([name])=>[name,[]])),position=old.attributes.position,index=old.index;
  const vertex=i=>Object.fromEntries(attributes.map(([name,a])=>[name,Array.from({length:a.itemSize},(_,k)=>a.array[i*a.itemSize+k])]));
  const distance=v=>plane.distanceToPoint(new T.Vector3(...v.position));
  for(let i=0;i<(index?index.count:position.count);i+=3){
   const polygon=[0,1,2].map(k=>vertex(index?index.getX(i+k):i+k)),clipped=[];
   for(let j=0;j<3;j++){
    const a=polygon[j],c=polygon[(j+1)%3],da=distance(a),dc=distance(c);if(da>=0)clipped.push(a);
    if((da>=0)!==(dc>=0)){const t=da/(da-dc);clipped.push(Object.fromEntries(attributes.map(([name])=>[name,a[name].map((v,k)=>v+(c[name][k]-v)*t)])));}
   }
   for(let j=1;j+1<clipped.length;j++)for(const v of [clipped[0],clipped[j],clipped[j+1]])for(const [name]of attributes)output[name].push(...v[name]);
  }
  const geometry=b.own(new T.BufferGeometry());for(const [name,a]of attributes)geometry.setAttribute(name,new T.Float32BufferAttribute(output[name],a.itemSize));geometry.computeBoundingSphere();o.geometry=geometry;
 });
 // Scale joints by the wall's real dimensions and grain along each member's
 // long axis. A narrow header has a few tile courses, not a compressed facade.
 b.root.updateMatrixWorld(true);
 b.root.traverse(o=>{
  if(!o.isMesh||![wall,wood,trim,counter].includes(o.material))return;
  const geometry=b.own(o.geometry.clone()),position=geometry.attributes.position,normal=geometry.attributes.normal,uv=geometry.attributes.uv,p=new T.Vector3();
  const size=o.scale.toArray().map(Math.abs),long=size.indexOf(Math.max(...size));
  for(let i=0;i<position.count;i++){
   p.fromBufferAttribute(position,i).applyMatrix4(o.matrixWorld);const n=[Math.abs(normal.getX(i)),Math.abs(normal.getY(i)),Math.abs(normal.getZ(i))],face=n.indexOf(Math.max(...n)),values=p.toArray();
   if(o.material===wall){const u=face===0?p.z:p.x,v=face===1?p.z:p.y;uv.setXY(i,u/7.3,v/6.5);}
   else {const cross=[0,1,2].find(axis=>axis!==long&&axis!==face)??((long+1)%3);uv.setXY(i,values[cross]/.12,values[long]/1.2);}
  }
  o.geometry=geometry;
 });
 addStreetContext(b,{kind:'bookshop'});
 const extra=b.finish({w:56,d:48,rain:false,overview:[0,.28,1],photo:{position:[.5,3.8,28],target:[.5,3.8,1.5],fov:47},companion:{position:[.5,4.3,31],target:[.5,3.8,1.5],fov:47},background:'#b2bfbd'});
 const remove=[];original.root.traverse(o=>{if(o.isDirectionalLight||o.isHemisphereLight||o.isAmbientLight)remove.push(o);});remove.forEach(o=>o.removeFromParent());
 extra.framingRoot.add(original.root);extra.root.updateMatrixWorld(true);extra.bounds.setFromObject(extra.framingRoot);
 // Ground is intentionally outside the finite architecture framing bounds.
 // It continues through the foreground and out of frame in both frontal
 // cameras, concealing the old plinth's cut edges without zooming the shops out.
 const ground=b.mat('soil:continuous-street-ground','#938b79'),asphalt=b.mat('asphalt:continuous-foreground-road','#5a6265'),paving=b.mat('paving:continuous-shop-sidewalk','#b3afa2'),curb=b.mat('concrete:continuous-curb','#a3a397'),line=b.mat('paint:foreground-road-line','#d6d4bd');
 const keep=(mesh,name)=>{mesh.name='bookshop:'+name;mesh.userData.keep=true;return mesh;};
 const groundPlane=b.own(new T.PlaneGeometry(600,600));groundPlane.rotateX(-Math.PI/2);
 keep(b.mesh(groundPlane,ground,[0,.008,0]),'continuous-ground');
 keep(b.box([0,.075,6.08],[120,.18,2.52],paving),'continuous-sidewalk');
 keep(b.box([-5.7,.075,4.12],[6.5,.18,1.4],paving),'bookshop-entry-apron');
 keep(b.box([x,.075,4.69],[w+.2,.18,.34],paving),'ramen-entry-apron');
 keep(b.box([0,.125,7.38],[120,.25,.13],curb),'continuous-curb');
 keep(b.box([0,.045,51],[150,.07,87],asphalt),'foreground-road');
 for(let xx=-70;xx<=70;xx+=4.6)b.box([xx,.087,11.2],[2.4,.012,.075],line);
 extra.root.userData.bookshopStreet={frontAxis:'+z',roadStartZ:7.5,groundY:.008,sidewalkY:.165};
 const lighting=extra.setLighting,update=extra.update,dispose=extra.dispose;
 extra.setLighting=id=>{original.setLighting(id==='day'?'noon':id==='night'||id==='evening'?'dusk':'morning');return lighting(id);};
 extra.update=(dt,t)=>{original.update(dt,t);update(dt,t);};extra.dispose=()=>{dispose();original.dispose();};
 extra.fidelityDifferences=['Photograph-led Tenkaippin frontage; original bookshop retained; unseen sides and interiors approximate.'];return extra;
}

