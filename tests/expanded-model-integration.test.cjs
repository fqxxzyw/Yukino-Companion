const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..');
const tick=()=>new Promise(resolve=>setImmediate(resolve));

// Execute the real compiled components and their effect order. The renderer is
// stubbed only at its WebGL boundary; no private profile/model/network is read.
async function hookHarness(t,component,api={}){
 const {transformWithOxc}=await import('vite'),dir=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-expanded-hooks-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const hooksFile=path.join(dir,'hooks.mjs'),runtimeFile=path.join(dir,'runtime.mjs'),dummyFile=path.join(dir,'dummy.mjs');
 await fs.writeFile(hooksFile,`
 let values=[],cursor=0,effects=[],cleanups=new Map();export let dirty=true;
 export default {};export function begin(){cursor=0;dirty=false}
 export function useState(initial){const n=cursor++;if(!(n in values))values[n]=typeof initial==='function'?initial():initial;return [values[n],v=>{const next=typeof v==='function'?v(values[n]):v;if(!Object.is(next,values[n])){values[n]=next;dirty=true}}]}
 export function useRef(value){const n=cursor++;return values[n]||(values[n]={current:value})}
 export function useEffect(fn,deps){const n=cursor++,old=values[n];if(!old||!deps||deps.length!==old.length||deps.some((v,i)=>!Object.is(v,old[i]))){values[n]=deps;effects.push(()=>{cleanups.get(n)?.();cleanups.set(n,fn())})}}
 export const useLayoutEffect=useEffect;export function flush(){effects.splice(0).forEach(fn=>fn())}
 export function unmount(){for(const fn of cleanups.values())fn?.();cleanups.clear()}
 `);
 await fs.writeFile(dummyFile,`export default ()=>null;export const useReducedMotion=value=>!!value;export const useLocalDaylight=value=>value?.latitude===35?{kind:'solar',elevation:40,hourAngle:0}:12;export const models=[];`);
 await fs.writeFile(runtimeFile,`
 export const instances=[];
 export class GlbAvatarRenderer{
 constructor(host,options){this.catalog=options.catalog;this.options=options;this.epoch=0;this.events=[];instances.push(this)}
 async prepareOutfit(id,{signal}={}){this.events.push('prepare:'+id);signal?.throwIfAborted();const entry=this.catalog.find(x=>x.id===id);if(!entry)throw Error('Model not in current catalog: '+id);return {entry}}
 async commitOutfit(prepared){this.entry=prepared.entry;this.events.push('commit:'+this.entry.id);this.options.onStatus?.({phase:'ready'})}
 async load(id){const epoch=++this.epoch;this.events.push('load:'+id);const next=await this.prepareOutfit(id);if(epoch===this.epoch&&!this.disposed)await this.commitOutfit(next)}
 cancelLoad(){this.epoch++;this.events.push('cancel-load')}
 clear(){this.epoch++;this.entry=null;this.events.push('clear')}
 dispose(){this.disposed=true;this.clear()}setView(){}setGaze(){}setActivity(){}setEnvironment(){}setRenderStyle(){}setReducedMotion(){}resetTransition(){}disposePrepared(){}
 async greet(){}async enter(){}async exit(){}
 }
 `);
 let unmount=()=>{};const saved={};for(const name of ['window','document','requestAnimationFrame','cancelAnimationFrame'])saved[name]=globalThis[name];
 globalThis.window={desktop:api,companion:api,addEventListener(){},removeEventListener(){}};
 globalThis.document={addEventListener(){},removeEventListener(){}};globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
 t.after(()=>{unmount();for(const [name,value]of Object.entries(saved)){if(value===undefined)delete globalThis[name];else globalThis[name]=value}});
 let source=await fs.readFile(path.join(root,component),'utf8');
 if(component.endsWith('model-window.jsx'))source=source.replace(/createRoot\(document\.getElementById\('root'\)\)\.render\(<ModelWindow\/>\);/,'export default ModelWindow;');
 let {code}=await transformWithOxc(source,path.basename(component));
 code=code.replace(/import ["'][^"']+\.css["'];?/g,'');
 code=code.replaceAll('"react"',JSON.stringify(pathToFileURL(hooksFile).href));
 for(const name of ['react/jsx-runtime','react-dom/client','lucide-react'])code=code.replaceAll(JSON.stringify(name),JSON.stringify(pathToFileURL(require.resolve(name)).href));
 code=code.replace(/(["'])(\.[^"']+)\1/g,(all,_quote,specifier)=>{
  let file;if(specifier.endsWith('model-runtime.mjs'))file=runtimeFile;
  else if(/(?:use-reduced-motion\.mjs|use-local-daylight\.mjs|PetAvatar\.jsx|CompactDock\.jsx|SkinPicker\.jsx|Select\.jsx|character-models\.json)$/.test(specifier))file=dummyFile;
  else file=path.resolve(root,path.dirname(component),specifier);
  return JSON.stringify(pathToFileURL(file).href);
 });
 const file=path.join(dir,'component.mjs');await fs.writeFile(file,code);
 const hooks=await import(pathToFileURL(hooksFile).href),runtime=await import(pathToFileURL(runtimeFile).href),module=await import(pathToFileURL(file).href);
 let props={},tree;
 function refs(node){if(!node)return;if(Array.isArray(node)){node.forEach(refs);return}if(typeof node!=='object')return;if(node.props?.ref&&typeof node.props.ref==='object'&&!node.props.ref.current)node.props.ref.current={style:{},dataset:{},addEventListener(){},removeEventListener(){},getBoundingClientRect:()=>({left:0,top:0,width:300,height:600})};refs(node.props?.children)}
 function render(next=props){props=next;hooks.begin();tree=module.default(props);refs(tree);hooks.flush();return tree}
 async function settle(){for(let i=0;i<12;i++){await tick();if(hooks.dirty)render()}return tree}
 unmount=()=>hooks.unmount();return {render,settle,runtime,hooks,get tree(){return tree}};
}

test('actual ModelWindow reloads the same model after identity change instead of leaving a cleared canvas',async t=>{
 let receive,receiveMouth;const entry={id:'school',ready:true};const api={onState:fn=>(receive=fn,()=>{}),onMouth:fn=>(receiveMouth=fn,()=>{}),call:async action=>action==='model-catalog'?{models:[entry]}:true};
 const h=await hookHarness(t,'src/model-window.jsx',api);h.render();await h.settle();
 receive({character:{id:'a',modelId:'school'},preferences:{}});h.render();await h.settle();
 const runtime=h.runtime.instances[0];assert.equal(runtime.entry?.id,'school');
 const walk=node=>!node?[]:Array.isArray(node)?node.flatMap(walk):typeof node==='object'?[node,...walk(node.props?.children)]:[];
 const input=()=>walk(h.tree).find(node=>typeof node.props?.onVisual==='function');input().props.onChange('Private draft for character A');receiveMouth(.2);h.render();assert.equal(input().props.value,'Private draft for character A');
 receive({character:{id:'b',modelId:'school'},preferences:{}});h.render();await h.settle();
 assert.equal(runtime.entry?.id,'school');assert.equal(runtime.events.filter(event=>event==='load:school').length,2);assert.equal(input().props.value,'');assert.equal(runtime.options.audioPlayer.getLevel(),0);
});

test('actual ModelWindow ignores stale catalog completion after no-model selection and newer identity',async t=>{
 let receive,pending=[];const api={onState:fn=>(receive=fn,()=>{}),onMouth:()=>()=>{},call:action=>action==='model-catalog'?new Promise(resolve=>pending.push(resolve)):Promise.resolve(true)};
 const h=await hookHarness(t,'src/model-window.jsx',api);h.render();await h.settle();
 receive({character:{id:'a',modelId:'old'},preferences:{}});h.render();await h.settle();
 receive({character:{id:'b',modelId:''},preferences:{}});h.render();await h.settle();
 pending.shift()({models:[{id:'old'}]});await h.settle();const runtime=h.runtime.instances[0];
 assert.equal(runtime.entry,null);assert.ok(!runtime.events.includes('load:old'));
 receive({character:{id:'c',modelId:'new'},preferences:{}});h.render();await h.settle();pending.shift()({models:[{id:'new'}]});await h.settle();assert.equal(runtime.entry?.id,'new');
});

test('actual ModelWindow cancels the old load immediately while the newer catalog is still pending',async t=>{
 let receive,releaseCatalog,holdCatalog=false,releaseOld;
 const api={onState:fn=>(receive=fn,()=>{}),onMouth:()=>()=>{},call:action=>action==='model-catalog'?(holdCatalog?new Promise(resolve=>releaseCatalog=resolve):Promise.resolve({models:[{id:'old'},{id:'new'}]})):Promise.resolve(true)};
 const h=await hookHarness(t,'src/model-window.jsx',api);h.render();await h.settle();const runtime=h.runtime.instances[0],prepare=runtime.prepareOutfit.bind(runtime);
 runtime.prepareOutfit=async id=>{if(id==='old')await new Promise(resolve=>releaseOld=resolve);return prepare(id)};
 receive({character:{id:'same',modelId:'old'},preferences:{}});h.render();await h.settle();const epoch=runtime.epoch;
 holdCatalog=true;receive({character:{id:'same',modelId:'new'},preferences:{}});h.render();await h.settle();assert.ok(runtime.epoch>epoch,'cancel must happen before awaiting the new catalog');
 releaseOld();await h.settle();assert.ok(!runtime.events.includes('commit:old'));
 releaseCatalog({models:[{id:'old'},{id:'new'}]});await h.settle();assert.equal(runtime.entry?.id,'new');
});

test('desktop model reply is inside its drag header and defaults to Chinese',async t=>{
 let receive;const api={onState:fn=>(receive=fn,()=>{}),onMouth:()=>()=>{},call:async action=>action==='model-catalog'?{models:[]}:true},h=await hookHarness(t,'src/model-window.jsx',api);h.render();await h.settle();
 receive({character:{id:'a',name:'雪乃'},preferences:{},reply:{zh:'你好，今天辛苦了。',ja:'こんにちは。'}});h.render();await h.settle();
 const walk=node=>!node?[]:Array.isArray(node)?node.flatMap(walk):typeof node==='object'?[node,...walk(node.props?.children)]:[];
 const header=walk(h.tree).find(node=>node.type==='header'),replies=walk(h.tree).filter(node=>node.props?.className==='model-reply');
 assert.equal(replies.length,1);assert.ok(walk(header).includes(replies[0]));assert.equal(replies[0].props.children,'你好，今天辛苦了。');
 receive({character:{id:'a',name:'雪乃'},preferences:{bubbleLanguage:'ja'},reply:{zh:'你好',ja:'こんにちは。'}});h.render();await h.settle();assert.equal(walk(h.tree).find(node=>node.props?.className==='model-reply').props.children,'こんにちは。');
 receive({character:{id:'a',name:'雪乃'},preferences:{},reply:{zh:'',ja:'こんにちは。'}});h.render();await h.settle();assert.match(walk(h.tree).find(node=>node.props?.className==='model-reply').props.children,/中文暂不可用 · 日文原文/);
});

test('a pointer captured before gait and a render-delayed reset button cannot change the locked view',async t=>{
 let receive;const api={onState:fn=>(receive=fn,()=>{}),onMouth:()=>()=>{},call:async action=>action==='model-catalog'?{models:[{id:'school'}]}:true},h=await hookHarness(t,'src/model-window.jsx',api);h.render();await h.settle();receive({character:{id:'a',modelId:'school'},preferences:{}});h.render();await h.settle();
 const walk=node=>!node?[]:Array.isArray(node)?node.flatMap(walk):typeof node==='object'?[node,...walk(node.props?.children)]:[],host=walk(h.tree).find(node=>node.props?.className==='model-window-canvas'),reset=walk(h.tree).find(node=>node.props?.['aria-label']==='恢复全身正面');
 host.props.onPointerDown({button:0,pointerId:1,clientX:10,currentTarget:{setPointerCapture(){}}});const runtime=h.runtime.instances[0];runtime.walkingMotion={};host.props.onPointerMove({pointerId:1,clientX:200});reset.props.onClick();assert.equal(h.hooks.dirty,false,'neither stale pointer nor stale enabled button may mutate the locked view');
});

test('actual CharacterPanel sees newly imported catalog before selecting custom model; removing selection disposes renderer',async t=>{
 const h=await hookHarness(t,'src/ui/CharacterPanel.jsx');
 const initial={side:'left',width:300,onChange(){},onSettings(){},containerRef:{current:null},character:{id:'a',modelId:'school'},models:[{id:'school',ready:true,clips:{}}],reducedMotion:true};
 h.render(initial);await h.settle();const runtime=h.runtime.instances[0];assert.equal(runtime.entry?.id,'school');
 h.render({...initial,character:{id:'a',modelId:'custom-new'},models:[...initial.models,{id:'custom-new',ready:true,clips:{}}]});await h.settle();
 assert.equal(runtime.entry?.id,'custom-new');assert.equal(runtime.events.filter(event=>event==='commit:custom-new').length,1);
 h.render({...initial,character:{id:'a',modelId:''}});await h.settle();assert.equal(runtime.disposed,true);assert.equal(runtime.entry,null);
});

test('scene changes retain the user\'s saved daylight location',async t=>{
 const h=await hookHarness(t,'src/ui/CharacterPanel.jsx');let update;
 const location={latitude:35,longitude:139},props={side:'right',width:300,onChange(){},onSettings(){},onPresentationChange:value=>update=value,containerRef:{current:null},character:{id:'a',modelId:''},presentation:{scene:'studio',daylightLocation:location},reducedMotion:true};
 const walk=node=>!node?[]:Array.isArray(node)?node.flatMap(walk):typeof node==='object'?[node,...walk(node.props?.children)]:[];
 h.render(props);walk(h.tree).find(node=>node.props?.['aria-label']==='人物场景选项').props.onClick();h.render();
 walk(h.tree).find(node=>node.type==='button'&&node.props?.children==='海边').props.onClick();
 assert.equal(update.scene,'beach');assert.deepEqual(update.daylightLocation,location);
});

test('actual CharacterSettings coalesces same-turn duplicate create submissions before rerender',async t=>{
 let creates=0,finish;const gate=new Promise(resolve=>finish=resolve),h=await hookHarness(t,'src/ui/CharacterSettings.jsx');
 h.render({characters:[{id:'a',name:'A'}],current:{id:'a',name:'A'},models:[],onCreate:async()=>{creates++;await gate}});
 const walk=node=>!node?[]:Array.isArray(node)?node.flatMap(walk):typeof node==='object'?[node,...walk(node.props?.children)]:[];
 const submit=walk(h.tree).find(node=>node.type==='form').props.onSubmit;
 const first=submit({preventDefault(){}}),second=submit({preventDefault(){}});finish();await Promise.all([first,second]);await h.settle();assert.equal(creates,1);
});

test('manual daylight location requires valid coordinates and can be cleared',async t=>{
 const h=await hookHarness(t,'src/ui/SunlightLocationSettings.jsx');let submitted='unchanged';
 const props={value:null,onChange:value=>submitted=value},walk=node=>!node?[]:Array.isArray(node)?node.flatMap(walk):typeof node==='object'?[node,...walk(node.props?.children)]:[];
 const find=(type)=>walk(h.tree).filter(node=>node.type===type);
 h.render(props);assert.equal(find('button')[0].props.disabled,true);
 find('input')[0].props.onChange({target:{value:'35.6895'}});find('input')[1].props.onChange({target:{value:'181'}});h.render();assert.equal(find('button')[0].props.disabled,true);
 find('input')[1].props.onChange({target:{value:'139.6917'}});h.render();assert.equal(find('button')[0].props.disabled,false);find('button')[0].props.onClick();assert.deepEqual(submitted,{latitude:35.6895,longitude:139.6917});
 h.render({...props,value:submitted});h.render({...props,value:submitted});assert.equal(find('button').length,2);find('button')[1].props.onClick();assert.equal(submitted,null);
});

async function cpuRenderer(){
 const THREE=await import('three'),{GlbAvatarRenderer}=await import('../src/ui/model-runtime.mjs');
 const renderer=Object.create(GlbAvatarRenderer.prototype);
 Object.assign(renderer,{scene:new THREE.Scene(),camera:new THREE.PerspectiveCamera(30,1,.01,100),container:{dataset:{},style:{}},gl:{domElement:{dataset:{}}},zoom:1,yaw:0,renderStyle:'natural',onStatus(){},meshes:[],gaze:{headYaw:0,headPitch:0},epoch:0});
 return {THREE,renderer};
}

test('custom off-origin model stays centered at every yaw without changing authored skeleton transforms',async()=>{
 const {THREE,renderer}=await cpuRenderer(),root=new THREE.Group(),bone=new THREE.Bone();bone.name='CustomBone';bone.position.set(3,.4,2);root.add(bone);
 const mesh=new THREE.Mesh(new THREE.BoxGeometry(.6,2,.4),new THREE.MeshBasicMaterial());mesh.position.set(3,1,2);root.add(mesh);root.updateMatrixWorld(true);
 const sourceBounds=new THREE.Box3().setFromObject(root),size=sourceBounds.getSize(new THREE.Vector3()),before=bone.matrix.clone();
 await renderer.commitOutfit({entry:{id:'custom-offset',label:'Local fixture',version:'test',clips:{}},gltf:{scene:root,animations:[]},sourceBounds,size});
 for(const yaw of [0,90,180,270]){renderer.setView({yaw});renderer.root.updateMatrixWorld(true);const center=new THREE.Box3().setFromObject(renderer.root).getCenter(new THREE.Vector3());assert.ok(Math.abs(center.x)<1e-6&&Math.abs(center.z)<1e-6,`yaw ${yaw}: model center moved to ${center.x},${center.z}`);assert.deepEqual(bone.matrix.elements,before.elements)}
 renderer.clear();
});

test('runtime reduced-motion render freezes animation/gaze and sets mouth to neutral',async t=>{
 const {THREE,renderer}=await cpuRenderer(),saved={requestAnimationFrame:globalThis.requestAnimationFrame,document:globalThis.document};
 globalThis.requestAnimationFrame=()=>1;globalThis.document={hidden:false};t.after(()=>Object.assign(globalThis,saved));
 const updates=[],head=new THREE.Bone(),base=head.quaternion.clone(),mesh={morphTargetDictionary:{mouth:0},morphTargetInfluences:[.2]};
 Object.assign(renderer,{reducedMotion:true,last:0,head,headBase:base,entry:{mouth:{canonical_name:'mouth',recommended_dialogue_range:[0,.3]},clips:{}},meshes:[mesh],mixer:{update:dt=>updates.push(dt)},activity:'idle',nextMicro:0,audioPlayer:{getLevel:()=>1},gaze:{headYaw:12,headPitch:7},gl:{render(){},domElement:{dataset:{}}}});
 renderer.renderFrame(200);renderer.renderFrame(400);assert.deepEqual(updates,[0,0]);assert.deepEqual(head.quaternion.toArray(),base.toArray());assert.equal(mesh.morphTargetInfluences[0],0);
});

test('real runtime clear invalidates a late prepared model and disposes it instead of resurrecting no-selection',async()=>{
 const {THREE,renderer}=await cpuRenderer();let finish,disposed=0;
 const mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());mesh.geometry.addEventListener('dispose',()=>disposed++);
 renderer.prepareOutfit=()=>new Promise(resolve=>finish=resolve);
 const pending=renderer.load('obsolete');renderer.clear();finish({gltf:{scene:mesh}});await pending;
 assert.equal(renderer.root,null);assert.equal(disposed,1);assert.equal(renderer.container.dataset.modelReady,undefined);
});

