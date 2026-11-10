'use strict';
// Coordinates from Electron screen and BrowserWindow are device-independent pixels.
function validBody(value){
 if(!value||typeof value!=='object')return null;
 const {x,y,width,height}=value;
 if(![x,y,width,height].every(Number.isFinite)||x<0||y<0||width<=0||height<=0||x+width>1.0001||y+height>1.0001)return null;
 return {x,y,width,height};
}
function covered(rect,areas){
 const intersections=areas.map(a=>({x:Math.max(a.x,rect.x),right:Math.min(a.x+a.width,rect.x+rect.width),y:Math.max(a.y,rect.y),bottom:Math.min(a.y+a.height,rect.y+rect.height)})).filter(a=>a.right>a.x&&a.bottom>a.y);
 const xs=[rect.x,rect.x+rect.width,...intersections.flatMap(a=>[a.x,a.right])].sort((a,b)=>a-b);let sum=0;
 for(let i=1;i<xs.length;i++){const x=xs[i-1],right=xs[i];if(right<=x)continue;const spans=intersections.filter(a=>a.x<=x&&a.right>=right).map(a=>[a.y,a.bottom]).sort((a,b)=>a[0]-b[0]);let start=null,end=0,total=0;for(const [lo,hi]of spans){if(start===null){start=lo;end=hi}else if(lo<=end)end=Math.max(end,hi);else{total+=end-start;start=lo;end=hi}}if(start!==null)total+=end-start;sum+=(right-x)*total;}
 return sum>=rect.width*rect.height-0.01;
}
function clampSubject(bounds,body,areas){
 const b=validBody(body),valid=areas.filter(a=>a&&[a.x,a.y,a.width,a.height].every(Number.isFinite)&&a.width>0&&a.height>0);
 if(!b||!valid.length)return null;
 const box={x:bounds.x+b.x*bounds.width,y:bounds.y+b.y*bounds.height,width:b.width*bounds.width,height:b.height*bounds.height};
 if(covered(box,valid))return {...bounds,x:Math.round(bounds.x),y:Math.round(bounds.y)};
 let best=null;
 for(const a of valid){
  const subjectX=box.width<=a.width?Math.max(a.x,Math.min(box.x,a.x+a.width-box.width)):a.x+(a.width-box.width)/2;
  const subjectY=box.height<=a.height?Math.max(a.y,Math.min(box.y,a.y+a.height-box.height)):a.y+(a.height-box.height)/2;
  const candidate={...bounds,x:Math.round(subjectX-b.x*bounds.width),y:Math.round(subjectY-b.y*bounds.height)};
  const distance=(candidate.x-bounds.x)**2+(candidate.y-bounds.y)**2;if(!best||distance<best.distance)best={candidate,distance};
 }
 return best.candidate;
}
module.exports={validBody,covered,clampSubject};

