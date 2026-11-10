const {test}=require('node:test');
const assert=require('node:assert/strict');

function canvasDocument(){
 return {createElement(name){assert.equal(name,'canvas');const canvas={width:0,height:0};canvas.getContext=()=>new Proxy({canvas},{get:(target,key)=>key in target?target[key]:()=>{}});return canvas}};
}

test('clock hands use a single local time sample, including minute/hour carry',async()=>{
 const {localClockAngles}=await import('../src/scenes/classroom-clock.mjs'),tau=Math.PI*2;
 assert.deepEqual(localClockAngles(new Date(2026,10,2,12,0,0)),{hour:-0,minute:-0,second:-0});
 const angles=localClockAngles(new Date(2026,10,2,15,30,15,500));
 assert.ok(Math.abs(angles.second+15.5/60*tau)<1e-12);
 assert.ok(Math.abs(angles.minute+(30+15.5/60)/60*tau)<1e-12);
 assert.ok(Math.abs(angles.hour+(3+(30+15.5/60)/60)/12*tau)<1e-12);
});

test('production classroom clock catches up after suspension and disposes its detailed resources once',async t=>{
 const THREE=await import('three'),{createScene}=await import('../src/scenes/classroom.mjs');
 const saved=global.document;global.document=canvasDocument();t.after(()=>{if(saved===undefined)delete global.document;else global.document=saved});
 const scene=new THREE.Scene(),renderer={toneMappingExposure:1,shadowMap:{type:THREE.PCFSoftShadowMap}};
 const api=createScene({scene,renderer});t.after(()=>api.dispose());
 const clock=api.root.getObjectByName('classroom:wall-clock'),hour=clock.getObjectByName('classroom:clock-hour-pivot'),minute=clock.getObjectByName('classroom:clock-minute-pivot'),second=clock.getObjectByName('classroom:clock-second-pivot');
 assert.ok(clock&&hour&&minute&&second);
 const face=clock.getObjectByName('classroom:clock-face');assert.equal(face.material.map.image.width,1024);
 assert.equal(api.timeUpdateInterval,1000);
 const ids=[];clock.traverse(node=>{if(node.isMesh)ids.push(node.geometry.uuid)});
 api.updateTime(new Date(2026,10,2,3,0,0));assert.ok(Math.abs(hour.rotation.z+Math.PI/2)<1e-12);assert.equal(minute.rotation.z,-0);assert.equal(second.rotation.z,-0);
 // A scene can skip all animation frames and still recover the actual time.
 api.updateTime(new Date(2026,10,2,18,45,30));assert.ok(Math.abs(minute.rotation.z+(45.5/60)*Math.PI*2)<1e-12);assert.ok(Math.abs(second.rotation.z+Math.PI)<1e-12);
 assert.deepEqual(clock.userData.localTime,{hours:18,minutes:45,seconds:30});
 const after=[];clock.traverse(node=>{if(node.isMesh)after.push(node.geometry.uuid)});assert.deepEqual(after,ids);
 const resources=new Map();clock.traverse(node=>{if(!node.isMesh)return;resources.set(node.geometry,0);for(const m of [node.material].flat()){resources.set(m,0);if(m.map)resources.set(m.map,0)}});
 for(const resource of resources.keys())resource.addEventListener('dispose',()=>resources.set(resource,resources.get(resource)+1));
 api.dispose();api.dispose();for(const count of resources.values())assert.equal(count,1);
 const rotation=hour.rotation.z;assert.equal(api.updateTime(new Date(2026,10,2,1)),false);assert.equal(hour.rotation.z,rotation);
});
