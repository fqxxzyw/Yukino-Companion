// Real Electron settings acceptance. No API calls, microphone, downloads or model loading.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {_electron} from 'playwright-core';
const root=fileURLToPath(new URL('../',import.meta.url));
const output=await fs.mkdtemp(path.join(root,'build/settings-acceptance-'));
const appData=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-settings-qa-'));
const report={purpose:'Real Electron main/preload settings acceptance; no real ASR, TTS, inference or download validation',output,appData,checks:[],screenshots:[],rendererErrors:[],blockedRequests:[]};
let server,desktop,page;
const check=(name,details)=>{report.checks.push({name,details,passed:true});console.log('PASS '+name);};
async function screenshot(name,focus){if(focus){await focus.evaluate(element=>element.scrollIntoView({block:'start'}));await page.waitForTimeout(150);}const file=path.join(output,name+'.png');await page.screenshot({path:file});report.screenshots.push(file);}
async function open(){
 const env={...process.env,YUKINO_SETTINGS_QA_DATA:appData,YUKINO_DEV_SERVER_URL:report.url};delete env.ELECTRON_RUN_AS_NODE;delete env.YUKINO_PYTHON;
 desktop=await _electron.launch({args:[path.join(root,'scripts/qa-speech-settings.cjs')],cwd:root,env,timeout:40000});
 page=await desktop.firstWindow();page.on('pageerror',error=>report.rendererErrors.push(error.message));
 await page.waitForFunction(()=>typeof window.desktop?.speechCacheStatus==='function');
 await page.locator('.app').waitFor();
 for(let attempt=0;attempt<4;attempt++){
  await page.waitForTimeout(400);
  const setup=page.locator('.setup-dialog footer .text-link');if(await setup.count())await setup.first().click();
  const skip=page.getByRole('button',{name:'稍后再说',exact:true});if(await skip.count())await skip.first().click();
 }
}
async function nav(name){await page.locator('.settings-nav').getByRole('button',{name,exact:true}).click();}
async function shutdown(){if(!desktop)return;report.blockedRequests.push(...await desktop.evaluate(()=>globalThis.settingsQaBlockedRequests));await desktop.close();desktop=null;}
try{
 server=await createServer({root,server:{host:'127.0.0.1',port:0,strictPort:false}});await server.listen();
 report.url=`http://127.0.0.1:${server.httpServer.address().port}/`;
 await open();
 const paths=await desktop.evaluate(({app})=>({userData:app.getPath('userData'),sessionData:app.getPath('sessionData')}));
 assert.equal(paths.userData,path.join(appData,'yukino-companion-development'));assert.ok(paths.sessionData.startsWith(paths.userData+path.sep));check('Actual Electron uses a new isolated development profile',paths);
 await page.getByRole('button',{name:'设置',exact:true}).click();await nav('语音输出');
 const cache=page.locator('.speech-cache-settings');await cache.getByText(/已确认配置：关闭/).waitFor();
 const initial=await page.evaluate(()=>window.desktop.speechCacheStatus());assert.equal(initial.enabled,false);assert.ok(initial.root.startsWith(paths.userData+path.sep));
 await cache.getByRole('switch').check();await cache.getByRole('spinbutton').fill('4');await cache.getByRole('button',{name:'保存缓存设置',exact:true}).click();
 await cache.getByText('音频缓存设置已保存。',{exact:true}).waitFor();
 const saved=await page.evaluate(()=>window.desktop.speechCacheStatus());assert.equal(saved.enabled,true);assert.equal(saved.retentionDays,4);assert.equal(saved.error,null);check('Cache settings save through real IPC and create only the isolated installation cache',saved);await screenshot('speech-cache',cache);
 await nav('模型与 API');
 const cards=page.locator('.provider-card');await cards.filter({hasText:'OpenAI'}).getByRole('button',{name:'配置服务',exact:true}).click();
 let editor=page.locator('.api-service-editor');await editor.getByText('连接你的模型',{exact:true}).waitFor();
 const chatInputs=editor.locator('input[type="text"]:visible');assert.equal(await chatInputs.count(),0);
 await editor.locator('input[type="password"]').fill('qa-unsaved-placeholder');
 await cards.filter({hasText:'阿里云百炼'}).getByRole('button',{name:'配置服务',exact:true}).click();
 editor=page.locator('.api-service-editor');await editor.getByRole('heading',{name:'阿里云百炼',exact:true}).waitFor();await editor.getByText('连接你的模型',{exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('.api-service-editor input[type="password"]')?.value==='');assert.equal(await editor.locator('input[type="password"]').inputValue(),'');
 assert.equal(await editor.locator('input[type="text"]:visible').count(),0);check('Selecting a chat vendor fills its URL, hides URL editing, and clears the previous unsaved key');await screenshot('provider-key-form',editor);
 await nav('语音输入');await page.getByRole('heading',{name:'支持语音输入的厂商 API',exact:true}).waitFor();await screenshot('asr-directory');
 const directory=await page.evaluate(()=>window.desktop.apiServiceCatalog());assert.equal(directory.providers.filter(item=>(item.capabilities||[]).includes('asr')).length,8);check('Voice input displays the actual eight-provider ASR catalog, not a simulated validation result');
 await page.getByRole('button',{name:'配置语音识别 API',exact:true}).click();
 editor=page.locator('.api-service-editor');await editor.getByText('语音识别',{exact:true}).waitFor();
 await editor.locator('.api-dynamic-fields').first().locator('input[type="password"]').waitFor();
 assert.equal(await editor.locator('.api-dynamic-fields').first().locator('input[type="text"]:visible').count(),0);
 assert.ok(await editor.getByText('wss://dashscope.aliyuncs.com/api-ws/v1/realtime',{exact:true}).count());
 check('ASR entry selects the native vendor form with its official URL prefilled and hidden URL editing');await screenshot('asr-key-form',editor);
 await page.locator('.provider-card').filter({hasText:'腾讯云'}).getByRole('button',{name:'配置服务',exact:true}).click();
 await editor.getByText('语音识别',{exact:true}).waitFor();
 const fields=await editor.locator('.api-dynamic-fields').first().innerText();
 assert.match(fields,/APPID/i);assert.match(fields,/SecretID/i);assert.match(fields,/SecretKey/i);
 check('Tencent ASR retains its actually required multi-part credentials instead of pretending one key is enough');await screenshot('asr-multipart-form',editor);
 await shutdown();await open();await page.getByRole('button',{name:'设置',exact:true}).click();await nav('语音输出');
 await page.locator('.speech-cache-settings').getByText(/已确认配置：开启 · 4 天/).waitFor();
 const restarted=await page.evaluate(()=>window.desktop.speechCacheStatus());assert.equal(restarted.enabled,true);assert.equal(restarted.retentionDays,4);assert.equal(restarted.root,saved.root);check('Real Electron restart restores the same-install cache preference');
 assert.deepEqual(report.rendererErrors,[]);assert.deepEqual(report.blockedRequests,[]);report.success=true;
}catch(error){report.success=false;report.failure=error.stack;process.exitCode=1;console.error(error);if(page&&!page.isClosed()){await screenshot('failure').catch(()=>{});report.failureText=await page.locator('body').innerText().catch(()=>null);}}
finally{await shutdown().catch(error=>{report.cleanupError=error.message;process.exitCode=1;});await server?.close();await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log('Report: '+path.join(output,'report.json'));}
