const {test}=require('node:test');
const assert=require('node:assert/strict');

async function fixture(t){
 const T=await import('three'),{createScene}=await import('../src/scenes/inage-overpass.mjs');
 const saved=global.document;
 global.document={createElement(){const canvas={width:0,height:0};canvas.getContext=()=>new Proxy({canvas},{get:(target,key)=>key in target?target[key]:()=>{}});return canvas;}};
 t.after(()=>{if(saved===undefined)delete global.document;else global.document=saved});
 const api=createScene({scene:new T.Scene(),renderer:{toneMappingExposure:1,shadowMap:{}}});
 api.root.updateMatrixWorld(true);t.after(()=>api.dispose());
 const node=name=>{const result=api.root.getObjectByName('inage:'+name);assert.ok(result,name+' is actual retained geometry');return result;};
 const bounds=name=>new T.Box3().setFromObject(node(name));
 return {T,api,node,bounds,layout:api.root.userData.inageLayout};
}

test('upper road and lower pedestrian span share an axis above a clear perpendicular ground road',async t=>{
 const {T,api,node,bounds,layout}=await fixture(t),upper=bounds('upper-road-deck'),lower=bounds('lower-walkway-deck'),road=bounds('ground-road');
 assert.ok(upper.getSize(new T.Vector3()).x>upper.getSize(new T.Vector3()).z*3);
 assert.ok(lower.getSize(new T.Vector3()).x>lower.getSize(new T.Vector3()).z*3);
 assert.ok(road.getSize(new T.Vector3()).z>road.getSize(new T.Vector3()).x*2);
 assert.ok(Math.abs(upper.getCenter(new T.Vector3()).z-lower.getCenter(new T.Vector3()).z)<.01);
 assert.ok(upper.min.z<lower.min.z&&upper.max.z>lower.max.z);
 assert.ok(lower.min.y-road.max.y>4,'vehicle clearance remains below the lower walkway');
 // Check actual mesh intersections, including stairs, supports and landscaping.
 for(const x of [-3.5,-1.5,1.5,3.5])for(const y of [1.2,2.8,4]){
  const ray=new T.Raycaster(new T.Vector3(x,y,road.max.z-.1),new T.Vector3(0,0,-1),0,road.max.z-road.min.z-.2);
  assert.equal(ray.intersectObject(api.framingRoot,true).length,0,`unobstructed Route 14 at x=${x}, y=${y}`);
 }
 const ray=new T.Raycaster(new T.Vector3(0,layout.lowerY+1,0),new T.Vector3(0,-1,0),0,2);
 const hit=ray.intersectObject(node('lower-walkway-deck'),false)[0];
 assert.ok(hit,'main lower span actually lies under the vehicle bridge');
 assert.ok(Math.abs(hit.point.y-layout.lowerY)<.001,'visible top winding faces upward instead of exposing the underside');
});

test('the rising spiral and its connectors have walking headroom below or beside the vehicle approach',async t=>{
 const {T,api,node}=await fixture(t);
 for(const name of ['spiral-entry-surface','spiral-deck-surface','upper-bank-path-surface']){
  const mesh=node(name),position=mesh.geometry.attributes.position;
  for(let i=0;i<position.count;i+=4){
   const a=new T.Vector3().fromBufferAttribute(position,i),b=new T.Vector3().fromBufferAttribute(position,i+1);
   const middle=a.add(b).multiplyScalar(.5).applyMatrix4(mesh.matrixWorld);middle.y+=.05;
   const up=new T.Raycaster(middle,new T.Vector3(0,1,0),0,1.9);
   assert.equal(up.intersectObject(api.framingRoot,true).length,0,`${name} walking headroom at segment ${i/4}`);
   const down=new T.Raycaster(middle,new T.Vector3(0,-1,0),0,.1);
   assert.ok(down.intersectObject(mesh,false).length,`${name} has an upward-facing walking surface`);
  }
 }
});

