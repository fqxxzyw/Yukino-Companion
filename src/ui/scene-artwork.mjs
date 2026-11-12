// A small, bounded vocabulary of chalk strokes. The model supplies data only;
// it never supplies JavaScript, SVG markup, URLs, fonts, or Canvas commands.
const COLORS=Object.freeze({white:'#f8f6e9',pink:'#f3aeb8',yellow:'#f5d67a',blue:'#a5d5e5',green:'#b9dda6'});
const TYPES=new Set(['cake','balloon','heart','star','flower','path']);
const limit=(v,a,b)=>Math.min(b,Math.max(a,v));
const valid=v=>Number.isFinite(v)&&v>=0&&v<=1;
const cache=new WeakMap();
const TITLE_FONTS=Object.freeze({
 brush:'normal %px KaiTi, STKaiti, "Microsoft YaHei", cursive',
 outline:'900 %px SimHei, "Microsoft YaHei", sans-serif',
 ribbon:'bold %px LiSu, STKaiti, KaiTi, "Microsoft YaHei", serif',
 block:'900 %px SimHei, "Microsoft YaHei", sans-serif'
});
const radians=(value,bound)=>Number.isFinite(value)?limit(value,-bound,bound)*Math.PI/180:0;
const valueIn=(value,min,max,fallback)=>Number.isFinite(value)?limit(value,min,max):fallback;
const colorFor=(name,fallback)=>Object.hasOwn(COLORS,name)?COLORS[name]:fallback;

function ellipse(cx,cy,rx,ry,start=0,end=Math.PI*2,count=32){
 return Array.from({length:count+1},(_,i)=>{const angle=start+(end-start)*i/count;return [cx+Math.cos(angle)*rx,cy+Math.sin(angle)*ry];});
}
function figure(type,x,y,r){
 if(type==='balloon')return [ellipse(x,y-r*.23,r*.48,r*.62),[[x,y+r*.39],[x-r*.07,y+r*.48],[x+r*.07,y+r*.48],[x,y+r*.39]],[[x,y+r*.48],[x+r*.08,y+r*.67],[x-r*.06,y+r*.84],[x,y+r]]];
 if(type==='heart')return [Array.from({length:45},(_,i)=>{const t=Math.PI*2*i/44;return [x+r*.045*16*Math.sin(t)**3,y-r*.045*(13*Math.cos(t)-5*Math.cos(2*t)-2*Math.cos(3*t)-Math.cos(4*t))];})];
 if(type==='star')return [Array.from({length:11},(_,i)=>{const t=-Math.PI/2+i*Math.PI/5,a=i%2?r*.38:r*.82;return [x+Math.cos(t)*a,y+Math.sin(t)*a];})];
 if(type==='flower')return [...Array.from({length:6},(_,i)=>{const t=i*Math.PI/3;return ellipse(x+Math.cos(t)*r*.43,y+Math.sin(t)*r*.43,r*.28,r*.28,0,Math.PI*2,16);}),ellipse(x,y,r*.20,r*.20,0,Math.PI*2,16),[[x,y+r*.65],[x,y+r]]];
 if(type==='cake')return [
  [[x-r*.8,y+r*.65],[x+r*.8,y+r*.65]],
  [[x-r*.67,y+r*.56],[x-r*.67,y-r*.05],[x+r*.67,y-r*.05],[x+r*.67,y+r*.56],[x-r*.67,y+r*.56]],
  [[x-r*.65,y+r*.18],[x-r*.47,y+r*.28],[x-r*.29,y+r*.18],[x-r*.11,y+r*.28],[x+r*.07,y+r*.18],[x+r*.25,y+r*.28],[x+r*.43,y+r*.18],[x+r*.64,y+r*.28]],
  [[x-r*.12,y-r*.05],[x-r*.12,y-r*.48],[x+r*.12,y-r*.48],[x+r*.12,y-r*.05]],
  [[x,y-r*.5],[x-r*.12,y-r*.68],[x,y-r*.9],[x+r*.12,y-r*.68],[x,y-r*.5]]
 ];
 return [];
}

// Deterministic, sub-pixel hand variation: the same poster must not flicker
// between frames while its strokes are replayed.
function roughen(points,seed){
 const out=[points[0]];let sample=0;
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]),steps=Math.min(32,Math.max(1,Math.ceil(length/9)));
  for(let j=1;j<=steps;j++){
   const t=j/steps,n=Math.sin((sample+1)*1.73+seed*2.17)*.9+Math.sin((sample+1)*.39+seed)*.45;
   const edge=j===steps&&i===points.length-1?0:n;sample++;
   out.push([a[0]+(b[0]-a[0])*t+(length?-(b[1]-a[1])/length*edge:0),a[1]+(b[1]-a[1])*t+(length?(b[0]-a[0])/length*edge:0)]);
  }
 }
 return out;
}

