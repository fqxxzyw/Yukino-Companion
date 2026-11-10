// Browser geometry check with a mock companion bridge; no account or camera access.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from 'playwright-core';
let browser;
try{
 let executablePath;
 for(const file of [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'])if(file&&await fs.access(file).then(()=>true,()=>false)){executablePath=file;break;}
 browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
 const page=await browser.newPage({viewport:{width:350,height:520}});
 const css=await fs.readFile(new URL('../src/model-window.css',import.meta.url),'utf8');
 await page.setContent(`<style>${css}</style><main class="model-companion"><div class="model-window-canvas"></div><div class="compact-dock"><button class="dock-handle"></button><form><input placeholder="与雪之下雪乃对话"><button type="button">◧</button><button type="submit">↑</button></form></div></main>`);
 const dock=page.locator('.compact-dock');
 const before=await dock.boundingBox();const hostBounds=await page.locator('.model-window-canvas').boundingBox();
 assert.ok(before&&Math.abs(before.y-(520-60))<1);
 assert.ok(Math.abs(before.y-(hostBounds.y+hostBounds.height))<1);
 await dock.evaluate(el=>el.classList.add('expanded'));await page.waitForTimeout(350);
 const after=await dock.boundingBox();assert.ok(Math.abs(after.y-before.y)<1);assert.ok(after.height>before.height);
 const geometry=await page.evaluate(()=>{const d=document.querySelector('.compact-dock'),i=d.querySelector('input'),r=d.getBoundingClientRect(),ir=i.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,inputLeft:ir.left,inputRight:ir.right,overflow:getComputedStyle(d).overflow,outline:getComputedStyle(i).outlineStyle}});
 assert.ok(geometry.inputLeft>=geometry.left&&geometry.inputRight<=geometry.right);assert.equal(geometry.overflow,'hidden');
 await page.locator('.compact-dock input').focus();assert.equal(await page.locator('.compact-dock input').evaluate(el=>getComputedStyle(el).outlineStyle),'none');
 await page.setViewportSize({width:180,height:520});await page.waitForTimeout(300);
 const narrow=await page.evaluate(()=>{const d=document.querySelector('.compact-dock').getBoundingClientRect(),i=document.querySelector('.compact-dock input').getBoundingClientRect();return {d,i}});
 assert.ok(narrow.i.left>=narrow.d.left&&narrow.i.right<=narrow.d.right);
 console.log('PASS compact dock stays anchored and keeps its controls inside at normal and narrow widths');
}finally{await browser?.close();}
