// Real Electron/Three desktop model-window check for the approved V2 models.
// Run after `npx vite build`: QA_MODEL=beret-v2 npx electron scripts/qa-desktop-approved-v2.cjs
const electron=require('electron');
const {app,BrowserWindow,screen}=electron;
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const {CompanionManager}=require('../electron/companions.cjs');
const catalog=require('../resources/character-models.json');
const modelId=process.env.QA_MODEL||'summer-uniform-v2';
const gesture=process.env.QA_GESTURE||'';
const shot=process.env.QA_SHOT||path.join(root,'build/qa-approved-v2','desktop-'+modelId+'.png');
delete process.env.YUKINO_DEV_SERVER_URL;
let manager,main,directory;
const errors=[],delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(predicate,label,timeout=90000){const started=Date.now();while(Date.now()-started<timeout){if(await predicate())return;await delay(100)}throw Error('超时：'+label);}
app.whenReady().then(async()=>{
 directory=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-desktop-v2-qa-'));
 manager=new CompanionManager({electron,dataDir:directory,onError:error=>errors.push(error.message),onModelCatalog:async()=>catalog,onModelData:async id=>{
  if(id!==modelId)throw Error('验收仅允许读取指定内置模型');
  const entry=catalog.models.find(value=>value.id===id);
  return new Uint8Array(await fs.readFile(path.join(root,'public',entry.url.slice(2))));
 }});
 await manager.initialize();
 main=new BrowserWindow({width:600,height:600,show:true});
 await main.loadURL('data:text/html,<title>Yukino desktop V2 QA</title>');
 manager.attachMainWindow(main);
 manager.setCharacter({id:'yukino',name:'雪乃',modelId});
 const area=screen.getPrimaryDisplay().workArea,y=Math.min(250,Math.max(150,area.height*.35));
 manager.setAppAvatarRect({x:area.x+40,y:area.y+y,width:Math.min(350,area.width-80),height:Math.min(300,area.height-y-80)});
 await manager.closeChoice('model');
 const model=manager.windows.get('model');
 await waitFor(()=>manager.modelFrame?.ready===true,'桌面模型首帧',120000);
 await waitFor(()=>model.webContents.executeJavaScript("document.querySelector('canvas')?.dataset.rendered==='true'"),'桌面渲染',30000);
 await delay(500);
 if(gesture){
  await model.webContents.executeJavaScript(`document.querySelector('.model-window-canvas').dispatchEvent(new CustomEvent('yukino:head-gesture',{detail:{name:${JSON.stringify(gesture)}}}))`);
  await delay(1100);
 }
 await fs.mkdir(path.dirname(shot),{recursive:true});
 const image=await model.webContents.capturePage();
 await fs.writeFile(shot,image.toPNG());
 console.log(JSON.stringify({modelId,gesture,shot,errors,ready:manager.modelFrame?.ready,rendered:true}));
 if(errors.length)throw Error(errors.join('；'));
}).catch(error=>{console.error(error.stack||error);process.exitCode=1;}).finally(async()=>{
 try{await manager?.dispose();if(main&&!main.isDestroyed())main.destroy();if(directory)await fs.rm(directory,{recursive:true,force:true});}catch(error){process.exitCode=1;console.error(error.stack||error);}
 app.exit(process.exitCode||0);
});
