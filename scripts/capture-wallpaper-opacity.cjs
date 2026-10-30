// Synthetic production renderer check. Captures wallpaper pixels with only QA
// controls hidden; does not access user profiles, network services or devices.
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs/promises'),syncFs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=path.resolve(__dirname,'..'),output=path.join(root,'build/wallpaper-opacity-review');
const temp=syncFs.mkdtempSync(path.join(os.tmpdir(),'yukino-wallpaper-opacity-'));app.setPath('userData',path.join(temp,'profile'));
const report={purpose:'Synthetic wallpaper opacity renderer check; supplemental to Windows',checks:[]};let window;app.on('window-all-closed',()=>{});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),evaluate=source=>window.webContents.executeJavaScript(source,true);
async function waitFor(source,attempts=100){for(let i=0;i<attempts;i++){if(await evaluate(`(async()=>Boolean(await (${source})))()`))return;await pause(100)}throw Error('UI state not reached: '+source)}
async function check(name,source){const passed=Boolean(await evaluate(source));report.checks.push({name,passed});if(!passed)throw Error(name);console.log('PASS '+name)}
async function sceneSnapshot(){return evaluate("(()=>{const host=document.querySelector('.scene-ui-backdrop');return {systemReduced:matchMedia('(prefers-reduced-motion: reduce)').matches,appReduced:document.querySelector('.app')?.classList.contains('reduce'),imageCount:host?.querySelectorAll('.wallpaper-image-layer').length,planes:[...host.querySelectorAll(':scope>div')].map(plane=>({background:getComputedStyle(plane).backgroundColor,opacity:getComputedStyle(plane).opacity})),images:[...host.querySelectorAll('.wallpaper-image-layer')].map(image=>({opacity:getComputedStyle(image).opacity,source:image.style.backgroundImage})),animations:host.getAnimations({subtree:true}).map(animation=>({playState:animation.playState,currentTime:animation.currentTime,keyframes:animation.effect.getKeyframes()}))}})()")}
async function setOpacity(percent){await evaluate(`(()=>{const input=document.querySelector('[aria-label="壁纸不透明度"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${percent});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);await pause(150)}
async function pixel(){await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await window.webContents.capturePage();await pause(100);const image=await window.webContents.capturePage();const {width}=image.getSize(),data=image.toBitmap(),offset=(350*width+180)*4;return [data[offset+2],data[offset+1],data[offset]];}
app.whenReady().then(async()=>{
 const preload=path.join(temp,'preload.cjs'),source=await fs.readFile(path.join(__dirname,'ui-capture/preload.cjs'),'utf8');await fs.writeFile(preload,source.replace('let state={',"let state={voiceChatWizard:{version:1,status:'skipped',step:0,evidence:{}},"));
 session.defaultSession.webRequest.onBeforeRequest((request,callback)=>callback({cancel:!/^(file:|blob:|data:)/.test(request.url)}));
 window=new BrowserWindow({show:true,width:1280,height:840,webPreferences:{preload,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 // Isolated QA controls OS motion preferences explicitly; production continues
 // to respect the user's Windows accessibility setting.
 await window.loadURL('about:blank');report.systemReducedMotion=await evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches");
 window.webContents.debugger.attach('1.3');await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 await window.loadFile(path.join(root,'dist/index.html'));await waitFor("document.querySelector('.setup-dialog')");await evaluate("document.querySelector('.setup-dialog footer .text-link').click()");await pause(800);
 await evaluate("document.querySelector('[aria-label=\"设置\"]').click()");await pause(250);await evaluate("[...document.querySelectorAll('.settings-nav>button')].find(button=>button.textContent==='外观').click()");await waitFor("document.querySelector('[aria-label=\"壁纸不透明度\"]')");
 await evaluate("document.querySelector('.settings').getAnimations().forEach(animation=>animation.finish());document.querySelector('.scene-ui-backdrop').getAnimations({subtree:true}).forEach(animation=>animation.finish())");
 await check('Legacy settings retain full wallpaper opacity',"document.querySelector('[aria-label=\"壁纸不透明度\"]').value==='100'");
 await setOpacity(35);await waitFor("window.desktop.load().then(({state})=>state.presentation?.wallpaper?.opacity===.35)");
 await check('Opacity changes in real time, saves and leaves text controls fully opaque',"(()=>{const image=document.querySelector('.wallpaper-image-layer');return getComputedStyle(image).opacity==='0.35'&&['.app','.chat','.settings','.settings-main'].every(selector=>getComputedStyle(document.querySelector(selector)).opacity==='1')})()");
 // Every transition plane paints the theme color before its translucent image.
 const hide=await window.webContents.insertCSS('.app>*:not(.scene-ui-backdrop){visibility:hidden!important}');
 await setOpacity(100);const full=await pixel();await setOpacity(0);const base=await pixel();await setOpacity(50);const half=await pixel();
 const expected=full.map((value,index)=>Math.round((value+base[index])/2));
 const baseColor=await evaluate("getComputedStyle(document.querySelector('.app')).backgroundColor.match(/\\d+/g).slice(0,3).map(Number)");
 report.pixels={full,base,half,expected,baseColor};
 const matches=base.every((value,index)=>Math.abs(value-baseColor[index])<=1)&&half.every((value,index)=>Math.abs(value-expected[index])<=2)&&full.some((value,index)=>Math.abs(value-base[index])>10);
 report.checks.push({name:'Rendered 0% matches theme base and 50% blends only the wallpaper',passed:matches});if(!matches)throw Error('Wallpaper pixel blending differs from configured image opacity');console.log('PASS rendered wallpaper pixel blending');
 await window.webContents.removeInsertedCSS(hide);
 await evaluate("(()=>{const input=[...document.querySelectorAll('label.row')].find(label=>label.textContent.includes('减少动态效果')).querySelector('input');if(input.checked)input.click()})()");
 await waitFor("window.desktop.load().then(({state})=>state.reduce===false)");
 await evaluate("document.querySelector('.wallpaper-item button[title=\"晴空 · 02\"]').click()");
 await waitFor("document.querySelectorAll('.wallpaper-image-layer').length===1&&document.querySelector('.wallpaper-image-layer').style.backgroundImage.includes('yukino-sky-02.png')");
 report.reducedMotion=await sceneSnapshot();
 await check('System reduced motion skips the reveal while preserving the chosen wallpaper opacity',"matchMedia('(prefers-reduced-motion: reduce)').matches&&document.querySelector('.app').classList.contains('reduce')&&document.querySelectorAll('.wallpaper-image-layer').length===1&&getComputedStyle(document.querySelector('.wallpaper-image-layer')).opacity==='0.5'&&document.querySelector('.scene-ui-backdrop').getAnimations({subtree:true}).length===0");
 await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
 await waitFor("!matchMedia('(prefers-reduced-motion: reduce)').matches&&!document.querySelector('.app').classList.contains('reduce')");
 // Observe the real production animation and pause it at its midpoint before
 // inspecting both planes. This avoids a platform-dependent 100ms timing guess.
 report.transitionObserved=await evaluate(`new Promise((resolve,reject)=>{
   const host=document.querySelector('.scene-ui-backdrop');let done=false,timer,observer;
   const cleanup=()=>{clearTimeout(timer);observer?.disconnect()};
   const inspect=()=>{if(done)return;const images=host.querySelectorAll('.wallpaper-image-layer'),animation=host.getAnimations({subtree:true}).find(item=>item.effect?.getKeyframes().some(frame=>typeof frame.clipPath==='string'));if(images.length!==2||!animation)return;done=true;animation.pause();animation.currentTime=350;cleanup();resolve({imageCount:images.length,playState:animation.playState,currentTime:animation.currentTime,duration:animation.effect.getTiming().duration});};
   observer=new MutationObserver(inspect);observer.observe(host,{childList:true,subtree:true,attributes:true});
   timer=setTimeout(()=>{done=true;cleanup();reject(Error('No real two-plane wallpaper reveal observed'))},8000);
   document.querySelector('.wallpaper-item button[title="晴空 · 01"]').click();inspect();
 })`);
 report.normalMotion=await sceneSnapshot();
 await check('Both slideshow reveal planes keep the same image opacity over an opaque theme base',"(()=>{const planes=[...document.querySelectorAll('.scene-ui-backdrop>div')],images=[...document.querySelectorAll('.wallpaper-image-layer')],theme=getComputedStyle(document.querySelector('.app')).backgroundColor;return images.length===2&&images.every(image=>getComputedStyle(image).opacity==='0.5')&&planes.every(plane=>getComputedStyle(plane).backgroundColor===theme&&getComputedStyle(plane).opacity==='1')})()");
 await evaluate("document.querySelector('.scene-ui-backdrop').getAnimations({subtree:true}).forEach(animation=>animation.finish())");await waitFor("document.querySelectorAll('.wallpaper-image-layer').length===1");await evaluate("document.querySelector('[aria-label=\"壁纸切换间隔\"]').click()");await waitFor("document.querySelector('[role=listbox]')");await evaluate("[...document.querySelectorAll('[role=option]')].find(option=>option.textContent==='10 秒').click()");
 const before=await evaluate("document.querySelector('.wallpaper-image-layer').style.backgroundImage");await waitFor(`document.querySelector('.wallpaper-image-layer')?.style.backgroundImage!==${JSON.stringify(before)}`,140);await pause(800);
 await check('Automatic slideshow retains the saved wallpaper opacity',"getComputedStyle(document.querySelector('.wallpaper-image-layer')).opacity==='0.5'&&window.desktop.load().then(({state})=>state.presentation.wallpaper.opacity===.5)");
 await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'wallpaper-opacity.png'),(await window.webContents.capturePage()).toPNG());
}).catch(async error=>{report.error=error.message;report.failureState=await sceneSnapshot().catch(()=>null);console.error(error);process.exitCode=1}).finally(async()=>{await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));const code=process.exitCode||0;window?.destroy();await fs.rm(temp,{recursive:true,force:true,maxRetries:3,retryDelay:50}).catch(()=>{});app.exit(code)});
