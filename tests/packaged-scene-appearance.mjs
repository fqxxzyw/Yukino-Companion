// Run against the Windows EXE in an isolated, disposable profile.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {_electron} from 'playwright-core';

const root=fileURLToPath(new URL('../',import.meta.url));
const source=path.resolve(process.argv[2]||'');
assert.ok(process.argv[2],'Pass the unpacked build directory');
const scratch=await fs.mkdtemp(path.join(root,'build','appearance-qa-'));
const packageCopy=path.join(scratch,'app'),roaming=path.join(scratch,'Roaming'),local=path.join(scratch,'Local'),chromium=path.join(scratch,'Chromium');
await fs.cp(source,packageCopy,{recursive:true,errorOnExist:true});
const cid='appearance-check',message='人物移动时，这一行对话应当变模糊。';
const state={activeCharacter:'yukino',activeConversation:cid,chatMode:'api',profiles:[{id:'qa',name:'QA',model:'qa-model',base:'https://example.invalid/v1'}],activeProfile:'qa',
 showAvatar:true,side:'right',width:290,reduce:false,setupDismissedVersion:'0.4.0-base.1',voiceChatWizard:{version:1,status:'skipped'},
 conversations:[{id:cid,characterId:'yukino',title:'外观验证',messages:[{id:'qa-message',role:'user',content:message}]}],
 presentation:{scene:'city',sceneEnabled:true,spread:true,followTime:false,fixedHour:14,wallpaper:{enabled:false,items:[]}}};
