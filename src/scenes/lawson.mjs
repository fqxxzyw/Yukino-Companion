import * as T from 'three';
import {Diorama} from './diorama-kit.mjs';
import {addStreetContext} from './street-context.mjs';

export function createScene({scene,renderer}){
 const b=new Diorama(scene,renderer,'Lawson_Neighbourhood');
 const finish=(material,roughness,metalness=0,envMapIntensity=.35)=>{material.userData.surfaceFinish={roughness,metalness,envMapIntensity};return material;};
 const keep=(mesh,name)=>{mesh.name='lawson:'+name;mesh.userData.keep=true;return mesh;};
 const concrete=b.mat('wall:mineral-render','#c5c8c4'),road=b.mat('asphalt:road','#50565a'),paving=b.mat('paving:sidewalk','#aeafa5');
 const dark=finish(b.mat('metal:roof-edge','#414b4f',{metalness:.04,roughness:.67}),.67,.04,.28),silver=finish(b.mat('metal:aluminium-frame','#a8b2b0',{metalness:.7,roughness:.42}),.42,.7,.48),white=b.mat('paint:road-markings','#dad9c9');
 const blue=b.mat('paint:lawson-blue','#1c5c9e'),pink=b.mat('paint:lawson-red-stripe','#b05a65');
 finish(concrete,.91,0,.24);finish(blue,.6,.02,.3);finish(pink,.65,.01,.28);
 const inside=b.mat('interior:wall','#8e9485'),tile=b.mat('interior:floor','#9b9f90'),shelf=finish(b.mat('interior:steel-shelf','#8d958d',{metalness:.03,roughness:.76}),.76,.03,.22);
 const recess=b.mat('interior:recess','#323e3d'),ceiling=b.mat('interior:ceiling','#aeb3a6');
 const glass=finish(b.mat('glass:shop-window','#68818b',{transparent:true,opacity:.15,roughness:.21,depthWrite:false}),.21,0,.27);
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
 b.sign('からあげクン',2.5,.45,[1.95,3.01,1.62],{bg:'#952b24',fg:'#fff0ba',size:95});
 const packages=['#ddd3b1','#a75c50','#7e956d','#d7ba63','#718795'].map((c,i)=>b.mat('interior:paper-package-'+i,c));
 for(const z of [-2.8,-.5])for(const x of [-3.6,-.7]){
  b.box([x,.4,z],[2.25,.2,.65],shelf);b.box([x,1.1,z-.3],[2.25,1.55,.045],shelf);
  for(const dx of [-1.1,1.1])b.box([x+dx,1.1,z],[.045,1.55,.65],shelf);
  for(let row=0;row<4;row++){const y=.5+row*.34;b.box([x,y,z],[2.3,.045,.67],shelf);b.box([x,y+.005,z+.35],[2.28,.07,.025],inside);for(let n=0;n<13;n++){const xx=x-1.02+n*.17;b.box([xx,y+.15,z+.17],[.12,.25,.22],packages[(n+row)%5]);b.box([xx,y+.15,z+.285],[.08,.07,.005],inside);}}
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
 for(const x of [-4,0,4]){b.box([x,3.65,-2],[2.8,.06,.12],inside);b.lamp([x,3.58,-1.5],{color:'#f4ead1',intensity:24,range:7,radius:.5});}
 // Parcel locker and window notices from the reference's street-level scale.
 b.box([7.55,1.35,.2],[1.6,2.3,.7],blue);for(let row=0;row<4;row++)for(let col=0;col<3;col++){b.box([7.05+col*.5,.55+row*.48,.565],[.47,.44,.028],blue);b.box([7.18+col*.5,.55+row*.48,.59],[.1,.018,.02],silver);}
 b.sign('荷物のお受け取り',1.42,.25,[7.55,2.37,.57],{bg:'#22588a',fg:'#e7eceb',size:85});
 for(let x of [-4.5,-1.8,4.9])b.sign('新発売\nおにぎり',.5,.65,[x,1.85,1.4],{bg:'#e7d1a0',fg:'#a34635',size:140});
 for(let n=0;n<5;n++){const x=-8+n*4;b.box([x,.06,6.1],[.075,.018,4.1],white);b.box([x+1.4,.14,4.85],[1.3,.18,.24],concrete);}
 for(let x=-8;x<9;x+=.22)b.box([x,.255,3.25],[.12,.025,.48],b.tactile??=b.mat('stone:tactile','#b3a467'));
 const planter=b.mat('stone:planter','#777a69');
 for(const [x,z]of [[-9,1.5],[9,-4]]){b.box([x,.25,z],[1.8,.5,1.8],planter);b.tree(x,z,4.4,1.25);b.shrubs(x,z,1.6,1.6,.5);}
 b.cylinderAt([-9,3.1,-3],.075,6.2,silver);b.box([-9,5.5,-3],[1.35,1.65,.15],silver);b.sign('LAWSON',1.28,1.55,[-9,5.5,-2.91],{bg:'#2464a2',fg:'#ffffff',size:125,emissive:true});
 b.box([4.6,.55,2],[.5,.8,.48],dark);b.box([5.25,.55,2],[.5,.8,.48],dark);
 b.box([0,.04,8.6],[23,.015,.11],white);
 addStreetContext(b,{kind:'lawson'});
 const api=b.finish({w:38,d:42,photo:{position:[0,2.8,19],target:[0,2.25,-1],fov:46},companion:{position:[0,3,21],target:[0,2.25,-1],fov:46},overview:[0,.38,1],background:'#b3c4cf'});
 // The street continues beyond the view; its distant boundary must not become
 // part of the finite architecture bounds used for gallery framing.
 const ground=b.own(new T.PlaneGeometry(600,600));ground.rotateX(-Math.PI/2);
 keep(b.mesh(ground,road,[0,.035,0]),'continuous-road');
 keep(b.box([0,.13,-1.7],[140,.2,9.6],paving),'continuous-sidewalk');
 keep(b.box([0,.13,3.16],[140,.26,.12],concrete),'continuous-curb');
 api.root.userData.lawsonStreet={frontAxis:'+z',groundY:.035,sidewalkY:.23,doorOpening:{minX:.68,maxX:3.22,minY:.34,maxY:2.65,z:1.4}};
 return api;
}
