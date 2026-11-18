import {bindNormalGarment} from './garment-runtime.mjs';
import * as THREE from 'three';
import {BlinkScheduler,bindValidatedBlink,bindIsolatedReviewBlink} from './blink-scheduler.mjs';
import {BLINK_REVIEW_V5,BLINK_REVIEW_MODEL} from './blink-review-contract.mjs';
import {SpeechMotionDirector} from '../speech/motion.mjs';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {AvatarPresentationController} from './avatar-presentation.mjs';
import {sceneId,scenePreset} from './scene-catalog.mjs';
import {inspectGlbSkinning,applyEightWeightSkinning,disposeEightWeightSkinning} from './eight-weight-skinning.mjs';
import {applyRenderStyle,modelMaterials,cameraFrame} from './model-style.mjs';
import {modelHitTest} from './model-hit-test.mjs';
import {bindAvatarTouchZones,hitAvatarTouchZone} from './avatar-touch.mjs';
import {sunlightConfig} from './sunlight.mjs';
import {sceneDaylight} from './scene-daylight.mjs';
import {walkingContract,travelDistance,makeWalkingPlan,sampleWalkingPlan} from './walking-transition.mjs';
import {prepareCustomStanding} from './custom-standing.mjs';
import {bindCandidateModelControls} from './candidate-model-controls.mjs';
import {bindCandidateBeret} from './beret-interaction.mjs';
import {bindApprovedBeret,seatApprovedBeret} from './approved-beret.mjs';
import {bindHeadGesture,HEAD_GESTURE_IDS} from './head-gesture.mjs';
import {restoreCandidateMaterialMaps} from './candidate-model-materials.mjs';
import {bindConversationExpression,conversationExpression} from './conversation-expression.mjs';
import {bindAnimeReactions} from './anime-reactions/index.mjs';
import {animeReplyCue} from './reaction-cue.mjs';
import {loadLocalCharacterActions} from './local-character-actions.mjs';
import {OutfitTurntableStage} from './outfit-turntable-stage.mjs';
import {turntableOrder,turntablePlan,turntableRadius} from './outfit-turntable.mjs';
export function reviewBlinkModelAllowed(entry,optIn){return optIn===true&&entry?.reviewOnly===true&&entry.id===BLINK_REVIEW_MODEL.id&&entry.sha256===BLINK_REVIEW_V5.assetSha256;}
export function selectModel(catalog,id,{reviewOptIn=false}={}){return catalog.find(item=>item.id===id&&item.url&&(item.reviewOnly||item.sha256===BLINK_REVIEW_V5.assetSha256?reviewBlinkModelAllowed(item,reviewOptIn):item.ready))||null}
export function microClipNames(entry,clips){if(entry?.custom)return [];return Object.keys(entry?.clips||{}).filter(name=>entry.clips[name].loop===false&&entry.clips[name].autonomous!==false&&clips?.has(name))}
export function mouthWeights(meshes,contract,amount){
 const name=contract?.canonical_name;if(!name)return;
 const max=contract.recommended_dialogue_range?.[1]||0;
 const value=Math.max(0,Math.min(max,Number.isFinite(amount)?amount:0));
 for(const mesh of meshes){const dict=mesh.morphTargetDictionary,influences=mesh.morphTargetInfluences;if(!dict||!influences)continue;
  for(const alias of contract.aliases_not_additive?.[name]||[])if(dict[alias]!==undefined)influences[dict[alias]]=0;
  if(dict[name]!==undefined)influences[dict[name]]=value;
 }
}
export function assertEmbeddedAsset(bytes){
 const view=new DataView(bytes);if(view.byteLength<20||view.getUint32(0,true)!==0x46546c67||view.getUint32(4,true)!==2||view.getUint32(8,true)!==view.byteLength)throw Error('人物 GLB 文件格式不完整。');
 const length=view.getUint32(12,true);if(length+20>view.byteLength||view.getUint32(16,true)!==0x4e4f534a)throw Error('人物 GLB 清单无效。');
 const json=JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,length)).trim());
 for(const item of [...(json.buffers||[]),...(json.images||[])])if(item.uri&&!/^data:/.test(item.uri))throw Error('人物模型包含外部资源；请使用完整内嵌 GLB。');
 return json;
}
export function assertSupportedSkinWeights(json,bytes){return inspectGlbSkinning(json,bytes)}
function disposeObject(root){disposeEightWeightSkinning(root);const geometries=new Set(),materials=new Set(),textures=new Set();root?.traverse(object=>{if(object.geometry)geometries.add(object.geometry);for(const material of modelMaterials(object))materials.add(material)});for(const material of materials)for(const value of Object.values(material))if(value?.isTexture)textures.add(value);for(const value of [...geometries,...textures,...materials])value.dispose();}
// Candidate VRMs carry six 4K atlases each. Six background figures would need
// well over 2 GB of VRAM on a panel that is only a few hundred pixels wide, so
// the ring copy uses reduced atlases while the target keeps its approved maps.
async function downscaleRingTextures(root,max=768){
 if(typeof document==='undefined')return;
 const seen=new Set(), images=new Map(), jobs=[];
 const replaceImage=image=>{
  if(images.has(image))return images.get(image);
  const job=(async()=>{
   const scale=Math.min(1,max/Math.max(image.width,image.height));
   const width=Math.max(1,Math.round(image.width*scale)),height=Math.max(1,Math.round(image.height*scale));
   let bitmap=null;
   if(typeof createImageBitmap==='function'){
    try{bitmap=await createImageBitmap(image,{resizeWidth:width,resizeHeight:height,resizeQuality:'low'});}catch{}
   }
   if(!bitmap){
    const canvas=document.createElement('canvas');
    canvas.width=width;canvas.height=height;
    const context=canvas.getContext('2d');
    if(!context)return null;
    try{context.drawImage(image,0,0,width,height);}catch{return null;}
    bitmap=canvas;
   }
   image.close?.();
   return bitmap;
  })();
  images.set(image,job);return job;
 };
 root?.traverse(mesh=>{
  for(const material of [mesh.material].flat()){
   if(!material)continue;
   for(const value of Object.values(material)){
    const texture=value;
    if(!texture?.isTexture||seen.has(texture))continue;
    seen.add(texture);
    const image=texture.image;
    if(!image||Array.isArray(image)||!(image.width>0)||!(image.height>0)||(image.width<=max&&image.height<=max))continue;
    jobs.push(replaceImage(image).then(bitmap=>{
     if(!bitmap)return;
     texture.image=bitmap;texture.needsUpdate=true;
    }));
   }
  }
 });
 await Promise.all(jobs);
}

