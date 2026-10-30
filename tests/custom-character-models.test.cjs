const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {CharacterModelStore,inspectGlb,MAX_BYTES}=require('../electron/character-models.cjs');
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
function glb(json,bin){const encoded=Buffer.from(JSON.stringify(json)),jsonSize=Math.ceil(encoded.length/4)*4,binSize=Math.ceil(bin.length/4)*4,result=Buffer.alloc(28+jsonSize+binSize);result.writeUInt32LE(0x46546c67,0);result.writeUInt32LE(2,4);result.writeUInt32LE(result.length,8);result.writeUInt32LE(jsonSize,12);result.writeUInt32LE(0x4e4f534a,16);result.fill(0x20,20,20+jsonSize);encoded.copy(result,20);result.writeUInt32LE(binSize,20+jsonSize);result.writeUInt32LE(0x004e4942,24+jsonSize);bin.copy(result,28+jsonSize);return result;}
function fixture({rigged=true,morph=false,animation=false,extraWeights=false,sparse=false}={}){
 const parts=[],json={asset:{version:'2.0'},buffers:[{byteLength:0}],bufferViews:[],accessors:[],meshes:[],nodes:[],scenes:[{nodes:[0]}],scene:0};let length=0;
 const add=(values,type,componentType=5126)=>{const alignment=(4-length%4)%4;if(alignment){parts.push(Buffer.alloc(alignment));length+=alignment;}const componentBytes={5121:1,5123:2,5126:4}[componentType],buffer=Buffer.alloc(values.length*componentBytes);values.forEach((value,index)=>componentType===5126?buffer.writeFloatLE(value,index*4):componentType===5123?buffer.writeUInt16LE(value,index*2):buffer.writeUInt8(value,index));const view=json.bufferViews.push({buffer:0,byteOffset:length,byteLength:buffer.length})-1;parts.push(buffer);length+=buffer.length;const size={SCALAR:1,VEC3:3,VEC4:4,MAT4:16}[type];return json.accessors.push({bufferView:view,componentType,count:values.length/size,type})-1;};
 const position=add([0,0,0,0,1,0,1,0,0],'VEC3'),attributes={POSITION:position};json.accessors[position].min=[0,0,0];json.accessors[position].max=[1,1,0];
 if(rigged){attributes.JOINTS_0=add(Array(12).fill(0),'VEC4',5121);attributes.WEIGHTS_0=add([1,0,0,0,1,0,0,0,1,0,0,0],'VEC4');}
 if(extraWeights){attributes.JOINTS_1=add(Array(12).fill(0),'VEC4',5121);attributes.WEIGHTS_1=add([.5,0,0,0,.5,0,0,0,.5,0,0,0],'VEC4');const item=json.accessors[attributes.WEIGHTS_0],view=json.bufferViews[item.bufferView];const target=parts.find((_part,index)=>parts.slice(0,index).reduce((sum,b)=>sum+b.length,0)===view.byteOffset);for(let i=0;i<3;i++)target.writeFloatLE(.5,i*16);}
 const primitive={attributes,indices:add([0,1,2],'SCALAR',5123)};json.meshes=[{primitives:[primitive]}];json.nodes=[{mesh:0}];
 if(rigged){json.nodes[0].skin=0;json.nodes[0].children=[1];json.nodes.push({name:'ActualJoint'});const inverse=add([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],'MAT4');json.skins=[{joints:[1],skeleton:1,inverseBindMatrices:inverse}];}
 if(morph){const target=add([0,0,0,0,.02,0,0,0,0],'VEC3');json.accessors[target].min=[0,0,0];json.accessors[target].max=[0,.02,0];primitive.targets=[{POSITION:target}];json.meshes[0].extras={targetNames:['user_mouth']};}
 if(sparse){const sparseIndices=add([1],'SCALAR',5121),sparseValues=add([0,.02,0],'VEC3'),accessor={componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[0,.02,0],sparse:{count:1,indices:{bufferView:json.accessors[sparseIndices].bufferView,componentType:5121},values:{bufferView:json.accessors[sparseValues].bufferView}}};primitive.targets=[{POSITION:json.accessors.push(accessor)-1}];json.meshes[0].extras={targetNames:['sparse_mouth']};}
 if(animation){const input=add([0,1],'SCALAR'),output=add([0,0,0,0,.05,0],'VEC3');json.animations=[{name:'UserMotion',samplers:[{input,output}],channels:[{sampler:0,target:{node:rigged?1:0,path:'translation'}}]}];}
 json.buffers[0].byteLength=length;const bin=Buffer.concat(parts);return {json,bin,data:glb(json,bin),add};
}
async function temporary(t,options={}){const root=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-custom-model-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const value=fixture(options),file=path.join(root,'User.glb');await fs.writeFile(file,value.data);const timers=new Map();let now=1000;const store=new CharacterModelStore({dataRoot:root,builtinRoot:path.join(root,'builtins'),builtins:{schemaVersion:1,models:[]},now:()=>now,setTimer:callback=>{const id={unref(){}};timers.set(id,callback);return id;},clearTimer:id=>timers.delete(id)});return {root,file,store,timers,...value,advance(ms){now+=ms;for(const callback of [...timers.values()])callback();}};}

