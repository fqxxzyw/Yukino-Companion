import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';

export const randomSeed=seed=>()=>{seed=(Math.imul(seed,1664525)+1013904223)|0;return (seed>>>0)/4294967296;};
export const vec=p=>new T.Vector3(...p);

// Shared construction operations, not a stock finished scene. Each place owns
// its plan, silhouette, details and camera. World units are metres.
export class Diorama {
 constructor(scene,renderer,name){
  this.scene=scene;this.renderer=renderer;this.root=new T.Group();this.root.name=name;
  this.geo=new Set();this.materials=new Set();this.textures=new Set();this.lamps=[];this.animations=[];this.instances=[];
  this.rng=randomSeed(1987);this.motion=true;this.disposed=false;
  this.unitBox=this.own(new T.BoxGeometry(1,1,1));this.cylinder=this.own(new T.CylinderGeometry(1,1,1,10));
 }
 own(g){this.geo.add(g);return g;}
 mat(name,color,options={}){
  const m=new T.MeshStandardMaterial({color,roughness:.85,metalness:0,...options});m.name=name.replace(/[\r\n\u2028\u2029]+/g,' ');
  m.userData.weatherExposure=!/interior|sign|lamp|paper|bowl|glass/.test(name);this.materials.add(m);return m;
 }
 mesh(g,m,p=[0,0,0],s=[1,1,1],parent=this.root,name=m.name){
  const o=new T.Mesh(g,m);o.name=name;o.position.set(...p);o.scale.set(...s);o.castShadow=true;o.receiveShadow=true;parent.add(o);return o;
 }
 box(p,s,m,parent=this.root,name){return this.mesh(this.unitBox,m,p,s,parent,name);}
 cylinderAt(p,r,h,m,parent=this.root){return this.mesh(this.cylinder,m,p,[r,h,r],parent);}
 beam(a,b,width,m,parent=this.root,depth=width){const p=vec(a),q=vec(b),o=this.box(p.clone().add(q).multiplyScalar(.5).toArray(),[width,p.distanceTo(q),depth],m,parent);o.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),q.sub(p).normalize());return o;}
 tube(a,b,r,m,parent=this.root){const p=vec(a),q=vec(b),o=this.cylinderAt(p.clone().add(q).multiplyScalar(.5).toArray(),r,p.distanceTo(q),m,parent);o.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),q.sub(p).normalize());return o;}
 group(name,p=[0,0,0],parent=this.root){const g=new T.Group();g.name=name;g.position.set(...p);parent.add(g);return g;}
 plinth(w,d,color='#686555'){
  this.mesh(this.own(new RoundedBoxGeometry(w,.62,d,2,.14)),this.mat('base:cut-earth',color),[0,-.35,0]);
 }
 sign(text,w,h,p,{bg='#ece8d6',fg='#292e30',size=82,font='serif',draw,emissive=false,parent=this.root}={}){
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=Math.max(128,Math.round(1024*h/w));
  const c=canvas.getContext('2d');c.fillStyle=bg;c.fillRect(0,0,canvas.width,canvas.height);
  if(draw)draw(c,canvas.width,canvas.height);
  else {c.fillStyle=fg;c.textAlign='center';c.textBaseline='middle';c.font=`bold ${size}px ${font}`;const lines=text.split(/\r?\n/);lines.forEach((line,i)=>c.fillText(line,512,canvas.height/2+(i-(lines.length-1)/2)*size*1.35,970));}
  const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=4;this.textures.add(texture);
  const m=this.mat('sign:'+text,'#ffffff',{map:texture,roughness:.72,emissive:emissive?'#ffffff':'#000000',emissiveMap:emissive?texture:null,emissiveIntensity:emissive?.15:0});
  if(emissive)this.lamps.push({material:m,day:.12,night:1.15});
  const o=this.mesh(this.own(new T.PlaneGeometry(w,h)),m,p,[1,1,1],parent);o.castShadow=false;return o;
 }
 lamp(p,{color='#ffe5b5',intensity=14,range=6,radius=.08,parent=this.root}={}){
  const m=this.mat('lamp:emitter',color,{emissive:color,emissiveIntensity:.5});
  const bulb=this.box(p,[radius*2,.055,radius*2],m,parent);
  const light=new T.PointLight(color,intensity,range,2);light.position.set(p[0],p[1]-.09,p[2]);parent.add(light);
  this.lamps.push({light,material:m,day:.18,night:1,intensity});return bulb;
 }
 leaves(points,{narrow=false,color='#617b48',name='foliage:leaves'}={}){
  if(!points.length)return;
  const g=this.own(new T.BufferGeometry());
  // A tapered, folded lamina catches light differently along its midrib and
  // edges. UVs let the shared botanical finish follow each individual leaf.
  const positions=[],uvs=[],indices=[],sections=6;
  for(let j=0;j<=sections;j++){
   const t=j/sections,width=Math.pow(Math.sin(Math.PI*t),.78)*(narrow?.13:.3)*(1+.035*Math.sin(j*2.8));
   const curl=Math.sin(t*Math.PI)*.045+t*t*.04;
   for(const side of [-1,0,1]){positions.push(side*width,t-.5,curl+(side===0?Math.sin(t*Math.PI)*.055:0));uvs.push((side+1)*.5,t);}
   if(j<sections)for(let k=0;k<2;k++){const a=j*3+k;indices.push(a,a+1,a+3,a+1,a+4,a+3);}
  }
  g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));g.setIndex(indices);g.computeVertexNormals();
  const m=this.mat(name,color,{side:T.DoubleSide,roughness:.92});
  const wind={uWindTime:{value:0},uWindStrength:{value:.025}};m.userData.windUniforms=wind;
  m.onBeforeCompile=shader=>{Object.assign(shader.uniforms,wind);shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nuniform float uWindTime; uniform float uWindStrength;').replace('#include <begin_vertex>',`#include <begin_vertex>
   float phase=0.0;
   #ifdef USE_INSTANCING
    phase=instanceMatrix[3].x*1.7+instanceMatrix[3].z;
   #endif
   transformed.z+=sin(uWindTime*1.8+phase+position.y*4.0)*uWindStrength*(position.y+.5);`);};
  m.customProgramCacheKey=()=>`leaf-wind:${narrow}`;
  const mesh=new T.InstancedMesh(g,m,points.length),o=new T.Object3D(),r=this.rng;
  mesh.name=name;
  points.forEach((p,i)=>{o.position.set(p.x,p.y,p.z);o.rotation.set(p.rx??r()*2.4,p.ry??r()*6.28,p.rz??r()*6.28);const size=p.size??.17;o.scale.set(size,size*(narrow?2:1.25),size);o.updateMatrix();mesh.setMatrixAt(i,o.matrix);mesh.setColorAt(i,new T.Color().setHSL(p.hue??(.22+r()*.07),.23+r()*.2,.22+r()*.15));});
  mesh.castShadow=true;mesh.receiveShadow=true;mesh.computeBoundingSphere();this.root.add(mesh);this.instances.push(mesh);this.animations.push(t=>{wind.uWindTime.value=t;});return mesh;
 }
 tree(x,z,height=4,spread=1.6){
  const bark=this.bark??=this.mat('tree:bark','#655b48');const r=this.rng;
  const top=[x+.14,height*.74,z+.08];this.tube([x,0,z],top,height*.035,bark);
  const points=[];
  for(let j=0;j<9;j++){
   const angle=j*2.3999,h=height*(.48+r()*.44),end=[x+Math.cos(angle)*spread*(.6+r()*.4),h,z+Math.sin(angle)*spread];
   const start=[x+.1,height*(.34+j*.035),z];this.tube(start,end,.028+height*.007,bark);
   for(let k=0;k<4;k++){
    const tip=[end[0]+Math.cos(angle+k)*.6,end[1]+.4+r()*.45,end[2]+Math.sin(angle+k)*.6];this.tube(end,tip,.014,bark);
    for(let n=0;n<32;n++){const a=r()*6.28,rad=Math.sqrt(r())*.65;points.push({x:tip[0]+Math.cos(a)*rad,y:tip[1]+(r()-.5)*.65,z:tip[2]+Math.sin(a)*rad,size:.12+r()*.15});}
   }
  }
  this.leaves(points);return points;
 }
 shrubs(x,z,w,d,h=.7){const pts=[];const r=this.rng;for(let i=0;i<w*d*130;i++)pts.push({x:x+(r()-.5)*w,y:.08+r()*h,z:z+(r()-.5)*d,size:.12+r()*.14});this.leaves(pts);}
 rail(a,b,height,m,{spacing=.65,base=0,depth=.045}={}){
  const p=vec(a),q=vec(b);this.tube([p.x,p.y+height,p.z],[q.x,q.y+height,q.z],depth,m);
  this.tube([p.x,p.y+.18,p.z],[q.x,q.y+.18,q.z],depth*.7,m);
  const count=Math.ceil(p.distanceTo(q)/spacing);
  for(let i=0;i<=count;i++){const v=p.clone().lerp(q,i/count);this.tube([v.x,v.y+base,v.z],[v.x,v.y+height,v.z],depth*.65,m);}
 }
 stairs({x=0,z=0,y=0,width=4,count=20,rise=.16,tread=.32,material}){
  const group=this.group('stairs:actual-treads');
  for(let i=0;i<count;i++)this.box([x,y+(i+1)*rise/2,z-i*tread],[width,(i+1)*rise,tread+.012],material,group);
  return {top:[x,y+count*rise,z-(count-1)*tread],group};
 }
 rain(w,d,top=12){
  const count=850,positions=new Float32Array(count*6),seeds=[];const r=this.rng;
  for(let i=0;i<count;i++)seeds.push([(r()-.5)*w,r()*top,(r()-.5)*d]);
  const g=this.own(new T.BufferGeometry());g.setAttribute('position',new T.BufferAttribute(positions,3));
  const m=new T.LineBasicMaterial({color:'#c2d2d5',transparent:true,opacity:.27,depthWrite:false});this.materials.add(m);
  const mesh=new T.LineSegments(g,m);mesh.name='weather:rain-streaks';mesh.visible=false;mesh.frustumCulled=false;this.root.add(mesh);
  this.animations.push(t=>{if(!mesh.visible)return;for(let i=0;i<count;i++){const [x,y,z]=seeds[i],v=((y-t*4)%top+top)%top;positions.set([x,v,z,x-.025,v-.24,z],i*6);}g.attributes.position.needsUpdate=true;});
 }
 finish({w=20,d=20,photo,companion=photo,overview=[1,.8,1.25],background='#b8c7c9',rain=true}={}){
  // Bake fixed details by material; named logical groups stay for inspection.
  this.root.updateMatrixWorld(true);const batches=new Map();
  this.root.traverse(o=>{if(o.isMesh&&!o.isInstancedMesh&&!o.userData.keep){const a=batches.get(o.material)||[];a.push(o);batches.set(o.material,a);}});
  for(const [m,meshes]of batches){
   // A long fence or grove can contain thousands of copies of one cylinder.
   // Cloning and merging each copy blocks the renderer thread and duplicates
   // all its vertex data. Keep the exact transforms, but upload the shared
   // geometry once and batch the copies as instances instead.
   const shared=new Map();for(const o of meshes){const list=shared.get(o.geometry)||[];list.push(o);shared.set(o.geometry,list);}
   const instanced=new Set();for(const [geometry,list]of shared){if(list.length<8)continue;
    const batch=new T.InstancedMesh(geometry,m,list.length);batch.name=m.name;batch.castShadow=true;batch.receiveShadow=true;
    list.forEach((o,i)=>{batch.setMatrixAt(i,o.matrixWorld);instanced.add(o);o.removeFromParent();});
    batch.computeBoundingSphere();this.root.add(batch);this.instances.push(batch);
   }
   const remaining=meshes.filter(o=>!instanced.has(o));if(remaining.length<2)continue;
   const copies=remaining.map(o=>o.geometry.clone().applyMatrix4(o.matrixWorld));const merged=mergeGeometries(copies);copies.forEach(g=>g.dispose());if(!merged)continue;this.mesh(this.own(merged),m);remaining.forEach(o=>o.removeFromParent());
  }
  const framingRoot=this.group('framing:architecture');for(const child of [...this.root.children])if(child!==framingRoot)framingRoot.add(child);
  this.root.updateMatrixWorld(true);const bounds=new T.Box3().setFromObject(framingRoot);
  const sun=new T.DirectionalLight('#fff0d7',2.8);sun.position.set(-12,20,12);sun.castShadow=true;sun.shadow.camera.left=-w*.7;sun.shadow.camera.right=w*.7;sun.shadow.camera.top=d*.8;sun.shadow.camera.bottom=-d*.8;sun.shadow.camera.far=120;sun.shadow.normalBias=.035;sun.shadow.bias=-.00015;this.root.add(sun,sun.target);
  const hemi=new T.HemisphereLight('#cbdde4','#86765c',1.7);this.root.add(hemi);
  if(rain)this.rain(w,d,Math.max(12,bounds.max.y+2));
  const previous={background:this.scene.background,fog:this.scene.fog};const bg=new T.Color(background),fog=new T.FogExp2(background,.003);this.scene.background=bg;this.scene.fog=fog;
  this.scene.add(this.root);
  const presets=['morning','day','evening','night'];
  const setLighting=id=>{if(!presets.includes(id))return false;const night=id==='night',evening=id==='evening';bg.set(night?'#172433':evening?'#b9a59b':background);this.scene.background=bg;this.scene.fog=fog;fog.color.copy(bg);sun.intensity=night?.5:2.8;hemi.intensity=night?.85:1.7;if(this.renderer){this.renderer.toneMapping=T.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1;}for(const l of this.lamps){const v=night?l.night:evening?l.night*.7:l.day;if(l.light)l.light.intensity=l.intensity*v;if(l.material)l.material.emissiveIntensity=v;}return true;};
  setLighting('day');
  const anchor=this.group('Character_Anchor',[0,0,3]);
  return {root:this.root,framingRoot,bounds,anchors:{character:anchor,Character_Anchor:anchor},cameraPresets:{overview:{direction:overview,fov:36,padding:1.04},photo,companion},lightingPresets:presets,setLighting,
   setMotion:({enabled})=>{this.motion=enabled;},update:(dt,t)=>{if(this.disposed||!this.motion)return;for(const fn of this.animations)fn(t);},
   dispose:()=>{if(this.disposed)return;this.disposed=true;this.root.removeFromParent();for(const i of this.instances)i.dispose();for(const g of this.geo)g.dispose();for(const m of this.materials)m.dispose();for(const t of this.textures)t.dispose();sun.shadow.dispose();if(this.scene.background===bg)this.scene.background=previous.background;if(this.scene.fog===fog)this.scene.fog=previous.fog;},
  };
 }
}
