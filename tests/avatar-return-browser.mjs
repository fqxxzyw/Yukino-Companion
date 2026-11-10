// Exercises the real React panel in an isolated headless browser; no profile or
// desktop processes are touched. The temporary canvas must not survive a handoff.
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';

const server=await createServer({server:{host:'127.0.0.1',port:0,watch:{ignored:['**/build/**']}},plugins:[{name:'handoff-panel-fixture',configureServer(s){s.middlewares.use('/__handoff-fixture',(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<!doctype html><style>#root .character-panel{width:300px;height:700px}</style><div id="stage" style="width:1200px;height:700px;position:relative"><div id="root" style="height:100%;display:flex"></div></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('/tests/avatar-return-fixture.jsx');</script>`);});}}]});
let browser;
try{
 await server.listen();browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const page=await browser.newPage({viewport:{width:1600,height:900}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__handoff-fixture`);const host=page.locator('.character-model-host');await host.waitFor();
 const original=await host.boundingBox();assert.ok(original&&original.width>0&&original.height>0);
 await page.evaluate(()=>window.dispatchHandoff({phase:'prepare',sequence:1,rect:{x:950,y:200,width:260,height:360},view:{zoom:1.3,yaw:45}}));
 await page.waitForFunction(()=>window.ready===1);assert.equal(await host.getAttribute('data-avatar-handoff'),'true');
 const prepared=await host.boundingBox();assert.ok(Math.abs(prepared.x-950)<1);
 await page.evaluate(()=>window.dispatchHandoff({phase:'finish',sequence:1}));
 await page.waitForFunction(()=>!document.querySelector('.character-model-host')?.dataset.avatarHandoff);
 const after=await host.boundingBox();for(const key of ['x','y','width','height'])assert.ok(Math.abs(after[key]-original[key])<1,`${key} returns to panel`);
 assert.equal(await host.evaluate(el=>el.style.width),'');assert.deepEqual(await page.evaluate(()=>window.views.at(-1)),{zoom:1.3,yaw:45});
 // A stale finish cannot commit the next transition, while cancel restores the
 // panel and previous view without leaving temporary coordinates behind.
 await page.evaluate(()=>window.dispatchHandoff({phase:'prepare',sequence:2,rect:{x:1000,y:100,width:220,height:300},view:{zoom:2,yaw:-90}}));
 await page.waitForFunction(()=>window.ready===2);await page.evaluate(()=>window.dispatchHandoff({phase:'finish',sequence:1}));assert.equal(await host.getAttribute('data-avatar-handoff'),'true');
 await page.evaluate(()=>window.dispatchHandoff({phase:'cancel',sequence:2}));await page.waitForFunction(()=>!document.querySelector('.character-model-host')?.dataset.avatarHandoff);
 const cancelled=await host.boundingBox();for(const key of ['x','y','width','height'])assert.ok(Math.abs(cancelled[key]-original[key])<1,`${key} restored on cancel`);
 assert.deepEqual(await page.evaluate(()=>window.views.at(-1)),{zoom:1.3,yaw:45});assert.deepEqual(errors,[]);
 console.log('Avatar return: committed and cancelled canvas geometry returns to the real panel; view and stale sequences verified.');
}finally{await browser?.close();await server.close();}
