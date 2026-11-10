const test=require('node:test'),assert=require('node:assert/strict');
async function fixture(){
 const T=await import('three'),{Diorama}=await import('../src/scenes/diorama-kit.mjs'),{addSakuraLife}=await import('../src/scenes/sakura-stream-life.mjs');
 const scene=new T.Scene(),renderer={toneMappingExposure:1,shadowMap:{}},b=new Diorama(scene,renderer,'life-test');
 const groundHeight=(x,z)=>.68+x*.012+z*.004,life=addSakuraLife(b,{groundHeight}),root=b.root.getObjectByName('sakura:stream-life');
 return {T,b,life,root,groundHeight};
}
function advance(life,seconds,start=0){life.update(start);for(let i=1;i<=Math.round(seconds*30);i++)life.update(start+i/30);}

test('cherry crowns are branch-supported notched five-petal geometry without opaque spherical cores',async()=>{
 const f=await fixture(),flower=f.root.getObjectByName('sakura:tree-0:flowers-0'),positions=flower.geometry.attributes.position,bins=new Set();
 assert.equal(f.life.metadata.trees.length,5);assert.equal(f.life.metadata.trees.filter(tree=>tree.weeping).length,3);assert.ok(f.life.metadata.blossomCount>40000);
 for(let i=0;i<positions.count;i++){const x=positions.getX(i),y=positions.getY(i);if(Math.hypot(x,y)>.8)bins.add(Math.round(Math.atan2(y,x)/(Math.PI*2/5))+5);}
 assert.equal(bins.size,5);assert.equal(flower.geometry.userData.petals,5);assert.equal(flower.geometry.userData.notched,true);assert.equal(flower.geometry.userData.cupped,true);assert.equal(flower.material.emissive.getHex(),0);assert.equal(flower.material.side,f.T.DoubleSide);
 assert.equal(flower.parent.name,flower.userData.windOwner);assert.ok(flower.parent.children.some(child=>child.name.includes(':wood-')));
 const spray=f.root.getObjectByName('sakura:tree-0:flower-sprays-0'),texture=spray.material.map;let transparent=0,opaque=0;
 for(let i=3;i<texture.image.data.length;i+=4){if(texture.image.data[i]===0)transparent++;if(texture.image.data[i]>240)opaque++;}
 assert.ok(transparent>texture.image.width*texture.image.height*.4,'sprays retain genuine empty gaps');assert.ok(opaque>1000);assert.equal(texture.userData.petals,5);assert.ok(spray.material.alphaTest>0);assert.equal(spray.parent.name,spray.userData.windOwner);
 const sphere=[];f.root.traverse(node=>{if(node.geometry?.type==='SphereGeometry')sphere.push(node.name);});assert.deepEqual(sphere,[]);f.life.dispose();
});

test('falling petals keep landing, float on the water and follow curved banks over sustained playback',async()=>{
 const f=await fixture(),layout=await import('../src/scenes/sakura-stream-layout.mjs');advance(f.life,90);
 assert.ok(f.life.metadata.contacts>200);assert.ok(f.life.metadata.waterContacts>100);assert.ok(f.life.metadata.releases>100);assert.ok(f.life.metadata.falling>0);assert.ok(f.life.metadata.floating>0);assert.ok(f.life.metadata.landed>0);
 for(const state of f.life.metadata.petals){
  if(state.kind==='floating'){assert.equal(state.y,layout.STREAM_LEVEL+.008);assert.ok(Math.abs(state.x-layout.streamCenter(state.z))<layout.streamHalfWidth(state.z)-.08);assert.ok(state.z>layout.STREAM_START&&state.z<layout.STREAM_END);}
  if(state.kind==='landed')assert.ok(Math.abs(state.y-f.groundHeight(state.x,state.z)-.008)<1e-9);
 }
 const float=f.life.metadata.petals.find(state=>state.kind==='floating'),before={...float};for(let i=1;i<=3;i++)f.life.update(90+i/30);const after=f.life.metadata.petals[float.id];assert.equal(after.kind,'floating');assert.ok(after.z>before.z);assert.equal(after.y,before.y);f.life.dispose();
});

