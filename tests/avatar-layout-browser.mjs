// Exercises real React layout and the asynchronous handoff protocol without
// starting the user's Electron instance or reading the user's profile.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';

let fixture=await fs.readFile(new URL('../scripts/ui-capture/preload.cjs',import.meta.url),'utf8');
fixture=fixture.replace("const {contextBridge} = require('electron');","const contextBridge={exposeInMainWorld:(name,value)=>window[name]=value};");
fixture=fixture.replace("modelId:'',builtin:true","modelId:'yukino-07-v1',builtin:true").replace("setupDismissedVersion:''","setupDismissedVersion:'0.4.0-base.1'");
fixture=fixture.replace("onCloseRequested:fn=>on('close',fn)","onAvatarHandoff:fn=>on('avatar-handoff',fn),avatarLayoutReady:async value=>window.__layoutReplies.push(value),qaHandoff:value=>emit('avatar-handoff',value),qaSaved:()=>copy(state),onCloseRequested:fn=>on('close',fn)");
fixture='window.__layoutReplies=[];\n'+fixture;
const server=await createServer({server:{host:'127.0.0.1',port:0,watch:{ignored:['**/*']}},logLevel:'silent'});let browser;
try{
 await server.listen();browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined,headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
 await context.addInitScript({content:fixture});
 await context.route('**/*',route=>{const url=new URL(route.request().url());return ['127.0.0.1','localhost'].includes(url.hostname)||!['http:','https:'].includes(url.protocol)?route.continue():route.abort();});
 const page=await context.newPage();await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`,{waitUntil:'domcontentloaded',timeout:30000});
 await page.locator('.character-model-host').waitFor({state:'attached',timeout:30000});
 async function request(sequence,requestId,side){await page.evaluate(value=>window.desktop.qaHandoff(value),{phase:'layout',sequence,requestId,side});await page.waitForFunction(id=>window.__layoutReplies.some(reply=>reply.requestId===id),requestId);return page.evaluate(id=>window.__layoutReplies.find(reply=>reply.requestId===id),requestId)}
 const left=await request(1,1,'left'),right=await request(1,2,'right');
 assert.ok(left.rect&&right.rect);assert.equal(left.preferredSide,'right');assert.ok(left.rect.x<right.rect.x);
 assert.equal((await request(1,3,'left')).side,'left');await page.evaluate(()=>window.desktop.qaHandoff({phase:'finish',sequence:1}));
 assert.equal(await page.locator('.character-panel').getAttribute('data-side'),'left');
 await page.waitForTimeout(400);assert.equal(await page.evaluate(()=>window.desktop.qaSaved().side||'right'),'right','handoff side must not overwrite saved preference');
 await request(2,4,'right');await page.evaluate(()=>window.desktop.qaHandoff({phase:'cancel',sequence:2}));
 await page.waitForFunction(()=>document.querySelector('.character-panel')?.dataset.side==='left');
 await page.evaluate(()=>window.desktop.qaHandoff({phase:'layout',sequence:1,requestId:5,side:'right'}));await page.waitForTimeout(30);
 assert.equal(await page.evaluate(()=>window.__layoutReplies.some(value=>value.requestId===5)),false,'stale sequence cannot change layout');
 await page.getByRole('button',{name:'设置',exact:true}).click();
 assert.equal((await request(3,6,'right')).rect,null,'settings page must not report a hidden avatar rectangle');
 await context.close();console.log('PASS measured both sides, committed temporarily, rolled back safely and rejected hidden layout');
}finally{await browser?.close();await server.close();}