function textUnits(ctx,text,width,height,area=null){
 const chars=Array.from(text.replace(/\r\n?/g,'\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g,'')).slice(0,300);
 if(!chars.length)return [];
 // On the live scene the chat caption is on the left. Reserve the right half
 // for the lettering, while illustrations may use the whole board.
 const left=area?.left??width*.52,right=area?.right??width*.97,top=area?.top??height*.12,maxWidth=right-left,maxHeight=area?area.bottom-area.top:height*.78;
 let rows=[],size=0;
 for(size=area?36:62;size>=24;size-=2){
  ctx.font=`${size}px KaiTi, STKaiti, "Microsoft YaHei", cursive`;
  rows=[[]];let x=0;
  for(const ch of chars){
   if(ch==='\n'){rows.push([]);x=0;continue;}
   const m=ctx.measureText(ch)?.width,advance=Number.isFinite(m)&&m>0?m:size;
   if(x+advance>maxWidth&&rows.at(-1).length){rows.push([]);x=0;}
   rows.at(-1).push({ch,x,advance});x+=advance;
  }
  if(rows.length*size*1.32<=maxHeight)break;
 }
 size=Math.max(24,size);const lineHeight=size*1.32,maxRows=Math.max(1,Math.floor(maxHeight/lineHeight));
 const units=[];
 rows.slice(0,maxRows).forEach((row,index)=>{
  const lineWidth=row.reduce((sum,g)=>sum+g.advance,0),offset=(maxWidth-lineWidth)/2;
  for(const glyph of row)units.push({kind:'glyph',char:glyph.ch,x:left+offset+glyph.x,y:top+index*lineHeight,size,weight:size*.85});
 });
 return units;
}

function titleUnits(ctx,title,width,height){
 if(typeof title?.text!=='string'||!valid(title.x)||!valid(title.y))return null;
 const chars=Array.from(title.text.trim()).slice(0,32);
 if(!chars.length)return null;
 const style=Object.hasOwn(TITLE_FONTS,title.style)?title.style:'brush';
 const size=height*valueIn(title.size,.08,.42,.32),spacing=size*valueIn(title.spacing,0,.35,.10);
 const rotation=radians(title.rotation,16),color=colorFor(title.color,COLORS.white),accent=colorFor(title.accent,COLORS.pink);
 const units=[],bounds={left:Infinity,right:-Infinity,top:Infinity,bottom:-Infinity};
 let cursor=0;
 ctx.save();
 ctx.textBaseline='alphabetic';
 chars.forEach((char,index)=>{
  const letter=Array.isArray(title.letters)?title.letters[index]:null;
  const letterSize=size*valueIn(letter?.scale,.75,1.25,1),font=TITLE_FONTS[style].replace('%',letterSize);
  ctx.font=font;
  const metrics=ctx.measureText(char);
  const advance=metrics.width||letterSize,ascent=metrics.actualBoundingBoxAscent??letterSize*.78,descent=metrics.actualBoundingBoxDescent??letterSize*.18;
  const baseline=(ascent-descent)/2,offset=-advance/2;
  const dx=cursor+advance/2,dy=size*valueIn(letter?.dy,-.2,.2,0),angle=rotation+radians(letter?.rotation,20);
  const x=dx*Math.cos(rotation)-dy*Math.sin(rotation),y=dx*Math.sin(rotation)+dy*Math.cos(rotation);
  const padding=letterSize*.11;
  const left=offset-(metrics.actualBoundingBoxLeft??0)-padding,right=offset+(metrics.actualBoundingBoxRight??advance)+padding;
  const top=baseline-ascent-padding,bottom=baseline+descent+padding;
  for(const a of [left,right])for(const b of [top,bottom]){
   const px=x+a*Math.cos(angle)-b*Math.sin(angle),py=y+a*Math.sin(angle)+b*Math.cos(angle);
   bounds.left=Math.min(bounds.left,px);bounds.right=Math.max(bounds.right,px);
   bounds.top=Math.min(bounds.top,py);bounds.bottom=Math.max(bounds.bottom,py);
  }
  units.push({kind:'title',char,x,y,angle,baseline,offset,left,right,top,bottom,size:letterSize,font,style,color:colorFor(letter?.color,color),accent,weight:letterSize*.85});
  cursor+=advance+spacing;
 });
 ctx.restore();
 const padding=height*.04,scale=Math.min(1,(width-padding*2)/(bounds.right-bounds.left),(height-padding*2)/(bounds.bottom-bounds.top));
 const shiftX=limit(width*title.x-(bounds.left+bounds.right)*scale/2,padding-bounds.left*scale,width-padding-bounds.right*scale);
 const shiftY=limit(height*title.y-(bounds.top+bounds.bottom)*scale/2,padding-bounds.top*scale,height-padding-bounds.bottom*scale);
 return {
  units:units.map(unit=>({...unit,x:shiftX+unit.x*scale,y:shiftY+unit.y*scale,scale})),
  bounds:{left:shiftX+bounds.left*scale,right:shiftX+bounds.right*scale,top:shiftY+bounds.top*scale,bottom:shiftY+bounds.bottom*scale}
 };
}

function secondaryArea(bounds,width,height){
 const pad=height*.055;
 const bodyWidth=Math.min(width-pad*2,Math.max(width*.42,bounds.right-bounds.left));
 const bodyLeft=limit((bounds.left+bounds.right-bodyWidth)/2,pad,width-pad-bodyWidth);
 const below={left:bodyLeft,right:bodyLeft+bodyWidth,top:bounds.bottom+pad,bottom:height-pad};
 if(below.bottom-below.top>=45)return below;
 const above={...below,top:pad,bottom:bounds.top-pad};
 if(above.bottom-above.top>=45)return above;
 const left={left:pad,right:bounds.left-pad,top:pad,bottom:height-pad};
 const right={...left,left:bounds.right+pad,right:width-pad};
 const side=left.right-left.left>=right.right-right.left?left:right;
 return side.right-side.left>=80?side:null;
}

function compile(ctx,poster){
 const width=ctx.canvas.width,height=ctx.canvas.height,units=[];
 const title=titleUnits(ctx,poster.title,width,height),text=typeof poster.text==='string'?poster.text:'';
 const area=title?secondaryArea(title.bounds,width,height):null;
 const lettering=title&&(!area||text.trim()===poster.title.text.trim())?[]:textUnits(ctx,text,width,height,area);
 const textBounds=title?.bounds??(lettering.length?{left:Math.min(...lettering.map(g=>g.x))-8,right:Math.max(...lettering.map(g=>g.x+g.size))+8,top:Math.min(...lettering.map(g=>g.y))-8,bottom:Math.max(...lettering.map(g=>g.y+g.size))+8}:null);
 const elements=Array.isArray(poster.elements)?poster.elements.slice(0,48):[];
 for(const element of elements){
  if(!element||!TYPES.has(element.type))continue;
  const color=COLORS[element.color]||COLORS.white;let strokes=[];
  if(element.type==='path'){
   if(!Array.isArray(element.points))continue;
   const points=element.points.slice(0,160).filter(p=>Array.isArray(p)&&valid(p[0])&&valid(p[1])).map(p=>[p[0]*width,p[1]*height]);
   if(points.length>1)strokes=[points];
  }else if(valid(element.x)&&valid(element.y)){
   const size=Number.isFinite(element.size)?limit(element.size,.025,.38):.15;
   strokes=figure(element.type,element.x*width,element.y*height,size*height);
   // Guard against a common model layout mistake: decoration directly on top
   // of the title. Move an overlapping icon below it if there is space.
   if(textBounds&&strokes.length){
    const points=strokes.flat(),left=Math.min(...points.map(p=>p[0])),right=Math.max(...points.map(p=>p[0])),top=Math.min(...points.map(p=>p[1])),bottom=Math.max(...points.map(p=>p[1]));
    if(right>textBounds.left&&left<textBounds.right&&bottom>textBounds.top&&top<textBounds.bottom){const delta=textBounds.bottom-top+8;if(bottom+delta<height*.98)strokes=strokes.map(stroke=>stroke.map(([x,y])=>[x,y+delta]));}
   }
  }
  for(const original of strokes){
   const points=roughen(original,units.length+1);
   let length=0;for(let i=1;i<points.length;i++)length+=Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]);
   if(length>0)units.push({kind:'stroke',points,color,length,weight:Math.max(10,length)});
  }
 }
 // Writing appears first, then decorative strokes grow around it.
 return [...(title?.units??[]),...lettering,...units];
}

