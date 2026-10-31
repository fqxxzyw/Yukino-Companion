// Real Electron controls and CSS animation sampling. No inference or cloud calls.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {_electron} from 'playwright-core';
const root=fileURLToPath(new URL('../',import.meta.url));
const output=await fs.mkdtemp(path.join(root,'build/control-motion-'));
const appData=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-settings-qa-'));
const report={purpose:'Actual Electron button motion, selected surfaces and accessibility; no model/voice/network validation',output,appData,checks:[],samples:[],screenshots:[],rendererErrors:[]};
let server,desktop,page;
function check(name,details){report.checks.push({name,passed:true,details});console.log('PASS '+name);}
async function screenshot(name){const file=path.join(output,name+'.png');await page.screenshot({path:file});report.screenshots.push(file);}
async function nav(name){await page.locator('.settings-nav').getByRole('button',{name,exact:true}).click();}
async function settle(){await page.waitForTimeout(380);}
async function sample(groupSelector,label,axis='left'){
 await settle();
 const result=await page.locator(groupSelector).evaluate(async(group,{label,axis})=>{
  const read=()=>{const s=getComputedStyle(group,'::before');return {left:parseFloat(s.left),top:parseFloat(s.top),width:parseFloat(s.width),height:parseFloat(s.height),background:s.backgroundImage,content:s.content};};
  const before=read(),button=[...group.querySelectorAll(':scope > button')].find(el=>el.textContent.trim()===label);
  if(!button)throw Error('Missing actual button '+label);
  button.click();
  const frames=[];const start=performance.now();
  await new Promise(resolve=>{const frame=()=>{frames.push({time:performance.now()-start,...read()});if(performance.now()-start<460)requestAnimationFrame(frame);else resolve();};requestAnimationFrame(frame);});
  const final=read(),a=group.getBoundingClientRect(),b=button.getBoundingClientRect();
  return {before,frames,final,expected:{left:b.left-a.left-group.clientLeft,top:b.top-a.top-group.clientTop,width:b.width,height:b.height},selected:button.matches('.active,.selected,[aria-pressed=true],[aria-selected=true],[aria-current=page]')};
 },{label,axis});
 report.samples.push({groupSelector,label,axis,...result});
 assert.equal(result.selected,true);assert.notEqual(result.final.content,'none');
 for(const field of ['left','top','width','height'])assert.ok(Math.abs(result.final[field]-result.expected[field])<2,`${label} marker ${field} misses button`);
 const start=result.before[axis],end=result.final[axis];assert.ok(Math.abs(end-start)>4,label+' did not move');
 assert.ok(result.frames.some(f=>Math.abs(f[axis]-start)>1&&Math.abs(f[axis]-end)>1),label+' snapped instead of animating');
 check(groupSelector+' / '+label+' selection actually travels between positions');
}
try{
 server=await createServer({root,server:{host:'127.0.0.1',port:0}});await server.listen();
 report.url=`http://127.0.0.1:${server.httpServer.address().port}/`;
 const env={...process.env,YUKINO_SETTINGS_QA_DATA:appData,YUKINO_DEV_SERVER_URL:report.url};delete env.ELECTRON_RUN_AS_NODE;delete env.YUKINO_PYTHON;
 desktop=await _electron.launch({args:[path.join(root,'scripts/qa-speech-settings.cjs')],cwd:root,env,timeout:45000});
 page=await desktop.firstWindow();page.on('pageerror',error=>report.rendererErrors.push(error.message));
 await page.locator('.app').waitFor();
 for(let i=0;i<4;i++){await page.waitForTimeout(350);const skip=page.locator('.setup-dialog footer .text-link');if(await skip.count())await skip.click();const later=page.getByRole('button',{name:'稍后再说',exact:true});if(await later.count())await later.click();}
 await page.waitForFunction(()=>!document.querySelector('.voice-chat-wizard'));
 assert.equal(await desktop.evaluate(({app})=>app.getPath('userData')),path.join(appData,'yukino-companion-development'));
 assert.equal(await page.evaluate(()=>CSS.supports('anchor-scope','--control-selection')),true);
 check('Actual Electron uses isolated data and supports scoped CSS selection anchors');
 await sample('.chat-toolbar .language-switch','日本語');await sample('.chat-toolbar .language-switch','双语');await screenshot('language-bilingual');
 const zh=page.locator('.chat-toolbar .language-switch').getByRole('button',{name:'中文',exact:true});await zh.focus();await page.keyboard.press('Space');await settle();assert.equal(await zh.getAttribute('aria-pressed'),'true');
 check('Language switch remains keyboard-operable with real pressed state');
 await sample('.chat-source-switch','本地');await sample('.chat-source-switch','API');await screenshot('source-api');
 const send=page.getByRole('button',{name:'发送消息',exact:true});assert.equal(await send.isDisabled(),true);await send.hover({force:true});assert.equal(await send.evaluate(el=>getComputedStyle(el).translate),'none');
 const suggestion=page.getByRole('button',{name:'聊聊今天发生的事',exact:true});await suggestion.hover();await settle();assert.equal(await suggestion.evaluate(el=>getComputedStyle(el).translate),'0px -1px');await page.mouse.down();await page.waitForTimeout(120);assert.ok(parseFloat(await suggestion.evaluate(el=>getComputedStyle(el).scale))<1);await page.mouse.up();
 assert.equal(await page.getByRole('textbox',{name:'消息',exact:true}).inputValue(),'聊聊今天发生的事');await page.getByRole('textbox',{name:'消息',exact:true}).fill('');
 check('Real button hover/press gives restrained feedback; disabled send remains inert');
 await page.getByRole('button',{name:'设置',exact:true}).click();await sample('.settings-nav nav','个人记忆','top');await screenshot('settings-memory');
 await nav('模型与 API');await sample('.settings-tabs','任务分配');await sample('.settings-tabs','服务与配置');await screenshot('settings-api');
 // Search removes the old selection and restores it without a ghost surface.
 const search=page.getByRole('textbox',{name:'搜索设置',exact:true});await search.fill('no-match-qa');assert.equal(await page.locator('.settings-nav nav button').count(),0);assert.equal(await page.locator('.settings-nav nav').evaluate(el=>getComputedStyle(el,'::before').content),'none');await page.getByRole('button',{name:'清除设置搜索',exact:true}).click();await settle();assert.equal(await page.locator('.settings-nav nav .selected').count(),1);
 check('Settings filtering never leaves a stale moving selection');
 // Use the actual user preference, not a renderer-only class patch.
 await nav('外观');
 const blue=await page.locator('.app').evaluate(el=>getComputedStyle(el).getPropertyValue('--accent'));
 await page.getByRole('button',{name:'暮紫',exact:true}).click();await settle();
 const purple=await page.locator('.app').evaluate(el=>getComputedStyle(el).getPropertyValue('--accent'));assert.notEqual(purple,blue);
 const markerTint=await page.locator('.settings-nav nav').evaluate(el=>getComputedStyle(el,'::before').backgroundImage);assert.ok(markerTint.includes('gradient'));
 await screenshot('settings-purple');await page.getByRole('button',{name:'晴空',exact:true}).click();await settle();
 check('Selection surfaces inherit the actual user theme instead of hard-coded blue');
 const reduce=page.getByRole('switch',{name:/减少动态/});await reduce.check();await page.waitForFunction(()=>document.querySelector('.app.reduce'));
 const back=page.getByRole('region',{name:'设置',exact:true}).getByRole('button',{name:'返回对话',exact:true});await back.hover();assert.equal(await back.evaluate(el=>getComputedStyle(el).translate),'none');
 const duration=await page.locator('.settings-nav nav').evaluate(el=>getComputedStyle(el,'::before').transitionDuration);assert.equal(duration,'0s');
 const themeSelect=page.locator('.settings-page-content [role=combobox]').first();if(await themeSelect.count()){await themeSelect.click();await page.locator('.select-menu').waitFor();assert.equal(await page.locator('.select-menu').getAttribute('data-reduced-motion'),'true');await page.keyboard.press('Escape');}
 await reduce.uncheck();await page.waitForFunction(()=>!document.querySelector('.app.reduce'));
 await page.emulateMedia({reducedMotion:'reduce'});await back.hover();assert.equal(await back.evaluate(el=>getComputedStyle(el).translate),'none');assert.equal(await page.locator('.settings-nav nav').evaluate(el=>getComputedStyle(el,'::before').transitionDuration),'0s');
 check('App and OS reduced-motion preferences suppress both animation and displacement');
 await page.emulateMedia({reducedMotion:'no-preference',forcedColors:'active'});assert.equal(await page.locator('.settings-nav nav').evaluate(el=>getComputedStyle(el,'::before').backgroundImage),'none');await screenshot('settings-high-contrast');await page.emulateMedia({forcedColors:'none'});
 check('Forced-colors selection keeps a visible system-color border');
 let saved;
 for(let i=0;i<30;i++){
  saved=JSON.parse(await fs.readFile(path.join(appData,'yukino-companion-development/state.json'),'utf8'));
  if(saved.bubbleLanguage==='zh'&&saved.chatMode==='api'&&saved.reduce===false&&saved.accent===blue.trim())break;
  await page.waitForTimeout(50);
 }
 assert.equal(saved.bubbleLanguage,'zh');assert.equal(saved.chatMode,'api');assert.equal(saved.reduce,false);assert.equal(saved.accent,blue.trim());
 check('Actual language, source, theme and reduced-motion choices reach the isolated state file');
 report.applicationErrors=await page.locator('.main .error').allTextContents();assert.deepEqual(report.applicationErrors,[],'Actual application displayed an error; animation-only success is insufficient');
 report.blockedRequests=await desktop.evaluate(()=>globalThis.settingsQaBlockedRequests);assert.deepEqual(report.blockedRequests,[]);assert.deepEqual(report.rendererErrors,[]);report.success=true;
}catch(error){report.success=false;report.failure=error.stack;process.exitCode=1;console.error(error);if(page&&!page.isClosed())await screenshot('failure').catch(()=>{});}
finally{await desktop?.close().catch(error=>{report.cleanupError=error.message;process.exitCode=1;});await server?.close();await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log('Report: '+path.join(output,'report.json'));}
