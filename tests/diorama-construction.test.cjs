const test=require('node:test'),assert=require('node:assert/strict');

test('bookshop neutral tubes light the actual book table and back spines across day and night',async t=>{
 const T=await import('three'),{createScene}=await import('../src/scenes/bookshop-ramen.mjs');
 const previous=global.document,gradient={addColorStop(){}};
 global.document={createElement(){const canvas={};canvas.getContext=()=>new Proxy({
  canvas,createLinearGradient:()=>gradient,createRadialGradient:()=>gradient,measureText:()=>({width:40}),
  getImageData:(x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4)}),
 },{get:(o,k)=>k in o?o[k]:()=>{}});return canvas;}};
 t.after(()=>{if(previous===undefined)delete global.document;else global.document=previous;});
 // This geometry/photometry test needs a valid environment target, while
 // native panorama convolution is covered by the browser capture.
 t.mock.method(T.PMREMGenerator.prototype,'compileEquirectangularShader',()=>{});
 t.mock.method(T.PMREMGenerator.prototype,'fromEquirectangular',()=>new T.WebGLRenderTarget(4,4));
 t.mock.method(T.PMREMGenerator.prototype,'dispose',()=>{});
 const renderer={shadowMap:{},capabilities:{getMaxAnisotropy:()=>4}},api=createScene({scene:new T.Scene(),renderer});
 t.after(()=>api.dispose());
 const room=api.root.getObjectByName('Bookshop_Interior'),shelf=room.getObjectByName('Bookshop_Back_Shelves');
 const display=room.getObjectByName('bookshop:fluorescent-window-display'),rear=room.getObjectByName('bookshop:fluorescent-back-shelves');
 const target=rear.target.getWorldPosition(new T.Vector3());
 assert.ok(new T.Box3().setFromObject(shelf).expandByScalar(.15).containsPoint(target),'beam hits the original shelf');
 assert.ok(display.target.position.distanceTo(new T.Vector3(-.42,1,1.89))<.01);
 api.setLighting('day');
 const day=[display.intensity,rear.intensity];
 for(const light of [display,rear]){
  const offset=light.position.clone().sub(light.target.position),r=offset.length();
  const incident=light.intensity/r**2*(1-(r/light.distance)**4)**2*offset.normalize().z;
  assert.ok(incident>.55&&incident<3,'book covers and spines receive a bounded direct contribution');
  assert.ok(light.color.r/light.color.b<1.12&&light.color.r>=light.color.b);
 }
 api.setLighting('night');assert.equal(rear.intensity,day[1]*.82);
 api.setLighting('day');assert.deepEqual([display.intensity,rear.intensity],day);
});

test('static repeated geometry preserves world transforms when batched as instances',async()=>{
 const T=await import('three'),{Diorama}=await import('../src/scenes/diorama-kit.mjs');
 const b=new Diorama(new T.Scene(),{toneMappingExposure:1},'instances-test'),material=b.mat('test:posts','#fff');
 const parent=b.group('offset',[3,2,-4]),original=[];
 for(let i=0;i<10;i++){const post=b.cylinderAt([i,.5,i*.3],.1,1+i*.1,material,parent);post.rotation.z=i*.02;}
 b.root.updateMatrixWorld(true);for(const post of parent.children)original.push(post.matrixWorld.clone());
 const api=b.finish({rain:false});let batch;api.root.traverse(node=>{if(node.isInstancedMesh&&node.material===material)batch=node});
 assert.ok(batch);assert.equal(batch.count,original.length);assert.equal(batch.geometry,b.cylinder);assert.equal(batch.material,material);assert.equal(batch.castShadow,true);assert.equal(batch.receiveShadow,true);
 for(let i=0;i<original.length;i++){const actual=new T.Matrix4();batch.getMatrixAt(i,actual);assert.ok(actual.elements.every((value,index)=>Math.abs(value-original[i].elements[index])<1e-6));}
 let disposed=0;b.cylinder.addEventListener('dispose',()=>disposed++);api.dispose();api.dispose();assert.equal(disposed,1);
});

