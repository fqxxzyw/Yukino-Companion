const assert=require('node:assert/strict');
const test=require('node:test');

const id=`custom-${'a'.repeat(64)}`;
const obj='o triangle\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3';
const ply='ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 0 0\n1 0 0\n0 1 0\n';
const stl='solid triangle\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid triangle';
function asset(extension,content){return {extension,data:typeof content==='string'?Buffer.from(content):content};}
function triangleGltf(uri){return {
 asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],
 buffers:[{byteLength:36,...(uri===undefined?{}:{uri})}],bufferViews:[{buffer:0,byteLength:36}],
 accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,0]}]
};}
const triangle=Buffer.from(new Float32Array([0,0,0,1,0,0,0,1,0]).buffer);
function binaryTriangle(){
 const source=JSON.stringify(triangleGltf());
 const json=Buffer.from(source.padEnd(Math.ceil(source.length/4)*4));
 const bytes=Buffer.alloc(28+json.length+triangle.length);
 bytes.write('glTF');bytes.writeUInt32LE(2,4);bytes.writeUInt32LE(bytes.length,8);
 bytes.writeUInt32LE(json.length,12);bytes.write('JSON',16);json.copy(bytes,20);
 bytes.writeUInt32LE(triangle.length,20+json.length);bytes.write('BIN\0',24+json.length);triangle.copy(bytes,28+json.length);
 return bytes;
}

test('imported objects load through the scene registry and get finite, normalized framing',async()=>{
 const T=await import('three'),{loadSceneFactory}=await import('../src/scenes/registry.mjs');
 const {validateImportedScene}=await import('../src/scenes/imported-scene.mjs');
 const original=new T.Scene();original.add(new T.Mesh(new T.BoxGeometry(1,2,3),new T.MeshStandardMaterial()));
 const json=JSON.stringify(original.toJSON());
 const oldWindow=globalThis.window,oldProgressEvent=globalThis.ProgressEvent;let input;
 globalThis.window={desktop:{sceneRead:async value=>{assert.equal(value,id);return input;}}};
 globalThis.ProgressEvent??=class ProgressEvent extends Event{constructor(type,details){super(type);Object.assign(this,details);}};
 try{
  const create=await loadSceneFactory(id);
  for(const [format,source] of [['obj',obj],['stl',stl],['ply',ply],['json',json],['js',`export default ${json};`],['mjs',json],['glb',binaryTriangle()],['gltf',JSON.stringify(triangleGltf(`data:application/octet-stream;base64,${triangle.toString('base64')}`))]]){
   input=asset(format,source);await validateImportedScene(id);
   const scene=new T.Scene(),renderer={toneMappingExposure:3},result=await create({scene,renderer});
   assert.equal(Math.max(...result.bounds.getSize(new T.Vector3())),10,format);
   assert.ok(result.bounds.getCenter(new T.Vector3()).length()<1e-8,format);
   assert.equal(result.root.children[0].isPoints===true,format==='ply');
   assert.equal(renderer.toneMappingExposure,1);
   result.dispose();
  }
 }finally{globalThis.window=oldWindow;globalThis.ProgressEvent=oldProgressEvent;}
});

test('scene import accepts declarative JavaScript data and rejects executable or external content',async()=>{
 const {validateImportedScene}=await import('../src/scenes/imported-scene.mjs');
 const oldWindow=globalThis.window;let input;
 globalThis.window={desktop:{sceneRead:async()=>input}};
 try{
  input=asset('js','export default (() => { throw Error("executed"); })()');
  await assert.rejects(validateImportedScene(id),/仅接受/);
  input=asset('gltf',JSON.stringify(triangleGltf('https://example.com/model.bin')));
  await assert.rejects(validateImportedScene(id),/外部资源/);
  input=asset('json',JSON.stringify({object:{type:'Scene'},images:[{url:'file:///tmp/image.png'}]}));
  await assert.rejects(validateImportedScene(id),/外部资源/);
  input=asset('obj','o empty');
  await assert.rejects(validateImportedScene(id),/没有可显示的几何体/);
 }finally{globalThis.window=oldWindow;}
});