test('confirmed static imports cannot autoplay authored transform clips or treat a named mesh as a gaze bone',async()=>{
 const {THREE,renderer}=await cpuRenderer(),mesh=new THREE.Mesh(new THREE.BoxGeometry(.6,2,.4),new THREE.MeshBasicMaterial());mesh.name='J_Bip_C_Neck';mesh.position.y=1;mesh.updateMatrixWorld(true);
 const sourceBounds=new THREE.Box3().setFromObject(mesh),size=sourceBounds.getSize(new THREE.Vector3());
 const clip=new THREE.AnimationClip('Idle_Breathe',1,[new THREE.VectorKeyframeTrack('J_Bip_C_Neck.position',[0,1],[0,1,0,3,1,0])]);
 await renderer.commitOutfit({entry:{id:'custom-static',label:'Static fixture',version:'test',importMode:'static',clips:{}},gltf:{scene:mesh,animations:[clip]},sourceBounds,size});
 assert.ok(renderer.currentAction===null,'static means no automatic animation even if clip has a familiar name');assert.ok(renderer.head===null,'a matching node name is not evidence of a gaze-capable bone');assert.equal(renderer.play('Idle_Breathe'),false);
 renderer.mixer.update(.5);assert.deepEqual(mesh.position.toArray(),[0,1,0]);renderer.clear();
});

