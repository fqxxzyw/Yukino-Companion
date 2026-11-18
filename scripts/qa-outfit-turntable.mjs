import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';

const require=createRequire(import.meta.url);
const electronPath=require('electron');

// Drive the actual development desktop window. This exercises the real model
// IPC, wardrobe gate, Three renderer and turntable; it does not fabricate a
// renderer result and makes no provider or network request.
const root=fileURLToPath(new URL('../',import.meta.url));
const output=path.join(root,'build/qa-outfit-turntable');
const url='http://127.0.0.1:5381/',debugURL='http://127.0.0.1:9481';
const report={purpose:'Actual Electron/Three 44B outfit turntable',checks:[],screenshots:[],errors:[],failedRequests:[],timeline:[]};
const shots=process.env.QA_FRAMES_ONLY!=='1';
const production=process.env.QA_PRODUCTION==='1';
const panelWidth=Number(process.env.QA_WIDTH)||300;
const reduced=process.env.QA_REDUCED==='1';
const initialModel=process.env.QA_MODEL||'summer-uniform-v2';
const wantedTarget=process.env.QA_TARGET||'';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let processHandle,log='',page,client,cdp;
async function until(fn,label,timeout=60000){
 const start=Date.now();let last;
 while(Date.now()-start<timeout){
  try{const value=await fn();if(value)return value;}catch(error){last=error;}
  await pause(100);
 }
 throw Error('Timed out: '+label+(last?' / '+last.message:''));
}
async function screenshot(name){
 if(!shots)return;
 const file=path.join(output,name+'.png');
 await page.screenshot({path:file});
 const stat=await fs.stat(file);
 report.screenshots.push({name,file:path.relative(root,file),bytes:stat.size});
 console.log('SCREENSHOT '+name+' '+stat.size);
}
async function connect(){
 client=await until(()=>chromium.connectOverCDP(debugURL),'Electron CDP');
 const next=await until(()=>{
  const pages=client.contexts()[0]?.pages()||[];
  if(pages.length)console.log('PAGES',JSON.stringify(pages.map(page=>page.url())));
  return pages.find(item=>production?item.url().includes('/dist/index.html'):item.url().startsWith(url));
 },'development renderer');
 next.on('pageerror',error=>report.errors.push(error.message));
 next.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
 next.on('response',response=>{if(response.status()>=400)report.failedRequests.push({url:response.url(),status:response.status()});});
 next.on('requestfailed',request=>{if(!request.failure()?.errorText?.includes('ERR_ABORTED'))report.failedRequests.push({url:request.url(),error:request.failure()?.errorText});});
 cdp=await next.context().newCDPSession(next);
 return next;
}
async function panelScreenshot(name){
 if(!shots)return;
 const box=await page.locator('.character-model-host').boundingBox();
 if(!box)throw Error('character panel has no bounds');
 const {data}=await cdp.send('Page.captureScreenshot',{format:'png',fromSurface:true,clip:{x:box.x,y:box.y,width:box.width,height:box.height,scale:1}});
 const file=path.join(output,name+'.png');
 await fs.writeFile(file,Buffer.from(data,'base64'));
 const stat=await fs.stat(file);
 report.screenshots.push({name,file:path.relative(root,file),bytes:stat.size});
 console.log('PANEL SHOT '+name+' '+stat.size);
}
function startFrameProbe(){
 return page.evaluate(()=>{window.__qaFrames=[];window.__qaRaf=true;let last=performance.now();const tick=now=>{const host=document.querySelector('.character-model-host');window.__qaFrames.push({ms:now-last,phase:host?.dataset.turntablePhase||'',turntable:host?.dataset.outfitTurntable||''});last=now;if(window.__qaRaf)requestAnimationFrame(tick)};requestAnimationFrame(tick)});
}
function stopFrameProbe(){
 return page.evaluate(()=>{window.__qaRaf=false;const frames=(window.__qaFrames||[]).filter(value=>value.ms>0&&value.ms<2000);const sorted=[...frames].sort((a,b)=>a.ms-b.ms);return {count:frames.length,average:frames.length?frames.reduce((sum,value)=>sum+value.ms,0)/frames.length:0,p95:sorted.length?sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))].ms:0,max:sorted.length?sorted.at(-1).ms:0,over50:frames.filter(value=>value.ms>50).length,worst:sorted.slice(-8).map(value=>({ms:value.ms,phase:value.phase,turntable:value.turntable}))};});
}
async function dismissFirstRun(){
 await pause(1200);
 const setup=page.locator('.setup-dialog');if(await setup.count())await setup.locator('footer .text-link').click().catch(()=>{});
 await pause(500);
 const skip=page.getByRole('button',{name:'稍后再说',exact:true});if(await skip.count())await skip.click().catch(()=>{});
 await until(async()=>await page.locator('.voice-chat-wizard').count()===0,'first-use prompts dismissed');
}
async function stop(){
 if(!processHandle||processHandle.exitCode!==null||processHandle.signalCode!==null)return;
 if(production){
  const done=once(processHandle,'exit');
  spawn('taskkill',['/PID',String(processHandle.pid),'/T','/F'],{stdio:'ignore'});
  await Promise.race([done,pause(15000).then(()=>{throw Error('Owned Electron process did not exit');})]);
  return;
 }
 const done=once(processHandle,'exit');processHandle.stdin.end('q\n');
 await Promise.race([done,pause(20000).then(()=>{throw Error('Owned development runner did not exit gracefully');})]);
 assert.equal(processHandle.exitCode,0);
}
await fs.mkdir(output,{recursive:true});
try{
 if(production){
  const env={...process.env};delete env.YUKINO_DEV_SERVER_URL;
  processHandle=spawn(electronPath,['.','--remote-debugging-address=127.0.0.1','--remote-debugging-port=9481'],{cwd:root,env,stdio:['ignore','pipe','pipe']});
  for(const stream of [processHandle.stdout,processHandle.stderr])stream.on('data',chunk=>{log+=chunk.toString();});
  await until(()=>log.includes('DevTools listening'),'actual Electron startup');
 }else{
  processHandle=spawn(process.execPath,['scripts/dev.mjs','--desktop','--port','5381','--inspect-renderer','9481','--control-stdin'],{cwd:root,env:{...process.env},stdio:['pipe','pipe','pipe']});
  for(const stream of [processHandle.stdout,processHandle.stderr])stream.on('data',chunk=>{log+=chunk.toString();});
  await until(()=>log.includes('[dev] Electron ready'),'actual desktop startup');
 }
 page=await connect();
 await page.waitForFunction(()=>typeof window.desktop?.load==='function');
 await page.getByRole('textbox',{name:'消息',exact:true}).waitFor();
 await dismissFirstRun();
 const saved=await page.evaluate(async()=>{const {state}=await window.desktop.load();return state;});
 const dates=Array.from({length:7},(_,index)=>`2026-11-${String(index+1).padStart(2,'0')}`);
 const existing=Array.isArray(saved.characters)?saved.characters:[];
 const characters=existing.some(character=>character.id==='yukino')
  ? existing.map(character=>character.id==='yukino'?{...character,name:character.name||'雪之下雪乃',builtin:true,modelId:initialModel}:character)
  : [{id:'yukino',name:'雪之下雪乃',builtin:true,modelId:initialModel,voiceLanguage:'ja'},...existing];
 const next={...saved,activeCharacter:'yukino',characters,showAvatar:true,side:'right',width:panelWidth,reduce:reduced,relationship:{...(saved.relationship||{}),affection:100,skinPreviewEnabled:false},usedDates:{version:1,dates},presentation:{...(saved.presentation||{}),avatarRenderer:'3d',renderStyle:'lit',sceneEnabled:false}};
 await page.evaluate(async state=>{await window.desktop.save(state)},next);
 await page.reload();
 await page.waitForFunction(()=>typeof window.desktop?.load==='function');
 await page.getByRole('textbox',{name:'消息',exact:true}).waitFor();
 await dismissFirstRun();
 report.loadedState=await page.evaluate(async()=>{const {state}=await window.desktop.load();return {activeCharacter:state?.activeCharacter,showAvatar:state?.showAvatar,characters:state?.characters?.map(character=>({id:character.id,modelId:character.modelId})),presentation:state?.presentation};});
 report.domState=await page.evaluate(()=>({hosts:[...document.querySelectorAll('.character-model-host')].map(host=>({hidden:host.hidden,ready:host.dataset.modelReady,html:host.outerHTML.slice(0,240)})),fallback:document.querySelector('.character-fallback')?.textContent?.slice(0,120),status:document.querySelector('.model-status')?.textContent?.slice(0,160),showAvatar:!!document.querySelector('.character-panel')}));
 console.log('LOADED',JSON.stringify(report.loadedState));
 console.log('DOM',JSON.stringify(report.domState));
 const currentId=report.loadedState.characters.find(character=>character.id==='yukino')?.modelId;
 assert.ok(currentId,'current Yukino outfit id');
 const liveCatalog=await page.evaluate(()=>window.desktop.characterModelCatalog());
 report.catalog=liveCatalog.models.map(model=>({id:model.id,label:model.label,runtimeCandidate:model.runtimeCandidate,approvedV2:model.approvedV2===true,ready:model.ready}));
 const candidates=liveCatalog.models.filter(model=>model.ready&&(model.approvedV2===true||model.runtimeCandidate));
 const targetEntry=(wantedTarget?candidates.find(model=>model.id===wantedTarget):null)||candidates.find(model=>model.approvedV2===true&&model.id!==currentId)||candidates.find(model=>model.runtimeCandidate==='kimono')||candidates.find(model=>model.id!==currentId);
 assert.ok(targetEntry,'target candidate exists');
 report.currentModel=currentId;report.targetModel=targetEntry.id;
 await screenshot('00-diagnostic-after-reload');
 const host='.character-model-host';
 await until(()=>page.evaluate(({host,current})=>document.querySelector(host)?.dataset.modelReady===current,{host,current:currentId}),'current outfit ready');
 await until(()=>page.evaluate(()=>document.querySelector('.character-model-host canvas')?.dataset.rendered==='true'),'first rendered frame');
 await pause(700);
 report.checks.push('actual current outfit rendered in Electron');
 await screenshot('00-current-outfit');
 await page.getByRole('button',{name:'打开服装面板',exact:true}).click();
 const cards=page.locator('.wardrobe-panel .skin-card');
 const count=await cards.count();
 report.wardrobeCount=count;
 report.wardrobeGroups=await cards.evaluateAll(elements=>elements.map(element=>({label:element.getAttribute('aria-label'),disabled:element.disabled,selected:element.getAttribute('aria-pressed')==='true'})));
 assert.ok(count>=2,'need at least two registered outfits for the ring');
 await screenshot('01-wardrobe-open');
 // Same outfit must not start a second transition or close the panel silently.
 const selected=page.locator('.wardrobe-panel .skin-card[aria-pressed="true"]');
 if(await selected.count())await selected.click();
 await pause(500);
 assert.equal(await page.evaluate(host=>document.querySelector(host)?.dataset.outfitTurntable,host),undefined);
 report.checks.push('same outfit does not start a turntable');
 if(await page.locator('.wardrobe-panel').count()===0){
  await page.getByRole('button',{name:'打开服装面板',exact:true}).click();
  await page.waitForTimeout(250);
 }
 const target=page.locator('.wardrobe-panel .skin-card').filter({hasText:targetEntry.label}).first();
 assert.equal(await target.count(),1,'target card exists');
 assert.equal(await target.isDisabled(),false,'target card is unlocked');
 if(reduced){
  await target.click();
  await page.waitForFunction(({host,targetId})=>document.querySelector(host)?.dataset.modelReady===targetId&&!document.querySelector(host)?.dataset.outfitTurntable,{host,targetId:targetEntry.id},{timeout:60000});
  assert.equal(await page.evaluate(host=>document.querySelector(host)?.dataset.outfitTurntable,host),undefined);
  report.checks.push('reduced motion commits without a turntable');
  await pause(600);
  await screenshot('06-target-idle');
 }else{
  const started=page.waitForFunction(host=>document.querySelector(host)?.dataset.outfitTurntable==='true',host,{timeout:60000});
  const clickAt=Date.now();
  await target.click();
  await page.waitForTimeout(320);
  await screenshot('02a-preparing');
  await started;
  report.preRollMs=Date.now()-clickAt;
  await startFrameProbe();
  report.timeline.push({name:'turntable-start',at:Date.now()});
  await panelScreenshot('02-turntable-start');
  const disabled=await page.locator('.wardrobe-panel .skin-card').evaluateAll(elements=>elements.every(element=>element.disabled));
  assert.equal(await page.locator('.wardrobe-panel').count(),0,'wardrobe closes on selection');
  report.checks.push('wardrobe closes and all outfit cards lock while the ring owns the transition');
  await page.waitForFunction(host=>document.querySelector(host)?.dataset.turntablePhase==='rotate',host,{timeout:15000});
  await panelScreenshot('03-turntable-rotate-start');
  await page.waitForTimeout(220);
  await panelScreenshot('04-turntable-rotate');
  await page.waitForFunction(host=>['exit','done'].includes(document.querySelector(host)?.dataset.turntablePhase),host,{timeout:15000}).catch(()=>{});
  await panelScreenshot('05-turntable-exit');
  await page.waitForFunction(({host,targetId})=>document.querySelector(host)?.dataset.modelReady===targetId&&!document.querySelector(host)?.dataset.outfitTurntable,{host,targetId:targetEntry.id},{timeout:60000});
  report.frameStats=await stopFrameProbe();
  await pause(600);
  report.timeline.push({name:'turntable-finish',at:Date.now()});
  await screenshot('06-target-idle');
 }
 const finalState=await page.evaluate(async()=>({host:{...document.querySelector('.character-model-host').dataset},state:(await window.desktop.load()).state}));
 report.finalModel=finalState.host.modelReady;
 report.turntableTiming=finalState.host.turntableTiming;
 report.turntablePrep=finalState.host.turntablePrep;
 const active=(finalState.state.characters||[]).find(character=>character.id==='yukino');
 report.persistedModelId=active?.modelId;
 assert.equal(finalState.host.modelReady,targetEntry.id);
 assert.equal(active?.modelId,targetEntry.id);
 report.checks.push(reduced?'target is committed, idle and persisted with reduced motion':'target is committed, idle and persisted after the ring');
 if(!reduced){
  const secondEntry=candidates.find(model=>model.approvedV2===true&&model.id!==targetEntry.id&&model.id!==currentId);
  if(secondEntry){
   await page.getByRole('button',{name:'打开服装面板',exact:true}).click();
   await page.waitForTimeout(200);
   const secondCard=page.locator('.wardrobe-panel .skin-card').filter({hasText:secondEntry.label}).first();
   assert.equal(await secondCard.count(),1,'second target card exists');
   const secondStarted=page.waitForFunction(host=>document.querySelector(host)?.dataset.outfitTurntable==='true',host,{timeout:60000});
   const secondClick=Date.now();
   await secondCard.click();
   await secondStarted;
   report.secondPreRollMs=Date.now()-secondClick;
   await page.waitForFunction(({host,targetId})=>document.querySelector(host)?.dataset.modelReady===targetId&&!document.querySelector(host)?.dataset.outfitTurntable,{host,targetId:secondEntry.id},{timeout:60000});
   report.secondModel=secondEntry.id;
   report.checks.push('second transition commits from cached ring copies');
  }
 }
 if(report.errors.length)throw Error('Renderer errors: '+report.errors.join('; '));
 if(report.failedRequests.length)throw Error('Unexpected failed request: '+JSON.stringify(report.failedRequests.slice(0,3)));
 report.passed=true;
}catch(error){report.passed=false;report.failure=error.message;report.errors.push(error.message);console.error(error)}
finally{
 try{await page?.close();}catch{}
 try{await stop();}catch(error){report.errors.push('runner: '+error.message)}
 report.devLog=log.slice(-6000);
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.log('REPORT '+path.join(output,'report.json'));
 process.exitCode=report.passed?0:1;
}
