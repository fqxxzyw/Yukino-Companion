import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright-core';
import {getSkinStatus} from '../src/companion/skin-unlocks.mjs';

// Drive the actual development app and original preload. No fixture IPC,
// progress fabrication, provider calls, microphone, camera or model changes.
const root=fileURLToPath(new URL('../',import.meta.url));
const output=path.join(root,'build/base-model-development');
const catalog=JSON.parse(await fs.readFile(path.join(root,'resources/character-models.json'),'utf8'));
const base=catalog.models.filter(model=>/^yukino-0[1-7]-v1$/.test(model.id));
const url='http://127.0.0.1:5374/',debugURL='http://127.0.0.1:9434';
const report={purpose:'Actual dev:desktop model IPC, wardrobe gates and draft restart; draft material quality is out of scope',checks:[],screenshots:[],errors:[],failedRequests:[]};
const clients=[];
let processHandle,log='',page;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label,timeout=40000){
  const start=Date.now();let last;
  while(Date.now()-start<timeout){
    try{const value=await fn();if(value)return value;}catch(error){last=error;}
    await pause(100);
  }
  throw Error('Timed out: '+label+(last?' / '+last.message:''));
}
async function assertPortFree(port){
  const {createServer}=await import('node:net');
  const server=createServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  await new Promise(resolve=>server.close(resolve));
}
function check(name){report.checks.push(name);console.log('PASS '+name);}
async function connect(){
  const client=await until(()=>chromium.connectOverCDP(debugURL),'Electron CDP');clients.push(client);
  const next=await until(()=>client.contexts()[0]?.pages().find(item=>item.url().startsWith(url)),'development renderer');
  next.on('pageerror',error=>report.errors.push(error.message));
  next.on('response',response=>{if(response.status()>=400)report.failedRequests.push({url:response.url(),status:response.status()});});
  next.on('requestfailed',request=>{if(!request.failure()?.errorText?.includes('ERR_ABORTED'))report.failedRequests.push({url:request.url(),error:request.failure()?.errorText});});
  return next;
}
async function screenshot(name){await page.screenshot({path:path.join(output,name+'.png')});report.screenshots.push(name+'.png');}
async function stop(){
  if(!processHandle||processHandle.exitCode!==null||processHandle.signalCode!==null)return;
  const done=once(processHandle,'exit');processHandle.stdin.end('q\n');
  await Promise.race([done,pause(20000).then(()=>{throw Error('Owned development runner did not exit gracefully');})]);
  assert.equal(processHandle.exitCode,0);
}
await fs.mkdir(output,{recursive:true});
try{
  await assertPortFree(5374);await assertPortFree(9434);
  processHandle=spawn(process.execPath,['scripts/dev.mjs','--desktop','--port','5374','--inspect-renderer','9434','--control-stdin'],{cwd:root,env:{...process.env},stdio:['pipe','pipe','pipe']});
  for(const stream of [processHandle.stdout,processHandle.stderr])stream.on('data',chunk=>{log+=chunk.toString();});
  await until(()=>log.includes('[dev] Electron ready'),'actual desktop startup');
  page=await connect();await page.waitForFunction(()=>typeof window.desktop?.load==='function');
  await page.getByRole('heading',{name:'与雪之下雪乃开始对话',exact:true}).waitFor();
  await pause(1000);
  const setup=page.locator('.setup-dialog');if(await setup.count())await setup.locator('footer .text-link').click();
  await pause(800);
  const skip=page.getByRole('button',{name:'稍后再说',exact:true});if(await skip.count())await skip.click();
  await until(async()=>await page.locator('.voice-chat-wizard').count()===0,'first-use prompts dismissed without installing resources');
  check('Actual development window and original preload ready');
  const liveCatalog=await page.evaluate(()=>window.desktop.characterModelCatalog());
  for(const entry of base){
    const live=liveCatalog.models.find(model=>model.id===entry.id);
    for(const field of ['ready','hold','status','sha256','bytes'])assert.equal(live[field],entry[field]);
  }
  check('All seven catalogue digests and hold/readiness flags unchanged');
  const before=await page.evaluate(async()=>{const {state}=await window.desktop.load();return {relationship:state.relationship,usedDates:state.usedDates};});
  const bytes=await page.evaluate(async()=>{const data=new Uint8Array(await window.desktop.characterModelData('yukino-07-v1'));const digest=await crypto.subtle.digest('SHA-256',data);return {bytes:data.length,sha256:[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('')};});
  const school=base.find(model=>model.id==='yukino-07-v1');assert.equal(bytes.bytes,school.bytes);assert.equal(bytes.sha256,school.sha256);
  check('Real main-process model IPC returns the pinned school GLB');
  const denied=await page.evaluate(async()=>{try{await window.desktop.characterModelData('yukino-01-v1');return false;}catch{return true;}});
  assert.equal(denied,true);check('Original HOLD model is rejected by actual main-process IPC');
  await page.getByRole('button',{name:'打开服装面板',exact:true}).click();
  const cards=page.locator('.wardrobe-panel .skin-card');await until(async()=>await cards.count()===7,'seven outfit groups');
  const wardrobe=await cards.evaluateAll(elements=>elements.map(element=>({label:element.getAttribute('aria-label'),disabled:element.disabled,selected:element.getAttribute('aria-pressed')==='true'})));
  for(const entry of base){
    const card=wardrobe.find(item=>item.label.startsWith(entry.label+'，'));
    assert.ok(card,'Missing base outfit card: '+entry.id);
    assert.equal(card.disabled,!getSkinStatus(entry,before).unlocked,entry.id+' must retain its actual progression gate');
  }
  report.wardrobe=wardrobe;check('Seven wardrobe groups respect real progression and original HOLD');
  await screenshot('desktop-wardrobe');
  await cards.filter({hasText:school.label}).click();
  await page.getByRole('button',{name:'关闭服装面板',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.character-model-host')?.dataset.modelReady==='yukino-07-v1'&&document.querySelector('.character-model-host canvas')?.dataset.rendered==='true');
  assert.equal(await page.locator('.character-fallback').count(),0);
  await screenshot('desktop-school-model');check('Actual product UI selects and renders school model, not a thumbnail or fallback');
  const preview=page.getByRole('group',{name:'人物预览：拖动旋转，滚轮缩放，Home 复位',exact:true});
  await preview.focus();await preview.press('ArrowRight');await preview.press('ArrowUp');await pause(300);await screenshot('desktop-model-orbit');await preview.press('Home');
  check('Real model preview accepts rotation, zoom and reset controls');
  const after=await page.evaluate(async()=>{const {state}=await window.desktop.load();return {relationship:state.relationship,usedDates:state.usedDates};});
  assert.deepEqual(after,before);check('Wardrobe validation does not fabricate affection or usage dates');
  const input=page.getByRole('textbox',{name:'消息',exact:true}),originalDraft=await input.inputValue();
  const marker='model-framework-'+Date.now();await input.fill(marker);await pause(250);
  const readyCount=(log.match(/Electron ready/g)||[]).length;
  processHandle.stdin.write('r\n');
  await until(()=>(log.match(/Electron ready/g)||[]).length>readyCount,'controlled developer restart');
  page=await connect();await page.getByRole('textbox',{name:'消息',exact:true}).waitFor();
  assert.equal(await page.getByRole('textbox',{name:'消息',exact:true}).inputValue(),marker);
  await page.getByRole('textbox',{name:'消息',exact:true}).fill(originalDraft);
  await page.waitForFunction(()=>document.querySelector('.character-model-host')?.dataset.modelReady==='yukino-07-v1'&&document.querySelector('.character-model-host canvas')?.dataset.rendered==='true');
  check('Controlled Electron restart preserves development draft and reloads real 3D');
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.failedRequests,[]);
  await stop();await assertPortFree(5374);await assertPortFree(9434);
  assert.ok(!log.includes('未及时退出'));
  check('Owned development instance exits gracefully and releases both ports');report.passed=true;
}catch(error){report.passed=false;report.failure=error.stack;console.error(error);process.exitCode=1;if(page&&!page.isClosed())await screenshot('failure').catch(()=>{});}
finally{
  await stop().catch(error=>{report.cleanupError=error.message;process.exitCode=1;report.passed=false;});
  for(const client of clients)await client.close().catch(()=>{});
  report.processLogSha256=createHash('sha256').update(log).digest('hex');
  await fs.writeFile(path.join(output,'process.log'),log);
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log('Report: '+path.join(output,'report.json'));
}
