import * as THREE from 'three';

export const BLACKBOARD_SIZE=Object.freeze({width:1568,height:444});
export const BLACKBOARD_COLOR='#183c30';
const clamp=value=>Math.min(1,Math.max(0,value));
const validUV=uv=>uv&&Number.isFinite(uv.x)&&Number.isFinite(uv.y)&&uv.x>=0&&uv.x<=1&&uv.y>=0&&uv.y<=1;
let nextOwner=0;

// Own the drawing independently of a WebGL scene. Detaching or disposing GPU
// resources retains the canvas, marks and snapshot so failed sends can retry.
export class BlackboardDrawingController{
 constructor({canvasFactory=()=>document.createElement('canvas'),textureFactory=canvas=>new THREE.CanvasTexture(canvas)}={}){
  this.canvas=canvasFactory();this.canvas.width=BLACKBOARD_SIZE.width;this.canvas.height=BLACKBOARD_SIZE.height;
  this.context=this.canvas.getContext('2d');if(!this.context)throw Error('当前环境无法使用黑板画布。');
  this.canvasFactory=canvasFactory;this.textureFactory=textureFactory;this.owner=++nextOwner;this.revision=0;this.marks=[];this.listeners=new Set();this.raycaster=new THREE.Raycaster();this.pointer=new THREE.Vector2();this.paint();
 }
 subscribe(listener){this.listeners.add(listener);return()=>this.listeners.delete(listener)}
 changed(){
  this.cachedSnapshot=null;if(this.texture)this.texture.needsUpdate=true;
  if(this.overlay)this.overlay.visible=this.hasInk();
  this.renderer?.requestRender?.();for(const listener of this.listeners)listener(this);
 }
 paint(){
  const ctx=this.context;ctx.clearRect(0,0,this.canvas.width,this.canvas.height);
  ctx.strokeStyle='#ffffff';ctx.fillStyle='#ffffff';ctx.lineWidth=4.4;ctx.lineCap='round';ctx.lineJoin='round';
  for(const mark of this.marks)this.paintMark(mark);
 }
 paintMark({from,to}){
  const ctx=this.context,x=to.x*this.canvas.width,y=(1-to.y)*this.canvas.height;
  ctx.beginPath();
  if(from){ctx.moveTo(from.x*this.canvas.width,(1-from.y)*this.canvas.height);ctx.lineTo(x,y);ctx.stroke();}
  else{ctx.arc(x,y,2.2,0,Math.PI*2);ctx.fill();}
 }
 attach(renderer){
  if(!renderer||renderer.disposed||renderer.contextUnavailable||renderer.loading||renderer.environmentScene!=='classroom'){this.detach();return false;}
  const board=renderer.current?.root?.getObjectByName('classroom:board');
  const material=[board?.material].flat().find(value=>value?.name==='classroom:blackboard');
  if(!board?.isMesh||!material||!board.geometry?.attributes?.uv){this.detach();return false;}
  if(this.board===board&&this.renderer===renderer&&this.overlay?.parent===board&&this.overlay.geometry===board.geometry)return true;
  this.detach();
  this.renderer=renderer;this.board=board;this.material=material;this.originalMap=material.map;
  this.texture=this.textureFactory(this.canvas);this.texture.colorSpace=THREE.SRGBColorSpace;this.texture.flipY=true;this.texture.name='classroom:user-chalk';
  this.inkMaterial=new THREE.MeshBasicMaterial({name:'classroom:user-chalk-material',color:'#ffffff',map:this.texture,transparent:true,opacity:1,toneMapped:false,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
  this.overlay=new THREE.Mesh(board.geometry,this.inkMaterial);this.overlay.name='classroom:user-chalk-overlay';this.overlay.position.z=.002;this.overlay.renderOrder=board.renderOrder+1;this.overlay.raycast=()=>{};
  board.add(this.overlay);
  this.changed();return true;
 }
 detach(){
  this.end();const renderer=this.renderer;
  this.overlay?.removeFromParent();this.inkMaterial?.dispose();this.texture?.dispose();
  this.overlay=null;this.inkMaterial=null;this.texture=null;this.material=null;this.originalMap=null;this.board=null;this.renderer=null;
  if(renderer&&!renderer.disposed)renderer.requestRender?.();
 }
 hasInk(){return this.marks.length>0}
 snapshot(){
  if(!this.hasInk())return null;
  if(!this.cachedSnapshot){
   // Only the exported image gets a background. The real board keeps its
   // authored dusty surface beneath a transparent layer containing white ink.
   this.exportCanvas??=this.canvasFactory();this.exportCanvas.width=this.canvas.width;this.exportCanvas.height=this.canvas.height;
   const context=this.exportCanvas.getContext('2d');context.fillStyle=BLACKBOARD_COLOR;context.fillRect(0,0,this.canvas.width,this.canvas.height);context.drawImage(this.canvas,0,0);
   this.cachedSnapshot=Object.freeze({image:this.exportCanvas.toDataURL('image/png'),revision:this.revision,owner:this.owner});
  }
  return this.cachedSnapshot;
 }
 clear(snapshot){
  if(snapshot&&(snapshot.owner!==this.owner||!Number.isInteger(snapshot.revision)))return false;
  const retained=snapshot?this.marks.filter(mark=>mark.revision>snapshot.revision):[];
  if(retained.length===this.marks.length)return false;
  this.marks=retained;this.end();this.revision++;this.paint();this.changed();return true;
 }
 mark(uv,from){
  const mark={revision:++this.revision,from:from?{...from}:null,to:{x:clamp(uv.x),y:clamp(uv.y)}};
  this.marks.push(mark);this.paintMark(mark);this.changed();return mark.to;
 }
 beginUV(uv){if(!validUV(uv))return false;this.last=this.mark(uv,null);return true}
 moveUV(uv){if(!validUV(uv)){this.last=null;return false;}this.last=this.mark(uv,this.last);return true}
 end(){this.last=null}
 hit(clientX,clientY){
  const renderer=this.renderer,board=this.board,rect=renderer?.gl?.domElement?.getBoundingClientRect?.();
  if(!board||!renderer?.camera||renderer.disposed||renderer.contextUnavailable||!rect?.width||!rect?.height||!Number.isFinite(clientX)||!Number.isFinite(clientY))return null;
  board.updateWorldMatrix(true,false);renderer.camera.updateMatrixWorld(true);
  this.pointer.set((clientX-rect.left)/rect.width*2-1,1-(clientY-rect.top)/rect.height*2);this.raycaster.setFromCamera(this.pointer,renderer.camera);
  return this.raycaster.intersectObject(board,false).find(hit=>validUV(hit.uv))?.uv||null;
 }
 begin(clientX,clientY){return this.beginUV(this.hit(clientX,clientY))}
 move(clientX,clientY){return this.moveUV(this.hit(clientX,clientY))}
 project(){
  const board=this.board,camera=this.renderer?.camera,rect=this.renderer?.gl?.domElement?.getBoundingClientRect?.();
  if(!board||!camera||!rect?.width||!rect?.height)return null;
  board.updateWorldMatrix(true,false);camera.updateMatrixWorld(true);
  const positions=board.geometry.attributes.position,uvs=board.geometry.attributes.uv,points=[];
  for(const [u,v]of [[0,1],[1,1],[1,0],[0,0]]){
   let closest=0,distance=Infinity;for(let i=0;i<uvs.count;i++){const d=(uvs.getX(i)-u)**2+(uvs.getY(i)-v)**2;if(d<distance){distance=d;closest=i;}}
   const point=new THREE.Vector3().fromBufferAttribute(positions,closest).applyMatrix4(board.matrixWorld).project(camera);
   if(!Number.isFinite(point.x)||!Number.isFinite(point.y)||point.z<-1||point.z>1)return null;
   points.push({x:rect.left+(point.x+1)*rect.width/2,y:rect.top+(1-point.y)*rect.height/2});
  }
  const area=points.reduce((sum,p,i)=>{const q=points[(i+1)%4];return sum+p.x*q.y-q.x*p.y;},0);
  if(area<=1)return null; // Back-facing or sub-pixel boards cannot accept ink.
  return {points,clipPath:`polygon(${points.map(p=>`${p.x.toFixed(2)}px ${p.y.toFixed(2)}px`).join(',')})`};
 }
 dispose(){this.detach();this.listeners.clear()}
}
