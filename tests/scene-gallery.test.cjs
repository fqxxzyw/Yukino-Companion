const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises');
const THREE=import('three');

test('scene catalogue is pure metadata, immutable and preserves all saved IDs',async()=>{
 const {SCENES,sceneId,scenePreset}=await import('../src/ui/scene-catalog.mjs');
 const {presentationConfig}=await import('../src/ui/avatar-presentation.mjs');
 assert.deepEqual(Object.keys(SCENES).sort(),['bookshop','city','classroom','forest','inage','kasai','kyoto','sakura','school','wedding']);
 for(const [id,preset]of Object.entries(SCENES)){assert.equal(presentationConfig({scene:id}).scene,id);assert.ok(preset.label&&preset.description&&preset.clear);assert.ok(Object.isFrozen(preset.lighting.direction));assert.equal(scenePreset(id),preset)}
 for(const id of ['__proto__','constructor','missing',null])assert.equal(sceneId(id),'classroom');
 assert.equal(sceneId('studio'),'bookshop');assert.equal(sceneId('beach'),'kasai');assert.equal(sceneId('seaside'),'kasai');
 assert.equal(presentationConfig({scene:'__proto__'}).scene,'classroom');assert.equal(scenePreset('city').liveDaylight,true);
 const source=await fs.readFile(require('node:path').join(__dirname,'../src/ui/scene-catalog.mjs'),'utf8');assert.doesNotMatch(source,/import .*three/);
});

test('whole-base camera fits every corner in portrait/landscape and at any orbit azimuth',async()=>{
 const T=await THREE,{dioramaFrame,DIORAMA_VIEW}=await import('../src/ui/scene-camera.mjs');
 const bounds=new T.Box3(new T.Vector3(-6,-.65,-6),new T.Vector3(6,5.7,6));
 for(const aspect of [.34,.6,1,1.8,2.6]){
  const frame=dioramaFrame(bounds,aspect),camera=new T.PerspectiveCamera(DIORAMA_VIEW.fov,aspect,.1,1000);
  assert.ok(Number.isFinite(frame.distance));
  for(let yaw=0;yaw<6.3;yaw+=.4){
   const offset=new T.Vector3().setFromSpherical(new T.Spherical(frame.distance,1,yaw));camera.position.copy(frame.target).add(offset);camera.lookAt(frame.target);camera.updateMatrixWorld(true);
   for(const x of [-6,6])for(const y of [-.65,5.7])for(const z of [-6,6]){const p=new T.Vector3(x,y,z).project(camera);assert.ok(Math.abs(p.x)<1&&Math.abs(p.y)<1&&Math.abs(p.z)<1,`${aspect}/${yaw}: complete plinth and roof inside camera`)}
  }
 }
});

test('keyboard orbit remains above the base and never changes target or distance',async()=>{
 const T=await THREE,{galleryKey,DIORAMA_VIEW}=await import('../src/ui/scene-camera.mjs');
 const camera=new T.PerspectiveCamera(),target=new T.Vector3(0,1,0);camera.position.set(20,16,20);const distance=camera.position.distanceTo(target);
 for(let i=0;i<100;i++){assert.equal(galleryKey(camera,target,'ArrowUp'),true)}
 let s=new T.Spherical().setFromVector3(camera.position.clone().sub(target));assert.ok(Math.abs(s.phi-DIORAMA_VIEW.minPolar)<1e-8);
 for(let i=0;i<100;i++)galleryKey(camera,target,'ArrowDown');
 s.setFromVector3(camera.position.clone().sub(target));assert.ok(Math.abs(s.phi-DIORAMA_VIEW.maxPolar)<1e-8);assert.ok(Math.abs(camera.position.distanceTo(target)-distance)<1e-8);assert.deepEqual(target.toArray(),[0,1,0]);assert.equal(galleryKey(camera,target,'Escape'),false);
});

