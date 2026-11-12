import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';
let preload=await fs.readFile(new URL('../scripts/ui-capture/preload.cjs',import.meta.url),'utf8');
preload=preload.replace("const {contextBridge} = require('electron');","const contextBridge={exposeInMainWorld:(name,value)=>window[name]=value};")
 .replace("setupDismissedVersion:''","setupDismissedVersion:'0.4.0-base.1'")
 .replace('showAvatar:true,width:290','showAvatar:true,presentation:{scene:"city",sceneEnabled:true,spread:true,followTime:false,fixedHour:14,wallpaper:{enabled:false,items:[]}},width:290');
const server=await createServer({server:{host:'127.0.0.1',port:0,watch:{ignored:['**/*']}},logLevel:'silent'});let browser;
try{
 await server.listen();browser=await chromium.launch({headless:true,channel:'msedge'});
 const context=await browser.newContext({viewport:{width:1280,height:800}});await context.addInitScript({content:preload});
 const page=await context.newPage();await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelector('.app > .scene-ui-backdrop .environment-backdrop-canvas')?.dataset.scene==='city',null,{timeout:120000});
 await page.getByRole('button',{name:'人物场景选项'}).click();
 await page.evaluate(()=>window.qaSceneCanvas=document.querySelector('.environment-backdrop-canvas canvas'));
 await page.addStyleTag({content:'html.raw-scene .app > :not(.scene-ui-backdrop){visibility:hidden!important}'});
 await page.evaluate(()=>document.documentElement.classList.add('raw-scene'));
 const full=(await page.screenshot()).toString('base64');
 await page.evaluate(()=>[...document.querySelectorAll('.character-scene-menu label')].find(el=>el.textContent.includes('扩展到整个窗口')).querySelector('input').click());
 await page.waitForFunction(()=>document.querySelector('.scene-ui-backdrop.is-panel-scene')?.style.clipPath.includes('round'));
 const source=await page.evaluate(()=>({same:window.qaSceneCanvas===document.querySelector('.environment-backdrop-canvas canvas'),canvases:document.querySelectorAll('.environment-backdrop-canvas canvas').length}));
 assert.equal(source.same,true);assert.equal(source.canvases,1);
 async function compare(){
  const cropped=(await page.screenshot()).toString('base64');
  const box=await page.locator('.character-panel').boundingBox();
  return page.evaluate(async({full,cropped,box})=>{
   const decode=async data=>{const i=new Image();i.src='data:image/png;base64,'+data;await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const ctx=c.getContext('2d');ctx.drawImage(i,0,0);return ctx;};
   const a=await decode(full),b=await decode(cropped),x=Math.round(box.x+24),y=Math.round(box.y+24),w=Math.round(box.width-48),h=Math.round(box.height-48),p=a.getImageData(x,y,w,h).data,q=b.getImageData(x,y,w,h).data;
   let delta=0;for(let i=0;i<p.length;i+=4)for(let k=0;k<3;k++)delta+=Math.abs(p[i+k]-q[i+k]);
   const host=document.querySelector('.scene-ui-backdrop'),root=host.getBoundingClientRect(),insets=getComputedStyle(host).clipPath.match(/-?[\d.]+(?=px)/g).map(Number);
   return {meanDifference:delta/(w*h*3),insets,expected:[box.y-root.y,root.width-(box.x-root.x)-box.width,root.height-(box.y-root.y)-box.height,box.x-root.x],box};
  },{full,cropped,box});
 }
 const first=await compare();assert.ok(first.meanDifference<1.5,JSON.stringify(first));
 const clipping=await page.evaluate(()=>{const panel=document.querySelector('.character-panel').getBoundingClientRect(),root=document.querySelector('.scene-ui-backdrop').getBoundingClientRect(),v=getComputedStyle(document.querySelector('.scene-ui-backdrop')).clipPath.match(/-?[\d.]+(?=px)/g).map(Number);return {v,want:[panel.top-root.top,root.right-panel.right,root.bottom-panel.bottom,panel.left-root.left]};});
 clipping.want.forEach((value,i)=>assert.ok(Math.abs(value-clipping.v[i])<.5));
 await page.evaluate(()=>document.documentElement.classList.remove('raw-scene'));
 await page.getByRole('button',{name:'人物场景选项'}).click();
 const grip=await page.locator('.character-grip').boundingBox();await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);await page.mouse.down();await page.mouse.move(grip.x+grip.width/2-120,grip.y+grip.height/2,{steps:10});
 await page.evaluate(()=>document.documentElement.classList.add('raw-scene'));await page.waitForTimeout(120);
 const moved=await compare();assert.ok(moved.meanDifference<1.5,JSON.stringify(moved));
 await page.evaluate(()=>document.documentElement.classList.remove('raw-scene'));
 await page.mouse.move(120,grip.y+grip.height/2,{steps:10});await page.mouse.up();
 await page.waitForFunction(()=>!document.querySelector('.main').classList.contains('avatar-right'));
 await page.waitForTimeout(550);await page.evaluate(()=>document.documentElement.classList.add('raw-scene'));
 const docked=await compare();assert.ok(docked.meanDifference<1.5,JSON.stringify(docked));
 console.log(JSON.stringify({sameCanvas:source.same,initialPixelDifference:first.meanDifference,movedPixelDifference:moved.meanDifference,dockedPixelDifference:docked.meanDifference,outerClip:clipping}));
}finally{await browser?.close();await server.close()}
