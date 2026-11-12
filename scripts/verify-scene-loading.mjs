// Exercise scene loading with the real UI and renderer in an isolated browser profile.
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';
const server=await createServer({server:{host:'127.0.0.1',port:0,watch:{ignored:['**/build/**','**/motion-studio/artifacts/**']}}});
let browser;let releaseCity,releaseKasai;const cityGate=new Promise(resolve=>{releaseCity=resolve}),kasaiGate=new Promise(resolve=>{releaseKasai=resolve});
try{
 await server.listen();
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1280,height:800}});
 await page.addInitScript(()=>localStorage.setItem('yukino-ui-preview-v1:state',JSON.stringify({profiles:[{id:'default',name:'API'}],conversations:[],showAvatar:false,reduce:false,presentation:{scene:'city',spread:true,followTime:false,fixedHour:14,wallpaper:{enabled:false,items:[]}}})));
 await page.route('**/src/scenes/lawson.mjs*',async route=>{await cityGate;await route.continue()});
 await page.route('**/src/scenes/kasai.mjs*',async route=>{await kasaiGate;await route.continue()});
 await page.route('**/src/scenes/arashiyama.mjs*',route=>route.abort());
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`,{waitUntil:'domcontentloaded',timeout:120000});
 const status=page.locator('.scene-load-status');
 await status.waitFor({state:'visible',timeout:90000});
 assert.match(await status.innerText(),/正在加载「晚归灯火」/);
 const veil=page.locator('.scene-loading-veil');
 await page.waitForFunction(()=>document.querySelector('.scene-loading-veil')?.classList.contains('is-loading'));
 assert.equal(await veil.evaluate(el=>getComputedStyle(el).backdropFilter),'blur(8px)');
 await page.getByRole('button',{name:'场景小菜单'}).click();
 await page.locator('.scene-menu-popover').getByRole('button',{name:'放课之后',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.scene-load-status')?.textContent.includes('放课之后'));
 releaseCity();
 await page.waitForFunction(()=>document.querySelector('.environment-backdrop-canvas')?.dataset.scene==='classroom',null,{timeout:120000});
 await status.waitFor({state:'hidden',timeout:10000});
 assert.equal(await veil.evaluate(el=>el.classList.contains('is-loading')),false);
 // A delayed second scene retains the previous coloured frame at 8px blur.
 await page.getByRole('button',{name:'场景小菜单'}).click();
 await page.locator('.scene-menu-popover').getByRole('button',{name:'海风来信',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.environment-backdrop-canvas')?.dataset.frozen==='true');
 const frozen=page.locator('.environment-backdrop-canvas canvas').last();
 assert.equal(await page.locator('.environment-backdrop-canvas').getAttribute('data-scene'),'classroom');
 assert.equal(await frozen.evaluate(el=>getComputedStyle(el).filter),'blur(8px)');
 assert.equal(await frozen.evaluate(el=>{const ctx=el.getContext('2d');for(let y=0;y<el.height;y+=Math.max(1,Math.floor(el.height/20)))for(let x=0;x<el.width;x+=Math.max(1,Math.floor(el.width/20))){const [r,g,b,a]=ctx.getImageData(x,y,1,1).data;if(a&&Math.max(r,g,b)-Math.min(r,g,b)>5)return true;}return false;}),true,'the retained image contains actual scene colour');
 assert.equal(await page.locator('.environment-backdrop-canvas').getAttribute('data-preview'),null);
 // Pause only the incoming snapshot animation so this can verify actual clip
 // growth even if the renderer is slow under software WebGL.
 await page.evaluate(()=>{
  const host=document.querySelector('.environment-backdrop-canvas'),animate=HTMLCanvasElement.prototype.animate;
  host.append=new Proxy(host.append,{apply(append,el,args){
   const frame=args[0];
   if(frame instanceof HTMLCanvasElement)frame.animate=(...args)=>{
    host.append=append;
    const effect=animate.call(frame,...args);effect.pause();effect.currentTime=0;
    return effect;
   };
   return Reflect.apply(append,el,args);
  }});
 });
 releaseKasai();
 await page.waitForFunction(()=>document.querySelector('.environment-backdrop-canvas')?.dataset.scene==='kasai',null,{timeout:120000});
 const reveal=page.locator('.environment-backdrop-canvas[data-revealing] canvas').last();
 assert.match(await reveal.evaluate(el=>getComputedStyle(el).clipPath),/^circle\(0% /);
 assert.equal(await reveal.evaluate(el=>{
  const animation=el.getAnimations()[0];animation.currentTime=500;
  const radius=parseFloat(getComputedStyle(el).clipPath.slice(7));animation.finish();return radius>0&&radius<150;
 }),true,'new scene expands through an intermediate circle');
 await page.locator('.environment-backdrop-canvas[data-revealing]').waitFor({state:'detached'});
 await page.getByRole('button',{name:'场景小菜单'}).click();
 await page.locator('.scene-menu-popover').getByRole('button',{name:'风过竹间',exact:true}).click();
 await page.locator('.scene-load-status.error').waitFor({state:'visible',timeout:60000});
 assert.match(await page.locator('.scene-load-status.error').innerText(),/场景加载失败/);
 assert.equal(await page.getByRole('button',{name:'重试',exact:true}).isVisible(),true);
 // A later valid selection replaces an error with the current loading state.
 await page.getByRole('button',{name:'场景小菜单'}).click();
 await page.locator('.scene-menu-popover').getByRole('button',{name:'放课之后',exact:true}).click();
 await status.waitFor({state:'hidden',timeout:120000});
 // Context loss exercises the actual renderer error callback and retry path.
 await page.locator('.environment-backdrop-canvas canvas').first().dispatchEvent('webglcontextlost');
 await page.locator('.scene-load-status.error').waitFor({state:'visible',timeout:10000});
 await page.getByRole('button',{name:'重试',exact:true}).click();
 await status.waitFor({state:'hidden',timeout:120000});
 assert.equal(await page.locator('.environment-backdrop-canvas').getAttribute('data-scene'),'classroom');
 console.log('Scene status: delayed load, superseded selection, render readiness, failure, selection recovery and retry passed.');
}finally{releaseCity();releaseKasai();await browser?.close();await server.close()}
