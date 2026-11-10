import * as T from 'three';
import {Diorama} from './diorama-kit.mjs';
import {architectureFinish} from './architecture-textures.mjs';

// Compact photographic reconstruction, not survey geometry. Both bridge decks
// run along X; Route 14 passes below them along Z.
export function createScene({scene,renderer}){
 const b=new Diorama(scene,renderer,'Inage_Overpass');b.plinth(48,30,'#565e60');
 const concrete=b.mat('concrete:piers','#b6b5ab'),steel=b.mat('paint:blue-steel','#507d99'),rail=b.mat('paint:pedestrian-railing','#b8d1d8');
 const dark=b.mat('asphalt:road','#343b40'),mark=b.mat('paint:road-lines','#d9d7c6'),orange=b.mat('paint:road-centre-line','#bb8c43'),soil=b.mat('soil:verge','#636d4f'),paver=b.mat('paving:walkway','#9c9585'),walk=b.mat('asphalt:pedestrian-walkway','#77645b'),noise=b.mat('paint:noise-barrier','#a7b0af'),rust=b.mat('paint:weathered-joints','#75675a');
 for(const [m,rough,env]of [[concrete,.94,.18],[steel,.71,.32],[rail,.64,.36],[noise,.82,.24],[rust,.97,.15],[walk,.95,.19],[paver,.91,.22]])m.userData.surfaceFinish={roughness:rough,metalness:0,envMapIntensity:env};
 architectureFinish(b,concrete,'concrete',{scale:2.4});
 for(const m of [steel,rail,noise])architectureFinish(b,m,'paint');
 const keep=(o,name)=>{o.name='inage:'+name;o.userData.keep=true;return o;};
 const structuralBox=(p,s,m,name)=>keep(b.box(p,s,m),name);
 const upperY=10.8,lowerY=5.2,landingY=7.1,halfSpan=14,upperWidth=6.8,lowerWidth=3.2;

 // Closed ribbons keep inclined slabs continuous, with vertical thickness and
 // horizontal width instead of the tall edge produced by a rotated beam.
 function ribbon(points,width,thickness,material,name,{retained=true}={}){
  const positions=[],indices=[];
  for(let i=0;i<points.length;i++){
   const a=points[Math.max(0,i-1)],c=points[Math.min(points.length-1,i+1)],dx=c[0]-a[0],dz=c[2]-a[2],length=Math.hypot(dx,dz)||1,nx=-dz/length*width/2,nz=dx/length*width/2,p=points[i];
   positions.push(p[0]+nx,p[1],p[2]+nz,p[0]-nx,p[1],p[2]-nz,p[0]+nx,p[1]-thickness,p[2]+nz,p[0]-nx,p[1]-thickness,p[2]-nz);
   if(i){const k=i*4,j=k-4;indices.push(j,j+1,k,j+1,k+1,k,j+2,k+2,j+3,j+3,k+2,k+3,j,k,j+2,j+2,k,k+2,j+1,j+3,k+1,j+3,k+3,k+1);}
  }
  const last=(points.length-1)*4;indices.push(0,2,1,1,2,3,last,last+1,last+2,last+1,last+3,last+2);
  // The ribbon's top must face upward; closed undersides face downward.
  for(let i=0;i<indices.length;i+=3)[indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];
  const geometry=b.own(new T.BufferGeometry());geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new T.Float32BufferAttribute(positions.flatMap((value,index)=>index%3===0?[value,positions[index+2]]:[]),2));geometry.setIndex(indices);geometry.computeVertexNormals();
  const mesh=b.mesh(geometry,material);return retained?keep(mesh,name):mesh;
 }
 function parapet(points,width,height=1.13){
  for(const side of [-1,1]){
   const edge=points.map((p,i)=>{const a=points[Math.max(0,i-1)],c=points[Math.min(points.length-1,i+1)],dx=c[0]-a[0],dz=c[2]-a[2],length=Math.hypot(dx,dz)||1;return [p[0]-side*dz/length*width/2,p[1],p[2]+side*dx/length*width/2];});
   // Solid lower panel and the characteristic pale-blue open picket band.
   ribbon(edge,.065,.58,rail,'railing-panel',{retained:false}).position.y+=.58;
   for(let i=1;i<edge.length;i++){
    const a=edge[i-1],c=edge[i];b.tube([a[0],a[1]+height,a[2]],[c[0],c[1]+height,c[2]],.035,rail);
    b.tube([a[0],a[1]+.61,a[2]],[c[0],c[1]+.61,c[2]],.027,rail);
    const count=Math.max(1,Math.ceil(Math.hypot(c[0]-a[0],c[2]-a[2])/.24));
    for(let j=0;j<count;j++){const t=j/count,p=a.map((v,k)=>v+(c[k]-v)*t);b.tube([p[0],p[1]+.56,p[2]],[p[0],p[1]+height,p[2]],.019,rail);}
   }
   for(let i=0;i<edge.length;i++){const p=edge[i];if(i===0||i===edge.length-1||i%3===0)b.box([p[0],p[1]+height/2,p[2]],[.075,height,.075],rail);}
  }
 }
 function slabPath(points,width,name,{rails=true,thickness=.22}={}){
  const slab=ribbon(points,width,thickness,steel,name);
  ribbon(points.map(p=>[p[0],p[1]+.025,p[2]]),width-.12,.035,walk,name+'-surface');
  if(rails)parapet(points,width-.06);return slab;
 }
 function bank(points,z1,z2){
  const shape=new T.Shape();shape.moveTo(points[0][0],0);for(const p of points)shape.lineTo(...p);shape.lineTo(points.at(-1)[0],0);shape.closePath();
  const geo=b.own(new T.ExtrudeGeometry(shape,{depth:z2-z1,bevelEnabled:false}));geo.setIndex(Array.from({length:geo.attributes.position.count},(_,i)=>i));return b.mesh(geo,soil,[0,0,z1]);
 }
 const eastBankHeight=(x,z)=>.3+T.MathUtils.clamp((x-14.8)/8,0,1)*10.2+(x>23.8?.23*Math.sin((x-23.8)*.09)*Math.sin(z*.065):0);
 function terrainPatch(x0,x1,z0,z1,height,material,name,step=1.8){
  const nx=Math.ceil((x1-x0)/step),nz=Math.ceil((z1-z0)/step),positions=[],uv=[],ids=[];
  for(let j=0;j<=nz;j++)for(let i=0;i<=nx;i++){
   const x=x0+(x1-x0)*i/nx,z=z0+(z1-z0)*j/nz;positions.push(x,height(x,z),z);uv.push(x,z);
   if(i&&j){const a=(j-1)*(nx+1)+i-1;ids.push(a,a+nx+1,a+1,a+1,a+nx+1,a+nx+2);}
  }
  const geometry=b.own(new T.BufferGeometry());geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geometry.setIndex(ids);geometry.computeVertexNormals();
  return keep(b.mesh(geometry,material),name);
 }

 // Keep the through road unobstructed. Every pier and approach lies outside
 // its traffic corridor, rather than occupying a fictitious road median.
 b.box([0,.015,0],[47.7,.07,29.6],soil);
 structuralBox([0,.07,0],[10,.09,29.8],dark,'ground-road');
 for(const x of [-6.1,6.1])b.box([x,.17,0],[2.2,.22,29.7],paver);
 for(const x of [-4.75,4.75])b.box([x,.125,0],[.1,.012,29.5],mark);
 for(let z=-14;z<=14;z+=3)for(const x of [-2.45,2.45])b.box([x,.126,z],[.085,.012,1.65],mark);
 b.box([0,.126,0],[.095,.012,29.5],orange);
 for(const x of [-7.4,7.4])b.rail([x,.15,-14.5],[x,.15,14.5],.85,rail,{spacing:1.1,depth:.025});

 // Vehicle road with acoustic screens, Langer arch ribs, overhead cross-braces
 // and a blue cross-braced underside visible from the pedestrian route.
 structuralBox([0,upperY-.22,0],[28,.44,upperWidth],steel,'upper-road-deck');
 structuralBox([0,upperY+.025,0],[28,.05,upperWidth-.3],dark,'upper-road-surface');
 b.box([0,upperY+.057,0],[27.8,.014,.07],orange);
 for(const z of [-2.78,2.78])b.box([0,upperY+.057,z],[27.8,.014,.075],mark);
 const arch=x=>upperY+.3+3.75*(1-(x/halfSpan)**2);
 for(const z of [-3.2,3.2]){
  b.box([0,upperY-.47,z],[28,.58,.22],steel);
  for(let i=0;i<20;i++){
   const x=-14+i*1.4,next=x+1.4;
   b.beam([x,arch(x),z],[next,arch(next),z],.23,steel,b.root,.22);
   if(i>0)b.beam([x,upperY+.1,z],[x,arch(x),z],.12,steel,b.root,.12);
   b.box([x+.7,upperY+.72,z],[1.36,1.4,.085],noise);b.box([x,upperY+.76,z],[.065,1.56,.13],steel);
   for(const y of [.25,.7,1.15])b.box([x+.7,upperY+y,z],[1.36,.022,.1],rust);
  }
 }
 for(let x=-9.8;x<9.8;x+=2.8){
  b.beam([x,arch(x),-3.2],[x,arch(x),3.2],.14,steel);
  b.beam([x,arch(x),-3.2],[x+2.8,arch(x+2.8),3.2],.09,steel);b.beam([x,arch(x),3.2],[x+2.8,arch(x+2.8),-3.2],.09,steel);
 }
 for(let x=-13.3;x<14;x+=1.9){
  b.beam([x,upperY-.64,-3.2],[x,upperY-.64,3.2],.15,steel);
  const end=Math.min(14,x+1.9);b.beam([x,upperY-.66,-3.2],[end,upperY-.66,3.2],.085,steel);b.beam([x,upperY-.66,3.2],[end,upperY-.66,-3.2],.085,steel);
 }
 // Portal legs leave the opening seen in photographs; no solid pier passes
 // through the centre of the lower walkway.
 for(const [side,x]of [['west',-14],['east',14]]){
  for(const [edge,z]of [['front',2.65],['back',-2.65]]){
   structuralBox([x,5.07,z],[1.2,10.14,1.25],concrete,`portal-${side}-leg-${edge}`);
   structuralBox([x,.25,z],[1.75,.5,1.75],concrete,`portal-${side}-foot-${edge}`);
  }
  structuralBox([x,10.08,0],[1.9,.72,7.3],concrete,`portal-${side}-cap`);
  b.tube([x+.64,.5,-2.05],[x+.64,9.7,-2.05],.065,rail);
  for(let y=.9;y<9.5;y+=1.1)b.box([x+.65,y,-2.05],[.15,.045,.22],rust);
 }

 // The small central stair is longitudinal, part of the main lower route.
 slabPath([[-14.3,lowerY,0],[9.8,lowerY,0]],lowerWidth,'lower-walkway-deck');
 structuralBox([-14,lowerY-.4,0],[1.4,.42,5.3],concrete,'lower-west-bearing');
 structuralBox([9.7,lowerY-.4,0],[.7,.42,3.4],steel,'lower-east-bearing');
 for(const z of [-1.15,1.15])structuralBox([9.7,(lowerY-.61)/2,z],[.42,lowerY-.61,.42],concrete,'lower-east-support-'+(z<0?'back':'front'));
 const stairStart=9.8,stairEnd=13.8,stairCount=16,stairRise=(landingY-lowerY)/stairCount;
 for(let i=0;i<stairCount;i++){
  const top=lowerY+(i+1)*stairRise;
  structuralBox([stairStart+(i+.5)*(stairEnd-stairStart)/stairCount,top-.11,0],[(stairEnd-stairStart)/stairCount+.008,.22,.9],paver,'centre-stair-tread-'+i);
  b.box([stairStart+i*.25+.245,top+.012,0],[.027,.016,.84],rail);
 }
 ribbon([[stairStart,lowerY-.13,0],[stairEnd,landingY-.13,0]],.94,.2,steel,'centre-stair-stringer');
 for(const z of [-1.025,1.025])slabPath([[stairStart,lowerY,z],[stairEnd,landingY,z]],1.15,'bicycle-ramp-'+(z<0?'back':'front'),{rails:false});
 parapet([[stairStart,lowerY,0],[stairEnd,landingY,0]],lowerWidth-.06);
 slabPath([[stairEnd,landingY,0],[15.9,landingY,0]],lowerWidth,'pier-landing',{rails:false});
 structuralBox([15.2,landingY/2,0],[.6,landingY-.25,.8],concrete,'pier-landing-support');

 // Separate 270-degree ascending ramp outside the portal, linking the lower
 // landing with the wooded upper approach without entering the vehicle road.
 const spiral=[];
 for(let i=0;i<=54;i++){const t=i/54,a=t*Math.PI*1.5;spiral.push([12.7+3.2*Math.cos(a),landingY+(upperY-landingY)*t,8+3.2*Math.sin(a)]);}
 slabPath([[15.9,landingY,0],[15.9,landingY,8]],2.2,'spiral-entry');
 slabPath(spiral,2.2,'spiral-deck');
 structuralBox([12.7,3.78,8],[.75,7.56,.75],steel,'spiral-centre-column');
 // The old radial beams projected through the inside of the spiral and could
 // appear as loose horizontal bars above the railing. Carry the slab from
 // below with discrete posts instead, ending exactly at the deck underside.
 for(const i of [9,27,45]){
  const p=spiral[i],x=12.7+(p[0]-12.7)*.8,z=8+(p[2]-8)*.8,top=p[1]-.22;
  structuralBox([x,top/2,z],[.18,top,.18],steel,'spiral-support-'+i);
 }
 slabPath([[12.7,upperY,4.8],[23.2,upperY,4.8]],2.2,'upper-bank-path');
 structuralBox([18.4,upperY-.24,0],[8.8,.48,6.8],steel,'upper-east-approach');
 b.box([18.4,upperY+.025,0],[8.8,.05,6.5],dark);b.box([18.4,upperY+.057,0],[8.8,.014,.07],orange);
 for(const z of [-2.78,2.78])b.box([18.4,upperY+.057,z],[8.8,.014,.075],mark);
 for(const z of [-3.2,3.2])b.box([18.4,upperY+.7,z],[8.8,1.4,.09],noise);
 // The embankment continues beyond both shoulders. Its top joins the distant
 // wooded ground instead of ending as a thin green extrusion behind the pier.
 terrainPatch(14.8,23.8,-14.9,14.9,eastBankHeight,soil,'continuous-east-bank',.8);

 // Other branch reaches the wooded roadside outside the Route 14 corridor.
 slabPath([[15.9,landingY,-1.6],[15.9,landingY,-4.7],[11.4,landingY,-4.7]],1.65,'east-bank-landing');
 const bankStairs=b.group('inage:east-bank-stairs');
 for(let i=0;i<26;i++){
  const y=landingY-(i+1)*(landingY-.3)/26,z=-4.7-i*.255;
  keep(b.box([11.4,y-.14,z],[1.65,.28,.27],paver,bankStairs),'east-bank-stair-tread-'+i);
 }
 ribbon([[11.4,landingY-.1,-4.7],[11.4,.2,-11.33]],1.65,.24,concrete,'east-bank-stair-support');
 for(const x of [10.58,12.22])b.rail([x,landingY,-4.7],[x,.3,-11.33],1.05,rail,{spacing:.65,depth:.03});
 structuralBox([13.2,landingY/2,-4.7],[.55,landingY,.55],concrete,'east-bank-landing-column');

 // The miniature cuts the long descending western approach at a planted low
 // bank. It continues along X and never drops into the ground road.
 slabPath([[-22.8,3.5,0],[-14.3,lowerY,0]],lowerWidth,'west-descent');
 bank([[-22.8,3.22],[-18.7,.15]],-3.1,3.1);
 structuralBox([-18.3,2.05,0],[.65,4.1,.65],steel,'west-descent-column');
 for(const [x,y,z]of [[-9,lowerY,-1.43],[-2,lowerY,-1.43],[5.7,lowerY,-1.43]]){
  b.cylinderAt([x,y+1.52,z],.045,3.04,rail);b.tube([x,y+3.04,z],[x,y+3.04,z+.38],.038,rail);
  b.box([x,y+3.04,z+.38],[.28,.11,.58],steel);
  const lens=b.mat('lamp:frosted-walkway-lens','#e8eadf',{emissive:'#f2f0dc',emissiveIntensity:.3});
  b.box([x,y+2.97,z+.38],[.22,.025,.45],lens);
  const light=new T.SpotLight('#eee9d3',62,10,Math.PI*.31,.58,2);light.position.set(x,y+2.94,z+.38);light.target.position.set(x+.2,y,0);b.root.add(light,light.target);
  light.castShadow=x===-2;light.shadow.mapSize.set(1024,1024);light.shadow.bias=-.00012;light.shadow.normalBias=.015;
  b.lamps.push({light,material:lens,intensity:62,day:.025,night:1});
 }
 // Road-level practicals are below the pedestrian deck. The open lower lens
 // points at the actual carriageway; the hood and raised post stay out of it.
 const roadLampMetal=b.mat('paint:road-lamp-post','#64757a'),roadLampHousing=b.mat('paint:road-lamp-hood','#3b4a50');
 roadLampMetal.userData.surfaceFinish={roughness:.73,metalness:0,envMapIntensity:.25};
 roadLampHousing.userData.surfaceFinish={roughness:.78,metalness:0,envMapIntensity:.22};
 for(const z of [-10.7,0,10.7])for(const side of [-1,1]){
  const x=side*6.15,lx=side*4.45,y=4.45;
  const fixture=b.group('inage:ground-road-lamp',[0,0,0]);
  b.box([x,.31,z],[.38,.28,.38],concrete,fixture);b.cylinderAt([x,2.34,z],.066,4.2,roadLampMetal,fixture);
  b.tube([x,4.25,z],[x-side*.38,y,z],.063,roadLampMetal,fixture);b.tube([x-side*.38,y,z],[lx,y,z],.055,roadLampMetal,fixture);
  b.box([lx,y,z],[.75,.12,.39],roadLampHousing,fixture);
  const lens=b.mat('lamp:road-downlight-lens','#eee9d8',{emissive:'#ffe5bf',emissiveIntensity:.1});
  const emitter=b.box([lx,y-.071,z],[.59,.018,.29],lens,fixture);emitter.castShadow=false;
  const light=new T.SpotLight('#ffe3bc',420,15,Math.PI*.35,.68,2);light.name='inage:ground-road-downlight';light.position.set(lx,y-.094,z);light.target.position.set(side*1.75,.12,z+side*.75);fixture.add(light,light.target);
  light.castShadow=z===0&&side===-1;light.shadow.mapSize.set(1024,1024);light.shadow.camera.near=.3;light.shadow.camera.far=15;light.shadow.bias=-.00008;light.shadow.normalBias=.012;
  b.lamps.push({light,material:lens,intensity:420,day:.008,night:1});
 }
 // Visible joinery has thickness, fasteners and a different response from its
 // painted cover. These details live outside the walking and traffic openings.
 const joint=b.mat('paint:splice-plates','#466f88'),fastener=b.mat('metal:galvanized-bolts','#818d90',{roughness:.55,metalness:.82}),gasket=b.mat('rubber:expansion-joint','#343b3c'),tie=b.mat('concrete:form-tie-recess','#242a28');
 tie.userData.surfaceFinish={roughness:.98,metalness:0,envMapIntensity:0};
 joint.userData.surfaceFinish={roughness:.77,metalness:0,envMapIntensity:.28};architectureFinish(b,joint,'paint');
 const boltGeo=b.own(new T.CylinderGeometry(.032,.032,.023,6));boltGeo.rotateX(Math.PI/2);
 for(const x of [-10.5,-3.5,3.5,10.5])for(const z of [-3.325,3.325]){
  b.box([x,upperY-.47,z],[.52,.38,.025],joint);
  for(const dx of [-.17,.17])for(const dy of [-.11,.11])b.mesh(boltGeo,fastener,[x+dx,upperY-.47+dy,z+Math.sign(z)*.024]);
 }
 const tieGeo=b.own(new T.CircleGeometry(.033,12));
 for(const x of [-14,14])for(const z of [-2.65,2.65])for(const face of [-1,1])for(let y=1.15;y<9.5;y+=1.22){
  for(const dx of [-.32,.32]){const hole=b.mesh(tieGeo,tie,[x+dx,y,z+face*.626]);hole.rotation.y=face<0?Math.PI:0;hole.castShadow=false;}
 }
 for(const x of [-10,-3,4,9.6]){
  b.box([x,lowerY+.045,0],[.021,.008,lowerWidth-.16],gasket);
  for(const z of [-1.44,1.44])b.box([x,lowerY-.05,z],[.18,.2,.1],joint);
 }
 for(const x of [-14,14])for(const z of [-2.65,2.65]){
  b.box([x,.52,z],[1.24,.035,1.28],gasket);
  for(const dx of [-.68,.68])for(const dz of [-.68,.68])b.cylinderAt([x+dx,.515,z+dz],.038,.028,fastener);
 }
 const sign=b.sign('自転車はおして\nとおりましょう',1.35,.58,[8.9,lowerY+.83,-1.51],{bg:'#e8edf0',fg:'#31577b',size:100});sign.rotation.y=Math.PI/2;
 for(const [x,z,h]of [[-19,-8,4.1],[-16,-9,4.8],[-12,-9.7,5],[-10,7.6,4.6],[-16,8.5,5.3],[9.1,8.7,5],[12.6,8.2,5.5],[17.5,-9.5,5.1],[19.9,9.4,5.6]])b.tree(x,z,h,1.3);
 b.shrubs(-15,-8,10,2,.9);b.shrubs(-15,8,9,2,.8);b.shrubs(15,8.5,7,2,.9);
 for(const [x,z,h]of [[19.7,5.8,4.3],[21.4,-5.6,5.1],[22.1,6.5,4.7]]){
  const before=new Set(b.root.children);b.tree(x,z,h,1.3);const rise=.3+(x-14.8)/8*10.2;
  for(const o of b.root.children)if(!before.has(o))o.position.y+=rise;
 }
 const van=b.mat('paint:van-body','#b9b8ae'),tyre=b.mat('rubber:tyres','#252b2d'),glass=b.mat('glass:van','#405963',{transparent:true,opacity:.75,depthWrite:false});
 b.box([-10,.98,8.7],[1.65,1.45,3.5],van);b.box([-10,1.76,8.7],[1.68,.16,3.4],van);
 for(const z of [7.6,8.7,9.8])b.box([-9.16,1.38,z],[.018,.57,.88],glass);
 b.box([-10,1.35,6.92],[1.35,.65,.02],glass);
 const wheel=b.own(new T.CylinderGeometry(.32,.32,.17,16));wheel.rotateZ(Math.PI/2);
 for(const z of [7.6,9.8])for(const x of [-10.82,-9.18])b.mesh(wheel,tyre,[x,.38,z]);
 const api=b.finish({w:48,d:30,photo:{position:[-27,17,30],target:[0,6,0],fov:46},companion:{position:[-11,6.85,.05],target:[10.6,7,0],fov:56},overview:[-1,.8,1.3],background:'#a8b8be'});
 // Keep the continuous surroundings outside the finite bridge bounds so Home
 // still frames the architecture. B owns their buffers and materials as usual.
 const context=b.group('inage:continuing-woodland');
 const contextSoil=b.mat('soil:woodland-ground','#536448'),contextBark=b.mat('bark:woodland-branches','#534d3d');
 const lowHeight=(x,z)=>x>=14.8?eastBankHeight(x,z):.018+.035*Math.sin(x*.09)*Math.sin(z*.13);
 const addGround=(...args)=>{const mesh=terrainPatch(...args,lowHeight,contextSoil,'woodland-terrain',2.7);context.add(mesh);};
 addGround(23.8,125,-95,95);addGround(-100,23.8,-95,-14.9);addGround(-100,23.8,14.9,95);addGround(-100,-24,-14.9,14.9);
 // Extend the roadway through the envelope so the front edge does not float
 // against an empty horizon. These distant receivers add no overview padding.
 for(const z of [-54.9,54.9]){
  b.box([0,.07,z],[10,.09,80],dark,context);b.box([0,.126,z],[.095,.012,80],orange,context);
  for(const side of [-1,1]){b.box([side*6.1,.17,z],[2.2,.22,80],paver,context);b.box([side*4.75,.125,z],[.1,.012,80],mark,context);}
 }
 const branches=[],leaves=[],r=b.rng;
 const branch=(a,c,radius)=>branches.push({a,c,radius});
 function woodlandTree(x,z,h,spread){
  const y=lowHeight(x,z),lean=(r()-.5)*.6,top=[x+lean,y+h*.78,z+.12];branch([x,y,z],top,h*.028);
  for(let j=0;j<9;j++){
   const a=j*2.3999+r()*.28,reach=spread*(.6+r()*.4),end=[x+Math.cos(a)*reach,y+h*(.48+r()*.38),z+Math.sin(a)*reach];
   branch([x+lean*.5,y+h*(.3+j*.038),z],end,h*.008+.014);
   for(let k=0;k<3;k++){
    const tip=[end[0]+Math.cos(a+k*1.9)*spread*.28,end[1]+.35+r()*.6,end[2]+Math.sin(a+k*1.9)*spread*.28];branch(end,tip,.015);
    for(let n=0;n<24;n++){
     const angle=r()*Math.PI*2,rad=Math.sqrt(r())*spread*.39;
     leaves.push({x:tip[0]+Math.cos(angle)*rad,y:tip[1]+(r()-.45)*spread*.56,z:tip[2]+Math.sin(angle)*rad,size:.15+r()*.18,hue:.22+r()*.065});
    }
   }
  }
 }
 // A close irregular shoulder, a middle canopy and a taller rear layer give
 // parallax and branch-sized openings instead of an opaque row of green balls.
 for(let row=0;row<5;row++)for(let j=0;j<12;j++){
  const x=26.7+row*10+r()*4,z=-48+j*8.6+(r()-.5)*4;
  woodlandTree(x,z,6.7+r()*4.5,2.8+r()*1.3);
 }
 for(const side of [-1,1])for(let row=0;row<3;row++)for(let j=0;j<11;j++){
  const x=-44+j*6.1+(r()-.5)*2,z=side*(18+row*9+r()*3);
  if(Math.abs(x)<9.5)continue; // the continuing road stays clear beyond the model too
  if(x>8&&x<18&&row===0)continue;
  woodlandTree(x,z,6+r()*5,2.7+r()*1.3);
 }
 for(const [x,z,h,s]of [[-18,-10,8.2,3.1],[-11,-11.6,9.1,3.3],[-20,9.5,8.7,3.5],[-12,11.6,8,3],[19,-10,7.4,2.8],[20,13,8.3,3.2],[25,8,8.2,3.4],[26,-6.5,7.8,3.2]])woodlandTree(x,z,h,s);
 for(const [x,z,h,s]of [[17.3,-11,4.8,1.8],[19,-6.9,5.3,1.9],[20.5,-12.7,5.7,2.2],[17.2,13.3,4.9,1.8],[20.5,11.4,5.5,2]])woodlandTree(x,z,h,s);
 const branchGeometry=b.own(new T.CylinderGeometry(.62,1,1,7)),branchMesh=new T.InstancedMesh(branchGeometry,contextBark,branches.length),object=new T.Object3D(),up=new T.Vector3(0,1,0);
 branches.forEach(({a,c,radius},i)=>{const p=new T.Vector3(...a),q=new T.Vector3(...c);object.position.copy(p).add(q).multiplyScalar(.5);object.quaternion.setFromUnitVectors(up,q.clone().sub(p).normalize());object.scale.set(radius,p.distanceTo(q),radius);object.updateMatrix();branchMesh.setMatrixAt(i,object.matrix);});
 branchMesh.name='inage:woodland-branch-network';branchMesh.castShadow=true;branchMesh.receiveShadow=true;branchMesh.computeBoundingSphere();context.add(branchMesh);b.instances.push(branchMesh);
 const crown=b.leaves(leaves,{color:'#6d854c',name:'foliage:inage-woodland-leaves'});context.add(crown);
 const bankCover=[];
 for(let i=0;i<50000;i++){
  const x=14.9+r()*8.8,z=-39+r()*78;
  // Cover the near shoulder and both outer edges too. Size and direction
  // still vary so the bank reads as interwoven plants rather than flat paint.
  const size=.30+r()*.30;
  bankCover.push({x,y:eastBankHeight(x,z)+size*.42,z,size,rx:(r()-.5)*.7,ry:r()*Math.PI*2,rz:(r()-.5)*.85,hue:.20+r()*.085});
 }
 const groundcover=b.leaves(bankCover,{narrow:true,color:'#688449',name:'foliage:inage-bank-groundcover'});context.add(groundcover);
 // A varied meadow on the sloping banks, in small irregular drifts rather
 // than a repeated border. Each blossom is instanced together with its stem,
 // so thousands of details need just two additional draw calls.
 const flowerPositions=[],flowerIndices=[];
 for(let petal=0;petal<5;petal++){
  const a=petal*Math.PI*2/5,tip=[Math.cos(a)*.1,0,Math.sin(a)*.1],side=.043;
  const left=[Math.cos(a)*.065-Math.sin(a)*side,.004,Math.sin(a)*.065+Math.cos(a)*side];
  const right=[Math.cos(a)*.065+Math.sin(a)*side,.004,Math.sin(a)*.065-Math.cos(a)*side];
  const start=flowerPositions.length/3;flowerPositions.push(0,.012,0,...left,...tip,...right);flowerIndices.push(start,start+1,start+2,start,start+2,start+3);
 }
 const flowerGeometry=b.own(new T.BufferGeometry());flowerGeometry.setAttribute('position',new T.Float32BufferAttribute(flowerPositions,3));flowerGeometry.setIndex(flowerIndices);flowerGeometry.computeVertexNormals();
 const flowerMaterial=b.mat('flower:inage-meadow','#ffffff',{side:T.DoubleSide,roughness:.95});
 const stemMaterial=b.mat('plant:inage-meadow-stems','#63804d',{roughness:.95});
 const stemGeometry=b.own(new T.CylinderGeometry(.008,.012,1,5));
 const blossoms=[];
 for(let patch=0;patch<680;patch++){
  const cx=15.8+r()*7.7,cz=-38+r()*76;
  for(let j=0,n=4+Math.floor(r()*6);j<n;j++){
   const x=cx+(r()-.5)*1.5,z=cz+(r()-.5)*1.5;
   if(x<15.2||x>23.6||Math.abs(z)>38.5)continue;
   const height=.13+r()*.22,scale=.72+r()*.65;
   blossoms.push({x,z,y:eastBankHeight(x,z),height,scale,color:r()});
  }
 }
 const petals=new T.InstancedMesh(flowerGeometry,flowerMaterial,blossoms.length),stems=new T.InstancedMesh(stemGeometry,stemMaterial,blossoms.length);
 const flowerObject=new T.Object3D(),bankNormal=new T.Vector3(-10.2/8,1,0).normalize(),normalRotation=new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),bankNormal);
 for(let i=0;i<blossoms.length;i++){
  const p=blossoms[i];flowerObject.quaternion.copy(normalRotation);flowerObject.position.set(p.x,p.y,p.z).addScaledVector(bankNormal,p.height/2);flowerObject.scale.set(1,p.height,1);flowerObject.updateMatrix();stems.setMatrixAt(i,flowerObject.matrix);
  flowerObject.position.set(p.x,p.y,p.z).addScaledVector(bankNormal,p.height);flowerObject.scale.setScalar(p.scale);flowerObject.updateMatrix();petals.setMatrixAt(i,flowerObject.matrix);
  petals.setColorAt(i,new T.Color(p.color<.46?'#f8e8ea':p.color<.76?'#f4d076':p.color<.92?'#efb9cc':'#f7f2df'));
 }
 for(const [mesh,name]of [[petals,'inage:bank-wildflowers'],[stems,'inage:bank-wildflower-stems']]){mesh.name=name;mesh.castShadow=false;mesh.receiveShadow=true;mesh.computeBoundingSphere();context.add(mesh);b.instances.push(mesh);}
 api.root.userData.inageWoodland={trees:leaves.length/(9*3*24),contextOutsideFraming:true,bankHeightAtEdge:eastBankHeight(23.8,0)};
 api.root.userData.inageLayout={axis:'x',groundRoadAxis:'z',upperY,lowerY,landingY,upperWidth,lowerWidth,roadHalfWidth:5,halfSpan,stairStart,stairEnd};
 api.root.userData.materialDirection={paint:'dielectric weathered blue coating',concrete:'CC0 photographed concrete at 2.4 metre scale',night:'shielded walkway and road downlights with selected cast shadows'};
 const dispose=api.dispose;let released=false;api.dispose=()=>{if(released)return;released=true;for(const entry of b.lamps)if(entry.light?.isSpotLight&&entry.light.castShadow)entry.light.shadow.dispose();dispose();};
 return api;
}