test('inspector reports actual weighted skin, bones, morphs and existing clips without invented mappings',()=>{
 const f=fixture({morph:true,animation:true}),result=inspectGlb(f.data);assert.equal(result.usableSkin,true);assert.equal(result.bones,1);assert.equal(result.skins,1);assert.equal(result.skinnedMeshes,1);assert.equal(result.weightedVertices,3);assert.equal(result.morphs,1);assert.deepEqual(result.morphNames,['user_mouth']);assert.equal(result.animations,1);assert.equal(result.clips.UserMotion.duration,1);assert.deepEqual(result.allowedModes,['rigged']);assert.equal(result.sha256,hash(f.data));
});
test('bone-less meshes offer explicit static import and never acquire copied or fake bones',()=>{
 const result=inspectGlb(fixture({rigged:false}).data);assert.equal(result.usableSkin,false);assert.equal(result.bones,0);assert.equal(result.skins,0);assert.deepEqual(result.allowedModes,['static']);assert.match(result.warnings.join(' '),/真实|实际绑定/);
});
test('valid sparse morph data is inspected with exact sparse index/value bounds',()=>{
 const f=fixture({sparse:true});assert.deepEqual(inspectGlb(f.data).morphNames,['sparse_mouth']);const sparse=f.json.accessors.at(-1).sparse;sparse.values.byteOffset=100;assert.throws(()=>inspectGlb(glb(f.json,f.bin)),/稀疏/);
});
test('eight-weight models are diagnosed but not silently truncated by the four-weight renderer',()=>{
 const result=inspectGlb(fixture({extraWeights:true}).data);assert.equal(result.usableSkin,true);assert.equal(result.additionalInfluences,true);assert.deepEqual(result.allowedModes,[]);assert.match(result.warnings.join(' '),/四个以上/);
});
test('external buffer/image URIs and unsupported decoder extensions never reach a renderer',()=>{
 for(const mutate of [json=>json.buffers[0].uri='https://private.example/model.bin',json=>json.images=[{uri:'file:///private/image.png'}],json=>json.images=[{uri:'../private.png'}],json=>json.extensionsUsed=['KHR_draco_mesh_compression']]){const f=fixture();mutate(f.json);assert.throws(()=>inspectGlb(glb(f.json,f.bin)),/URI|扩展/);}
});
test('malformed GLB lengths, JSON, BIN chunks and reference shapes are rejected',()=>{
 const f=fixture();for(const mutate of [data=>data.writeUInt32LE(3,4),data=>data.writeUInt32LE(data.length+4,8),data=>data.writeUInt32LE(0,16),data=>data.writeUInt32LE(0,24+data.readUInt32LE(12)),data=>data.fill(0,20,24)]){const data=Buffer.from(f.data);mutate(data);assert.throws(()=>inspectGlb(data),/GLB|JSON/);}
 const bad=fixture();bad.json.nodes=[null];assert.throws(()=>inspectGlb(glb(bad.json,bad.bin)),/无效/);
});
test('buffer views, accessors, indices and cyclic node trees are validated before import',()=>{
 for(const mutate of [json=>json.bufferViews[0].byteLength+=100000,json=>json.accessors[0].count=100000,json=>json.meshes[0].primitives[0].attributes.POSITION=99,json=>json.nodes[1].children=[0],json=>json.meshes[0].primitives[0].indices=999]){const f=fixture();mutate(f.json);assert.throws(()=>inspectGlb(glb(f.json,f.bin)),/越界|无效|循环/);}
 const f=fixture(),index=f.json.accessors[f.json.meshes[0].primitives[0].indices],view=f.json.bufferViews[index.bufferView];f.bin.writeUInt16LE(999,view.byteOffset);assert.throws(()=>inspectGlb(glb(f.json,f.bin)),/三角索引/);
});
test('invalid joint references, missing or zero weights and unusable bind matrices are rejected',()=>{
 for(const mutate of [json=>json.skins[0].joints=[99],json=>json.nodes[0].skin=99,json=>delete json.meshes[0].primitives[0].attributes.WEIGHTS_0]){const f=fixture();mutate(f.json);assert.throws(()=>inspectGlb(glb(f.json,f.bin)),/骨骼|蒙皮/);}
 for(const semantic of ['JOINTS_0','WEIGHTS_0','inverse']){const f=fixture(),index=semantic==='inverse'?f.json.skins[0].inverseBindMatrices:f.json.meshes[0].primitives[0].attributes[semantic],view=f.json.bufferViews[f.json.accessors[index].bufferView];if(semantic==='JOINTS_0')f.bin.writeUInt8(9,view.byteOffset);else f.bin.fill(0,view.byteOffset,view.byteOffset+view.byteLength);assert.throws(()=>inspectGlb(glb(f.json,f.bin)),/骨骼索引|零权重|不可逆/);}
});
test('nonfinite geometry and excessive vertex counts are rejected',()=>{
 const f=fixture({rigged:false});f.bin.writeFloatLE(NaN,0);assert.throws(()=>inspectGlb(glb(f.json,f.bin)),/浮点/);
 const count=500001,bin=Buffer.alloc(count*12),json={asset:{version:'2.0'},buffers:[{byteLength:bin.length}],bufferViews:[{buffer:0,byteLength:bin.length}],accessors:[{bufferView:0,componentType:5126,count,type:'VEC3',min:[0,0,0],max:[0,0,0]}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],nodes:[{mesh:0}],scenes:[{nodes:[0]}]};assert.throws(()=>inspectGlb(glb(json,bin)),/50 万/);
});
test('texture dimensions are bounded before any image decoding',()=>{
 const f=fixture(),png=Buffer.alloc(33);Buffer.from('89504e470d0a1a0a','hex').copy(png);png.write('IHDR',12);png.writeUInt32BE(99999,16);png.writeUInt32BE(99999,20);f.json.images=[{uri:'data:image/png;base64,'+png.toString('base64')}];assert.throws(()=>inspectGlb(glb(f.json,f.bin)),/纹理宽度/);
});
test('inspection creates no registered files and explicit confirmation persists only hash-named bytes',async t=>{
 const f=await temporary(t,{morph:true,animation:true}),inspection=await f.store.inspectFile(f.file);assert.equal((await f.store.catalog()).models.length,0);await assert.rejects(fs.access(path.join(f.root,'character-models')));
 await assert.rejects(f.store.confirm({token:inspection.token,mode:'rigged'}),/确认/);
 const entry=await f.store.confirm({token:inspection.token,confirm:true,mode:'rigged',label:'我的模型'});assert.equal(entry.id,'custom-'+hash(f.data));assert.equal(entry.label,'我的模型');assert.equal(entry.mouth,null);assert.equal(entry.blink,false);assert.equal(entry.defaultClip,'');assert.deepEqual(Buffer.from(await f.store.read(entry.id)),f.data);assert.equal(f.store.pending,null);assert.equal(f.timers.size,0);
 const files=await fs.readdir(path.join(f.root,'character-models'));assert.deepEqual(files.sort(),[hash(f.data)+'.glb','custom-models.json'].sort());await assert.rejects(f.store.confirm({token:inspection.token,confirm:true,mode:'rigged'}),/过期|取消/);
});
test('bone-less import requires static mode; registered model preserves exact bytes and zero bones',async t=>{
 const f=await temporary(t,{rigged:false}),inspection=await f.store.inspectFile(f.file);await assert.rejects(f.store.confirm({token:inspection.token,confirm:true,mode:'rigged'}),/真实蒙皮/);
 const entry=await f.store.confirm({token:inspection.token,confirm:true,mode:'static'});assert.equal(entry.importMode,'static');assert.equal(entry.diagnostics.bones,0);assert.deepEqual(entry.clips,{});assert.equal(entry.sha256,hash(f.data));
});
test('registry survives restart; arbitrary ids and changed stored GLB bytes cannot be read',async t=>{
 const f=await temporary(t),inspection=await f.store.inspectFile(f.file),entry=await f.store.confirm({token:inspection.token,confirm:true,mode:'rigged'}),reloaded=new CharacterModelStore({dataRoot:f.root,builtinRoot:path.join(f.root,'builtins'),builtins:{models:[]}});
 assert.equal((await reloaded.catalog()).models[0].id,entry.id);await assert.rejects(reloaded.read('../private'),/登记|标识/);await assert.rejects(reloaded.read('custom-'+('f'.repeat(64))),/登记/);const file=path.join(f.root,'character-models',entry.sha256+'.glb'),damaged=Buffer.from(f.data);damaged[damaged.length-1]^=1;await fs.writeFile(file,damaged);await assert.rejects(reloaded.read(entry.id),/完整性/);
});
test('cancel and expiry clear inspection bytes and reject stale confirmation',async t=>{
 const f=await temporary(t);let inspected=await f.store.inspectFile(f.file),bytes=f.store.pending.data;f.store.cancel();assert.ok(bytes.every(value=>value===0));await assert.rejects(f.store.confirm({token:inspected.token,confirm:true,mode:'rigged'}),/过期|取消/);
 inspected=await f.store.inspectFile(f.file);bytes=f.store.pending.data;f.advance(300001);assert.equal(f.store.pending,null);assert.ok(bytes.every(value=>value===0));await assert.rejects(f.store.confirm({token:inspected.token,confirm:true,mode:'rigged'}),/过期|取消/);
});
test('cancelled asynchronous inspection cannot overwrite a newer pending selection',async t=>{
 const f=await temporary(t),old=f.store.inspectFile(f.file),oldRejected=assert.rejects(old,/取消/);f.store.cancel();const next=await f.store.inspectFile(f.file);await oldRejected;assert.equal(f.store.pending.token,next.token);f.store.cancel();
});
test('oversized source files and symlinks are rejected without reading or writing model bytes',async t=>{
 const f=await temporary(t),oversized=path.join(f.root,'TooLarge.glb'),handle=await fs.open(oversized,'w');await handle.truncate(MAX_BYTES+1);await handle.close();await assert.rejects(f.store.inspectFile(oversized),/限制/);
 const link=path.join(f.root,'Link.glb');try{await fs.symlink(f.file,link);}catch(error){if(error.code==='EPERM')return t.skip('Windows symlink privilege unavailable');throw error;}await assert.rejects(f.store.inspectFile(link),/符号链接/);assert.equal((await f.store.catalog()).models.length,0);
});
test('fixed built-in models retain their pinned import and read contract',async t=>{
 const f=await temporary(t),entry={id:'builtin-test',label:'Known fixture',ready:true,url:'./characters/Test.glb',bytes:f.data.length,sha256:hash(f.data)};f.store.builtins={models:[entry]};await f.store.importBuiltin(entry.id,f.file);assert.deepEqual(Buffer.from(await f.store.read(entry.id)),f.data);assert.equal((await f.store.catalog()).models.length,1);
 const wrong=path.join(f.root,'Wrong.glb');await fs.writeFile(wrong,Buffer.alloc(f.data.length));await assert.rejects(f.store.importBuiltin(entry.id,wrong),/完整性/);assert.deepEqual(Buffer.from(await f.store.read(entry.id)),f.data);
});
test('all released ready character assets pass the same structural inspector without fake rig repair',async()=>{
 const catalog=require('../resources/character-models.json');for(const entry of catalog.models.filter(model=>model.ready)){const data=await fs.readFile(path.join(__dirname,'../public',entry.url.slice(2))),inspection=inspectGlb(data);assert.equal(inspection.usableSkin,true,entry.id);assert.equal(inspection.bones,55,entry.id);assert.deepEqual(inspection.allowedModes,['rigged']);}
});
test('main model IPC and preload expose only picker/registered-id paths to renderers',async()=>{
 const {mainHarness}=require('./helpers/main-harness.cjs'),app=await mainHarness({state:{profiles:[],conversations:[]}});
 for(const channel of ['character-model-catalog','character-model-inspect','character-model-confirm','character-model-cancel','character-model-data'])assert.ok(app.handlers.has(channel));
 assert.equal(await app.invoke('character-model-inspect'),null);assert.equal(await app.invoke('character-model-cancel'),true);await assert.rejects(app.invoke('character-model-data','../../private'),/登记|标识/);await assert.rejects(app.handlers.get('character-model-catalog')({sender:{},senderFrame:{}}),/不允许/);
});

