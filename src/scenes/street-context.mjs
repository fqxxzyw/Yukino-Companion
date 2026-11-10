import * as T from 'three';

// Authored neighbourhood context: distinct rooflines, inhabited upper floors and
// side streets, rather than a flat skyline image or isolated display buildings.
// The geometry suggests an ordinary Japanese shopping street, not a surveyed map.
export function addStreetContext(b,{kind='bookshop'}={}){
 const lawson=kind==='lawson',root=b.group('street-context:'+kind),records=[];
 const keep=(mesh,name)=>{mesh.name='street-context:'+name;mesh.userData.keep=true;return mesh;};
 const finish=(material,values)=>{material.userData.surfaceFinish=values;return material;};
 const plaster=['#a9aaa0','#b4afa0','#949f9e','#b8b6aa','#858f93'].map((color,i)=>finish(b.mat('wall:neighbour-plaster-'+i,color),{roughness:.96,metalness:0,envMapIntensity:.12}));
 const recess=b.mat('interior:neighbour-window-depth','#202c30',{roughness:.97});
 const coating=finish(b.mat('paint:neighbour-railings','#566064'),{roughness:.82,metalness:.04,envMapIntensity:.18});
 const aluminium=finish(b.mat('metal:neighbour-window-frames','#8f9694'),{roughness:.5,metalness:.62,envMapIntensity:.32});
 const concrete=finish(b.mat('concrete:neighbour-balcony','#9b9c92'),{roughness:.94,metalness:0});
 const roof=finish(b.mat('paint:neighbour-roof','#566165'),{roughness:.91,metalness:.025});
 const glass=finish(b.mat('glass:neighbour-windows','#778e98',{transparent:true,opacity:.32,depthWrite:false}),{roughness:.26,metalness:0,envMapIntensity:.27});
 const curtains=[b.mat('interior:neighbour-linen','#aba897'),b.mat('interior:neighbour-curtain-shade','#687578')];
 const lit=[['#d4b67d','#e8be79'],['#b5b6a0','#cbd2bc']].map(([color,emissive],i)=>{
  const material=b.mat('interior:neighbour-occupied-window-'+i,color,{emissive,emissiveIntensity:0,roughness:.94});b.lamps.push({material,day:0,night:.72});return material;
 });
 const pipe=finish(b.mat('paint:neighbour-drainpipes','#62696a'),{roughness:.87,metalness:.03});
 const lane=b.mat('asphalt:neighbour-side-street','#5e6768'),curb=b.mat('concrete:neighbour-curbs','#a2a397');
 const pavement=b.mat('paving:neighbour-sidewalk','#a6a599');

 function building({x,z,w,d,h,floors,palette=0,balconies=false,sloped=false,far=false}){
  const id=records.length,group=b.group('street-context:building-'+id,[0,0,0],root),front=z+d/2;
  records.push({id,x,z,width:w,depth:d,height:h,front,far});
  keep(b.box([x,h/2+.12,z],[w,h,d],plaster[palette%plaster.length],group),'building-shell-'+id);
  b.box([x,.3,front+.045],[w+.04,.36,.14],concrete,group);
  b.box([x,h+.14,z],[w+.22,.18,d+.22],roof,group);
  for(const xx of [x-w/2+.16,x+w/2-.16])b.box([xx,h+.34,z],[.12,.4,d+.14],concrete,group);
  const pitch=w/(w>8?4:3),columns=w>8?4:3,ww=Math.min(1.45,pitch*.66),storey=(h-.8)/floors;
  for(let floor=0;floor<floors;floor++){
   const y=.75+(floor+.5)*storey,wh=Math.min(1.65,storey*.61);
   b.box([x,y-wh/2-.13,front+.035],[w-.2,.09,.08],concrete,group);
   for(let col=0;col<columns;col++){
    const xx=x-w/2+(col+.5)*pitch;
    b.box([xx,y,front+.06],[ww+.18,wh+.18,.12],recess,group);
    const occupied=(id*7+floor*3+col)%5===0;
    b.box([xx,y,front+.132],[ww,wh,.018],occupied?lit[(id+col)%lit.length]:curtains[(floor+col)%2],group);
    b.box([xx,y,front+.159],[ww,wh,.018],glass,group);
    for(const edge of [-1,1])b.box([xx+edge*(ww+.09)/2,y,front+.19],[.055,wh+.16,.105],aluminium,group);
    b.box([xx,y,front+.205],[.045,wh,.06],aluminium,group);
    b.box([xx,y-wh/2-.07,front+.2],[ww+.19,.07,.24],concrete,group);
    if(!occupied&&col%2===0)b.box([xx+ww*.25,y,front+.144],[ww*.33,wh,.012],curtains[0],group);
   }
   if(balconies&&floor>0){
    const fy=y-wh/2-.18;
    b.box([x,fy,front+.46],[w-.35,.15,1.02],concrete,group);
    b.tube([x-w/2+.3,fy+1.04,front+.95],[x+w/2-.3,fy+1.04,front+.95],.027,coating,group);
    for(let xx=x-w/2+.3;xx<x+w/2-.15;xx+=.36)b.box([xx,fy+.58,front+.95],[.027,.94,.035],coating,group);
    for(const side of [-1,1])b.box([x+side*(w/2-.27),fy+.57,front+.48],[.04,.95,.98],coating,group);
    if(floor%2===0)b.box([x-w*.24,fy+.38,front+.5],[.75,.55,.35],plaster[(palette+2)%plaster.length],group);
   }
  }
  b.tube([x+w/2-.1,.4,front+.26],[x+w/2-.1,h-.15,front+.26],.046,pipe,group);
  for(let y=.7;y<h;y+=2.4)b.box([x+w/2-.1,y,front+.27],[.14,.055,.14],aluminium,group);
  // Rooftop service equipment and setbacks break up the block silhouettes.
  b.box([x-w*.2,h+.51,z-.3],[w*.29,.65,d*.29],plaster[(palette+2)%plaster.length],group);
  for(let fin=0;fin<5;fin++)b.box([x-w*.31+fin*w*.055,h+.51,z-.3+d*.145+.016],[.026,.43,.035],coating,group);
  if(sloped){
   for(const side of [-1,1]){const panel=b.box([x+side*w*.25,h+.65,z],[w*.57,.09,d+.4],roof,group);panel.rotation.z=-side*.22;}
  }
  if(!far&&id%2===0){
   const awning=b.box([x,.98,front+.4],[w*.68,.1,.8],coating,group);awning.rotation.x=.08;
   b.box([x,.61,front+.025],[w*.57,.8,.08],recess,group);
  }
 }

 const near=lawson?[
  [-29,-13,8,7,13,4,2,true],[-18,-10,7,6,10,3,0,false],[-8,-16,7,7,13,4,1,true],
  [2,-18,8,8,17,5,2,true],[17,-12,6,7,12,4,3,false],[26,-14,8,8,15,5,0,true],[36,-12,8,7,12,4,4,false],
 ]:[
  [-30,-12,8,7,12,4,2,true],[-19,-12,8,7,15,5,1,true],[-10,-17,6,7,11,3,3,false],
  [-3.8,-21,5.6,7,15,5,2,false],[7.2,-17,7,7,13,4,0,true],[17,-14,8,8,17,5,2,true],[28,-13,8,7,13,4,3,false],[38,-16,8,7,16,5,4,true],
 ];
 for(const [x,z,w,d,h,floors,palette,balconies]of near)building({x,z,w,d,h,floors,palette,balconies});
 for(const [i,x]of [-42,-29,-16,-3,10,23,36,49].entries())building({x,z:-34-(i%3)*2,w:11.5,d:8,h:15+(i%4)*2.2,floors:5+(i%2),palette:(i+2)%5,far:true,balconies:false});
 for(const [x,z,w,d,h,palette]of lawson?[[-14,-2.5,5.5,6,8,1],[17,-3,6,6,9,2]]:[[-20,-2,7,6,9,3],[20,-3,7,7,10,1]])building({x,z,w,d,h,floors:3,palette,sloped:true});

 const laneX=lawson?10.9:1.0,laneWidth=lawson?4.1:4.0;
 b.box([laneX,.035,-10],[laneWidth,.07,34],lane,root);
 for(const side of [-1,1]){
  b.box([laneX+side*(laneWidth/2+.6),.095,-10],[1.1,.15,34],pavement,root);
  b.box([laneX+side*(laneWidth/2+.07),.115,-10],[.13,.23,34],curb,root);
 }
 for(const [i,z]of [-4,-14,-24].entries()){
  const x=laneX-laneWidth/2-.55,h=7.5+(i%2)*.7;
  b.cylinderAt([x,h/2,z],.09,h,concrete,root);
  b.box([x,h-.65,z],[1.45,.1,.13],coating,root);
  for(const offset of [-.55,0,.55])b.cylinderAt([x+offset,h-.5,z],.065,.22,aluminium,root);
  if(i){
   for(const offset of [-.5,.1,.5]){
    const points=[];for(let j=0;j<=20;j++){const t=j/20;points.push(new T.Vector3(x+offset,h-.45-Math.sin(t*Math.PI)*.46,z+10*t));}
    const geometry=b.own(new T.TubeGeometry(new T.CatmullRomCurve3(points),20,.017,4,false));b.mesh(geometry,coating,[0,0,0],[1,1,1],root);
   }
  }
 }
 for(const [x,z]of lawson?[[-10,4.4],[10,-9]]:[[-14,5.7],[13,-5]]){
  b.cylinderAt([x,2.45,z],.054,4.9,coating,root);b.tube([x,4.86,z],[x+.45,4.86,z],.04,coating,root);
  b.box([x+.45,4.84,z],[.65,.14,.26],coating,root);b.lamp([x+.45,4.73,z],{color:'#e9c995',intensity:18,range:7,radius:.13,parent:root});
 }
 const vending=finish(b.mat('paint:neighbour-vending','#9dabb0'),{roughness:.81,metalness:.035});
 for(const [x,z]of lawson?[[-10.7,-4.4],[14.4,-6]]:[[-14.8,1.2],[13.4,-3.1]]){
  b.box([x,1.0,z],[1.03,1.95,.7],vending,root);b.box([x,1.14,z+.36],[.8,1.02,.018],recess,root);
  for(let row=0;row<3;row++)for(let col=0;col<4;col++)b.cylinderAt([x-.27+col*.18,.87+row*.22,z+.39],.05,.15,curtains[(col+row)%2],root);
  b.box([x,.3,z+.36],[.67,.16,.025],coating,root);b.box([x+.36,.7,z+.37],[.07,.35,.025],aluminium,root);
 }
 root.userData.buildings=records;
 root.userData.contextKind=kind;
 b.root.userData.streetContext={kind,buildings:records,laneX,laneWidth};
 return root;
}
