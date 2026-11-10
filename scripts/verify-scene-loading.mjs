// Exercise scene loading with the real UI and renderer in an isolated browser profile.
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';
const server=await createServer({server:{host:'127.0.0.1',port:0,watch:{ignored:['**/build/**','**/motion-studio/artifacts/**']}}});
let browser;let releaseCity;const cityGate=new Promise(resolve=>{releaseCity=resolve});
try{
 await server.listen();
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1280,height:800}});
 await page.addInitScript(()=>localStorage.setItem('yukino-ui-preview-v1:state',JSON.stringify({profiles:[{id:'default',name:'API'}],conversations:[],showAvatar:false,reduce:true,presentation:{scene:'city',spread:true,followTime:false,fixedHour:14,wallpaper:{enabled:false,items:[]}}})));
 await page.route('**/src/scenes/lawson.mjs*',async route=>{await cityGate;await route.continue()});
 await page.route('**/src/scenes/arashiyama.mjs*',route=>route.abort());
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`,{waitUntil:'domcontentloaded',timeout:120000});
 const status=page.locator('.scene-load-status');
 await status.waitFor({state:'visible',timeout:90000});
 assert.match(await status.innerText(),/正在加载「晚归灯火」/);
 await page.getByRole('button',{name:'场景小菜单'}).click();
 await page.locator('.scene-menu-popover').getByRole('button',{name:'放课之后',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.scene-load-status')?.textContent.includes('放课之后'));
 releaseCity();
 await page.waitForFunction(()=>document.querySelector('.environment-backdrop-canvas')?.dataset.scene==='classroom',null,{timeout:120000});
 await status.waitFor({state:'hidden',timeout:10000});
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
 await page.locator('.environment-backdrop-canvas canvas').dispatchEvent('webglcontextlost');
 await page.locator('.scene-load-status.error').waitFor({state:'visible',timeout:10000});
 await page.getByRole('button',{name:'重试',exact:true}).click();
 await status.waitFor({state:'hidden',timeout:120000});
 assert.equal(await page.locator('.environment-backdrop-canvas').getAttribute('data-scene'),'classroom');
 console.log('Scene status: delayed load, superseded selection, render readiness, failure, selection recovery and retry passed.');
}finally{releaseCity();await browser?.close();await server.close()}