function strokePart(ctx,unit,fraction){
 let remaining=unit.length*limit(fraction,0,1);if(remaining<=0)return;
 ctx.strokeStyle=unit.color;ctx.lineWidth=3.2;ctx.lineCap='round';ctx.lineJoin='round';ctx.globalAlpha=.9;ctx.beginPath();
 ctx.moveTo(unit.points[0][0],unit.points[0][1]);
 const dust=[];
 for(let i=1;i<unit.points.length;i++){
  const a=unit.points[i-1],b=unit.points[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
  if(length<=remaining){ctx.lineTo(b[0],b[1]);remaining-=length;if(i%4===0&&dust.length<160)dust.push([b[0]+Math.sin(i*3.23)*4,b[1]+Math.cos(i*2.17)*4]);}
  else{const t=length?remaining/length:0;ctx.lineTo(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t);break;}
 }
 ctx.stroke();ctx.fillStyle=unit.color;ctx.globalAlpha=.38;for(const [x,y]of dust)ctx.fillRect(x,y,1.4,1.4);
}

function drawTitleGlyph(ctx,glyph,fraction,index){
 const {char,x,y,angle,scale,font,style,color,accent,size,offset,baseline,left,right,top,bottom}=glyph;
 ctx.save();
 ctx.translate(x,y);ctx.rotate(angle);ctx.scale(scale,scale);
 if(fraction<1){
  ctx.beginPath();ctx.rect(left,top,(right-left)*fraction,bottom-top);ctx.clip();
 }
 ctx.font=font;ctx.textBaseline='alphabetic';ctx.lineJoin='round';ctx.globalAlpha=.96;
 ctx.fillStyle=accent;ctx.strokeStyle=accent;
 if(style==='brush'){
  ctx.globalAlpha=.7;
  ctx.fillText(char,offset+size*.022,baseline+size*.032);
 }else if(style==='outline'){
  ctx.lineWidth=size*.038;
  ctx.strokeText(char,offset+size*.024,baseline+size*.029);
  ctx.globalAlpha=.25;
  ctx.fillText(char,offset,baseline);
 }else if(style==='ribbon'){
  ctx.lineWidth=size*.083;
  ctx.strokeText(char,offset,baseline);
 }else if(style==='block'){
  ctx.lineWidth=size*.028;
  for(const depth of [.07,.05,.03]){
   ctx.strokeText(char,offset+size*depth,baseline+size*depth);
   ctx.fillText(char,offset+size*depth,baseline+size*depth);
  }
 }
 ctx.globalAlpha=.96;ctx.fillStyle=color;ctx.strokeStyle=color;
 if(style==='outline'){
  ctx.lineWidth=size*.033;
  ctx.strokeText(char,offset,baseline);
 }else{
  ctx.fillText(char,offset,baseline);
 }
 ctx.globalCompositeOperation='destination-out';ctx.globalAlpha=.52;
 const grains=Math.min(135,Math.ceil(size*.65));
 for(let n=0;n<grains;n++){
  const px=left+(right-left)*((n*41+index*17)%137)/137,py=top+(bottom-top)*((n*61+index*29)%131)/131;
  ctx.fillRect(px,py,1.8+(n%3)*.3,1.5);
 }
 ctx.restore();
}

/** Paint a poster's first progress fraction, without clearing the caller's canvas. */
export function drawPoster(ctx,poster,progress=1){
 if(!ctx?.canvas||!poster||typeof poster!=='object'||Array.isArray(poster))return;
 let entry=cache.get(poster);
 if(!entry||entry.width!==ctx.canvas.width||entry.height!==ctx.canvas.height){
  const units=compile(ctx,poster);entry={width:ctx.canvas.width,height:ctx.canvas.height,units,total:units.reduce((sum,u)=>sum+u.weight,0)};cache.set(poster,entry);
 }
 let budget=entry.total*limit(Number.isFinite(progress)?progress:0,0,1);
 ctx.save();ctx.textBaseline='top';
 for(let index=0;index<entry.units.length&&budget>0;index++){
  const unit=entry.units[index],fraction=Math.min(1,budget/unit.weight);
  if(unit.kind==='stroke')strokePart(ctx,unit,fraction);
  else if(unit.kind==='title')drawTitleGlyph(ctx,unit,fraction,index);
  else if(fraction>0){
   // KaiTi is a brush/handwriting font available on common Chinese Windows
   // installations; deterministic offsets keep the lettering human and stable.
   const wiggle=Math.sin(index*2.43)*unit.size*.035;
   ctx.save();ctx.beginPath();ctx.rect(unit.x-2,unit.y-unit.size*.1,unit.size*1.45*fraction+2,unit.size*1.4);ctx.clip();
   ctx.globalAlpha=.9;ctx.fillStyle=COLORS.white;ctx.font=`${unit.size}px KaiTi, STKaiti, "Microsoft YaHei", cursive`;
   ctx.fillText(unit.char,unit.x,unit.y+wiggle);
   // Tiny deterministic gaps break up the solid font fill like dry chalk.
   ctx.globalCompositeOperation='destination-out';ctx.globalAlpha=.48;
   for(let n=0;n<12;n++){const x=unit.x+unit.size*(.08+((n*37+index*13)%83)/100),y=unit.y+unit.size*(.12+((n*53+index*19)%85)/100);ctx.fillRect(x,y,1.6,1.6);}
   ctx.restore();
  }
  budget-=unit.weight;
 }
 ctx.restore();
}