test('central stairs rise longitudinally to the pier landing with broad connected side ramps',async t=>{
 const {T,api,bounds,layout}=await fixture(t),treads=[];
 api.root.traverse(node=>{if(/^inage:centre-stair-tread-\d+$/.test(node.name))treads.push(new T.Box3().setFromObject(node));});
 assert.ok(treads.length>=12);treads.sort((a,b)=>a.min.x-b.min.x);
 assert.ok(treads[0].min.y>layout.lowerY-.3,'stairs do not begin on the ground road');
 assert.ok(Math.abs(treads.at(-1).max.y-layout.landingY)<.03);
 for(let i=1;i<treads.length;i++){assert.ok(treads[i].max.y>treads[i-1].max.y);assert.ok(treads[i].min.x<=treads[i-1].max.x+.01);}
 const front=bounds('bicycle-ramp-front'),back=bounds('bicycle-ramp-back'),landing=bounds('pier-landing');
 assert.ok(front.min.z>0&&back.max.z<0,'smooth lanes flank the narrow central stair');
 assert.ok(front.max.z-front.min.z>treads[0].max.z-treads[0].min.z);
 for(const ramp of [front,back]){assert.ok(Math.abs(ramp.min.x-layout.stairStart)<.03);assert.ok(Math.abs(ramp.max.x-layout.stairEnd)<.03);assert.ok(Math.abs(ramp.max.y-layout.landingY)<.03);assert.ok(ramp.max.x>=landing.min.x-.03);}
 for(const side of ['east','west'])for(const edge of ['front','back']){
  const leg=bounds(`portal-${side}-leg-${edge}`);assert.ok(leg.min.z>1.6||leg.max.z< -1.6,'portal pier leaves a real walking opening');
 }
});

test('wooded context continues the raised bank without changing the finite bridge framing',async t=>{
 const {T,api,node}=await fixture(t),context=api.root.getObjectByName('inage:continuing-woodland');
 assert.ok(context&&!api.framingRoot.children.includes(context),'distant woodland stays outside Home framing');
 assert.ok(api.root.userData.inageWoodland.trees>=100);
 const bounds=new T.Box3().setFromObject(context);
 assert.ok(bounds.max.x>100&&bounds.min.z< -90&&bounds.max.z>90,'forest ground extends beyond the photographed camera frustum');
 assert.ok(api.bounds.max.x<25&&api.bounds.min.x> -25,'finite architecture bounds do not include the surrounding landscape');
 const bank=node('continuous-east-bank');
 for(const z of [-12,0,12]){
  const ray=new T.Raycaster(new T.Vector3(23.75,20,z),new T.Vector3(0,-1,0));
  const hit=ray.intersectObject(bank,false)[0];assert.ok(hit&&hit.point.y>10.3,'both bank shoulders reach the raised rear woodland');
 }
 for(const x of [-3.5,0,3.5]){
  const road=new T.Raycaster(new T.Vector3(x,2.2,92),new T.Vector3(0,0,-1),0,184);
  assert.equal(road.intersectObject(api.root,true).length,0,'continuing woodland leaves the distant traffic corridor open too');
 }
});

test('lowest road practicals illuminate the carriageway and dispose selected shadows once',async t=>{
 const {T,api}=await fixture(t),lamps=[];
 api.root.traverse(o=>{if(o.name==='inage:ground-road-downlight')lamps.push(o)});
 assert.equal(lamps.length,6);
 const cameraBefore=JSON.stringify(api.cameraPresets),matrices=lamps.map(o=>o.matrixWorld.toArray());
 api.setLighting('night');api.root.updateMatrixWorld(true);
 for(const lamp of lamps){
  const source=lamp.getWorldPosition(new T.Vector3()),target=lamp.target.getWorldPosition(new T.Vector3());
  assert.ok(source.y>4&&source.y<4.6&&Math.abs(source.x)<5,'fixture aperture sits over the lowest road, below the pedestrian deck');
  assert.ok(target.y<.2&&Math.abs(target.x)<4,'downward beam is aimed at asphalt');
  assert.ok(lamp.intensity>=300&&lamp.distance>=12,'practical has useful inverse-square reach');
  const ray=new T.Raycaster(source,target.clone().sub(source).normalize(),0,20),hit=ray.intersectObject(api.root,true)[0];
  assert.ok(hit&&hit.object.name==='inage:ground-road','the emitting aperture has an unobstructed optical path to its actual road receiver');
 }
 assert.equal(lamps.filter(l=>l.castShadow).length,1,'one road hero light owns a shadow map');
 const shadow=lamps.find(l=>l.castShadow).shadow,dispose=shadow.dispose.bind(shadow);let count=0;
 shadow.dispose=()=>{count++;dispose()};
 api.setLighting('day');for(const lamp of lamps)assert.ok(lamp.intensity<4);
 assert.equal(JSON.stringify(api.cameraPresets),cameraBefore);assert.deepEqual(lamps.map(o=>o.matrixWorld.toArray()),matrices);
 api.dispose();api.dispose();assert.equal(count,1);
});
