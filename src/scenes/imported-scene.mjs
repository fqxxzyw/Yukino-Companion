import * as THREE from 'three';

const text=new TextDecoder('utf-8',{fatal:true});
const inlineImage=/^data:image\/(?:png|jpeg|webp|bmp|gif|tiff);base64,/i;
const inlineBuffer=/^data:application\/(?:octet-stream|gltf-buffer);base64,/i;
const fallbackImage='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9axC8gQAAAABJRU5ErkJggg==';
const externalAsset=()=>Error('场景包含外部资源，请将纹理和缓冲数据内嵌后重新导出。');

function gltfInlineUrl(uri,pattern,urls){
 const prefix=pattern.exec(uri)?.[0];
 if(!prefix)throw externalAsset();
 // Three fetches glTF buffers and, depending on the browser, textures. Blob
 // URLs work under the app CSP without enabling data URLs for network fetches.
 const data=atob(uri.slice(prefix.length));
 const bytes=Uint8Array.from(data,character=>character.charCodeAt(0));
 const url=URL.createObjectURL(new Blob([bytes],{type:prefix.slice(5,-8)}));
 urls.add(url);
 return url;
}

async function gltfObject(bytes,extension){
 const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');
 const urls=new Set();
 const manager=new THREE.LoadingManager().setURLModifier(url=>{
  // The parser makes Blob URLs for embedded binary textures.
  if(url.startsWith('blob:'))return url;
  throw externalAsset();
 });
 const loader=new GLTFLoader(manager);
 loader.register(({json})=>{
  for(const [resources,pattern] of [[json.buffers,inlineBuffer],[json.images,inlineImage]]){
   for(const resource of resources||[]){
    if(resource.uri!==undefined){
     if(typeof resource.uri!=='string')throw externalAsset();
     resource.uri=gltfInlineUrl(resource.uri,pattern,urls);
    }
   }
  }
  let values=0;
  for(const {count,type} of json.accessors||[]){
   values+=count*({SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16}[type]||0);
   if(!Number.isSafeInteger(count)||count<0||count>4_000_000||values>48_000_000)throw Error('场景几何数据过大或无效。');
  }
  return {name:'YukinoEmbeddedScene'};
 });
 try{
  const {scene,scenes,animations}=await loader.parseAsync(extension==='glb'?bytes:text.decode(bytes),'');
  if(!scene)throw Error('glTF 文件没有可显示的场景。');
  return {object:scene,animations,owned:scenes};
 }finally{for(const url of urls)URL.revokeObjectURL(url)}
}

async function fbxObject(bytes){
 const {FBXLoader}=await import('three/addons/loaders/FBXLoader.js');
 const urls=new Set(),manager=new THREE.LoadingManager();
 manager.setURLModifier(url=>{
  // FBXLoader creates Blob URLs for embedded binary textures. Replace paths
  // to separate files with a white pixel, preserving the authored base color.
  if(url.startsWith('blob:')){urls.add(url);return url;}
  return inlineImage.test(url)?url:fallbackImage;
 });
 const loaded=new Promise(resolve=>{manager.onLoad=resolve;});
 manager.itemStart('fbx');
 try{
  const object=new FBXLoader(manager).parse(bytes,'');
  manager.itemEnd('fbx');
  await loaded;
  return {object,animations:object.animations};
 }finally{for(const url of urls)URL.revokeObjectURL(url)}
}

async function threeObject(bytes,extension){
 let source=text.decode(bytes).trim();
 if(extension!=='json')source=source.replace(/^export\s+default\s+(?=\{)/,'').replace(/;\s*$/,'');
 let data;
 try{data=JSON.parse(source)}catch{throw Error('请选择 Three.js Object/Scene JSON。JS 和 MJS 仅接受导出该 JSON 的数据文件。');}
 if(!data?.object||typeof data.object.type!=='string')throw Error('请使用 Three.js 的 Object/Scene JSON 导出格式。');
 for(const image of data.images||[]){
  for(const url of [image.url].flat())if(typeof url==='string'&&!inlineImage.test(url))throw externalAsset();
 }
 if(data.materials?.some(material=>/ShaderMaterial$/.test(material.type)))throw Error('Three.js 场景需要使用内置材质。');
 for(const geometry of data.geometries||[]){
  for(const [key,value] of Object.entries(geometry)){
   if(/segments$/i.test(key)&&(!Number.isFinite(value)||value<0||value>512))throw Error('场景几何分段数过大或无效。');
  }
  if(geometry.detail>5)throw Error('场景几何细分过多。');
 }
 const pending=[data.object];
 const boundedCount=(count,max)=>Number.isSafeInteger(count)&&count>=0&&count<=max;
 for(let i=0;i<pending.length;i++){
  const object=pending[i];
  if(pending.length>20_000||object.type==='InstancedMesh'&&!boundedCount(object.count,50_000)
    ||object.type==='BatchedMesh'&&(!boundedCount(object.maxInstanceCount,50_000)||!boundedCount(object.maxVertexCount,4_000_000)||!boundedCount(object.maxIndexCount,12_000_000)))throw Error('场景对象过多或无效。');
  for(const child of object.children||[])pending.push(child);
 }
 const manager=new THREE.LoadingManager().setURLModifier(url=>{
  if(inlineImage.test(url))return url;
  throw externalAsset();
 });
 const object=await new THREE.ObjectLoader(manager).parseAsync(data);
 return {object,animations:object.animations};
}

async function parseImported({data,extension}){
 const bytes=ArrayBuffer.isView(data)?data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength):data;
 if(!(bytes instanceof ArrayBuffer)||!bytes.byteLength)throw Error('场景文件为空或无法读取。');
 const format=extension?.toLowerCase().replace(/^\./,'');
 switch(format){
  case 'glb':
  case 'gltf':return gltfObject(bytes,format);
  case 'fbx':return fbxObject(bytes);
  case 'json':
  case 'js':
  case 'mjs':return threeObject(bytes,format);
  case 'obj':{
   const {OBJLoader}=await import('three/addons/loaders/OBJLoader.js');
   return {object:new OBJLoader().parse(text.decode(bytes))};
  }
  case 'stl':{
   const {STLLoader}=await import('three/addons/loaders/STLLoader.js');
   const header=new DataView(bytes);
   const isAscii=/^[\s\S]{0,4}solid/.test(new TextDecoder('latin1').decode(bytes.slice(0,9)));
   if(bytes.byteLength<84||(!isAscii&&84+50*header.getUint32(80,true)!==bytes.byteLength))throw Error('STL 文件格式无效。');
   const geometry=new STLLoader().parse(bytes);
   return {object:geometryObject(geometry)};
  }
  case 'ply':{
   const {PLYLoader}=await import('three/addons/loaders/PLYLoader.js');
   const geometry=new PLYLoader().parse(bytes);
   // A vertex-only PLY is a point cloud. Three vertices alone do not imply a face.
   const header=new TextDecoder().decode(bytes.slice(0,65_536)).split(/\r?\nend_header\b/,1)[0];
   return {object:geometryObject(geometry,!/^element\s+face\s+[1-9]\d*\s*$/m.test(header))};
  }
  default:throw Error('此场景文件格式暂不支持。');
 }
}

