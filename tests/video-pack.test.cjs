'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {EventEmitter}=require('node:events');
const {fileURLToPath}=require('node:url');
const {verifyVideoPreviewPack,VIDEO_GAIT,VIDEO_FILES,VIDEO_POSTER}=require('../electron/companion-video-pack.cjs');
const {CompanionManager,sanitizePreferences,DEFAULTS}=require('../electron/companions.cjs');
const bundled=path.resolve(__dirname,'../electron/companion-view/video-preview');
async function copiedPack(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-video-pack-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.cp(bundled,root,{recursive:true});return root;}
async function editManifest(root,edit){const file=path.join(root,'manifest.json'),data=JSON.parse(await fs.readFile(file,'utf8'));edit(data);await fs.writeFile(file,JSON.stringify(data));}
class FakeWindow extends EventEmitter {
 constructor(options={}){super();this.bounds={x:400,y:400,width:330,height:458,...options};this.visible=true;this.destroyed=false;this.messages=[];this.webContents=new EventEmitter();this.webContents.mainFrame={};this.webContents.send=(channel,payload)=>this.messages.push({channel,payload});this.webContents.setWindowOpenHandler=()=>{};}
 isDestroyed(){return this.destroyed;}isVisible(){return this.visible;}isMinimized(){return false;}getBounds(){return this.bounds;}setBounds(value){this.bounds=value;}getPosition(){return[this.bounds.x,this.bounds.y];}setPosition(x,y){this.bounds={...this.bounds,x,y};}setIgnoreMouseEvents(){}setAlwaysOnTop(){}loadFile(){return Promise.resolve();}show(){this.visible=true;}showInactive(){this.show();}focus(){}destroy(){this.destroyed=true;this.emit('closed');}
}
async function fixture(t,initial){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-video-manager-'));if(initial)await fs.writeFile(path.join(dir,'companions.json'),JSON.stringify(initial));const screen=new EventEmitter(),powerMonitor=new EventEmitter();const area={x:0,y:0,width:4000,height:2200};screen.getPrimaryDisplay=screen.getDisplayNearestPoint=()=>({workArea:area});screen.getCursorScreenPoint=()=>({x:500,y:500});const manager=new CompanionManager({electron:{BrowserWindow:FakeWindow,screen,powerMonitor,ipcMain:{handle(){},removeHandler(){}},app:{isPackaged:false,quit(){}}},dataDir:dir});await manager.initialize();t.after(async()=>{await manager.dispose();await fs.rm(dir,{recursive:true,force:true});});const event=win=>({sender:win.webContents,senderFrame:win.webContents.mainFrame});return{manager,powerMonitor,event,dir};}

test('video pack actual reviewed files satisfy independent digests, metadata and registered URLs',async()=>{
 const pack=await verifyVideoPreviewPack();assert.equal(pack.manifest.clips.length,3);assert.equal(pack.allowedAssetURLs.length,3);assert.equal(pack.reviewOnly,true);assert.deepEqual(pack.gait,VIDEO_GAIT);assert.equal(pack.characterId,'yukino');
 for(const clip of pack.manifest.clips){assert.equal(path.dirname(fileURLToPath(clip.src)),bundled);assert.equal(path.basename(fileURLToPath(clip.src)),VIDEO_FILES[clip.id].src);assert.ok(pack.allowedAssetURLs.includes(clip.src));assert.deepEqual(clip.motionWindows,[]);}
 assert.equal(path.basename(fileURLToPath(pack.posterURL)),VIDEO_POSTER.src);
});
test('video pack rejects asset tampering even when encoded byte length is unchanged',async t=>{
 const root=await copiedPack(t),file=path.join(root,'idle.webm'),data=await fs.readFile(file);data[data.length-1]^=1;await fs.writeFile(file,data);await assert.rejects(verifyVideoPreviewPack(root),/SHA-256/);
});
test('video pack cannot self-authorize changed asset hashes through its manifest',async t=>{
 const root=await copiedPack(t);await editManifest(root,data=>data.clips[0].sha256='0'.repeat(64));await assert.rejects(verifyVideoPreviewPack(root),/已评审/);
});
test('video pack rejects traversal, remote media, duplicate clips, forged gait and unknown character',async t=>{
 const root=await copiedPack(t),original=await fs.readFile(path.join(root,'manifest.json'));
 const changes=[data=>data.clips[0].src='../idle.webm',data=>data.clips[0].src='https://tracker.invalid/idle.webm',data=>data.staticPoster.src='../idle_decoded_first_frame.png',data=>data.clips[1]=data.clips[0],data=>data.preview.gait.strideHeightRatio=999,data=>data.preview.characterId='someone-else',data=>data.clips[0].fps=60,data=>data.clips[0].anchor.y=0];
 for(const change of changes){await fs.writeFile(path.join(root,'manifest.json'),original);await editManifest(root,change);await assert.rejects(verifyVideoPreviewPack(root),/校验失败/);}
});
test('video pack rejects symlink media and symlink pack roots even when target bytes are correct',async t=>{
 const makeLink=async(...args)=>{try{await fs.symlink(...args);return true}catch(error){if(process.platform==='win32'&&['EPERM','EACCES'].includes(error.code)){t.skip('Windows 当前账户没有创建符号链接的权限');return false}throw error}};
 const root=await copiedPack(t);await fs.unlink(path.join(root,'idle.webm'));if(!await makeLink(path.join(bundled,'idle.webm'),path.join(root,'idle.webm')))return;await assert.rejects(verifyVideoPreviewPack(root),/类型或大小/);
 const outside=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-video-link-'));t.after(()=>fs.rm(outside,{recursive:true,force:true}));const link=path.join(outside,'pack');if(!await makeLink(bundled,link,'dir'))return;await assert.rejects(verifyVideoPreviewPack(link),/目录不安全/);
});
test('video pack rejects oversized manifests and missing static fallback before registration',async t=>{
 const root=await copiedPack(t),manifest=path.join(root,'manifest.json'),original=await fs.readFile(manifest);await fs.writeFile(manifest,' '.repeat(128*1024+1));await assert.rejects(verifyVideoPreviewPack(root),/清单不可读取/);await fs.writeFile(manifest,original);await fs.unlink(path.join(root,VIDEO_POSTER.src));await assert.rejects(verifyVideoPreviewPack(root));
});
test('legacy video preference migrates to sprite without losing unrelated settings',async t=>{
 assert.equal(DEFAULTS.petRenderer,'sprite');assert.equal(sanitizePreferences({}).petRenderer,'sprite');assert.equal(sanitizePreferences({petRenderer:'video-preview',soundEnabled:false}).petRenderer,'sprite');for(const petRenderer of[true,'video','http://x',null])assert.throws(()=>sanitizePreferences({petRenderer}),/渲染模式/);
 const f=await fixture(t);await f.manager.setMode('both');const pet=f.manager.windows.get('pet'),model=f.manager.windows.get('model');await f.manager.viewCall(f.event(pet),'prefs',{petRenderer:'video-preview',soundEnabled:false,apiKey:'must-not-persist'});await f.manager.setPreferences({opacity:.7});const saved=JSON.parse(await fs.readFile(path.join(f.dir,'companions.json'),'utf8'));assert.equal(saved.petRenderer,'sprite');assert.equal(saved.soundEnabled,false);assert.equal(saved.opacity,.7);assert.equal(saved.mode,'both');assert.equal(saved.apiKey,undefined);await assert.rejects(f.manager.viewCall(f.event(pet),'video-pack'),/已选择/);await assert.rejects(f.manager.viewCall(f.event(model),'video-pack'),/已选择/);await f.manager.performAction('jump');assert.equal(f.manager.windows.get('model'),model);
});
test('startup restores both windows from old video preference without overwriting the saved file',async t=>{
 const old={mode:'both',petRenderer:'video-preview',opacity:.7,soundEnabled:false},f=await fixture(t,old);
 assert.equal(f.manager.preferences.petRenderer,'sprite');assert.equal(f.manager.preferences.opacity,.7);assert.deepEqual([...f.manager.windows.keys()].sort(),['model','pet']);assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.dir,'companions.json'),'utf8')),old);
 await f.manager.setPreferences({opacity:.8});const saved=JSON.parse(await fs.readFile(path.join(f.dir,'companions.json'),'utf8'));assert.equal(saved.petRenderer,'sprite');assert.equal(saved.mode,'both');assert.equal(saved.soundEnabled,false);assert.equal(saved.opacity,.8);
});
test('video playback pause state broadcasts overlapping lock/suspend until both clear',async t=>{
 const f=await fixture(t);await f.manager.setMode('pet');const win=f.manager.windows.get('pet');const last=()=>win.messages.filter(message=>message.channel==='companion-state').at(-1)?.payload;
 f.powerMonitor.emit('lock-screen');assert.equal(last().playbackPaused,true);f.powerMonitor.emit('suspend');f.powerMonitor.emit('resume');assert.equal(last().playbackPaused,true);f.powerMonitor.emit('unlock-screen');assert.equal(last().playbackPaused,false);assert.deepEqual(f.manager.walkFraction,{x:0,y:0});
});
