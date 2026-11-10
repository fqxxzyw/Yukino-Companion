import * as THREE from 'three';

const tau=Math.PI*2;

// All three hands derive from the same local wall-clock sample. Elapsed scene
// animation time must never make a clock drift after sleep or tab suspension.
export function localClockAngles(date=new Date()){
 const second=date.getSeconds()+date.getMilliseconds()/1000;
 const minute=date.getMinutes()+second/60;
 const hour=(date.getHours()%12)+minute/60;
 return {hour:-hour/12*tau,minute:-minute/60*tau,second:-second/60*tau};
}

export function createClassroomClock(parent){
 const root=new THREE.Group();root.name='classroom:wall-clock';
 root.position.set(.2,2.42,-4.447);parent.add(root);
 const material=(name,color,options={})=>{const m=new THREE.MeshStandardMaterial({color,roughness:.55,...options});m.name='classroom:clock-'+name;return m};
 const rim=material('rim','#64706c',{roughness:.34,metalness:.45});
 const back=material('case','#7b8580',{roughness:.73});
 const ink=material('hands','#202b2b',{roughness:.79});
 const red=material('second','#ad4f48',{roughness:.66});
 const mesh=(name,g,m,z=0,parent=root)=>{const node=new THREE.Mesh(g,m);node.name='classroom:clock-'+name;node.position.z=z;node.castShadow=false;node.receiveShadow=true;parent.add(node);return node};
 const cylinder=(r,depth)=>{const g=new THREE.CylinderGeometry(r,r,depth,64);g.rotateX(Math.PI/2);return g};
 mesh('case',cylinder(.289,.067),back,-.006);
 mesh('bezel',new THREE.TorusGeometry(.271,.018,12,64),rim,.033);
 mesh('inner-bezel',new THREE.TorusGeometry(.253,.004,8,64),rim,.038);

 const canvas=document.createElement('canvas');canvas.width=canvas.height=1024;
 const c=canvas.getContext('2d');
 c.fillStyle='#f4f2e8';c.fillRect(0,0,1024,1024);
 c.translate(512,512);
 for(let tick=0;tick<60;tick++){
  const major=tick%5===0,angle=tick/60*tau;
  const outer=474,inner=major?421:448;
  c.strokeStyle=major?'#293331':'#626b64';c.lineWidth=major?9:3;
  c.beginPath();c.moveTo(Math.sin(angle)*inner,-Math.cos(angle)*inner);c.lineTo(Math.sin(angle)*outer,-Math.cos(angle)*outer);c.stroke();
 }
 c.fillStyle='#26312f';c.font='500 108px Arial, sans-serif';c.textAlign='center';c.textBaseline='middle';
 for(let hour=1;hour<=12;hour++){
  const angle=hour/12*tau;c.fillText(String(hour),Math.sin(angle)*352,-Math.cos(angle)*352+3);
 }
 c.fillStyle='#7c867e';c.font='500 29px Arial, sans-serif';c.fillText('QUARTZ',0,190);
 const texture=new THREE.CanvasTexture(canvas);texture.name='classroom:clock-dial';texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
 const face=material('face','#ffffff',{map:texture,roughness:.94,metalness:0});
 mesh('face',new THREE.CircleGeometry(.25,64),face,.038);
 function hand(name,length,width,z,m,tail){
  const pivot=new THREE.Group();pivot.name='classroom:clock-'+name+'-pivot';pivot.position.z=z;root.add(pivot);
  const shape=new THREE.Shape();shape.moveTo(-width/2,-tail);shape.lineTo(-width/2,length-.022);shape.lineTo(0,length);shape.lineTo(width/2,length-.022);shape.lineTo(width/2,-tail);shape.closePath();
  mesh(name,new THREE.ShapeGeometry(shape),m,0,pivot);return pivot;
 }
 const hour=hand('hour',.142,.014,.048,ink,.025);
 const minute=hand('minute',.202,.010,.054,ink,.031);
 const second=hand('second',.221,.0038,.060,red,.060);
 mesh('counterweight',new THREE.CircleGeometry(.012,20),red,0,second).position.y=-.048;
 mesh('hub',cylinder(.014,.014),rim,.065);
 let lastSample;
 function updateTime(date=new Date()){
  const sample=date.getTime();if(sample===lastSample)return false;
  const angles=localClockAngles(date);lastSample=sample;
  hour.rotation.z=angles.hour;minute.rotation.z=angles.minute;second.rotation.z=angles.second;
  root.userData.localTime={hours:date.getHours(),minutes:date.getMinutes(),seconds:date.getSeconds()};return true;
 }
 updateTime();
 // The classroom factory owns disposal and discovers these normal Three.js
 // resources in its existing traversal; no timers or independent render loop.
 return {root,updateTime};
}