for(const dir of [path.join(roaming,'Yukino Companion'),local,chromium])await fs.mkdir(dir,{recursive:true});
for(const dir of [path.join(roaming,'Yukino Companion'),chromium])await fs.writeFile(path.join(dir,'state.json'),JSON.stringify(state));
const env={...process.env,APPDATA:roaming,LOCALAPPDATA:local};delete env.ELECTRON_RUN_AS_NODE;
let app;
try{
 app=await _electron.launch({executablePath:path.join(packageCopy,'Yukino Companion.exe'),args:[`--user-data-dir=${chromium}`,'--disable-background-networking'],cwd:packageCopy,env,timeout:60000});
 const actualProfile=await app.evaluate(({app})=>app.getPath('userData'));
 assert.ok(!path.relative(scratch,actualProfile).startsWith('..'),'expected an isolated Electron profile');
 const page=await app.firstWindow();
 await page.getByText(message,{exact:true}).waitFor({timeout:30000});
 await page.waitForFunction(()=>document.querySelector('.app > .scene-ui-backdrop .environment-backdrop-canvas')?.dataset.scene==='city',null,{timeout:120000});
 const sizes=await page.locator('.titlebar').evaluate(el=>[...el.querySelectorAll('.chat-source-switch,.model-pill,.scene-menu-trigger,.app-update-trigger')].map(node=>{const {width,height}=node.getBoundingClientRect();return {width,height};}));
 assert.equal(sizes.length,4);
 for(const dimension of ['width','height'])assert.ok(sizes.every(box=>Math.abs(box[dimension]-sizes[0][dimension])<=1),`toolbar sizes ${JSON.stringify(sizes)}`);
 const bubble=page.getByText(message,{exact:true});
 const {x,y,width,height}=await bubble.boundingBox(),chat={x,y,width:Math.min(92,width),height};
 const scene={x:140,y:92,width:215,height:190};
 async function sample(filename){
  const image=await page.screenshot({path:path.join(scratch,filename)});
  return page.evaluate(async({png,regions})=>{
   const image=new Image();image.src=png;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
   const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const scale=image.width/innerWidth;
   return regions.map(box=>{
    const {data,width,height}=ctx.getImageData(Math.round(box.x*scale),Math.round(box.y*scale),Math.round(box.width*scale),Math.round(box.height*scale));
    let edge=0;for(let y=0;y<height;y++)for(let x=1;x<width;x++){const p=(y*width+x)*4;for(let k=0;k<3;k++)edge+=Math.abs(data[p+k]-data[p-4+k]);}
    return edge/(width*height*3);
   });
  },{png:'data:image/png;base64,'+image.toString('base64'),regions:[scene,chat]});
 }
 const before=await sample('before.png');
 const grip=await page.locator('.character-grip').boundingBox();
 await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);await page.mouse.down();
 await page.mouse.move(grip.x+grip.width/2-150,grip.y+grip.height/2,{steps:10});
 await page.locator('.character-panel.is-dragging').waitFor();
 await page.waitForTimeout(400);
 const during=await sample('dragging.png');await page.mouse.up();
 await page.locator('.character-panel.is-dragging').waitFor({state:'hidden'});
 await page.waitForTimeout(550);
 const after=await sample('after.png');
 assert.ok(before.every((value,index)=>during[index]<value*.8&&after[index]>during[index]*1.25),JSON.stringify({before,during,after}));
 await page.getByRole('button',{name:'人物场景选项'}).click();
 assert.equal(await page.locator('.character-scene-menu .scene-choice-swatch img').count(),10);
 const imageSizes=await page.locator('.character-scene-menu .scene-choice-swatch img').evaluateAll(async images=>{for(const image of images)image.loading='eager';await Promise.all(images.map(image=>image.decode()));return images.map(image=>image.naturalWidth);});
 assert.ok(imageSizes.every(width=>width>=200));
 await page.locator('.character-scene-menu').evaluate(el=>el.scrollTop=0);await page.screenshot({path:path.join(scratch,'scene-menu.png')});
 assert.equal(await page.getByRole('switch',{name:'头部跟随',exact:true}).getAttribute('class'),'scene-switch');
 await page.evaluate(()=>window.qaFullCanvas=document.querySelector('.environment-backdrop-canvas canvas'));
 await page.getByRole('switch',{name:'扩展到整个窗口'}).uncheck();
 const localLayer=page.locator('.app > .scene-ui-backdrop.is-panel-scene');
 const aperture=await localLayer.evaluate(el=>{
  const panel=el.closest('.app').querySelector('.character-panel'),box=el.getBoundingClientRect(),view=panel.getBoundingClientRect(),clip=getComputedStyle(el).clipPath,v=clip.match(/-?[\d.]+(?=px)/g).map(Number),want=[view.top-box.top,box.right-view.right,box.bottom-view.bottom,view.left-box.left];
  return {same:want.every((value,index)=>Math.abs(value-v[index])<.5),sameCanvas:window.qaFullCanvas===document.querySelector('.environment-backdrop-canvas canvas'),radius:parseFloat(getComputedStyle(panel).borderRadius),clip};
 });
 assert.ok(aperture.same&&aperture.sameCanvas&&aperture.radius>0,JSON.stringify(aperture));
 const localHost='.app > .scene-ui-backdrop .environment-backdrop-canvas';
 await page.waitForFunction(selector=>document.querySelector(selector)?.dataset.scene==='city',localHost,{timeout:120000});
 await page.getByRole('button',{name:'人物场景选项'}).click();
 const localImage=await page.screenshot({path:path.join(scratch,'local-scene.png')});
 const fullImage=await fs.readFile(path.join(scratch,'before.png'));
 const panelBox=await page.locator('.character-panel').boundingBox();
 const visibleDifference=await page.evaluate(async({fullImage,localImage,panelBox})=>{
  const read=async data=>{const image=new Image();image.src='data:image/png;base64,'+data;await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);const scale=image.width/innerWidth;return ctx.getImageData(Math.round((panelBox.x+18)*scale),Math.round((panelBox.y+90)*scale),Math.round(28*scale),Math.round(130*scale)).data;};
  const a=await read(fullImage),b=await read(localImage);let delta=0;
  for(let i=0;i<a.length;i+=4)for(let k=0;k<3;k++)delta+=Math.abs(a[i+k]-b[i+k]);
  return delta/(a.length*.75);
 },{fullImage:fullImage.toString('base64'),localImage:localImage.toString('base64'),panelBox});
 assert.ok(visibleDifference<28,`scene in the actual local view is occluded or changed: ${visibleDifference}`);
 await page.getByRole('button',{name:'场景小菜单'}).click();
 await page.locator('.scene-menu-popover').getByRole('button',{name:'放课之后',exact:true}).click();
 await page.waitForFunction(selector=>document.querySelector(selector)?.dataset.revealing==='true',localHost,{timeout:120000});
 await page.waitForFunction(selector=>{const host=document.querySelector(selector);return host?.dataset.scene==='classroom'&&!host.dataset.revealing},localHost,{timeout:10000});
 console.log(JSON.stringify({profile:actualProfile,toolbarSizes:sizes,aperture,visibleDifference,before,during,after,screenshot:path.join(scratch,'dragging.png')}));
}finally{await app?.close()}
