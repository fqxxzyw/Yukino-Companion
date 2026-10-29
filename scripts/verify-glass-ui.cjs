// Exercise the shipped renderer against a moving synthetic backdrop.
// It proves the application backdrop is displaced at the rim; it does not
// claim to sample the Windows desktop outside the Electron window.
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const root=path.resolve(__dirname,'..');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.on('window-all-closed',()=>{});
app.commandLine.appendSwitch('force-device-scale-factor','1');
app.commandLine.appendSwitch('disable-background-timer-throttling');
async function run(){
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-glass-qa-'));app.setPath('userData',tmp);await app.whenReady();
 const partition=session.fromPartition(`glass-${Date.now()}`);
 partition.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>callback({cancel:true}));
 const win=new BrowserWindow({width:1280,height:840,useContentSize:true,show:true,frame:false,webPreferences:{preload:path.join(__dirname,'ui-capture/preload.cjs'),session:partition,contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
 try{
  await win.loadFile(path.join(root,'dist/index.html'));
  for(let i=0;i<100;i++){if(await win.webContents.executeJavaScript("!!document.querySelector('.setup-dialog [aria-label=\"关闭首次配置\"]')"))break;await sleep(50);}
  await win.webContents.executeJavaScript("document.querySelector('.setup-dialog [aria-label=\"关闭首次配置\"]').click()");await sleep(300);
  await win.webContents.insertCSS('.scene-ui-backdrop{display:none!important}.main{background:repeating-linear-gradient(90deg,#164fae 0 7px,#f5e3b2 7px 14px)!important;background-position-x:0!important}.character-panel{transition:none!important;transform:none!important}');
  const rect=await win.webContents.executeJavaScript("(()=>{const r=document.querySelector('.character-panel').getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)}})()");
  const composerRect=await win.webContents.executeJavaScript("(()=>{const r=document.querySelector('.composer').getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)}})()");
  // Headless Chromium may return an old compositor frame after a style change.
  // Wait for observable pixels, not a fixed delay, before comparing samples.
  const backgroundPixels=image=>{const data=image.toBitmap(),width=image.getSize().width,values=[];for(let y=rect.y+80;y<rect.y+rect.height-80;y+=8)for(let x=rect.x+rect.width+30;x<Math.min(width-20,rect.x+rect.width+80);x+=4){const i=(y*width+x)*4;values.push([data[i],data[i+1],data[i+2]]);}return values;};
  const differences=(left,right)=>left.reduce((count,pixel,i)=>count+(pixel.reduce((sum,value,c)=>sum+Math.abs(value-right[i][c]),0)>18?1:0),0);
  async function waitForFrame(predicate){for(let i=0;i<35;i++){const image=await win.webContents.capturePage();if(predicate(backgroundPixels(image),image))return image;await sleep(150);}throw Error('The test backdrop did not reach a stable compositor frame.');}
  const actual=await waitForFrame(pixels=>pixels.filter(([b,g,r])=>b>120&&r<100&&g<130).length>pixels.length*.2);
  const reference=backgroundPixels(actual);
  const filter=await win.webContents.executeJavaScript("getComputedStyle(document.querySelector('.character-panel'),'::before').backdropFilter");
  const composerFilter=await win.webContents.executeJavaScript("getComputedStyle(document.querySelector('.composer')).backdropFilter");
  const blurOnly=await win.webContents.insertCSS('.character-panel::before{backdrop-filter:blur(4px) saturate(1.16)!important}.composer{backdrop-filter:blur(8px) saturate(1.12)!important}');await sleep(200);
  const originalBitmap=actual.toBitmap(),originalWidth=actual.getSize().width;
  const rimDifference=image=>{const data=image.toBitmap();let changed=0,total=0;for(let y=rect.y+60;y<rect.y+rect.height-60;y+=2)for(let x=rect.x+2;x<rect.x+9;x++){const i=(y*originalWidth+x)*4;total++;if(Math.abs(data[i]-originalBitmap[i])+Math.abs(data[i+1]-originalBitmap[i+1])+Math.abs(data[i+2]-originalBitmap[i+2])>18)changed++;}return changed/total;};
  const blurred=await waitForFrame((pixels,image)=>differences(reference,pixels)<pixels.length*.03&&rimDifference(image)>.04);
  const a=actual.toBitmap(),b=blurred.toBitmap(),width=actual.getSize().width;
  let changed=0,compared=0,backgroundChanged=0,backgroundCompared=0;
  for(let y=rect.y+60;y<rect.y+rect.height-60;y++)for(let x=rect.x+2;x<rect.x+9;x++){
   const offset=(y*width+x)*4;if(offset<0||offset+3>=a.length)continue;compared++;
   if(Math.abs(a[offset]-b[offset])+Math.abs(a[offset+1]-b[offset+1])+Math.abs(a[offset+2]-b[offset+2])>18)changed++;
  }
  for(let y=rect.y+80;y<rect.y+rect.height-80;y+=4)for(let x=rect.x+rect.width+30;x<Math.min(width-20,rect.x+rect.width+80);x+=4){
   const offset=(y*width+x)*4;if(offset<0||offset+3>=a.length)continue;backgroundCompared++;
   if(Math.abs(a[offset]-b[offset])+Math.abs(a[offset+1]-b[offset+1])+Math.abs(a[offset+2]-b[offset+2])>18)backgroundChanged++;
  }
  let composerChanged=0,composerCompared=0;
  for(let y=composerRect.y+4;y<composerRect.y+12;y++)for(let x=composerRect.x+30;x<composerRect.x+composerRect.width-30;x+=2){
   const offset=(y*width+x)*4;if(offset<0||offset+3>=a.length)continue;composerCompared++;
   if(Math.abs(a[offset]-b[offset])+Math.abs(a[offset+1]-b[offset+1])+Math.abs(a[offset+2]-b[offset+2])>3)composerChanged++;
  }
  await win.webContents.removeInsertedCSS(blurOnly);
  await win.webContents.insertCSS('.main{background-position-x:7px!important}');await sleep(200);
  const moved=await waitForFrame(pixels=>differences(reference,pixels)>pixels.length*.5),c=moved.toBitmap();let movedRim=0;
  for(let y=rect.y+60;y<rect.y+rect.height-60;y++)for(let x=rect.x+2;x<rect.x+9;x++){
   const offset=(y*width+x)*4;if(offset<0||offset+3>=a.length)continue;
   if(Math.abs(a[offset]-c[offset])+Math.abs(a[offset+1]-c[offset+1])+Math.abs(a[offset+2]-c[offset+2])>18)movedRim++;
  }
  const output=path.join(root,'build','glass-review');await fs.mkdir(output,{recursive:true});
  await fs.writeFile(path.join(output,'refraction.png'),actual.toPNG());await fs.writeFile(path.join(output,'blur-only.png'),blurred.toPNG());
  await fs.writeFile(path.join(output,'background-moved.png'),moved.toPNG());
  const report={platform:process.platform,electron:process.versions.electron,filter,composerFilter,rect,compared,changed,composerCompared,composerChanged,backgroundCompared,backgroundChanged,movedRim,success:filter.includes('url(')&&composerFilter.includes('url(')&&changed>compared*.04&&composerChanged>composerCompared*.02&&backgroundChanged<backgroundCompared*.03&&movedRim>compared*.1};
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
  if(!report.success)throw Error('The glass rim did not visibly displace the actual application backdrop.');
 }finally{win.destroy();await fs.rm(tmp,{recursive:true,force:true,maxRetries:3,retryDelay:100}).catch(()=>{});}
}
run().then(()=>app.exit(0)).catch(error=>{console.error(error);app.exit(1)});
