const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises');
const THREE=import('three');

test('scene catalogue is pure metadata, immutable and preserves all saved IDs',async()=>{
 const {SCENES,sceneId,scenePreset}=await import('../src/ui/scene-catalog.mjs');
 const {presentationConfig}=await import('../src/ui/avatar-presentation.mjs');
 assert.deepEqual(Object.keys(SCENES).sort(),['beach','city','classroom','forest','studio']);
 for(const [id,preset]of Object.entries(SCENES)){assert.equal(presentationConfig({scene:id}).scene,id);assert.ok(preset.label&&preset.description&&preset.clear);assert.ok(Object.isFrozen(preset.lighting.direction));assert.equal(scenePreset(id),preset)}
 for(const id of ['__proto__','constructor','missing',null])assert.equal(sceneId(id),'studio');
 assert.equal(presentationConfig({scene:'__proto__'}).scene,'studio');assert.equal(scenePreset('city').liveDaylight,true);
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

function harness(){
 const saved=new Map(['document','ResizeObserver','requestAnimationFrame','cancelAnimationFrame'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 class Node{
  constructor(){this.listeners=new Map();this.attributes=new Map();this.clientWidth=1200;this.clientHeight=800;this.children=[];this.style={};this.captured=new Set()}
  get ownerDocument(){return doc}getRootNode(){return doc}getBoundingClientRect(){return {left:0,top:0,width:this.clientWidth,height:this.clientHeight}}
  setPointerCapture(id){this.captured.add(id)}releasePointerCapture(id){this.captured.delete(id)}
  addEventListener(type,fn){this.listeners.set(type,fn)}removeEventListener(type,fn){if(this.listeners.get(type)===fn)this.listeners.delete(type)}
  setAttribute(k,v){this.attributes.set(k,v)}removeAttribute(k){this.attributes.delete(k)}append(node){this.children.push(node);node.owner=this}remove(){this.owner.children=this.owner.children.filter(n=>n!==this)}
  emit(type,event={}){this.listeners.get(type)?.(event)}
 }
 const doc=new Node(),frames=new Map(),observers=[];doc.hidden=false;let seq=0;
 Object.defineProperties(globalThis,{document:{value:doc,configurable:true},ResizeObserver:{value:class{constructor(fn){this.fn=fn;observers.push(this)}observe(){}disconnect(){this.disconnected=true}},configurable:true},requestAnimationFrame:{value:fn=>{frames.set(++seq,fn);return seq},configurable:true},cancelAnimationFrame:{value:id=>frames.delete(id),configurable:true}});
 const host=new Node(),gl={domElement:new Node(),shadowMap:{},renders:0,sizes:0,setPixelRatio(value){this.dpr=value},setSize(){this.sizes++},render(scene,camera){if(this.nextError){this.nextError=false;throw Error('test draw failure')}this.renders++;this.lastScene=scene;this.lastCamera=camera},dispose(){this.disposes=(this.disposes||0)+1}};
 let controls;
 return {doc,host,gl,frames,observers,options:{rendererFactory:()=>gl,controlsFactory:(camera)=>{controls=new Node();Object.assign(controls,{target:camera.position.clone().set(0,0,0),update:()=>false,dispose(){this.disposed=true}});return controls}},get controls(){return controls},tick(){const work=[...frames.values()];frames.clear();for(const fn of work)fn()},restore(){for(const [key,descriptor]of saved)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]}};
}

test('passive backdrop never creates controls; orbit view is demand-rendered and disposes once',async()=>{
 const {EnvironmentBackdrop}=await import('../src/ui/environment-backdrop.mjs');
 for(const interactive of [false,true]){
  const h=harness();let renderer;
  try{
   renderer=new EnvironmentBackdrop(h.host,{...h.options,interactive});renderer.update('city',12);
   assert.equal(Boolean(h.controls),interactive);assert.equal(h.host.children.length,1);assert.ok(h.gl.renders>0);assert.equal(h.frames.size,0,'no idle animation loop');
   const expected=(await import('../src/ui/city-atmosphere.mjs')).cityLighting(12);
   assert.equal(renderer.light.intensity,expected.intensity,'city tracks the supplied local noon rather than forcing night');
   assert.ok(renderer.atmosphere.group.children.filter(x=>x.isLight).every(x=>x.intensity===0),'daytime store lamps are off');
   assert.ok(renderer.atmosphere?.group.parent===renderer.scene);assert.equal(h.gl.shadowMap.enabled,true,'night scene shadows are not collector-only');
   if(interactive){assert.equal(h.controls.enablePan,false);assert.ok(h.controls.minDistance>0);assert.ok(h.controls.maxDistance>h.controls.minDistance);h.controls.emit('change');h.controls.emit('change');assert.equal(h.frames.size,1);h.tick();assert.equal(h.frames.size,0);const before=renderer.camera.position.distanceTo(renderer.target);renderer.key('+');assert.ok(renderer.camera.position.distanceTo(renderer.target)<before);assert.equal(renderer.key('Escape'),false);renderer.key('Home')}
   const old=renderer.environment;renderer.update('forest',8);assert.equal(old.parent,null);assert.equal(renderer.environment.userData.environmentId,'forest');
   let shadowDisposals=0;renderer.light.shadow.map={dispose(){shadowDisposals++}};
   renderer.dispose();renderer.dispose();assert.equal(shadowDisposals,1);assert.equal(h.gl.shadowMap.enabled,interactive);assert.equal(h.gl.disposes,1);assert.equal(h.host.children.length,0);assert.equal(h.frames.size,0);assert.equal(h.doc.listeners.size,0);assert.equal(h.gl.domElement.listeners.size,0);assert.equal(h.observers[0].disconnected,true);if(interactive)assert.equal(h.controls.disposed,true);
  }finally{renderer?.dispose();h.restore()}
 }
});

test('real OrbitControls handles mouse rotation, wheel and two-touch pinch without a WebGL context',async()=>{
 const {EnvironmentBackdrop}=await import('../src/ui/environment-backdrop.mjs');const h=harness();let renderer;
 try{
  renderer=new EnvironmentBackdrop(h.host,{rendererFactory:h.options.rendererFactory,interactive:true,reducedMotion:true});renderer.update('city');const canvas=h.gl.domElement;
  const event=(pointerId,x,y,pointerType='mouse')=>({pointerId,clientX:x,clientY:y,pageX:x,pageY:y,pointerType,button:0,ctrlKey:false,metaKey:false,shiftKey:false,preventDefault(){}});
  const before=renderer.camera.position.clone();canvas.emit('pointerdown',event(1,500,400));h.doc.emit('pointermove',event(1,650,440));h.doc.emit('pointerup',event(1,650,440));assert.ok(renderer.camera.position.distanceTo(before)>.1,'actual OrbitControls rotates the camera');assert.equal(canvas.captured.size,0);
  const radius=renderer.camera.position.distanceTo(renderer.target);canvas.emit('wheel',{deltaY:-100,deltaMode:0,clientX:600,clientY:400,ctrlKey:false,preventDefault(){}});assert.ok(renderer.camera.position.distanceTo(renderer.target)<radius);
  const pinchBefore=renderer.camera.position.distanceTo(renderer.target);canvas.emit('pointerdown',event(2,480,400,'touch'));canvas.emit('pointerdown',event(3,720,400,'touch'));h.doc.emit('pointermove',event(3,800,400,'touch'));assert.ok(renderer.camera.position.distanceTo(renderer.target)<pinchBefore);h.doc.emit('pointerup',event(3,800,400,'touch'));h.doc.emit('pointerup',event(2,480,400,'touch'));
  // Pointer cancellation and teardown must not leave document listeners alive.
  canvas.emit('pointerdown',event(4,500,400));renderer.dispose();assert.equal(h.doc.listeners.size,0);assert.equal(canvas.listeners.size,0);
 }finally{renderer?.dispose();h.restore()}
});

test('resize preserves orbit direction and normalized zoom; hidden tabs cancel pending work',async()=>{
 const {EnvironmentBackdrop}=await import('../src/ui/environment-backdrop.mjs');const h=harness();let renderer;
 try{
  renderer=new EnvironmentBackdrop(h.host,{...h.options,interactive:true,reducedMotion:true});renderer.update('studio');assert.equal(h.controls.enableDamping,false);
  renderer.key('ArrowLeft');renderer.key('+');const direction=renderer.camera.position.clone().sub(renderer.target).normalize(),zoom=renderer.camera.position.distanceTo(renderer.target)/renderer.fitDistance;
  h.host.clientWidth=400;h.host.clientHeight=1000;h.observers[0].fn();assert.ok(direction.distanceTo(renderer.camera.position.clone().sub(renderer.target).normalize())<1e-8);assert.ok(Math.abs(renderer.camera.position.distanceTo(renderer.target)/renderer.fitDistance-zoom)<1e-8);
  h.doc.hidden=true;h.doc.emit('visibilitychange');assert.equal(h.frames.size,0);h.controls.emit('change');assert.equal(h.frames.size,0);h.doc.hidden=false;h.doc.emit('visibilitychange');assert.equal(h.frames.size,1);h.tick();assert.equal(h.frames.size,0);
 }finally{renderer?.dispose();h.restore()}
});

test('context loss is honest and recoverable; failed scene swaps retain owned prior geometry',async()=>{
 const {EnvironmentBackdrop}=await import('../src/ui/environment-backdrop.mjs');const h=harness();let renderer;let errors=0,prevented=0;
 try{
  renderer=new EnvironmentBackdrop(h.host,{...h.options,onError:()=>errors++});renderer.update('studio');const previous=renderer.environment;
  h.gl.nextError=true;assert.throws(()=>renderer.update('beach'),/test draw failure/);assert.equal(renderer.environment,previous);assert.equal(previous.parent,renderer.scene);assert.equal(renderer.environmentScene,'studio');
  h.gl.domElement.emit('webglcontextlost',{preventDefault(){prevented++}});assert.equal(prevented,1);assert.equal(errors,1);assert.equal(renderer.lost,true);assert.equal(h.host.attributes.get('data-fallback'),'true');const count=h.gl.renders;renderer.render();assert.equal(h.gl.renders,count);
  h.gl.domElement.emit('webglcontextrestored');h.tick();assert.equal(renderer.lost,false);assert.ok(h.gl.renders>count);assert.equal(h.host.attributes.has('data-fallback'),false);
 }finally{renderer?.dispose();h.restore()}
});

test('partial renderer initialization releases canvas and GL resources on control failure',async()=>{
 const {EnvironmentBackdrop}=await import('../src/ui/environment-backdrop.mjs');const h=harness();
 try{assert.throws(()=>new EnvironmentBackdrop(h.host,{...h.options,interactive:true,controlsFactory(){throw Error('test controls failure')}}),/test controls failure/);assert.equal(h.gl.disposes,1);assert.equal(h.host.children.length,0);assert.equal(h.gl.domElement.listeners.size,0);assert.equal(h.doc.listeners.size,0)}finally{h.restore()}
});

test('gallery markup has no visible UI; settings owns instructions and app is hidden/inert during viewing',async()=>{
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{createServer}=await import('vite');const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
 try{
  const {default:Gallery}=await server.ssrLoadModule('/src/ui/SceneGallery.jsx');const html=renderToStaticMarkup(React.createElement(Gallery,{scene:'city'}));
  assert.match(html,/class="scene-gallery"/);assert.match(html,/Escape/);assert.doesNotMatch(html,/<(?:button|h[1-6]|p|span|aside|header|nav)\b/);assert.match(html,/><\/div>$/);
  const {default:Settings}=await server.ssrLoadModule('/src/ui/AvatarPresentationSettings.jsx');const settings=renderToStaticMarkup(React.createElement(Settings,{value:{scene:'city'},onOpenGallery(){},onChange(){}}));assert.match(settings,/观赏当前三维景观/);assert.match(settings,/Esc 返回/);assert.match(settings,/街角便利店/);
  const source=await fs.readFile(require('node:path').join(__dirname,'../src/main.jsx'),'utf8');assert.match(source,/inert=\{sceneGallery\?true:undefined\}/);assert.match(source,/display:sceneGallery\?'none':undefined/);assert.match(source,/!sceneGallery&&<SceneBackdrop/);assert.match(source,/active=\{!modal&&!sceneGallery\}/);
  const panel=await fs.readFile(require('node:path').join(__dirname,'../src/ui/CharacterPanel.jsx'),'utf8');assert.match(panel,/aria-label="拖动人物面板"><GripHorizontal size=\{16\}\/><\/span>/);assert.doesNotMatch(panel,/>拖动<\/span>/);
 }finally{await server.close()}
});
