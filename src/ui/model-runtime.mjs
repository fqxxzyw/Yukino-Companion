import {bindNormalGarment} from './garment-runtime.mjs';
import * as THREE from 'three';
import {BlinkScheduler,bindValidatedBlink,bindIsolatedReviewBlink} from './blink-scheduler.mjs';
import {BLINK_REVIEW_V5,BLINK_REVIEW_MODEL} from './blink-review-contract.mjs';
import {SpeechMotionDirector} from '../speech/motion.mjs';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {SCENES,AvatarPresentationController} from './avatar-presentation.mjs';
import {inspectGlbSkinning,applyEightWeightSkinning,disposeEightWeightSkinning} from './eight-weight-skinning.mjs';
import {applyRenderStyle,modelMaterials,cameraFrame} from './model-style.mjs';
import {createEnvironment,disposeEnvironment,sunlightConfig} from './procedural-scenes.mjs';
import {walkingContract,travelDistance,makeWalkingPlan,sampleWalkingPlan} from './walking-transition.mjs';
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

export class GlbAvatarRenderer{
 constructor(container,{catalog,api,reducedMotion=false,audioPlayer,onStatus=()=>{},blinkReviewOptIn=false,renderEnvironment=true}){
  this.blinkReviewOptIn=blinkReviewOptIn===true;this.renderEnvironment=renderEnvironment!==false;this.container=container;this.catalog=catalog;this.api=api;this.reducedMotion=reducedMotion;this.audioPlayer=audioPlayer;this.onStatus=onStatus;this.epoch=0;this.disposed=false;this.activity='idle';this.renderStyle='lit';this.timeOfDay='noon';this.environmentId='studio';this.zoom=1;this.yaw=0;this.gaze={headYaw:0,headPitch:0};this.meshes=[];
  this.scene=new THREE.Scene();this.camera=new THREE.PerspectiveCamera(30,1,.01,100);
  this.gl=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});this.gl.setPixelRatio(Math.min(devicePixelRatio||1,1.75));this.gl.setClearColor(0,0);this.gl.outputColorSpace=THREE.SRGBColorSpace;
  this.gl.domElement.setAttribute('aria-label','3D角色预览');this.container.append(this.gl.domElement);
  this.ambient=new THREE.HemisphereLight(0xffffff,0xbac6df,2);this.key=new THREE.DirectionalLight(0xffffff,2);this.key.position.set(-2,3,4);this.scene.add(this.ambient,this.key);
  this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(container);this.resize();this.setEnvironment();this.last=performance.now();this.nextMicro=performance.now()+12000;
  this.renderFrame=this.renderFrame.bind(this);this.frame=requestAnimationFrame(this.renderFrame);
  this.blinkVisibility=()=>{if(document.hidden){this.resetBlink();this.resetGarment();}};document.addEventListener('visibilitychange',this.blinkVisibility);
  this.contextLost=event=>{event.preventDefault();this.resetBlink();this.resetGarment();this.onStatus({phase:'error',message:'图形设备暂不可用，请重新选择模型或重启应用。'})};this.gl.domElement.addEventListener('webglcontextlost',this.contextLost);
 }
 resize(){const width=this.container.clientWidth,height=this.container.clientHeight;if(!width||!height)return;if(this.walkingMotion)this.resetTransition({finish:true});this.gl.setSize(width,height,false);this.camera.aspect=width/height;this.fitCamera();}
 fitCamera(){if(!this.bounds)return;const frame=cameraFrame(this.bounds,this.camera.aspect,this.zoom,this.yaw);this.camera.position.copy(frame.position);this.camera.lookAt(frame.target);this.camera.near=frame.near;this.camera.far=frame.far;this.camera.updateProjectionMatrix();}
 setView({zoom=this.zoom,yaw=this.yaw}={}){if(this.walkingMotion||this.walkExitHeld)return {zoom:this.zoom,yaw:this.yaw};this.zoom=Math.max(1,Math.min(2.2,Number(zoom)||1));this.yaw=Number.isFinite(yaw)?((yaw+180)%360+360)%360-180:0;if(!this.walkingMotion&&!this.walkExitHeld){if(this.pivot)this.pivot.rotation.y=THREE.MathUtils.degToRad(this.yaw);this.fitCamera();}return {zoom:this.zoom,yaw:this.yaw};}

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
  const gltf=await new GLTFLoader().parseAsync(bytes,'');
  if(signal?.aborted||this.disposed){disposeObject(gltf.scene);signal?.throwIfAborted();throw Error('人物加载已取消');}
  try{walkingContract(entry,new Map(gltf.animations.map(clip=>[clip.name,clip])));applyRenderStyle(gltf.scene,this.renderStyle);applyEightWeightSkinning(gltf,skinning);}catch(error){disposeObject(gltf.scene);throw error;}
  gltf.scene.updateMatrixWorld(true);const sourceBounds=new THREE.Box3().setFromObject(gltf.scene),size=sourceBounds.getSize(new THREE.Vector3());if(![size.x,size.y,size.z].every(Number.isFinite)||size.y<=0){disposeObject(gltf.scene);throw Error('人物尺寸无效。');}
  let garmentBinding;try{garmentBinding=bindNormalGarment(gltf.scene,entry,THREE)}catch(error){disposeObject(gltf.scene);throw error;}
  return {entry,gltf,sourceBounds,size,garmentBinding};
 }
 disposePrepared(prepared){prepared?.garmentBinding?.dispose();disposeObject(prepared?.gltf?.scene);}
 async commitOutfit(prepared){
  if(this.disposed){this.disposePrepared(prepared);return;}
  const {sourceBounds,size}=prepared;if(!sourceBounds||!size||!Number.isFinite(size.y)||size.y<=0)throw Error('人物尺寸无效。');
  walkingContract(prepared.entry,new Map(prepared.gltf.animations.map(clip=>[clip.name,clip])));
  if((prepared.entry.reviewOnly||prepared.entry.sha256===BLINK_REVIEW_V5.assetSha256)&&!reviewBlinkModelAllowed(prepared.entry,this.blinkReviewOptIn))throw Error('隔离眨眼审阅需要本次明确同意。');
  // Loading/exit can span a settings change. Apply the latest style before
  // disposing the visible model; installEightWeightMesh handles adapted meshes.
  applyRenderStyle(prepared.gltf.scene,this.renderStyle);
  const blinkBinding=this.prepareBlinkBinding(prepared);
  this.disposeBlink();this.disposeGarment();this.stopSpeechMotion(true);this.speechDirector?.reset();
  const old=this.root;this.mixer?.stopAllAction();if(old){this.scene.remove(old);this.mixer?.uncacheRoot(old);disposeObject(old);}
  this.entry=prepared.entry;if(this.loadController)this.loadController.outfit=this.entry.id;this.root=prepared.gltf.scene;this.root.updateMatrixWorld(true);this.walkExitHeld=false;
  this.authoredPose=[];this.root.traverse(node=>this.authoredPose.push({node,position:node.position.clone(),quaternion:node.quaternion.clone(),scale:node.scale.clone()}));
  // Parent transform leaves the supplied bind pose, authored bones and clips intact.
  const wrapper=new THREE.Group(),pivot=new THREE.Group(),centered=new THREE.Group();centered.add(this.root);const sourceCenter=sourceBounds.getCenter(new THREE.Vector3());centered.position.set(-sourceCenter.x,-sourceBounds.min.y,-sourceCenter.z);pivot.add(centered);wrapper.add(pivot);this.pivot=pivot;wrapper.scale.setScalar(2/size.y);wrapper.position.y=(this.entry.walking?.floorOffsetModelUnits||0)*wrapper.scale.y;this.basePosition=wrapper.position.clone();this.root=wrapper;this.scene.add(wrapper);wrapper.updateMatrixWorld(true);
  const box=new THREE.Box3().setFromObject(wrapper);this.bounds={size:box.getSize(new THREE.Vector3()),center:box.getCenter(new THREE.Vector3())};this.fitCamera();
  this.meshes=[];this.head=null;wrapper.traverse(object=>{if(object.isMesh)this.meshes.push(object);if(this.entry.importMode!=='static'&&object.isBone&&object.name==='J_Bip_C_Neck')this.head=object;});this.headBase=this.head?.quaternion.clone();
  this.mixer=new THREE.AnimationMixer(wrapper);this.clips=new Map(prepared.gltf.animations.map(clip=>[clip.name,clip]));this.bodyActions=new Set();this.currentAction=null;this.garmentBinding=prepared.garmentBinding;
  this.finished=()=>{if(!this.speechMotion&&!this.walkingMotion&&!this.walkExitHeld)this.play(this.entry.defaultClip||'Idle_Breathe')};this.mixer.addEventListener('finished',this.finished);this.play(this.entry.defaultClip||'Idle_Breathe');this.mixer.update(0);this.updateGarment(0);mouthWeights(this.meshes,this.entry.mouth,0);
  // Frame the real initial idle pose once, not the much wider skin bind pose.
  // This keeps the full body large and stable without refitting on every frame.
  wrapper.updateMatrixWorld(true);const idleBox=new THREE.Box3().setFromObject(wrapper,true);
  const idleSize=idleBox.getSize(new THREE.Vector3());if([idleSize.x,idleSize.y,idleSize.z].every(Number.isFinite)&&idleSize.y>0)this.bounds={size:idleSize,center:idleBox.getCenter(new THREE.Vector3())};
  this.container.dataset.modelReady=this.entry.id;this.gl.domElement.dataset.rendered='false';this.currentPrepared=prepared;this.blinkBinding=blinkBinding;this.blinkScheduler=blinkBinding?new BlinkScheduler():null;this.blinkAudioToken=null;this.blinkAudioPlaying=false;this.resetBlink();this.setView();this.onStatus({phase:'ready',message:this.entry.label+' · '+this.entry.version});
 }
 cancelLoad(){this.epoch++;this.loadController?.active?.abort();}
 async load(id,{animate=false}={}){const epoch=++this.epoch;let prepared;try{if(animate){if(!this.loadController){this.loadController=new AvatarPresentationController(this);this.loadController.outfit=this.entry?.id||null;}await this.loadController.changeOutfit(id,{reducedMotion:this.reducedMotion});return;}this.loadController?.active?.abort();prepared=await this.prepareOutfit(id);if(epoch!==this.epoch){this.disposePrepared(prepared);prepared=null;return;}await this.commitOutfit(prepared);prepared=null;}catch(error){if(prepared&&this.currentPrepared!==prepared)this.disposePrepared(prepared);if(epoch===this.epoch&&!this.disposed)this.onStatus({phase:'error',message:error.message})}}
 play(name){if(this.speechMotion||this.walkingMotion||this.walkExitHeld||this.entry?.importMode==='static'||!Object.hasOwn(this.entry?.clips||{},name))return false;const clip=this.clips?.get(name);if(!clip)return false;const next=this.mixer.clipAction(clip);(this.bodyActions ||= new Set()).add(next);if(this.currentAction===next&&next.isRunning())return true;next.reset().setEffectiveWeight(1).setEffectiveTimeScale(1);const loop=this.entry.clips[name]?.loop===true;next.setLoop(loop?THREE.LoopRepeat:THREE.LoopOnce,loop?Infinity:1);next.clampWhenFinished=!loop;next.play();if(this.currentAction)this.currentAction.crossFadeTo(next,.3,false);this.currentAction=next;return true;}
 setActivity(activity){if(this.activity===activity)return;this.activity=activity;this.resetBlink();if(activity==='thinking')this.play('Listen_Attentive');else this.play(this.entry?.defaultClip||'Idle_Breathe');}
 setGaze(gaze){this.gaze=gaze;}
 setEnvironment({id=this.environmentId,timeOfDay=this.timeOfDay}={}){const selected=SCENES[id]?id:'studio';if(this.renderEnvironment&&(!this.environment||selected!==this.environmentId||timeOfDay!==this.timeOfDay)){if(this.environment){this.scene.remove(this.environment);disposeEnvironment(this.environment)}this.environment=createEnvironment(selected,{shadows:false,timeOfDay});this.scene.add(this.environment);}this.environmentId=selected;this.timeOfDay=['morning','noon','evening'].includes(timeOfDay)?timeOfDay:'noon';const light=sunlightConfig(this.timeOfDay),scene=(SCENES[selected]||SCENES.studio).lighting;this.ambient.intensity=light.ambient*scene.ambient*2;this.ambient.color.set(light.ambientColor);this.ambient.groundColor.set(light.groundColor);this.key.intensity=light.intensity*scene.key;this.key.color.set(light.color);this.key.position.set(...light.position);}
 setRenderStyle(style){this.renderStyle=['natural','toon'].includes(style)?style:'lit';if(this.container?.dataset)this.container.dataset.renderStyle=this.renderStyle;applyRenderStyle(this.root,this.renderStyle);}

 setReducedMotion(value){this.reducedMotion=value;if(value){this.resetBlink();this.stopSpeechMotion(true);this.resetTransition({finish:true});}}
 clear(){this.disposeBlink();this.disposeGarment();this.stopSpeechMotion(true);this.speechDirector?.reset();this.epoch++;this.loadController?.active?.abort();if(this.loadController)this.loadController.outfit=null;this.resetTransition();this.mixer?.stopAllAction();if(this.root){this.scene.remove(this.root);this.mixer?.uncacheRoot(this.root);disposeObject(this.root)}this.root=null;this.pivot=null;this.authoredPose=[];this.basePosition=null;this.entry=null;this.currentPrepared=null;this.mixer=null;this.clips=null;this.bodyActions?.clear();this.currentAction=null;this.head=null;this.headBase=null;this.bounds=null;this.meshes=[];delete this.container.dataset.modelReady;this.gl.domElement.dataset.rendered='false';this.onStatus({phase:'idle',message:''});}
 restoreAuthoredPose(){for(const item of this.authoredPose||[]){item.node.position.copy(item.position);item.node.quaternion.copy(item.quaternion);item.node.scale.copy(item.scale)}if(this.head)this.headBase=this.head.quaternion.clone();}
 resetTransition({finish=false}={}){this.transitionAnimation?.cancel();this.transitionAnimation=null;this.container.style.opacity='';this.container.style.transform='';const motion=this.walkingMotion;this.walkingMotion=null;if(motion){clearTimeout(motion.timer);motion.signal?.removeEventListener('abort',motion.abort)}if(motion||this.walkExitHeld){this.walkExitHeld=false;this.mixer?.stopAllAction();this.restoreAuthoredPose();this.currentAction=null;if(this.root){this.root.visible=true;this.root.position.copy(this.basePosition);this.pivot.rotation.y=THREE.MathUtils.degToRad(this.yaw||0)}this.play(this.activity==='thinking'?'Listen_Attentive':this.entry?.defaultClip||'Idle_Breathe');this.fitCamera();}if(motion){this.onStatus?.({phase:'ready',message:this.entry?.label||''});this.container.dataset.transitionPhase=finish?'skipped':'cancelled';if(finish)motion.resolve();else motion.reject(motion.signal?.reason||new DOMException('行走过渡已取消','AbortError'));}}
 beginWalking(kind,signal){
  this.resetBlink();this.stopSpeechMotion(true);this.resetTransition();signal?.throwIfAborted();if(this.reducedMotion)return Promise.resolve();
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
 resetBlink(){this.blinkDiagnostic=null;this.blinkBinding?.clear();this.blinkScheduler?.stop();if(this.container?.dataset)this.container.dataset.blinkWeight='0';}
 disposeBlink(){this.blinkBinding?.dispose();this.blinkScheduler?.dispose();this.blinkBinding=null;this.blinkScheduler=null;this.blinkAudioToken=null;this.blinkAudioPlaying=false;if(this.container?.dataset)delete this.container.dataset.blinkWeight;}
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
  const walking=this.walkingMotion;if(walking)this.advanceWalking(dt);
  const snapshot=this.audioPlayer?.getSnapshot?.();this.updateSpeechMotion(snapshot,dt);
  const bodyClip=this.currentAction?.getClip?.().name,headAvailable=!snapshot?.playing&&!walking&&!this.speechMotion&&(!bodyClip||bodyClip===(this.entry?.defaultClip||'Idle_Breathe'));this.gazeBlend=Math.max(0,Math.min(1,(this.gazeBlend??1)+(headAvailable?dt/.2:-dt/.08)));
  if(this.head&&this.headBase)this.head.quaternion.copy(this.headBase);
  this.mixer?.update(this.reducedMotion?0:dt);if(this.head){this.headBase.copy(this.head.quaternion);if(!this.reducedMotion&&!walking&&!this.speechMotion){const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(this.gazeBlend*THREE.MathUtils.degToRad(Math.max(-3,Math.min(3,this.gaze?.headPitch||0))),this.gazeBlend*THREE.MathUtils.degToRad(Math.max(-4,Math.min(4,this.gaze?.headYaw||0))),0));this.head.quaternion.multiply(q);}}
  if(!this.reducedMotion&&!walking&&!this.walkExitHeld&&!this.speechMotion&&!snapshot?.playing&&this.activity==='idle'&&now>=this.nextMicro){this.nextMicro=now+16000+Math.random()*12000;const clips=microClipNames(this.entry,this.clips);if(clips.length)this.play(clips[Math.floor(Math.random()*clips.length)]);}
  this.updateGarment(dt,{visible:!document.hidden});
  const level=this.reducedMotion?0:snapshot?(snapshot.playing&&!snapshot.paused?snapshot.level:0):this.audioPlayer?.getLevel?.()||0;mouthWeights(this.meshes,this.entry?.mouth,level*(this.entry?.mouth?.recommended_dialogue_range?.[1]||0));this.updateBlink(now,snapshot);this.container.dataset.speechReady=String(!!this.entry&&!walking&&!this.walkExitHeld&&!this.transitionAnimation&&!this.speechMotion&&!snapshot?.playing&&!this.hasCompetingBodyAction());this.gl.render(this.scene,this.camera);if(this.gl.domElement.dataset.rendered!=='true')this.gl.domElement.dataset.rendered='true';if(walking?.sample.done)this.finishWalking(walking);
 }
 async exit({signal}={}){if(this.entry?.walking)return this.beginWalking('exit',signal);await this.transition([{opacity:1,transform:'translateX(0)'},{opacity:0,transform:'translateX(-15%)'}],signal,true);}
 async enter({signal}={}){if(this.entry?.walking)return this.beginWalking('enter',signal);await this.transition([{opacity:0,transform:'translateX(15%)'},{opacity:1,transform:'translateX(0)'}],signal);}
 async transition(frames,signal,retain=false){
  this.resetBlink();this.stopSpeechMotion(true);this.resetTransition();this.container.dataset.transitionMode='fade';if(this.reducedMotion)return;signal?.throwIfAborted();
  const animation=this.container.animate(frames,{duration:240,easing:'cubic-bezier(.2,.8,.2,1)',fill:'both'});this.transitionAnimation=animation;
  const abort=()=>this.resetTransition();signal?.addEventListener('abort',abort,{once:true});
  try{await animation.finished;signal?.throwIfAborted();if(this.transitionAnimation===animation&&retain){const last=frames[frames.length-1];this.container.style.opacity=last.opacity;this.container.style.transform=last.transform;}}
  catch(error){signal?.throwIfAborted();if(!this.reducedMotion)throw error}
  finally{signal?.removeEventListener('abort',abort);if(this.transitionAnimation===animation){animation.cancel();this.transitionAnimation=null;if(!retain){this.container.style.opacity='';this.container.style.transform='';}}}
 }

 async greet(){if(!this.reducedMotion)this.play('Nod_Subtle');}
 dispose(){this.disposeBlink();this.disposeGarment();if(this.blinkVisibility)document.removeEventListener('visibilitychange',this.blinkVisibility);this.stopSpeechMotion(true);this.speechDirector?.reset();this.loadController?.dispose();if(this.environment)disposeEnvironment(this.environment);this.resetTransition();this.disposed=true;this.epoch++;cancelAnimationFrame(this.frame);this.resizeObserver.disconnect();this.mixer?.stopAllAction();if(this.root){this.mixer?.uncacheRoot(this.root);disposeObject(this.root)}this.gl.domElement.removeEventListener('webglcontextlost',this.contextLost);this.authoredPose=[];this.basePosition=null;this.bodyActions?.clear();this.gl.dispose();this.gl.domElement.remove();}
}
