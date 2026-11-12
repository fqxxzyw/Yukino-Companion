// Real native windows, isolated data, and an actual rendered 3D model.
// Run with: node_modules/.bin/electron scripts/verify-first-close-native.cjs
'use strict';
const electron=require('electron'),{app,BrowserWindow,screen}=electron;
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {CompanionManager}=require('../electron/companions.cjs');
const root=path.resolve(__dirname,'..');
const catalogue=require('../resources/character-models.json');
const entry=catalogue.models.find(model=>model.id==='yukino-07-v1');
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-handoff-native-'));let manager,main;
 try{
  const area=screen.getPrimaryDisplay().workArea;
  assert.ok(area.width>=500&&area.height>=400,'display too small for this verification');
  main=new BrowserWindow({x:area.x,y:area.y,width:Math.min(area.width,1200),height:area.height,frame:false,show:false,webPreferences:{nodeIntegration:true,contextIsolation:false,backgroundThrottling:false}});
  await main.loadURL('data:text/html,<style>html,body{margin:0} .character{position:absolute;right:20px;top:90px;bottom:12px;width:260px}</style><div class="character"></div>');
  main.show();
  manager=new CompanionManager({electron:{...electron,Tray:undefined,Notification:undefined},dataDir:dir,onModelCatalog:async()=>catalogue,onModelData:async()=>fs.readFile(path.join(root,'public',entry.url.replace(/^\.\//,''))),onError:error=>console.error(error.message)});
  await manager.initialize();console.log('native fixture initialized');manager.attachMainWindow(main);manager.setCharacter({id:'yukino',name:'Yukino',modelId:entry.id});
  await manager.setPreferences({closeAction:'model',animation:false});console.log('native close preference set');
  const mainBounds=main.getContentBounds();
  const rect=await main.webContents.executeJavaScript(`(()=>{const r=document.querySelector('.character').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,view:{zoom:1,yaw:0},layoutProtocol:true}})()`);
  // Exercise the remembered native close with no preexisting cached rectangle.
  electron.ipcMain.on('qa-avatar-measure',(_event,payload)=>manager.avatarLayoutReady(payload));
  await main.webContents.executeJavaScript(`require('electron').ipcRenderer.on('avatar-handoff',(_event,value)=>{if(value.phase==='measure'){const r=document.querySelector('.character').getBoundingClientRect();require('electron').ipcRenderer.send('qa-avatar-measure',{...value,rect:{x:r.x,y:r.y,width:r.width,height:r.height,view:{zoom:1,yaw:0}},preferredSide:'right'})}});true`);
  const hidden=new Promise(resolve=>main.once('hide',resolve));
  // The first close dialog reports the canvas directly; a remembered close
  // instead asks the renderer to measure it. Exercise both entry points.
  if(process.argv.includes('--dialog')){
   manager.setAppAvatarRect(rect,{relative:true});
   console.log('requesting first close from dialog');void manager.closeChoice('model');
  }else{console.log('requesting first remembered close');main.close();}
  await Promise.race([hidden,new Promise((_,reject)=>setTimeout(()=>reject(Error('native handoff timed out')),30000))]);
  const desktop=manager.windows.get('model');assert.ok(desktop&&!desktop.isDestroyed(),'desktop window missing');
  const content=desktop.getContentBounds();
  const actual=await desktop.webContents.executeJavaScript(`(()=>{const r=document.querySelector('.model-window-canvas').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,rendered:document.querySelector('.model-window-canvas canvas')?.dataset.rendered}})()`);
  assert.equal(actual.rendered,'true','desktop first frame did not render');
  for(const key of ['x','y','width','height']){const expected=key==='x'?mainBounds.x+rect.x:key==='y'?mainBounds.y+rect.y:rect[key],value=key==='x'?content.x+actual.x:key==='y'?content.y+actual.y:actual[key];assert.ok(Math.abs(expected-value)<=2,`${key}: expected ${expected}, got ${value}`);}
  console.log('Native first close: actual rendered character canvas remains aligned near screen edge.');
  await manager.dispose();if(!main.isDestroyed())main.destroy();app.exit(0);
 }catch(error){console.error(error);await manager?.dispose();if(main&&!main.isDestroyed())main.destroy();app.exit(1);}
});
