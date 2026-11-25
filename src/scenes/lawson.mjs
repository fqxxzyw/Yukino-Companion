import * as T from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {Diorama} from './diorama-kit.mjs';
import {addStreetContext} from './street-context.mjs';
import {entranceLight,gutterReflection,oppositeSidewalk} from './storefront-street.mjs';

function parkedBicycle(b,frame,tyre,steel){
 const bike=b.group('lawson:parked-bicycle',[-6.15,.23,2.14]);
 bike.rotation.y=-.27;
 const wheel=b.own(new T.TorusGeometry(.307,.024,6,28)),radius=.307;
 for(const x of [-.55,.55]){
  b.mesh(wheel,tyre,[x,.331,0],[1,1,1],bike);
  for(let i=0;i<7;i++){
   const a=i*Math.PI/7,dx=radius*Math.cos(a),dy=radius*Math.sin(a);
   b.tube([x-dx,.331-dy,0],[x+dx,.331+dy,0],.006,steel,bike);
  }
 }
 const rear=[-.55,.331,0],crank=[-.04,.32,0],seat=[-.22,.75,0],head=[.33,.77,0];
 for(const [a,z] of [[rear,seat],[rear,crank],[crank,seat],[crank,head],[head,[.55,.331,0]],[head,[-.09,.48,0]]]){
  b.tube(a,z,.023,frame,bike);
 }
 b.tube(seat,[-.25,.88,0],.019,steel,bike);b.box([-.26,.9,0],[.21,.055,.13],tyre,bike);
 b.tube(head,[.39,.98,0],.018,steel,bike);b.tube([.39,.98,-.19],[.39,.98,.19],.017,steel,bike);
 b.tube(crank,[-.16,.02,.16],.014,steel,bike);
 const basket=b.mat('metal:bicycle-basket','#75857c',{roughness:.64,metalness:.32});
 for(const y of [.69,.78,.87]){
  for(const s of [-1,1]){
   b.tube([.42,y,s*.14],[.69,y,s*.14],.009,basket,bike);
   b.tube([s*.135+.555,y,-.14],[s*.135+.555,y,.14],.009,basket,bike);
  }
 }
 for(const x of [.42,.69])for(const z of [-.14,.14])b.tube([x,.69,z],[x,.87,z],.009,basket,bike);
 b.tube([.55,.331,0],[.59,.69,0],.014,steel,bike);
}

function pavementTree(b,iron){
 const x=5.45,z=17.35,leaves=[],up=new T.Vector3(0,1,0);
 const wood=b.own(new T.CylinderGeometry(.54,1,1,8));
 function limb(a,end,radius){
  const from=new T.Vector3(x+a[0],a[1],z+a[2]),to=new T.Vector3(x+end[0],end[1],z+end[2]);
  const mesh=b.mesh(wood,b.bark,from.clone().lerp(to,.5).toArray(),[radius,from.distanceTo(to),radius]);
  mesh.quaternion.setFromUnitVectors(up,to.sub(from).normalize());
 }
 const soil=b.mat('soil:street-tree-pit','#645341');
 b.box([x,.183,z],[1.42,.012,1.02],soil);
 for(const side of [-1,1]){
  b.box([x+side*.71,.191,z],[.055,.024,1.08],iron);
  b.box([x,.191,z+side*.51],[1.42,.024,.055],iron);
  for(let i=0;i<11;i++)b.box([x+side*.46,.191,z-.44+i*.088],[.44,.022,.021],iron);
 }
 const fork=[-.09,2.36,.05];
 limb([0,.17,0],fork,.14);limb(fork,[.13,3.84,-.17],.087);
 const crown=[[.32,4.78,-.25],[-1.15,4.06,-.78],[1.08,4.47,-.58],[-1.28,3.75,.47],[.57,4.22,.90]];
 for(const [j,[dx,y,dz]] of crown.entries()){
  const elbow=[dx*.55,y-.77,dz*.36],base=[-.08,2.48+j*.17,.02];
  limb(base,elbow,.067-j*.005);limb(elbow,[dx,y-.09,dz],.033);
  for(let k=0;k<4;k++){
   const a=k*2.4+j*.83,tip=[dx+.49*Math.cos(a),y+.22*Math.sin(a),dz+.40*Math.sin(a)];
   limb(elbow,tip,.016);
   const center=[x+tip[0],tip[1],z+tip[2]];
   for(let i=0;i<25;i++){
    const angle=i*2.39996+a,t=(i+.5)/25,ring=Math.sqrt(1-(2*t-1)**2);
    leaves.push({x:center[0]+Math.cos(angle)*ring*.46,y:center[1]+(t-.5)*.61,
     z:center[2]+Math.sin(angle)*ring*.42,size:.17+.075*Math.sin(angle)**2,center});
   }
  }
 }
 b.leaves(leaves,{color:'#79993e',name:'foliage:street-zelkova'});
}

