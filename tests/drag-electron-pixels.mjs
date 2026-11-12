// Real Electron renderer, real WebGL scene and actual chat text. A temporary
// in-memory fixture keeps this test away from the user's installed profile.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {_electron} from 'playwright-core';
const root=fileURLToPath(new URL('../',import.meta.url)),tmp=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-drag-pixels-'));
const server=await createServer({root,server:{host:'127.0.0.1',port:0,watch:{ignored:['**/*']}},logLevel:'silent'});
let application;
try{
 await server.listen();
 let fixture=await fs.readFile(path.join(root,'scripts/ui-capture/preload.cjs'),'utf8');
 fixture=fixture.replace('showAvatar:true,width:290','showAvatar:true,presentation:{scene:"city",sceneEnabled:true,spread:true,followTime:false,fixedHour:14,wallpaper:{enabled:false,items:[]}},width:290').replace('activeConversation:null,personaEnabled','activeConversation:"qa-conversation",personaEnabled');
 const preload=path.join(tmp,'preload.cjs'),entry=path.join(tmp,'entry.cjs');await fs.writeFile(preload,fixture);
 await fs.writeFile(entry,`const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(tmp,'userData'))});if(process.env.YUKINO_DRAG_SOFTWARE_GPU==='1'){app.commandLine.appendSwitch('use-angle','swiftshader');app.commandLine.appendSwitch('enable-unsafe-swiftshader');}app.whenReady().then(()=>{const w=new BrowserWindow({width:1280,height:800,show:false,webPreferences:{preload:${JSON.stringify(preload)},contextIsolation:true,backgroundThrottling:false}});w.loadURL(${JSON.stringify(`http://127.0.0.1:${server.httpServer.address().port}/`)});w.show()});`);
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 application=await _electron.launch({args:[entry],cwd:root,env,timeout:90000});const page=await application.firstWindow();
 const setup=page.locator('.setup-dialog');await setup.waitFor({state:'visible',timeout:60000});await setup.locator('footer .text-link').click();await setup.waitFor({state:'hidden'});
 await page.waitForFunction(()=>document.querySelector('.app > .scene-ui-backdrop .environment-backdrop-canvas')?.dataset.scene==='city',null,{timeout:120000});
 console.log('media',await page.evaluate(()=>({reducedMotion:matchMedia('(prefers-reduced-motion:reduce)').matches,reducedTransparency:matchMedia('(prefers-reduced-transparency:reduce)').matches,forcedColors:matchMedia('(forced-colors:active)').matches,dpr:devicePixelRatio})));
 const panel=page.locator('.character-panel'),grip=page.locator('.character-grip'),bubble=page.locator('.message.user .message-body');await bubble.waitFor({state:'visible',timeout:30000});await bubble.scrollIntoViewIfNeeded();
 const proof=process.env.YUKINO_DRAG_PROOF_DIR;if(proof)await fs.mkdir(proof,{recursive:true});
 async function energy(box){const png=await page.screenshot();return page.evaluate(async({png,box})=>{const i=new Image();i.src=png;await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const ctx=c.getContext('2d');ctx.drawImage(i,0,0);const s=i.width/innerWidth,xx=Math.round(box.x*s),yy=Math.round(box.y*s),w=Math.max(2,Math.floor(box.width*s)),h=Math.max(2,Math.floor(box.height*s)),{data}=ctx.getImageData(xx,yy,w,h);let value=0;for(let y=0;y<h;y++)for(let x=1;x<w;x++){let n=(y*w+x)*4;for(let k=0;k<3;k++)value+=Math.abs(data[n+k]-data[n-4+k]);}return value/(w*h*3)}, {png:'data:image/png;base64,'+png.toString('base64'),box});}
 // Scene region is outside chat and outside the entire moving panel.
 const scene={x:180,y:110,width:200,height:160};
 for(const reduced of [false,true]){
  await page.locator('.app').evaluate((el,value)=>el.classList.toggle('reduce',value),reduced);
  await bubble.scrollIntoViewIfNeeded();const rawChatBox=await bubble.boundingBox(),chatBox={...rawChatBox,width:Math.min(140,rawChatBox.width)},beforeScene=await energy(scene),beforeChat=await energy(chatBox);
  assert.match(await panel.evaluate(el=>getComputedStyle(el).backdropFilter),/blur\(8px\)/,'resting character glass should blur its background');
  if(proof&&!reduced)await page.screenshot({path:path.join(proof,'before.png')});
  const start=await grip.boundingBox();await page.mouse.move(start.x+start.width/2,start.y+start.height/2);await page.mouse.down();await page.waitForFunction(()=>document.querySelector('.character-panel.is-dragging'));
  await page.mouse.move(start.x+start.width/2-100,start.y+start.height/2,{steps:12});await page.waitForTimeout(550);
  assert.match(await panel.evaluate(el=>getComputedStyle(el).backdropFilter),/blur\(0px\)/,'moving character glass should be clear');
  if(proof&&!reduced)await page.screenshot({path:path.join(proof,'dragging.png')});
  const duringScene=await energy(scene),duringChat=await energy(chatBox);
  await page.mouse.up();await page.waitForTimeout(650);
  const finalChatBox=await bubble.boundingBox(),afterScene=await energy(scene),afterChat=await energy({...finalChatBox,width:Math.min(140,finalChatBox.width)});
  console.log(JSON.stringify({reduced,beforeScene,duringScene,afterScene,beforeChat,duringChat,afterChat}));
  assert.ok(duringScene<beforeScene*.9,'scene should blur during movement');
  assert.ok(duringChat<beforeChat*.9,'real chat text should blur during movement');
  assert.ok(afterScene>duringScene*1.1,'scene should recover after release');
  assert.ok(afterChat>duringChat*1.1,'chat should recover after release');
 }
}finally{await application?.close();await server.close();}
