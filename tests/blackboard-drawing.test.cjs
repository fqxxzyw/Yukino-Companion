const test=require('node:test'),assert=require('node:assert/strict');
function canvasFixture(){
 const calls=[],canvas={width:0,height:0};
 const context=new Proxy({canvas},{get:(object,key)=>key in object?object[key]:(...args)=>calls.push([key,...args])});
 canvas.getContext=()=>context;canvas.toDataURL=()=>`data:image/png;base64,${Buffer.from(JSON.stringify(calls)).toString('base64')}`;
 return {canvas,context,calls};
}
async function fixture(options={}){
 const T=await import('three'),{BlackboardDrawingController}=await import('../src/ui/blackboard-drawing.mjs'),paint=canvasFixture();
 const root=new T.Group(),material=new T.MeshStandardMaterial({name:'classroom:blackboard'}),original=new T.Texture();material.map=original;
 const board=new T.Mesh(new T.PlaneGeometry(3.92,1.11),material);board.name='classroom:board';board.position.set(-2.65,1.48,-4.445);root.add(board);
 const camera=new T.PerspectiveCamera(40,2,.1,100);camera.position.set(-2.65,1.48,7);camera.lookAt(board.position);camera.updateMatrixWorld(true);
 let renders=0,disposed=0;
 const renderer={current:{root},environmentScene:'classroom',camera,gl:{domElement:{getBoundingClientRect:()=>({left:40,top:70,width:1000,height:500})}},requestRender(){renders++;}};
 const controller=new BlackboardDrawingController({canvasFactory:()=>{if(!paint.used){paint.used=true;return paint.canvas;}return canvasFixture().canvas;},textureFactory:canvas=>{const texture=new T.CanvasTexture(canvas);texture.addEventListener('dispose',()=>disposed++);return texture;},...options});
 return {T,controller,renderer,root,board,material,original,paint,renders:()=>renders,disposed:()=>disposed};
}

test('transparent white ink shares actual board geometry without altering authored board material and disposes only owned resources',async()=>{
 const f=await fixture(),{BLACKBOARD_COLOR}=await import('../src/ui/blackboard-drawing.mjs');
 assert.equal(f.controller.canvas.width,1568);assert.equal(f.controller.canvas.height,444);assert.equal(f.paint.calls[0][0],'clearRect');
 assert.equal(f.controller.attach(f.renderer),true);assert.equal(f.material.map,f.original,'untouched board keeps its authored appearance');
 f.controller.beginUV({x:.2,y:.5});assert.equal(f.material.map,f.original,'ink never changes the authored material map');assert.equal(f.controller.texture.isCanvasTexture,true);assert.equal(f.controller.texture.flipY,true);assert.equal(f.controller.texture.colorSpace,f.T.SRGBColorSpace);assert.equal(f.controller.overlay.geometry,f.board.geometry);assert.equal(f.controller.overlay.parent,f.board);assert.equal(f.controller.overlay.visible,true);assert.equal(f.controller.inkMaterial.transparent,true);assert.equal(f.controller.inkMaterial.toneMapped,false);assert.equal(f.controller.inkMaterial.depthWrite,false);assert.equal(f.controller.inkMaterial.blending,f.T.NormalBlending);assert.equal(f.controller.hasInk(),true);assert.equal(f.paint.context.strokeStyle,'#ffffff');assert.ok(f.renders()>0);
 let geometryDisposed=0,materialDisposed=0;f.board.geometry.addEventListener('dispose',()=>geometryDisposed++);f.controller.inkMaterial.addEventListener('dispose',()=>materialDisposed++);f.controller.dispose();assert.equal(f.material.map,f.original);assert.equal(f.board.children.length,0);assert.equal(geometryDisposed,0);assert.equal(materialDisposed,1);assert.equal(f.disposed(),1);assert.equal(f.controller.hasInk(),true,'GPU disposal keeps unsent drawing data');
 f.controller.dispose();assert.equal(f.disposed(),1);assert.equal(BLACKBOARD_COLOR,'#183c30');
 assert.equal(f.controller.attach(f.renderer),true,'retained controller reattaches after overlay remount');f.controller.dispose();assert.equal(f.disposed(),2);
});