test('malformed custom registry is preserved rather than replaced during later inspection/confirmation',async t=>{
 const f=await temporary(t),root=path.join(f.root,'character-models');await fs.mkdir(root);const registry=path.join(root,'custom-models.json');await fs.writeFile(registry,'BROKEN_USER_REGISTRY');await assert.rejects(f.store.catalog(),/损坏/);const inspection=await f.store.inspectFile(f.file);await assert.rejects(f.store.confirm({token:inspection.token,confirm:true,mode:'rigged'}),/损坏/);assert.equal(await fs.readFile(registry,'utf8'),'BROKEN_USER_REGISTRY');
});
test('a symlinked model directory cannot redirect writes outside the managed store',async t=>{
 const f=await temporary(t),outside=path.join(f.root,'keep-outside');await fs.mkdir(outside);try{await fs.symlink(outside,path.join(f.root,'character-models'),'dir');}catch(error){if(error.code==='EPERM')return t.skip('Windows symlink privilege unavailable');throw error;}
 await assert.rejects(f.store.catalog(),/普通目录/);const inspection=await f.store.inspectFile(f.file);await assert.rejects(f.store.confirm({token:inspection.token,confirm:true,mode:'rigged'}),/普通目录/);assert.deepEqual(await fs.readdir(outside),[]);
});
test('cancel immediately after confirmation starts prevents registration or later token reuse',async t=>{
 const f=await temporary(t),inspection=await f.store.inspectFile(f.file),pending=f.store.confirm({token:inspection.token,confirm:true,mode:'rigged'});f.store.cancel();await assert.rejects(pending,/取消/);assert.equal((await f.store.catalog()).models.length,0);await assert.rejects(f.store.confirm({token:inspection.token,confirm:true,mode:'rigged'}),/过期|取消/);
});
test('reimport of identical bytes is idempotent by hash, not a new pathname or duplicate registry entry',async t=>{
 const f=await temporary(t);let inspection=await f.store.inspectFile(f.file);const first=await f.store.confirm({token:inspection.token,confirm:true,mode:'rigged',label:'First'});inspection=await f.store.inspectFile(f.file);const second=await f.store.confirm({token:inspection.token,confirm:true,mode:'rigged',label:'Renamed'});assert.equal(first.id,second.id);assert.equal((await f.store.catalog()).models.length,1);assert.equal((await f.store.catalog()).models[0].label,'Renamed');assert.equal((await fs.readdir(path.join(f.root,'character-models'))).filter(name=>name.endsWith('.glb')).length,1);
});

