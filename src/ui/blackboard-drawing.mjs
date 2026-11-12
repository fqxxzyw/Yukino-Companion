import * as THREE from 'three';
import {drawPoster} from './scene-artwork.mjs';

export const BLACKBOARD_SIZE=Object.freeze({width:1568,height:444});
export const BLACKBOARD_COLOR='#183c30';
const clamp=value=>Math.min(1,Math.max(0,value));
const validUV=uv=>uv&&Number.isFinite(uv.x)&&Number.isFinite(uv.y)&&uv.x>=0&&uv.x<=1&&uv.y>=0&&uv.y<=1;
let nextOwner=0;

// Own the drawing independently of a WebGL scene. Detaching or disposing GPU
// resources retains the canvas, marks and snapshot so failed sends can retry.
export class BlackboardDrawingController{
 constructor({canvasFactory=()=>document.createElement('canvas'),textureFactory=canvas=>new THREE.CanvasTexture(canvas),posterPainter=drawPoster,requestFrame=callback=>globalThis.requestAnimationFrame(callback),cancelFrame=id=>globalThis.cancelAnimationFrame(id)}={}){
  this.canvas=canvasFactory();this.canvas.width=BLACKBOARD_SIZE.width;this.canvas.height=BLACKBOARD_SIZE.height;
  this.context=this.canvas.getContext('2d');if(!this.context)throw Error('当前环境无法使用黑板画布。');
  this.canvasFactory=canvasFactory;this.textureFactory=textureFactory;this.posterPainter=posterPainter;this.requestFrame=requestFrame;this.cancelFrame=cancelFrame;this.owner=++nextOwner;this.revision=0;this.marks=[];this.assistantText='';this.assistantPoster=null;this.posterProgress=0;this.posterFrame=null;this.posterPending=false;this.posterGeneration=0;this.listeners=new Set();this.raycaster=new THREE.Raycaster();this.pointer=new THREE.Vector2();this.paint();
 }
 subscribe(listener){this.listeners.add(listener);return()=>this.listeners.delete(listener)}
 changed(){
  this.cachedSnapshot=null;if(this.texture)this.texture.needsUpdate=true;
  if(this.overlay)this.overlay.visible=this.hasInk()||Boolean(this.assistantText)||Boolean(this.assistantPoster);
  this.renderer?.requestRender?.();for(const listener of this.listeners)listener(this);
 }
 paint(){
  const ctx=this.context;ctx.clearRect(0,0,this.canvas.width,this.canvas.height);
  ctx.strokeStyle='#ffffff';ctx.fillStyle='#ffffff';ctx.lineWidth=4.4;ctx.lineCap='round';ctx.lineJoin='round';
  if(this.assistantPoster&&this.posterPainter){ctx.save();try{this.posterPainter(ctx,this.assistantPoster,this.posterProgress);}finally{ctx.restore();}}
  else this.paintAssistantText();
  // The poster painter may change colour and stroke width. User ink stays white.
  ctx.strokeStyle='#ffffff';ctx.fillStyle='#ffffff';ctx.lineWidth=4.4;ctx.lineCap='round';ctx.lineJoin='round';
  for(const mark of this.marks)this.paintMark(mark);
 }
 // Assistant writing is a separate, replaceable layer: it is visible on the
 // board but never counts as a user stroke or starts the idle-send timer.
 setAssistantText(text){
  if(typeof text!=='string')return false;
  const next=Array.from(text.replace(/\r\n?/g,'\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g,'')).slice(0,1000).join('').trim();
  if(next===this.assistantText&&!this.assistantPoster)return false;
  this.cancelPosterAnimation();this.assistantPoster=null;this.posterProgress=0;this.posterPending=false;this.assistantText=next;this.paint();this.changed();return true;
 }
 // The animated artwork is separate from marks and revisions, so it cannot
 // initiate a user-image send and repainting it never discards the user's ink.
 setAssistantPoster(poster){
  if(!poster||typeof poster!=='object'||Array.isArray(poster)||typeof poster.text!=='string'||!Array.isArray(poster.elements)||typeof this.posterPainter!=='function')return false;
  this.cancelPosterAnimation();this.assistantText='';this.assistantPoster=poster;this.posterProgress=0;this.posterPending=true;
  this.paint();this.changed();if(this.board)this.startPosterAnimation();return true;
 }
 startPosterAnimation(){
  if(!this.posterPending||!this.assistantPoster||!this.board)return;
  this.posterPending=false;
  const poster=this.assistantPoster,generation=this.posterGeneration,startProgress=this.posterProgress;
  const headingLength=typeof poster.title?.text==='string'?Array.from(poster.title.text).length:0;
  const duration=Math.max(2400,Math.min(12000,headingLength*520+poster.text.length*240+poster.elements.length*380+1200));let started=null;
  const tick=time=>{
   if(generation!==this.posterGeneration)return;
   this.posterFrame=null;if(!Number.isFinite(time))return;
   if(started===null)started=time;
   this.posterProgress=Math.min(1,Math.max(0,startProgress+(time-started)/duration));this.paint();this.changed();
   if(this.posterProgress<1)this.posterFrame=this.requestFrame(tick);
  };
  this.posterFrame=this.requestFrame(tick);
 }
 cancelPosterAnimation(){this.posterGeneration++;if(this.posterFrame!==null)this.cancelFrame(this.posterFrame);this.posterFrame=null;}
 paintAssistantText(){
  if(!this.assistantText)return;
  // Chat bubbles occupy the left side of the board. Keep board replies on the
  // right so a short answer cannot disappear underneath the reply bubble.
  const ctx=this.context,pad=34,left=Math.ceil(this.canvas.width*.52),maxWidth=this.canvas.width-left-pad;
  ctx.textBaseline='top';ctx.fillStyle='#ffffff';
  let lines=[],lineHeight=54,maxLines=0,measure;
  for(let size=42;size>=24;size-=2){
   ctx.font=`${size}px sans-serif`;lineHeight=Math.ceil(size*1.28);maxLines=Math.floor((this.canvas.height-pad*2)/lineHeight);
   measure=text=>{const width=ctx.measureText(text)?.width;return Number.isFinite(width)?width:Array.from(text).length*size;};
   lines=[];let line='';
   for(const char of this.assistantText){
    if(char==='\n'){lines.push(line);line='';continue;}
    const candidate=line+char;
    if(line&&measure(candidate)>maxWidth){lines.push(line);line=char;}else line=candidate;
   }
   lines.push(line);
   if(lines.length<=maxLines)break;
  }
  const visible=lines.slice(0,maxLines);
  if(lines.length>maxLines){let last=visible[maxLines-1];while(last&&measure(last+'…')>maxWidth)last=Array.from(last).slice(0,-1).join('');visible[maxLines-1]=last+'…';}
  visible.forEach((value,index)=>ctx.fillText(value,left,pad+index*lineHeight,maxWidth));
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
  this.changed();if(this.posterPending)this.startPosterAnimation();return true;
 }
 detach(){
  this.end();const renderer=this.renderer;if(this.board){this.cancelPosterAnimation();this.posterPending=Boolean(this.assistantPoster)&&this.posterProgress<1;}
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
 dispose(){this.detach();this.cancelPosterAnimation();this.posterPending=false;this.listeners.clear()}
}
