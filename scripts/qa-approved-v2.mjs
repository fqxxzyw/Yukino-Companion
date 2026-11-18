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
const root=fileURLToPath(new URL('../',import.meta.url));
const output=path.join(root,'build/qa-approved-v2');
const only=process.env.QA_ONLY||'';
const gesture=process.env.QA_GESTURE||'';
const models=JSON.parse(await fs.readFile(path.join(root,'resources/character-models.json'),'utf8'))
 .models.filter(model=>model.approvedV2&&(!only||model.id===only)).map(model=>({id:model.id,label:model.label}));
const report={purpose:'Actual Electron/Three approved V2 model load and view QA',models:[],errors:[],failedRequests:[],screenshots:[]};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let processHandle,log='',page,cdp,client;
async function until(fn,label,timeout=60000){
 const start=Date.now();let last;
 while(Date.now()-start<timeout){try{const value=await fn();if(value)return value;}catch(error){last=error;}await pause(100);}
 throw Error('Timed out: '+label+(last?' / '+last.message:''));
}
async function shot(name){
 const box=await page.locator('.character-model-host').boundingBox();
 if(!box)throw Error('character panel has no bounds');
 const {data}=await cdp.send('Page.captureScreenshot',{format:'png',fromSurface:true,clip:{x:box.x,y:box.y,width:box.width,height:box.height,scale:1}});
 const file=path.join(output,name+'.png');await fs.writeFile(file,Buffer.from(data,'base64'));
 report.screenshots.push({name,file:path.relative(root,file),bytes:(await fs.stat(file)).size});
}
async function dismissFirstRun(){
 await pause(800);
 const setup=page.locator('.setup-dialog');if(await setup.count())await setup.locator('footer .text-link').click().catch(()=>{});
 const skip=page.getByRole('button',{name:'稍后再说',exact:true});if(await skip.count())await skip.click().catch(()=>{});
 await until(async()=>await page.locator('.voice-chat-wizard').count()===0,'prompts dismissed');
}
async function stop(){
 if(!processHandle||processHandle.exitCode!==null||processHandle.signalCode!==null)return;
 const done=once(processHandle,'exit');
 spawn('taskkill',['/PID',String(processHandle.pid),'/T','/F'],{stdio:'ignore'});
 await Promise.race([done,pause(15000)]);
}
await fs.mkdir(output,{recursive:true});
try{
 const env={...process.env};delete env.YUKINO_DEV_SERVER_URL;
 processHandle=spawn(electronPath,['.','--remote-debugging-address=127.0.0.1','--remote-debugging-port=9482'],{cwd:root,env,stdio:['ignore','pipe','pipe']});
 for(const stream of [processHandle.stdout,processHandle.stderr])stream.on('data',chunk=>{log+=chunk.toString();});
 await until(()=>log.includes('DevTools listening'),'Electron startup');
 client=await until(()=>chromium.connectOverCDP('http://127.0.0.1:9482'),'CDP');
 page=await until(()=>client.contexts()[0]?.pages()?.find(item=>item.url().includes('/dist/index.html')),'renderer');
 page.on('pageerror',error=>report.errors.push(error.message));
 page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
 page.on('response',response=>{if(response.status()>=400)report.failedRequests.push({url:response.url(),status:response.status()});});
 cdp=await page.context().newCDPSession(page);
 await page.waitForFunction(()=>typeof window.desktop?.load==='function');
 await page.getByRole('textbox',{name:'消息',exact:true}).waitFor();
 await dismissFirstRun();
 const saved=await page.evaluate(async()=>(await window.desktop.load()).state);
 const base={...saved,activeCharacter:'yukino',showAvatar:true,side:'right',width:360,reduce:false,
  relationship:{...(saved.relationship||{}),affection:100,skinPreviewEnabled:false},
  presentation:{...(saved.presentation||{}),avatarRenderer:'3d',renderStyle:'lit',sceneEnabled:false}};
 for(const model of models){
  const existing=Array.isArray(base.characters)?base.characters:[];
  const characters=existing.some(character=>character.id==='yukino')
   ?existing.map(character=>character.id==='yukino'?{...character,name:character.name||'雪之下雪乃',builtin:true,modelId:model.id}:character)
   :[{id:'yukino',name:'雪之下雪乃',builtin:true,modelId:model.id,voiceLanguage:'ja'},...existing];
  await page.evaluate(async state=>{await window.desktop.save(state)}, {...base,characters});
  await page.reload();
  await page.waitForFunction(()=>typeof window.desktop?.load==='function');
  await page.getByRole('textbox',{name:'消息',exact:true}).waitFor();
  await until(()=>page.evaluate(id=>document.querySelector('.character-model-host')?.dataset.modelReady===id,model.id),'model ready '+model.id,90000);
  await until(()=>page.evaluate(()=>document.querySelector('.character-model-host canvas')?.dataset.rendered==='true'),'first frame '+model.id,30000);
  await pause(700);
  const state=await page.evaluate(id=>{const host=document.querySelector('.character-model-host');return {ready:host?.dataset.modelReady,id,status:document.querySelector('.model-status')?.textContent?.slice(0,120),speechReady:host?.dataset.speechReady,clip:host?.dataset.candidateClip,clipTime:host?.dataset.candidateClipTime,transition:host?.dataset.transitionMode,beret:host?.dataset.beretActive,hostClass:host?.className};},model.id);
  assert.equal(state.ready,model.id);
  const safe=model.id.replace(/[^A-Za-z0-9_-]/g,'_');
  await shot('first-'+safe);
  if(process.env.QA_RECORD==='1'){
   for(let index=0;index<10;index++){await pause(120);await shot('record-'+safe+'-'+String(index).padStart(2,'0'));}
  }
  await shot('front-'+safe);
  let beretState=null;
  if(process.env.QA_BERET){
   const box=await page.locator('.character-model-host').boundingBox();
   const points=process.env.QA_BERET==='grid'
    ?[0.06,0.08,0.10,0.12,0.14,0.16,0.18].map(y=>[.5,y])
    :process.env.QA_BERET==='grid2'?[.4,.45,.5,.55,.6].flatMap(x=>[.06,.08,.10,.12,.14,.16].map(y=>[x,y])):[[.5,.13]];
   for(const [xf,yf] of points){
    const x=box.x+box.width*xf,y=box.y+box.height*yf;
    await page.mouse.move(x,y);await page.mouse.down();await pause(150);
    const active=await page.evaluate(()=>document.querySelector('.character-model-host')?.dataset.beretActive);
    if(active==='true'){
     await page.mouse.move(x+12,y-18,{steps:4});await pause(300);
     await shot('beret-held-'+safe);
     await page.mouse.up();await pause(900);
     const after=await page.evaluate(()=>document.querySelector('.character-model-host')?.dataset.beretActive);
     beretState={point:[xf,yf],active,after};
     await shot('beret-released-'+safe);
     break;
    }
    await page.mouse.up();await pause(80);
   }
  }
  const gestureStates=[];
  if(gesture){
   await page.evaluate(name=>document.querySelector('.character-model-host').dispatchEvent(new CustomEvent('yukino:head-gesture',{detail:{name}})),gesture);
   for(let index=0;index<8;index++){
    await pause(250);
    await shot('gesture-'+gesture+'-'+String(index).padStart(2,'0'));
    gestureStates.push(await page.evaluate(()=>({name:document.querySelector('.character-model-host')?.dataset.headGesture||'',time:performance.now()})));
   }
  }
  const host=page.locator('.character-model-host');
  await host.focus();
  for(let index=0;index<3;index++)await page.keyboard.press('ArrowRight');
  await pause(350);
  await shot('right45-'+safe);
  for(let index=0;index<6;index++)await page.keyboard.press('ArrowLeft');
  await pause(350);
  await shot('left45-'+safe);
  await page.keyboard.press('Home');
  report.models.push({...model,state,gesture:gesture||null,gestureStates,beretState});
  console.log('MODEL',JSON.stringify({...model,state}));
 }
 report.passed=report.errors.length===0&&report.failedRequests.length===0;
}catch(error){
 report.passed=false;report.failure=error.message;
}finally{
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
 console.log('REPORT',path.join(output,'report.json'));
 await stop();
}
if(report.passed!==true)process.exitCode=1;