test('floating and landed petal vertices contact their surfaces instead of lying underground',async()=>{
 const f=await fixture(),layout=await import('../src/scenes/sakura-stream-layout.mjs');advance(f.life,35);
 const mesh=f.root.getObjectByName('sakura:falling-and-stream-floating-petals'),matrix=new f.T.Matrix4(),point=new f.T.Vector3();
 for(const state of f.life.metadata.petals.filter(state=>state.kind!=='falling')){
  mesh.getMatrixAt(state.id,matrix);const positions=mesh.geometry.attributes.position;
  for(let i=0;i<positions.count;i++){
   point.fromBufferAttribute(positions,i).applyMatrix4(matrix);
   if(state.kind==='floating'){assert.ok(point.y>=layout.STREAM_LEVEL+.006);assert.ok(Math.abs(point.x-layout.streamCenter(point.z))<layout.streamHalfWidth(point.z));}
   else assert.ok(point.y>=f.groundHeight(point.x,point.z)+.005,'landed petal lies tangent to terrain above its surface');
  }
 }
 f.life.dispose();
});

test('landed petals also clear the actual nonlinear bank/path height field',async()=>{
 const T=await import('three'),{Diorama}=await import('../src/scenes/diorama-kit.mjs'),{addSakuraLife}=await import('../src/scenes/sakura-stream-life.mjs'),{groundHeight}=await import('../src/scenes/sakura-stream.mjs');
 const b=new Diorama(new T.Scene(),{shadowMap:{}},'real-ground-contact'),life=addSakuraLife(b,{groundHeight}),mesh=b.root.getObjectByName('sakura:falling-and-stream-floating-petals'),matrix=new T.Matrix4(),point=new T.Vector3();advance(life,90);
 assert.ok(life.metadata.landed>0);
 for(const state of life.metadata.petals.filter(state=>state.kind==='landed')){
  mesh.getMatrixAt(state.id,matrix);for(let i=0;i<mesh.geometry.attributes.position.count;i++){point.fromBufferAttribute(mesh.geometry.attributes.position,i).applyMatrix4(matrix);assert.ok(point.y>groundHeight(point.x,point.z),'actual bank/path does not intersect a landed petal');}
 }
 life.dispose();
});

test('pause freezes branches and petal transforms; resume and wind changes never jump time',async()=>{
 const f=await fixture();advance(f.life,4);const mesh=f.root.getObjectByName('sakura:falling-and-stream-floating-petals'),bough=f.root.getObjectByName('sakura:tree-0:bough-0');
 assert.equal(f.b.renderer.shadowMap.needsUpdate,true,'moving branch pose invalidates parked host shadows');f.b.renderer.shadowMap.needsUpdate=false;
 const before={phase:f.life.metadata.phase,poses:Array.from(mesh.instanceMatrix.array),rotation:bough.rotation.toArray(),petals:structuredClone(f.life.metadata.petals)};
 f.life.setMotion({enabled:false});f.life.setWind(1.3);f.life.update(1000);f.life.update(5000);
 assert.equal(f.b.renderer.shadowMap.needsUpdate,false,'paused scene does not keep redrawing shadows');
 assert.equal(f.life.metadata.phase,before.phase);assert.deepEqual(Array.from(mesh.instanceMatrix.array),before.poses);assert.deepEqual(bough.rotation.toArray(),before.rotation);assert.deepEqual(f.life.metadata.petals,before.petals);
 f.life.setMotion({enabled:true});f.life.update(9000);assert.deepEqual(Array.from(mesh.instanceMatrix.array),before.poses);f.life.update(9000.02);assert.ok(Math.abs(f.life.metadata.phase-before.phase-.02)<1e-8);assert.notDeepEqual(Array.from(mesh.instanceMatrix.array),before.poses);f.life.dispose();
});

test('Diorama batching preserves bough attachment and life disposal never double-disposes host resources',async()=>{
 const f=await fixture(),external=f.b.box([20,.2,0],[1,1,1],f.b.mat('host:external','#888888')),resources=new Map();
 f.root.traverse(node=>{for(const resource of [node.geometry,...[node.material].flat(),...[node.material].flat().filter(Boolean).flatMap(material=>Object.values(material).filter(value=>value?.isTexture))])if(resource&&!resources.has(resource)){resources.set(resource,0);resource.addEventListener('dispose',()=>resources.set(resource,resources.get(resource)+1));}});
 let externalDisposed=0;external.geometry.addEventListener('dispose',()=>externalDisposed++);
 const api=f.b.finish({rain:false,w:40,d:90}),flowers=f.root.getObjectByName('sakura:tree-0:flowers-0');assert.equal(flowers.parent.name,flowers.userData.windOwner);
 const ownGeometry=new Set(resources.keys());assert.equal([...f.b.geo].some(resource=>ownGeometry.has(resource)),false);assert.equal([...f.b.materials].some(resource=>ownGeometry.has(resource)),false);
 f.life.dispose();f.life.dispose();assert.equal(externalDisposed,0);for(const count of resources.values())assert.equal(count,1);api.dispose();assert.equal(externalDisposed,1);for(const count of resources.values())assert.equal(count,1);
});
