// Focused real-WebGL extraction/lifecycle test. Run with node scripts/test-four-scenes.cjs.
const path = require('node:path');
const { spawn } = require('node:child_process');

const browserTest = `
import * as THREE from 'three';
import {createScene as convenience} from '/src/scenes/convenience.mjs';
import {createScene as classroom} from '/src/scenes/classroom.mjs';
import {createScene as bookshop} from '/src/scenes/bookshop.mjs';
import {createScene as forest} from '/src/scenes/forest.mjs';
export async function run() {
 const results=[];
 const errors=[];
 const originalError=console.error;
 console.error=(...args)=>{errors.push(args.map(String).join(' '));originalError(...args);};
 const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
 renderer.setSize(768,512); renderer.setPixelRatio(1);
 renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
 renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;
 renderer.debug.onShaderError=(gl,program,vs,fs)=>{errors.push('Shader error: '+gl.getProgramInfoLog(program)+' '+gl.getShaderInfoLog(vs)+' '+gl.getShaderInfoLog(fs));};
 document.body.appendChild(renderer.domElement);
 const ensure=(condition,message)=>{if(!condition)throw Error(message);};
 for(const [id,factory] of Object.entries({convenience,classroom,bookshop,forest})) {
  const start=performance.now();
  const scene=new THREE.Scene();
  const background=new THREE.Color('#123456');const fog=new THREE.Fog('#111111',1,100);
  scene.background=background;scene.fog=fog;
  const fixture=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());fixture.position.set(1000,0,0);scene.add(fixture);
  let fixtureDisposed=false;fixture.geometry.addEventListener('dispose',()=>{fixtureDisposed=true;});
  const originalExposure=renderer.toneMappingExposure;
  const originalShadow=renderer.shadowMap.type;const originalToneMapping=renderer.toneMapping;
  const api=factory({scene,renderer});
  ensure(api.root?.isGroup,id+' missing root');ensure(api.root.parent===scene,id+' root not attached');
  ensure(api.anchors.character?.isObject3D,id+' missing anchor');ensure(api.anchors.Character_Anchor===api.anchors.character,id+' named anchor mismatch');
  ensure(api.cameraPresets.overview.direction?.length===3,id+' overview direction');
  ensure(api.cameraPresets.companion.position?.length===3,id+' companion position');
  ensure(api.cameraPresets.companion.target?.length===3,id+' companion target');
  if(id==='convenience') {
    const view=api.cameraPresets.companion;
    ensure(view.position[0]===view.target[0]&&view.position[1]===view.target[1]&&view.position[2]>view.target[2],id+' camera is not frontal');
    ensure(api.anchors.character.position.z>5&&api.anchors.character.position.y===.022,id+' anchor is not on foreground road');
  }
  ensure(Array.isArray(api.lightingPresets)&&api.lightingPresets.length,id+' lighting presets');
  ensure(api.setLighting('__invalid__')===false,id+' invalid light accepted');
  let meshes=0,triangles=0;const materials=new Set(),geometries=new Set();
  api.root.traverse(o=>{if(o.isMesh){meshes++;ensure(o instanceof THREE.Mesh,id+' duplicated Three Mesh');const p=o.geometry?.attributes?.position;ensure(p,id+' missing geometry');for(const v of p.array)ensure(Number.isFinite(v),id+' nonfinite geometry');triangles+=(o.geometry.index?.count||p.count)/3*(o.isInstancedMesh?o.count:1);}if(o.geometry)geometries.add(o.geometry);for(const m of [o.material].flat().filter(Boolean))materials.add(m);});
  ensure(meshes>80,id+' lost authored geometry');
  const bounds=api.bounds||new THREE.Box3().setFromObject(api.root);
  const size=bounds.getSize(new THREE.Vector3());ensure(size.length()<100,id+' unbounded backdrop in framing bounds');
  const target=new THREE.Vector3(...(api.cameraPresets.overview.target||bounds.getCenter(new THREE.Vector3()).toArray()));
  const direction=new THREE.Vector3(...api.cameraPresets.overview.direction).normalize();
  const camera=new THREE.PerspectiveCamera(api.cameraPresets.overview.fov,1.5,.1,350);
  const distance=size.length()/2/Math.sin(THREE.MathUtils.degToRad(camera.fov/2))*1.05;
  camera.position.copy(target).addScaledVector(direction,distance);camera.lookAt(target);camera.updateMatrixWorld(true);
  await renderer.compileAsync(scene,camera);
  for(const preset of api.lightingPresets) {ensure(api.setLighting(preset)!==false,id+' preset failed '+preset);api.update(1/60,2.1);api.update(1/60,15.2);renderer.render(scene,camera);}
  const pixels=new Uint8Array(768*512*4);renderer.getContext().readPixels(0,0,768,512,renderer.getContext().RGBA,renderer.getContext().UNSIGNED_BYTE,pixels);
  let min=255,max=0;for(let i=0;i<pixels.length;i+=4){min=Math.min(min,pixels[i]);max=Math.max(max,pixels[i]);}ensure(max-min>20,id+' rendered blank');
  const companion=api.cameraPresets.companion;camera.fov=companion.fov;camera.position.fromArray(companion.position);camera.lookAt(new THREE.Vector3(...companion.target));camera.updateProjectionMatrix();renderer.render(scene,camera);
  let instances=0,disposedInstances=0;api.root.traverse(o=>{if(o.isInstancedMesh){instances++;o.addEventListener('dispose',()=>disposedInstances++);}});
  let disposedGeometries=0,disposedMaterials=0;for(const g of geometries)g.addEventListener('dispose',()=>disposedGeometries++);for(const m of materials)m.addEventListener('dispose',()=>disposedMaterials++);
  api.dispose();api.dispose();api.update(1/60,16);
  ensure(!api.root.parent,id+' root leaked');ensure(scene.children.length===1&&scene.children[0]===fixture,id+' removed host object');
  ensure(!fixtureDisposed,id+' disposed host resource');ensure(scene.background===background&&scene.fog===fog&&scene.environment===null,id+' scene state not restored');
  ensure(renderer.toneMappingExposure===originalExposure&&renderer.shadowMap.type===originalShadow&&renderer.toneMapping===originalToneMapping,id+' renderer state not restored');
  ensure(instances===disposedInstances,id+' instanced GPU buffer disposal mismatch');
  ensure(disposedGeometries===geometries.size,id+' geometry disposal mismatch '+disposedGeometries+'/'+geometries.size);
  ensure(disposedMaterials===materials.size,id+' material disposal mismatch '+disposedMaterials+'/'+materials.size);
  fixture.geometry.dispose();fixture.material.dispose();
  results.push({id,meshes,triangles:Math.round(triangles),geometries:geometries.size,materials:materials.size,presets:api.lightingPresets,bounds:size.toArray(),milliseconds:Math.round(performance.now()-start)});
 }
 renderer.dispose();renderer.domElement.remove();console.error=originalError;
 ensure(errors.length===0,errors.join('\\n'));
 return results;
}
`;

