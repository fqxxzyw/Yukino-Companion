// Real Electron/Three integration check with an isolated profile and one
// existing delivered asset. Does not contact providers or use user settings.
// Run after `npx vite build`: `npx electron scripts/verify-desktop-handoff.cjs`.
const electron=require('electron');
const {app,BrowserWindow,screen}=electron;
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const {CompanionManager}=require('../electron/companions.cjs');
const catalog=require('../resources/character-models.json');
const modelId='yukino-02-v1';
delete process.env.YUKINO_DEV_SERVER_URL;
let manager,main,directory,failed=false;
const errors=[],delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(predicate,label,timeout=5000){const started=Date.now();while(Date.now()-started<timeout){if(await predicate())return;await delay(40)}throw Error('超时：'+label);}
app.whenReady().then(async()=>{
 directory=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-handoff-qa-'));
 manager=new CompanionManager({electron,dataDir:directory,onError:error=>errors.push(error.message),onModelCatalog:async()=>catalog,onModelData:async id=>{
  if(id!==modelId)throw Error('验收仅允许读取指定内置模型');
  const entry=catalog.models.find(value=>value.id===id);
  return new Uint8Array(await fs.readFile(path.join(root,'public',entry.url.slice(2))));
 }});
 await manager.initialize();
 main=new BrowserWindow({width:600,height:600,show:true});
 await main.loadURL('data:text/html,<title>Yukino desktop handoff QA</title>');
 manager.attachMainWindow(main);
 manager.setCharacter({id:'yukino',name:'雪乃',modelId});
 const area=screen.getPrimaryDisplay().workArea,y=Math.min(250,Math.max(150,area.height*.35));
 manager.setAppAvatarRect({x:area.x+40,y:area.y+y,width:Math.min(350,area.width-80),height:Math.min(300,area.height-y-80)});
 await manager.closeChoice('model');
 const model=manager.windows.get('model');
 assert.equal(main.isVisible(),false,`首帧交接未完成：${errors.join('；')}`);
 assert.equal(model.isVisible(),true);assert.equal(manager.modelFrame?.ready,true);
 const canvas=()=>model.webContents.executeJavaScript(`(()=>{const r=document.querySelector('.model-window-canvas').getBoundingClientRect();return {height:r.height,rendered:document.querySelector('canvas')?.dataset.rendered}})()`);
 await waitFor(async()=>(await canvas()).rendered==='true','模型渲染');
 const before=await canvas(),beforeWindow=model.getBounds();
 manager.showReply({id:'handoff-qa',zh:'测试长回复。'.repeat(150)});
 await waitFor(async()=>await model.webContents.executeJavaScript("document.querySelector('.model-companion')?.dataset.hasReply==='true'"),'回复气泡');
 const after=await canvas(),afterWindow=model.getBounds();
 assert.ok(Math.abs(before.height-after.height)<2,'长回复改变了人物画布高度');
 if(beforeWindow.y-area.y>=afterWindow.height-beforeWindow.height)assert.ok(Math.abs(beforeWindow.y+beforeWindow.height-afterWindow.y-afterWindow.height)<=2,'窗口底边发生位移');
 const previousScale=manager.preferences.scale;
 await model.webContents.executeJavaScript("document.querySelector('.model-window-canvas').dispatchEvent(new WheelEvent('wheel',{deltaY:-100,bubbles:true,cancelable:true}))");
 await waitFor(()=>manager.preferences.scale>previousScale,'滚轮缩放');
 await manager.revealMain();
 assert.equal(main.isVisible(),true);assert.equal(model.isVisible(),false);assert.deepEqual(errors,[]);
 for(let i=0;i<30;i++){
  await manager.closeChoice('model');assert.equal(main.isVisible(),false,`第 ${i+1} 次关闭后主窗口仍可见`);assert.equal(model.isVisible(),true);
  await manager.revealMain();assert.equal(main.isVisible(),true);assert.equal(model.isVisible(),false,`第 ${i+1} 次打开后桌面人物仍可见`);
 }
 assert.deepEqual(errors,[]);
 console.log('PASS：真实模型首帧、30 次关闭/打开交接、长回复画布尺寸及滚轮缩放');
}).catch(error=>{failed=true;console.error(error.stack||error);}).finally(async()=>{
 try{await manager?.dispose();if(main&&!main.isDestroyed())main.destroy();if(directory)await fs.rm(directory,{recursive:true,force:true});}catch(error){failed=true;console.error(error.stack||error);}
 app.exit(failed?1:0);
});
