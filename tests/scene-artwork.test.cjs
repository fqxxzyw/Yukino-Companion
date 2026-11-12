const test=require('node:test'),assert=require('node:assert/strict');

function context(){
 const calls=[],ctx={canvas:{width:1568,height:444},measureText:text=>({width:[...text].length*40})};
 for(const name of ['save','restore','beginPath','moveTo','lineTo','stroke','fillRect','rect','clip','translate','rotate','scale'])ctx[name]=(...args)=>calls.push([name,...args]);
 ctx.fillText=(...args)=>calls.push(['fillText',...args,ctx.font,ctx.fillStyle]);
 ctx.strokeText=(...args)=>calls.push(['strokeText',...args,ctx.font,ctx.strokeStyle]);
 return {ctx,calls};
}

test('poster writes text a character at a time and draws artwork progressively',async()=>{
 const {drawPoster}=await import('../src/ui/scene-artwork.mjs');
 const poster={text:'生日快乐',elements:[{type:'heart',x:.7,y:.7,size:.18,color:'pink'},{type:'path',points:[[.2,.2],[.4,.3],[.5,.4]],color:'yellow'}]};
 const f=context();drawPoster(f.ctx,poster,0);assert.equal(f.calls.some(call=>call[0]==='fillText'||call[0]==='stroke'),false);
 f.calls.length=0;drawPoster(f.ctx,poster,.1);const early=f.calls.filter(call=>call[0]==='fillText').map(call=>call[1]);assert.ok(early.length>0&&early.length<4);assert.deepEqual(early,[...'生日快乐'].slice(0,early.length));
 f.calls.length=0;drawPoster(f.ctx,poster,1);const glyphs=f.calls.filter(call=>call[0]==='fillText');assert.deepEqual(glyphs.map(call=>call[1]),[...'生日快乐']);assert.ok(glyphs.every(call=>call[2]>=f.ctx.canvas.width*.52),'text avoids the left-hand conversation overlay');assert.ok(f.calls.filter(call=>call[0]==='stroke').length>=2);
});

test('paths are partially traced, arbitrary instructions are ignored, and inputs remain bounded',async()=>{
 const {drawPoster}=await import('../src/ui/scene-artwork.mjs');
 const poster={text:'',elements:[{type:'path',color:'white',points:[[.1,.1],[.9,.1]]},{type:'eval',code:'throw Error("unsafe")'},{type:'cake',x:4,y:4,size:1}]};
 const f=context();drawPoster(f.ctx,poster,.5);const half=f.calls.filter(call=>call[0]==='lineTo').at(-1);assert.ok(half[1]>.1*1568&&half[1]<.9*1568);assert.ok(Math.abs(half[2]-.1*444)<2);
 f.calls.length=0;drawPoster(f.ctx,poster,1);const full=f.calls.filter(call=>call[0]==='lineTo').at(-1);assert.ok(Math.abs(full[1]-.9*1568)<1e-8);assert.ok(f.calls.every(call=>call.slice(1).filter(value=>typeof value==='number').every(Number.isFinite)));
});

test('each decorative vocabulary item produces visible chalk strokes',async()=>{
 const {drawPoster}=await import('../src/ui/scene-artwork.mjs');
 for(const type of ['cake','balloon','heart','star','flower']){const f=context();drawPoster(f.ctx,{text:'',elements:[{type,x:.7,y:.5,size:.16,color:'blue'}]},1);assert.ok(f.calls.some(call=>call[0]==='stroke'),type);}
});

test('chalk texture remains identical across repeated frames at the same progress',async()=>{
 const {drawPoster}=await import('../src/ui/scene-artwork.mjs'),f=context();
 const poster={text:'你好吗',elements:[{type:'star',x:.3,y:.5,size:.2,color:'yellow'}]};
 drawPoster(f.ctx,poster,.75);const first=f.calls.slice();f.calls.length=0;drawPoster(f.ctx,poster,.75);assert.deepEqual(f.calls,first);
});

test('the model title controls its lettering, placement, and reveal order',async()=>{
 const {drawPoster}=await import('../src/ui/scene-artwork.mjs');
 const title={text:'生日快乐',x:.72,y:.4,size:.34,style:'ribbon',color:'yellow',accent:'pink',spacing:.2,rotation:-4,letters:[{dy:.15,color:'blue',scale:1.15},null,{rotation:8},null]};
 const poster={title,text:'生日快乐',elements:[]},f=context();
 drawPoster(f.ctx,poster,.2);
 assert.deepEqual(f.calls.filter(call=>call[0]==='fillText').map(call=>call[1]),['生']);
 f.calls.length=0;
 drawPoster(f.ctx,poster,1);
 const fronts=f.calls.filter(call=>call[0]==='fillText');
 assert.deepEqual(fronts.map(call=>call[1]),[...'生日快乐'],'the subtitle does not repeat the title');
 assert.match(fronts[0][4],/173\.6\d*px LiSu/);
 assert.equal(fronts[0][5],'#a5d5e5');
 assert.equal(fronts[1][5],'#f5d67a');
 assert.ok(f.calls.filter(call=>call[0]==='strokeText').every(call=>call[5]==='#f3aeb8'));
 const origins=f.calls.filter(call=>call[0]==='translate');
 assert.ok(origins.every(call=>call[1]>.55*1568),'the model selected the right side of the board');
 assert.ok(origins[0][2]>origins[1][2],'the first character is staggered down');
 const angles=f.calls.filter(call=>call[0]==='rotate').map(call=>call[1]);
 assert.ok(angles[0]<0&&angles[2]>0);
});

test('display lettering fits the board even when a rotated title is placed at an edge',async()=>{
 const {drawPoster}=await import('../src/ui/scene-artwork.mjs'),f=context();
 const title={text:'星'.repeat(32),x:1,y:0,size:.42,style:'outline',rotation:16,spacing:.35,color:'white'};
 drawPoster(f.ctx,{title},1);
 const origins=f.calls.filter(call=>call[0]==='translate');
 assert.equal(origins.length,32);
 assert.ok(origins.every(([,x,y])=>x>0&&x<1568&&y>0&&y<444));
 assert.ok(f.calls.filter(call=>call[0]==='scale').every(([,x,y])=>x>0&&x<1&&y===x));
});
