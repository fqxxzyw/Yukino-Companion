// Real Electron main/preload/settings. No downloads, model loads or audio fixtures.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {_electron} from 'playwright-core';
const root=fileURLToPath(new URL('../',import.meta.url)),output=await fs.mkdtemp(path.join(root,'build/aqua-settings-')),appData=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-settings-qa-'));
const report={purpose:'Real settings UI/IPC/persistence only; no Aqua/GPT model inference, install or speaker measurements',output,appData,checks:[],screenshots:[],errors:[],blockedRequests:[]};let server,desktop,page;
const check=name=>{report.checks.push(name);console.log('PASS '+name);};
async function screenshot(name){const file=path.join(output,name+'.png');await page.screenshot({path:file});report.screenshots.push(file);}
async function open(){const env={...process.env,YUKINO_SETTINGS_QA_DATA:appData,YUKINO_DEV_SERVER_URL:report.url};delete env.ELECTRON_RUN_AS_NODE;delete env.YUKINO_PYTHON;
 desktop=await _electron.launch({args:[path.join(root,'scripts/qa-speech-settings.cjs')],cwd:root,env,timeout:45000});page=await desktop.firstWindow();page.on('pageerror',e=>report.errors.push(e.message));await page.locator('.app').waitFor();
 for(let n=0;n<4;n++){await page.waitForTimeout(350);const skip=page.locator('.setup-dialog footer .text-link');if(await skip.count())await skip.click();const later=page.getByRole('button',{name:'稍后再说',exact:true});if(await later.count())await later.click();}
 await page.waitForFunction(()=>!document.querySelector('.voice-chat-wizard'));}
async function close(){if(!desktop)return;report.blockedRequests.push(...await desktop.evaluate(()=>globalThis.settingsQaBlockedRequests));await desktop.close();desktop=null;}
async function nav(name){await page.locator('.settings-nav').getByRole('button',{name,exact:true}).click();}
try{
 server=await createServer({root,server:{host:'127.0.0.1',port:0}});await server.listen();report.url=`http://127.0.0.1:${server.httpServer.address().port}/`;await open();
 assert.equal(await desktop.evaluate(({app})=>app.getPath('userData')),path.join(appData,'yukino-companion-development'));check('Isolated real Electron profile');
 await page.getByRole('button',{name:'设置',exact:true}).click();await nav('语音输出');
 await page.getByRole('heading',{name:'推理引擎',exact:true}).waitFor();const engine=page.getByRole('combobox',{name:'语音引擎',exact:true});assert.match(await engine.innerText(),/智能模式/);await page.getByText(/实际引擎：尚未加载/).waitFor();check('Default smart engine never claims Aqua is running before loading');await screenshot('engine-smart');
 await engine.click();await page.getByRole('option',{name:'Aqua-TTS 高性能推理',exact:true}).click();await page.waitForFunction(async()=> (await window.desktop.voiceSettings()).engine==='aqua');await screenshot('engine-aqua-selected-not-running');assert.ok(await page.getByText(/实际引擎：尚未加载/).count());check('Actual engine selection persists via existing voice IPC without starting inference');
 await nav('高级与诊断');
 // Advanced landing links to the actual dedicated voice environment page.
 await page.getByRole('button',{name:/语音环境与诊断/}).click();
 await page.getByRole('heading',{name:'Aqua 环境与依赖',exact:true}).waitFor();
 for(const name of ['流式分句','并发调度与播放优化','性能诊断'])await page.getByRole('heading',{name,exact:true}).waitFor();
 const envStatus=await page.evaluate(()=>window.desktop.aquaEnvironmentStatus());assert.equal(envStatus.ready,false);assert.equal(envStatus.modelInferenceVerified,false);check('Environment IPC reports missing optional environment without a fake ready flag');
 const scheduling=page.getByRole('heading',{name:'并发调度与播放优化',exact:true});await scheduling.scrollIntoViewIfNeeded();assert.equal(await page.getByRole('spinbutton',{name:'提交并发上限（非 GPU 实际并发）',exact:true}).inputValue(),'2');await screenshot('bounded-scheduling');
 const layout=await page.locator('.settings-page-content,.settings-page-content-inner,.settings-page').evaluateAll(elements=>elements.map(el=>({width:el.clientWidth,scroll:el.scrollWidth})));assert.ok(layout.every(v=>v.scroll<=v.width+2));check('Advanced segmentation, bounded scheduling and diagnostic limits are readable without horizontal overflow');
 const advancedEngine=page.getByRole('combobox',{name:'语音引擎',exact:true});await advancedEngine.scrollIntoViewIfNeeded();await advancedEngine.click();await page.getByRole('option',{name:'GPT-SoVITS 标准推理',exact:true}).click();await page.waitForFunction(async()=> (await window.desktop.voiceSettings()).engine==='standard');
 const status=await page.evaluate(()=>window.desktop.voiceStatus());assert.equal(status.enginePlan.requestedEngine,'standard');assert.equal(status.enginePlan.verified,false);await screenshot('standard-preserved');
 report.applicationErrors=await page.locator('.main .error').allTextContents();assert.deepEqual(report.applicationErrors,[]);
 await close();await open();assert.equal(await page.evaluate(async()=> (await window.desktop.voiceSettings()).engine),'standard');check('Real app restart preserves selected standard backend');
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.blockedRequests,[]);report.success=true;
}catch(error){report.success=false;report.failure=error.stack;process.exitCode=1;console.error(error);if(page&&!page.isClosed())await screenshot('failure').catch(()=>{});}
finally{await close().catch(error=>{report.cleanupError=error.message;process.exitCode=1;});await server?.close();await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log('Report: '+path.join(output,'report.json'));}
