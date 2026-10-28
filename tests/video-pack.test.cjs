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
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-video-manager-'));const screen=new EventEmitter(),powerMonitor=new EventEmitter();const area={x:0,y:0,width:4000,height:2200};screen.getPrimaryDisplay=screen.getDisplayNearestPoint=()=>({workArea:area});screen.getCursorScreenPoint=()=>({x:500,y:500});const manager=new CompanionManager({electron:{BrowserWindow:FakeWindow,screen,powerMonitor,ipcMain:{handle(){},removeHandler(){}},app:{quit(){}}},dataDir:dir});await manager.initialize();t.after(async()=>{await manager.dispose();await fs.rm(dir,{recursive:true,force:true});});const event=win=>({sender:win.webContents,senderFrame:win.webContents.mainFrame});return{manager,powerMonitor,event,dir};}

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
 const root=await copiedPack(t);await fs.unlink(path.join(root,'idle.webm'));await fs.symlink(path.join(bundled,'idle.webm'),path.join(root,'idle.webm'));await assert.rejects(verifyVideoPreviewPack(root),/类型或大小/);
 const outside=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-video-link-'));t.after(()=>fs.rm(outside,{recursive:true,force:true}));const link=path.join(outside,'pack');await fs.symlink(bundled,link,'dir');await assert.rejects(verifyVideoPreviewPack(link),/目录不安全/);
});
test('video pack rejects oversized manifests and missing static fallback before registration',async t=>{
 const root=await copiedPack(t),manifest=path.join(root,'manifest.json'),original=await fs.readFile(manifest);await fs.writeFile(manifest,' '.repeat(128*1024+1));await assert.rejects(verifyVideoPreviewPack(root),/清单不可读取/);await fs.writeFile(manifest,original);await fs.unlink(path.join(root,VIDEO_POSTER.src));await assert.rejects(verifyVideoPreviewPack(root));
});
test('video preferences default to original sprite, validate mode and preserve unrelated settings',async t=>{
 assert.equal(DEFAULTS.petRenderer,'sprite');assert.equal(sanitizePreferences({}).petRenderer,'sprite');for(const petRenderer of[true,'video','http://x',null])assert.throws(()=>sanitizePreferences({petRenderer}),/渲染模式/);
 const f=await fixture(t);await f.manager.setMode('pet');await f.manager.viewCall(f.event(f.manager.windows.get('pet')),'prefs',{petRenderer:'video-preview',soundEnabled:false,apiKey:'must-not-persist'});await f.manager.setPreferences({opacity:.7});const saved=JSON.parse(await fs.readFile(path.join(f.dir,'companions.json'),'utf8'));assert.equal(saved.petRenderer,'video-preview');assert.equal(saved.soundEnabled,false);assert.equal(saved.opacity,.7);assert.equal(saved.apiKey,undefined);assert.equal(sanitizePreferences(saved).petRenderer,'video-preview');await f.manager.setPreferences({petRenderer:'sprite'});assert.equal(f.manager.preferences.petRenderer,'sprite');
});
test('video pack IPC is restricted to selected Yukino pet top frame, never model/menu/foreign frames',async t=>{
 const f=await fixture(t);await f.manager.setMode('both');const pet=f.manager.windows.get('pet'),model=f.manager.windows.get('model');await assert.rejects(f.manager.viewCall(f.event(pet),'video-pack'),/已选择/);await f.manager.setPreferences({petRenderer:'video-preview'});assert.equal((await f.manager.viewCall(f.event(pet),'video-pack')).manifest.clips.length,3);await assert.rejects(f.manager.viewCall(f.event(model),'video-pack'),/已选择/);await assert.rejects(f.manager.viewCall({sender:pet.webContents,senderFrame:{}},'video-pack'),/不允许/);await assert.rejects(f.manager.viewCall({sender:{},senderFrame:{}},'video-pack'),/不允许/);f.manager.openMenu('pet');await assert.rejects(f.manager.viewCall(f.event(f.manager.menus.get('pet')),'video-pack'),/不允许/);f.manager.setCharacter({id:'custom',name:'Other'});await assert.rejects(f.manager.viewCall(f.event(pet),'video-pack'),/已选择/);
});
test('video mode cannot receive stale verified pack after selection changes during file IO',async t=>{
 const f=await fixture(t);await f.manager.setMode('pet');await f.manager.setPreferences({petRenderer:'video-preview'});const pending=f.manager.viewCall(f.event(f.manager.windows.get('pet')),'video-pack');await f.manager.setPreferences({petRenderer:'sprite'});await assert.rejects(pending,/选择已改变/);
});
test('video gait uses media time, verified stride and actual bounded viewport scale',async t=>{
 const f=await fixture(t);await f.manager.setMode('pet');await f.manager.setPreferences({petRenderer:'video-preview'});const win=f.manager.windows.get('pet'),event=f.event(win);win.setBounds({x:400,y:400,width:330,height:458});f.manager.walkFraction={x:0,y:0};
 for(let n=0;n<35;n++)assert.equal(await f.manager.viewCall(event,'walk-step',{x:1,y:0,elapsedMs:1000/24,videoPreview:true}),true);
 assert.ok(Math.abs(win.bounds.x-400-VIDEO_GAIT.strideHeightRatio*198)<1);assert.equal(win.bounds.y,400);
 win.setBounds({x:400,y:400,width:330,height:294});f.manager.walkFraction={x:0,y:0};for(let n=0;n<35;n++)await f.manager.viewCall(event,'walk-step',{x:-1,y:0,elapsedMs:1000/24,videoPreview:true});assert.ok(Math.abs(400-win.bounds.x-VIDEO_GAIT.strideHeightRatio*198*.5)<1,'small display uses actual .5 scale, not preferred 1');
 const before=win.bounds.x;await f.manager.viewCall(event,'walk-step',{x:1,y:0,elapsedMs:100000,videoPreview:true});assert.ok(win.bounds.x-before<=6,'suspension media jump is bounded to 100 ms');
});
test('video walking rejects non-media payloads, unreviewed axes and paused/hidden/drag/chat/menu cases',async t=>{
 const f=await fixture(t);await f.manager.setMode('pet');await f.manager.setPreferences({petRenderer:'video-preview'});const win=f.manager.windows.get('pet'),event=f.event(win),step={x:1,y:0,elapsedMs:40,videoPreview:true};
 for(const payload of[1,{x:1,y:0,elapsedMs:40},{...step,x:.5},{...step,y:.3},{...step,elapsedMs:NaN}])assert.equal(await f.manager.viewCall(event,'walk-step',payload),false);
 for(const [set,reset] of[[()=>{win.visible=false;},()=>{win.visible=true;}],[()=>f.manager.pauses.add('lock'),()=>f.manager.pauses.clear()],[()=>{f.manager.drag={kind:'pet'};},()=>{f.manager.drag=null;}],[()=>{f.manager.chatBusy=true;},()=>{f.manager.chatBusy=false;}],[()=>f.manager.openMenu('pet'),()=>f.manager.closeMenu('pet')]]){set();assert.equal(await f.manager.viewCall(event,'walk-step',step),false);reset();}
 await f.manager.setPreferences({petRenderer:'sprite'});assert.equal(await f.manager.viewCall(event,'walk-step',step),false);assert.equal(await f.manager.viewCall(event,'walk-step',{x:1,y:0,elapsedMs:40}),true,'legacy sprite path remains available');
});
test('video unsupported actions fail before opening a pet or changing sound/focus preferences',async t=>{
 const f=await fixture(t);await f.manager.setPreferences({petRenderer:'video-preview'});const previous=structuredClone(f.manager.preferences);for(const action of['greet','head-tilt','jump','sit'])await assert.rejects(f.manager.performAction(action),/仅支持/);assert.equal(f.manager.windows.size,0);assert.deepEqual(f.manager.preferences,previous);await f.manager.performAction('focus-25');assert.ok(f.manager.preferences.focusEnds>Date.now());await f.manager.performAction('focus-cancel');assert.equal(f.manager.preferences.focusEnds,0);
});
test('video playback pause state broadcasts overlapping lock/suspend until both clear',async t=>{
 const f=await fixture(t);await f.manager.setMode('pet');const win=f.manager.windows.get('pet');const last=()=>win.messages.filter(message=>message.channel==='companion-state').at(-1)?.payload;
 f.powerMonitor.emit('lock-screen');assert.equal(last().playbackPaused,true);f.powerMonitor.emit('suspend');f.powerMonitor.emit('resume');assert.equal(last().playbackPaused,true);f.powerMonitor.emit('unlock-screen');assert.equal(last().playbackPaused,false);assert.deepEqual(f.manager.walkFraction,{x:0,y:0});
});
test('video effective mode follows character identity without disabling custom-character sprite behavior',async t=>{
 const f=await fixture(t);await f.manager.setMode('pet');await f.manager.setPreferences({petRenderer:'video-preview'});const win=f.manager.windows.get('pet'),event=f.event(win);
 await assert.rejects(f.manager.performAction('jump'),/仅支持/);
 f.manager.setCharacter({id:'custom',name:'Other'});assert.equal(f.manager.preferences.petRenderer,'video-preview');await f.manager.performAction('jump');assert.equal(await f.manager.viewCall(event,'walk-step',{x:1,y:0,elapsedMs:40}),true);assert.equal(await f.manager.viewCall(event,'walk-step',{x:1,y:0,elapsedMs:40,videoPreview:true}),false);
 f.manager.setCharacter({id:'yukino',name:'雪乃'});assert.deepEqual(f.manager.walkFraction,{x:0,y:0});await assert.rejects(f.manager.performAction('jump'),/仅支持/);assert.equal(await f.manager.viewCall(event,'walk-step',{x:1,y:0,elapsedMs:40}),false);assert.equal(await f.manager.viewCall(event,'walk-step',{x:1,y:0,elapsedMs:40,videoPreview:true}),true);
});