test('main-process skin gate matches UI for migrated dates, archive overlap and non-finite affection',async()=>{
 const {getSkinStatus,normalizeUsedDates}=await import('../src/companion/skin-unlocks.mjs'),{canUseSkin,usedDays}=require('../electron/skin-policy.cjs');
 const dates=Array.from({length:7},(_,n)=>`2026-10-${String(n+1).padStart(2,'0')}`),swim={id:'yukino-03-v1',ready:true},daily={id:'yukino-02-v1',ready:true};
 const cases=[{usedDates:dates},{usedDates:{usedDates:dates}},{usedDates:{version:1,dates:dates.slice(0,6),archivedCount:1,archivedThrough:dates[5]}},{usedDates:{version:1,archivedCount:7,archivedThrough:'2026-02-30'}},{usedDates:{version:1,archivedCount:7,archivedThrough:'0000-01-01'}}];
 for(const state of cases)assert.equal(canUseSkin(swim,state),getSkinStatus(swim,state).unlocked,JSON.stringify(state));
 for(const affection of [Infinity,NaN,'100',-10,35,40,100]){const state={relationship:{affection}};assert.equal(canUseSkin(daily,state),getSkinStatus(daily,state).unlocked,`affection=${affection}`)}
 for(const archivedThrough of ['',null,'0000-01-01','0001-01-01','0001-01-02','2026-02-30','2026-10-03','2026-10-07','9999-12-31'])for(const archivedCount of [-1,0,1,7,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER])for(const version of [undefined,1,2]){
  const value={version,archivedThrough,archivedCount,dates:[...dates,dates[0],'2026-02-30','0000-01-01','bad',null]};
  assert.equal(usedDays(value),normalizeUsedDates(value).lifetimeCount,JSON.stringify(value));
 }
});

