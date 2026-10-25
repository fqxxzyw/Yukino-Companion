// Run the actual built desktop renderer under Electron, without user data, API
// requests, model downloads, or TTS. Example on a Windows CI runner:
//   npx electron scripts/capture-ui.cjs --output build/ui-review
// Linux needs a display server: xvfb-run -a npx electron scripts/capture-ui.cjs
const {app, BrowserWindow, session} = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {createHash} = require('node:crypto');
const root = path.resolve(__dirname,'..');
const outputIndex = process.argv.indexOf('--output');
const output = path.resolve(outputIndex < 0 ? path.join(root,'build/ui-review') : process.argv[outputIndex+1]);
const report = {purpose:'Production renderer visual QA with isolated synthetic fixtures; no real API, GPU or audio inference',platform:process.platform,electron:process.versions.electron,screenshots:[],checks:[],errors:[],blockedRequests:[]};
let window, temp;
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor','1');
app.commandLine.appendSwitch('disable-background-timer-throttling');
const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function evaluate(source) { return window.webContents.executeJavaScript(source,true); }
async function settle() {
  await evaluate(`document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))`);
  await pause(100);
}
async function waitFor(source, description) {
  for(let attempt=0;attempt<100;attempt++) {
    if(await evaluate(source)) return;
    await pause(50);
  }
  throw Error(`UI did not reach ${description}`);
}
async function click(selector) {
  const found=await evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element||element.disabled)return false;element.click();return true;})()`);
  if(!found)throw Error(`Missing usable UI control: ${selector}`);
  await settle();
}
async function check(name, source) {
  const passed=Boolean(await evaluate(source));
  report.checks.push({name,passed});
  if(!passed)throw Error(`UI check failed: ${name}`);
}
async function key(keyCode) {
  window.webContents.sendInputEvent({type:'keyDown',keyCode});
  window.webContents.sendInputEvent({type:'keyUp',keyCode});
  await settle();
}
async function settingsTab(label) {
  const found=await evaluate(`(()=>{const button=[...document.querySelectorAll('.settings-nav button')].find(el=>el.textContent.trim()===${JSON.stringify(label)});if(!button)return false;button.click();return true;})()`);
  if(!found)throw Error(`Missing settings page: ${label}`);
  await settle();
}
async function capture(name) {
  await settle();
  const geometry=await evaluate(`(()=>{const app=document.querySelector('.app');return {width:innerWidth,height:innerHeight,appOverflow:app.scrollWidth-app.clientWidth,documentOverflow:document.documentElement.scrollWidth-innerWidth,overlays:[...document.querySelectorAll('[role="dialog"],[role="alertdialog"],[role="listbox"]')].map(element=>{const rect=element.getBoundingClientRect();return {role:element.getAttribute('role'),x:rect.x,y:rect.y,width:rect.width,height:rect.height}}),text:document.body.innerText.slice(0,300)};})()`);
  if(geometry.appOverflow>2||geometry.documentOverflow>2)throw Error(`Horizontal overflow in ${name}: ${JSON.stringify(geometry)}`);
  for(const overlay of geometry.overlays)if(overlay.x< -1||overlay.y< -1||overlay.x+overlay.width>geometry.width+1||overlay.y+overlay.height>geometry.height+1)throw Error(`Clipped ${overlay.role} in ${name}: ${JSON.stringify(overlay)}`);
  const image=await window.webContents.capturePage();
  if(image.isEmpty())throw Error(`Empty Electron capture: ${name}`);
  const png=image.toPNG();
  if(png.length<5000)throw Error(`Suspiciously empty PNG: ${name}`);
  const file=path.join(output,`${name}.png`);await fs.writeFile(file,png);
  report.screenshots.push({name,file:path.basename(file),bytes:png.length,sha256:createHash('sha256').update(png).digest('hex'),...geometry});
  console.log(`Captured ${name}: ${geometry.width}×${geometry.height}`);
}
async function run() {
  await fs.mkdir(output,{recursive:true});
  temp=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-ui-capture-'));
  app.setPath('userData',temp);
  await app.whenReady();
  const partition=session.fromPartition(`capture-${Date.now()}`);
  partition.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  partition.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(details,callback)=>{report.blockedRequests.push(details.url);callback({cancel:true});});
  window=new BrowserWindow({width:1280,height:840,useContentSize:true,show:false,frame:false,backgroundColor:'#f1f6fc',webPreferences:{preload:path.join(__dirname,'ui-capture/preload.cjs'),session:partition,contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false,offscreen:true}});
  window.webContents.on('console-message',details=>{if(details.level==='error')report.errors.push(details.message);});
  window.webContents.on('preload-error',(_event,_file,error)=>report.errors.push(error.message));
  window.webContents.on('render-process-gone',(_event,details)=>report.errors.push(`Renderer process gone: ${details.reason}`));
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',event=>event.preventDefault());
  await window.loadFile(path.join(root,'dist/index.html'));
  await waitFor(`Boolean(document.querySelector('.app')&&document.querySelector('.welcome'))`,'welcome screen');
  await check('Application icon loads',`[...document.querySelectorAll('img')].every(img=>img.complete&&img.naturalWidth>0)`);
  await capture('01-home');
  await click('.history-row>button');
  await waitFor(`document.querySelectorAll('.message').length===2`,'fixture conversation');
  await capture('02-bilingual-chat');
  await click('.chat-toolbar [aria-label="气泡显示语言"] button:nth-child(2)');
  await waitFor(`Boolean(document.querySelector('.language-block[lang="ja"]'))&&!document.querySelector('.bubble [lang="zh-CN"]')`,'Japanese display');
  await capture('03-japanese-chat');
  await click('[aria-label="设置"]');
  await waitFor(`Boolean(document.querySelector('.settings'))`,'settings dialog');
  await capture('04-appearance-settings');
  await check('Appearance control is a styled switch',`document.querySelector('.settings input[type="checkbox"]')?.getAttribute('role')==='switch'`);
  await click('.settings input[role="switch"]');
  await check('Switch toggles off',`document.querySelector('.settings input[role="switch"]').checked===false`);
  await click('.settings input[role="switch"]');
  await check('Switch toggles on',`document.querySelector('.settings input[role="switch"]').checked===true`);
  await settingsTab('形象与展示');
  await capture('05-companion-settings');
  await settingsTab('声音与语音');
  await capture('06-voice-settings');
  await settingsTab('双语与翻译');
  await capture('07-translation-settings');
  await settingsTab('角色设定');
  const select='[role="combobox"][aria-label="提示词档位"]';
  await evaluate(`document.querySelector(${JSON.stringify(select)}).focus()`);
  await key('Down');
  await waitFor(`Boolean(document.querySelector('[role="listbox"]'))`,'custom select menu');
  await capture('08-custom-select');
  await key('Escape');
  await check('Escape dismisses the menu and keeps settings open',`!document.querySelector('[role="listbox"]')&&Boolean(document.querySelector('.settings'))`);
  await key('Down');await key('Down');await key('Enter');
  await check('Keyboard selects the compact persona setting',`document.querySelector(${JSON.stringify(select)}).textContent.includes('精简')&&!document.querySelector('[role="listbox"]')`);
  await key('Down');await key('Tab');
  await check('Tab dismisses the menu and moves focus',`!document.querySelector('[role="listbox"]')&&document.activeElement!==document.querySelector(${JSON.stringify(select)})&&Boolean(document.querySelector('.settings'))`);
  await check('Settings uses custom select controls',`document.querySelectorAll('select').length===0`);
  await click('[aria-label="关闭设置"]');
  await click('[aria-label="关闭聊天窗口"]');
  await waitFor(`Boolean(document.querySelector('.close-dialog'))`,'close behavior dialog');
  await capture('09-close-choice');
  await evaluate(`document.querySelector('.close-dialog .secondary').click()`);await settle();
  await click('[aria-label="删除这段对话"]');
  await waitFor(`Boolean(document.querySelector('.confirm-dialog'))`,'custom confirmation dialog');
  await capture('10-confirm-dialog');
  await click('.confirm-dialog .secondary');
  await check('Cancel keeps the conversation',`!document.querySelector('.confirm-dialog')&&document.querySelectorAll('.message').length===2`);
  const expandedAvatarX=await evaluate(`document.querySelector('.avatar-stage').getBoundingClientRect().x`);
  await click('[aria-label="收起或展开侧边栏"]');
  await capture('11-collapsed-sidebar');
  await check('Left character follows the collapsed sidebar',`document.querySelector('.avatar-stage').getBoundingClientRect().x<${expandedAvatarX}`);
  window.setContentSize(760,580);await settle();
  await capture('12-compact-chat');
  await click('[aria-label="设置"]');await settle();
  await capture('13-compact-settings');
  report.success=report.errors.length===0&&report.blockedRequests.length===0;
  if(!report.success)throw Error('Visual QA produced renderer errors or attempted network requests.');
}
const watchdog=setTimeout(async()=>{
  report.success=false;report.failure='Electron visual QA timed out';console.error(report.failure);
  await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');app.exit(1);
},90000);
run().then(async()=>{
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  clearTimeout(watchdog);window?.destroy();
  // Chromium may briefly hold files open on Windows. The fixtures contain no secrets.
  await fs.rm(temp,{recursive:true,force:true,maxRetries:3,retryDelay:100}).catch(()=>{});
  app.exit(0);
}).catch(async error=>{
  report.success=false;report.failure=error.stack||error.message;
  console.error(report.failure);
  await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  clearTimeout(watchdog);window?.destroy();app.exit(1);
});
