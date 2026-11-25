import * as T from 'three';

// Authored neighbourhood context: distinct building archetypes, varied window
// rhythms, rooflines, balconies, awnings and everyday Japanese street fixtures.
// All static boxes/tubes share the scene palette so Diorama batches them cleanly.
export function addStreetContext(b,{kind='bookshop'}={}){
 const lawson=kind==='lawson',root=b.group('street-context:'+kind),records=[];
 const keep=(mesh,name)=>{mesh.name='street-context:'+name;mesh.userData.keep=true;return mesh;};
 const finish=(material,values)=>{material.userData.surfaceFinish=values;return material;};
 const wallColors=lawson
  ? ['#e7d4ac','#dfaa87','#a2c7bb','#f2dfad','#afc4d2']
  : ['#dfd4bc','#cb9a7e','#9cb8b3','#e3d2ab','#a3b6c2'];
 const plaster=wallColors.map((color,i)=>finish(b.mat('wall:neighbour-plaster-'+i,color),{roughness:.96,metalness:0,envMapIntensity:.12}));
 for(const [i,cladding] of ['render','brick','siding','render','panel'].entries())plaster[i].userData.cladding=cladding;
 const recess=b.mat('interior:neighbour-window-depth','#1c262a',{roughness:.97});
 const coating=finish(b.mat('paint:neighbour-railings','#4d575b'),{roughness:.82,metalness:.04,envMapIntensity:.18});
 const bronze=finish(b.mat('paint:neighbour-sash-dark','#3c3834'),{roughness:.76,metalness:.08,envMapIntensity:.22});
 const aluminium=finish(b.mat('metal:neighbour-window-frames','#939a98'),{roughness:.48,metalness:.64,envMapIntensity:.34});
 const concrete=finish(b.mat('concrete:neighbour-balcony',lawson?'#d2cbb4':'#c8c2b0'),{roughness:.94,metalness:0});
 const acBody=finish(b.mat('paint:neighbour-ac-unit','#d7d4c8'),{roughness:.84,metalness:.06,envMapIntensity:.2});
 const roof=finish(b.mat('paint:neighbour-roof',lawson?'#4d6369':'#4b5c62'),{roughness:.91,metalness:.025});
 const warmRoof=finish(b.mat('paint:neighbour-roof-terracotta','#6d5248'),{roughness:.9,metalness:.02});
 const glass=finish(b.mat('glass:neighbour-windows','#728c98',{transparent:true,opacity:.31,depthWrite:false}),{roughness:.24,metalness:0,envMapIntensity:.32});
 const frosted=finish(b.mat('glass:neighbour-frosted','#b5c4c7',{transparent:true,opacity:.68,depthWrite:false}),{roughness:.58,metalness:0,envMapIntensity:.22});
 const curtains=[
  b.mat('interior:neighbour-linen',lawson?'#e8d4b2':'#dfd2b6'),
  b.mat('interior:neighbour-curtain-shade',lawson?'#7898a6':'#748d98'),
  b.mat('interior:neighbour-blinds','#c8c5b6'),
 ];
 const lit=[['#d9b97e','#ebbf76'],['#b9bc9f','#d2d9be'],['#dfaa76','#f0b46e']].map(([color,emissive],i)=>{
  const material=b.mat('interior:neighbour-occupied-window-'+i,color,{emissive,emissiveIntensity:0,roughness:.94});b.lamps.push({material,day:0,night:.76});return material;
 });
 const pipe=finish(b.mat('paint:neighbour-drainpipes','#5c6365'),{roughness:.87,metalness:.03});
 const lane=b.mat('asphalt:neighbour-side-street','#5e6768'),curb=b.mat('concrete:neighbour-curbs','#a2a397');
 const pavement=b.mat('paving:neighbour-sidewalk','#a6a599');
 const canvas=[
  b.mat('fabric:awning-ochre',lawson?'#cc854d':'#bc7c4e'),
  b.mat('fabric:awning-teal',lawson?'#46857e':'#4b7c75'),
  b.mat('fabric:awning-linen',lawson?'#f4e4bd':'#eadcc0'),
  b.mat('fabric:awning-berry','#9f5650'),
 ];
 const planterLeaves=[];
 const clay=b.mat('ceramic:balcony-terracotta','#bd7855');

 // A folded towel follows the outside and inside faces of the balcony rail.
 function railLinen(x,y,z,width,fabric,group){
  const vertices=[],uvs=[],indices=[],fold=[[0,-.18],[.07,.018],[.12,0],[.13,-.28],[.16,-.57]];
  for(let col=0;col<=7;col++){
   const u=col/7;
   for(const [row,[depth,drop]] of fold.entries()){
    const ripple=Math.sin(u*15+.6)*.035*row/4;
    vertices.push((u-.5)*width,drop+(row===4?Math.sin(u*11)*.025:0),depth+ripple);
    uvs.push(u,row/(fold.length-1));
    if(col&&row){
     const a=(col-1)*fold.length+row-1,c=a+fold.length;
     indices.push(a,a+1,c,a+1,c+1,c);
    }
   }
  }
  const g=b.own(new T.BufferGeometry());
  g.setAttribute('position',new T.Float32BufferAttribute(vertices,3));g.setIndex(indices);g.computeVertexNormals();
  g.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));
  b.mesh(g,fabric,[x,y,z],[1,1,1],group);
 }

 function streetAwning(x,y,front,width,fabric,group){
  const projection=.96,drop=.38,angle=Math.atan2(drop,projection);
  for(let panel=0;panel<9;panel++){
   const cx=x+width*((panel+.5)/9-.5),material=panel%3===1?canvas[2]:fabric;
   const cover=b.box([cx,y-drop/2,front+projection/2],[width/9,.045,Math.hypot(projection,drop)],material,group);
   cover.rotation.x=angle;
   b.box([cx,y-drop-.105,front+projection],[width/9,.21,.04],material,group);
  }
  for(const side of [-1,1]){
   const end=x+side*(width/2-.14);
   b.tube([end,y-.73,front],[end,y-drop-.04,front+projection-.02],.021,coating,group);
  }
 }

 function balconyGarden(cx,y,z,group){
  b.box([cx,y+.13,z],[1.22,.26,.34],clay,group);
  b.box([cx,y+.27,z],[1.26,.05,.38],clay,group);
  for(let stem=0;stem<10;stem++){
   const x=cx-.48+stem*.105,height=.19+.13*Math.sin(stem*2.13);
   for(let k=0;k<7;k++){
    const a=k*2.4+stem,zOffset=Math.sin(a)*.12;
    planterLeaves.push({x:x+Math.cos(a)*.11,y:y+.30+height*(k/7),z:z+zOffset,
     size:.125+(k%3)*.02,ry:a,rx:.6+k*.22,center:[x,y+.38,z]});
   }
  }
 }

 function acUnit(cx,y,z,group){
  b.box([cx,y+.26,z],[.72,.52,.30],acBody,group);
  b.box([cx-.12,y+.26,z+.155],[.34,.34,.02],recess,group);
  b.box([cx+.20,y+.31,z+.155],[.14,.22,.02],coating,group);
  for(const dx of [-.24,.24])b.box([cx+dx,y+.02,z],[.08,.05,.32],coating,group);
 }

 // Individualized window renderer: supports sliding patio doors, 3-pane ribbon
 // sashes, 4-pane Showa cafe frames with rain hoods, tall narrow casements,
 // venetian blinds, half-drawn drapes and frosted stairwell/utility glazing.
 function frontWindow({x,y,front,ww,wh,style,frame,occupied,seed,group,hood=false,box=false}){
  const sash=frame==='bronze'?bronze:aluminium;
  const depth=style==='patio'?.16:.12;
  b.box([x,y,front+depth*.5],[ww+.16,wh+.16,depth],recess,group);
  const paneZ=front+depth+.026;
  const backMat=occupied?lit[seed%lit.length]:curtains[seed%2];
  if(style==='frosted'){
   b.box([x,y,front+depth+.012],[ww,wh,.018],occupied?lit[seed%lit.length]:curtains[2],group);
   b.box([x,y,paneZ+.005],[ww,wh,.018],frosted,group);
  }else{
   b.box([x,y,front+depth+.01],[ww,wh,.016],backMat,group);
   if(!occupied){
    const dress=seed%4;
    if(dress===0){
     // Half-drawn linen curtains on left & right edges.
     for(const s of [-1,1])b.box([x+s*ww*.31,y,front+depth+.019],[ww*.28,wh-.04,.012],curtains[0],group);
    }else if(dress===1){
     // Pulled-down venetian blind slats across upper half.
     b.box([x,y+wh*.22,front+depth+.02],[ww-.04,wh*.44,.012],curtains[2],group);
     for(let s=0;s<4;s++)b.box([x,y+wh*.06+s*wh*.10,front+depth+.025],[ww-.04,.014,.01],coating,group);
    }else if(dress===2){
     // Single side drape leaving one side dark recessed room.
     b.box([x+((seed&8)?1:-1)*ww*.26,y,front+depth+.019],[ww*.36,wh-.04,.012],curtains[1],group);
    }
   }
   b.box([x,y,paneZ],[ww,wh,.016],glass,group);
  }
  // Outer jambs, head and sill.
  const fz=front+depth+.055;
  for(const s of [-1,1])b.box([x+s*(ww*.5+.035),y,fz],[.055,wh+.14,.105],sash,group);
  b.box([x,y+wh*.5+.038,fz],[ww+.14,.055,.105],sash,group);
  if(style!=='patio')b.box([x,y-wh*.5-.062,fz+.015],[ww+.20,.072,.23],concrete,group);
  else b.box([x,y-wh*.5-.025,fz],[ww+.14,.055,.12],sash,group);

  // Mullion pattern per architectural style.
  if(style==='ribbon'||style==='patio'){
   const panes=ww>2.2?3:2;
   for(let p=1;p<panes;p++)b.box([x-ww*.5+ww*p/panes,y,fz+.012],[.042,wh,.06],sash,group);
   if(style==='ribbon')b.box([x,y+wh*.24,fz+.012],[ww,.038,.06],sash,group);
   if(style==='patio')b.box([x,y-wh*.06,fz+.012],[ww,.036,.06],sash,group);
  }else if(style==='grid'){
   b.box([x,y,fz+.012],[.038,wh,.055],sash,group);
   b.box([x,y+.06,fz+.012],[ww,.038,.055],sash,group);
   if(ww>1.35)b.box([x,y-wh*.24,fz+.012],[ww,.028,.048],sash,group);
  }else if(style==='tall'){
   b.box([x,y+wh*.22,fz+.012],[ww,.036,.055],sash,group);
  }else if(style==='frosted'){
   const bars=Math.max(2,Math.round(wh/.65));
   for(let bIdx=1;bIdx<bars;bIdx++)b.box([x,y-wh*.5+wh*bIdx/bars,fz+.012],[ww,.036,.055],sash,group);
  }else{
   // Offset 60/40 Japanese sliding window sash.
   b.box([x+ww*.08,y,fz+.012],[.042,wh,.06],sash,group);
  }

  // Projecting rain hood (hisashi) or small window flower box.
  if(hood){
   const visor=b.box([x,y+wh*.5+.13,front+.24],[ww+.34,.065,.40],frame==='bronze'?bronze:coating,group);
   visor.rotation.x=.14;
  }
  if(box&&style!=='patio'){
   b.box([x,y-wh*.5-.09,front+.27],[ww*.78,.16,.20],clay,group);
   for(let k=0;k<6;k++){
    const lx=x+(k/5-.5)*ww*.62;
    planterLeaves.push({x:lx,y:y-wh*.5+.03+(k%2)*.04,z:front+.28,size:.11+(k%3)*.018,ry:k*1.3,rx:.5,center:[x,y-wh*.5+.04,front+.28]});
   }
  }
 }

 function building({x,z,w,d,h,floors,palette=0,balconies=false,sloped=false,far=false,archetype=0}){
  const id=records.length,group=b.group('street-context:building-'+id,[0,0,0],root),front=z+d/2;
  records.push({id,x,z,width:w,depth:d,height:h,front,far});
  const arch=sloped?5:archetype;
  const frameStyle=(palette===1||arch===2||arch===5)?'bronze':'aluminium';
  const mainMat=plaster[palette%plaster.length];
  const accentMat=plaster[(palette+2)%plaster.length];

  // Main body & plinth skirt.
  keep(b.box([x,h/2+.12,z],[w,h,d],mainMat,group),'building-shell-'+id);
  b.box([x,.32,front+.045],[w+.05,.40,.14],concrete,group);
  // Subtle vertical pilaster/accent band on select modern mid-rises.
  if(!sloped&&(arch===0||arch===3)){
   for(const s of [-1,1])b.box([x+s*(w*.5-.16),h/2+.12,front+.04],[.28,h-.2,.09],concrete,group);
  }
  if(!sloped&&arch===1){
   // Vertical stairwell accent shaft on one edge.
   const side=id%2?1:-1;
   b.box([x+side*(w*.5-.82),h/2+.22,front+.05],[1.32,h+.15,.12],accentMat,group);
  }

  // Rooflines: sloped gable, stepped setback penthouse, water tank, or crisp cornice.
  b.box([x,h+.14,z],[w+.22,.18,d+.22],arch===2?warmRoof:roof,group);
  if(sloped){
   const rMat=id%2?warmRoof:roof;
   for(const side of [-1,1]){
    const panel=b.box([x+side*w*.25,h+.72,z],[w*.58,.10,d+.48],rMat,group);
    panel.rotation.z=-side*.24;
   }
   b.box([x,h+1.36,z],[.20,.16,d+.50],coating,group);
  }else if(arch===0){
   // Classic Japanese mid-rise parapet + offset stairwell penthouse & water tank.
   for(const xx of [x-w/2+.16,x+w/2-.16])b.box([xx,h+.36,z],[.14,.42,d+.14],concrete,group);
   b.box([x,h+.36,front+.02],[w+.10,.34,.14],concrete,group);
   const px=x+(id%2?1:-1)*w*.24;
   b.box([px,h+.95,z-.4],[w*.32,1.45,d*.36],accentMat,group);
   b.box([px,h+1.72,z-.4],[w*.35,.12,d*.40],roof,group);
   b.cylinderAt([x-(id%2?1:-1)*w*.22,h+.92,z-.2],.52,1.1,acBody,group);
   b.cylinderAt([x-(id%2?1:-1)*w*.22,h+1.50,z-.2],.56,.08,coating,group);
  }else if(arch===1){
   // Stepped setback upper penthouse terrace with steel parapet rail.
   b.box([x-w*.08,h+.95,z-.7],[w*.68,1.55,d*.62],mainMat,group);
   b.box([x-w*.08,h+1.78,z-.7],[w*.72,.14,d*.66],roof,group);
   b.tube([x-w*.46,h+.78,front+.04],[x+w*.46,h+.78,front+.04],.03,coating,group);
   for(let xx=x-w*.45;xx<=x+w*.46;xx+=.75)b.box([xx,h+.50,front+.04],[.03,.54,.03],coating,group);
  }else if(arch===2){
   // Mansard / overhanging tiled cornice with rooftop mechanical louver box.
   const eave=b.box([x,h+.24,front+.26],[w+.46,.22,.46],warmRoof,group);eave.rotation.x=.22;
   b.box([x+w*.18,h+.56,z-.3],[w*.30,.72,d*.32],accentMat,group);
   for(let fin=0;fin<5;fin++)b.box([x+w*.07+fin*w*.055,h+.56,z-.3+d*.16+.018],[.026,.46,.035],coating,group);
  }else{
   // Clean stepped concrete parapet + tall slim comms/vent mast.
   for(const xx of [x-w/2+.16,x+w/2-.16])b.box([xx,h+.34,z],[.12,.4,d+.14],concrete,group);
   b.box([x-w*.2,h+.51,z-.3],[w*.29,.65,d*.29],accentMat,group);
   b.cylinderAt([x+w*.28,h+1.1,z-.5],.035,1.8,aluminium,group);
  }

  const storey=(h-.8)/floors;
  for(let floor=0;floor<floors;floor++){
   const y=.78+(floor+.5)*storey,wh=Math.min(1.68,storey*.62);
   // Flank windows visible beside the side lanes.
   if(!far&&Math.abs(x)>5){
    const side=x<0?1:-1,wallX=x+side*w*.5;
    const sideLevels=sloped?1:2;
    for(let bay=0;bay<sideLevels;bay++){
     const wz=z+d*(sloped?.06:bay===0?-.23:.22),sww=sloped?.94:1.18,shh=wh*(bay===0?.78:.56);
     b.box([wallX+side*.030,y,wz],[.065,shh+.18,sww+.18],recess,group);
     b.box([wallX+side*.077,y,wz],[.025,shh,sww],curtains[(floor+bay+id)%3],group);
     b.box([wallX+side*.098,y,wz],[.018,shh,sww],glass,group);
     for(const end of [-1,1])b.box([wallX+side*.125,y,wz+end*(sww+.072)*.5],[.09,shh+.10,.052],frameStyle==='bronze'?bronze:aluminium,group);
     b.box([wallX+side*.128,y,wz],[.09,shh,.041],frameStyle==='bronze'?bronze:aluminium,group);
     b.box([wallX+side*.16,y-shh*.5-.068,wz],[.33,.078,sww+.31],concrete,group);
    }
   }

   // Horizontal spandrel stringcourse on select archetypes.
   if(arch===0||arch===3||floor===0){
    b.box([x,y-wh/2-.15,front+.04],[w-.16,.09,.09],concrete,group);
   }

   const hasBalcony=balconies&&floor>0&&!(arch===1&&floor===floors-1);
   const stairSide=id%2?1:-1;

   // Varied per-archetype & per-floor window rhythm!
   if(arch===0){
    // Wide commercial/apartment ribbon bays (2 wide windows instead of 3-4 narrow ones).
    const bays=w>9?3:2,pitch=(w-.9)/bays,ww=Math.min(2.65,pitch*.76);
    for(let col=0;col<bays;col++){
     const xx=x-(w-.9)/2+(col+.5)*pitch;
     const seed=id*13+floor*5+col*3;
     const occ=((id*7+floor*5+col*2)%7===0);
     frontWindow({x:xx,y:hasBalcony?y-.08:y,front,ww,wh:hasBalcony?wh*1.12:wh*.94,style:hasBalcony?'patio':'ribbon',frame:frameStyle,occupied:occ,seed,group,hood:!hasBalcony&&floor===floors-1});
    }
   }else if(arch===1){
    // Asymmetric apartment: narrow frosted stairwell window on one edge + 2 wide living windows.
    const sx=x+stairSide*(w*.5-.82);
    frontWindow({x:sx,y:y+.14,front,ww:.66,wh:wh*1.08,style:'frosted',frame:'aluminium',occupied:((id+floor)%3===0),seed:id+floor,group});
    const usableW=w-1.85,originX=x-stairSide*.78;
    const bays=usableW>5.4?2:1,pitch=usableW/bays,ww=Math.min(2.35,pitch*.74);
    for(let col=0;col<bays;col++){
     const xx=originX-usableW/2+(col+.5)*pitch;
     const seed=id*11+floor*7+col*5;
     const occ=((id*5+floor*3+col)%6===0);
     frontWindow({x:xx,y:hasBalcony?y-.08:y,front,ww,wh:hasBalcony?wh*1.10:wh*.92,style:hasBalcony?'patio':'sliding',frame:frameStyle,occupied:occ,seed,group,hood:!hasBalcony&&floor%2===1});
    }
   }else if(arch===2){
    // Showa brick/warm building: 4-pane divided cafe/atelier windows with rain hoods & occasional flower boxes.
    const cols=w>8.5?4:3,pitch=(w-.6)/cols,ww=Math.min(1.52,pitch*.64);
    for(let col=0;col<cols;col++){
     const xx=x-(w-.6)/2+(col+.5)*pitch;
     const seed=id*17+floor*3+col*7;
     const occ=((id*3+floor*7+col)%6===0);
     const tallCenter=(cols===3&&col===1&&floor===1);
     frontWindow({x:xx,y:hasBalcony?y-.06:y,front,ww:tallCenter?ww*1.14:ww,wh:hasBalcony?wh*1.08:wh*(tallCenter?1.04:.94),style:hasBalcony?'patio':'grid',frame:'bronze',occupied:occ,seed,group,hood:!hasBalcony,box:!hasBalcony&&!far&&floor===1&&col%2===0});
    }
   }else if(arch===3){
    // Modern tall narrow paired casement windows + small high utility window.
    const cols=w>8?4:3,pitch=(w-.8)/cols;
    for(let col=0;col<cols;col++){
     const xx=x-(w-.8)/2+(col+.5)*pitch;
     const seed=id*19+floor*5+col*2;
     const smallSlot=(col===cols-1&&floor%2===1);
     const ww=smallSlot?.68:Math.min(1.12,pitch*.56);
     const hNow=smallSlot?wh*.56:hasBalcony?wh*1.1:wh*1.04;
     const yNow=smallSlot?y+wh*.20:(hasBalcony?y-.08:y);
     frontWindow({x:xx,y:yNow,front,ww,wh:hNow,style:smallSlot?'frosted':hasBalcony?'patio':'tall',frame:'aluminium',occupied:((id*7+floor*2+col)%6===0),seed,group,hood:!hasBalcony&&!smallSlot&&floor>0});
    }
   }else if(arch===5){
    // Sloped-roof Japanese corner shop-house: 2 wide divided upper windows + 1 small side window on 2F, wide glazed bays on 3F.
    if(floor===0){
     frontWindow({x:x-w*.16,y:y-.05,front,ww:w*.46,wh:wh*1.02,style:'grid',frame:'bronze',occupied:true,seed:id+3,group});
     frontWindow({x:x+w*.28,y:y-.05,front,ww:w*.22,wh:wh*1.02,style:'tall',frame:'bronze',occupied:false,seed:id+7,group});
    }else if(floor===1){
     frontWindow({x:x-w*.22,y,front,ww:w*.36,wh:wh*.92,style:'grid',frame:'bronze',occupied:((id+floor)%3===0),seed:id*5+floor,group,hood:true,box:!far});
     frontWindow({x:x+w*.22,y,front,ww:w*.36,wh:wh*.92,style:'grid',frame:'bronze',occupied:false,seed:id*5+floor+2,group,hood:true});
    }else{
     for(const [k,dx] of [-.27,0,.27].entries()){
      frontWindow({x:x+w*dx,y,front,ww:w*.20,wh:wh*.82,style:k===1?'grid':'tall',frame:'bronze',occupied:k===1&&id%2===0,seed:id*9+k,group});
     }
    }
   }else{
    // Mixed asymmetric residential: alternates wide twin bays & triple bays per floor.
    const cols=(floor%2===0)?(w>7.5?3:2):(w>7.5?4:3);
    const pitch=(w-.7)/cols,ww=Math.min(1.65,pitch*.64);
    for(let col=0;col<cols;col++){
     const xx=x-(w-.7)/2+(col+.5)*pitch;
     const seed=id*23+floor*7+col*4;
     frontWindow({x:xx,y:hasBalcony?y-.06:y,front,ww,wh:hasBalcony?wh*1.08:wh*.94,style:hasBalcony?'patio':(floor%2===0?'ribbon':'sliding'),frame:frameStyle,occupied:((id*5+floor*3+col)%7===0),seed,group,hood:!hasBalcony&&floor%2===1});
    }
   }

   // Varied balconies: solid concrete parapet on some buildings, open steel rail on others, plus AC units & plants.
   if(hasBalcony){
    const fy=y-wh/2-.18;
    const balcX=arch===1?x-stairSide*.78:x;
    const balcW=arch===1?w-1.95:w-.35;
    b.box([balcX,fy,front+.46],[balcW,.15,1.02],concrete,group);
    const solidBalcony=(arch===0||(arch===2&&floor%2===1));
    if(solidBalcony){
     b.box([balcX,fy+.52,front+.92],[balcW-.12,.86,.10],concrete,group);
     b.tube([balcX-balcW/2+.10,fy+1.04,front+.92],[balcX+balcW/2-.10,fy+1.04,front+.92],.026,aluminium,group);
     for(const side of [-1,1])b.box([balcX+side*(balcW/2-.08),fy+.52,front+.48],[.10,.86,.94],concrete,group);
    }else{
     b.tube([balcX-balcW/2+.22,fy+1.04,front+.95],[balcX+balcW/2-.22,fy+1.04,front+.95],.027,coating,group);
     for(let xx=balcX-balcW/2+.22;xx<balcX+balcW/2-.15;xx+=.36)b.box([xx,fy+.58,front+.95],[.025,.94,.032],coating,group);
     for(const side of [-1,1])b.box([balcX+side*(balcW/2-.20),fy+.57,front+.48],[.04,.95,.98],coating,group);
    }
    if(floor%2===0&&!far)acUnit(balcX-balcW*.30,fy+.08,front+.50,group);
    if(!far&&(id===1||id===2||id===3||id===4)&&(floor+id)%3!==0){
     balconyGarden(balcX+.22*Math.sin(2.2*floor+id)*balcW,fy+.10,front+.68,group);
    }
    if(!far&&((id===2&&floor===1)||(id===3&&floor===3)||(id===5&&floor===2))){
     railLinen(balcX+balcW*.14,fy+1.07,front+.92,id===2?.62:.96,canvas[(id+floor)%canvas.length],group);
    }
   }else if(!far&&!sloped&&floor===1&&(id%3===0)){
    // Wall-mounted AC outdoor unit bracket on non-balcony buildings.
    acUnit(x+(id%2?1:-1)*(w*.5-.75),y-wh*.5-.22,front+.20,group);
   }
  }

  // Drainpipe & mounting straps.
  const pipeX=x+(id%2?1:-1)*(w/2-.12);
  b.tube([pipeX,.4,front+.24],[pipeX,h-.15,front+.24],.044,pipe,group);
  for(let y=.7;y<h;y+=2.4)b.box([pipeX,y,front+.25],[.14,.055,.14],aluminium,group);

  // Small projecting vertical neighbourhood sign on two mid-rise flank buildings.
  if(!far&&!sloped&&(id===1||id===4)){
   const sSide=id===1?1:-1,sx=x+sSide*(w*.5+.36),sy=Math.min(h-1.8,5.6);
   b.box([sx,sy,front-.15],[.44,2.1,.12],id===1?canvas[1]:canvas[3],group);
   b.box([sx,sy,front-.15],[.48,2.14,.06],coating,group);
   for(const dy of [-.75,.75])b.box([x+sSide*(w*.5+.14),sy+dy,front-.15],[.28,.05,.05],coating,group);
  }

  // Ground-floor entrance canopy or striped corner shop awning.
  if(!far&&!sloped&&id%2===0){
   const awning=b.box([x,.98,front+.4],[w*.64,.1,.78],coating,group);awning.rotation.x=.08;
   b.box([x,.61,front+.025],[w*.54,.8,.08],recess,group);
  }
  if(sloped)streetAwning(x,.86+storey*.65,front+.24,w*.85,x<0?canvas[1]:canvas[0],group);
 }

 const near=lawson?[
  [-29,-13,8,7,8.8,3,2,true,0],[-18,-10,7,6,7.6,2,0,false,2],[-8,-16,7,7,9.2,3,1,true,1],
  [2,-18,8,8,10.6,3,2,true,0],[17,-12,6,7,8.4,3,3,false,3],[26,-14,7.4,7.5,9.8,3,0,true,1],[30,-8.5,6.2,6,8.2,3,4,false,4],
 ]:[
  [-29.2,-12,7.6,7,8.8,3,2,true,0],[-19,-12,8,7,10.2,3,1,true,2],[-10,-17,6,7,8.4,3,3,false,3],
  [-3.8,-20.5,5.6,7,10.4,3,2,false,1],[7.2,-17,7,7,9.4,3,0,true,0],[17,-14,8,8,10.8,3,2,true,1],[28.2,-14,8,7,9.8,3,4,true,2],
 ];
 for(const [x,z,w,d,h,floors,palette,balconies,archetype]of near)building({x,z,w,d,h,floors,palette,balconies,archetype});
 for(const [i,x]of [-27.5,-16.5,-5.5,5.5,16.5,27.5].entries())building({x,z:-28.5-(i%2)*1.5,w:10.2,d:6.2,h:10.8+(i%3)*1.4,floors:3+(i%2),palette:(i+2)%5,far:true,balconies:false,archetype:i%5});
 for(const [x,z,w,d,h,palette]of lawson?[[-14,-2.5,5.5,6,6.4,1],[17,-3,6,6,6.8,2]]:[[-20,-2,7,6,7.2,3],[20,-3,7,7,7.6,1]])building({x,z,w,d,h,floors:2,palette,sloped:true,archetype:5});
 if(planterLeaves.length)b.leaves(planterLeaves,{color:'#77974f',name:'foliage:balcony-planters'});

 const laneX=lawson?10.9:1.0,laneWidth=lawson?4.1:4.0;
 const laneEnd=lawson?3.22:7.5,depth=laneEnd+27,laneZ=laneEnd-depth/2;
 b.box([laneX,.035,laneZ],[laneWidth,.07,depth],lane,root);
 for(const side of [-1,1]){
  b.box([laneX+side*(laneWidth/2+.6),.095,laneZ],[1.1,.15,depth],pavement,root);
  b.box([laneX+side*(laneWidth/2+.07),.115,laneZ],[.13,.23,depth],curb,root);
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