// Plan against measured canvas rectangles in Electron's DIP coordinate space.
// A canvas rectangle is only a viewport, not the model's projected body bounds;
// callers must use independently measured projection data before claiming exact
// visual calibration between different cameras/renderers.
function planDesktopAlignment({workArea, mainBounds, contentBounds, frame, modelBounds, modelCanvas, lockMain=false}) {
 const rect = value => value && ['x','y','width','height'].every(k => Number.isFinite(value[k])) && value.width > 0 && value.height > 0;
 if (![workArea,mainBounds,contentBounds,frame,modelBounds,modelCanvas].every(rect)) return null;
 // Resizing the main window would invalidate its last measured frame rectangle.
 // Ask the renderer to lay it out again instead of guessing on small displays.
 if (!lockMain && (mainBounds.width > workArea.width || mainBounds.height > workArea.height)) return null;
 const insets={left:modelCanvas.x,top:modelCanvas.y,right:modelBounds.width-modelCanvas.x-modelCanvas.width,bottom:modelBounds.height-modelCanvas.y-modelCanvas.height};
 if (Object.values(insets).some(value=>value < -0.01)) return null;
 if (frame.x < 0 || frame.y < 0 || frame.x+frame.width > contentBounds.width+0.01 || frame.y+frame.height > contentBounds.height+0.01) return null;
 const source={x:modelBounds.x+modelCanvas.x,y:modelBounds.y+modelCanvas.y,width:modelCanvas.width,height:modelCanvas.height};
 const contentOffset={x:contentBounds.x-mainBounds.x,y:contentBounds.y-mainBounds.y};
 // Preserve the canvas foot-centre when possible; clamping chooses the nearest
 // legal main-window position on the display containing the desktop character.
 const desiredX=source.x+source.width/2-frame.x-frame.width/2-contentOffset.x;
 const desiredY=source.y+source.height-frame.y-frame.height-contentOffset.y;
 const clamp=(value,min,max)=>Math.max(min,Math.min(value,max));
 const main=lockMain?{...mainBounds}:{...mainBounds,x:Math.round(clamp(desiredX,workArea.x,workArea.x+workArea.width-mainBounds.width)),y:Math.round(clamp(desiredY,workArea.y,workArea.y+workArea.height-mainBounds.height))};
 const canvas={x:main.x+contentOffset.x+frame.x,y:main.y+contentOffset.y+frame.y,width:frame.width,height:frame.height};
 // Maximized native bounds may extend outside the work area by the frame
 // thickness. Keep the window untouched, but refuse an unsafe canvas target.
 if(lockMain&&!covered(canvas,[workArea]))return null;
 const model={x:Math.round(canvas.x-insets.left),y:Math.round(canvas.y-insets.top),width:Math.round(canvas.width+insets.left+insets.right),height:Math.round(canvas.height+insets.top+insets.bottom)};
 const moved=Math.abs(model.x-modelBounds.x)>.5||Math.abs(model.y-modelBounds.y)>.5;
 const resized=Math.abs(model.width-modelBounds.width)>.5||Math.abs(model.height-modelBounds.height)>.5;
 return {mainBounds:main,modelBounds:model,canvas,sourceCanvas:source,moved,resized,strategy:moved?(resized?'move-and-resize':'move'):(resized?'resize':'direct')};
}
module.exports.planDesktopAlignment=planDesktopAlignment;

// Each side must be measured in the renderer after layout. The sidebar,
// responsive gaps, zoom and dock controls make a mirrored rectangle unreliable.
// Prefer the candidate requiring the least movement of the measured canvas
// foot anchor. Only when movement and resize are effectively tied do we use
// the desktop side, with the existing preference as the centre-screen tie-break.
function planDesktopAlignmentCandidates({frames,preferredSide='right',...input}) {
 if (!frames || typeof frames!=='object') return null;
 const candidates=[];
 for (const side of ['left','right']) {
  const plan=planDesktopAlignment({...input,frame:frames[side]});
  if(!plan)continue;
  const source=plan.sourceCanvas,target=plan.canvas;
  const movement=Math.hypot(target.x+target.width/2-source.x-source.width/2,target.y+target.height-source.y-source.height);
  const resize=Math.abs(Math.log(target.width/source.width))+Math.abs(Math.log(target.height/source.height));
  candidates.push({...plan,side,movement,resize});
 }
 if (!candidates.length) return null;
 const area=input.workArea,source=candidates[0].sourceCanvas;
 const screenOffset=(source.x+source.width/2)-(area.x+area.width/2);
 const preferred=Math.abs(screenOffset)>area.width*.1?(screenOffset<0?'left':'right'):(preferredSide==='left'?'left':'right');
 candidates.sort((a,b)=>{
  if(Math.abs(a.movement-b.movement)>1)return a.movement-b.movement;
  if(Math.abs(a.resize-b.resize)>0.001)return a.resize-b.resize;
  return Number(b.side===preferred)-Number(a.side===preferred);
 });
 const {movement,resize,...chosen}=candidates[0];
 return chosen;
}
module.exports.planDesktopAlignmentCandidates=planDesktopAlignmentCandidates;
