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
  report.checks.push({name,passed,...(!passed?{condition:source}:{})});
  if(!passed)throw Error(`UI check failed: ${name}`);
}
async function key(keyCode) {
  window.webContents.sendInputEvent({type:'keyDown',keyCode});
  window.webContents.sendInputEvent({type:'keyUp',keyCode});
  await settle();
}
async function fill(selector,value) {
  await evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});if(!input)throw Error('Missing input');input.focus();input.select();if(document.activeElement!==input)throw Error('Input did not receive focus');})()`);
  await window.webContents.insertText(value);
  await settle();
}
async function colorState() {
  return evaluate(`(()=>{const input=document.querySelector('input[aria-label="强调色 HEX"]');return {value:input?.value,invalid:input?.getAttribute('aria-invalid'),focused:document.activeElement===input,documentHasFocus:document.hasFocus(),activeElement:{tag:document.activeElement?.tagName,label:document.activeElement?.getAttribute('aria-label')},accent:getComputedStyle(document.querySelector('.app')).getPropertyValue('--accent').trim()};})()`);
}
async function failureDiagnostics() {
  if(!window||window.isDestroyed()||window.webContents.isDestroyed())return;
  try {
    report.failureState=await evaluate(`(()=>{
      const describe=element=>element?{tag:element.tagName,label:element.getAttribute('aria-label'),type:element.getAttribute('type'),value:element.value,invalid:element.getAttribute('aria-invalid'),text:element.textContent?.trim().slice(0,100)}:null;
      const app=document.querySelector('.app'),theme=app?getComputedStyle(app):null;
      return {documentHasFocus:document.hasFocus(),activeElement:describe(document.activeElement),colorInputs:[...document.querySelectorAll('.color-panel input')].map(describe),accent:theme?.getPropertyValue('--accent').trim(),background:theme?.getPropertyValue('--bg').trim(),settings:document.querySelector('.settings-main h2')?.textContent,text:document.body.innerText.slice(-2200)};
    })()`);
    console.error('Failure UI state: '+JSON.stringify(report.failureState));
  }catch(error){report.diagnosticError=error.message;}
  try {
    const image=await window.webContents.capturePage();
    if(!image.isEmpty()){
      const png=image.toPNG(),file='99-failure.png';await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,file),png);
      report.screenshots.push({name:'99-failure',file,bytes:png.length,sha256:createHash('sha256').update(png).digest('hex'),failure:true});
    }
  }catch(error){report.failureCaptureError=error.message;}
}
async function settingsTab(label) {
  const found=await evaluate(`(()=>{const button=[...document.querySelectorAll('.settings-nav button')].find(el=>el.textContent.trim()===${JSON.stringify(label)});if(!button)return false;button.click();return true;})()`);
  if(!found)throw Error(`Missing settings page: ${label}`);
  await settle();
}
async function capture(name) {
  await settle();
  const geometry=await evaluate(`(()=>{const app=document.querySelector('.app');
    const controls=[...document.querySelectorAll('.primary,.secondary')].flatMap(element=>{
      const rect=element.getBoundingClientRect(),style=getComputedStyle(element);
      if(!element.getClientRects().length||style.visibility==='hidden'||style.display==='none')return [];
      let visible={left:Math.max(0,rect.left),right:Math.min(innerWidth,rect.right),top:Math.max(0,rect.top),bottom:Math.min(innerHeight,rect.bottom)};
      let horizontalClip=false;
      for(let parent=element.parentElement;parent;parent=parent.parentElement){
        const parentStyle=getComputedStyle(parent),box=parent.getBoundingClientRect();
        if(/auto|scroll|hidden|clip/.test(parentStyle.overflowX)){
          visible.left=Math.max(visible.left,box.left);visible.right=Math.min(visible.right,box.right);
          if(rect.left<box.left-1||rect.right>box.right+1)horizontalClip=true;
        }
        if(/auto|scroll|hidden|clip/.test(parentStyle.overflowY)){visible.top=Math.max(visible.top,box.top);visible.bottom=Math.min(visible.bottom,box.bottom);}
      }
      if(visible.right<=visible.left||visible.bottom<=visible.top)return [];
      const radius=Math.min(...['borderTopLeftRadius','borderTopRightRadius','borderBottomLeftRadius','borderBottomRightRadius'].map(key=>parseFloat(style[key])));
      return [{label:element.textContent.trim().slice(0,100),tag:element.tagName,disabled:element.matches(':disabled'),height:rect.height,minHeight:parseFloat(style.minHeight)||0,radius,paddingLeft:parseFloat(style.paddingLeft)||0,contentOverflowX:element.scrollWidth-element.clientWidth,contentOverflowY:element.scrollHeight-element.clientHeight,horizontalClip}];
    });
    return {width:innerWidth,height:innerHeight,appOverflow:app.scrollWidth-app.clientWidth,documentOverflow:document.documentElement.scrollWidth-innerWidth,controls,overlays:[...document.querySelectorAll('[role="dialog"],[role="alertdialog"],[role="listbox"]')].map(element=>{const rect=element.getBoundingClientRect();return {role:element.getAttribute('role'),x:rect.x,y:rect.y,width:rect.width,height:rect.height}}),text:document.body.innerText.slice(0,300)};})()`);
  const image=await window.webContents.capturePage();
  if(image.isEmpty())throw Error(`Empty Electron capture: ${name}`);
  const png=image.toPNG();
  if(png.length<5000)throw Error(`Suspiciously empty PNG: ${name}`);
  const file=path.join(output,`${name}.png`);await fs.writeFile(file,png);
  report.screenshots.push({name,file:path.basename(file),bytes:png.length,sha256:createHash('sha256').update(png).digest('hex'),...geometry});
  if(geometry.appOverflow>2||geometry.documentOverflow>2)throw Error(`Horizontal overflow in ${name}: ${JSON.stringify(geometry)}`);
  for(const overlay of geometry.overlays)if(overlay.x< -1||overlay.y< -1||overlay.x+overlay.width>geometry.width+1||overlay.y+overlay.height>geometry.height+1)throw Error(`Clipped ${overlay.role} in ${name}: ${JSON.stringify(overlay)}`);
  const invalidControls=geometry.controls.filter(control=>control.height<39.5||control.minHeight<40||control.radius<10||control.paddingLeft<12||control.contentOverflowX>1||control.contentOverflowY>1||control.horizontalClip);
  report.checks.push({name:`${name}: visible primary and secondary buttons are styled and unclipped`,passed:invalidControls.length===0,count:geometry.controls.length});
  if(invalidControls.length)throw Error(`Unstyled or clipped controls in ${name}: ${JSON.stringify(invalidControls)}`);
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
  await click('button[aria-label="强调色"]');
  await waitFor(`Boolean(document.querySelector('.color-panel'))`,'custom color panel');
  await fill('input[aria-label="强调色 HEX"]','#638a79');
  await check('Valid HEX changes the theme',`document.querySelector('button[aria-label="强调色"]').textContent.includes('#638A79')&&getComputedStyle(document.querySelector('.app')).getPropertyValue('--accent').trim()==='#638a79'`);
  await evaluate(`document.querySelector('input[aria-label="强调色色相"]').focus()`);
  await key('Right');
  await check('Color slider changes the theme',`document.querySelector('input[aria-label="强调色 HEX"]').value.toLowerCase()!=='#638a79'&&/^#[0-9a-f]{6}$/i.test(document.querySelector('input[aria-label="强调色 HEX"]').value)`);
  const validHex=await evaluate(`document.querySelector('input[aria-label="强调色 HEX"]').value`);
  await fill('input[aria-label="强调色 HEX"]','invalid');
  report.colorInteraction={expectedHex:validHex,beforeBlur:await colorState()};
  await check('Invalid HEX remains editable without changing the theme',`document.querySelector('input[aria-label="强调色 HEX"]').value==='invalid'&&document.querySelector('input[aria-label="强调色 HEX"]').getAttribute('aria-invalid')==='true'&&getComputedStyle(document.querySelector('.app')).getPropertyValue('--accent').trim()===${JSON.stringify(validHex)}`);
  await key('Tab');
  report.colorInteraction.afterBlur=await colorState();
  await check('Tab moves focus out of the HEX input',`document.activeElement!==document.querySelector('input[aria-label="强调色 HEX"]')`);
  await check('Invalid HEX restores the last valid color',`document.querySelector('input[aria-label="强调色 HEX"]').value===${JSON.stringify(validHex)}`);
  await fill('input[aria-label="强调色 HEX"]','#477fd1');
  await capture('04a-color-panel');
  await click('button[aria-label="强调色"]');
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
  await failureDiagnostics();
  await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  clearTimeout(watchdog);window?.destroy();app.exit(1);
});
