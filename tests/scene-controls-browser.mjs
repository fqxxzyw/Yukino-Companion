// Exercise the real character menu with a disposable in-memory profile.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';

let preload=await fs.readFile(new URL('../scripts/ui-capture/preload.cjs',import.meta.url),'utf8');
preload=preload.replace("const {contextBridge} = require('electron');","const contextBridge={exposeInMainWorld:(name,value)=>window[name]=value};")
 .replace("setupDismissedVersion:''","setupDismissedVersion:'0.4.0-base.1'");
const server=await createServer({server:{host:'127.0.0.1',port:0,watch:{ignored:['**/*']}},logLevel:'silent'});
let browser;
try{
 await server.listen();
 browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
 const context=await browser.newContext({viewport:{width:1280,height:800}});
 await context.addInitScript({content:preload});
 const page=await context.newPage();
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`,{waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'人物场景选项'}).click({timeout:45000});
 const menu=page.locator('.character-scene-menu');
 const scene=menu.getByRole('switch',{name:'打开三维场景'}),spread=menu.getByRole('switch',{name:'扩展到整个窗口'});
 assert.equal(await scene.isChecked(),false);assert.equal(await spread.isDisabled(),true);
 await scene.check();assert.equal(await spread.isEnabled(),true);assert.equal(await spread.isChecked(),false);
 const viewport=page.locator('.app > .scene-ui-backdrop.is-panel-scene');
 const geometry=await viewport.evaluate(layer=>{
  const panel=layer.closest('.app').querySelector('.character-panel'),rect=panel.getBoundingClientRect(),root=layer.getBoundingClientRect();
  const style=getComputedStyle(layer),insets=style.clipPath.match(/-?[\d.]+(?=px)/g).map(Number);
  return {insets,want:[rect.top-root.top,root.right-rect.right,root.bottom-rect.bottom,rect.left-root.left],radius:parseFloat(getComputedStyle(panel).borderRadius),clip:style.clipPath};
 });
 geometry.want.forEach((value,i)=>assert.ok(Math.abs(value-geometry.insets[i])<.5));assert.ok(geometry.radius>0);assert.match(geometry.clip,/round/);
 const gaze=menu.getByRole('switch',{name:'头部跟随',exact:true});assert.equal(await gaze.getAttribute('class'),'scene-switch');
 assert.equal(await menu.locator('.scene-choice-swatch img').count(),10);assert.equal(await menu.locator('.scene-choice-swatch svg').count(),0);
 const appearance=await scene.evaluate(el=>({width:el.offsetWidth,height:el.offsetHeight,appearance:getComputedStyle(el).appearance,after:getComputedStyle(el,'::after').display}));
 assert.ok(appearance.width>appearance.height);assert.equal(appearance.appearance,'none');assert.equal(appearance.after,'none');
 await spread.check();assert.equal(await page.locator('.scene-ui-backdrop.is-panel-scene').count(),0);
 await scene.uncheck();assert.equal(await spread.isDisabled(),true);
 console.log('Scene switches: visual switch, dependency, local and full-window modes passed.');
}finally{await browser?.close();await server.close()}
