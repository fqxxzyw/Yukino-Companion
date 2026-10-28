import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {inspectGlbSkinning, applyEightWeightSkinning, installEightWeightMesh, disposeEightWeightSkinning} from '../src/ui/eight-weight-skinning.mjs';
import {createEightWeightFixture, encodeGlb} from './helpers/eight-weight-fixture.mjs';

const SIZE = 256;
const report = {passed: false, checks: [], renderer: null, errors: [], purpose: 'Synthetic eight-weight GPU readback and screenshot proof, not model01 visual approval'};
window.eightWeightResult = {done: false};
function independentTransform(mesh, record, index, vector, w) {
  const input = new THREE.Vector4(vector.x, vector.y, vector.z, w).applyMatrix4(mesh.bindMatrix);
  const output = new THREE.Vector4(0, 0, 0, 0);
  for (let influence = 0; influence < 8; influence++) {
    const second = influence >= 4, offset = index * 4 + influence % 4;
    const joint = (second ? record.joints1 : record.joints0)[offset];
    const weight = (second ? record.weights1 : record.weights0)[offset];
    const matrix = new THREE.Matrix4().multiplyMatrices(mesh.skeleton.bones[joint].matrixWorld, mesh.skeleton.boneInverses[joint]);
    output.addScaledVector(input.clone().applyMatrix4(matrix), weight);
  }
  return output.applyMatrix4(mesh.bindMatrixInverse);
}
function bakedGeometry(mesh, record) {
  const geometry = mesh.geometry.clone();
  const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal'), tangents = geometry.getAttribute('tangent');
  for (let i = 0; i < positions.count; i++) {
    const position = new THREE.Vector3().fromBufferAttribute(positions, i);
    for (let m = 0; m < mesh.morphTargetInfluences.length; m++) position.addScaledVector(new THREE.Vector3().fromBufferAttribute(mesh.geometry.morphAttributes.position[m], i), mesh.morphTargetInfluences[m]);
    const p = independentTransform(mesh, record, i, position, 1);
    positions.setXYZ(i, p.x, p.y, p.z);
    for (const attribute of [normals, tangents]) {
      const v = independentTransform(mesh, record, i, new THREE.Vector3().fromBufferAttribute(attribute, i), 0);
      attribute.setXYZ(i, v.x, v.y, v.z);
    }
  }
  geometry.morphAttributes = {};
  for (const name of ['skinIndex','skinWeight','skinIndex1','skinWeight1','joints_1','weights_1']) geometry.deleteAttribute(name);
  return geometry;
}
function imageCanvas(pixels, label) {
  const figure = document.createElement('figure'), caption = document.createElement('figcaption'), canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE; caption.textContent = label;
  const flipped = new Uint8ClampedArray(pixels.length);
  for (let y = 0; y < SIZE; y++) flipped.set(pixels.subarray((SIZE-y-1)*SIZE*4,(SIZE-y)*SIZE*4),y*SIZE*4);
  canvas.getContext('2d').putImageData(new ImageData(flipped,SIZE,SIZE),0,0);
  figure.append(caption,canvas); return figure;
}
function foregroundPixels(pixels) {
  let count=0;for(let i=0;i<pixels.length;i+=4)if([0,1,2].some(c=>Math.abs(pixels[i+c]-pixels[c])>5))count++;return count;
}
function difference(a,b) {
  let sum=0, changed=0, max=0;
  for(let i=0;i<a.length;i+=4){let pixel=false;for(let c=0;c<3;c++){const d=Math.abs(a[i+c]-b[i+c]);sum+=d;max=Math.max(max,d);pixel ||= d>3;}if(pixel)changed++;}
  return {meanAbsolute:sum/(SIZE*SIZE*3),pixelsOver3:changed,max};
}
async function run() {
  const renderer = new THREE.WebGLRenderer({antialias:false,alpha:false,preserveDrawingBuffer:true});
  renderer.setSize(SIZE,SIZE); renderer.setPixelRatio(1); renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.BasicShadowMap;
  renderer.debug.onShaderError=(gl,program,vs,fs)=>report.errors.push([gl.getProgramInfoLog(program),gl.getShaderInfoLog(vs),gl.getShaderInfoLog(fs)].join('\n'));
  const context=renderer.getContext(),debug=context.getExtension('WEBGL_debug_renderer_info');
  report.renderer=debug?context.getParameter(debug.UNMASKED_RENDERER_WEBGL):context.getParameter(context.VERSION);
  const target=new THREE.WebGLRenderTarget(SIZE,SIZE);
  const camera=new THREE.PerspectiveCamera(42,1,.1,20);camera.position.set(0,0,3.3);camera.lookAt(0,0,0);
  const f=createEightWeightFixture();
  // Distinct joints and nonuniform per-vertex weights make swizzle/index bugs observable.
  const rows=[[.05,.08,.11,.14,.17,.19,.16,.10],[.02,.09,.11,.18,.15,.13,.12,.20],[.10,.05,.15,.08,.14,.12,.16,.20]];
  for(const [set,accessor] of [[0,f.indices.w0],[1,f.indices.w1]]){
    const start=f.json.bufferViews[f.json.accessors[accessor].bufferView].byteOffset;
    rows.forEach((weights,row)=>{for(let c=0;c<4;c++)new DataView(f.bin.buffer).setFloat32(start+(row*4+c)*4,weights[set*4+c],true);});
  }
  f.bytes=encodeGlb(f.json,f.bin);
  const inspection=inspectGlbSkinning(f.json,f.bytes),gltf=await new GLTFLoader().parseAsync(f.bytes,'');
  applyEightWeightSkinning(gltf,inspection);
  const mesh=gltf.scene.getObjectByName('Main'),record=inspection.primitives[0];
  gltf.scene.getObjectByName('Outline').visible=false;gltf.scene.getObjectByName('Four').visible=false;
  mesh.geometry.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,1,0,.5,1],2));
  mesh.bindMode=THREE.DetachedBindMode;mesh.bindMatrix.makeRotationZ(.18).setPosition(.1,-.06,.08);mesh.bindMatrixInverse.copy(mesh.bindMatrix).invert();
  mesh.morphTargetInfluences[0]=.7;
  mesh.skeleton.bones.forEach((bone,i)=>{bone.position.set(i*.08,i*.013,-i*.018);bone.rotation.set(i*.06,-i*.043,i*.017);});
  gltf.scene.updateMatrixWorld(true);mesh.skeleton.update();
  const baked=bakedGeometry(mesh,record);
  const normalMap=new THREE.DataTexture(new Uint8Array([180,80,240,255]),1,1);normalMap.needsUpdate=true;
  const alphaMap=new THREE.DataTexture(new Uint8Array([255,0,0,255,255,255,255,255,255,255,255,255,255,0,0,255]),2,2);alphaMap.needsUpdate=true;alphaMap.magFilter=THREE.NearestFilter;
  const cases=[
    ['standard',()=>new THREE.MeshStandardMaterial({color:0xc0794b,roughness:1,side:THREE.DoubleSide})],
    ['toon',()=>new THREE.MeshToonMaterial({color:0xc0794b,side:THREE.DoubleSide})],
    ['outline-backside',()=>new THREE.MeshBasicMaterial({color:0x05070b,side:THREE.BackSide})],
    ['unlit-alpha-mask',()=>new THREE.MeshBasicMaterial({color:0xc0794b,alphaMap,alphaTest:.5,side:THREE.DoubleSide})],
    ['normal',()=>new THREE.MeshNormalMaterial({side:THREE.DoubleSide})],
    ['tangent-normal-map',()=>new THREE.MeshStandardMaterial({color:0xc0794b,roughness:1,normalMap,side:THREE.DoubleSide})],
    ['depth',()=>new THREE.MeshDepthMaterial({side:THREE.DoubleSide})],
    ['directional-shadow',()=>new THREE.MeshStandardMaterial({color:0xc0794b,roughness:1,side:THREE.DoubleSide})],
    ['point-shadow',()=>new THREE.MeshStandardMaterial({color:0xc0794b,roughness:1,side:THREE.DoubleSide})],
  ];
  function sceneFor(object,kind) {
    const scene=new THREE.Scene();scene.background=new THREE.Color(0x1b2942);scene.add(object);
    scene.add(new THREE.AmbientLight(0xffffff,.6));
    const light=kind==='point-shadow'?new THREE.PointLight(0xffffff,20,15):new THREE.DirectionalLight(0xffffff,2.4);
    light.position.set(-1,1.6,2.5);light.castShadow=kind.endsWith('shadow');
    light.shadow.mapSize.set(512,512);light.shadow.camera.near=.1;light.shadow.camera.far=15;
    if(light.isDirectionalLight){Object.assign(light.shadow.camera,{left:-1.5,right:1.5,top:1.5,bottom:-1.5});light.shadow.camera.updateProjectionMatrix();}
    scene.add(light);object.castShadow=light.castShadow;
    if(light.castShadow){const plane=new THREE.Mesh(new THREE.PlaneGeometry(5,5),new THREE.MeshStandardMaterial({color:0x97a6bd,roughness:1}));plane.position.z=-.6;plane.receiveShadow=true;scene.add(plane);}
    return scene;
  }
  function render(scene) {
    renderer.setRenderTarget(target);renderer.clear();renderer.render(scene,camera);
    const pixels=new Uint8Array(SIZE*SIZE*4);renderer.readRenderTargetPixels(target,0,0,SIZE,SIZE,pixels);return pixels;
  }
  for(const [name,makeMaterial] of cases){
    mesh.rotation.y=name==='outline-backside'?Math.PI:0;
    mesh.material=makeMaterial();installEightWeightMesh(mesh);
    // Skeleton bones remain in the original scene; matrixWorld was updated above.
    const actualScene=sceneFor(mesh,name),referenceMesh=new THREE.Mesh(baked,makeMaterial()),referenceScene=sceneFor(referenceMesh,name);
    referenceMesh.quaternion.copy(mesh.quaternion);
    const actual=render(actualScene),expected=render(referenceScene),delta=difference(actual,expected);
    const foreground=foregroundPixels(expected);
    const checkpoint={name,...delta,referenceForegroundPixels:foreground,passed:foreground>500&&delta.meanAbsolute<.2&&delta.pixelsOver3<64};report.checks.push(checkpoint);
    if(name==='standard'){
      // Negative control: prove this fixture detects silently dropping set1.
      const truncated=new THREE.SkinnedMesh(mesh.geometry.clone(),makeMaterial());truncated.skeleton=mesh.skeleton;truncated.bindMode=mesh.bindMode;truncated.bindMatrix.copy(mesh.bindMatrix);truncated.bindMatrixInverse.copy(mesh.bindMatrixInverse);truncated.morphTargetInfluences=[...mesh.morphTargetInfluences];truncated.normalizeSkinWeights();
      const loss=difference(render(sceneFor(truncated,'standard')),expected);
      report.negativeControl={...loss,passed:loss.pixelsOver3>500};
      if(!report.negativeControl.passed)throw Error('Synthetic fixture failed to reveal four-weight truncation.');
      truncated.material.dispose();truncated.geometry.dispose();
    }
    if(name.endsWith('shadow')){
      // Prove the dedicated shadow shader is exercised, not merely compiled or occluded.
      const property=name==='point-shadow'?'customDistanceMaterial':'customDepthMaterial',saved=mesh[property];
      let loss;try{mesh[property]=undefined;loss=difference(render(actualScene),expected);}finally{mesh[property]=saved;}
      const negative={name,...loss,passed:loss.pixelsOver3>25};(report.shadowNegativeControls ||= []).push(negative);
      if(!negative.passed)throw Error(`${name} fixture did not expose the missing eight-weight shadow shader`);
    }
    const row=document.createElement('section');row.append(imageCanvas(actual,`${name}: GPU eight weights`),imageCanvas(expected,'Independent CPU reference'));document.getElementById('gallery').append(row);
    if(!checkpoint.passed)throw Error(`${name} GPU/CPU mismatch: ${JSON.stringify(delta)}`);
    for(const scene of [actualScene,referenceScene]){scene.traverse(o=>{if(o.isLight)o.dispose?.();if(o.isMesh&&o!==mesh&&o!==referenceMesh){o.geometry.dispose();o.material.dispose();}});}
    mesh.material.dispose();referenceMesh.material.dispose();
  }
  if(report.errors.length)throw Error('WebGL shader errors: '+report.errors.join('\n'));
  if(context.getError()!==context.NO_ERROR)throw Error('WebGL error after render comparisons');
  report.passed=true;
  disposeEightWeightSkinning(mesh);disposeEightWeightSkinning(gltf.scene);baked.dispose();target.dispose();normalMap.dispose();alphaMap.dispose();renderer.dispose();
}
try{await run();document.getElementById('status').textContent='PASS: actual GPU readbacks match the independent eight-weight reference.';}
catch(error){report.errors.push(error.stack||error.message);document.getElementById('status').textContent='FAIL / BLOCKED: '+error.message;}
finally{document.getElementById('report').textContent=JSON.stringify(report,null,2);window.eightWeightResult={done:true,...report};}