function harness(T){
 const saved=new Map(['window','document','ResizeObserver','requestAnimationFrame','cancelAnimationFrame'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 class Node{
  constructor(){this.listeners=new Map();this.attributes=new Map();this.clientWidth=1200;this.clientHeight=800;this.width=1200;this.height=800;this.children=[];this.style={};this.dataset={};this.captured=new Set()}
  get ownerDocument(){return doc}getRootNode(){return doc}getBoundingClientRect(){return {left:0,top:0,width:this.clientWidth,height:this.clientHeight}}
  setPointerCapture(id){this.captured.add(id)}releasePointerCapture(id){this.captured.delete(id)}
  addEventListener(type,fn){this.listeners.set(type,fn)}removeEventListener(type,fn){if(this.listeners.get(type)===fn)this.listeners.delete(type)}
  setAttribute(k,v){this.attributes.set(k,v)}removeAttribute(k){this.attributes.delete(k)}append(node){this.children.push(node);node.owner=this}remove(){if(this.owner)this.owner.children=this.owner.children.filter(n=>n!==this)}
  getContext(){return {drawImage(){},save(){},restore(){},beginPath(){},arc(){},clip(){}}}
  emit(type,event={}){this.listeners.get(type)?.(event)}
 }
 const doc=new Node(),win=new Node(),frames=new Map(),observers=[];doc.hidden=false;doc.createElement=()=>new Node();let seq=0;
 Object.defineProperties(globalThis,{document:{value:doc,configurable:true},window:{value:win,configurable:true},ResizeObserver:{value:class{constructor(fn){this.fn=fn;observers.push(this)}observe(){}disconnect(){this.disconnected=true}},configurable:true},requestAnimationFrame:{value:fn=>{frames.set(++seq,fn);return seq},configurable:true},cancelAnimationFrame:{value:id=>frames.delete(id),configurable:true}});
 const host=new Node(),gl={domElement:new Node(),shadowMap:{},renders:0,sizes:0,setPixelRatio(value){this.dpr=value},getPixelRatio(){return this.dpr},setSize(){this.sizes++},render(scene,camera){if(this.nextError&&this.target){this.nextError=false;throw Error('test draw failure')}this.renders++;this.lastScene=scene;this.lastCamera=camera;if(scene.overrideMaterial)this.lastPreview={material:scene.overrideMaterial.type,shadows:this.shadowMap.enabled,dpr:this.dpr}},getDrawingBufferSize(out){return out.set(8,8)},getRenderTarget(){return this.target||null},setRenderTarget(value){this.target=value},readRenderTargetPixels(){},resetState(){},dispose(){this.disposes=(this.disposes||0)+1}};
 const made=[];let controls;
 const loadFactory=async id=>()=>{const root=new T.Group(),geometry=new T.BoxGeometry(12,6,12),material=new T.MeshBasicMaterial(),mesh=new T.Mesh(geometry,material);mesh.position.y=3;root.add(mesh);const current={id,root,lightingPresets:['day','night'],disposed:0,setLighting(){},dispose(){current.disposed++;geometry.dispose();material.dispose()}};made.push(current);return current};
 return {doc,win,host,gl,frames,observers,made,options:{rendererFactory:()=>gl,loadFactory,controlsFactory:(camera)=>{controls=new Node();Object.assign(controls,{target:camera.position.clone().set(0,0,0),update:()=>false,dispose(){this.disposed=true}});return controls}},get controls(){return controls},tick(){const work=[...frames.values()];frames.clear();for(const fn of work)fn(100)},restore(){for(const [key,descriptor]of saved)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]}};
}

test('passive backdrop and orbit view load asynchronously, own resources, and dispose once',async()=>{
 const T=await THREE,{EnvironmentBackdrop}=await import('../src/ui/environment-backdrop.mjs');
 for(const interactive of [false,true]){
  const h=harness(T);let renderer;
  try{
   renderer=new EnvironmentBackdrop(h.host,{...h.options,interactive,reducedMotion:true});assert.equal(await renderer.update('city',12),true);
   assert.equal(Boolean(h.controls),interactive);assert.equal(h.host.children.length,1);assert.ok(h.gl.renders>0);assert.equal(h.host.dataset.scene,'city');
   if(interactive){assert.equal(h.controls.enablePan,false);assert.ok(h.controls.minDistance>0);assert.ok(h.controls.maxDistance>h.controls.minDistance);const before=renderer.camera.position.distanceTo(renderer.target);renderer.key('+');assert.ok(renderer.camera.position.distanceTo(renderer.target)<before);assert.equal(renderer.key('Escape'),false);renderer.key('Home')}
   const old=renderer.current;assert.equal(await renderer.update('forest',8),true);assert.equal(old.disposed,1);assert.equal(renderer.environmentScene,'forest');
   renderer.dispose();renderer.dispose();await renderer.queue;await Promise.resolve();assert.equal(h.made[1].disposed,1);assert.equal(h.gl.disposes,1);assert.equal(h.host.children.length,0);assert.equal(h.observers[0].disconnected,true);assert.equal(h.win.listeners.size,0);assert.equal(h.doc.listeners.size,0);if(interactive)assert.equal(h.controls.disposed,true);
  }finally{renderer?.dispose();await renderer?.queue;h.restore()}
 }
});

test('real OrbitControls handles mouse rotation, wheel and two-touch pinch without a WebGL context',async()=>{
 const T=await THREE,{EnvironmentBackdrop}=await import('../src/ui/environment-backdrop.mjs');const h=harness(T);let renderer;
 try{
  renderer=new EnvironmentBackdrop(h.host,{rendererFactory:h.options.rendererFactory,loadFactory:h.options.loadFactory,interactive:true,reducedMotion:true});assert.equal(await renderer.update('city'),true);const canvas=h.gl.domElement;
  const event=(pointerId,x,y,pointerType='mouse')=>({pointerId,clientX:x,clientY:y,pageX:x,pageY:y,pointerType,button:0,ctrlKey:false,metaKey:false,shiftKey:false,preventDefault(){}});
  const before=renderer.camera.position.clone();canvas.emit('pointerdown',event(1,500,400));h.doc.emit('pointermove',event(1,650,440));h.doc.emit('pointerup',event(1,650,440));assert.ok(renderer.camera.position.distanceTo(before)>.1,'actual OrbitControls rotates the camera');assert.equal(canvas.captured.size,0);
  const radius=renderer.camera.position.distanceTo(renderer.controls.target);canvas.emit('wheel',{deltaY:-100,deltaMode:0,clientX:600,clientY:400,ctrlKey:false,preventDefault(){}});assert.ok(renderer.camera.position.distanceTo(renderer.controls.target)<radius);
  const pinchBefore=renderer.camera.position.distanceTo(renderer.controls.target);canvas.emit('pointerdown',event(2,480,400,'touch'));canvas.emit('pointerdown',event(3,720,400,'touch'));h.doc.emit('pointermove',event(3,800,400,'touch'));assert.ok(renderer.camera.position.distanceTo(renderer.controls.target)<pinchBefore);h.doc.emit('pointerup',event(3,800,400,'touch'));h.doc.emit('pointerup',event(2,480,400,'touch'));
  canvas.emit('pointerdown',event(4,500,400));renderer.dispose();await renderer.queue;await Promise.resolve();assert.equal(h.doc.listeners.size,0);assert.equal(canvas.listeners.size,0);
 }finally{renderer?.dispose();await renderer?.queue;h.restore()}
});

test('resize preserves orbit direction and normalized zoom; hidden tabs cancel pending work',async()=>{
 const T=await THREE,{EnvironmentBackdrop}=await import('../src/ui/environment-backdrop.mjs');const h=harness(T);let renderer;
 try{
  renderer=new EnvironmentBackdrop(h.host,{...h.options,interactive:true,reducedMotion:true});assert.equal(await renderer.update('studio'),true);assert.equal(h.controls.enableDamping,false);
  h.tick();h.tick();renderer.key('ArrowLeft');renderer.key('+');const direction=renderer.camera.position.clone().sub(renderer.target).normalize(),zoom=renderer.camera.position.distanceTo(renderer.target)/renderer.homeFrame.position.distanceTo(renderer.homeFrame.target);
  h.host.clientWidth=400;h.host.clientHeight=1000;h.observers[0].fn();assert.equal(renderer.camera.aspect,.4);assert.ok(direction.distanceTo(renderer.camera.position.clone().sub(renderer.target).normalize())<1e-8);assert.ok(Math.abs(renderer.camera.position.distanceTo(renderer.target)/renderer.homeFrame.position.distanceTo(renderer.homeFrame.target)-zoom)<1e-8);
  h.doc.hidden=true;h.doc.emit('visibilitychange');assert.equal(h.frames.size,0);h.controls.emit('change');assert.equal(h.frames.size,0);h.doc.hidden=false;h.doc.emit('visibilitychange');assert.equal(h.frames.size,1);h.tick();assert.equal(h.frames.size,1,'interactive controls continue to update while visible');
 }finally{renderer?.dispose();await renderer?.queue;h.restore()}
});

test('context loss is honest and recoverable; failed scene swaps retain owned prior geometry',async()=>{
 const T=await THREE,{EnvironmentBackdrop}=await import('../src/ui/environment-backdrop.mjs');const h=harness(T);let renderer;let errors=0,prevented=0;
 try{
  renderer=new EnvironmentBackdrop(h.host,{...h.options,onError:()=>errors++});assert.equal(await renderer.update('studio'),true);const previous=renderer.current;
  h.gl.nextError=true;assert.equal(await renderer.update('beach'),false);assert.equal(renderer.current,previous);assert.equal(previous.disposed,0);assert.equal(renderer.environmentScene,'bookshop');assert.equal(h.made[1].disposed,1);
  h.gl.domElement.emit('webglcontextlost',{preventDefault(){prevented++}});assert.equal(prevented,1);assert.equal(errors,2);assert.equal(renderer.contextUnavailable,true);assert.equal(h.host.dataset.fallback,'true');const count=h.gl.renders;renderer.render();assert.equal(h.gl.renders,count);
  h.gl.domElement.emit('webglcontextrestored');h.tick();assert.equal(renderer.contextUnavailable,false);assert.ok(h.gl.renders>count);assert.equal(h.host.dataset.fallback,undefined);
 }finally{renderer?.dispose();await renderer?.queue;h.restore()}
});

test('old coloured frame remains blurred while compiling and a superseded scene never commits',async()=>{
 const T=await THREE,{EnvironmentBackdrop}=await import('../src/ui/environment-backdrop.mjs');const h=harness(T);let renderer,release;
 try{
  renderer=new EnvironmentBackdrop(h.host,{...h.options,reducedMotion:true});assert.equal(await renderer.update('city'),true);
  let unblock;const gate=new Promise(resolve=>{unblock=resolve});release=unblock;
  let first=true,compiling=false;h.gl.compileAsync=()=>first?(first=false,compiling=true,gate):Promise.resolve();
  const old=renderer.current,pending=renderer.update('forest');
  const deadline=Date.now()+3000;while(!compiling&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(compiling,true);assert.equal(h.host.dataset.scene,'city');assert.equal(h.host.dataset.frozen,'true');assert.equal(renderer.current,old,'old scene stays visible while the new scene compiles');
  assert.equal(renderer.frozen.style.filter,'blur(8px)');
  assert.equal(h.gl.lastPreview,undefined,'no grey override material is drawn');
  const latest=renderer.update('classroom');release();
  assert.equal(await pending,false);assert.equal(await latest,true);
  assert.equal(renderer.environmentScene,'classroom');assert.equal(h.made[1].disposed,1,'superseded scene resources are released');assert.equal(h.host.dataset.frozen,undefined);
 }finally{release?.();renderer?.dispose();await renderer?.queue;h.restore()}
});

test('partial renderer initialization releases canvas and GL resources on control failure',async()=>{
 const T=await THREE,{EnvironmentBackdrop}=await import('../src/ui/environment-backdrop.mjs');const h=harness(T);
 try{assert.throws(()=>new EnvironmentBackdrop(h.host,{...h.options,interactive:true,controlsFactory(){throw Error('test controls failure')}}),/test controls failure/);assert.equal(h.gl.disposes,1);assert.equal(h.host.children.length,0);assert.equal(h.gl.domElement.listeners.size,0);assert.equal(h.doc.listeners.size,0)}finally{h.restore()}
});

test('detail camera keeps live climate updates and Home restores the full miniature',async()=>{
 const T=await THREE,{EnvironmentBackdrop}=await import('../src/ui/environment-backdrop.mjs');const h=harness(T);let renderer;
 try{
  renderer=new EnvironmentBackdrop(h.host,{...h.options,interactive:true,reducedMotion:true});await renderer.update('forest',12);
  const initial=renderer.camera.position.clone();renderer.current.cameraPresets={photo:{position:[0,2,10],target:[0,2,-4],fov:52}};
  assert.equal(renderer.showPhoto(),true);assert.equal(renderer.camera.fov,52);assert.ok(renderer.camera.position.distanceTo(initial)>1);
  const detail=renderer.camera.position.clone();await renderer.update('forest',17,{rain:.8,cloud:1});assert.deepEqual(renderer.camera.position.toArray(),detail.toArray());
  renderer.key('Home');assert.equal(renderer.detailView,false);assert.ok(renderer.camera.position.distanceTo(initial)<1e-6);
 }finally{renderer?.dispose();await renderer?.queue;h.restore()}
});

test('saved framing updates a loaded scene without reloading and Home returns to its saved view',async()=>{
 const T=await THREE,{EnvironmentBackdrop}=await import('../src/ui/environment-backdrop.mjs');const h=harness(T);let renderer;
 try{
  renderer=new EnvironmentBackdrop(h.host,{...h.options,interactive:true,reducedMotion:true});
  const view={horizontal:20,vertical:15,azimuth:45,elevation:25,scale:150};
  const loading=renderer.update('city',12);assert.equal(renderer.update('city',13,null,view),loading);
  assert.equal(await loading,true);assert.equal(h.made.length,1);
  const customized=renderer.camera.position.clone(),projected=renderer.target.clone().project(renderer.camera);
  assert.ok(Math.abs(projected.x-.4)<1e-8);assert.ok(Math.abs(projected.y+.3)<1e-8);
  renderer.key('ArrowLeft');renderer.key('+');renderer.key('Home');assert.ok(renderer.camera.position.distanceTo(customized)<1e-8);
  await renderer.update('city',13,null,{});const defaultPosition=renderer.camera.position.clone();
  assert.ok(Math.abs(defaultPosition.distanceTo(renderer.target)/customized.distanceTo(renderer.target)-1.5)<1e-8);
  assert.ok(defaultPosition.distanceTo(customized)>1);assert.equal(renderer.camera.view.enabled,false);assert.equal(h.made.length,1);
 }finally{renderer?.dispose();await renderer?.queue;h.restore()}
});

test('an inline preview ignores workspace offsets and leaves document gestures to the app',async()=>{
 const T=await THREE,{EnvironmentBackdrop}=await import('../src/ui/environment-backdrop.mjs');const h=harness(T);let renderer;
 try{
  h.host.closest=()=>{throw Error('preview must not query the app layout');};
  renderer=new EnvironmentBackdrop(h.host,{...h.options,preview:true,reducedMotion:true});
  assert.equal(await renderer.update('city',12,null,{horizontal:25}),true);
  assert.deepEqual([...h.doc.listeners.keys()],['visibilitychange']);assert.equal(h.win.listeners.size,0);
  assert.equal(renderer.homeFrame.shiftX,-.375);
 }finally{renderer?.dispose();await renderer?.queue;h.restore()}
});

test('gallery exposes its scene menu while settings owns instructions and app is hidden/inert during viewing',async()=>{
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{createServer}=await import('vite');const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
 try{
  const {default:Gallery}=await server.ssrLoadModule('/src/ui/SceneGallery.jsx');const html=renderToStaticMarkup(React.createElement(Gallery,{scene:'city'}));
  assert.match(html,/class="scene-gallery"/);assert.match(html,/Escape/);assert.match(html,/class="scene-gallery-stage"/);assert.match(html,/aria-label="场景小菜单"/);assert.match(html,/aria-expanded="false"/);
  const {default:Settings}=await server.ssrLoadModule('/src/ui/AvatarPresentationSettings.jsx');const settings=renderToStaticMarkup(React.createElement(Settings,{value:{scene:'city'},onOpenGallery(){},onChange(){}}));assert.match(settings,/观赏当前三维景观/);assert.match(settings,/Esc 返回/);assert.match(settings,/晚归灯火/);assert.match(settings,/未说出口/);assert.match(settings,/朱影寻春/);assert.match(html,/近景细看/);assert.match(html,/完整微缩景观/);
  const source=await fs.readFile(require('node:path').join(__dirname,'../src/main.jsx'),'utf8');assert.match(source,/inert=\{sceneGallery\?true:undefined\}/);assert.match(source,/display:sceneGallery\?'none':undefined/);assert.match(source,/!sceneGallery&&<SceneBackdrop/);assert.match(source,/active=\{!modal&&!sceneGallery\}/);
  const panel=await fs.readFile(require('node:path').join(__dirname,'../src/ui/CharacterPanel.jsx'),'utf8');assert.match(panel,/aria-label="拖动人物面板"><GripHorizontal size=\{16\}\/><\/span>/);assert.doesNotMatch(panel,/>拖动<\/span>/);
 }finally{await server.close()}
});
