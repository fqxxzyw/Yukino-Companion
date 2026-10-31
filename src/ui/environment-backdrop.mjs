import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {loadSceneFactory} from '../scenes/registry.mjs';
import {sceneId,scenePreset} from './scene-catalog.mjs';
import {dioramaFrame,galleryKey} from './scene-camera.mjs';
import {SceneOverview} from './scene-overview.mjs';
import {sceneDaylight,sceneLightingPreset,applyWindowNight} from './scene-daylight.mjs';
const clockHour=()=>{const d=new Date();return d.getHours()+d.getMinutes()/60};
const paintOpportunity=()=>new Promise(resolve=>{let done=false;const finish=()=>{if(!done){done=true;clearTimeout(timer);resolve()}};const timer=setTimeout(finish,100);requestAnimationFrame(()=>requestAnimationFrame(finish))});
const rendererState=gl=>({exposure:gl.toneMappingExposure,toneMapping:gl.toneMapping,shadowType:gl.shadowMap.type,shadows:gl.shadowMap.enabled});
function restoreRenderer(gl,state){gl.toneMappingExposure=state.exposure;gl.toneMapping=state.toneMapping;gl.shadowMap.type=state.shadowType;gl.shadowMap.enabled=state.shadows;gl.shadowMap.needsUpdate=true;}
export class EnvironmentBackdrop {
 constructor(host,{interactive=false,reducedMotion=false,onError,onReady,onBeforeSwap,rendererFactory=options=>new THREE.WebGLRenderer(options),controlsFactory=(camera,canvas)=>new OrbitControls(camera,canvas)}={}){
  Object.assign(this,{host,interactive,reducedMotion,onError,onReady,onBeforeSwap});this.disposed=false;this.epoch=0;this.queue=Promise.resolve();this.time=0;this.last=0;this.motion=true;
  this.camera=new THREE.PerspectiveCamera(34,1,.05,1500);this.target=new THREE.Vector3();
  this.overview=new SceneOverview(this.camera,this.target,{reducedMotion});
  this.gl=rendererFactory({alpha:true,antialias:true,powerPreference:'low-power'});this.gl.setPixelRatio(Math.min(globalThis.devicePixelRatio||1,interactive?1.35:1.15));
  this.gl.outputColorSpace=THREE.SRGBColorSpace;this.gl.toneMapping=THREE.NeutralToneMapping;this.gl.toneMappingExposure=1;
  this.gl.shadowMap.enabled=true;this.gl.shadowMap.type=THREE.PCFSoftShadowMap;this.gl.shadowMap.autoUpdate=false;
  host.append(this.gl.domElement);this.gl.domElement.setAttribute('aria-label','提供的三维场景');
  if(interactive){this.controls=controlsFactory(this.camera,this.gl.domElement);this.controls.enableDamping=!reducedMotion;this.controls.dampingFactor=.085;this.controls.enablePan=false;this.controls.minPolarAngle=.08;this.controls.maxPolarAngle=Math.PI*.48;this.controls.enableZoom=true;}
  this.resizeObserver=new ResizeObserver(()=>{if(!this.disposed){this.resize();this.requestRender()}});this.resizeObserver.observe(host);
  this.wheel=e=>{
   if(!e.ctrlKey||this.disposed||!this.current||e.target?.closest?.('input,textarea,[contenteditable="true"],.modal-backdrop,.settings-shell'))return;
   e.preventDefault();e.stopPropagation();if(this.controls)this.controls.enabled=false;
   if(!this.overview.active)this.overview.reset({position:this.camera.position,target:this.controls?.target||this.target},this.overviewFrame);
   if(e.shiftKey||Math.abs(e.deltaX)>Math.abs(e.deltaY))this.overview.rotate((e.deltaX||e.deltaY)*.003);
   else this.overview.wheel(e.deltaY);this.requestRender();
  };
  this.pointerDown=e=>{if(!e.ctrlKey||!this.overview.active||e.button!==0||e.target?.closest?.('button,input,textarea,.modal-backdrop,.settings-shell'))return;e.preventDefault();e.stopPropagation();this.orbitPointer={id:e.pointerId,x:e.clientX};};
  this.pointerMove=e=>{if(!this.orbitPointer||this.orbitPointer.id!==e.pointerId)return;e.preventDefault();e.stopPropagation();this.overview.rotate(-(e.clientX-this.orbitPointer.x)*.008);this.orbitPointer.x=e.clientX;this.requestRender();};
  this.pointerUp=()=>{this.orbitPointer=null;};
  this.release=e=>{if(e?.type==='keyup'&&e.key!=='Control')return;this.pointerUp();this.overview.release();this.requestRender()};
  this.visibility=()=>{this.last=0;if(document.hidden){cancelAnimationFrame(this.frame);this.frame=0;this.overview.release()}else this.requestRender()};
  this.lost=e=>{e.preventDefault();this.contextUnavailable=true;cancelAnimationFrame(this.frame);this.frame=0;host.dataset.fallback='true';onError?.(Error('三维场景的图形设备暂不可用。'))};
  this.restored=()=>{this.contextUnavailable=false;this.gl.resetState();this.gl.shadowMap.needsUpdate=true;delete host.dataset.fallback;this.requestRender()};
  this.gl.domElement.addEventListener('webglcontextlost',this.lost);this.gl.domElement.addEventListener('webglcontextrestored',this.restored);
  (interactive?host:document).addEventListener('wheel',this.wheel,{passive:false,capture:true});window.addEventListener('keyup',this.release);window.addEventListener('blur',this.release);document.addEventListener('visibilitychange',this.visibility);
  this.pointerSurface=interactive?host:document;
  this.pointerSurface.addEventListener('pointerdown',this.pointerDown,true);window.addEventListener('pointermove',this.pointerMove,{capture:true,passive:false});window.addEventListener('pointerup',this.pointerUp,true);window.addEventListener('pointercancel',this.pointerUp,true);
  this.tick=this.tick.bind(this);
 }
 update(value,timeOfDay=clockHour(),weather=null){
  if(this.disposed)return Promise.resolve(false);
  const id=sceneId(value);this.timeOfDay=timeOfDay;this.weather=weather;
  if(this.current&&this.environmentScene===id&&!this.loading){this.applyClimate();this.requestRender();return Promise.resolve(true)}
  // Freeze synchronously BEFORE import/construction. React never has to race a new GPU frame.
  if(!this.loading)this.freezeFrame();
  const epoch=++this.epoch;this.loading=true;this.host.dataset.loading='true';
  this.queue=this.queue.catch(()=>{}).then(async()=>{
   if(this.disposed||epoch!==this.epoch)return false;
   let next,nextScene,target,committed=false;
   const prior=rendererState(this.gl);
   const previous={current:this.current,scene:this.scene,bounds:this.bounds,environmentScene:this.environmentScene,lightingKey:this.lightingKey,camera:this.camera.clone(),target:this.target.clone()};
   try{
    await paintOpportunity();
    const create=await loadSceneFactory(id);if(this.disposed||epoch!==this.epoch)return false;
    this.preparing=true;
    // A factory without its own tone mapper must not inherit the previous scene's mapper.
    this.gl.toneMapping=THREE.NeutralToneMapping;
    nextScene=new THREE.Scene();next=create({scene:nextScene,renderer:this.gl});if(!next?.root)throw Error('场景没有提供三维根节点');nextScene.add(next.root);
    this.configureShadows(next.root);nextScene.updateMatrixWorld(true);
    this.lightScene(next,nextScene,id);
    const bounds=next.bounds?.isBox3?next.bounds.clone():new THREE.Box3().setFromObject(next.framingRoot||next.root);
    if(bounds.isEmpty()||![...bounds.min.toArray(),...bounds.max.toArray()].every(Number.isFinite))throw Error('场景边界无效');
    const warmCamera=this.camera.clone(),frame=dioramaFrame(bounds,this.aspect(),{...next.cameraPresets?.overview,tight:true});
    const home=this.interactive?null:next.cameraPresets?.companion;
    warmCamera.fov=home?.fov||next.cameraPresets?.overview?.fov||34;
    warmCamera.position.copy(home?.position?new THREE.Vector3(...home.position):frame.position);
    const look=home?.target?new THREE.Vector3(...home.target):frame.target;
    if(home&&this.aspect()<1.25)warmCamera.position.sub(look).multiplyScalar(1.25/this.aspect()).add(look);
    warmCamera.lookAt(look);warmCamera.aspect=this.aspect();warmCamera.updateProjectionMatrix();warmCamera.updateMatrixWorld(true);
    await this.gl.compileAsync?.(nextScene,warmCamera);
    if(this.disposed||epoch!==this.epoch)return false;
    // compileAsync does not upload all textures or draw shadows. Gate on an actual offscreen frame.
    const size=this.gl.getDrawingBufferSize(new THREE.Vector2());
    target=new THREE.WebGLRenderTarget(Math.max(1,size.x),Math.max(1,size.y));
    const priorTarget=this.gl.getRenderTarget();
    try{this.gl.setRenderTarget(target);this.gl.shadowMap.needsUpdate=true;this.gl.render(nextScene,warmCamera);const pixel=new Uint8Array(4);this.gl.readRenderTargetPixels(target,0,0,1,1,pixel);}
    finally{this.gl.setRenderTarget(priorTarget);target.dispose();target=null;}
    if(this.disposed||epoch!==this.epoch)return false;
    this.current=next;this.scene=nextScene;this.bounds=bounds;this.environmentScene=id;this.lightingKey=null;
    this.resize(true);this.applyClimate();
    this.render(); // Still concealed by the frozen overlay; rollback remains possible.
    committed=true;
    const readyState=rendererState(this.gl);
    previous.current?.dispose?.();this.disposeSceneTextures(previous.scene);restoreRenderer(this.gl,readyState);
    this.host.dataset.scene=id;this.host.dataset.ready='true';delete this.host.dataset.fallback;
    this.revealFrame();this.onReady?.(id);return true;
   }catch(error){
    if(!committed){this.current=previous.current;this.scene=previous.scene;this.bounds=previous.bounds;this.environmentScene=previous.environmentScene;this.lightingKey=previous.lightingKey;this.camera.copy(previous.camera);this.target.copy(previous.target);}
    if(epoch===this.epoch&&!this.disposed){this.host.dataset.fallback='true';this.onError?.(error)}return false;
   }finally{
    target?.dispose();
    if(!committed){next?.dispose?.();this.disposeSceneTextures(nextScene);restoreRenderer(this.gl,prior);}
    this.preparing=false;
    if(epoch===this.epoch){this.loading=false;delete this.host.dataset.loading;if(!committed)this.clearFrozen();this.requestRender()}
   }
  });return this.queue;
 }
 freezeFrame(){
  if(!this.current||this.contextUnavailable)return;
  this.render();
  const canvas=this.gl.domElement,old=this.frozen;
  const frozen=document.createElement('canvas');frozen.width=canvas.width;frozen.height=canvas.height;
  Object.assign(frozen.style,{position:'absolute',inset:'0',width:'100%',height:'100%',zIndex:'3',pointerEvents:'none'});
  const ctx=frozen.getContext('2d');
  if(old){ctx.drawImage(old,0,0,frozen.width,frozen.height);const clip=getComputedStyle(canvas).clipPath;const circle=/circle\(([\d.]+)% at ([\d.]+)% ([\d.]+)%\)/.exec(clip);ctx.save();if(circle){ctx.beginPath();ctx.arc(frozen.width*Number(circle[2])/100,frozen.height*Number(circle[3])/100,Math.hypot(frozen.width,frozen.height)/Math.SQRT2*Number(circle[1])/100,0,Math.PI*2);ctx.clip();}ctx.drawImage(canvas,0,0);ctx.restore();}
  else ctx.drawImage(canvas,0,0);
  this.revealAnimation?.cancel();this.revealAnimation=null;old?.remove();this.frozen=frozen;this.host.append(frozen);
  canvas.style.visibility='hidden';
 }
 clearFrozen(){this.revealAnimation?.cancel();this.revealAnimation=null;this.frozen?.remove();this.frozen=null;this.gl.domElement.style.visibility='';}
 revealFrame(){
  const canvas=this.gl.domElement;canvas.style.visibility='';if(!this.frozen||this.reducedMotion||!canvas.animate){this.clearFrozen();return;}
  this.frozen.style.zIndex='1';Object.assign(canvas.style,{position:'relative',zIndex:'2'});
  const animation=canvas.animate([{clipPath:'circle(0% at 72% 65%)',filter:'blur(9px)'},{clipPath:'circle(85% at 72% 65%)',filter:'blur(3px)',offset:.72},{clipPath:'circle(150% at 72% 65%)',filter:'blur(0px)'}],{duration:1650,easing:'cubic-bezier(.22,.65,.25,1)',fill:'both'});
  this.revealAnimation=animation;animation.finished.then(()=>{if(this.revealAnimation===animation)this.clearFrozen()}).catch(()=>{});
 }
 lightScene(factory,scene,id){
  const daylight=sceneDaylight(this.timeOfDay),preset=sceneLightingPreset(this.timeOfDay,factory.lightingPresets);
  factory.setLighting?.(preset);applyWindowNight(factory.root,daylight.night);
  const nativeNight=factory.lightingPresets?.includes('night');scene.backgroundIntensity=daylight.night&&!nativeNight ? .22 : 1;
  if(daylight.night&&!nativeNight)factory.root.traverse(node=>{if(node.isDirectionalLight)node.intensity*=.18;else if(node.isHemisphereLight||node.isAmbientLight)node.intensity*=scenePreset(id).kind==='indoor'?.45:.28;});
  return {daylight,preset};
 }
 aspect(){return Math.max(.1,(this.host.clientWidth||1)/Math.max(1,this.host.clientHeight||1))}
 configureShadows(root){root.traverse(node=>{if(node.isLight&&node.shadow){node.shadow.mapSize.set(1024,1024);node.shadow.autoUpdate=false;node.shadow.needsUpdate=true}})}
 applyClimate(){
  if(!this.current)return;const daylight=sceneDaylight(this.timeOfDay),preset=sceneLightingPreset(this.timeOfDay,this.current.lightingPresets),key=preset+':'+daylight.night;
  if(key!==this.lightingKey){
   this.lightScene(this.current,this.scene,this.environmentScene);
   this.lightingKey=key;this.gl.shadowMap.needsUpdate=true;this.host.dataset.lighting=preset;this.host.dataset.daylight=daylight.night?'night':daylight.twilight?'twilight':'day';
  }
  this.current.setWeather?.(this.weather);this.current.setMotion?.({enabled:this.motion&&!this.reducedMotion});this.current.setMotionEnabled?.(this.motion&&!this.reducedMotion);
 }
 resize(reset=false){
  const width=this.host.clientWidth,height=this.host.clientHeight;if(!width||!height||!this.current)return false;if(!reset&&this.width===width&&this.height===height)return true;
  this.width=width;this.height=height;this.gl.setSize(width,height,false);this.camera.aspect=width/height;const preset=this.current.cameraPresets?.overview||{};
  const frame=dioramaFrame(this.bounds,width/height,{...preset,tight:true});
  const home=this.interactive?null:this.current.cameraPresets?.companion;
  this.camera.fov=home?.fov||preset.fov||34;this.camera.far=Math.max(1500,frame.distance*5);this.camera.updateProjectionMatrix();
  if(home?.position&&home?.target){this.camera.position.fromArray(home.position);this.target.fromArray(home.target);if(width/height<1.25)this.camera.position.sub(this.target).multiplyScalar(1.25/(width/height)).add(this.target);}
  else {this.camera.position.copy(frame.position);this.target.copy(frame.target);}
  this.camera.lookAt(this.target);this.homeFrame={position:this.camera.position.clone(),target:this.target.clone()};
  // A sphere-fit keeps the entire miniature visible at every horizontal azimuth.
  const miniature=dioramaFrame(this.bounds,width/height,{fov:this.camera.fov,direction:[.8,.78,1.3],padding:1.06});
  this.overviewFrame={target:miniature.target.clone(),position:miniature.position.clone()};
  this.overview.reset(this.homeFrame,this.overviewFrame);
  if(this.controls){this.controls.target.copy(this.target);this.controls.minDistance=frame.distance*.22;this.controls.maxDistance=frame.distance*2.2;this.controls.update();}
  return true;
 }
 requestRender(){if(!this.frame&&!this.disposed&&!this.contextUnavailable&&!document.hidden)this.frame=requestAnimationFrame(this.tick)}
 tick(now){
  this.frame=0;if(this.disposed||this.contextUnavailable||document.hidden)return;
  if(this.preparing){this.last=0;this.requestRender();return;}
  const dt=Math.min(.08,Math.max(0,(now-(this.last||now))/1000));
  // Cap passive animation at 25 fps instead of forcing two 60 fps WebGL views.
  if(this.last&&now-this.last<(this.interactive?30:40)){this.requestRender();return}this.last=now;
  try{
   if(this.overview.active){this.overview.step(dt);if(this.controls)this.controls.target.copy(this.target)}
   else if(this.controls){this.controls.enabled=true;this.controls.update();this.target.copy(this.controls.target)}
   if(this.motion&&!this.reducedMotion){this.time+=dt*.6;this.current?.update?.(dt*.6,this.time)}
   this.render();
  }catch(error){this.onError?.(error);return}
  if(this.overview.active||this.motion&&!this.reducedMotion||this.controls)this.requestRender();
 }
 render(){if(this.disposed||this.contextUnavailable||!this.scene||!this.resize())return;this.current.render?this.current.render(this.gl,this.scene,this.camera):this.gl.render(this.scene,this.camera)}
 showOverview(){if(!this.current)return;this.overview.reset({position:this.camera.position,target:this.controls?.target||this.target},this.overviewFrame);this.overview.show();if(this.controls)this.controls.enabled=false;this.requestRender()}
 releaseOverview(){this.release()}
 key(key){if(!this.current)return false;if(key==='Home'){this.resize(true)}else if(key==='+'||key==='='||key==='-'){this.camera.position.sub(this.target).multiplyScalar(key==='-'?1.1:1/1.1).add(this.target)}else if(!galleryKey(this.camera,this.target,key))return false;this.controls?.target.copy(this.target);this.requestRender();return true}
 setAnimationEnabled(enabled){this.motion=enabled!==false;this.applyClimate();this.requestRender();return this.motion}
 disposeSceneTextures(scene){const textures=new Set([scene?.background,scene?.environment].filter(t=>t?.isTexture));for(const t of textures)t.dispose()}
 dispose(){
  if(this.disposed)return;this.disposed=true;this.epoch++;cancelAnimationFrame(this.frame);this.resizeObserver.disconnect();this.controls?.dispose();
  (this.interactive?this.host:document).removeEventListener('wheel',this.wheel,true);window.removeEventListener('keyup',this.release);window.removeEventListener('blur',this.release);document.removeEventListener('visibilitychange',this.visibility);
  this.pointerSurface.removeEventListener('pointerdown',this.pointerDown,true);window.removeEventListener('pointermove',this.pointerMove,true);window.removeEventListener('pointerup',this.pointerUp,true);window.removeEventListener('pointercancel',this.pointerUp,true);
  this.gl.domElement.removeEventListener('webglcontextlost',this.lost);this.gl.domElement.removeEventListener('webglcontextrestored',this.restored);
  // A pending compile still owns its GPU resources; release the renderer after it settles.
  const finish=()=>{this.clearFrozen();this.current?.dispose?.();this.disposeSceneTextures(this.scene);this.gl.dispose();this.gl.domElement.remove()};
  this.queue.then(finish,finish);
 }
}
