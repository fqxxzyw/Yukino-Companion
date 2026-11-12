const test=require('node:test');
const assert=require('node:assert/strict');

test('classroom board target moves continuously opposite the character panel',async()=>{
 const {classroomBoardTarget}=await import('../src/ui/scene-camera.mjs');
 const main={left:330,right:1930,width:1600};
 const panel=left=>({left,right:left+400,width:400});
 assert.equal(classroomBoardTarget(main,panel(330)),1330);
 assert.equal(classroomBoardTarget(main,panel(930)),1130);
 assert.equal(classroomBoardTarget(main,panel(1530)),930);
 assert.equal(classroomBoardTarget(main,{left:330,right:1430,width:1100}),null);
});

test('camera reframes the actual projected blackboard for each dock and follows intermediate drag positions',async()=>{
 const THREE=await import('three'),{EnvironmentBackdrop}=await import('../src/ui/environment-backdrop.mjs');
 const mainRect={left:330,right:1930,width:1600},hostRect={left:0,right:1952,width:1952,height:1276};let panelLeft=1530;
 const panel={getBoundingClientRect:()=>({left:panelLeft,right:panelLeft+400,width:400})};
 const main={getBoundingClientRect:()=>mainRect,querySelector:()=>panel};
 const root=new THREE.Group(),board=new THREE.Mesh(new THREE.PlaneGeometry(3.92,1.11),new THREE.MeshBasicMaterial());board.name='classroom:board';board.position.set(-2.65,1.48,-4.445);root.add(board);
 const camera=new THREE.PerspectiveCamera(29,hostRect.width/hostRect.height,.05,1500);camera.position.set(-2.1,2,8.3);camera.lookAt(-2.1,2,-4.445);camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
 const fake={interactive:false,environmentScene:'classroom',appRoot:{classList:{contains:()=>true},querySelector:()=>main},homeFrame:{shiftY:.22,shiftX:0},frameShiftX:0,overview:{active:false,home:{}},current:{root},host:{getBoundingClientRect:()=>hostRect},camera,reducedMotion:false};
 const x=()=>{root.updateMatrixWorld(true);camera.updateMatrixWorld(true);const center=board.localToWorld(new THREE.Vector3()).project(camera);return hostRect.left+(center.x+1)*hostRect.width/2;};
 const settle=()=>{for(let i=0;i<100;i++)EnvironmentBackdrop.prototype.updateClassroomComposition.call(fake,.016);return x();};
 const right=settle();panelLeft=930;const middle=settle();panelLeft=330;const left=settle();
 assert.ok(Math.abs(right-930)<1,`right dock board center ${right}`);
 assert.ok(Math.abs(middle-1130)<1,`mid-drag board center ${middle}`);
 assert.ok(Math.abs(left-1330)<1,`left dock board center ${left}`);
 assert.ok(right<middle&&middle<left);
});

test('projected board stays clear of either dock and remains reachable by a moving eraser',async()=>{
 const THREE=await import('three'),{EnvironmentBackdrop}=await import('../src/ui/environment-backdrop.mjs'),{BlackboardDrawingController}=await import('../src/ui/blackboard-drawing.mjs'),{intersectsBoard}=await import('../src/ui/blackboard-sweep.mjs');
 for(const [width,height,mainLeft,panelWidth] of [[1952,1276,330,400],[1440,1000,250,290],[1024,768,210,290]]){
  const host={left:0,top:0,width,height},mainRect={left:mainLeft,right:width-14,width:width-14-mainLeft};let panelLeft=mainRect.right-panelWidth;
  const panel={getBoundingClientRect:()=>({left:panelLeft,right:panelLeft+panelWidth,width:panelWidth})};
  const main={getBoundingClientRect:()=>mainRect,querySelector:()=>panel},root=new THREE.Group();
  const board=new THREE.Mesh(new THREE.PlaneGeometry(3.92,1.11),new THREE.MeshBasicMaterial());board.name='classroom:board';board.position.set(-2.65,1.48,-4.445);root.add(board);
  const camera=new THREE.PerspectiveCamera(29,width/height,.05,1500);camera.position.set(-2.1,2,8.3);camera.lookAt(-2.1,2,-4.445);camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
  const fake={interactive:false,environmentScene:'classroom',appRoot:{classList:{contains:()=>true},querySelector:()=>main},homeFrame:{shiftY:.22,shiftX:0},frameShiftX:0,overview:{active:false,home:{}},current:{root},host:{getBoundingClientRect:()=>host},camera,reducedMotion:false};
  const drawing=Object.create(BlackboardDrawingController.prototype);drawing.board=board;drawing.renderer={camera,gl:{domElement:{getBoundingClientRect:()=>host}}};
  const settle=()=>{for(let i=0;i<120;i++)EnvironmentBackdrop.prototype.updateClassroomComposition.call(fake,.016);return drawing.project().points;};
  let points=settle();assert.ok(Math.min(...points.map(p=>p.x))>=mainRect.left,`right dock at ${width}px: board must clear sidebar`);assert.ok(Math.max(...points.map(p=>p.x))<=panelLeft,`right dock at ${width}px: board must clear panel`);
  let hit=false,previous=panelLeft;
  for(let i=1;i<=30;i++){
   panelLeft=mainRect.right-panelWidth-(mainRect.width-panelWidth)*i/30;
   EnvironmentBackdrop.prototype.updateClassroomComposition.call(fake,.016);
   points=drawing.project().points;
   if(intersectsBoard({left:Math.min(previous,panelLeft),right:Math.max(previous,panelLeft)+panelWidth,top:0,bottom:height},points))hit=true;
   previous=panelLeft;
  }
  assert.ok(hit,`drag at ${width}px must reach board even while scene follows`);
  points=settle();assert.ok(Math.min(...points.map(p=>p.x))>=panelLeft+panelWidth,`left dock at ${width}px: board must clear panel`);assert.ok(Math.max(...points.map(p=>p.x))<=mainRect.right,`left dock at ${width}px: board must fit workspace`);
 }
});