if (process.versions.electron) {
  const { app, BrowserWindow } = require('electron');
  app.whenReady().then(async () => {
    const window = new BrowserWindow({ width: 800, height: 600, show: false, webPreferences: { backgroundThrottling: false } });
    window.webContents.on('console-message', (event) => {
      if (event.level === 'error') process.stderr.write(event.message + '\n');
    });
    try {
      await window.loadURL(process.env.SCENE_TEST_URL);
      const result = await window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const started=Date.now();function check(){if(window.__sceneTest)window.__sceneTest.then(resolve,reject);else if(Date.now()-started>120000)reject(Error('Scene test module did not load'));else setTimeout(check,25);}check();})`, true);
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      app.exit(0);
    } catch (error) { process.stderr.write(String(error.stack || error) + '\n'); app.exit(1); }
  });
} else {
  (async () => {
    const { createServer } = await import('vite');
    const fs=require('node:fs');const assert=require('node:assert/strict');
    const root=path.resolve(__dirname,'..');
    const {parseSync}=await import('rolldown/experimental');
    for(const id of ['convenience','classroom','bookshop','forest']) {
      const source=fs.readFileSync(path.join(root,'src/scenes',id+'.mjs'),'utf8');
      const ast=parseSync(id+'.mjs',source).program;
      // Inspect syntax, not material names such as "window" or comments.
      const forbidden=new Set(['window','globalThis','requestAnimationFrame','setAnimationLoop','eval','WebGLRenderer','OrbitControls']);
      function visit(node){if(!node||typeof node!=='object')return;if(node.type==='Identifier')assert.ok(!forbidden.has(node.name),id+' standalone identifier '+node.name);for(const value of Object.values(node)){if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);}}
      visit(ast);
      for(const node of ast.body.filter(node=>node.type==='ImportDeclaration'))assert.match(node.source.value,/^three(?:\/addons\/.*)?$/,id+' non-shared library import');
    }
    const server=await createServer({root,configFile:false,server:{host:'127.0.0.1',port:0},plugins:[{
      name:'focused-scene-extraction-tests',
      resolveId(id){if(id==='/__four-scenes-test.mjs')return '\0four-scenes-test';},
      load(id){if(id==='\0four-scenes-test')return browserTest;},
      configureServer(server){server.middlewares.use('/__four-scenes-check/',(_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body><script type="module">import {run} from "/__four-scenes-test.mjs";window.__sceneTest=run();</script></body></html>');});}
    }]});
    await server.listen();
    const url='http://127.0.0.1:'+server.httpServer.address().port+'/__four-scenes-check/';
    const electron=require('electron');
    const env={...process.env,SCENE_TEST_URL:url};delete env.ELECTRON_RUN_AS_NODE;
    const child=spawn(electron,[__filename],{cwd:root,env,stdio:'inherit'});
    const timer=setTimeout(()=>{process.stderr.write('Focused scene test timed out\n');child.kill();},300000);
    child.once('exit',async code=>{clearTimeout(timer);await server.close();process.exitCode=code||0;});
    child.once('error',async error=>{clearTimeout(timer);console.error(error);await server.close();process.exitCode=1;});
  })().catch(error=>{console.error(error);process.exitCode=1;});
}