export class GlbAvatarRenderer{
 constructor(container,{catalog,api,reducedMotion=false,audioPlayer,onStatus=()=>{},onFirstFrame=()=>{},onBeretPenalty=null,blinkReviewOptIn=false,renderEnvironment=true}){
  this.blinkReviewOptIn=blinkReviewOptIn===true;this.renderEnvironment=renderEnvironment!==false;this.container=container;this.catalog=catalog;this.api=api;this.reducedMotion=reducedMotion;this.audioPlayer=audioPlayer;this.onStatus=onStatus;this.onFirstFrame=onFirstFrame;this.onBeretPenalty=typeof onBeretPenalty==='function'?onBeretPenalty:null;this.epoch=0;this.disposed=false;this.activity='idle';this.renderStyle='lit';this.timeOfDay='noon';this.environmentId='studio';this.zoom=1;this.yaw=0;this.gaze={headYaw:0,headPitch:0};this.meshes=[];this.entry=null;this.wardrobe=null;this.turntable=null;this.disposalResources=new Set();this.disposalFrame=0;this.ringCache=new Map();this.wardrobeSignature='';
  this.scene=new THREE.Scene();this.camera=new THREE.PerspectiveCamera(30,1,.01,100);
  this.gl=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});this.gl.setPixelRatio(Math.min(devicePixelRatio||1,1.75));this.gl.setClearColor(0,0);this.gl.outputColorSpace=THREE.SRGBColorSpace;
  this.gl.domElement.setAttribute('aria-label','3D角色预览');this.container.append(this.gl.domElement);
  this.ambient=new THREE.HemisphereLight(0xffffff,0xbac6df,2);this.key=new THREE.DirectionalLight(0xffffff,2);this.key.position.set(-2,3,4);this.scene.add(this.ambient,this.key);
  // Soft frontal fill and a cool back rim. They keep the face legible when the
  // scene sky is overcast and give the silhouette a little separation from the
  // backdrop without introducing a second hard shadow.
  this.fill=new THREE.DirectionalLight('#fff2e6',.24);this.fill.position.set(2.4,1.5,4);this.scene.add(this.fill);
  this.rim=new THREE.DirectionalLight('#d5e6ff',.38);this.rim.position.set(-2.6,3.2,-3.6);this.scene.add(this.rim);
  this.portraitFill=new THREE.HemisphereLight('#fff4eb','#d9c5b7',.24);this.portraitFill.visible=false;this.scene.add(this.portraitFill);
  // A soft contact shadow grounds the feet without adding a shadow map or a
  // second light. It is intentionally weather-tinted and never casts onto the
  // scene canvas behind the transparent avatar surface.
  this.groundShadow=new THREE.Mesh(
    new THREE.PlaneGeometry(1.18,.56),
    new THREE.ShaderMaterial({
      name:'avatar:contact-shadow',transparent:true,depthWrite:false,toneMapped:false,
      uniforms:{uOpacity:{value:.20}},
      vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader:'varying vec2 vUv;uniform float uOpacity;void main(){vec2 p=(vUv-.5)*2.;float r=length(p*vec2(1.,1.8));float a=pow(max(0.,1.-r),1.7)*uOpacity;if(a<.002)discard;gl_FragColor=vec4(0.,0.,0.,a);}',
    }),
  );
  this.groundShadow.rotation.x=-Math.PI/2;this.groundShadow.position.y=.004;this.groundShadow.visible=false;this.scene.add(this.groundShadow);
  this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(container);this.resize();this.setEnvironment();this.last=performance.now();this.nextMicro=performance.now()+12000;this.nextHeadGesture=performance.now()+16000;
  this.renderFrame=this.renderFrame.bind(this);this.frame=requestAnimationFrame(this.renderFrame);
  this.headGestureEvent=event=>{const name=event?.detail?.name??event?.detail;if(typeof name==='string')this.setHeadGesture(name)};
  this.container.addEventListener('yukino:head-gesture',this.headGestureEvent);
  this.blinkVisibility=()=>{if(document.hidden){this.resetBlink();this.resetGarment();this.cancelBeret();this.cancelReaction();this.currentPrepared?.headGesture?.cancel();this.cancelTurntable();}};document.addEventListener('visibilitychange',this.blinkVisibility);
  this.contextLost=event=>{event.preventDefault();this.resetBlink();this.resetGarment();this.cancelBeret();this.cancelReaction();this.cancelTurntable();this.onStatus({phase:'error',message:'图形设备暂不可用，请重新选择模型或重启应用。'})};this.gl.domElement.addEventListener('webglcontextlost',this.contextLost);
 }
 resize(){const width=this.container.clientWidth,height=this.container.clientHeight;if(!width||!height)return;const ratio=Math.min(globalThis.devicePixelRatio||1,1.75);if(this.resizeWidth===width&&this.resizeHeight===height&&this.resizeRatio===ratio)return;if(this.walkingMotion)this.resetTransition({finish:true});if(this.resizeRatio!==undefined&&this.resizeRatio!==ratio)this.gl.setPixelRatio(ratio);this.resizeWidth=width;this.resizeHeight=height;this.resizeRatio=ratio;this.gl.setSize(width,height,false);this.camera.aspect=width/height;if(this.turntable)this.turntable.relayout(turntableRadius(this.turntable.count,width/height));this.fitCamera();if(this.root&&this.visible!==false&&!document.hidden)this.gl.render(this.scene,this.camera);}
 hitTest(x,y){return modelHitTest({x,y,rect:this.container.getBoundingClientRect(),camera:this.camera,root:this.root,raycaster:this.hitRaycaster||=new THREE.Raycaster()});}
 touchZone(x,y){
  if(this.disposed||this.visible===false||this.turntable||this.walkingMotion||this.walkExitHeld||this.transitionAnimation)return null;
  return hitAvatarTouchZone({x,y,rect:this.container.getBoundingClientRect(),camera:this.camera,root:this.root,zones:this.currentPrepared?.touchZones,raycaster:this.hitRaycaster||=new THREE.Raycaster(),beret:this.currentPrepared?.beret});
 }
 grabBeret(pointerId,x,y){
  const beret=this.currentPrepared?.beret;
  if(!beret||this.turntable||this.walkingMotion||this.walkExitHeld||this.transitionAnimation)return false;
  const rect=this.container.getBoundingClientRect();
  if(!rect.width||!rect.height)return false;
  const raycaster=this.hitRaycaster||=new THREE.Raycaster();
  this.root.updateWorldMatrix(true,true);this.camera.updateMatrixWorld();
  raycaster.setFromCamera({x:(x-rect.left)/rect.width*2-1,y:1-(y-rect.top)/rect.height*2},this.camera);
  const grabbed=beret.hitTest(raycaster)&&beret.grab(pointerId,raycaster);
  if(grabbed){this.beretPointer={id:pointerId,x,y};this.currentPrepared?.headGesture?.cancel();if(this.touchReaction)this.cancelReaction();}
  return grabbed;
 }
 moveBeret(pointerId,x,y){
  const beret=this.currentPrepared?.beret;if(!beret)return;
  const pointer=this.beretPointer;
  if(!pointer||pointer.id!==pointerId)return;
  if(typeof beret.moveRay==='function'){
   const rect=this.container.getBoundingClientRect();
   if(!rect.width||!rect.height)return;
   const raycaster=this.hitRaycaster||=new THREE.Raycaster();
   this.root.updateWorldMatrix(true,true);this.camera.updateMatrixWorld();
   raycaster.setFromCamera({x:(x-rect.left)/rect.width*2-1,y:1-(y-rect.top)/rect.height*2},this.camera);
   beret.moveRay(pointerId,raycaster);
  }else beret.move(pointerId,x-pointer.x,pointer.y-y);
  pointer.x=x;pointer.y=y;
 }
 releaseBeret(pointerId){this.currentPrepared?.beret?.release(pointerId);this.beretPointer=null;}
 cancelBeret(){this.currentPrepared?.beret?.cancel();this.beretPointer=null;}
 setHeadGesture(name){
  if(this.disposed||this.reducedMotion||this.turntable||this.walkingMotion||this.walkExitHeld||this.transitionAnimation||this.currentPrepared?.beret?.active)return false;
  const gesture=this.currentPrepared?.headGesture;if(!gesture)return false;
  if(name==='none'||name==='reset'){gesture.cancel();return true;}
  if(!HEAD_GESTURE_IDS.includes(name))return false;
  const played=gesture.play(name);if(played)this.nextHeadGesture=performance.now()+18000+Math.random()*14000;return played;
 }
 fitCamera(){
  const width=this.container?.clientWidth,height=this.container?.clientHeight;
  if(width>0&&height>0)this.portraitAspect=width/height;

  // setViewOffset changes aspect to the FULL window ratio; clearing its crop
  // alone does not undo that. Restore the portrait lens even when a scene
  // switch produces no ResizeObserver notification (or settings hide the host).
  this.camera.clearViewOffset?.();this.camera.fov=30;
  if(this.portraitAspect>0)this.camera.aspect=this.portraitAspect;
  if(this.bounds){const frame=cameraFrame(this.bounds,this.camera.aspect,this.zoom,this.yaw);this.camera.position.copy(frame.position);this.camera.lookAt(frame.target);this.camera.near=frame.near;this.camera.far=frame.far;}
  this.camera.updateProjectionMatrix();this.camera.updateMatrixWorld(true);
 }
 setView({zoom=this.zoom,yaw=this.yaw}={}){if(this.turntable||this.walkingMotion||this.walkExitHeld)return {zoom:this.zoom,yaw:this.yaw};this.zoom=Math.max(1,Math.min(2.2,Number(zoom)||1));this.yaw=Number.isFinite(yaw)?((yaw+180)%360+360)%360-180:0;if(!this.walkingMotion&&!this.walkExitHeld){if(this.pivot)this.pivot.rotation.y=THREE.MathUtils.degToRad(this.yaw);this.fitCamera();}return {zoom:this.zoom,yaw:this.yaw};}

 async prepareOutfit(id,{signal}={}){
  const entry=selectModel(this.catalog,id,{reviewOptIn:this.blinkReviewOptIn});if(!entry)throw Error('该模型尚未通过资源交付检查，当前不可加载。');
  this.onStatus({phase:'loading',message:'正在校验并加载 '+entry.label});
  let bytes;
  if(this.api?.characterModelData){const data=await this.api.characterModelData(id);bytes=new Uint8Array(data).buffer;}
  else{const response=await fetch(entry.url,{signal});if(!response.ok)throw Error('人物模型文件尚未准备好。');bytes=await response.arrayBuffer();}
  signal?.throwIfAborted();if(this.disposed)throw Error('人物窗口已关闭');
  if(bytes.byteLength!==entry.bytes)throw Error('人物模型大小校验失败。');
  const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');if(digest!==entry.sha256)throw Error('人物模型 SHA-256 校验失败。');
  const json=assertEmbeddedAsset(bytes),skinning=assertSupportedSkinWeights(json,bytes);
  const loader=new GLTFLoader();
  if((entry.custom||entry.format==='vrm')&&json.extensions?.VRMC_vrm?.specVersion==='1.0'){
   const {VRMLoaderPlugin}=await import('@pixiv/three-vrm');
   loader.register(parser=>new VRMLoaderPlugin(parser,{autoUpdateHumanBones:false}));
  }
  const gltf=await loader.parseAsync(bytes,'');
  if(signal?.aborted||this.disposed){disposeObject(gltf.scene);signal?.throwIfAborted();throw Error('人物加载已取消');}
  try{
   if(entry.actionPack){const actions=await loadLocalCharacterActions(gltf,entry,this.api,signal);gltf.animations.push(...actions);}
   signal?.throwIfAborted();if(this.disposed)throw Error('人物加载已取消');
   walkingContract(entry,new Map(gltf.animations.map(clip=>[clip.name,clip])));await restoreCandidateMaterialMaps(gltf,entry);applyRenderStyle(gltf.scene,this.renderStyle,{candidate:entry.faceChannel||entry.runtimeCandidate});applyEightWeightSkinning(gltf,skinning);
  }catch(error){disposeObject(gltf.scene);throw error;}
  gltf.scene.updateMatrixWorld(true);const sourceBounds=new THREE.Box3().setFromObject(gltf.scene),size=sourceBounds.getSize(new THREE.Vector3());if(![size.x,size.y,size.z].every(Number.isFinite)||size.y<=0){disposeObject(gltf.scene);throw Error('人物尺寸无效。');}
  let garmentBinding,candidateControls,beret,expression,anime,headGesture;
  try{
   candidateControls=bindCandidateModelControls(gltf,entry.faceChannel||entry.runtimeCandidate);
   expression=bindConversationExpression(gltf.scene,entry.faceChannel||entry.runtimeCandidate);
   headGesture=bindHeadGesture(gltf);
   garmentBinding=bindNormalGarment(gltf.scene,entry,THREE);
   anime=bindAnimeReactions({gltf,entry});
   await anime?.ready;
   signal?.throwIfAborted();if(this.disposed)throw Error('人物加载已取消');
   if(entry.approvedBeret)beret=bindApprovedBeret(gltf,{sourceBounds,modelId:entry.id,reducedMotion:this.reducedMotion,onPenalty:event=>this.onBeretPenalty?.(event)});
   else if(entry.runtimeCandidate==='beret'&&(entry.compatibilityBaseSha256??entry.sha256)==='03dbd98f767d8214bea7ee3bcfface63a44934bcd635637e0fcec22a34e98fd8')beret=bindCandidateBeret(gltf);
  }catch(error){garmentBinding?.dispose();anime?.dispose();disposeObject(gltf.scene);throw error;}
  return {entry,gltf,sourceBounds,size,garmentBinding,candidateControls,beret,expression,anime,headGesture,touchZones:bindAvatarTouchZones(gltf,entry)};
 }
 setWardrobe(models){
  const list=Array.isArray(models)?models:null;
  const signature=(list||[]).map(model=>model.id+':'+(model.sha256||'')).join('|');
  if(signature!==this.wardrobeSignature){this.wardrobeSignature=signature;this.clearRingCache();}
  this.wardrobe=list;
 }
 clearRingCache(){
  if(!this.ringCache?.size)return;
  const items=[...this.ringCache.values()];this.ringCache.clear();this.queueDisposal(items);
 }
 cacheRingPrepared(prepared){
  if(!prepared?.entry)return;
  const key=prepared.entry.id+':'+prepared.entry.sha256+':'+this.renderStyle;
  this.ringCache.set(key,prepared);
  while(this.ringCache.size>8){const [oldKey,old]=this.ringCache.entries().next().value;this.ringCache.delete(oldKey);this.queueDisposal([old]);}
 }
 // The turntable only needs the authored scene, its standing pose and the
 // garment correction driver. Loading the action pack and interaction bindings
 // for every background figure would multiply memory and startup latency.
 async prepareRingOutfit(id,{signal}={}){
  const entry=selectModel(this.catalog,id,{reviewOptIn:this.blinkReviewOptIn});if(!entry)throw Error('该模型尚未通过资源交付检查，当前不可加载。');
  const cacheKey=entry.id+':'+entry.sha256+':'+this.renderStyle;
  const cached=this.ringCache?.get(cacheKey);
  if(cached){this.ringCache.delete(cacheKey);return cached;}
  let bytes;
  if(this.api?.characterModelData){const data=await this.api.characterModelData(id);bytes=new Uint8Array(data).buffer;}
  else{const response=await fetch(entry.url,{signal});if(!response.ok)throw Error('人物模型文件尚未准备好。');bytes=await response.arrayBuffer();}
  signal?.throwIfAborted();if(this.disposed)throw Error('人物窗口已关闭');
  if(bytes.byteLength!==entry.bytes)throw Error('人物模型大小校验失败。');
  const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');if(digest!==entry.sha256)throw Error('人物模型 SHA-256 校验失败。');
  const json=assertEmbeddedAsset(bytes),skinning=assertSupportedSkinWeights(json,bytes),loader=new GLTFLoader();
  if((entry.custom||entry.format==='vrm')&&json.extensions?.VRMC_vrm?.specVersion==='1.0'){const {VRMLoaderPlugin}=await import('@pixiv/three-vrm');loader.register(parser=>new VRMLoaderPlugin(parser,{autoUpdateHumanBones:false}));}
  const gltf=await loader.parseAsync(bytes,'');
  if(signal?.aborted||this.disposed){disposeObject(gltf.scene);signal?.throwIfAborted();throw Error('人物加载已取消');}
  if(entry.approvedV2&&!gltf.animations.some(clip=>clip.name===(entry.defaultClip||'Idle_Breathe'))){disposeObject(gltf.scene);throw Error('该服装缺少已通过的垂臂待机动作，已保留当前人物。');}
  let garmentBinding=null;
  try{
   // The approved standing pose lives in the local action pack for candidate
   // outfits; the imported VRM itself keeps a T-pose bind. Apply that pose
   // before the garment driver samples it.
   if(entry.actionPack)await loadLocalCharacterActions(gltf,entry,this.api,signal,{standingOnly:true});
   await restoreCandidateMaterialMaps(gltf,entry);applyRenderStyle(gltf.scene,this.renderStyle,{candidate:entry.faceChannel||entry.runtimeCandidate});applyEightWeightSkinning(gltf,skinning);garmentBinding=bindNormalGarment(gltf.scene,entry,THREE);if(entry.approvedBeret)seatApprovedBeret(gltf);await downscaleRingTextures(gltf.scene);
  }
  catch(error){garmentBinding?.dispose();disposeObject(gltf.scene);throw error;}
  gltf.scene.updateMatrixWorld(true);const sourceBounds=new THREE.Box3().setFromObject(gltf.scene),size=sourceBounds.getSize(new THREE.Vector3());
  if(![size.x,size.y,size.z].every(Number.isFinite)||size.y<=0){garmentBinding?.dispose();disposeObject(gltf.scene);throw Error('人物尺寸无效。');}
  return {entry,gltf,sourceBounds,size,garmentBinding,ringStanding:Boolean(entry.actionPack)};
 }
 async changeOutfitDirect(id,{signal,reducedMotion=false,prepared=null}={}){
  let target=prepared,committed=false;
  try{
   target??=await this.prepareOutfit(id,{signal});signal?.throwIfAborted();
   if(!reducedMotion)await this.exit({signal});signal?.throwIfAborted();
   await this.commitOutfit(target);committed=true;
   if(!reducedMotion)await this.enter({signal});
   return true;
  }catch(error){if(!committed&&target&&target!==this.currentPrepared)this.disposePrepared(target);throw error;}
 }
 cancelTurntable(){
  const stage=this.turntable;if(!stage)return;
  this.turntable=null;
  try{stage.dispose();}catch{}
  if(this.root)this.root.visible=true;
  if(this.groundShadow)this.groundShadow.visible=Boolean(this.root);
  if(this.container?.dataset){delete this.container.dataset.outfitTurntable;delete this.container.dataset.turntablePhase;}
  this.restoreTurntableViewport();
  stage.resolve?.(false);
 }
 restoreTurntableViewport(){
  if(this.turntablePixelRatio===undefined)return;
  const ratio=this.turntablePixelRatio;this.turntablePixelRatio=undefined;
  const width=this.container.clientWidth,height=this.container.clientHeight;
  this.gl.setPixelRatio(ratio);
  if(width&&height){this.gl.setSize(width,height,false);this.camera.aspect=width/height;this.resizeWidth=width;this.resizeHeight=height;this.resizeRatio=ratio;this.fitCamera();}
 }
 // 44B: the current outfit steps back to the front of a ring, the wardrobes
 // turn by the shortest path, and only the target survives the exit. Target
 // preparation is completed before the visible character is touched, so a bad
 // asset leaves the current outfit and all interaction intact.
 async changeOutfitWithTurntable(id,{signal}={}){
  if(this.disposed)throw Error('人物窗口已关闭');
  if(this.turntable)this.cancelTurntable();
  if(this.reducedMotion||!this.entry||!this.root||!this.basePosition)return this.changeOutfitDirect(id,{signal,reducedMotion:this.reducedMotion});
  let order;
  try{order=turntableOrder(this.wardrobe||this.catalog,this.entry.id,id);}catch{return this.changeOutfitDirect(id,{signal});}
  if(order.items.length<2||order.targetIndex===0)return this.changeOutfitDirect(id,{signal});
  let target=null,ringPrepared=[],committed=false;
  const prep={};let prepMark=performance.now();
  try{
   target=await this.prepareOutfit(id,{signal});prep.target=performance.now()-prepMark;prepMark=performance.now();signal?.throwIfAborted();
   let readyCount=1;
   this.onStatus({phase:'loading',message:'正在准备衣橱 '+readyCount+'/'+order.items.length+'…'});
   // Three at a time, yielding between parses. Six simultaneous VRM parses block
   // the UI thread and make the first ring frame look like a freeze.
   const records=new Array(order.items.length).fill(null);
   records[order.targetIndex]={prepared:target,index:order.targetIndex,isTarget:true,isCurrent:order.targetIndex===order.currentIndex};
   const queue=order.items.map((item,index)=>({item,index})).filter(({item,index})=>index!==order.targetIndex);
   const workers=Array.from({length:Math.min(3,queue.length)},async()=>{
    while(queue.length){
     const {item,index}=queue.shift();
     try{const prepared=await this.prepareRingOutfit(item.model.id,{signal});ringPrepared.push(prepared);records[index]={prepared,index,isTarget:false,isCurrent:index===order.currentIndex};readyCount++;this.onStatus({phase:'loading',message:'正在准备衣橱 '+readyCount+'/'+order.items.length+'…'});}
     catch(error){if(signal?.aborted)throw error;}
     await new Promise(resolve=>setTimeout(resolve,0));
    }
   });
   await Promise.all(workers);
   prep.ring=performance.now()-prepMark;prepMark=performance.now();
   signal?.throwIfAborted();
   if(!records[order.currentIndex]){
    for(const prepared of ringPrepared)this.disposePrepared(prepared);ringPrepared=[];
    const prepared=target;target=null;
    return await this.changeOutfitDirect(id,{signal,prepared});
   }
   const plan=turntablePlan(order.items.length,order.targetIndex);
   if(!plan.steps)throw Error('目标服装与当前服装相同。');
   this.onStatus({phase:'loading',message:'正在准备灯光与材质…'});
   const aspect=this.container.clientWidth/Math.max(1,this.container.clientHeight);
   const frontAngle=THREE.MathUtils.degToRad(this.yaw||0);
   this.turntablePixelRatio=this.gl.getPixelRatio();this.gl.setPixelRatio(Math.min(this.turntablePixelRatio,.8));
   const stage=new OutfitTurntableStage({
    scene:this.scene,records,plan,targetIndex:order.targetIndex,currentIndex:order.currentIndex,
    basePosition:this.basePosition,frontAngle,radius:turntableRadius(order.items.length,aspect),
    backOffset:.3,lights:{ambient:this.ambient,key:this.key,fill:this.fill,rim:this.rim},
   });
   this.root.visible=false;if(this.groundShadow)this.groundShadow.visible=false;
   const canvas=this.gl.domElement,previousVisibility=canvas.style.visibility;
   canvas.style.visibility='hidden';
   try{stage.prewarm(this.gl,this.camera,prep.warm={});}finally{canvas.style.visibility=previousVisibility;}
   prep.prewarm=performance.now()-prepMark;
   if(this.container?.dataset)this.container.dataset.turntablePrep=JSON.stringify(prep);
   this.turntable=stage;
   this.container.dataset.outfitTurntable='true';this.container.dataset.turntablePhase='entrance';this.onStatus({phase:'turntable',message:'换装中 · '+target.entry.label});
   const completion=new Promise(resolve=>{stage.resolve=resolve;});
   const abort=()=>this.cancelTurntable();signal?.addEventListener('abort',abort,{once:true});
   const completed=await completion;signal?.removeEventListener('abort',abort);
   if(!completed||signal?.aborted){this.cancelTurntable();throw new DOMException('换装已取消','AbortError');}
   const timing={};let mark=performance.now();
   this.turntable=null;this.restoreTurntableViewport();timing.viewport=performance.now()-mark;mark=performance.now();
   const committedPrepared=stage.takeTarget();timing.take=performance.now()-mark;mark=performance.now();
   stage.dispose();timing.dispose=performance.now()-mark;mark=performance.now();
   if(this.container?.dataset){delete this.container.dataset.outfitTurntable;delete this.container.dataset.turntablePhase;}
   this.onStatus({phase:'loading',message:'正在换装…'});timing.status=performance.now()-mark;mark=performance.now();
   await this.commitOutfit(committedPrepared);committed=true;timing.commit=performance.now()-mark;mark=performance.now();
   // Keep the downscaled ring copies for the next transition; they are already
   // detached and can be reused without another VRM parse or texture resize.
   for(const prepared of ringPrepared)this.cacheRingPrepared(prepared);timing.queue=performance.now()-mark;
   if(this.container?.dataset)this.container.dataset.turntableTiming=JSON.stringify(timing);
   return true;
  }catch(error){
   if(this.turntable)this.cancelTurntable();
   this.restoreTurntableViewport();
   if(!committed&&target&&target!==this.currentPrepared)this.queueDisposal([target]);
   this.queueDisposal(ringPrepared.filter(prepared=>prepared!==target));
   if(this.root)this.root.visible=true;
   if(this.container?.dataset){delete this.container.dataset.outfitTurntable;delete this.container.dataset.turntablePhase;}
   throw error;
  }
 }
 queueDisposal(items){
  for(const prepared of items||[]){
   if(!prepared)continue;
   prepared.garmentBinding?.dispose();
   prepared.beret?.dispose();
   prepared.anime?.dispose();
   this.queueObjectDisposal(prepared.gltf?.scene);
  }
 }
 queueObjectDisposal(root){
  if(!root)return;
  disposeEightWeightSkinning(root);
  const resources=this.disposalResources||(this.disposalResources=new Set());
  root.traverse(object=>{
   if(object.geometry)resources.add(object.geometry);
   for(const material of modelMaterials(object)){
    resources.add(material);
    for(const value of Object.values(material))if(value?.isTexture)resources.add(value);
   }
  });
  if(typeof requestAnimationFrame!=='function'){
   for(const resource of resources)resource.dispose?.();resources.clear();return;
  }
  if(this.disposalFrame||!resources.size)return;
  const step=()=>{
   this.disposalFrame=0;
   let count=0;
   for(const resource of resources){
    resources.delete(resource);resource.dispose?.();
    if(++count>=2)break;
   }
   if(resources.size)this.disposalFrame=requestAnimationFrame(step);
  };
  this.disposalFrame=requestAnimationFrame(step);
 }
 flushDisposal(){
  if(this.disposalFrame&&typeof cancelAnimationFrame==='function')cancelAnimationFrame(this.disposalFrame);
  this.disposalFrame=0;
  for(const resource of this.disposalResources||[])resource.dispose?.();
  this.disposalResources?.clear();
 }
 disposePrepared(prepared){prepared?.garmentBinding?.dispose();prepared?.beret?.dispose();prepared?.anime?.dispose();disposeObject(prepared?.gltf?.scene);}
 async commitOutfit(prepared){
  if(this.turntable)this.cancelTurntable();
  if(this.disposed){this.disposePrepared(prepared);return;}
  const {sourceBounds,size}=prepared;if(!sourceBounds||!size||!Number.isFinite(size.y)||size.y<=0)throw Error('人物尺寸无效。');
  walkingContract(prepared.entry,new Map(prepared.gltf.animations.map(clip=>[clip.name,clip])));
  if((prepared.entry.reviewOnly||prepared.entry.sha256===BLINK_REVIEW_V5.assetSha256)&&!reviewBlinkModelAllowed(prepared.entry,this.blinkReviewOptIn))throw Error('隔离眨眼审阅需要本次明确同意。');
  // A model prepared by the turntable ring only has the display seat. Bind the
  // interactive hat on commit so a target reached through the ring behaves
  // exactly like a direct outfit change.
  if(prepared.entry.approvedBeret&&!prepared.beret)prepared.beret=bindApprovedBeret(prepared.gltf,{sourceBounds:prepared.sourceBounds,modelId:prepared.entry.id,reducedMotion:this.reducedMotion,onPenalty:event=>this.onBeretPenalty?.(event)});
  if(!prepared.headGesture)prepared.headGesture=bindHeadGesture(prepared.gltf);
  const idleName=prepared.entry.defaultClip||'Idle_Breathe';
  if(prepared.entry.approvedV2&&!prepared.gltf.animations.some(clip=>clip.name===idleName))throw Error('该服装缺少已通过的垂臂待机动作，已保留当前人物。');
  // Loading/exit can span a settings change. Apply the latest style before
  // disposing the visible model; installEightWeightMesh handles adapted meshes.
  applyRenderStyle(prepared.gltf.scene,this.renderStyle,{candidate:prepared.entry.faceChannel||prepared.entry.runtimeCandidate});
  const blinkBinding=this.prepareBlinkBinding(prepared),standing=prepareCustomStanding(prepared.entry,prepared.gltf)?.clip;
  this.disposeBlink();this.disposeGarment();this.stopSpeechMotion(true);this.speechDirector?.reset();
  const old=this.root;this.currentPrepared?.beret?.dispose();this.disposeReaction();this.mixer?.stopAllAction();if(old){old.removeFromParent();this.mixer?.uncacheRoot(old);this.queueDisposal([{gltf:{scene:old}}]);}
  this.entry=standing?{...prepared.entry,defaultClip:standing.name,clips:{...prepared.entry.clips,[standing.name]:{duration:standing.duration,loop:true}}}:prepared.entry;
  this.updatePortraitFill();
  if(this.loadController)this.loadController.outfit=this.entry.id;this.root=prepared.gltf.scene;this.root.updateMatrixWorld(true);this.walkExitHeld=false;
  this.authoredPose=[];this.root.traverse(node=>this.authoredPose.push({node,position:node.position.clone(),quaternion:node.quaternion.clone(),scale:node.scale.clone()}));
  // Parent transform leaves the supplied bind pose, authored bones and clips intact.
  const wrapper=new THREE.Group(),pivot=new THREE.Group(),centered=new THREE.Group();centered.add(this.root);const sourceCenter=sourceBounds.getCenter(new THREE.Vector3());centered.position.set(-sourceCenter.x,-sourceBounds.min.y,-sourceCenter.z);pivot.add(centered);wrapper.add(pivot);this.pivot=pivot;wrapper.scale.setScalar(2/size.y);wrapper.position.y=(this.entry.walking?.floorOffsetModelUnits||0)*wrapper.scale.y;this.basePosition=wrapper.position.clone();this.root=wrapper;wrapper.visible=false;this.scene.add(wrapper);wrapper.updateMatrixWorld(true);
  const box=new THREE.Box3().setFromObject(wrapper);this.bounds={size:box.getSize(new THREE.Vector3()),center:box.getCenter(new THREE.Vector3())};this.fitCamera();
  this.meshes=[];this.head=null;wrapper.traverse(object=>{if(object.isMesh)this.meshes.push(object);if(this.entry.importMode!=='static'&&object.isBone&&(object.name==='J_Bip_C_Neck'||object.name==='neck'))this.head=object;});this.headBase=this.head?.quaternion.clone();
  this.mixer=new THREE.AnimationMixer(wrapper);this.clips=new Map(prepared.gltf.animations.map(clip=>[clip.name,clip]));if(standing)this.clips.set(standing.name,standing);this.bodyActions=new Set();this.currentAction=null;this.garmentBinding=prepared.garmentBinding;this.candidateControls=prepared.candidateControls;this.candidateBlink=this.candidateControls?.face.hasBlink?new BlinkScheduler():null;
  this.finished=({action})=>{if(action===this.currentAction&&!this.speechMotion&&!this.walkingMotion&&!this.walkExitHeld)this.play(this.entry.defaultClip||'Idle_Breathe')};this.mixer.addEventListener('finished',this.finished);this.play(this.entry.defaultClip||'Idle_Breathe');this.mixer.update(0);wrapper.visible=true;this.candidateControls?.gaze.capture();this.candidateControls?.face.capture();this.updateGarment(0);if(!this.candidateControls)mouthWeights(this.meshes,this.entry.mouth,0);
  // Frame the real initial idle pose once, not the much wider skin bind pose.
  // This keeps the full body large and stable without refitting on every frame.
  wrapper.updateMatrixWorld(true);
  if(this.candidateControls)prepared.gltf.userData?.vrm?.springBoneManager?.setInitState();
  const idleBox=new THREE.Box3().setFromObject(wrapper,true);
  const idleSize=idleBox.getSize(new THREE.Vector3());if([idleSize.x,idleSize.y,idleSize.z].every(Number.isFinite)&&idleSize.y>0)this.bounds={size:idleSize,center:idleBox.getCenter(new THREE.Vector3())};
  this.container.dataset.modelReady=this.entry.id;this.gl.domElement.dataset.rendered='false';this.currentPrepared=prepared;this.nextHeadGesture=performance.now()+18000+Math.random()*14000;if(this.groundShadow)this.groundShadow.visible=true;if(this.entry.runtimeCandidate||this.entry.approvedV2)this.nextMicro=performance.now()+11000;if(this.sceneStage)this.setEnvironment();this.blinkBinding=blinkBinding;this.blinkScheduler=blinkBinding?new BlinkScheduler():null;this.blinkAudioToken=null;this.blinkAudioPlaying=false;this.resetBlink();this.setView();this.onStatus({phase:'ready',message:this.entry.label+' · '+this.entry.version});
 }
 cancelLoad(){this.epoch++;this.loadController?.active?.abort();}
 async load(id,{animate=false}={}){if(this.turntable)this.cancelTurntable();const epoch=++this.epoch;let prepared;try{if(animate){if(!this.loadController){this.loadController=new AvatarPresentationController(this);this.loadController.outfit=this.entry?.id||null;}await this.loadController.changeOutfit(id,{reducedMotion:this.reducedMotion});return;}this.loadController?.active?.abort();prepared=await this.prepareOutfit(id);if(epoch!==this.epoch){this.disposePrepared(prepared);prepared=null;return;}await this.commitOutfit(prepared);prepared=null;}catch(error){if(prepared&&this.currentPrepared!==prepared)this.disposePrepared(prepared);if(epoch===this.epoch&&!this.disposed)this.onStatus({phase:'error',message:error.message})}}
 play(name){if(this.speechMotion||this.walkingMotion||this.walkExitHeld||this.entry?.importMode==='static'||!Object.hasOwn(this.entry?.clips||{},name))return false;const clip=this.clips?.get(name);if(!clip)return false;const next=this.mixer.clipAction(clip);(this.bodyActions ||= new Set()).add(next);if(this.currentAction===next&&next.isRunning())return true;next.reset().setEffectiveWeight(1).setEffectiveTimeScale(1);const loop=this.entry.clips[name]?.loop===true;next.setLoop(loop?THREE.LoopRepeat:THREE.LoopOnce,loop?Infinity:1);next.clampWhenFinished=!loop;next.play();if(this.currentAction)this.currentAction.crossFadeTo(next,.3,false);this.currentAction=next;return true;}
 setActivity(activity){if(this.activity===activity)return;this.activity=activity;this.resetBlink();if(activity==='thinking')this.play('Listen_Attentive');else this.play(this.entry?.defaultClip||'Idle_Breathe');}
 setGaze(gaze){this.gaze=gaze;}
 get supportsAnimeReactions(){return Boolean(this.currentPrepared?.anime);}
 reactToExpression(id,strength){if(this.disposed||this.visible===false||document.hidden||this.reducedMotion||this.walkingMotion||this.walkExitHeld||this.transitionAnimation)return false;const animation=this.currentPrepared?.anime;if(!animation?.playEmotion(id,strength))return false;this.replyExpression=null;this.reactionLegacyCue='';this.touchReaction=false;this.reactionTime=performance.now();return true;}
 reactToTouch(id){
  if(!this.entry||this.visible===false||document.hidden||this.reducedMotion||this.turntable||this.walkingMotion||this.walkExitHeld||this.transitionAnimation||this.currentPrepared?.beret?.active)return;
  if(this.reactToExpression(id)){
   this.touchReaction=true;
   return;
  }
  if(this.activity!=='idle'||this.audioPlayer?.getSnapshot?.()?.playing||this.hasCompetingBodyAction())return;
  const clip={shy_talking:'Think_Downcast',happy:'Nod_Subtle',pout:'Look_Left',angry:'Reject_Gentle'}[id];
  if(clip&&!this.play(clip)&&id==='angry')this.play('Look_Left');
 }
 reactToReply(text){
  const cue=conversationExpression(text);
  if(this.currentPrepared?.anime){
   const reaction=animeReplyCue(text);
   if(reaction&&this.reactToExpression(reaction))this.reactionLegacyCue=cue;
   return;
  }
  this.replyExpression=cue?{cue,started:performance.now()}:null;
 }
 cancelReaction(){
  this.currentPrepared?.anime?.stopEmotion();
  this.currentPrepared?.expression?.restore();
  this.replyExpression=null;this.reactionLegacyCue='';this.reactionTime=undefined;this.touchReaction=false;
  delete this.container.dataset.animeReaction;delete this.container.dataset.conversationExpression;
 }
 disposeReaction(){this.cancelReaction();this.currentPrepared?.anime?.dispose();}
 setVisible(value){this.visible=value!==false;if(this.groundShadow)this.groundShadow.visible=this.visible&&Boolean(this.root);if(!this.visible)this.cancelReaction();}
 setSceneStage(value){const next=value===true;if(this.sceneStage===next)return;this.sceneStage=next;this.setEnvironment();this.fitCamera();}
 setSceneWeather(value){this.sceneWeather=value;this.setEnvironment();}
 setEnvironment({id=this.environmentId,timeOfDay=this.timeOfDay,weather=this.sceneWeather,sunlight=this.sceneSunlight}={}){
  // Models remain draft/replacement assets. No scene owns or edits their rig.
  this.environmentId=sceneId(id);this.timeOfDay=timeOfDay;this.sceneWeather=weather;this.sceneSunlight=sunlight??null;
  const light=sunlightConfig(timeOfDay),preset=scenePreset(this.environmentId).lighting,daylight=sceneDaylight(timeOfDay);
  const cloud=Math.max(0,Math.min(1,weather?.cloud||0)),rain=Math.max(0,Math.min(1,weather?.rain||0));
  const fog=Math.max(0,Math.min(1,weather?.fog||0)),snow=Math.max(0,Math.min(1,weather?.snow||0));
  const night=daylight.night,twilight=daylight.twilight;
  // The background scene computes one sun snapshot. When present, use its
  // world direction, colour and weather-attenuated intensity. The character
  // renderer calibrates only its own fill/exposure; it never invents a second
  // screen-space light direction.
  const shared=sunlight?.direction?.length===3&&sunlight.direction.every(Number.isFinite);
  const ambientScale=night?.9:(1-cloud*.18+.08*fog+.06*snow);
  const fillScale=shared?(night?.9:Math.max(.42,Math.min(1.15,Number(sunlight.fillScale)||1))):1;
  // Shared daylight already carries a calibrated sky fill. Keep the character's
  // own hemisphere/fill/rim restrained so the scene's beam stays directional.
  const ambientFactor=shared?(night?.85:fillScale*.44):1;
  this.ambient.intensity=light.ambient*preset.ambient*2*ambientScale*ambientFactor;
  this.ambient.color.set(light.ambientColor).lerp(new THREE.Color('#c5d0db'),cloud*.5).lerp(new THREE.Color('#dde7ef'),fog*.35).lerp(new THREE.Color('#e6eef5'),snow*.3);
  this.ambient.groundColor.set(light.groundColor).lerp(new THREE.Color('#c9d2da'),snow*.4).lerp(new THREE.Color('#aab2bb'),rain*.18);
  if(shared){
   // The scene key is calibrated for architecture; the character's materials
   // are a little more reflective, so calibrate the same beam by +12% without
   // changing its direction or weather attenuation.
   this.key.intensity=Math.max(0,Number(sunlight.intensity)||0)*1.12;
   this.key.color.set(sunlight.color||light.color);
   this.key.position.set(...sunlight.direction).multiplyScalar(8);
   this.key.target.position.set(0,0,0);
   if(!this.key.target.parent)this.scene.add(this.key.target);
   if(this.container?.dataset){this.container.dataset.sunDirection=sunlight.direction.map(v=>Number(v).toFixed(3)).join(',');this.container.dataset.sunIntensity=this.key.intensity.toFixed(3);}
  }else{
   const keyScale=(1-cloud*.56)*(1-rain*.22)*(1-fog*.36)*(1-snow*.14);
   this.key.intensity=light.intensity*preset.key*keyScale*(night?.42:1);
   this.key.color.set(light.color).lerp(new THREE.Color('#e5edf5'),cloud*.45).lerp(new THREE.Color('#c8d5e0'),fog*.3);
   this.key.position.set(...light.position);
  }
  if(this.fill){
   this.fill.intensity=(night?.11:.10)+cloud*.14+rain*.06+fog*.08+snow*.07;
   this.fill.color.set(twilight?'#ffd9b8':'#fff2e6').lerp(new THREE.Color('#dfeaf5'),cloud*.55);
  }
  if(this.rim){
   this.rim.intensity=(night?.17:.18)+(1-cloud)*.10+(snow*.07);
   this.rim.color.set(twilight?'#ffcdb0':night?'#bcd2ef':'#d5e6ff');
  }
  if(this.portraitFill)this.portraitFill.intensity=.18+cloud*.10+fog*.07;
  if(this.groundShadow?.material?.uniforms?.uOpacity){
   this.groundShadow.material.uniforms.uOpacity.value=night?.10:(.24-cloud*.05-rain*.04-fog*.03-snow*.02);
  }
 }
 updatePortraitFill(){
  if(this.portraitFill)this.portraitFill.visible=Boolean((this.entry?.runtimeCandidate||this.entry?.approvedV2)&&this.renderStyle==='lit');
 }
 setRenderStyle(style){if(this.turntable)this.cancelTurntable();this.clearRingCache();this.renderStyle=['natural','toon'].includes(style)?style:'lit';if(this.container?.dataset)this.container.dataset.renderStyle=this.renderStyle;this.updatePortraitFill();this.currentPrepared?.anime?.restore();applyRenderStyle(this.root,this.renderStyle,{candidate:this.entry?.faceChannel||this.entry?.runtimeCandidate});}

 setReducedMotion(value){this.reducedMotion=value;this.currentPrepared?.beret?.setReducedMotion?.(value);if(value){this.cancelReaction();this.resetBlink();this.stopSpeechMotion(true);this.resetTransition({finish:true});this.cancelBeret();this.currentPrepared?.headGesture?.cancel();this.cancelTurntable();this.candidateControls?.gaze.restore();this.candidateControls?.face.restore();if(this.candidateControls&&this.hasCompetingBodyAction()){this.mixer.stopAllAction();this.restoreAuthoredPose();this.currentAction=null;this.play(this.entry.defaultClip||'Idle_Breathe');this.mixer.update(0);this.candidateControls.gaze.capture();this.candidateControls.face.capture();}}}
 clear(){this.cancelTurntable();this.clearRingCache();this.flushDisposal();this.disposeBlink();this.disposeGarment();this.currentPrepared?.headGesture?.cancel();this.currentPrepared?.beret?.dispose();this.disposeReaction();this.stopSpeechMotion(true);this.speechDirector?.reset();if(this.groundShadow)this.groundShadow.visible=false;this.epoch++;this.loadController?.active?.abort();if(this.loadController)this.loadController.outfit=null;this.resetTransition();this.mixer?.stopAllAction();if(this.root){this.root.removeFromParent();this.mixer?.uncacheRoot(this.root);disposeObject(this.root)}this.root=null;this.pivot=null;this.authoredPose=[];this.basePosition=null;this.entry=null;this.currentPrepared=null;this.mixer=null;this.clips=null;this.bodyActions?.clear();this.currentAction=null;this.head=null;this.headBase=null;this.bounds=null;this.meshes=[];delete this.container.dataset.modelReady;this.gl.domElement.dataset.rendered='false';this.onStatus({phase:'idle',message:''});}
 restoreAuthoredPose(){for(const item of this.authoredPose||[]){item.node.position.copy(item.position);item.node.quaternion.copy(item.quaternion);item.node.scale.copy(item.scale)}if(this.head)this.headBase=this.head.quaternion.clone();this.candidateControls?.gaze.capture();}
 resetTransition({finish=false}={}){this.transitionAnimation?.cancel();this.transitionAnimation=null;this.container.style.opacity='';this.container.style.transform='';const motion=this.walkingMotion;this.walkingMotion=null;if(motion){clearTimeout(motion.timer);motion.signal?.removeEventListener('abort',motion.abort)}if(motion||this.walkExitHeld){this.walkExitHeld=false;this.mixer?.stopAllAction();this.restoreAuthoredPose();this.currentAction=null;if(this.root){this.root.visible=true;this.root.position.copy(this.basePosition);this.pivot.rotation.y=THREE.MathUtils.degToRad(this.yaw||0)}this.play(this.activity==='thinking'?'Listen_Attentive':this.entry?.defaultClip||'Idle_Breathe');this.fitCamera();}if(motion){this.onStatus?.({phase:'ready',message:this.entry?.label||''});this.container.dataset.transitionPhase=finish?'skipped':'cancelled';if(finish)motion.resolve();else motion.reject(motion.signal?.reason||new DOMException('行走过渡已取消','AbortError'));}}
 beginWalking(kind,signal){
  this.cancelReaction();this.resetBlink();this.stopSpeechMotion(true);this.resetTransition();signal?.throwIfAborted();if(this.reducedMotion)return Promise.resolve();
  const contract=walkingContract(this.entry,this.clips),idleClip=this.clips.get(this.entry.defaultClip||'Idle_Breathe');if(!contract||!idleClip)throw Error('该版本没有完整的行走与待机动作。');
  const plan=makeWalkingPlan({contract,kind,scale:this.root.scale.y,distance:travelDistance(this.bounds,this.camera),yaw:THREE.MathUtils.degToRad(this.yaw||0)});
  this.mixer.stopAllAction();this.restoreAuthoredPose();this.currentAction=null;
  const idle=this.mixer.clipAction(idleClip).reset().setLoop(THREE.LoopRepeat,Infinity).setEffectiveWeight(1).setEffectiveTimeScale(1).play();
  const gait=this.mixer.clipAction(this.clips.get(contract.clip)).reset().setLoop(THREE.LoopRepeat,Infinity).setEffectiveWeight(0).setEffectiveTimeScale(0).play();
  let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no}),motion={plan,idle,gait,signal,resolve,reject,elapsed:0};
  motion.abort=()=>this.resetTransition();motion.timer=setTimeout(()=>{if(this.walkingMotion===motion)this.resetTransition()},Math.max(10000,plan.duration*4000));motion.timer.unref?.();signal?.addEventListener('abort',motion.abort,{once:true});
  this.walkingMotion=motion;this.root.visible=true;this.onStatus?.({phase:'walking',message:'真实慢步换装评审中，视角暂时锁定；减少动态可跳过。'});this.container.dataset.transitionMode='gait-review';this.applyWalkingSample(motion,sampleWalkingPlan(plan,0));this.mixer.update(0);return promise;
 }
 applyWalkingSample(motion,sample){motion.sample=sample;this.root.position.copy(this.basePosition);this.root.position.x+=sample.x;this.pivot.rotation.y=sample.yaw;motion.gait.time=sample.gaitTime;motion.gait.setEffectiveWeight(sample.gaitWeight);motion.idle.setEffectiveWeight(1-sample.gaitWeight);this.container.dataset.transitionPhase=sample.phase;}
 advanceWalking(dt){const motion=this.walkingMotion;if(!motion)return;motion.elapsed+=Math.max(0,Math.min(.1,dt));this.applyWalkingSample(motion,sampleWalkingPlan(motion.plan,motion.elapsed));}
 finishWalking(motion){if(this.walkingMotion!==motion)return;const idleTime=motion.idle.time;this.walkingMotion=null;clearTimeout(motion.timer);motion.signal?.removeEventListener('abort',motion.abort);this.mixer.stopAllAction();this.restoreAuthoredPose();this.currentAction=null;if(motion.plan.kind==='exit'){this.root.visible=false;this.walkExitHeld=true;}else{this.root.position.copy(this.basePosition);this.pivot.rotation.y=THREE.MathUtils.degToRad(this.yaw||0);this.play(this.activity==='thinking'?'Listen_Attentive':this.entry.defaultClip||'Idle_Breathe');if(this.currentAction?.getClip()===motion.idle.getClip())this.currentAction.time=idleTime;this.mixer.update(0);if(this.head)this.headBase=this.head.quaternion.clone();this.fitCamera();}this.container.dataset.transitionPhase='complete';this.onStatus?.({phase:'ready',message:this.entry.label+' · '+this.entry.version});motion.resolve();}
 setBlinkReviewConsent(value){this.blinkReviewOptIn=value===true;if(!this.blinkReviewOptIn){this.cancelLoad();if(this.entry?.reviewOnly)this.clear();else this.resetBlink();}}
 prepareBlinkBinding(prepared){const contract=prepared.entry.blinkContract;if(!contract)return null;const meshes=[];prepared.gltf.scene.traverse(node=>{if(node.isMesh)meshes.push(node)});const binding=prepared.entry.reviewOnly?bindIsolatedReviewBlink(meshes,contract,prepared.entry.sha256,{reviewOptIn:this.blinkReviewOptIn}):bindValidatedBlink(meshes,contract,prepared.entry.sha256);if(!binding)throw Error('眨眼资产或通道合同尚未通过当前模式校验。');return binding;}
 setBlinkDiagnosticClosure(value){if(!reviewBlinkModelAllowed(this.entry,this.blinkReviewOptIn)||!this.blinkBinding)return false;if(value===null){this.resetBlink();return true;}if(!Number.isFinite(value)||value<0||value>1)return false;this.blinkDiagnostic=value;this.blinkBinding.apply(value);return true;}
 resetBlink(){this.blinkDiagnostic=null;this.blinkBinding?.clear();this.blinkScheduler?.stop();this.candidateBlink?.stop();if(this.container?.dataset)this.container.dataset.blinkWeight='0';}
 disposeBlink(){this.blinkBinding?.dispose();this.blinkScheduler?.dispose();this.candidateBlink?.dispose();this.candidateBlink=null;this.candidateControls=null;this.blinkBinding=null;this.blinkScheduler=null;this.blinkAudioToken=null;this.blinkAudioPlaying=false;if(this.container?.dataset){delete this.container.dataset.blinkWeight;delete this.container.dataset.candidateClip;delete this.container.dataset.candidateClipTime;delete this.container.dataset.beretActive;delete this.container.dataset.beretLift;}}
 updateBlink(now,snapshot,{visible=typeof document==='undefined'||!document.hidden}={}){
  if(!this.blinkBinding||!this.blinkScheduler)return;
  const playing=snapshot?.playing===true;if(playing!==this.blinkAudioPlaying||playing&&snapshot.token!==this.blinkAudioToken){this.resetBlink();this.blinkAudioPlaying=playing;this.blinkAudioToken=snapshot?.token;}
  const paused=!!(snapshot?.paused||this.walkingMotion||this.walkExitHeld||this.transitionAnimation);if(!visible||this.reducedMotion||paused)this.resetBlink();const scheduled=this.blinkScheduler.update(now,{enabled:true,visible,reducedMotion:this.reducedMotion,paused});const value=this.blinkDiagnostic??scheduled;this.blinkBinding.apply(value);this.container.dataset.blinkWeight=String(value);
 }
 // Gesture clip time is sampled from AudioContext, not mixer delta or RAF.
 // A short visual release on cancellation is the only wall-time blend.
 resetGarment(){this.garmentBinding?.reset();if(this.container?.dataset)delete this.container.dataset.garmentWeights;}
 disposeGarment(){this.garmentBinding?.dispose();this.garmentBinding=null;if(this.container?.dataset){delete this.container.dataset.garmentWeights;delete this.container.dataset.garmentProfile;}}
 updateGarment(dt,{visible=true}={}){if(!this.garmentBinding)return;if(!visible){this.resetGarment();return;}this.root?.updateWorldMatrix(true,true);const result=this.garmentBinding.update(dt);if(this.container?.dataset){this.container.dataset.garmentProfile=this.entry?.garment?.profileId||'';this.container.dataset.garmentWeights=JSON.stringify(result.weights||{});}return result;}
 resetSpeechClock(){this.stopSpeechMotion(true);this.speechDirector=new SpeechMotionDirector();}
 stopSpeechMotion(immediate=false){const motion=this.speechMotion;if(!motion)return;if(!immediate){motion.releasing=true;return;}motion.action.stop();motion.idle.setEffectiveWeight(1);this.currentAction=motion.idle;this.speechMotion=null;this.nextMicro=performance.now()+12000;delete this.container.dataset.speechGesture;delete this.container.dataset.speechTime;delete this.container.dataset.speechWeight;}
 hasCompetingBodyAction(){return [...(this.bodyActions||[])].some(action=>action!==this.speechMotion?.action&&this.entry?.clips?.[action.getClip().name]?.loop===false&&action.isScheduled()&&action.enabled&&action.getEffectiveWeight()>1e-4);}
 updateSpeechMotion(snapshot,dt){
  this.speechDirector ||= new SpeechMotionDirector();
  const blocked=!!(this.walkingMotion||this.walkExitHeld||this.transitionAnimation||this.hasCompetingBodyAction()),sample=this.speechDirector.update(snapshot,{entry:this.entry,clips:this.clips,blocked,reducedMotion:this.reducedMotion});
  if(blocked||this.reducedMotion){this.stopSpeechMotion(true);return;}
  if(sample&&this.mixer){
   let motion=this.speechMotion;
   if(!motion||motion.token!==sample.token||motion.name!==sample.name){
    this.stopSpeechMotion(true);const clip=this.clips.get(sample.name),idleClip=this.clips.get(this.entry.defaultClip||'Idle_Breathe');if(!clip||!idleClip)return;
    const idleTime=this.currentAction?.getClip()===idleClip?this.currentAction.time:0;
    this.mixer.stopAllAction();this.restoreAuthoredPose();
    const idle=this.mixer.clipAction(idleClip).reset().setLoop(THREE.LoopRepeat,Infinity).setEffectiveTimeScale(1).setEffectiveWeight(1).play();idle.time=idleTime;
    const action=this.mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce,1).setEffectiveTimeScale(0).setEffectiveWeight(0).play();action.clampWhenFinished=true;
    motion=this.speechMotion={token:sample.token,name:sample.name,action,idle,weight:0,releasing:false};this.currentAction=idle;
   }
   motion.releasing=false;motion.action.time=sample.time;motion.weight=sample.weight;motion.action.setEffectiveWeight(sample.weight);motion.idle.setEffectiveWeight(1-sample.weight);this.container.dataset.speechGesture=sample.name;this.container.dataset.speechTime=String(sample.time);this.container.dataset.speechWeight=String(sample.weight);
  }else if(this.speechMotion){const motion=this.speechMotion;motion.releasing=true;motion.weight=Math.max(0,motion.weight-Math.max(0,dt)*2.5);motion.action.setEffectiveWeight(motion.weight);motion.idle.setEffectiveWeight(1-motion.weight);if(!motion.weight)this.stopSpeechMotion(true);}
 }
 renderFrame(now){if(this.disposed)return;this.frame=requestAnimationFrame(this.renderFrame);const elapsed=now-this.last;if(elapsed<(document.hidden?200:this.reducedMotion?100:1000/30))return;this.last=now;const dt=Math.min(elapsed/1000,.1);
  const turntable=this.turntable;
  if(turntable){
   const state=turntable.update(dt);
   if(this.container?.dataset)this.container.dataset.turntablePhase=state.phase;
   if(this.visible!==false&&!document.hidden&&this.container.clientWidth&&this.container.clientHeight)this.gl.render(this.scene,this.camera);
   if(state.done&&!turntable.finished){turntable.finished=true;turntable.resolve?.(true);}
   return;
  }
  const candidate=this.candidateControls,beret=this.currentPrepared?.beret,expression=this.currentPrepared?.expression,anime=this.currentPrepared?.anime;
  anime?.restore();expression?.restore();beret?.restoreFace();this.currentPrepared?.headGesture?.restore();
  const walking=this.walkingMotion;if(walking)this.advanceWalking(dt);
  const snapshot=this.audioPlayer?.getSnapshot?.();this.updateSpeechMotion(snapshot,dt);
  const bodyClip=this.currentAction?.getClip?.().name,headAvailable=!snapshot?.playing&&!walking&&!this.speechMotion&&(!bodyClip||bodyClip===(this.entry?.defaultClip||'Idle_Breathe'));this.gazeBlend=Math.max(0,Math.min(1,(this.gazeBlend??1)+(headAvailable?dt/.2:-dt/.08)));
  candidate?.gaze.restore();candidate?.face.restore();
  if(this.head&&this.headBase)this.head.quaternion.copy(this.headBase);
  // Candidate clips are authored in seconds. Keep their clock independent of
  // the smaller step used for spring simulation when the renderer drops frames.
  const mixerDt=candidate&&!document.hidden&&!walking?Math.min(elapsed/1000,.5):dt;
  this.mixer?.update(this.reducedMotion?0:mixerDt);if(this.head){this.headBase.copy(this.head.quaternion);if(!this.reducedMotion&&!walking&&!this.speechMotion){const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(this.gazeBlend*THREE.MathUtils.degToRad(Math.max(-3,Math.min(3,this.gaze?.headPitch||0))),this.gazeBlend*THREE.MathUtils.degToRad(Math.max(-4,Math.min(4,this.gaze?.headYaw||0))),0));this.head.quaternion.multiply(q);}}
  const visible=!document.hidden&&this.visible!==false;
  const interactionActive=visible&&!walking&&!this.walkExitHeld&&!this.transitionAnimation;
  const candidateActive=interactionActive&&!this.reducedMotion;
  candidate?.gaze.capture();candidate?.face.capture();
  const speaking=Boolean(snapshot?.playing||this.speechMotion);
  const hatReaction=interactionActive?beret?.update(dt,{speaking}):null;
  const headGesture=this.currentPrepared?.headGesture;
  if(candidateActive){
   if(hatReaction?.active)candidate?.gaze.apply(hatReaction,1,{hat:true});
   else candidate?.gaze.apply(this.gaze||{},this.gazeBlend*(headGesture?.active ? .25 : 1));
  }else{
   if(beret?.active&&!interactionActive)beret.cancel();
   if(visible&&this.reducedMotion&&headAvailable&&!this.walkExitHeld&&!this.transitionAnimation){
    candidate?.gaze.apply({},1);
   }
  }
  if(interactionActive&&!this.reducedMotion&&!walking&&!this.speechMotion)headGesture?.update(dt);
  if(!this.reducedMotion&&!walking&&!this.walkExitHeld&&!this.speechMotion&&!snapshot?.playing&&this.activity==='idle'&&!this.hasCompetingBodyAction()&&!beret?.active&&headGesture&&!headGesture.active&&now>=this.nextHeadGesture){this.nextHeadGesture=now+18000+Math.random()*14000;headGesture.play(HEAD_GESTURE_IDS[Math.floor(Math.random()*HEAD_GESTURE_IDS.length)]);}
  if(!this.reducedMotion&&!walking&&!this.walkExitHeld&&!this.speechMotion&&!snapshot?.playing&&this.activity==='idle'&&!this.hasCompetingBodyAction()&&!beret?.active&&now>=this.nextMicro){this.nextMicro=now+(candidate?14000:16000)+Math.random()*(candidate?9000:12000);const clips=microClipNames(this.entry,this.clips);if(clips.length)this.play(clips[Math.floor(Math.random()*clips.length)]);}
  this.updateGarment(dt,{visible:!document.hidden});
  if(visible&&!this.reducedMotion)this.currentPrepared?.gltf.userData?.vrm?.update(dt);
  if(interactionActive&&beret?.active)beret.positionHat();
  const level=this.reducedMotion?0:snapshot?(snapshot.playing&&!snapshot.paused?snapshot.level:0):this.audioPlayer?.getLevel?.()||0;
  if(candidate){
   const {dataset}=this.container;
   dataset.candidateClip=this.currentAction?.getClip().name||'';
   dataset.candidateClipTime=String(this.currentAction?.time||0);
   if(beret){dataset.beretActive=String(beret.active);dataset.beretLift=String(beret.lift||0);}
   if(headGesture){dataset.headGesture=headGesture.name||'';}
   const closure=this.candidateBlink?.update(now,{enabled:candidateActive,paused:snapshot?.paused})??0;
   candidate.face.apply([this.currentAction,this.speechMotion?.action,...(this.bodyActions||[])].filter(Boolean),level,closure);
  }else mouthWeights(this.meshes,this.entry?.mouth,level*(this.entry?.mouth?.recommended_dialogue_range?.[1]||0));
  const cue=this.replyExpression;
  if(cue&&now-cue.started>2100)this.replyExpression=null;
  if(interactionActive)beret?.applyFace(this.gaze?.eyeY,{speaking});
  this.updateBlink(now,snapshot);
  const reaction=candidateActive&&this.reactionTime!==undefined&&anime?.update(Math.max(0,now-this.reactionTime)/1000,{speaking:snapshot?.playing&&!snapshot?.paused||level>.015,camera:this.camera});
  this.reactionTime=reaction?now:undefined;
  if(!reaction)this.touchReaction=false;
  const showCue=candidateActive&&!reaction&&!beret?.active&&cue&&expression?.apply(cue.cue,(now-cue.started)/1000);
  if(reaction)this.container.dataset.animeReaction=reaction;else delete this.container.dataset.animeReaction;
  const conversationCue=showCue?cue.cue:reaction&&this.reactionLegacyCue;
  if(conversationCue)this.container.dataset.conversationExpression=conversationCue;else delete this.container.dataset.conversationExpression;
  this.container.dataset.speechReady=String(!!this.entry&&!walking&&!this.walkExitHeld&&!this.transitionAnimation&&!this.speechMotion&&!snapshot?.playing&&!this.hasCompetingBodyAction());if(visible&&this.container.clientWidth!==0&&this.container.clientHeight!==0){this.gl.render(this.scene,this.camera);if(this.entry&&this.gl.domElement.dataset.rendered!=='true'){this.gl.domElement.dataset.rendered='true';this.onFirstFrame?.(this.entry.id);}}if(walking?.sample.done)this.finishWalking(walking);
 }
 async exit({signal}={}){if(this.entry?.walking)return this.beginWalking('exit',signal);await this.transition([{opacity:1,transform:'translateX(0)'},{opacity:0,transform:'translateX(-15%)'}],signal,true);}
 async enter({signal}={}){if(this.entry?.walking)return this.beginWalking('enter',signal);await this.transition([{opacity:0,transform:'translateX(15%)'},{opacity:1,transform:'translateX(0)'}],signal);}
 async transition(frames,signal,retain=false){
  this.cancelReaction();this.resetBlink();this.stopSpeechMotion(true);this.resetTransition();this.container.dataset.transitionMode='fade';if(this.reducedMotion)return;signal?.throwIfAborted();
  const animation=this.container.animate(frames,{duration:240,easing:'cubic-bezier(.2,.8,.2,1)',fill:'both'});this.transitionAnimation=animation;
  const abort=()=>this.resetTransition();signal?.addEventListener('abort',abort,{once:true});
  try{await animation.finished;signal?.throwIfAborted();if(this.transitionAnimation===animation&&retain){const last=frames[frames.length-1];this.container.style.opacity=last.opacity;this.container.style.transform=last.transform;}}
  catch(error){signal?.throwIfAborted();if(!this.reducedMotion)throw error}
  finally{signal?.removeEventListener('abort',abort);if(this.transitionAnimation===animation){animation.cancel();this.transitionAnimation=null;if(!retain){this.container.style.opacity='';this.container.style.transform='';}}}
 }

 async greet(){if(!this.reducedMotion)this.play('Nod_Subtle');}
 dispose(){this.cancelTurntable();this.clearRingCache();this.flushDisposal();this.disposeBlink();this.disposeGarment();this.currentPrepared?.headGesture?.cancel();this.currentPrepared?.beret?.dispose();this.disposeReaction();this.container.removeEventListener('yukino:head-gesture',this.headGestureEvent);if(this.blinkVisibility)document.removeEventListener('visibilitychange',this.blinkVisibility);this.stopSpeechMotion(true);this.speechDirector?.reset();this.loadController?.dispose();this.key?.shadow?.dispose();this.groundShadow?.geometry.dispose();this.groundShadow?.material.dispose();this.resetTransition();this.disposed=true;this.epoch++;cancelAnimationFrame(this.frame);this.resizeObserver.disconnect();this.mixer?.stopAllAction();if(this.root){this.mixer?.uncacheRoot(this.root);disposeObject(this.root)}this.gl.domElement.removeEventListener('webglcontextlost',this.contextLost);this.authoredPose=[];this.basePosition=null;this.bodyActions?.clear();this.gl.dispose();this.gl.domElement.remove();}
}