test('real model selection function persists current progress before publishing a new model and preserves concurrent chat updates',async()=>{
 const {getSkinStatus}=await import('../src/companion/skin-unlocks.mjs'),{canUseSkin}=require('../electron/skin-policy.cjs');
 const source=await fs.readFile(path.join(root,'src/main.jsx'),'utf8'),start=source.indexOf('async function updateModel('),end=source.indexOf('\nasync function addCharacter(',start);
 assert.ok(start>=0&&end>start);const functionSource=source.slice(start,end);
 let state={activeCharacter:'a',characters:[{id:'a',modelId:'yukino-07-v1'}],relationship:{affection:40},conversations:[]},persisted={...state,relationship:{affection:35}},resolveSave,errors=[];
 const entry={id:'yukino-02-v1',ready:true},sref={current:state},epoch={current:0},events=[];
 const api={save:next=>{events.push('save-start');return new Promise(resolve=>{resolveSave=()=>{persisted=structuredClone(next);events.push('save-complete');resolve()}})}};
 const setS=update=>{state=typeof update==='function'?update(state):update;sref.current=state;events.push('publish');assert.equal(canUseSkin(entry,persisted),true,'model data gate sees persisted unlocked progress before selection')};
 const updateModel=new Function('models','sref','getSkinStatus','setError','modelSelectionEpoch','api','setS','friendlyError',`${functionSource};return updateModel;`)([entry],sref,getSkinStatus,e=>errors.push(e),epoch,api,setS,e=>e.message);
 const pending=updateModel(entry.id);assert.deepEqual(events,['save-start']);assert.equal(state.characters[0].modelId,'yukino-07-v1');
 state={...state,conversations:[{id:'arrived-during-save',messages:[{content:'new stream token'}]}]};sref.current=state;
 resolveSave();await pending;assert.deepEqual(events,['save-start','save-complete','publish']);assert.equal(state.characters[0].modelId,entry.id);assert.equal(state.conversations[0].id,'arrived-during-save');assert.deepEqual(errors,[]);
 const old=updateModel('');epoch.current++;resolveSave();await old;assert.equal(state.characters[0].modelId,entry.id,'a switched identity invalidates pending model selection');
});