function geometryObject(geometry,points=false){
 const vertexColors=geometry.hasAttribute('color');
 if(points)return new THREE.Points(geometry,new THREE.PointsMaterial({vertexColors,color:vertexColors?0xffffff:0xd8e6f1,size:.06}));
 if(!geometry.hasAttribute('normal'))geometry.computeVertexNormals();
 return new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors,color:vertexColors?0xffffff:0xd8dfe7,side:THREE.DoubleSide}));
}

function disposeObjects(roots,scene){
 const assets=new Set(),textures=new Set([scene?.background,scene?.environment].filter(value=>value?.isTexture));
 for(const root of roots){
  if(root?.isScene)for(const value of [root.background,root.environment])if(value?.isTexture)textures.add(value);
  root?.traverse(node=>{
   if(node.geometry&&!node.isBatchedMesh)assets.add(node.geometry);
   if(node.isBatchedMesh||node.isInstancedMesh)assets.add(node);
   if(node.skeleton)assets.add(node.skeleton);
   if(node.shadow)assets.add(node.shadow);
   for(const material of [node.material].flat().filter(Boolean)){
    assets.add(material);
    for(const value of Object.values(material))if(value?.isTexture)textures.add(value);
   }
  });
 }
 const bitmaps=new Set();
 for(const texture of textures){
  texture.dispose();
  for(const image of [texture.image].flat())if(typeof image?.close==='function')bitmaps.add(image);
 }
 for(const bitmap of bitmaps)bitmap.close();
 for(const asset of assets)asset.dispose();
}

async function readImported(id){
 const read=globalThis.window?.desktop?.sceneRead;
 if(!read)throw Error('请在桌面应用中打开自定义场景。');
 const loaded=await parseImported(await read(id));
 const {object,owned=[object]}=loaded;
 try{
  let hasGeometry=false;
  object.traverseVisible(node=>{if(node.geometry?.getAttribute('position')?.count>0)hasGeometry=true;});
  const bounds=new THREE.Box3().setFromObject(object),size=bounds.getSize(new THREE.Vector3());
  const center=bounds.min.clone().addScaledVector(size,.5),factor=10/(Math.max(...size)||1);
  if(!hasGeometry||bounds.isEmpty()||![...size,...center.clone().multiplyScalar(factor),factor].every(Number.isFinite))throw Error('场景没有可显示的几何体，或场景尺寸无效。');
  return {...loaded,owned,bounds,center,factor};
 }catch(error){disposeObjects(owned);throw error;}
}

export async function validateImportedScene(id){
 const {owned}=await readImported(id);
 disposeObjects(owned);
}

export async function createImportedScene(id,{scene,renderer}){
 const {object,owned,bounds,center,factor,animations=[]}=await readImported(id);
 const root=new THREE.Group();
 // Normalize units and origin so millimetre exports, GIS coordinates and tiny
 // models fit the same camera controls while preserving their proportions.
 root.scale.setScalar(factor);root.position.copy(center).multiplyScalar(-factor);root.add(object);
 bounds.translate(center.negate());bounds.min.multiplyScalar(factor);bounds.max.multiplyScalar(factor);
 let hasLights=false;
 object.traverseVisible(node=>{
  if(node.isLight&&node.intensity>0)hasLights=true;
 });
 if(!hasLights){
  const key=new THREE.DirectionalLight('#fff2df',2.2);
  key.position.set(5,8,6);
  scene.add(key,new THREE.HemisphereLight('#e8f3ff','#837e75',1.8));
 }
 scene.background=object.background||new THREE.Color('#283849');
 scene.environment=object.environment||null;
 scene.fog=object.fog||null;
 renderer.toneMappingExposure=1;
 const mixer=animations.length?new THREE.AnimationMixer(object):null;
 if(mixer)mixer.clipAction(animations[0]).play();
 return {root,bounds,fixedLighting:true,update:dt=>mixer?.update(dt),dispose(){
  mixer?.stopAllAction();mixer?.uncacheRoot(object);disposeObjects(owned,scene);scene.background=null;scene.environment=null;
 }};
}
