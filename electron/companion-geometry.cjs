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