test('real character creation coalesces pending work and merges without reverting newer identity, chat or used dates',async()=>{
 const {getSkinStatus}=await import('../src/companion/skin-unlocks.mjs'),{normalizeCharacters,createCharacter,selectCharacter}=await import('../src/companion/characters.mjs');
 const source=await fs.readFile(path.join(root,'src/main.jsx'),'utf8'),start=source.indexOf('async function addCharacter('),end=source.indexOf('\nuseEffect(',start);assert.ok(start>=0&&end>start);
 let state=normalizeCharacters({characters:[{id:'yukino',name:'雪乃'},{id:'alt',name:'Other'}],activeCharacter:'yukino',conversations:[]}),finish,saves=0,drafts=[];
 const sref={current:state},creatingCharacter={current:false},modelSelectionEpoch={current:0},activeRequest={current:null};
 const api={save:async()=>{saves++;await new Promise(resolve=>finish=resolve)}};
 const setS=update=>{state=typeof update==='function'?update(state):update;sref.current=state};
 const addCharacter=new Function('creatingCharacter','sref','getSkinStatus','models','modelSelectionEpoch','stopSpeech','createCharacter','api','activeRequest','setS','selectCharacter','setDraft','setError',`${source.slice(start,end)};return addCharacter;`)(creatingCharacter,sref,getSkinStatus,[],modelSelectionEpoch,()=>{},createCharacter,api,activeRequest,setS,selectCharacter,value=>drafts.push(value),()=>{});
 const first=addCharacter({name:'Created once'}),duplicate=addCharacter({name:'Duplicate'});assert.equal(saves,1);
 state=selectCharacter({...state,conversations:[{id:'new-chat',messages:[{content:'Latest token'}]}],usedDates:{dates:['2026-10-27']}},'alt');sref.current=state;modelSelectionEpoch.current++;activeRequest.current={id:'new-chat'};
 finish();await Promise.all([first,duplicate]);assert.equal(creatingCharacter.current,false);assert.equal(state.activeCharacter,'alt');assert.equal(state.characters.filter(item=>item.name==='Created once').length,1);assert.equal(state.characters.some(item=>item.name==='Duplicate'),false);assert.equal(state.conversations[0].messages[0].content,'Latest token');assert.deepEqual(state.usedDates,{dates:['2026-10-27']});assert.deepEqual(drafts,[]);
});

