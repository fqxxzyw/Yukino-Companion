'use strict';
// Actual companion renderer + its restricted production preload + real IPC manager.
// Uses isolated temporary preferences, never opens an API connection or synthesizes/plays audio.
// Windows: npx electron scripts/capture-pet-ui.cjs --output build/pet-ui-review
// Linux with a display server: xvfb-run -a npx electron scripts/capture-pet-ui.cjs
const electron=require('electron');
const {app}=electron;
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {CompanionManager,DEFAULTS}=require('../electron/companions.cjs');
const outIndex=process.argv.indexOf('--output'),output=path.resolve(outIndex<0?'build/pet-ui-review':process.argv[outIndex+1]);
const headless=app.commandLine.getSwitchValue('ozone-platform')==='headless';
const report={platform:process.platform,headless,nativeWindowMovementVerified:false,purpose:'Real companion renderer, production preload and manager; temporary preferences, no API or sound playback',checks:[],screenshots:[],errors:[]};
let manager,win,temp,opened=0;
app.on('window-all-closed',()=>{});
app.disableHardwareAcceleration();app.commandLine.appendSwitch('force-device-scale-factor','1');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const evaluate=source=>win.webContents.executeJavaScript(source,true);
async function waitFor(source){for(let n=0;n<100;n++){if(await evaluate(source))return;await pause(40);}throw Error('Timed out: '+source);}
async function check(name,source){const passed=!!await evaluate(source);report.checks.push({name,passed});if(!passed)throw Error(name);}
async function capture(name){await pause(100);const image=await win.webContents.capturePage();if(image.isEmpty())throw Error('Empty screenshot: '+name);const png=image.toPNG();await fs.writeFile(path.join(output,name+'.png'),png);report.screenshots.push({name,bytes:png.length,bounds:win.getBounds()});}
async function run(){
 temp=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-pet-qa-'));app.setPath('userData',temp);await fs.mkdir(output,{recursive:true});
 await fs.writeFile(path.join(temp,'companions.json'),JSON.stringify({...DEFAULTS,mode:'none',soundEnabled:false,randomQuotes:false,nightReminders:false}));
 await app.whenReady();
 manager=new CompanionManager({electron:{...electron,Tray:undefined,Notification:undefined},dataDir:temp,onOpenMain:()=>opened++,onError:error=>report.errors.push(error.message),onQuit:()=>{throw Error('QA must not quit via pet action')}});await manager.initialize();await manager.setMode('pet');
 win=manager.windows.get('pet');win.webContents.on('console-message',details=>{if(details.level==='error')report.errors.push(details.message)});win.webContents.on('preload-error',(_event,_file,error)=>report.errors.push(error.message));
 if(win.webContents.isLoading())await new Promise(resolve=>win.webContents.once('did-finish-load',resolve));win.show();win.focus();
 await waitFor("document.querySelector('#pet').getBoundingClientRect().width>0&&typeof window.companion?.call==='function'");await pause(350);
 await check('Sprite asset decoded and painted',"(()=>{const c=document.querySelector('#pet'),pixels=c.getContext('2d').getImageData(0,0,192,208).data;return pixels.some((value,index)=>index%4===3&&value>0)})()");
 await check('Removed detached floating arrow',"!document.querySelector('#open')&&!document.body.innerText.includes('↗')");await capture('01-pet');
 await evaluate("document.querySelector('#pet').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))");await waitFor("!document.querySelector('#pet-menu').hidden");
 await check('All original settings are available in the custom menu',"document.querySelectorAll('#pet-menu input[role=switch]').length===10&&['暂停互动','随机语录','互动语录','深夜提醒','播放预录语音','开机启动','总在最前'].every(label=>document.querySelector('#menu-body').innerText.includes(label))");
 await check('Original prerecorded voice catalog is complete',"window.companion.call('catalog').then(data=>data.voices.length===2391)");
 await capture('02-pet-menu');
 await evaluate("(()=>{const input=document.querySelector('input[aria-label=透明度]');input.value=.6;input.dispatchEvent(new Event('change',{bubbles:true}));})()");
 await waitFor("getComputedStyle(document.querySelector('#pet')).opacity==='0.6'");
 await check('Changing pet opacity keeps menu legible',"getComputedStyle(document.querySelector('#pet-menu')).opacity==='1'");
 await evaluate("document.querySelector('#menu-close').click()");
 await evaluate("document.querySelector('#pet').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))");await pause(100);if(opened!==1)throw Error('Double click did not open chat');report.checks.push({name:'Double click opens chat through authenticated IPC',passed:true});
 await manager.performAction('focus-25');await waitFor("!document.querySelector('#focus-badge').hidden");await capture('03-pet-focus');await manager.performAction('focus-cancel');
 const audio=await evaluate("(async()=>{const {voices}=await window.companion.call('catalog');return await new Promise(resolve=>{const audio=new Audio('assets/voices/'+voices[0]);audio.preload='metadata';audio.onloadedmetadata=()=>resolve({duration:audio.duration,format:audio.canPlayType('audio/ogg; codecs=vorbis')});audio.onerror=()=>resolve({error:true});audio.load();setTimeout(()=>resolve({timeout:true}),5000)})})()");
 if(!(audio.duration>0)||!audio.format)throw Error('Bundled OGG did not decode: '+JSON.stringify(audio));report.checks.push({name:'Bundled OGG audio metadata decodes without playing',passed:true,...audio});
 await manager.setPreferences({scale:.6});await evaluate("document.querySelector('#pet').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))");await waitFor("!document.querySelector('#pet-menu').hidden");
 await check('Minimum scale menu remains scrollable with no horizontal overflow',"document.querySelector('#menu-body').scrollHeight>document.querySelector('#menu-body').clientHeight&&document.querySelector('#menu-body').scrollWidth<=document.querySelector('#menu-body').clientWidth+1");await capture('04-small-pet-menu');
 await manager.setPreferences({scale:1});await evaluate("document.querySelector('#menu-close').click()");
 if(headless){report.checks.push({name:'Native desktop window movement',skipped:true,reason:'Ozone headless has no desktop window manager; run this check on Windows or X11.'});}
 else{const initial=win.getBounds();await evaluate("window.companion.call('walk-step',{x:-1,y:-1})");const moved=win.getBounds();if(moved.x===initial.x&&moved.y===initial.y)throw Error('Walk did not move companion window');report.nativeWindowMovementVerified=true;report.checks.push({name:'Walking moves the single pet window; no separate arrow remains',passed:true});await capture('05-pet-moved');}
 if(report.errors.length)throw Error('Renderer errors: '+report.errors.join('; '));
}
(async()=>{let failed=false;try{await run()}catch(error){failed=true;report.errors.push(error.stack||error.message);console.error(error)}finally{if(manager)await manager.dispose();await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));if(temp)await fs.rm(temp,{recursive:true,force:true});app.exit(failed?1:0)}})();
