// Exercise the real React workspace, drag handler, and layered scene/chat CSS.
// The preload uses in-memory data and does not access an actual user profile.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';

let preload=await fs.readFile(new URL('../scripts/ui-capture/preload.cjs',import.meta.url),'utf8');
preload=preload.replace("const {contextBridge} = require('electron');","const contextBridge={exposeInMainWorld:(name,value)=>window[name]=value};")
 .replace('reduce:true','reduce:false').replace("setupDismissedVersion:''","setupDismissedVersion:'0.4.0-base.1'");
const server=await createServer({server:{host:'127.0.0.1',port:0,watch:{ignored:['**/*']}},logLevel:'silent'});let browser;
try {
 await server.listen();
 browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
 const context=await browser.newContext({viewport:{width:1200,height:800},deviceScaleFactor:1});
 await context.addInitScript({content:preload});
 const page=await context.newPage();
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`,{waitUntil:'domcontentloaded'});
 const panel=page.locator('.character-panel'),grip=panel.locator('.character-grip');
 await grip.waitFor({state:'visible',timeout:45000});
 // High-contrast stripes make loss of scene or chat blur measurable in pixels.
 await page.addStyleTag({content:`
  .scene-ui-backdrop{background:repeating-linear-gradient(90deg,#000 0 4px,#fff 4px 8px)!important}
  .scene-ui-backdrop>div{display:none}.workspace{background:transparent!important}
  .chat-scroll{background:repeating-linear-gradient(90deg,#000 0 4px,#fff 4px 8px)!important}.chat-scroll>*{visibility:hidden}
  .character-panel{background:transparent!important;box-shadow:none!important}
  .character-panel::before,.character-panel::after{display:none}.character-panel>*{visibility:hidden}
  .character-panel .stage-top,.character-panel .stage-top *{visibility:visible}
 `});
 await page.waitForTimeout(300);
 async function contrastAt(points){
  const screenshot=await page.screenshot();
  return page.evaluate(async({src,points})=>{
   const image=new Image();image.src=src;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
   const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const scale=image.width/innerWidth;
   return points.map(({x,y})=>{const data=ctx.getImageData(Math.round(x*scale),Math.round(y*scale),Math.round(80*scale),Math.round(12*scale)).data;let sum=0;for(let i=0;i<data.length;i+=4)sum+=Math.abs(data[i]-128);return sum/(data.length/4)});
  },{src:'data:image/png;base64,'+screenshot.toString('base64'),points});
 }
 const title=await page.locator('.titlebar').boundingBox(),chat=await page.locator('.chat-scroll').boundingBox();
 const scenePoint={x:title.x+400,y:title.y+4},chatPoint={x:chat.x+55,y:chat.y+90};
 const baseline=await contrastAt([scenePoint,chatPoint]);
 assert.ok(baseline.every(value=>value>90),`fixture must begin sharp: ${baseline}`);
 const handle=await grip.boundingBox();await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();
 await panel.evaluate(el=>el.classList.contains('is-dragging')||new Promise(resolve=>{const observer=new MutationObserver(()=>{if(el.classList.contains('is-dragging')){observer.disconnect();resolve()}});observer.observe(el,{attributes:true})}));
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('.scene-ui-backdrop')).filter.includes('yukino-drag-focus-scene'));
 const dragBox=await panel.boundingBox(),inside={x:dragBox.x+60,y:dragBox.y+100};
 const active=await contrastAt([scenePoint,chatPoint,inside]);
 assert.ok(active[0]<baseline[0]*.55,`scene outside main must blur: ${active}`);
 assert.ok(active[1]<baseline[1]*.55,`chat must blur: ${active}`);
 assert.ok(active[2]>70,`scene inside panel must remain sharp: ${active}`);
 // Move the panel over the chat and check that its transparent cutout follows.
 await page.mouse.move(handle.x+handle.width/2-280,handle.y+handle.height/2,{steps:6});
 await page.waitForFunction(()=>{const p=document.querySelector('.character-panel').getBoundingClientRect(),r=document.querySelector('.scene-ui-backdrop').getBoundingClientRect(),hole=document.querySelector('#yukino-drag-focus-scene feImage');return Math.abs(Number(hole.getAttribute('x'))-(p.left-r.left))<2});
 const moved=await panel.boundingBox(),movedInside={x:moved.x+60,y:moved.y+100};
 assert.ok((await contrastAt([movedInside]))[0]>70,'moving panel keeps the covered background sharp');
 await page.setViewportSize({width:1280,height:820});
 await page.waitForFunction(()=>{const p=document.querySelector('.character-panel').getBoundingClientRect(),r=document.querySelector('.scene-ui-backdrop').getBoundingClientRect(),hole=document.querySelector('#yukino-drag-focus-scene feImage');return Math.abs(Number(hole.getAttribute('x'))-(p.left-r.left))<2&&Math.abs(Number(hole.getAttribute('width'))-p.width)<2});
 await page.mouse.up();
 await page.waitForFunction(()=>!document.querySelector('.character-panel.is-dragging'));
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('.scene-ui-backdrop')).filter==='none');
 assert.ok((await contrastAt([scenePoint]))[0]>90,'scene returns to sharp after release');
 await page.emulateMedia({reducedMotion:'reduce'});
 const second=await grip.boundingBox();await page.mouse.move(second.x+second.width/2,second.y+second.height/2);await page.mouse.down();
 await page.waitForFunction(()=>document.querySelector('.character-panel.is-dragging'));
 assert.match(await page.locator('.scene-ui-backdrop').evaluate(el=>getComputedStyle(el).filter),/yukino-drag-focus-scene/);
 await page.mouse.up();await page.emulateMedia({reducedMotion:'no-preference'});
 await page.locator('.app').evaluate(el=>el.classList.add('reduce'));
 const third=await grip.boundingBox();await page.mouse.move(third.x+third.width/2,third.y+third.height/2);await page.mouse.down();
 await page.waitForFunction(()=>document.querySelector('.character-panel.is-dragging'));
 assert.match(await page.locator('.scene-ui-backdrop').evaluate(el=>getComputedStyle(el).filter),/yukino-drag-focus-scene/);
 assert.match(await page.locator('.main .chat').evaluate(el=>getComputedStyle(el).filter),/yukino-drag-focus-chat/);
 await page.mouse.up();
 await page.locator('.app').evaluate(el=>el.classList.remove('reduce'));
 await page.emulateMedia({forcedColors:'active'});
 assert.equal(await page.locator('.scene-ui-backdrop').evaluate(el=>getComputedStyle(el).filter),'none');
 await context.close();
 // Local mode masks the same global scene, with a sharp cutout following the panel.
 const local=await browser.newContext({viewport:{width:1200,height:800},deviceScaleFactor:1});
 await local.addInitScript({content:preload.replace('showAvatar:true,width:290','showAvatar:true,presentation:{scene:"classroom",sceneEnabled:true,spread:false,wallpaper:{enabled:false,items:[]}},width:290')});
 const localPage=await local.newPage();await localPage.goto(`http://127.0.0.1:${server.httpServer.address().port}/`,{waitUntil:'domcontentloaded'});
 const localGrip=localPage.locator('.character-grip'),localBackdrop=localPage.locator('.scene-ui-backdrop.is-panel-scene');
 await localGrip.waitFor({state:'visible',timeout:45000});await localBackdrop.waitFor({state:'attached'});
 const localHandle=await localGrip.boundingBox();await localPage.mouse.move(localHandle.x+localHandle.width/2,localHandle.y+localHandle.height/2);await localPage.mouse.down();
 await localPage.waitForFunction(()=>document.querySelector('.character-panel.is-dragging'));
 assert.match(await localBackdrop.evaluate(el=>getComputedStyle(el).filter),/yukino-drag-focus-scene/);
 assert.equal(await localPage.locator('.environment-backdrop-canvas').count(),1);
 assert.equal(await localPage.locator('.character-panel').evaluate(el=>getComputedStyle(el).backdropFilter),'blur(0px)');
 await localPage.mouse.up();await local.close();
 console.log('Scene and chat blur outside the moving clear panel; both fade away and respect reduced motion.');
} finally {await browser?.close();await server.close()}