function serviceCover(b,iron){
 // A resurfaced utility trench crosses part of the near lane. Set it below
 // the road markings, with the iron cover sitting flush in the asphalt.
 const outline=new T.Shape();
 outline.moveTo(-4.45,-13.68);outline.lineTo(-3.62,-13.60);outline.lineTo(-2.98,-11.32);
 outline.lineTo(-2.70,-10.89);outline.lineTo(-3.42,-10.40);outline.lineTo(-3.96,-11.15);outline.closePath();
 const patch=b.own(new T.ShapeGeometry(outline));patch.rotateX(-Math.PI/2);
 b.mesh(patch,b.mat('asphalt:utility-repair','#4a585f'),[0,.039,0]);
 const lid=b.mat('metal:cast-iron-cover','#53595a',{roughness:.83,metalness:.25});
 b.cylinderAt([-3.14,.043,10.88],.326,.014,lid);
 const ring=b.own(new T.TorusGeometry(.306,.011,5,40));ring.rotateX(-Math.PI/2);
 b.mesh(ring,iron,[-3.14,.054,10.88]);
 for(let i=-3;i<=3;i++){
  const dx=i*.072,half=Math.sqrt(.26**2-dx*dx);
  b.box([-3.14+dx,.053,10.88],[.014,.006,half*2],iron);
  b.box([-3.14,.053,10.88+dx],[half*2,.006,.014],iron);
 }
}

