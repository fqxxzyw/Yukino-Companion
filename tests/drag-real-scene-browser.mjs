// Pixel-level verification against an actual rendered WebGL city scene.
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
 await server.listen();browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{}),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const context=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:1});await context.addInitScript({content:preload});
 const page=await context.newPage();await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>{const h=document.querySelector('.app > .scene-ui-backdrop .environment-backdrop-canvas');return h?.dataset.scene==='city'&&!h.dataset.loading;},null,{timeout:120000});
 await page.addStyleTag({content:'.chat-scroll>*{visibility:hidden}.character-panel::after{display:none}'});
 const panel=page.locator('.character-panel'),grip=page.locator('.character-grip');await grip.waitFor({state:'visible'});
 // Measure real high-frequency edges, outside the panel and chat message content.
 async function edgeEnergy(){const screenshot=await page.screenshot();return page.evaluate(async src=>{const i=new Image();i.src=src;await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const x=c.getContext('2d');x.drawImage(i,0,0);const {data,width,height}=x.getImageData(210,200,360,350);let total=0;for(let y=0;y<height;y++)for(let a=1;a<width;a++){const p=(y*width+a)*4;for(let k=0;k<3;k++)total+=Math.abs(data[p+k]-data[p-4+k])}return total/(width*height*3)},'data:image/png;base64,'+screenshot.toString('base64'));}
 const before=await edgeEnergy();const box=await grip.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.waitForFunction(()=>document.querySelector('.character-panel.is-dragging'));await page.waitForTimeout(500);
 const during=await edgeEnergy();await page.mouse.up();await page.waitForFunction(()=>!document.querySelector('.character-panel.is-dragging'));await page.waitForTimeout(550);const after=await edgeEnergy();
 assert.ok(during<before*.88,`real scene edges must blur: before=${before}, dragging=${during}, after=${after}`);assert.ok(after>during*1.12,`real scene must recover after release: before=${before}, dragging=${during}, after=${after}`);
 console.log(`Real scene blur with reduced motion: ${before.toFixed(2)} -> ${during.toFixed(2)} -> ${after.toFixed(2)}`);
 await context.close();
}finally{await browser?.close();await server.close()}
