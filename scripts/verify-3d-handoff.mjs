// Run from any directory: node scripts/verify-3d-handoff.mjs
// Uses disposable appData under build/, the real Electron preload and GPU renderer;
// no personal settings, microphone, network inference or clipboard are touched.
// Requires npm dependencies and the verified default GLB in public/characters.
import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';import {_electron} from 'playwright-core';
const root=fileURLToPath(new URL('../',import.meta.url));
const catalogue=JSON.parse(await fs.readFile(path.join(root,'resources/character-models.json'),'utf8'));
const model=catalogue.models.find(item=>item.id==='yukino-07-v1');assert.ok(model?.url,'Default character is missing from the model catalogue');
const modelPath=path.join(root,'public',model.url.replace(/^\.\//,''));
let bytes;try{bytes=await fs.readFile(modelPath);}catch{throw Error('Default character GLB is missing; run npm run prepare:characters with the verified source assets first.');}
assert.equal(bytes.length,model.bytes,'Default character GLB size differs from catalogue');
assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),model.sha256,'Default character GLB hash differs from catalogue');
const server=await createServer({root,server:{host:'127.0.0.1',port:0}});await server.listen();
try{for(const position of ['below','above']){
 const profile=await fs.mkdtemp(path.join(root,'build/handoff-geometry-')),entry=path.join(profile,'entry.cjs');
 await fs.writeFile(entry,`const {app}=require('electron');app.setPath('appData',${JSON.stringify(profile)});require(${JSON.stringify(path.join(root,'electron/main.cjs'))});`);
 const env={...process.env,YUKINO_DEV_SERVER_URL:`http://127.0.0.1:${server.httpServer.address().port}/`};delete env.ELECTRON_RUN_AS_NODE;
 let app;try{
  app=await _electron.launch({args:[entry],cwd:root,env,timeout:90000});const page=await app.firstWindow();
  await page.locator('.setup-dialog').waitFor({state:'visible',timeout:60000});await page.getByRole('button',{name:'先跳过，稍后配置'}).click();
  const status=await page.evaluate(()=>window.desktop.voiceStatus());if(!status.configured){const wizard=page.locator('.voice-chat-wizard');await wizard.waitFor({state:'visible',timeout:60000});await wizard.getByRole('button',{name:'稍后再说'}).click();await wizard.waitFor({state:'hidden',timeout:60000});}
  const host=page.locator('.character-model-host');await page.waitForFunction(()=>document.querySelector('.character-model-host canvas')?.dataset.rendered==='true',null,{timeout:120000});
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(x=>x.webContents.getURL().includes('127.0.0.1'));w.setBounds({x:100,y:70,width:1100,height:800});});
  await page.evaluate(position=>window.desktop.companionSet({inputPosition:position}),position);
  await host.focus();await page.keyboard.press('ArrowUp');await page.keyboard.press('ArrowUp');await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  const mainBounds=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('127.0.0.1')&&!w.webContents.getURL().includes('model-window')).getContentBounds());
  const before=await host.boundingBox();await page.evaluate(()=>window.desktop.closeChoice('model'));
  let model;for(let n=0;n<100;n++){model=app.windows().find(w=>w.url().includes('model-window'));if(model)break;await page.waitForTimeout(200);}assert.ok(model,'model window opens');
  await model.locator('.model-window-canvas').waitFor({state:'visible',timeout:60000});
  await model.evaluate(()=>{window.__handoffState=null;window.companion.onState(value=>window.__handoffState=value);return window.companion.call('ready')});
  await model.waitForFunction(()=>Math.abs((window.__handoffState?.handoffModelView?.zoom||0)-1.2)<0.001&&window.__handoffState?.handoffModelView?.yaw===30,null,{timeout:30000});
  await model.waitForFunction(()=>document.querySelector('.model-window-canvas canvas')?.dataset.rendered==='true',null,{timeout:120000});
  const desktopBounds=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('model-window')).getContentBounds());
  const after=await model.locator('.model-window-canvas').boundingBox();const a={x:before.x+mainBounds.x,y:before.y+mainBounds.y,width:before.width,height:before.height},b={x:after.x+desktopBounds.x,y:after.y+desktopBounds.y,width:after.width,height:after.height};
  for(const key of ['x','y','width','height'])assert.ok(Math.abs(a[key]-b[key])<=2,`${position} ${key}: ${a[key]} vs ${b[key]}`);
  console.log(JSON.stringify({position,main:a,desktop:b,view:await model.evaluate(()=>window.__handoffState.handoffModelView)}));
 }finally{await app?.close();}
}}finally{await server.close();}
