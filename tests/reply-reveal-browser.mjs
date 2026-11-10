// Exercise the actual React bubble and its CSS, including a continuously growing stream.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';

const fixture=await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},plugins:[react()],logLevel:'error',build:{write:false,lib:{entry:fileURLToPath(new URL('./reply-reveal-fixture.jsx',import.meta.url)),name:'ReplyRevealFixture',formats:['iife']}}});
const js=(Array.isArray(fixture)?fixture[0]:fixture).output.find(item=>item.type==='chunk').code;
let browser;
try{
 let executablePath;
 for(const file of [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'])if(file&&await fs.access(file).then(()=>true,()=>false)){executablePath=file;break;}
 browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
 const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000);
 await page.setContent('<!doctype html><div id="root"></div>');
 await page.addStyleTag({content:await fs.readFile(new URL('../src/style.css',import.meta.url),'utf8')});
 await page.addScriptTag({content:js});
 assert.deepEqual(errors,[],'fixture must start');
 await page.waitForFunction(()=>typeof window.showReply==='function');
 const bubbles=page.locator('.local-reply-segment');
 const show=options=>page.evaluate(value=>window.showReply(value),options);
 await show({id:'history',status:'done',content:'第一句。第二句。第三句。'});
 assert.equal(await bubbles.count(),3,'history should be immediate');
 assert.equal(await page.locator('.is-entering').count(),0,'history should not animate');
 await show({id:'new',status:'streaming',content:'第一句。第二句。第三句。'});
 await page.waitForFunction(()=>document.querySelectorAll('.local-reply-segment').length===1);
 assert.equal(await page.locator('.is-entering').count(),1);
 await page.waitForTimeout(150);assert.equal(await bubbles.count(),1,'the next bubble should not appear at once');
 await page.waitForFunction(()=>document.querySelectorAll('.local-reply-segment').length===2);
 await page.waitForFunction(()=>document.querySelectorAll('.local-reply-segment').length===3);
 assert.ok(await page.evaluate(()=>window.revealCount)>=3,'each reveal should notify its scroll container');
 // Keep adding sentences faster than the reveal delay. Growth must not reset
 // the already scheduled reveal and starve the visible queue.
 await show({id:'continuous',status:'streaming',content:'第零句。'});
 await page.waitForFunction(()=>document.querySelectorAll('.local-reply-segment').length===1);
 for(let i=1;i<=9;i++){
  await page.waitForTimeout(100);
  await show({id:'continuous',status:'streaming',content:Array.from({length:i+1},(_,n)=>`第${n}句。`).join('')});
 }
 assert.ok(await bubbles.count()>=2,'continuous updates must not postpone all queued bubbles');
 await show({id:'reduced',status:'streaming',content:'第一句。第二句。',reducedMotion:true});
 await page.waitForFunction(()=>document.querySelectorAll('.local-reply-segment').length===1);
 assert.equal(await bubbles.first().evaluate(el=>getComputedStyle(el).animationName),'none','app reduced motion disables jelly');
 await page.waitForFunction(()=>document.querySelectorAll('.local-reply-segment').length===2);
 await page.emulateMedia({reducedMotion:'reduce'});
 await show({id:'system-reduced',status:'streaming',content:'第一句。第二句。'});
 await page.waitForFunction(()=>document.querySelectorAll('.local-reply-segment').length===1);
 assert.equal(await bubbles.first().evaluate(el=>getComputedStyle(el).animationName),'none','system reduced motion disables jelly');
 assert.deepEqual(errors,[]);
 console.log('Reply reveal: history, staggered entrance, uninterrupted streaming, scroll notification, and reduced motion passed.');
}finally{await browser?.close();}
