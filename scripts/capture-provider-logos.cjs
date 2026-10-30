// Production UI with synthetic local credentials. No vendor requests, recording
// or real credential validation. Linux headless checks supplement Windows QA.
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs/promises'),syncFs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=path.resolve(__dirname,'..'),output=path.join(root,'build/provider-logo-display-review');
const temp=syncFs.mkdtempSync(path.join(os.tmpdir(),'yukino-api-ui-'));app.setPath('userData',path.join(temp,'profile'));
const report={purpose:'Offline production API-card logo rendering using GitHub Windows-verified official assets; synthetic API configuration only',platform:process.platform,offline:true,realServiceVerified:false,cjkTypographyVerified:false,visualLimitation:process.platform==='linux'?'This Linux host lacks CJK fonts. Logo image rendering is checked; Windows Chinese typography is not verified.':'Chinese typography requires separate visual review.',blockedNetworkRequests:[],checks:[]};
let window;app.on('window-all-closed',()=>{});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const evaluate=source=>window.webContents.executeJavaScript(source,true);
async function waitFor(source){for(let i=0;i<80;i++){if(await evaluate(`Boolean(${source})`))return;await pause(100)}throw Error('UI state not reached: '+source)}
async function check(name,source){const passed=Boolean(await evaluate(source));report.checks.push({name,passed});if(!passed)throw Error(name);console.log('PASS '+name)}
async function clickText(selector,text){await evaluate(`(()=>{const element=[...document.querySelectorAll(${JSON.stringify(selector)})].find(element=>element.textContent.includes(${JSON.stringify(text)}));if(!element)throw Error('Control missing');element.click();})()`);await pause(150)}
app.whenReady().then(async()=>{
 const catalog=require('../electron/api-management.cjs').apiServiceCatalog();
 const methods=`apiServiceCatalog:async()=>(${JSON.stringify(catalog)}),apiValidationStatus:async()=>({}),apiCredentialSave:async()=>({saved:true}),apiConfigValidate:async()=>({message:'界面测试未执行真实协议验证',validation:{}}),apiOpenOfficial:async()=>true,`;
 const preload=path.join(temp,'preload.cjs'),source=await fs.readFile(path.join(__dirname,'ui-capture/preload.cjs'),'utf8');
 await fs.writeFile(preload,source.replace('let state={',"let state={voiceChatWizard:{version:1,status:'skipped',step:0,evidence:{}},").replace("contextBridge.exposeInMainWorld('desktop',{","contextBridge.exposeInMainWorld('desktop',{"+methods));
 session.defaultSession.webRequest.onBeforeRequest((request,callback)=>{const cancel=!/^(file:|blob:|data:)/.test(request.url);if(cancel)report.blockedNetworkRequests.push(new URL(request.url).origin);callback({cancel})});
 window=new BrowserWindow({show:false,width:1280,height:840,webPreferences:{preload,sandbox:true,contextIsolation:true,nodeIntegration:false}});
 await window.loadFile(path.join(root,'dist/index.html'));await waitFor("document.querySelector('.setup-dialog')");
 await evaluate("document.querySelector('.setup-dialog footer .text-link').click()");await pause(300);
 await evaluate("document.querySelector('[aria-label=\"设置\"]').click()");await waitFor("document.querySelector('.settings-nav')");
 await check('Settings show ten task groups',"document.querySelectorAll('.settings-nav>button').length===10");
 await clickText('.settings-nav>button','API 管理');await waitFor("document.querySelectorAll('.provider-card').length===6");
 await waitFor("document.querySelectorAll('.provider-card .provider-logo img').length===6&&[...document.querySelectorAll('.provider-card .provider-logo img')].every(image=>image.complete&&image.naturalWidth>=16&&image.naturalHeight>=16)");
 await check('All six primary provider cards show decoded official local images without fallback',"document.querySelectorAll('.provider-card .provider-logo img').length===6&&document.querySelectorAll('.provider-card .provider-logo>span').length===0&&[...document.querySelectorAll('.provider-card .provider-logo img')].every(image=>image.complete&&image.naturalWidth>=16&&image.naturalHeight>=16&&image.currentSrc.startsWith('file:')&&image.currentSrc.includes('/dist/provider-logos/'))");
 await check('Official logo images retain visible CSS dimensions and opacity',"[...document.querySelectorAll('.provider-card .provider-logo img')].every(image=>{const rect=image.getBoundingClientRect(),style=getComputedStyle(image);return rect.width>=16&&rect.height>=16&&rect.width<=27&&rect.height<=27&&style.opacity==='1'&&style.visibility==='visible'&&style.display!=='none'})");
 report.images=await evaluate("[...document.querySelectorAll('.provider-card')].map(card=>{const image=card.querySelector('.provider-logo img'),rect=image.getBoundingClientRect();return {name:card.querySelector('strong').textContent,source:image.currentSrc.split('/dist/')[1],naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,displayWidth:rect.width,displayHeight:rect.height}})");
 await fs.mkdir(output,{recursive:true});
 await evaluate("document.querySelector('.provider-card').scrollIntoView({block:'start'})");await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await window.webContents.capturePage();await pause(150);await fs.writeFile(path.join(output,'official-logos-top.png'),(await window.webContents.capturePage()).toPNG());
 await evaluate("document.querySelector('.provider-card:last-child').scrollIntoView({block:'end'})");await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await window.webContents.capturePage();await pause(150);await fs.writeFile(path.join(output,'official-logos-bottom.png'),(await window.webContents.capturePage()).toPNG());
 await evaluate("document.querySelector('.provider-card').scrollIntoView({block:'start'})");
 await check('Provider adapter status does not claim live verification',"[...document.querySelectorAll('.provider-card')].every(card=>/待验证|待接入/.test(card.textContent))");
 await check('OpenAI text and realtime ASR adaptation are stated independently',"(()=>{const card=[...document.querySelectorAll('.provider-card')].find(card=>card.querySelector('strong').textContent==='OpenAI');return card.textContent.includes('文字协议已接入')&&card.textContent.includes('实时 ASR 待接入')})()");
 await clickText('.provider-card:nth-child(2) button','配置服务');await clickText('.api-editor-title button','新增配置');
 await waitFor("document.querySelector('.api-dynamic-fields input[type=password]')");
 await check('Aliyun uses its own secret field and starts unverified',"document.querySelectorAll('.api-dynamic-fields input[type=password]').length===1&&[...document.querySelectorAll('.api-validation-grid strong')].every(element=>element.textContent==='未验证')");
 await check('Adding ASR retains the default chat configuration',"window.desktop.load().then(({state})=>state.activeProfile==='visual-qa')");
 await evaluate("(()=>{const input=document.querySelector('.api-dynamic-fields input[type=password]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'synthetic-ui-credential');input.dispatchEvent(new Event('input',{bubbles:true}));})()");
 await clickText('.api-service-editor .button-row button','保存配置');await pause(400);
 await check('Secret values stay out of ordinary persisted application state',"window.desktop.load().then(({state})=>!JSON.stringify(state).includes('synthetic-ui-credential')&&state.activeProfile==='visual-qa'&&state.apiManagement.configs.some(config=>config.providerId==='aliyun-asr'))");
 await check('Saving does not imply a successful transcript test',"[...document.querySelectorAll('.api-validation-grid strong')].every(element=>element.textContent==='未验证')");
 await clickText('.provider-card:nth-child(4) button','配置服务');await clickText('.api-editor-title button','新增配置');
 await check('Tencent shows distinct SecretID and SecretKey fields',"[...document.querySelectorAll('.api-dynamic-fields label')].some(element=>element.textContent.includes('SecretID'))&&[...document.querySelectorAll('.api-dynamic-fields label')].some(element=>element.textContent.includes('SecretKey'))&&document.querySelector('.api-adaptation-status').textContent.includes('待接入')");
 await evaluate("document.querySelector('[aria-label=\"按需求查看服务\"]').click()");await waitFor("document.querySelector('[role=listbox]')");await clickText('[role=option]','中文实时输入');
 await check('Chinese preference promotes the implemented ASR adapter without changing chat selection',"document.querySelector('.provider-card strong').textContent.includes('阿里云')&&window.desktop.load().then(({state})=>state.activeProfile==='visual-qa')");
 await evaluate("document.querySelector('[aria-label=\"按需求查看服务\"]').click()");await waitFor("document.querySelector('[role=listbox]')");await clickText('[role=option]','希望使用 OpenAI');
 await check('OpenAI preference changes only card order',"document.querySelector('.provider-card strong').textContent==='OpenAI'&&window.desktop.load().then(({state})=>state.activeProfile==='visual-qa')");
 await check('Language information points to official model scope and actual audio testing',"document.querySelector('.api-language-note').textContent.includes('官方文档')&&document.querySelector('.api-language-note').textContent.includes('实际音频验证')");
 report.networkGuardProbe=await evaluate("(async()=>{const violations=[];const listener=event=>violations.push({uri:event.blockedURI,directive:event.violatedDirective});document.addEventListener('securitypolicyviolation',listener);const rejected=await fetch('https://offline-guard.invalid/yukino-logo-check').then(()=>false,()=>true);await new Promise(resolve=>setTimeout(resolve,20));document.removeEventListener('securitypolicyviolation',listener);return {rejected,violations}})()");
 const guardPassed=report.networkGuardProbe.rejected&&(report.networkGuardProbe.violations.some(item=>item.uri.startsWith('https://offline-guard.invalid'))||report.blockedNetworkRequests.includes('https://offline-guard.invalid'))&&report.blockedNetworkRequests.every(origin=>origin==='https://offline-guard.invalid');report.checks.push({name:'Production CSP or offline interceptor blocks the non-API canary before outbound traffic',passed:guardPassed});if(!guardPassed)throw Error('Offline guard check failed');
 await check('API controls fit the settings scroll area',"document.documentElement.scrollWidth<=innerWidth&&document.querySelector('.settings-body').scrollWidth<=document.querySelector('.settings-body').clientWidth+1");
 await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'api-management.png'),(await window.webContents.capturePage()).toPNG());
}).catch(error=>{report.error=error.message;console.error(error);process.exitCode=1;}).finally(async()=>{
 const code=process.exitCode||0;window?.destroy();await fs.rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:100}).catch(error=>{report.cleanupWarning=error.code||error.message});await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));app.exit(code);
});
