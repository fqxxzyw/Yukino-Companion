// Run the actual built desktop renderer under Electron, without user data, API
// requests, model downloads, or TTS. Example on a Windows CI runner:
//   npx electron scripts/capture-ui.cjs --output build/ui-review
// The isolated test window is visible and focused so native input/focus events
// match the shipped app. Hidden offscreen windows suppress DOM blur events.
// Linux needs a display server: xvfb-run -a npx electron scripts/capture-ui.cjs
const {app, BrowserWindow, session} = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {createHash} = require('node:crypto');
const root = path.resolve(__dirname,'..');
const outputIndex = process.argv.indexOf('--output');
const output = path.resolve(outputIndex < 0 ? path.join(root,'build/ui-review') : process.argv[outputIndex+1]);
const report = {purpose:'Production renderer visual QA in a visible focused test window with isolated synthetic fixtures; no real API, GPU or audio inference',platform:process.platform,electron:process.versions.electron,screenshots:[],checks:[],errors:[],blockedRequests:[]};
const headless=app.commandLine.getSwitchValue('ozone-platform')==='headless';
report.headless=headless;
if(headless)report.purpose+='; headless rendering is supplemental and does not verify a native Windows desktop';
let window, temp;
// Exercise the same WebGL-capable renderer as production: scene backgrounds
// are actual Three.js geometry, not a software-only mock.
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
  await requireFocus();
  const found=await evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element||element.disabled)return false;element.scrollIntoView({block:'nearest',inline:'nearest'});return true;})()`);
  if(!found)throw Error(`Missing usable UI control: ${selector}`);
  await settle();
  const point=await evaluate(`(()=>{const rect=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2)};})()`);
  window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});
  window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});
  await settle();
}
async function check(name, source) {
  const passed=Boolean(await evaluate(source));
  report.checks.push({name,passed,...(!passed?{condition:source}:{})});
  if(!passed)throw Error(`UI check failed: ${name}`);
}
async function key(keyCode) {
  await requireFocus();
  window.webContents.sendInputEvent({type:'keyDown',keyCode});
  window.webContents.sendInputEvent({type:'keyUp',keyCode});
  await settle();
}
async function pointerDrag(selector,target) {
  await requireFocus();
  const start=await evaluate(`(()=>{const rect=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+Math.min(18,rect.height/2))};})()`);
  const end=typeof target==='string'?await evaluate(target):target;
  const hit=await evaluate(`(()=>{const el=document.elementFromPoint(${start.x},${start.y});return {tag:el?.tagName,classes:el?.className};})()`);
  report.pointerInteractions??=[];report.pointerInteractions.push({selector,start,end,hit});
  window.webContents.sendInputEvent({type:'mouseMove',...start});
  window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...start});
  for(let step=1;step<=8;step++){
    window.webContents.sendInputEvent({type:'mouseMove',x:Math.round(start.x+(end.x-start.x)*step/8),y:Math.round(start.y+(end.y-start.y)*step/8),button:'left',modifiers:['leftButtonDown']});
    await pause(20);
  }
  window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:Math.round(end.x),y:Math.round(end.y)});
  await settle();
}
async function fill(selector,value) {
  await requireFocus();
  await evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});if(!input)throw Error('Missing input');input.focus();input.select();if(document.activeElement!==input)throw Error('Input did not receive focus');})()`);
  await window.webContents.insertText(value);
  await settle();
}
async function requireFocus() {
  if(await evaluate('document.hasFocus()'))return;
  window.show();window.focus();window.webContents.focus();
  await waitFor('document.hasFocus()','focused test document');
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
  window=new BrowserWindow({width:1280,height:840,useContentSize:true,show:true,frame:false,backgroundColor:'#f1f6fc',webPreferences:{preload:path.join(__dirname,'ui-capture/preload.cjs'),session:partition,contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
  window.webContents.on('console-message',details=>{if(details.level==='error')report.errors.push(details.message);});
  window.webContents.on('preload-error',(_event,_file,error)=>report.errors.push(error.message));
  window.webContents.on('render-process-gone',(_event,details)=>report.errors.push(`Renderer process gone: ${details.reason}`));
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',event=>event.preventDefault());
  await window.loadFile(path.join(root,'dist/index.html'));
  window.show();window.focus();window.webContents.focus();
  // Ozone headless advertises a 1×1 desktop; explicit post-show bounds allow layout QA.
  if(headless)window.setContentSize(1280,840);
  await waitFor('document.hasFocus()','focused test document');
  await check('Visible Electron test document has native focus','document.hasFocus()');
  await waitFor(`Boolean(document.querySelector('.app')&&document.querySelector('.welcome'))`,'welcome screen');
  await check('Application icon loads',`[...document.querySelectorAll('img')].every(img=>img.complete&&img.naturalWidth>0)`);
  await waitFor(`Boolean(document.querySelector('.setup-dialog'))`,'first-run setup');
  await check('Base first-run setup truthfully offers four optional features and no installed models',`document.querySelectorAll('.setup-feature').length===4&&document.querySelectorAll('.setup-step.ready').length===0&&document.querySelectorAll('.setup-step.missing').length===5&&document.querySelector('.setup-download-summary').textContent.includes('GB')`);
  await check('CPU-only catalogue has a truthful runtime notice',`document.querySelector('.setup-runtime').textContent.includes('CPU')&&document.querySelector('.setup-runtime').textContent.includes('Python 和推理依赖')`);
  await click('[aria-label="首次配置推理环境"]');
  await check('Unavailable CUDA is disabled in the runtime picker',`[...document.querySelectorAll('[role="option"]')].some(option=>option.textContent.includes('NVIDIA CUDA')&&option.getAttribute('aria-disabled')==='true')`);
  await key('Escape');
  await capture('00-first-run-setup');
  await click('.setup-dialog .resource-help button');
  await check('Resource help opens the fixed download help topic',`window.desktop.qaCalls().then(calls=>calls.help.at(-1)==='downloads')`);
  for(let index=1;index<=4;index++)await click(`.setup-feature:nth-child(${index}) input`);
  await check('Pet-only selection does not request a Python environment',`!document.querySelector('.setup-runtime')&&document.querySelector('.setup-runtime-note').textContent.includes('不安装 Python')&&document.querySelectorAll('.setup-feature input:checked').length===1`);
  await click('.setup-dialog footer .primary');
  await waitFor(`document.querySelector('.setup-progress progress')?.value===20095072`,'pet-only actual fixture progress');
  await check('Only pet is passed to the installer and aria2 engine is shown',`window.desktop.qaCalls().then(calls=>JSON.stringify(calls.install.at(-1).features)==='["pet"]'&&document.querySelector('.setup-progress').textContent.includes('aria2'))`);
  await capture('00a-pet-only-progress');
  await click('.setup-dialog footer .secondary');
  await waitFor(`!document.querySelector('.setup-progress')`,'cancelled resource transfer');
  await check('Cancellation is delivered once without background retries',`window.desktop.qaCalls().then(calls=>calls.cancel===1&&calls.install.length===1)`);

  await click('.setup-dialog footer .text-link');
  await check('Skipping setup leaves chat available',`!document.querySelector('.setup-dialog')&&Boolean(document.querySelector('.composer'))`);
  await waitFor(`window.desktop.load().then(({state})=>state.setupDismissedVersion==='0.4.0-base.1')`,'persisted setup skip');
  await capture('01-home');
  await click('.history-row>button');
  await waitFor(`document.querySelectorAll('.message').length===2`,'fixture conversation');
  await capture('02-bilingual-chat');
  await click('.chat-toolbar [aria-label="气泡显示语言"] button:nth-child(2)');
  await waitFor(`Boolean(document.querySelector('.language-block[lang="ja"]'))&&!document.querySelector('.bubble [lang="zh-CN"]')`,'Japanese display');
  await capture('03-japanese-chat');
  await click('[aria-label="用日语朗读这条回复"]');
  await check('Missing voice resources route directly to voice settings in Chinese',`document.querySelector('.settings-main h2')?.textContent==='声音与语音'&&document.querySelector('.speech-bar')?.textContent.includes('语音资源尚未准备好')&&!document.body.innerText.includes('Error invoking remote method')`);
  await capture('03a-voice-setup-action');
  await click('[aria-label="关闭设置"]');
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
  await evaluate(`document.querySelector('.relationship-settings').scrollIntoView({block:'center'})`);await settle();
  await check('Relationship state and truthful unlock status are visible',`document.querySelector('.relationship-summary').textContent.includes('好感')&&document.querySelector('.relationship-summary').textContent.includes('体力')&&document.querySelector('.relationship-settings').textContent.includes('赞助解锁尚未启用')`);
  await click('.relationship-settings .secondary');
  await check('Daily check-in is saved once and disables duplicate claim',`document.querySelector('.relationship-settings .secondary').disabled&&document.querySelector('.relationship-settings').textContent.includes('累计签到 1 天')`);
  await capture('05b-relationship-settings');
  const forestButton=await evaluate(`[...document.querySelectorAll('.scene-options button')].findIndex(button=>button.textContent.trim()==='森林')+1`);
  if(!forestButton)throw Error('Missing forest environment control');
  await click(`.scene-options button:nth-child(${forestButton})`);
  await click('.presentation-settings .row input');
  await check('Forest is selected and the full-window environment host is active',`document.querySelector('.app').classList.contains('scene-spread')&&[...document.querySelectorAll('.scene-options button')].some(button=>button.textContent.trim()==='森林'&&button.getAttribute('aria-pressed')==='true')&&Boolean(document.querySelector('.scene-ui-backdrop .environment-backdrop-canvas'))`);
  await check('Lighting, rendering and truthful head-only tracking controls are present',`(()=>{const panel=document.querySelector('.presentation-settings');return [...panel.querySelectorAll('select')].map(select=>select.value).join(',')==='noon,lit'&&panel.textContent.includes('赛璐璐')&&panel.textContent.includes('没有可用的独立眼球蒙皮')})()`);

  await check('Complete original pet settings remain available',`['互动与动作','气泡与语录','桌宠预录语音','专注一会儿','形象透明度','暂停互动','安静模式'].every(text=>document.querySelector('.pet-settings').textContent.includes(text))`);
  await evaluate(`document.querySelector('.pet-settings-card:last-of-type').scrollIntoView({block:'end'})`);await settle();
  await capture('05a-pet-settings-details');
  await settingsTab('声音与语音');
  await capture('06-voice-settings');
  await settingsTab('双语与翻译');
  await capture('07-translation-settings');
  await check('Base translation settings distinguish missing weights from missing environment',`document.querySelector('.settings-body').textContent.includes('公共环境尚未准备好')&&document.querySelector('.resource-card .primary').textContent.includes('准备翻译权重')&&document.querySelector('.resource-help').textContent.includes('无法下载')`);
  await settingsTab('本地模型');
  await capture('07a-local-settings');
  await check('Base local chat accurately reports both missing model and environment',`document.querySelector('.local-model-settings').textContent.includes('本地角色模型尚未准备')&&document.querySelector('.local-resource-state').textContent.includes('缺少角色权重')&&document.querySelector('.local-resource-state').textContent.includes('需要安装运行环境')`);
  await click('.setup-entry');
  await click('.setup-dialog footer .primary');
  await waitFor(`document.querySelector('.setup-progress progress')?.value===268435456`,'status-driven download progress');
  await evaluate(`document.querySelector('.setup-progress').scrollIntoView({block:'end'})`);await settle();
  await capture('07b-setup-progress');
  await pause(250);
  await check('Progress stays at the reported bytes without fake timer increments',`document.querySelector('.setup-progress progress').value===268435456&&document.querySelector('.setup-progress progress').max===1073741824`);
  await evaluate('window.desktop.qaCompleteSetup()');await settle();
  await check('Completed setup keeps resources unloaded until first use',`Boolean(document.querySelector('.setup-complete'))&&document.querySelector('.setup-complete').textContent.includes('使用时加载')`);
  await click('.setup-dialog footer .text-link');
  await click('.local-model-settings .voice-status .primary');
  await check('Local model can be selected and loaded independently of API',`document.querySelector('.local-model-settings').textContent.includes('本地对话已就绪')&&document.querySelector('.chat-source-switch button:first-child').getAttribute('aria-pressed')==='true'`);
  await capture('07c-local-ready');
  await settingsTab('对话 API');
  await waitFor(`!document.querySelector('.api-discover')?.disabled`,'API discovery control');
  await click('.api-discover');
  await check('API discovery presents account models as selectable options',`document.querySelector('.api-notice').textContent.includes('2 个合成测试模型')&&!document.querySelector('input[placeholder="以服务商提供的模型 ID 为准"]')`);
  await click('[aria-label="对话模型"]');
  await waitFor(`Boolean(document.querySelector('[role="listbox"]'))`,'model dropdown');
  await capture('07d-api-model-picker');
  await key('Escape');
  await click('.api-advanced-toggle');
  await click('.api-clear-key');
  await check('Deleting a saved API key clears persistence without removing the selected model',`!document.querySelector('.api-clear-key')&&!document.querySelector('.api-saved')&&document.querySelector('.api-notice').textContent.includes('已删除')&&document.querySelector('[aria-label="对话模型"]').textContent.includes('qa-chat')`);
  await check('Deleted key is absent from the persisted key IDs',`window.desktop.load().then(value=>!value.keyIds.includes('visual-qa'))`);
  await click('.api-manual-toggle input');
  await check('Advanced manual model entry is optional and keeps the selected model',`document.querySelector('.api-manual-toggle input').checked&&document.querySelector('input[placeholder="以服务商提供的模型 ID 为准"]').value==='qa-chat'`);
  await capture('07e-api-advanced-checkbox');
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
  await click('.close-remember input');
  await check('Remember-choice checkmark stays within the checkbox',`(()=>{const input=document.querySelector('.close-remember input'),mark=getComputedStyle(input,'::after');return input.checked&&parseFloat(mark.left)+parseFloat(mark.width)<=input.clientWidth&&parseFloat(mark.top)+parseFloat(mark.height)<=input.clientHeight;})()`);
  await capture('09a-close-remembered');
  await click('.close-options button:first-child');
  await check('Remembered close choice reaches companion persistence',`window.desktop.companionState().then(value=>value.closeAction==='pet'&&value.mode==='pet')`);
  await check('Close choice dismisses the dialog',`!document.querySelector('.close-dialog')`);
  await click('[title="删除这段对话"]');
  await waitFor(`Boolean(document.querySelector('.confirm-dialog'))`,'custom confirmation dialog');
  await capture('10-confirm-dialog');
  await click('.confirm-dialog .secondary');
  await check('Cancel keeps the conversation',`!document.querySelector('.confirm-dialog')&&document.querySelectorAll('.message').length===2`);
  const expandedAvatarX=await evaluate(`document.querySelector('.avatar-stage').getBoundingClientRect().x`);
  await click('[aria-label="收起或展开侧边栏"]');
  await capture('11-collapsed-sidebar');
  await click('[aria-label="打开服装面板"]');
  await check('Wardrobe groups seven outfits and keeps locked outfits identifiable',`(()=>{const panel=document.querySelector('.wardrobe-panel');if(!panel)return false;const cards=[...panel.querySelectorAll('.skin-card')];return cards.length===7&&cards.filter(card=>!card.disabled).length===1&&cards.filter(card=>card.disabled).length===6&&cards.find(card=>!card.disabled).textContent.includes('校服')&&panel.textContent.includes('7 个不同日期')&&new Set([...panel.querySelectorAll('.skin-preview img')].map(img=>img.getAttribute('src'))).size===7})()`);
  await capture('11c-scene-wardrobe');
  await click('[aria-label="关闭服装面板"]');
  await click('[aria-label="人物场景选项"]');
  await check('Scene options open in place without full settings',`Boolean(document.querySelector('.character-scene-menu'))&&!document.querySelector('.settings')`);
  await click('[aria-label="人物渲染风格"][role="combobox"]');
  await click('[role="listbox"][aria-label="人物渲染风格"] [role="option"]:nth-child(3)');
  await check('Mouse selects toon from the scene menu portal without closing or dragging the panel',`Boolean(document.querySelector('.character-scene-menu'))&&!document.querySelector('.character-panel.is-dragging')&&document.querySelector('[aria-label="人物渲染风格"][role="combobox"]').textContent.includes('赛璐璐')&&!document.querySelector('[role="listbox"]')`);
  await waitFor(`window.desktop.load().then(({state})=>state.presentation?.renderStyle==='toon')`,'saved toon style');
  await click('[aria-label="人物日光"][role="combobox"]');
  await click('[role="listbox"][aria-label="人物日光"] [role="option"]:nth-child(1)');
  await check('Mouse selects morning light from the scene menu portal',`Boolean(document.querySelector('.character-scene-menu'))&&document.querySelector('[aria-label="人物日光"][role="combobox"]').textContent.includes('清晨')`);
  await waitFor(`window.desktop.load().then(({state})=>state.presentation?.timeOfDay==='morning')`,'saved morning light');
  await key('Escape');
  await check('Scene menu dismisses with Escape',`!document.querySelector('.character-scene-menu')`);
  await check('Duration is absent from sidebar and character panel',`!document.querySelector('.stage-footer')&&!document.querySelector('.sidebar').textContent.includes('已陪伴')`);

  await check('Left character follows the collapsed sidebar',`document.querySelector('.avatar-stage').getBoundingClientRect().x<${expandedAvatarX}`);
  await pointerDrag('.character-drag-handle',`(()=>{const r=document.querySelector('.main').getBoundingClientRect();return {x:r.right-45,y:r.top+40};})()`);
  await check('Right docking allocates the fixed pane to the character, not the chat',`(()=>{const avatar=document.querySelector('.avatar-stage').getBoundingClientRect(),chat=document.querySelector('.chat').getBoundingClientRect();return avatar.x>chat.x&&avatar.width<=460&&chat.width>=310;})()`);
  await capture('11a-right-docked');
  await pointerDrag('.character-resizer',`(()=>{const r=document.querySelector('.character-resizer').getBoundingClientRect();return {x:r.x+80,y:r.y+18};})()`);
  await check('Pointer resize makes the right character pane narrower',`document.querySelector('.avatar-stage').getBoundingClientRect().width<280`);
  await pointerDrag('.character-drag-handle',`(()=>{const r=document.querySelector('.main').getBoundingClientRect();return {x:r.left+45,y:r.top+40};})()`);
  await check('Pointer dragging snaps the character to the left',`!document.querySelector('.main').classList.contains('avatar-right')`);
  await evaluate(`document.querySelector('.character-resizer').focus()`);await key('Home');
  await check('Character resize stops at its readable minimum',`Math.round(document.querySelector('.avatar-stage').getBoundingClientRect().width)===168`);
  await capture('11b-resized-left');
  window.setContentSize(760,580);await settle();
  await capture('12-compact-chat');
  await check('Compact window preserves a readable chat and character pane',`(()=>{const avatar=document.querySelector('.avatar-stage').getBoundingClientRect(),chat=document.querySelector('.chat').getBoundingClientRect();return avatar.width>=167.5&&chat.width>=310&&avatar.right<=innerWidth&&chat.right<=innerWidth;})()`);
  await click('[aria-label="收起或展开侧边栏"]');
  await capture('12a-compact-expanded-sidebar');
  await check('Compact sidebar keeps collapse and settings buttons fully visible',`(()=>{const sidebar=document.querySelector('.sidebar').getBoundingClientRect();return ['[aria-label=\"收起或展开侧边栏\"]','[aria-label=\"设置\"]'].every(selector=>{const r=document.querySelector(selector).getBoundingClientRect();return r.left>=sidebar.left&&r.right<=sidebar.right;});})()`);
  await check('Expanded sidebar at the minimum window width keeps both panes usable',`(()=>{const a=document.querySelector('.avatar-stage').getBoundingClientRect(),c=document.querySelector('.chat').getBoundingClientRect();return a.width>=168&&c.width>=310&&c.right<=innerWidth;})()`);
  await pointerDrag('.character-drag-handle',`(()=>{const r=document.querySelector('.main').getBoundingClientRect();return {x:r.right-35,y:r.top+25};})()`);
  await capture('12b-compact-right');
  await check('Compact right docking preserves minimum chat width',`(()=>{const a=document.querySelector('.avatar-stage').getBoundingClientRect(),c=document.querySelector('.chat').getBoundingClientRect();return a.x>c.x&&a.width>=168&&c.width>=310;})()`);
  await click('[aria-label="设置"]');await settle();
  await capture('13-compact-settings');
  await click('[aria-label="关闭设置"]');await settle();
  await click('[aria-label="打开服装面板"]');
  await click('.wardrobe-panel .skin-card:not(:disabled)');
  await waitFor(`document.querySelector('.contact-avatar img')?.getAttribute('src')?.includes('yukino-07.png')&&document.querySelector('.message-avatar img')?.getAttribute('src')?.includes('yukino-07.png')`,'contact and chat avatars using the selected outfit');
  await check('Selected outfit appears in both contact and chat avatars',`[...document.querySelectorAll('.contact-avatar img')].length>=2&&[...document.querySelectorAll('.contact-avatar img')].every(img=>img.complete&&img.naturalWidth>0)`);
  await capture('14-current-outfit-avatars');
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