test('eight-weight material replaced by a style switch is still disposed once when model is cleared',async()=>{
 const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js'),{createEightWeightFixture}=await import('./helpers/eight-weight-fixture.mjs');
 const {inspectGlbSkinning,applyEightWeightSkinning}=await import('../src/ui/eight-weight-skinning.mjs'),{applyRenderStyle}=await import('../src/ui/model-style.mjs');
 const fixture=createEightWeightFixture(),gltf=await new GLTFLoader().parseAsync(fixture.bytes,'');
 applyRenderStyle(gltf.scene,'natural');applyEightWeightSkinning(gltf,inspectGlbSkinning(fixture.json,fixture.bytes));
 const adaptedMaterial=gltf.scene.getObjectByName('Main').material;let disposed=0;adaptedMaterial.addEventListener('dispose',()=>disposed++);
 applyRenderStyle(gltf.scene,'toon');applyRenderStyle(gltf.scene,'natural');
 const {renderer}=await cpuRenderer();renderer.root=gltf.scene;renderer.scene.add(gltf.scene);renderer.clear();assert.equal(disposed,1);
});

test('toon preview preserves authored vertex colors on a valid custom mesh',async()=>{
 const THREE=await import('three'),{applyRenderStyle}=await import('../src/ui/model-style.mjs'),source=new THREE.MeshStandardMaterial({vertexColors:true}),mesh=new THREE.Mesh(new THREE.BoxGeometry(),source);
 applyRenderStyle(mesh,'toon');assert.equal(mesh.material.vertexColors,true);const toon=mesh.material;applyRenderStyle(mesh,'natural');assert.equal(mesh.material,source);
 mesh.geometry.dispose();toon.gradientMap.dispose();toon.dispose();source.dispose();
});