export function createScene({scene,renderer}){
 const b=new Diorama(scene,renderer,'Lawson_Neighbourhood');
 const finish=(material,roughness,metalness=0,envMapIntensity=.35)=>{material.userData.surfaceFinish={roughness,metalness,envMapIntensity};return material;};
 const keep=(mesh,name)=>{mesh.name='lawson:'+name;mesh.userData.keep=true;return mesh;};
 const concrete=b.mat('wall:mineral-render','#e4dfcc'),road=b.mat('asphalt:road','#566369'),paving=b.mat('paving:sidewalk','#dbc5a5');
 const dark=finish(b.mat('metal:roof-edge','#414b4f',{metalness:.04,roughness:.67}),.67,.04,.28),silver=finish(b.mat('metal:aluminium-frame','#a8b2b0',{metalness:.7,roughness:.42}),.42,.7,.48),white=b.mat('paint:road-markings','#dad9c9');
 const blue=b.mat('paint:lawson-blue','#1c5c9e'),pink=b.mat('paint:lawson-red-stripe','#b05a65');
 finish(concrete,.91,0,.24);finish(blue,.6,.02,.3);finish(pink,.65,.01,.28);
 const inside=b.mat('interior:wall','#ecdab1'),tile=b.mat('interior:floor','#d0c7ac'),shelf=finish(b.mat('interior:steel-shelf','#b6c5bc',{metalness:.12,roughness:.61}),.61,.12,.28);
 const recess=b.mat('interior:recess','#323e3d'),ceiling=b.mat('interior:ceiling','#d0d2c4');
 const glass=finish(b.mat('glass:shop-window','#a4c4cc',{transparent:true,opacity:.10,roughness:.13,depthWrite:false}),.13,0,.56);
 b.box([0,.28,-2],[13,.12,6.2],tile);
 b.box([0,2.1,-5.05],[13,3.7,.18],concrete);b.box([-6.5,2.1,-2],[.18,3.7,6.3],concrete);b.box([6.5,2.1,-2],[.18,3.7,6.3],concrete);
 b.box([0,2.02,-4.945],[12.62,3.28,.025],inside);b.box([0,3.84,-1.92],[12.64,.035,6.1],ceiling);
 b.box([0,3.97,-2],[13.6,.18,6.9],concrete);b.box([0,4.13,-2],[13.7,.1,7],dark);
 for(let x=-6;x<=6;x+=1.5)b.box([x,2.0,-4.91],[.025,3.3,.02],recess);
 // Recognizable luminous white fascia with blue band and fine rose stripe.
 b.box([0,3.45,1.48],[13,.8,.2],silver);
 b.sign('LAWSON',12.8,.72,[0,3.45,1.59],{emissive:true,draw(c,w,h){c.fillStyle='#f1f1e8';c.fillRect(0,0,w,h);c.fillStyle='#245bb1';c.fillRect(0,h*.42,w,h*.16);c.fillStyle='#c15a71';c.fillRect(0,h*.8,w,h*.055);c.fillStyle='#f1f1e8';c.fillRect(w*.32,0,w*.36,h);c.fillStyle='#245bb1';c.font='bold 50px Georgia';c.textAlign='center';c.textBaseline='middle';c.fillText('LAWSON',w*.5,h*.43,w*.34);}});
 for(const x of [-6.3,-4.7,-3.1,3.1,4.7,6.3])b.box([x,3.45,1.605],[.014,.73,.018],dark);
 for(const y of [3.055,3.845])b.box([0,y,1.607],[13,.025,.035],silver);
 for(const x of [-6.485,6.485])b.box([x,3.45,1.6],[.045,.8,.07],dark);
 // Return the illuminated fascia around the corners. The entrance cornice has
 // a shadowed soffit and a bright rolled aluminium drip edge.
 for(const side of [-1,1]){
  for(const [cy,h,material] of [[3.48,.67,white],[3.47,.13,blue],[3.24,.037,pink]]){
   b.box([side*(6.51+(material===white?0:.012)),cy,.96],[.045,h,1.25],material);
  }
 }
 b.box([0,3.038,1.39],[13.05,.066,.57],dark);
 b.box([0,3.015,1.676],[13.05,.04,.055],silver);
 const pane=(x,width,z=1.32)=>b.mesh(b.own(new T.PlaneGeometry(width,2.48)),glass,[x,1.72,z]);
 // Fixed glazing stops at the entrance jambs. The slid-open leaves sit over
 // the adjacent bays, leaving a genuinely open, recessed path into the shop.
 for(const edges of [[-6.45,-5.15,-3.85,-2.55,-1.25,.05,.65],[3.25,4.55,5.85,6.45]]){
  for(let i=0;i<edges.length;i++)b.box([edges[i],1.72,1.36],[.055,2.65,.11],silver);
  for(let i=1;i<edges.length;i++){const width=edges[i]-edges[i-1]-.06,x=(edges[i]+edges[i-1])/2;pane(x,width);b.box([x,1.15,1.39],[width,.055,.017],blue);}
  b.box([(edges[0]+edges.at(-1))/2,.42,1.36],[edges.at(-1)-edges[0],.13,.12],silver);
 }
 b.box([0,2.65,1.36],[13,.055,.11],silver);
 for(const [name,x]of [['left',.03],['right',3.87]]){
  keep(pane(x,1.16,1.465),'open-door-'+name);
  for(const dx of [-.59,.59])b.box([x+dx,1.72,1.48],[.045,2.56,.08],silver);
  for(const y of [.44,2.99])b.box([x,y,1.48],[1.22,.045,.08],silver);
  b.box([x,1.15,1.51],[1.16,.055,.018],blue);
 }
 for(const x of [.63,3.27]){b.box([x,1.61,1.18],[.09,2.55,.3],dark);b.box([x,1.6,1.41],[.06,2.55,.05],silver);}
 b.box([1.95,2.96,1.43],[2.72,.16,.28],dark);b.box([1.95,2.86,1.59],[.24,.075,.065],recess);
 keep(b.box([1.95,.285,1.31],[2.55,.11,.5],tile),'entrance-threshold');
 b.sign('いらっしゃいませ',2.4,.28,[1.95,2.71,1.48],{bg:'#f5ecd1',fg:'#305f8d',size:70});
 b.box([1.95,3.01,1.659],[2.52,.46,.091],dark);
 b.sign('からあげクン',2.5,.45,[1.95,3.01,1.707],{bg:'#952b24',fg:'#fff0ba',size:95});
 const packages=['#eee0b9','#d16b56','#8dad61','#edc361','#729db2'].map((c,i)=>b.mat('interior:paper-package-'+i,c));
 for(const z of [-2.8,-.5])for(const x of [-3.6,-.7]){
  b.box([x,.4,z],[2.25,.2,.65],shelf);b.box([x,1.1,z-.3],[2.25,1.55,.045],shelf);
  for(const dx of [-1.1,1.1])b.box([x+dx,1.1,z],[.045,1.55,.65],shelf);
  for(let row=0;row<4;row++){
   const y=.5+row*.34;b.box([x,y,z],[2.3,.045,.67],shelf);b.box([x,y+.005,z+.35],[2.28,.07,.025],inside);
   for(let n=0;n<13;n++){
    const xx=x-1.02+n*.17,brand=(Math.floor(n/3)+row)%5,height=[.24,.20,.26,.18,.22][brand];
    b.box([xx,y+.025+height/2,z+.17],[.135,height,.22],packages[brand]);
    b.box([xx,y+.035+height*.57,z+.285],[.092,.05,.005],inside);
   }
  }
 }
 for(let n=0;n<7;n++){
  const x=-5.6+n*1.2;b.box([x,1.55,-4.84],[1.1,2.3,.06],recess);
  for(const dx of [-.55,.55])b.box([x+dx,1.55,-4.56],[.04,2.34,.6],silver);
  for(const y of [.4,2.7])b.box([x,y,-4.56],[1.1,.05,.6],silver);
  b.mesh(b.own(new T.PlaneGeometry(1.03,2.15)),glass,[x,1.55,-4.245]);
  b.box([x,2.61,-4.37],[1.03,.035,.04],ceiling);
  for(let row=0;row<4;row++){b.box([x,.5+row*.46,-4.58],[1.02,.025,.42],shelf);for(let k=0;k<5;k++)b.cylinderAt([x-.4+k*.2,.68+row*.46,-4.45],.055,.25,packages[(k+row)%5]);}
 }
 b.box([4.7,.88,-.3],[2.1,1.05,.9],inside);b.box([4.7,1.44,-.3],[2.2,.07,1],dark);b.box([4.45,1.72,-.3],[.5,.4,.1],dark);
 const diffuser=b.mat('lamp:lawson-fluorescent-tube','#edf4f4',{emissive:'#eff7fb'});
 b.lamps.push({material:diffuser,day:.9,night:1.12});
 const tube=b.own(new T.CylinderGeometry(.027,.027,2.65,8));tube.rotateZ(Math.PI/2);
 for(const x of [-4,0,4]){
  for(const z of [.47,-2.83]){
   b.box([x,3.75,z],[2.83,.07,.31],silver);
   for(const dz of [-.087,.087])b.mesh(tube,diffuser,[x,3.686,z+dz]);
  }
  if(x!==0){
   const light=new T.SpotLight('#f0f7ff',64,7.4,1.18,.78,2);
   light.name='lawson:merchandise-fluorescent';light.position.set(x,3.64,.47);
   light.target.position.set(x*.89,.88,-1.8);
   b.root.add(light,light.target);b.lamps.push({light,intensity:64,day:.78,night:.90});
  }
 }
 // Reflected light from the pale aisle floor reaches the ceiling and the
 // shadowed side of the shelves. Its range ends inside the shop frontage.
 const aisleBounce=new T.PointLight('#ecf0e3',27,5.1,2);
 aisleBounce.name='lawson:aisle-bounce';aisleBounce.position.set(-.9,1.85,-2.05);
 b.root.add(aisleBounce);b.lamps.push({light:aisleBounce,intensity:27,day:.68,night:1});
 b.box([1.95,2.935,1.18],[2.45,.04,.12],diffuser);
 entranceLight(b,[1.95,2.88,1.08],[1.95,.22,3.17],{intensity:55,range:6.2});
 // Parcel locker and window notices from the reference's street-level scale.
 b.box([7.55,1.35,.2],[1.6,2.3,.7],blue);for(let row=0;row<4;row++)for(let col=0;col<3;col++){b.box([7.05+col*.5,.55+row*.48,.565],[.47,.44,.028],blue);b.box([7.18+col*.5,.55+row*.48,.59],[.1,.018,.02],silver);}
 b.sign('荷物のお受け取り',1.42,.25,[7.55,2.37,.57],{bg:'#22588a',fg:'#e7eceb',size:85});
 for(let x of [-4.5,-1.8,4.9])b.sign('新発売\nおにぎり',.5,.65,[x,1.85,1.4],{bg:'#e7d1a0',fg:'#a34635',size:140});
 const stop=b.own(new RoundedBoxGeometry(1.34,.17,.255,1,.045));
 for(let n=0;n<5;n++){
  const x=-8+n*4;b.box([x,.054,6.1],[.075,.014,4.1],white);
  if(n<4){b.mesh(stop,concrete,[x+1.65,.12,4.85]);for(const dx of [-.48,.48])b.box([x+1.65+dx,.168,4.976],[.12,.04,.014],white);}
 }
 const tactile=b.mat('paving:tactile-tile','#baa05c'),rib=b.mat('stone:tactile-ridges','#cfb65e');
 b.box([-.28,.239,2.67],[16.44,.016,.36],tactile);
 for(let i=0;i<52;i++)for(const dz of [-.105,0,.105])b.box([-8.32+i*.315,.25,2.67+dz],[.269,.013,.038],rib);
 for(let i=0;i<4;i++)for(const dx of [-.105,0,.105])b.box([1.95+dx,.25,2.37-i*.24],[.038,.013,.20],rib);
 const planter=b.mat('stone:planter','#777a69');
 for(const [x,z]of [[-9,1.5],[9,-4]]){b.box([x,.25,z],[1.8,.5,1.8],planter);b.tree(x,z,4.4,1.25);b.shrubs(x,z,1.6,1.6,.5);}
 b.cylinderAt([-9,3.1,-3],.075,6.2,silver);b.box([-9,5.5,-3],[1.35,1.65,.15],silver);b.sign('LAWSON',1.28,1.55,[-9,5.5,-2.91],{bg:'#2464a2',fg:'#ffffff',size:125,emissive:true});
 b.box([4.6,.55,2],[.5,.8,.48],dark);b.box([5.25,.55,2],[.5,.8,.48],dark);
 b.box([0,.04,8.6],[23,.015,.11],white);
 for(let x=-26;x<26;x+=5.1)b.box([x,.045,12.44],[2.55,.013,.087],white);
 serviceCover(b,dark);
 oppositeSidewalk(b,{edgeY:.035,edgeZ:16.24,paving:b.mat('paving:opposite-footway','#c9ab8c'),curb:concrete,iron:dark,halfWidth:33.9});
 parkedBicycle(b,b.mat('paint:ochre-cycle-frame','#cc8f3f'),dark,silver);
 addStreetContext(b,{kind:'lawson'});
 pavementTree(b,dark);
 // Refined square urban block diorama plinth: road, curbs, sidewalks, and
 // neighbourhood buildings terminate cleanly on a 68x59 architectural base.
 const blockW=68,blockD=59,blockZ=-4.5;
 b.plinth(blockW,blockD,'#5b5850',{depth:2.15,topY:.028,z:blockZ});
 const roadSlab=b.own(new T.PlaneGeometry(blockW,blockD));roadSlab.rotateX(-Math.PI/2);
 keep(b.mesh(roadSlab,road,[0,.035,blockZ]),'diorama-road');
 for(const [left,right,suffix] of [[-33.9,8.85,''],[12.95,33.9,'-east']]){
  const center=(left+right)/2;
  keep(b.box([center,.13,-1.7],[right-left,.2,9.6],paving),'diorama-sidewalk'+suffix);
  keep(b.box([center,.13,3.16],[right-left,.26,.12],concrete),'diorama-curb'+suffix);
 }
 const api=b.finish({w:blockW,d:blockD,photo:{position:[0,2.35,14.0],target:[0,2.05,-.8],fov:44},companion:{position:[0,2.55,15.4],target:[0,2.05,-.8],fov:44},overview:[-.55,.62,1.05],background:'#b3c4cf'});
 gutterReflection(b,api,{x:-.2,y:.047,z:4.28});
 api.root.userData.lawsonStreet={frontAxis:'+z',groundY:.035,sidewalkY:.23,diorama:{width:blockW,depth:blockD,centerZ:blockZ},doorOpening:{minX:.68,maxX:3.22,minY:.34,maxY:2.65,z:1.4}};
 return api;
}
