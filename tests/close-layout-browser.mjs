// Run with: node tests/close-layout-browser.mjs
// Exercises the production React tree in a browser with an in-memory Electron bridge.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';

const original=await fs.readFile(new URL('../scripts/ui-capture/preload.cjs',import.meta.url),'utf8');
const server=await createServer({server:{host:'127.0.0.1',port:0,watch:{ignored:['**/*']}},logLevel:'silent'});
let browser;
function fixture(collapsed){
 let code=original.replace("const {contextBridge} = require('electron');","const contextBridge={exposeInMainWorld:(name,value)=>window[name]=value};");
 code=code.replace('collapsed:false,showAvatar:true',`collapsed:${collapsed},showAvatar:true`);
 code=code.replace("setupDismissedVersion:''","setupDismissedVersion:'0.4.0-base.1'");
 code=code.replace("window:async action=>{if(action==='close')emit('close');}","window:async action=>{if(action==='close')emit('close-feedback',{phase:'start'});}");
 code=code.replace("onCloseRequested:fn=>on('close',fn)","onCloseFeedback:fn=>on('close-feedback',fn),qaCloseFeedback:phase=>emit('close-feedback',{phase}),onCloseRequested:fn=>on('close',fn)");
 return code;
}
async function geometry(page){return page.evaluate(()=>Object.fromEntries(['.sidebar','.workspace','.titlebar','.main','.character-panel'].map(selector=>{const node=document.querySelector(selector);if(!node)return [selector,null];const r=node.getBoundingClientRect();return [selector,{x:r.x,y:r.y,width:r.width,height:r.height}]})));}
function equalGeometry(before,after,label){for(const [selector,rect] of Object.entries(before)){assert.ok(rect&&after[selector],`${label}: ${selector} is present`);for(const key of ['x','y','width','height'])assert.ok(Math.abs(rect[key]-after[selector][key])<1,`${label}: ${selector} ${key} moved from ${rect[key]} to ${after[selector][key]}`);}}
try{
 await server.listen();console.log('Vite ready');
 browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined,headless:true});
 console.log('Browser ready');
 for(const collapsed of [false,true]){
  const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'no-preference'});
  await context.addInitScript({content:fixture(collapsed)});
  await context.route('**/*',route=>{const url=new URL(route.request().url());return ['127.0.0.1','localhost'].includes(url.hostname)||!['http:','https:'].includes(url.protocol)?route.continue():route.abort();});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`,{waitUntil:'domcontentloaded',timeout:30000});
  await page.locator('.character-panel').waitFor({timeout:30000});
  await page.waitForFunction(expected=>document.querySelector('.app')?.classList.contains('collapsed')===expected,collapsed,{timeout:30000});
  const before=await geometry(page);
  assert.ok(before['.sidebar'].width<(collapsed?120:300),'sidebar occupies its own narrow column');
  assert.ok(before['.workspace'].width>1000,'workspace occupies the remaining column');
  await page.getByRole('button',{name:'关闭聊天窗口'}).click();
  await page.waitForFunction(()=>document.querySelector('.app')?.classList.contains('is-closing'));
  await page.waitForTimeout(500);
  const during=await geometry(page);equalGeometry(before,during,'close feedback');
  assert.equal(await page.locator('.closing-feedback').count(),0,'closing must not insert a status label');
  assert.equal(await page.getByText('正在准备关闭…',{exact:true}).count(),0,'closing must not display the old message');
  const appearance=await page.locator('.sidebar').evaluate(node=>{const style=getComputedStyle(node);return {opacity:Number(style.opacity),filter:style.filter}});
  assert.ok(appearance.opacity>=.6&&appearance.opacity<1,'the closing interface remains visible while fading');
  const blur=Number(appearance.filter.match(/blur\(([-\d.]+)px\)/)?.[1]||0);
  assert.ok(blur<=2.1,'the closing interface uses only a light blur');
  const backdrop=page.locator('.scene-ui-backdrop');
  if(await backdrop.count())assert.ok(Number(await backdrop.evaluate(node=>getComputedStyle(node).opacity))>=.99,'the scene remains visible while closing');
  await page.evaluate(()=>window.desktop.qaCloseFeedback('end'));
  await page.waitForFunction(()=>!document.querySelector('.app')?.classList.contains('is-closing'));
  equalGeometry(before,await geometry(page),'close cancelled or finished');
  assert.deepEqual(errors,[]);await context.close();
  console.log(`PASS closing keeps ${collapsed?'collapsed':'expanded'} layout and a translucent interface without a status label`);
 }
}finally{await browser?.close();await server.close();}