test('accepted synthetic rigged/static GLBs parse in the actual Three loader without adding bones',async()=>{
 const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');
 for(const rigged of [true,false]){const f=fixture({rigged,morph:true,animation:true}),diagnostics=inspectGlb(f.data),gltf=await new GLTFLoader().parseAsync(f.data.buffer.slice(f.data.byteOffset,f.data.byteOffset+f.data.byteLength),'');let bones=0,skinned=0;gltf.scene.traverse(item=>{if(item.isBone)bones++;if(item.isSkinnedMesh){skinned++;assert.equal(item.geometry.attributes.skinWeight.count,3);assert.equal(item.skeleton.bones.length,1);}});assert.equal(bones,diagnostics.bones);assert.equal(skinned,rigged?1:0);assert.equal(gltf.animations.length,1);}
});

test('packaged ASAR built-ins tolerate virtual inode differences but still verify bytes; imports stay strict',async t=>{
 const f=await temporary(t),root=path.join(f.root,'packaged-resources'),directory=path.join(root,'app.asar','dist','characters'),file=path.join(directory,'fixture.glb');
 await fs.mkdir(directory,{recursive:true});await fs.writeFile(file,f.data);
 const entry={id:'builtin-asar-fixture',ready:true,url:'./characters/fixture.glb',bytes:f.data.length,sha256:require('node:crypto').createHash('sha256').update(f.data).digest('hex')};
 const store=new CharacterModelStore({dataRoot:path.join(f.root,'data'),builtinRoot:path.join(root,'app.asar','dist'),builtins:{models:[entry]}});
 const oldLstat=fs.lstat,oldResources=process.resourcesPath,oldElectron=Object.getOwnPropertyDescriptor(process.versions,'electron');
 Object.defineProperty(process.versions,'electron',{value:'test-electron',configurable:true});process.resourcesPath=root;
 fs.lstat=async function(name,...args){const stat=await oldLstat.call(this,name,...args);return path.resolve(name)===file?new Proxy(stat,{get(target,key,receiver){return key==='ino'?target.ino+1:Reflect.get(target,key,receiver)}}):stat;};
 try{
  assert.deepEqual(Buffer.from(await store.read(entry.id)),f.data);
  await assert.rejects(store.inspectFile(file),/文件在检查时发生变化/);
  process.resourcesPath=path.join(root,'wrong-root');await assert.rejects(store.read(entry.id),/文件在检查时发生变化/);
  process.resourcesPath=root;const altered=Buffer.from(f.data);altered[altered.length-1]^=1;await fs.writeFile(file,altered);
  await assert.rejects(store.read(entry.id),/完整性检查失败/);
 }finally{fs.lstat=oldLstat;process.resourcesPath=oldResources;if(oldElectron)Object.defineProperty(process.versions,'electron',oldElectron);else delete process.versions.electron;}
});