test('raycast UV follows real board and ancestor transforms, host offset and actual camera',async()=>{
 const f=await fixture();f.root.position.set(.4,.2,-.6);f.root.rotation.y=.12;f.root.scale.setScalar(1.2);f.root.updateMatrixWorld(true);assert.equal(f.controller.attach(f.renderer),true);
 const center=f.board.getWorldPosition(new f.T.Vector3()),point=center.clone().project(f.renderer.camera),x=40+(point.x+1)*500,y=70+(1-point.y)*250;
 const uv=f.controller.hit(x,y);assert.ok(Math.abs(uv.x-.5)<1e-5);assert.ok(Math.abs(uv.y-.5)<1e-5);
 assert.equal(f.controller.begin(x,y),true);assert.ok(f.controller.marks.length===1);const revision=f.controller.revision;
 assert.equal(f.controller.move(-500,-500),false);assert.equal(f.controller.last,null);assert.equal(f.controller.revision,revision);
 const projected=f.controller.project();assert.equal(projected.points.length,4);assert.match(projected.clipPath,/^polygon\(/);assert.ok(projected.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
 f.controller.dispose();
});

test('snapshots are stable PNG receipts and successful clearing cannot erase newer strokes',async()=>{
 const f=await fixture(),c=f.controller;let changes=0;c.subscribe(()=>changes++);c.attach(f.renderer);
 assert.equal(c.snapshot(),null);c.beginUV({x:.1,y:.9});c.moveUV({x:.2,y:.7});const first=c.snapshot();assert.ok(Object.isFrozen(first));assert.equal(c.snapshot(),first);assert.match(first.image,/^data:image\/png;base64,/);assert.notEqual(c.exportCanvas,c.canvas);assert.ok(f.paint.calls.every(call=>call[0]!=='fillRect'),'ink canvas remains transparent outside strokes');
 c.end();c.beginUV({x:.5,y:.5});const newer=c.snapshot();assert.notEqual(newer,first);assert.equal(first.revision,2);
 assert.equal(c.clear({...first,owner:-1}),false);assert.equal(c.marks.length,3);assert.equal(c.clear(first),true);assert.equal(c.marks.length,1);assert.deepEqual(c.marks[0].to,{x:.5,y:.5});assert.equal(c.hasInk(),true);
 assert.equal(c.clear(first),false,'a completed receipt cannot erase a newer drawing');assert.equal(c.clear(),true);assert.equal(c.hasInk(),false);assert.equal(c.snapshot(),null);assert.ok(changes>=5);c.dispose();
});

test('assistant board text remains visible independently of user ink and does not create a sendable stroke',async()=>{
 const f=await fixture(),c=f.controller;c.attach(f.renderer);
 assert.equal(c.setAssistantText('第一行\n第二行'),true);assert.equal(c.hasInk(),false);assert.equal(c.snapshot(),null);assert.equal(c.revision,0);assert.equal(c.overlay.visible,true);
 const initial=f.paint.calls.filter(call=>call[0]==='fillText').slice(-2);assert.deepEqual(initial.map(call=>call[1]),['第一行','第二行']);
 assert.ok(initial.every(row=>row[2]>=c.canvas.width*.5&&row[2]+row[4]<=c.canvas.width),'assistant text starts in the right half and is constrained to the board');
 f.paint.calls.length=0;c.setAssistantText('一'.repeat(1000));const rows=f.paint.calls.filter(call=>call[0]==='fillText');assert.ok(rows.length>1);assert.match(rows.at(-1)[1],/…$/);assert.ok(rows.every(row=>row[2]>=c.canvas.width*.5&&row[2]+row[4]<=c.canvas.width&&row[3]>=0&&row[3]+24<=c.canvas.height));c.setAssistantText('第一行\n第二行');
 c.beginUV({x:.1,y:.8});const receipt=c.snapshot();assert.ok(receipt);assert.equal(c.clear(receipt),true);assert.equal(c.hasInk(),false);assert.equal(c.overlay.visible,true);assert.equal(c.assistantText,'第一行\n第二行');
 assert.equal(c.setAssistantText('新的内容'),true);assert.equal(c.assistantText,'新的内容');assert.equal(c.setAssistantText({text:'bad'}),false);assert.equal(c.setAssistantText(''),true);assert.equal(c.overlay.visible,false);c.dispose();
});

test('assistant poster draws over time, preserves user marks, and cancels stale frames on erasure, replacement and detach',async()=>{
 const frames=new Map(),progress=[];let next=0;
 const f=await fixture({posterPainter:(ctx,poster,amount)=>{progress.push([poster.text,amount]);ctx.fillText(poster.text,900,30);},requestFrame:callback=>{const id=++next;frames.set(id,callback);return id;},cancelFrame:id=>frames.delete(id)}),c=f.controller;
 const advance=time=>{const queued=[...frames.values()];frames.clear();for(const callback of queued)callback(time);};
 c.attach(f.renderer);assert.equal(c.setAssistantPoster({text:'生日快乐',elements:[]}),true);assert.equal(c.hasInk(),false);assert.equal(c.snapshot(),null);assert.equal(c.posterProgress,0);assert.equal(c.overlay.visible,true);
 advance(100);assert.equal(c.posterProgress,0);advance(1000);assert.ok(c.posterProgress>0&&c.posterProgress<1);assert.ok(progress.some(([,value])=>value>0&&value<1));
 c.beginUV({x:.2,y:.6});const revision=c.revision;advance(7000);assert.equal(c.posterProgress,1);assert.equal(c.revision,revision);assert.equal(c.marks.length,1);assert.ok(c.snapshot());assert.equal(frames.size,0);
 c.setAssistantPoster({text:'旧画',elements:[]});const stale=[...frames.values()][0];assert.equal(c.setAssistantText(''),true);assert.equal(frames.size,0);stale(9000);assert.equal(c.assistantPoster,null);assert.equal(c.marks.length,1);
 c.setAssistantPoster({text:'旧画',elements:[]});const replaced=[...frames.values()][0];c.setAssistantPoster({text:'新画',elements:[]});replaced(10000);assert.equal(c.assistantPoster.text,'新画');assert.equal(c.posterProgress,0);
 const detached=[...frames.values()][0];c.detach();assert.equal(frames.size,0);detached(15000);assert.equal(c.posterProgress,0);assert.equal(c.marks.length,1);c.setAssistantText('');assert.equal(c.attach(f.renderer),true);assert.equal(frames.size,0,'erasing while detached cancels the paused poster');c.dispose();
});

test('a poster received while the classroom is loading begins only when the board first attaches',async()=>{
 const frames=new Map();let next=0;
 const f=await fixture({posterPainter:()=>{},requestFrame:callback=>{const id=++next;frames.set(id,callback);return id;},cancelFrame:id=>frames.delete(id)}),c=f.controller;
 assert.equal(c.setAssistantPoster({text:'生日快乐',elements:[]}),true);assert.equal(frames.size,0);assert.equal(c.posterPending,true);
 f.renderer.loading=true;assert.equal(c.attach(f.renderer),false);assert.equal(c.posterPending,true);assert.equal(frames.size,0);
 f.renderer.loading=false;assert.equal(c.attach(f.renderer),true);assert.equal(c.posterPending,false);assert.equal(frames.size,1);
 let frame=[...frames.values()][0];frames.clear();frame(100);frame=[...frames.values()][0];frames.clear();frame(900);assert.ok(c.posterProgress>0);
 const partial=c.posterProgress,oldFrame=[...frames.values()][0];c.detach();assert.equal(frames.size,0);assert.equal(c.posterPending,true);oldFrame(10000);assert.equal(c.posterProgress,partial,'a queued frame cannot draw after detach');
 assert.equal(c.attach(f.renderer),true);assert.equal(frames.size,1,'the paused animation resumes when the same board returns');
 frame=[...frames.values()][0];frames.clear();frame(20000);assert.equal(c.posterProgress,partial);frame=[...frames.values()][0];frames.clear();frame(30000);assert.equal(c.posterProgress,1);
 c.setAssistantText('');assert.equal(c.assistantPoster,null);c.dispose();
});

test('the production painter animates chalk lines over the board and leaves the user layer independent',async()=>{
 const frames=new Map();let next=0;
 const f=await fixture({requestFrame:callback=>{const id=++next;frames.set(id,callback);return id;},cancelFrame:id=>frames.delete(id)}),c=f.controller;
 const step=time=>{const queued=[...frames.values()];frames.clear();for(const callback of queued)callback(time);};
 c.attach(f.renderer);c.setAssistantPoster({text:'',elements:[{type:'path',color:'pink',points:[[.15,.2],[.4,.4],[.25,.7]]}]});
 f.paint.calls.length=0;step(0);assert.equal(f.paint.calls.filter(call=>call[0]==='lineTo').length,0);
 step(1000);assert.ok(f.paint.calls.some(call=>call[0]==='lineTo'),'the first chalk stroke grows before animation completes');
 assert.equal(c.hasInk(),false);assert.equal(c.snapshot(),null);step(6000);assert.equal(c.posterProgress,1);assert.equal(c.overlay.visible,true);c.dispose();
});

test('unavailable or replaced classroom scenes detach safely and invalid UVs do not create marks',async()=>{
 const f=await fixture(),c=f.controller;c.attach(f.renderer);c.beginUV({x:.1,y:.1});const snapshot=c.snapshot();
 f.renderer.loading=true;assert.equal(c.attach(f.renderer),false);assert.equal(f.material.map,f.original);assert.equal(c.snapshot(),snapshot);assert.equal(c.hit(0,0),null);
 for(const uv of [null,{x:NaN,y:.5},{x:1.1,y:.5},{x:.5,y:-.1}])assert.equal(c.beginUV(uv),false);
 f.renderer.loading=false;f.renderer.environmentScene='city';assert.equal(c.attach(f.renderer),false);assert.equal(c.hasInk(),true);c.dispose();
});

test('controller finds and projects the production classroom board geometry without hard-coded world coordinates',async t=>{
 const f=await fixture(),{createScene}=await import('../src/scenes/classroom.mjs');const before=global.document;
 global.document={createElement:()=>{const {canvas}=canvasFixture();return canvas;}};t.after(()=>{if(before===undefined)delete global.document;else global.document=before;});
 const scene=new f.T.Scene(),api=createScene({scene,renderer:{toneMappingExposure:1,shadowMap:{type:f.T.PCFSoftShadowMap}}});t.after(()=>api.dispose());
 f.renderer.current=api;const board=api.root.getObjectByName('classroom:board');assert.ok(board);f.renderer.camera.position.set(-2.65,1.48,7);f.renderer.camera.lookAt(-2.65,1.48,-4.445);f.renderer.camera.updateMatrixWorld(true);
 assert.equal(f.controller.attach(f.renderer),true);const hit=f.controller.hit(540,320);assert.ok(Math.abs(hit.x-.5)<1e-5&&Math.abs(hit.y-.5)<1e-5);assert.equal(f.controller.project().points.length,4);f.controller.dispose();
});