test('authenticated companion activity receipt is emitted by user drag/action, never passive ready/cursor/idle quotes',async()=>{
 const {CompanionManager}=require('../electron/companions.cjs');let receipts=0;
 const manager=new CompanionManager({electron:{app:{quit(){}},screen:{getCursorScreenPoint:()=>({x:10,y:20})}},dataDir:'/tmp/yukino-no-io-receipt-fixture',onUse:()=>receipts++});
 const mainFrame={},webContents={mainFrame,send(){}},win={webContents,isDestroyed:()=>false,getBounds:()=>({x:0,y:0,width:330,height:410}),getPosition:()=>[0,0],setIgnoreMouseEvents(){}};
 manager.windows.set('pet',win);manager.performAction=async()=>true;
 const event={sender:webContents,senderFrame:mainFrame};
 await manager.viewCall(event,'ready');await manager.viewCall(event,'cursor');await manager.viewCall(event,'quote',{trigger:'Greeting'});await manager.viewCall(event,'quote',{trigger:'Idle'});assert.equal(receipts,0);
 await manager.viewCall(event,'drag-start');assert.equal(receipts,1);await manager.viewCall(event,'action','greet');assert.equal(receipts,2);
 await assert.rejects(manager.viewCall({sender:webContents,senderFrame:{}},'action','greet'),/不允许/);assert.equal(receipts,2);
});
test('actual CharacterPanel never loads a locked skin and retries after persisted progress unlocks it',async t=>{const h=await hookHarness(t,'src/ui/CharacterPanel.jsx'),models=[{id:'yukino-03-v1',ready:true,clips:{}}],props={side:'left',width:300,onChange(){},onSettings(){},containerRef:{current:null},character:{id:'a',modelId:models[0].id},models,reducedMotion:true,usedDates:{dates:[]}};h.render(props);await h.settle();const runtime=h.runtime.instances[0];assert.equal(runtime.entry,null);h.render({...props,usedDates:{dates:Array.from({length:7},(_,i)=>`2026-10-0${i+1}`)}});await h.settle();assert.equal(runtime.entry.id,models[0].id);});

