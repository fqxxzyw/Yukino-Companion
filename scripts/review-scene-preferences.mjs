// Original app/preload, isolated data, no location or model-provider requests.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {_electron} from 'playwright-core';
const root=fileURLToPath(new URL('../',import.meta.url)),output=path.join(root,'build/scene-preferences-review');
await fs.mkdir(output,{recursive:true});const profile=await fs.mkdtemp(path.join(output,'profile-'));
const entry=path.join(profile,'entry.cjs');
await fs.writeFile(entry,`const {app}=require('electron');app.setPath('appData',${JSON.stringify(profile)});require(${JSON.stringify(path.join(root,'electron/main.cjs'))});`);
const server=await createServer({root,server:{host:'127.0.0.1',port:0,watch:{ignored:['**/build/**']}}});
let app;const report={passed:false,errors:[],checks:[]};
try{
 await server.listen();const env={...process.env,YUKINO_DEV_SERVER_URL:`http://127.0.0.1:${server.httpServer.address().port}/`};delete env.ELECTRON_RUN_AS_NODE;
 app=await _electron.launch({args:[entry],cwd:root,env,timeout:90000});const page=await app.firstWindow();page.on('pageerror',error=>report.errors.push(error.message));
 await page.getByRole('textbox',{name:'消息',exact:true}).waitFor({timeout:60000});
 const setup=page.locator('.setup-dialog');await setup.waitFor({state:'visible',timeout:60000});await setup.locator('footer .text-link').click();await setup.waitFor({state:'hidden'});
 const voice=await page.evaluate(()=>window.desktop.voiceStatus());if(!voice.configured){const wizard=page.locator('.voice-chat-wizard');await wizard.waitFor({state:'visible',timeout:60000});await wizard.getByRole('button',{name:'稍后再说',exact:true}).click();await wizard.waitFor({state:'hidden'});}
 const open=async()=>{await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('navigation',{name:'设置页面',exact:true}).getByRole('button',{name:'外观',exact:true}).click();};
 await open();const follow=page.getByRole('switch',{name:'场景随时间变化',exact:true});assert.equal(await follow.isChecked(),true);
 await follow.uncheck();const time=page.getByLabel('固定场景时间',{exact:true});await time.fill('21:30');
 const choose=async label=>{await page.getByRole('combobox',{name:'界面主题',exact:true}).click();await page.getByRole('option',{name:label,exact:true}).click();};
 await choose('深色');await page.waitForFunction(()=>getComputedStyle(document.querySelector('.app')).getPropertyValue('--scheme').trim()==='dark');
 await page.screenshot({path:path.join(output,'dark.png')});
 await page.waitForFunction(async()=>{const {state}=await window.desktop.load();return state?.themeMode==='dark'&&state.presentation?.followTime===false&&state.presentation?.fixedHour===21.5});
 let saved=await page.evaluate(async()=>(await window.desktop.load()).state);assert.equal(saved.presentation.fixedHour,21.5);assert.equal(saved.presentation.followTime,false);assert.equal(saved.themeMode,'dark');
 report.checks.push('Original controls persist fixed 21:30 and dark theme through native save');
 await page.reload();await page.getByRole('textbox',{name:'消息',exact:true}).waitFor({timeout:60000});await open();
 assert.equal(await page.getByRole('switch',{name:'场景随时间变化',exact:true}).isChecked(),false);assert.equal(await page.getByLabel('固定场景时间',{exact:true}).inputValue(),'21:30');
 assert.equal(await page.getByRole('combobox',{name:'界面主题',exact:true}).innerText(),'深色');report.checks.push('Reload preserves both preferences');
 await choose('浅色');await page.waitForFunction(()=>getComputedStyle(document.querySelector('.app')).getPropertyValue('--scheme').trim()==='light');await page.screenshot({path:path.join(output,'light.png')});
 await choose('跟随系统');await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>getComputedStyle(document.querySelector('.app')).getPropertyValue('--scheme').trim()==='dark');
 await page.emulateMedia({colorScheme:'light'});await page.waitForFunction(()=>getComputedStyle(document.querySelector('.app')).getPropertyValue('--scheme').trim()==='light');
 await page.getByRole('switch',{name:'场景随时间变化',exact:true}).check();await page.waitForFunction(async()=>(await window.desktop.load()).state.presentation.followTime===true);
 assert.equal(await page.getByLabel('固定场景时间',{exact:true}).count(),0);assert.deepEqual(report.errors,[]);
 report.checks.push('Light/dark/system update wallpaper chrome; fixed scene time does not affect them; live time can resume');report.passed=true;
}finally{await app?.close();await server.close();await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify(report));
