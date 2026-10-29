const test=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./helpers/garment-glb-audit.cjs');

test('all seven existing character models frame their actual idle pose as a large full body in a portrait viewport',async()=>{
 const THREE=await import('three'),{GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js'),{cameraFrame}=await import('../src/ui/model-style.mjs');
 for(let number=1;number<=7;number++){
  const asset=load(`yukino-${String(number).padStart(2,'0')}-v1`),bytes=asset.bytes.buffer.slice(asset.bytes.byteOffset,asset.bytes.byteOffset+asset.bytes.byteLength);
  const gltf=await new GLTFLoader().register(()=>({name:'CPU_TEXTURE_ONLY',loadTexture:()=>Promise.resolve(new THREE.Texture())})).parseAsync(bytes,'');
  const idle=gltf.animations.find(clip=>clip.name===asset.model.defaultClip);assert.ok(idle,asset.model.id);
  const mixer=new THREE.AnimationMixer(gltf.scene);mixer.clipAction(idle).play();mixer.update(0);gltf.scene.updateMatrixWorld(true);
  const box=new THREE.Box3().setFromObject(gltf.scene,true),bounds={size:box.getSize(new THREE.Vector3()),center:box.getCenter(new THREE.Vector3())};
  // The supplied screenshot shows an especially narrow full-height panel.
  const frame=cameraFrame(bounds,.34),fraction=bounds.size.y/(2*Math.tan(Math.PI/12)*(frame.position.z-frame.target.z));
  assert.ok(fraction>.64&&fraction<.95,`${asset.model.id} full-body height ${fraction}`);
  if(number===7)assert.ok(fraction>.75,`default school outfit should use more of the narrow panel: ${fraction}`);
  const turned=cameraFrame(bounds,.34,1,45);assert.ok(turned.position.z>=frame.position.z,'turning keeps the projected body inside the view');
  mixer.stopAllAction();mixer.uncacheRoot(gltf.scene);
 }
});

test('transparent model viewport keeps scene lighting without drawing the selected environment',async()=>{
 const THREE=await import('three'),{GlbAvatarRenderer}=await import('../src/ui/model-runtime.mjs'),renderer=Object.create(GlbAvatarRenderer.prototype);
 Object.assign(renderer,{renderEnvironment:false,scene:new THREE.Scene(),environmentId:'studio',timeOfDay:'noon',ambient:new THREE.HemisphereLight(),key:new THREE.DirectionalLight()});
 renderer.setEnvironment({id:'beach',timeOfDay:'evening'});
 assert.equal(renderer.environment,undefined);assert.equal(renderer.scene.background,null);assert.equal(renderer.scene.children.length,0);
 assert.ok(renderer.ambient.intensity>0);assert.ok(renderer.key.intensity>0);assert.equal(renderer.environmentId,'beach');
});