test('canopy shafts follow solar direction, end above the path and disappear at night/overcast',async()=>{
 const T=await import('three'),{Diorama}=await import('../src/scenes/diorama-kit.mjs'),{canopyRays}=await import('../src/scenes/canopy-rays.mjs');
 const scene=new T.Scene(),b=new Diorama(scene,{toneMappingExposure:1},'canopy-test'),update=canopyRays(b);
 const api=b.finish({rain:false});const rays=[];api.root.traverse(o=>{if(o.material?.name==='canopy:atmospheric-rays')rays.push(o)});
 assert.equal(rays.length,3,'light volumes survive static geometry batching');
 const direction=new T.Vector3(.4,1,.6).normalize();update(direction,1,0);
 for(const ray of rays){assert.equal(ray.visible,true);assert.ok(new T.Vector3(0,1,0).applyQuaternion(ray.quaternion).distanceTo(direction)<1e-6);assert.ok(Math.abs(ray.position.y-direction.y*ray.scale.y/2-.26)<1e-6,'shaft never continues beneath the path');}
 const strength=rays[0].material.uniforms.uStrength.value;update(direction,1,.6);assert.ok(rays[0].material.uniforms.uStrength.value<strength*.2);
 update(direction,1,1);assert.ok(rays.every(r=>!r.visible));update(direction,0,0);assert.ok(rays.every(r=>!r.visible));
 update(new T.Vector3(.98,.15,0),1,0);assert.ok(rays.every(r=>!r.visible),'low sun cannot produce unbounded volumes beyond the miniature');
 let disposed=0;rays[0].geometry.addEventListener('dispose',()=>disposed++);api.dispose();api.dispose();assert.equal(disposed,1);
});

test('multiline material labels cannot inject a line into Three shader defines',async()=>{
 const T=await import('three'),{Diorama}=await import('../src/scenes/diorama-kit.mjs');
 const b=new Diorama(new T.Scene(),{toneMappingExposure:1},'sign-test');
 const m=b.mat('sign:自転車は\nおりて通行','#fff');assert.doesNotMatch(m.name,/[\r\n\u2028\u2029]/);assert.match(m.name,/おりて通行/);
 b.box([0,0,0],[1,1,1],m);b.finish({rain:false}).dispose();
});

test('rooted bamboo shares wind with its shadow, pauses, resumes, and disposes depth resources',async()=>{
 const T=await import('three'),{Diorama}=await import('../src/scenes/diorama-kit.mjs'),{bambooSway}=await import('../src/scenes/bamboo-sway.mjs');
 const renderer={toneMappingExposure:1,shadowMap:{needsUpdate:false}},b=new Diorama(new T.Scene(),renderer,'sway-test');
 const material=b.mat('bamboo:culm','#88947a');const stem=b.cylinderAt([0,5,0],.1,10,material);
 const api=b.finish({rain:false}),setWind=bambooSway(b,api.root);setWind(.8);
 const compile=m=>{const shader={uniforms:{},vertexShader:'#include <common>\n#include <project_vertex>'};m.onBeforeCompile(shader,renderer);return shader;};
 const visible=compile(material),shadow=compile(stem.customDepthMaterial);
 assert.equal(visible.uniforms.uBambooTime,shadow.uniforms.uBambooTime);
 assert.equal(visible.uniforms.uBambooWind.value,.8);
 assert.match(shadow.vertexShader,/bambooHeight\*bambooHeight/);
 api.update(.1,2);assert.equal(visible.uniforms.uBambooTime.value,2);assert.equal(renderer.shadowMap.needsUpdate,true);
 api.setMotion({enabled:false});api.update(.1,7);assert.equal(visible.uniforms.uBambooTime.value,2);
 api.setMotion({enabled:true});api.update(.1,8);assert.equal(visible.uniforms.uBambooTime.value,8);
 let disposed=0;stem.customDepthMaterial.addEventListener('dispose',()=>disposed++);api.dispose();api.dispose();assert.equal(disposed,1);
});
