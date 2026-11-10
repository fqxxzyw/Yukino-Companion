// Run from any directory: node scripts/verify-3d-return.mjs
// Uses an isolated temporary profile and the real Electron GPU renderer.
// Requires npm dependencies, a graphical desktop and the verified default GLB.
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';import {_electron} from 'playwright-core';
const root=fileURLToPath(new URL('../',import.meta.url));
const catalogue=JSON.parse(await fs.readFile(path.join(root,'resources/character-models.json'),'utf8'));
const defaultModel=catalogue.models.find(item=>item.id==='yukino-07-v1');assert.ok(defaultModel?.url,'Default character is missing from the model catalogue');
let bytes;try{bytes=await fs.readFile(path.join(root,'public',defaultModel.url.replace(/^\.\//,'')));}catch{throw Error('Default character GLB is missing; run npm run prepare:characters with the verified source assets first.');}
assert.equal(bytes.length,defaultModel.bytes,'Default character GLB size differs from catalogue');
assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),defaultModel.sha256,'Default character GLB hash differs from catalogue');
const server=await createServer({root,server:{host:'127.0.0.1',port:0}});await server.listen();
const tempRoot=path.resolve(os.tmpdir()),profile=await fs.mkdtemp(path.join(tempRoot,'yukino-avatar-return-')),entry=path.join(profile,'entry.cjs');
assert.equal(path.dirname(path.resolve(profile)),tempRoot,'Disposable profile must be inside the temporary directory');
await fs.writeFile(entry,`const {app}=require('electron');app.setPath('appData',${JSON.stringify(profile)});require(${JSON.stringify(path.join(root,'electron/main.cjs'))});`);
const env={...process.env,YUKINO_DEV_SERVER_URL:`http://127.0.0.1:${server.httpServer.address().port}/`};delete env.ELECTRON_RUN_AS_NODE;
let app;try{
 app=await _electron.launch({args:[entry],cwd:root,env,timeout:90000});const page=await app.firstWindow();
 await page.locator('.setup-dialog').waitFor({state:'visible',timeout:60000});await page.getByRole('button',{name:'先跳过，稍后配置'}).click();
 const status=await page.evaluate(()=>window.desktop.voiceStatus());if(!status.configured){const wizard=page.locator('.voice-chat-wizard');await wizard.waitFor({state:'visible',timeout:60000});await wizard.getByRole('button',{name:'稍后再说'}).click();await wizard.waitFor({state:'hidden',timeout:60000});}
 const host=page.locator('.character-model-host');await page.waitForFunction(()=>document.querySelector('.character-model-host canvas')?.dataset.rendered==='true',null,{timeout:120000});
 await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(x=>x.webContents.getURL().includes('127.0.0.1'));w.setBounds({x:100,y:70,width:1100,height:800});});
 await page.evaluate(()=>{window.__returnEvents=[];window.desktop.onAvatarHandoff(value=>window.__returnEvents.push(value));});
 await page.evaluate(()=>window.desktop.closeChoice('model'));
 let model;for(let n=0;n<100;n++){model=app.windows().find(w=>w.url().includes('model-window'));if(model)break;await page.waitForTimeout(200);}assert.ok(model);
 await model.locator('.model-window-canvas').waitFor({state:'visible',timeout:60000});await model.waitForFunction(()=>document.querySelector('.model-window-canvas canvas')?.dataset.rendered==='true',null,{timeout:120000});
 await model.evaluate(()=>window.companion.call('prefs',{scale:1.3}));await model.waitForTimeout(500);
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('model-window')).setPosition(600,180));
 await model.locator('.model-window-canvas').focus();await model.keyboard.press('ArrowRight');await model.keyboard.press('ArrowRight');await model.waitForTimeout(500);
 const db=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('model-window')).getContentBounds());const dr=await model.locator('.model-window-canvas').boundingBox();
 const target={x:db.x+dr.x,y:db.y+dr.y,width:dr.width,height:dr.height};await model.evaluate(()=>window.companion.call('open-main'));
 await page.waitForFunction(()=>window.__returnEvents.some(x=>x.phase==='finish'),null,{timeout:20000});await page.waitForTimeout(450);
 const mb=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('127.0.0.1')&&!w.webContents.getURL().includes('model-window')).getContentBounds());const mr=await host.boundingBox(),panelBounds=await page.locator('.character-panel').boundingBox();
 const event=await page.evaluate(()=>window.__returnEvents.find(x=>x.phase==='prepare'));assert.equal(event.view.yaw,30);
 const crossfade={x:mb.x+event.rect.x,y:mb.y+event.rect.y,width:event.rect.width,height:event.rect.height};
 for(const key of ['x','y','width','height'])assert.ok(Math.abs(target[key]-crossfade[key])<=2,`${key}: ${target[key]} vs ${crossfade[key]}`);
 assert.ok(mr.x>=panelBounds.x-1&&mr.x+mr.width<=panelBounds.x+panelBounds.width+1,'completed canvas remains inside the panel');
 assert.equal(await host.evaluate(el=>el.style.width),'','temporary canvas size is released on completion');
 console.log(JSON.stringify({target,crossfade,panel:panelBounds,actual:mr,view:event.view,events:await page.evaluate(()=>window.__returnEvents)}));
 // Simulate an interrupted second transition and confirm that both the
 // already-adopted geometry and the previous view survive the rollback.
 const beforeCancel=await host.boundingBox();
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('127.0.0.1')&&!w.webContents.getURL().includes('model-window')).webContents.send('avatar-handoff',{phase:'prepare',sequence:99999,view:{zoom:2,yaw:-90},rect:{x:100,y:100,width:220,height:300}}));
 await page.waitForFunction(()=>document.querySelector('.character-model-host')?.dataset.avatarHandoff==='true');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('127.0.0.1')&&!w.webContents.getURL().includes('model-window')).webContents.send('avatar-handoff',{phase:'cancel',sequence:99999}));
 await page.waitForFunction(()=>!document.querySelector('.character-model-host')?.dataset.avatarHandoff);const afterCancel=await host.boundingBox();
 for(const key of ['x','y','width','height'])assert.ok(Math.abs(beforeCancel[key]-afterCancel[key])<=1,`cancel ${key}`);
 await page.waitForTimeout(150);await page.evaluate(()=>window.desktop.closeChoice('model'));await model.locator('.model-window-canvas').waitFor({state:'visible',timeout:20000});
 await model.evaluate(()=>{window.__returnView=null;window.companion.onState(value=>window.__returnView=value.handoffModelView);return window.companion.call('ready')});
 await model.waitForFunction(()=>window.__returnView?.yaw===30&&window.__returnView?.zoom===1,null,{timeout:20000});
 const priorFinishes=await page.evaluate(()=>window.__returnEvents.filter(x=>x.phase==='finish').length);await model.evaluate(()=>window.companion.call('open-main'));await page.waitForFunction(n=>window.__returnEvents.filter(x=>x.phase==='finish').length>n,priorFinishes,{timeout:20000});
 console.log('interrupted handoff: previous canvas and view restored');
 const inlineBefore=await host.evaluate(el=>el.style.width);assert.equal(inlineBefore,'','handoff geometry returns to panel');
 const resizeGrip=page.locator('.character-resizer');const grip=await resizeGrip.boundingBox();assert.ok(grip,'resize grip exists');
 await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);await page.mouse.down();await page.mouse.move(grip.x+grip.width/2-50,grip.y+grip.height/2,{steps:5});await page.mouse.up();
 await page.waitForFunction(()=>document.querySelector('.character-model-host')?.style.width==='');
 console.log('user resized panel: handoff canvas released');
 async function reopenAgain(){const count=await page.evaluate(()=>window.__returnEvents.filter(x=>x.phase==='finish').length);await page.evaluate(()=>window.desktop.closeChoice('model'));await model.locator('.model-window-canvas').waitFor({state:'visible',timeout:20000});await model.waitForTimeout(250);await model.evaluate(()=>window.companion.call('open-main'));await page.waitForFunction(n=>window.__returnEvents.filter(x=>x.phase==='finish').length>n,count,{timeout:20000});assert.equal(await host.evaluate(el=>el.style.width),'','handoff released');}
 await reopenAgain();
 await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(x=>x.webContents.getURL().includes('127.0.0.1')&&!x.webContents.getURL().includes('model-window'));const b=w.getBounds();w.setSize(b.width-40,b.height);});
 await page.waitForFunction(()=>document.querySelector('.character-model-host')?.style.width==='');console.log('window resized: handoff canvas released');
 await reopenAgain();const panel=page.locator('.character-panel'),oldSide=await panel.getAttribute('data-side'),mainBox=await page.locator('.main').boundingBox(),handle=await page.locator('.character-grip').boundingBox();assert.ok(mainBox&&handle);
 await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(oldSide==='left'?mainBox.x+mainBox.width-30:mainBox.x+30,handle.y+handle.height/2,{steps:8});await page.mouse.up();
 await page.waitForFunction(side=>document.querySelector('.character-panel')?.dataset.side!==side,oldSide);await page.waitForFunction(()=>document.querySelector('.character-model-host')?.style.width==='');console.log('panel dock changed: handoff canvas released');
 await reopenAgain();
 await page.getByRole('button',{name:'人物场景选项'}).click();await page.getByRole('button',{name:'更多形象设置'}).click();
 await page.waitForFunction(()=>document.querySelector('.character-model-host')?.style.width==='');
 console.log('opened settings: handoff canvas released');

}finally{await app?.close();await server.close();await fs.rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
