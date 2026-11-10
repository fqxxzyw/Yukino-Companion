import * as T from 'three';
import {Diorama} from './diorama-kit.mjs';

// The official campus plan has a courtyard enclosed by four teaching wings.
// The white stair entrance and the library/clock entrance face adjacent roads.
// Dimensions below are a compact reconstruction, rather than survey data.
export function extendSchoolCampus(api,{scene,renderer}){
 const b=new Diorama(scene,renderer,'school:complete-campus'),groundY=1.01;
 const borrowed=new Map();api.root.traverse(o=>{for(const m of [o.material].flat().filter(Boolean))if(!borrowed.has(m.name))borrowed.set(m.name,m);});
 // In the reference the paired red walls flank a broad forecourt opening;
 // they do not screen off the exterior stairs from pedestrian eye height.
 for(const wall of api.root.children.filter(o=>o.name==='red-gate-wall')){
  const body=wall.getObjectByName('red-wall'),side=Math.sign(body.position.x),centre=side*10.95,width=7.1;
  for(const child of wall.children){
   child.geometry.computeBoundingBox();const size=child.geometry.boundingBox.getSize(new T.Vector3());
   child.scale.x=(width+(child.name==='wall-coping'?.16:0))/size.x;child.position.x=centre;
   if(child.name==='red-wall'){child.scale.y=1.6/2.6;child.position.y=groundY+.8;}
   if(child.name==='wall-coping')child.position.y=groundY+1.675;
  }
 }
 api.root.traverse(o=>{
  if(['gate-post','gate-post-cap','gate-lamp','gate-lamp-cap','gate-leaf'].includes(o.name))o.position.x=Math.sign(o.position.x)*7.4;
  if(o.name==='gate-post'){o.scale.y=2.1/2.9;o.position.y=groundY+1.05;}
  if(o.name==='gate-post-cap')o.position.y=groundY+2.1;
  if(o.name==='gate-lamp')o.position.y=groundY+2.22;
  if(o.name==='gate-lamp-cap')o.position.y=groundY+2.4;
  if(o.name==='gate-leaf'){o.scale.x=2.02;o.scale.y=.75;}
  if(o.name==='gate-track')o.scale.x=14.8/7.6;
  if(o.name==='school-nameplate'){o.position.x=10.95;o.position.y=groundY+.99;}
  if(o.name==='left-plate'){o.position.x=-10.95;o.position.y=groundY+.91;}
  if(o.name==='gate-plate'){o.position.x=7.4;o.position.y=groundY+1.75;}
  if(o.name==='intercom')o.position.x=-7.05;
 });
 // The real facade is pale painted concrete, rather than warm grey card.
 // Keep recessed bands darker so neutral whites retain their architectural depth.
 for(const [name,hex]of [['school:stucco','#ffffff'],['school:trim','#e7e9e1'],['school:shade','#a4b2b1'],['school:roof','#748481'],['stairs:cheek','#e5e5da'],['stairs:stone','#c3c7bc']])borrowed.get(name)?.color.set(hex);
 const plaster=borrowed.get('school:stucco')||b.mat('plaster:school-extension','#e3e0d4');
 const trim=borrowed.get('school:trim')||b.mat('stone:school-coping','#d8d6cc');
 const shade=borrowed.get('school:shade')||b.mat('plaster:school-recess','#bcbeb6');
 const roof=borrowed.get('school:roof')||b.mat('concrete:school-roof','#92968e');
 const glass=borrowed.get('school:glass')||b.mat('glass:school-extension','#718b96',{transparent:true,opacity:.92,depthWrite:false});
 const metal=borrowed.get('window:frame')||b.mat('paint:school-window-frame','#7e8a89');
 const pavement=b.mat('paving:campus-entry','#a6a396'),asphalt=b.mat('asphalt:school-side-road','#3a4146'),line=b.mat('paint:school-road-lines','#deded0');
 const dark=b.mat('plaster:school-window-recess','#263438'),soil=b.mat('soil:campus-garden','#514e3e'),lawn=b.mat('leaf:campus-lawn','#647f47');
 const red=b.mat('paint:library-terracotta-cladding','#934b42'),redSeam=b.mat('paint:library-panel-reveal','#703b35'),gateMetal=b.mat('paint:school-gate-rail','#667b72');
 red.userData.surfaceFinish={roughness:.86,metalness:0,envMapIntensity:.18};redSeam.userData.surfaceFinish={roughness:.96,metalness:0,envMapIntensity:.1};
 const keep=(o,name)=>{o.name='school:'+name;o.userData.keep=true;return o;};
 const box=(p,s,m,name)=>{const o=b.box(p,s,m);return name?keep(o,name):o;};
 const base=api.root.getObjectByName('Base');base?.removeFromParent();
 box([4.5,-1.225,-34.5],[120,2.45,119],b.mat('stone:complete-campus-foundation','#77766a'),'complete-foundation');
 box([-3,groundY-.48,-40.4],[100,.96,106],pavement,'connected-campus-ground');
 box([-6,groundY+.012,-42],[43,.025,43],lawn,'inner-courtyard-lawn');
 // An uninterrupted perimeter service path joins the doors of all four wings.
 for(const x of [-23.5,23.5])box([x,groundY+.027,-42],[3.3,.035,45],pavement);
 for(const z of [-23,-60.7])box([0,groundY+.028,z],[48,.035,3.4],pavement);
 box([0,groundY+.03,-42],[3.3,.035,40],pavement);
 box([0,groundY+.032,-42],[43,.035,3.2],pavement);

 function windows({position,width=12,height=1.7,cols=8,yaw=0,material=glass,name='classroom-window'}){
  const group=b.group('school:'+name,position);group.rotation.y=yaw;
  b.box([0,0,-.045],[width+.2,height+.18,.08],dark,group);
  b.box([0,0,.008],[width,height,.018],material,group);
  for(const y of [-height/2,0,height/2])b.box([0,y,.035],[width+.1,.055,.07],metal,group);
  for(let i=0;i<=cols;i++)b.box([-width/2+width*i/cols,0,.04],[.045,height+.08,.08],metal,group);
  b.box([0,-height/2-.11,.055],[width+.24,.12,.18],trim,group);
  return group;
 }
 function wing(name,{x,z,width,depth,height=14.1,front='z',outerSign=1,opening=false}){
  const top=groundY+height;
  if(opening){
   // The entrance crosses the teaching wing through a true ground-floor portal.
   box([x,groundY+height/2,z-depth/4-2],[width,height,depth/2-4],plaster,name+'-rear');
   box([x,groundY+height/2,z+depth/4+2],[width,height,depth/2-4],plaster,name+'-front');
   box([x,groundY+3.7+(height-3.7)/2,z],[width,height-3.7,8],plaster,name+'-portal-upper');
   for(const dx of [-width/2+.28,width/2-.28])for(const dz of [-3.78,3.78])box([x+dx,groundY+1.85,z+dz],[.56,3.7,.44],trim);
  }else box([x,groundY+height/2,z],[width,height,depth],plaster,name+'-body');
  box([x,top+.06,z],[width+.22,.22,depth+.22],roof);
  for(const side of [-1,1]){
   box([x+side*width/2,top+.48,z],[.26,.88,depth+.3],trim);
   box([x,top+.48,z+side*depth/2],[width+.3,.88,.26],trim);
  }
  if(front==='z'){
   for(const y of [3.12,6.52,9.92,13.3])for(const side of [-1,1])windows({position:[x,y,z+side*(depth/2+.025)],width:width-1.5,cols:Math.ceil(width/1.6),yaw:side<0?Math.PI:0});
   for(const y of [4.42,7.82,11.22])for(const side of [-1,1])box([x,y,z+side*(depth/2+.08)],[width+.12,.2,.23],trim);
  }else{
   for(const y of [3.12,6.52,9.92,13.3])for(const side of [-1,1]){
    if(opening&&y===3.12){for(const dz of [-depth*.32,depth*.32])windows({position:[x+side*(width/2+.025),y,z+dz],width:depth/2-5,cols:9,yaw:side*Math.PI/2});}
    else windows({position:[x+side*(width/2+.025),y,z],width:depth-1.5,cols:Math.ceil(depth/1.6),yaw:side*Math.PI/2});
   }
   for(const y of [4.42,7.82,11.22])for(const side of [-1,1])box([x+side*(width/2+.08),y,z],[.23,.2,depth+.12],trim);
   for(let zz=z-depth/2+.25;zz<=z+depth/2;zz+=7.1)for(const side of [-1,1])box([x+side*(width/2+.1),groundY+height/2,zz],[.3,height,.48],trim);
  }
  // Roof services sit behind the parapet and have their own louvred housings.
  for(const side of [-1,1]){
   const xx=x+side*Math.min(width*.25,2),zz=z+side*Math.min(depth*.24,6);
   box([xx,top+.46,zz],[2.1,.75,1.5],roof);for(let j=0;j<6;j++)box([xx-.82+j*.33,top+.86,zz],[.12,.035,1.25],metal);
  }
 }
 // Extend the original white classroom facade rather than substituting a
 // simplified box for its detailed door, paired stairs and pilotis.
 for(const x of [-26.25,26.25])wing('white-front-extension-'+(x<0?'west':'east'),{x,z:-14.4,width:14.5,depth:12});
 wing('west-teaching-wing',{x:-28,z:-42,width:11,depth:43.2,front:'x',outerSign:-1});
 wing('east-teaching-wing',{x:28,z:-42,width:11,depth:43.2,front:'x',opening:true});
 wing('rear-specialist-wing',{x:0,z:-66,width:67,depth:11,front:'z'});
 // Two bridges across the inner courtyard are connected to the real storeys.
 for(const z of [-27,-56.8]){
  box([0,8.05,z],[45,.28,2.4],trim);
  for(const y of [8.4,10.9])box([0,y,z],[45,.18,2.5],plaster);
  for(const side of [-1,1])windows({position:[0,9.6,z+side*1.23],width:44,height:2.1,cols:23,yaw:side<0?Math.PI:0,name:'courtyard-connecting-gallery'});
 }

 // The curved red library is an attached volume on the management wing. Its
 // continuous skin and continuous light-coloured cornices share one footprint.
 function roundPlan(w,d,r){const s=new T.Shape(),x=-w/2,y=-d/2;s.moveTo(x+r,y);s.lineTo(x+w-r,y);s.quadraticCurveTo(x+w,y,x+w,y+r);s.lineTo(x+w,y+d-r);s.quadraticCurveTo(x+w,y+d,x+w-r,y+d);s.lineTo(x+r,y+d);s.quadraticCurveTo(x,y+d,x,y+d-r);s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);return s;}
 function curvedVolume(name,w,d,h,y,m){const geometry=b.own(new T.ExtrudeGeometry(roundPlan(w,d,2.7),{depth:h,bevelEnabled:false,curveSegments:18}));geometry.rotateX(-Math.PI/2);return keep(b.mesh(geometry,m,[37,y,-57.5]),name);}
 curvedVolume('curved-library-cladding',12,21,7.2,4.35,red);
 curvedVolume('curved-library-underframe',12.25,21.25,.65,3.7,trim);
 curvedVolume('curved-library-cornice',12.35,21.35,.42,11.55,plaster);
 curvedVolume('curved-library-roof',11.95,20.95,.12,12,roof);
 // Wide recessed library glazing and vertical panel joints, clearly different
 // in finish and thickness from the gate's red masonry.
 windows({position:[43.04,7.8,-57.5],width:11.5,height:3.3,cols:8,yaw:Math.PI/2,name:'library-east-window'});
 for(const z of [-64.6,-62.8,-61,-59.2,-57.4,-55.6,-53.8,-52])box([43.019,7.95,z],[.012,7.05,.019],redSeam);
 for(const [x,z]of [[33.7,-64],[40,-64],[33.7,-51],[40,-51]])box([x,groundY+1.35,z],[.48,2.7,.48],trim);
 box([37,groundY+.035,-57.5],[11.5,.06,20.5],pavement,'library-covered-forecourt');

 // Main entrance axis runs along X, perpendicular to the original white gate.
 const gateX=47.1,gateZ=-40,platformY=groundY+3.7;
 box([35.05,platformY-.17,gateZ],[3.15,.34,8.2],trim,'main-upper-landing');
 for(const z of [-43.35,-36.65])box([35.7,groundY+1.67,z],[.48,3.34,.48],trim);
 windows({position:[33.66,platformY+1.38,gateZ],width:7.5,height:2.7,cols:4,yaw:Math.PI/2,name:'main-raised-doors'});
 box([35.1,8.12,gateZ],[5.1,.4,10.2],plaster,'main-entrance-canopy');
 box([35.25,7.87,gateZ],[4.9,.06,9.9],shade);
 function stairFlight(start,end,width,name){
  const dx=end[0]-start[0],dz=end[2]-start[2],length=Math.hypot(dx,dz),rise=end[1]-start[1],n=23,group=b.group('school:'+name,start);group.rotation.y=Math.atan2(-dx,-dz);
  for(let i=0;i<n;i++){const h=rise*(i+1)/n;b.box([0,h/2,-length*(i+.5)/n],[width,h,length/n+.008],pavement,group);}
  const nx=-dz/length,nz=dx/length;
  for(const side of [-1,1]){
   const p=[start[0]+nx*side*(width/2+.08),start[1],start[2]+nz*side*(width/2+.08)],q=[end[0]+nx*side*(width/2+.08),end[1],end[2]+nz*side*(width/2+.08)];
   b.rail(p,q,1.02,gateMetal,{spacing:.8,depth:.028});
  }
 }
 stairFlight([40.6,groundY,-46],[35.9,platformY,-42.25],2.6,'main-left-stair');
 stairFlight([40.6,groundY,-34],[35.9,platformY,-37.75],2.6,'main-right-stair');
 for(const z of [-44.1,-35.9])b.rail([33.6,platformY,z],[36.6,platformY,z],1,gateMetal,{spacing:.85,depth:.03});
 box([42.4,groundY+.026,gateZ],[10,.035,18.7],pavement,'main-gate-approach');
 for(let i=0;i<5;i++)box([50.2-i*.38,.2+(i+1)*.162/2,gateZ],[.39,(i+1)*.162,19],pavement,'main-entry-step-'+i);
 const gateThreshold=box([gateX,groundY+.032,gateZ],[.3,.06,6.6],trim,'main-gate-threshold');
 for(const side of [-1,1]){
  const z=gateZ+side*3.5;
  box([gateX,groundY+.72,z+side*3.4],[.52,1.44,6.8],trim,'main-gate-wall-'+side);
  box([gateX,groundY+.76,z],[.48,1.52,.42],gateMetal);
  b.rail([gateX,groundY,z],[gateX-2.6,groundY,z],1.1,gateMetal,{spacing:.2,depth:.022});
 }
 const nameplate=b.sign('千葉市立稲毛高等学校\n千葉市立稲毛国際中等教育学校',4.7,.76,[gateX+.28,groundY+.86,gateZ+6.8],{bg:'#59605a',fg:'#e2e3d8',size:57});nameplate.rotation.y=Math.PI/2;

 // Square clock tower behind the library. Hands are retained geometry and
 // follow local wall time even when scenery motion is paused.
 box([30.9,groundY+8.8,-51],[4.3,17.6,4.1],plaster,'library-clock-tower');
 box([30.9,18.8,-51],[4.5,.24,4.3],trim);
 const clock=b.group('school:clock-face',[33.063,15.7,-51]);clock.rotation.y=Math.PI/2;
 const clockDark=b.mat('paint:clock-indices','#454c47'),clockFace=b.mat('plaster:clock-face','#dfdfd3');
 b.box([0,0,0],[1.8,2.1,.025],clockFace,clock);
 for(let i=0;i<60;i++){
  const a=i*Math.PI/30,major=i%5===0,o=b.box([Math.sin(a)*.71,Math.cos(a)*.71,.027],[major?.035:.015,major?.13:.053,.025],clockDark,clock);o.rotation.z=-a;
 }
 const hand=(name,length,width,z)=>{const pivot=b.group('school:clock-'+name,[0,0,z],clock);const h=b.box([0,length*.42,0],[width,length,.028],clockDark,pivot);h.userData.keep=true;return pivot;};
 const hourHand=hand('hour',.43,.065,.055),minuteHand=hand('minute',.64,.042,.085),secondHand=hand('second',.69,.015,.114);
 const hub=b.cylinderAt([0,0,.15],.054,.04,clockDark,clock);hub.rotation.x=Math.PI/2;hub.userData.keep=true;
 let lastClock=-1;
 const updateClock=date=>{const value=date instanceof Date?date:new Date(date||Date.now()),second=Math.floor(value.getTime()/1000);if(second===lastClock)return;lastClock=second;const s=value.getSeconds(),m=value.getMinutes()+s/60,h=value.getHours()%12+m/60;hourHand.rotation.z=-h*Math.PI/6;minuteHand.rotation.z=-m*Math.PI/30;secondHand.rotation.z=-s*Math.PI/30;clock.userData.time={hour:value.getHours(),minute:value.getMinutes(),second:s};if(renderer?.shadowMap)renderer.shadowMap.needsUpdate=true;};
 updateClock(new Date());

 // The two public roads are one real corner, with a clear traffic corridor.
 box([4,.025,21],[112,.05,7.9],asphalt,'south-road');
 box([55,.025,-34.5],[10,.05,119],asphalt,'east-road');
 box([48.4,.11,-41],[2.1,.22,106],pavement,'east-sidewalk');
 for(const z of [17.35,24.4])box([4,.065,z],[112,.016,.09],line);
 for(const x of [50.5,59.5])box([x,.065,-34.5],[.09,.016,119],line);
 for(let z=-89;z<10;z+=4.8)box([55,.066,z],[.085,.016,2.65],line);
 for(let x=-50;x<46;x+=5)box([x,.066,21],[2.65,.016,.085],line);
 for(let i=0;i<8;i++)box([51.4+i*.95,.072,13],[.5,.018,4.8],line);
 for(let i=0;i<7;i++)box([43.7,.073,18.15+i*.9],[4.6,.018,.45],line);
 // Return the campus boundary around both street fronts; leave both gates open.
 for(const [a,c]of [[[-38,groundY,11.5],[-22,groundY,11.5]],[[23.2,groundY,11.5],[47,groundY,11.5]],[[47,groundY,11.5],[47,groundY,-29.5]],[[47,groundY,-50.5],[47,groundY,-90]]]){
  b.beam([a[0],groundY-.26,a[2]],[c[0],groundY-.26,c[2]],.52,trim,b.root,.7);b.rail(a,c,1.15,gateMetal,{spacing:1.3,depth:.025});
 }
 // Globe fixtures match the entrance photograph; downward practicals reveal
 // the paving instead of relying on emissive bulbs alone.
 const practicals=[];
 for(const [x,z]of [[45.4,-48.7],[45.4,-31.3],[46.8,5],[46.8,-70]]){
  b.cylinderAt([x,groundY+1.9,z],.048,3.8,gateMetal);
  const lens=b.mat('lamp:school-entry-globe','#e2ded0',{emissive:'#ffe1b0',emissiveIntensity:.1}),g=b.mesh(b.own(new T.SphereGeometry(.15,16,12)),lens,[x,groundY+3.86,z]);g.castShadow=false;
  const light=new T.SpotLight('#ffe0b3',95,11,Math.PI*.42,.78,2);light.position.set(x,groundY+3.68,z);light.target.position.set(x-.8,groundY,z);b.root.add(light,light.target);b.lamps.push({light,material:lens,intensity:95,day:.01,night:1});practicals.push(light);
 }
 // The gym and pool occupy the opposite side of the academic courtyard.
 const gymRoof=b.mat('paint:gym-pale-green-metal','#8ba998'),pool=b.mat('paint:pool-water','#348a91');
 box([-43,groundY+5.8,-60],[17,11.6,30],plaster,'west-gymnasium');
 box([-43,groundY+11.7,-60],[17.7,.3,30.7],gymRoof);
 for(const side of [-1,1])windows({position:[-43,groundY+8.7,-60+side*15.025],width:14,height:2.2,cols:10,yaw:side<0?Math.PI:0,name:'gym-high-window'});
 box([-43,groundY+.18,-84.5],[17,.36,15],trim,'pool-deck');box([-43,groundY+.37,-84.5],[13.8,.06,11.8],pool,'swimming-pool');
 for(let i=0;i<6;i++)box([-48.7+i*2.3,groundY+.405,-84.5],[.08,.015,11.5],line);
 for(const side of [-1,1])b.rail([-51.3,groundY+.38,-84.5+side*7],[-34.7,groundY+.38,-84.5+side*7],1.2,gateMetal,{spacing:.5,depth:.018});

 // Layered garden planting keeps the school grounded while leaving entrance
 // sightlines and its open courtyard legible from both street views.
 for(const [x,z,h,s]of [[-32,3,8,2.8],[29,5,7.8,2.7],[-19,-32,7,2.7],[18,-52,7.5,2.9],[-18,-54,7.5,2.8],[18,-32,6.9,2.5],[39,-24,6.8,2.5],[42,-73,7.5,2.8],[-39,-28,8,3]]){
  const previous=new Set(b.root.children);b.tree(x,z,h,s);for(const o of b.root.children)if(!previous.has(o))o.position.y+=groundY;
 }
 const gardenPoints=[];
 for(let i=0;i<1800;i++){
  const z=-80+b.rng()*88,x=b.rng()<.5?43.8+b.rng()*2: -36.8+b.rng()*1.6;
  if(x>0&&Math.abs(z-gateZ)<11)continue;
  gardenPoints.push({x,y:groundY+.12+b.rng()*.65,z,size:.14+b.rng()*.16});
 }
 b.leaves(gardenPoints,{name:'foliage:campus-boundary-garden',color:'#647e44'});
 const before={background:scene.background,fog:scene.fog,environment:scene.environment,intensity:scene.environmentIntensity,tone:renderer?.toneMapping,exposure:renderer?.toneMappingExposure};
 const added=b.finish({w:112,d:119,photo:{position:[87,26,47],target:[0,6,-29],fov:48},companion:{position:[86,14,45],target:[3,7,-28],fov:49},background:'#9db7c6'});
 // The original school owns the sun, sky, climate and exposure. The extension
 // owns geometry and practicals, so adding its facade does not double the fill.
 for(const child of [...added.root.children])if(child.isDirectionalLight||child.isHemisphereLight)child.removeFromParent();
 scene.background=before.background;scene.fog=before.fog;scene.environment=before.environment;scene.environmentIntensity=before.intensity;
 if(renderer){renderer.toneMapping=before.tone;renderer.toneMappingExposure=before.exposure;}
 api.root.add(added.root);api.root.updateMatrixWorld(true);
 for(const light of api.root.children)if(light.isDirectionalLight&&light.castShadow){light.shadow.camera.left=-84;light.shadow.camera.right=84;light.shadow.camera.top=84;light.shadow.camera.bottom=-84;light.shadow.camera.far=240;light.shadow.camera.updateProjectionMatrix();light.shadow.needsUpdate=true;}
 api.framingRoot=api.root;api.bounds=new T.Box3().setFromObject(api.root);
 // The public streets continue beyond the finite campus framing. They keep
 // pedestrian views grounded instead of exposing the edge of a display slab.
 const outside=b.mesh(b.own(new T.PlaneGeometry(720,720)),b.mat('soil:school-street-verge','#75885c'),[0,-.018,-30],[1,1,1],api.root,'school:continuous-surroundings');outside.rotation.x=-Math.PI/2;outside.castShadow=false;
 for(const [x,width]of [[-176,248],[180,240]])b.box([x,.025,21],[width,.05,7.9],asphalt,api.root,'school:continuing-south-road');
 for(const [z,depth]of [[-197,206],[162.5,275]])b.box([55,.025,z],[10,.05,depth],asphalt,api.root,'school:continuing-east-road');
 const white=api.cameraPresets.photo;
 const front={position:[0,2.15,36],target:[0,5.4,-12],fov:47};
 api.cameraPresets={...api.cameraPresets,photo:front,whiteEntrance:front,redEntrance:{position:[79,2.15,-40],target:[28,6.6,-40],fov:49},campusCorner:added.cameraPresets.photo,companion:front,overview:{direction:[1.1,.8,1.3],fov:36,padding:1.03}};
 api.root.userData.schoolCampus={topology:'four-wing courtyard with gates on adjacent streets',groundY,entrances:{white:{position:[0,groundY,10.55],outward:[0,0,1]},library:{position:[gateX,groundY,gateZ],outward:[1,0,0]}},roadAxes:{south:'x',east:'z'},sources:['https://www.city.chiba.jp/kyoiku/kyoikusomu/kikaku/documents/documents/410inagegakkouyouran.pdf'],compactReconstruction:true};
 const original={setLighting:api.setLighting,setMotion:api.setMotion,update:api.update,updateTime:api.updateTime,dispose:api.dispose};let disposed=false;
 api.setLighting=id=>{
  const result=original.setLighting(id),saved={background:scene.background,fog:scene.fog,tone:renderer?.toneMapping,exposure:renderer?.toneMappingExposure};
  added.setLighting(result==='night'?'night':result==='dusk'?'evening':'day');
  scene.background=saved.background;scene.fog=saved.fog;if(renderer){renderer.toneMapping=saved.tone;renderer.toneMappingExposure=saved.exposure;}return result;
 };
 api.setMotion=value=>{const result=original.setMotion(value);added.setMotion(typeof value==='boolean'?{enabled:value}:value);return result;};
 api.update=(...args)=>{if(!disposed){original.update(...args);added.update(...args);}};
 api.updateTime=date=>{if(!disposed){original.updateTime?.(date);updateClock(date);}};
 api.dispose=()=>{if(disposed)return;disposed=true;added.dispose();original.dispose();};
 api.setLighting(api.defaultLighting);return api;
}
