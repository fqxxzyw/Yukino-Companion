// Actual Electron main + production companion IPC. Layout fixtures are NOT AI replies.
// No cloud requests, inference, downloads, camera, microphone or sound playback.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createServer} from 'vite';
import {_electron} from 'playwright-core';
const require=createRequire(import.meta.url),{DEFAULTS}=require('../electron/companions.cjs');
const root=fileURLToPath(new URL('../',import.meta.url));
const output=await fs.mkdtemp(path.join(root,'build/companion-windows-'));
const appData=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-settings-qa-'));
const userData=path.join(appData,'yukino-companion-development');
await fs.mkdir(userData,{recursive:true});
await fs.writeFile(path.join(userData,'companions.json'),JSON.stringify({...DEFAULTS,mode:'none',soundEnabled:false,randomQuotes:false,interactionQuotes:false,nightReminders:false,animation:false}));
const report={purpose:'Actual Electron desktop pet / 3D bubbles and settings; injected UI text only, no AI or audio validation',output,appData,checks:[],screenshots:[],geometry:[],rendererErrors:[],blockedRequests:[]};
let server,desktop,main,pet,model;
const longZh=('布局测试：中文长回复 😀 https://example.invalid/'+('abc'.repeat(90))+'\n').repeat(14);
const longJa='日本語の長い返信です。テスト用の文章です。\n'.repeat(100);
function check(name,details){report.checks.push({name,details,passed:true});console.log('PASS '+name);}
async function screenshot(page,name){const file=path.join(output,name+'.png');await page.screenshot({path:file});report.screenshots.push(file);}
async function open(){
 const env={...process.env,YUKINO_SETTINGS_QA_DATA:appData,YUKINO_DEV_SERVER_URL:report.url};delete env.ELECTRON_RUN_AS_NODE;delete env.YUKINO_PYTHON;
 desktop=await _electron.launch({args:[path.join(root,'scripts/qa-companion-windows.cjs')],cwd:root,env,timeout:45000});
 desktop.on('window',page=>page.on('pageerror',error=>report.rendererErrors.push(error.message)));
 // Both restored companions may finish loading before the Vite main page.
 // Select by the real main route, not by Playwright's first-ready window order.
 main=null;
 for(let attempt=0;attempt<200&&!main;attempt++){
  main=desktop.windows().find(page=>{try{const url=new URL(page.url());return url.origin===new URL(report.url).origin&&['/','/index.html'].includes(url.pathname)&&!url.searchParams.has('kind');}catch{return false;}});
  if(!main)await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.ok(main,'Missing real main-window route');await main.waitForFunction(()=>typeof window.desktop?.companionSet==='function');await main.locator('.app').waitFor();
 for(let n=0;n<4;n++){await main.waitForTimeout(300);const skip=main.locator('.setup-dialog footer .text-link');if(await skip.count())await skip.click();const later=main.getByRole('button',{name:'稍后再说',exact:true});if(await later.count())await later.click();}
 await main.waitForFunction(()=>!document.querySelector('.voice-chat-wizard'));
}
async function shutdown(){if(!desktop)return;report.blockedRequests.push(...await desktop.evaluate(()=>globalThis.settingsQaBlockedRequests));await desktop.close();desktop=null;}
async function windowFor(kind,menu=false){
 for(let n=0;n<150;n++){
  const page=desktop.windows().find(page=>{try{const url=new URL(page.url());return url.searchParams.get('kind')===kind&&(url.searchParams.get('view')==='menu')===menu;}catch{return false;}});
  if(page){await page.waitForFunction(()=>typeof window.companion?.call==='function');return page;}
  await main.waitForTimeout(100);
 }
 throw Error('Missing actual companion window: '+kind+' menu='+menu);
}
const prefs=(page,value)=>page.evaluate(value=>window.companion.call('prefs',value),value);
const reply=value=>desktop.evaluate((_electron,value)=>globalThis.companionWindowQa.showReply(value),value);
async function geometry(page,kind,scale,inputPosition){
 const value=await page.evaluate(kind=>{
  const pick=selector=>{const el=document.querySelector(selector);if(!el)return null;const r=el.getBoundingClientRect(),style=getComputedStyle(el);return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,clientWidth:el.clientWidth,clientHeight:el.clientHeight,scrollWidth:el.scrollWidth,scrollHeight:el.scrollHeight,fontSize:style.fontSize,lineHeight:style.lineHeight};};
  return {viewport:{width:innerWidth,height:innerHeight},bubble:pick(kind==='pet'?'#bubble':'.model-bubble'),body:pick(kind==='pet'?'#bubble-body':'.model-reply'),figure:pick(kind==='pet'?'#pet':'.model-window-canvas'),dock:pick(kind==='pet'?'#pet-composer':'.compact-dock'),toolbar:kind==='model'?pick('.model-toolbar'):null};
 },kind);
 report.geometry.push({kind,scale,inputPosition,...value});
 const {bubble,body,figure,dock,viewport}=value;
 assert.ok(bubble&&body&&figure&&dock,'Missing visible geometry');
 assert.ok(bubble.x>=-1&&bubble.right<=viewport.width+1&&bubble.y>=-1&&bubble.bottom<=viewport.height+1,kind+' bubble clipped');
 assert.ok(body.scrollWidth<=body.clientWidth+1,kind+' horizontal reply overflow');
 assert.ok(body.clientHeight>=parseFloat(body.lineHeight)-1,kind+' reply cannot show even one full line: '+body.clientHeight+'px');
 assert.ok(bubble.bottom+4<=figure.y,kind+' bubble overlaps character canvas');
 const overlap=(a,b)=>a.x<b.right&&a.right>b.x&&a.y<b.bottom&&a.bottom>b.y;
 assert.ok(!overlap(bubble,dock)&&!overlap(figure,dock),kind+' dock overlaps character/reply');
 assert.equal(body.fontSize,'14px');
 return value;
}
async function exerciseDrag(page,kind){
 const body=kind==='pet'?await page.locator('#pet').evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x/innerWidth,y:r.y/innerHeight,width:r.width/innerWidth,height:r.height/innerHeight};}):null;
 const {covered}=require('../electron/companion-geometry.cjs');
 for(const point of [{x:-100000,y:-100000},{x:100000,y:100000}]){
  await page.evaluate(body=>window.companion.call('drag-start',{point:{x:0,y:0},body}),body);
  await page.evaluate(point=>window.companion.call('drag-end',{moved:true,point}),point);
  const native=await desktop.evaluate(({screen},kind)=>({bounds:globalThis.companionWindowQa.windows.get(kind).getBounds(),areas:screen.getAllDisplays().map(display=>display.workArea)}),kind);
  const relative=await page.locator(kind==='pet'?'#bubble':'.model-bubble').evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};});
  const absolute={...relative,x:relative.x+native.bounds.x,y:relative.y+native.bounds.y};
  (report.nativeDrag??=[]).push({kind,point,...native,bubble:absolute});
  assert.ok(covered(absolute,native.areas),kind+' bubble leaves desktop after edge drag');
 }
 await screenshot(page,kind+'-edge-drag');
 await main.evaluate(()=>window.desktop.companionSet({positions:{}}));
 check(kind+' native drag release keeps the reply on the desktop at opposite edges');
}
async function exerciseFeedback(page,kind,button){
 await prefs(page,{animation:true});await button.hover();await page.waitForTimeout(380);
 assert.equal(await button.evaluate(el=>getComputedStyle(el).translate),'0px -1px');
 await page.mouse.down();await page.waitForTimeout(180);
 assert.ok(parseFloat(await button.evaluate(el=>getComputedStyle(el).scale))<1,kind+' language button has no press feedback');
 await page.mouse.up();
 await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(150);
 assert.equal(await button.evaluate(el=>getComputedStyle(el).translate),'none');
 await page.emulateMedia({reducedMotion:'no-preference'});await prefs(page,{animation:false});await page.waitForTimeout(150);
 assert.equal(await button.evaluate(el=>getComputedStyle(el).translate),'none');
 check(kind+' language chip animates on hover/press and stays still with reduced motion');
}
async function exercise(page,kind){
 const bubble=kind==='pet'?'#bubble':'.model-bubble',body=kind==='pet'?'#bubble-body':'.model-reply';
 await reply({id:kind+'-short',zh:'布局测试。',ja:'テストです。'});await page.locator(bubble).waitFor();
 const shortWidth=await page.locator(bubble).evaluate(el=>el.getBoundingClientRect().width);
 await reply({id:kind+'-long',zh:longZh,ja:longJa});await page.waitForFunction(({body,text})=>document.querySelector(body)?.textContent===text,{body:kind==='pet'?'#zh':body,text:longZh});
 const full=await geometry(page,kind,1,'below');assert.ok(full.bubble.width>shortWidth);assert.ok(full.body.scrollHeight>full.body.clientHeight);
 await page.locator(body).evaluate(el=>{el.scrollTop=80;el.dispatchEvent(new Event('scroll'));});
 const top=await page.locator(body).evaluate(el=>el.scrollTop);
 await reply({id:kind+'-long',zh:longZh+'\n追加内容',ja:longJa});await page.waitForFunction(selector=>document.querySelector(selector)?.textContent.endsWith('追加内容'),kind==='pet'?'#zh':body);
 assert.ok(Math.abs(await page.locator(body).evaluate(el=>el.scrollTop)-top)<2);
 const latest=kind==='pet'?page.locator('#bubble-latest'):page.getByRole('button',{name:'回到最新',exact:true});await latest.waitFor();await latest.click();
 await page.waitForFunction(selector=>{const el=document.querySelector(selector);return el.scrollHeight-el.clientHeight-el.scrollTop<=2;},body);
 check(kind+' long text wraps, keeps reading position, and returns to latest');
 await screenshot(page,kind+'-long-reply');
 const language=kind==='pet'?page.locator('#bubble-language'):page.getByRole('button',{name:/气泡语言/});
 await language.click();await page.waitForFunction(selector=>document.querySelector(selector)?.textContent.includes('日本語'),body);
 await language.click();await page.waitForFunction(selector=>document.querySelector(selector)?.textContent.includes('布局测试')&&document.querySelector(selector)?.textContent.includes('日本語'),body);
 check(kind+' Chinese / Japanese / bilingual toggle uses the real persisted IPC');
 await prefs(page,{showBubbles:false});await page.locator(bubble).waitFor({state:'hidden'});await prefs(page,{showBubbles:true});await page.locator(bubble).waitFor();
 for(const scale of [.6,1,2])for(const inputPosition of ['below','above']){
  await prefs(page,{scale,inputPosition});await page.waitForTimeout(300);
  await geometry(page,kind,scale,inputPosition);await screenshot(page,kind+'-'+scale+'-'+inputPosition);
 }
 check(kind+' bubble, character and input stay separate at 0.6 / 1 / 2 scale and both input positions');
 await exerciseFeedback(page,kind,language);
 await prefs(page,{scale:1,inputPosition:'below',bubbleLanguage:'zh',opacity:.6});
 const opacity=await page.evaluate(kind=>({root:getComputedStyle(document.querySelector(kind==='pet'?'#stage':'.model-companion')).opacity,figure:getComputedStyle(document.querySelector(kind==='pet'?'#pet':'.model-window-canvas')).opacity}),kind);
 assert.equal(opacity.root,'1',kind+' opacity must not fade the reply or input controls');assert.equal(opacity.figure,'0.6');check(kind+' transparency affects only the figure, not reply or input');
 const dock=page.locator(kind==='pet'?'#pet-composer':'.compact-dock');await dock.hover();await page.locator(kind==='pet'?'#pet-composer.expanded':'.compact-dock.expanded').waitFor();
 const input=kind==='pet'?page.locator('#pet-input'):page.locator('.compact-dock input');await input.fill('仅输入测试，不发送');
 await prefs(page,{mouseThrough:true});await input.hover();await input.fill('穿透开启后仍可编辑');
 await prefs(page,{mouseThrough:false});await input.fill('');await input.blur();
 check(kind+' input remains interactive when character mouse-through is enabled');
 await page.locator(kind==='pet'?'#pet':'.model-toolbar').dispatchEvent('contextmenu');
 const menu=await windowFor(kind,true);await menu.locator('#pet-menu').waitFor();
 const bounds=await desktop.evaluate((_electron,kind)=>{const m=globalThis.companionWindowQa;return {owner:m.windows.get(kind).getBounds(),menu:m.menus.get(kind).getBounds()};},kind);
 const a=bounds.owner,b=bounds.menu;assert.ok(b.x+b.width<=a.x||b.x>=a.x+a.width||b.y+b.height<=a.y||b.y>=a.y+a.height,'Settings overlaps owner');
 assert.equal(await menu.locator('#pet-menu').evaluate(el=>getComputedStyle(el).opacity),'1');
 assert.ok(await menu.locator('#menu-body').evaluate(el=>el.scrollHeight>el.clientHeight&&el.scrollWidth<=el.clientWidth+1));
 await menu.getByLabel('输入框位置',{exact:true}).selectOption('above');await page.waitForFunction(()=>document.querySelector('body[data-input-position="above"],.model-companion[data-input-position="above"]'));
 await menu.getByLabel('输入框位置',{exact:true}).selectOption('below');
 await page.evaluate(()=>window.companion.call('prefs',{bubbleLanguage:'both'}));
 await screenshot(menu,kind+'-settings');
 await menu.getByRole('button',{name:'打开完整设置',exact:true}).click();await main.locator('.settings-page').waitFor();
 check(kind+' adjacent settings do not overlap, remain opaque, scroll and open full settings',bounds);
 await exerciseDrag(page,kind);
 if(kind==='model'){
  await main.getByRole('region',{name:'设置',exact:true}).getByRole('button',{name:'返回对话',exact:true}).click();await main.locator('.settings-page').waitFor({state:'hidden'});
  await page.getByRole('button',{name:'人物设置',exact:true}).click();await main.getByRole('heading',{name:'角色管理',exact:true}).waitFor();
  check('3D toolbar settings button opens the actual main-window character settings');
 }
}
try{
 server=await createServer({root,server:{host:'127.0.0.1',port:0}});await server.listen();report.url=`http://127.0.0.1:${server.httpServer.address().port}/`;
 await open();
 assert.equal(await desktop.evaluate(({app})=>app.getPath('userData')),userData);check('Actual application and all windows use a new isolated profile');
 const catalog=await main.evaluate(()=>window.desktop.characterModelCatalog());const held=catalog.models.find(model=>model.id==='yukino-01-v1');assert.equal(held.hold,true);assert.equal(held.ready,false);
 const denied=await main.evaluate(async()=>{try{await window.desktop.characterModelData('yukino-01-v1');return false;}catch{return true;}});assert.ok(denied);
 await main.getByRole('button',{name:'打开服装面板',exact:true}).click();await main.locator('.wardrobe-panel .skin-card').filter({hasText:'校服'}).click();await main.getByRole('button',{name:'关闭服装面板',exact:true}).click();
 await main.waitForFunction(()=>document.querySelector('.character-model-host')?.dataset.modelReady==='yukino-07-v1'&&document.querySelector('.character-model-host canvas')?.dataset.rendered==='true');check('Actual school GLB renders; original HOLD is still rejected');
 await main.getByRole('button',{name:'设置',exact:true}).click();await main.locator('.settings-nav').getByRole('button',{name:'人物与桌面',exact:true}).click();
 await main.locator('.pet-settings-card').filter({has:main.getByRole('heading',{name:'陪伴方式',exact:true})}).getByRole('combobox').first().click();await main.getByRole('option',{name:'桌宠',exact:true}).click();pet=await windowFor('pet');await pet.waitForFunction(()=>{const c=document.querySelector('#pet');return c&&!c.hidden&&c.getContext('2d').getImageData(0,0,192,208).data.some((value,index)=>index%4===3&&value>0);});await exercise(pet,'pet');
 await main.locator('.settings-nav').getByRole('button',{name:'人物与桌面',exact:true}).click();await main.locator('.pet-settings-card').filter({has:main.getByRole('heading',{name:'陪伴方式',exact:true})}).getByRole('combobox').first().click();await main.getByRole('option',{name:'桌宠和人物窗口',exact:true}).click();model=await windowFor('model');
 await prefs(model,{scale:1,inputPosition:'below',opacity:1,bubbleLanguage:'zh'});
 await model.waitForFunction(()=>document.querySelector('.model-window-canvas')?.dataset.modelReady==='yukino-07-v1'&&document.querySelector('.model-window-canvas canvas')?.dataset.rendered==='true');assert.equal(await model.locator('.model-window-fallback').count(),0);await exercise(model,'model');
 const pair=[];
 for(const [kind,page]of [['pet',pet],['model',model]]){
  const native=await desktop.evaluate((_electron,kind)=>globalThis.companionWindowQa.windows.get(kind).getBounds(),kind);
  const box=await page.locator(kind==='pet'?'#bubble':'.model-bubble').evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};});
  pair.push({kind,x:box.x+native.x,y:box.y+native.y,width:box.width,height:box.height});
 }
 report.pairedBubbles=pair;const [a,b]=pair;
 assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y,'Simultaneous pet and model reply bubbles overlap');
 check('Both desktop reply bubbles remain separate in simultaneous-display mode');
 await screenshot(main,'full-settings');
 const saved=JSON.parse(await fs.readFile(path.join(userData,'companions.json'),'utf8'));assert.equal(saved.bubbleLanguage,'both');assert.equal(saved.soundEnabled,false);
 await shutdown();await open();pet=await windowFor('pet');model=await windowFor('model');
 const restored=await desktop.evaluate(()=>globalThis.companionWindowQa.getState());for(const key of ['bubbleLanguage','inputPosition','scale','opacity','mode','mouseThrough','showBubbles'])assert.equal(restored[key],saved[key]);
 await reply({id:'restart-layout',zh:'重启后的中文气泡。',ja:'再起動後の日本語です。'});await pet.waitForFunction(()=>document.querySelector('#zh')?.textContent.includes('重启后')&&document.querySelector('#ja')?.textContent.includes('再起動'));await model.waitForFunction(()=>document.querySelector('.model-reply')?.textContent.includes('再起動'));check('Real Electron restart restores companion preferences and both windows');
 report.applicationErrors=await main.locator('.main .error').allTextContents();assert.deepEqual(report.applicationErrors,[]);
 assert.deepEqual(report.rendererErrors,[]);assert.deepEqual(report.blockedRequests,[]);report.success=true;
}catch(error){report.success=false;report.failure=error.stack;process.exitCode=1;console.error(error);for(const [name,page]of [['main',main],['pet',pet],['model',model]])if(page&&!page.isClosed())await screenshot(page,'failure-'+name).catch(()=>{});}
finally{await shutdown().catch(error=>{report.cleanupError=error.message;process.exitCode=1;});await server?.close();await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log('Report: '+path.join(output,'report.json'));}