test('ModelWindow consumes numeric audio clock, clears identity state and permits a fresh renderer generation',async t=>{
 let receive,receiveSpeech;const api={onState:fn=>(receive=fn,()=>{}),onSpeech:fn=>(receiveSpeech=fn,()=>{}),onMouth:()=>()=>{},call:async action=>action==='model-catalog'?{models:[{id:'school'}]}:true};
 const h=await hookHarness(t,'src/model-window.jsx',api);h.render();await h.settle();receive({character:{id:'a',modelId:'school'},preferences:{}});h.render();await h.settle();const runtime=h.runtime.instances[0];let resets=0;runtime.resetSpeechClock=()=>resets++;
 const s={sequence:5,token:10,clockSeconds:20,playing:true,paused:false,elapsedSeconds:1,durationSeconds:5,level:.2,hint:'neutral'};receiveSpeech(s);assert.equal(runtime.options.audioPlayer.getSnapshot().elapsedSeconds,1);assert.equal(runtime.options.audioPlayer.getLevel(),.2);
 receiveSpeech(null);assert.equal(resets,1);assert.equal(runtime.options.audioPlayer.getSnapshot().playing,false);
 receiveSpeech({...s,sequence:1,token:1});assert.equal(runtime.options.audioPlayer.getSnapshot().token,1,'explicit renderer generation reset permits new monotonically numbered stream');
 receive({character:{id:'b',modelId:'school'},preferences:{}});h.render();await h.settle();assert.equal(runtime.options.audioPlayer.getSnapshot().playing,false);assert.equal(runtime.options.audioPlayer.getLevel(),0);
});

test('native model QA uses the production player and demands clock, pause, gesture and stop evidence',async()=>{
 const source=await fs.readFile(path.join(root,'scripts/capture-model-ui.cjs'),'utf8'),preload=await fs.readFile(path.join(root,'scripts/model-capture/preload.cjs'),'utf8');
 assert.match(source,/src\/speech\/player\.mjs/);assert.match(source,/__qaAudio\.play\(bytes/);assert.match(source,/getSnapshot\(\)/);assert.match(source,/context\.suspend\(\)/);assert.match(source,/context\.resume\(\)/);assert.match(source,/!started\|\|!paused\|\|!gesture\|\|!complete\|\|!cleared/);assert.match(source,/Actual AudioContext suspension did not freeze speech/);assert.match(source,/Suspended audio did not release gesture weight/);assert.match(source,/await checkActualAudioClock\(\)/);assert.match(preload,/onSpeech/);
});

test('independent model preserves lighting/toon settings and available-language visual bubble',async t=>{let receive;const api={onState:fn=>(receive=fn,()=>{}),onMouth:()=>()=>{},call:async action=>action==='model-catalog'?{models:[]}:true},h=await hookHarness(t,'src/model-window.jsx',api);h.render();await h.settle();const runtime=h.runtime.instances[0],environments=[],styles=[];runtime.setEnvironment=value=>environments.push(value);runtime.setRenderStyle=value=>styles.push(value);receive({character:{id:'a',modelId:'',presentation:{scene:'beach',timeOfDay:'evening',renderStyle:'toon',daylightLocation:{latitude:35,longitude:139}}},preferences:{bubbleLanguage:'ja'},reply:{zh:'当前视觉回复',ja:''}});h.render();await h.settle();assert.deepEqual(environments.at(-1),{id:'beach',timeOfDay:{kind:'solar',elevation:40,hourAngle:0}});assert.equal(styles.at(-1),'toon');const walk=node=>!node?[]:Array.isArray(node)?node.flatMap(walk):typeof node==='object'?[node,...walk(node.props?.children)]:[];assert.equal(walk(h.tree).find(n=>n.props?.className==='model-reply').props.children,'中文：当前视觉回复')});
