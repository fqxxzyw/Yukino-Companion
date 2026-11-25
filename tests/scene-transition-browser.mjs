import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';

const server=await createServer({logLevel:'error',server:{host:'127.0.0.1',port:0,watch:{ignored:['**/build/**']}}});
const output='build/scene-transition-review';
await mkdir(output,{recursive:true});
let browser;
try{
 await server.listen();
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:process.env.YUKINO_VISIBLE_REVIEW!=='1',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1100,height:750}});
 page.setDefaultTimeout(120000);await page.emulateMedia({reducedMotion:'no-preference'});
 await page.addInitScript(()=>{
  localStorage.setItem('yukino-ui-preview-v1:state',JSON.stringify({profiles:[{id:'default',name:'API'}],conversations:[],showAvatar:false,reduce:false,presentation:{scene:'classroom',sceneEnabled:true,sceneToon:false,spread:true,followTime:false,fixedHour:14,wallpaper:{enabled:false,items:[]}}}));
  const animate=HTMLCanvasElement.prototype.animate;
  HTMLCanvasElement.prototype.animate=function(...args){
   const animation=animate.apply(this,args);
   if(this.classList.contains('scene-style-fade')){animation.pause();animation.currentTime=120;}
   return animation;
  };
 });
 await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/',{waitUntil:'domcontentloaded'});
 const host=page.locator('.environment-backdrop-canvas[data-scene="classroom"]').first();
 await host.waitFor({timeout:180000});
 await page.getByTitle('设置',{exact:true}).first().click();
 await page.getByRole('button',{name:'外观',exact:true}).click();
 const toggle=page.getByRole('switch',{name:'吉卜力水粉场景渲染',exact:true});
 await toggle.check();
 const fade=host.locator('.scene-style-fade');
 await fade.waitFor();
 const read=()=>fade.evaluate(el=>({opacity:+getComputedStyle(el).opacity,clip:getComputedStyle(el).clipPath,events:getComputedStyle(el).pointerEvents,duration:el.getAnimations()[0].effect.getTiming().duration}));
 assert.deepEqual(await read(),{opacity:.5,clip:'none',events:'none',duration:240});
 assert.equal(await host.getAttribute('data-frozen'),null);
 const canvas=await host.locator('canvas').first().elementHandle();
 await page.screenshot({path:output+'/same-scene-style-blend.png'});
 await toggle.uncheck();
 assert.deepEqual(await read(),{opacity:.5,clip:'none',events:'none',duration:240});
 assert.equal(await host.evaluate((el,previous)=>el.firstElementChild===previous,canvas),true);
 await fade.evaluate(el=>el.getAnimations()[0].finish());
 await fade.waitFor({state:'detached'});
 await page.emulateMedia({reducedMotion:'reduce'});
 await host.waitFor({timeout:180000});
 await toggle.check();await page.waitForFunction(()=>document.querySelector('.environment-backdrop-canvas[data-scene="classroom"]')?.dataset.renderStyle==='toon');
 assert.equal(await fade.count(),0);
 console.log('PASS actual scene style toggle in both directions, continuous quick reversal, same WebGL canvas, 240ms opacity only, clickable UI, cleanup and reduced motion.');
}finally{await browser?.close();await server.close();}

