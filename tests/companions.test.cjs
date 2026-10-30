'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { UsageTracker } = require('../electron/usage.cjs');
const { CompanionManager, sanitizePreferences, clampBounds, viewportSize, adjacentMenuBounds } = require('../electron/companions.cjs');
const {covered,clampSubject}=require('../electron/companion-geometry.cjs');

function clock(start = Date.UTC(2026,9,25,10)) {
  let wall = start, mono = 0;
  return { wallNow: () => wall, monotonicNow: () => mono, advance: ms => { wall += ms; mono += ms; }, jumpWall: ms => { wall += ms; } };
}
test('main and any number of companion windows share one usage clock', () => {
  const c = clock(), usage = new UsageTracker(c);
  usage.update({ main: true }); c.advance(1000);
  usage.update({ companion: true }); c.advance(3000);
  usage.update({ main: false }); c.advance(2000);
  const s = usage.snapshot(); assert.equal(s.usageMs,6000); assert.equal(s.companionshipMs,5000);
  usage.update({ companion: false }); c.advance(9000); assert.equal(usage.snapshot().usageMs,6000);
});
test('lock/suspend pause elapsed time and a missed long suspension is not counted', () => {
  const c = clock(), usage = new UsageTracker(c); usage.update({ companion: true }); c.advance(1000);
  usage.update({ paused: true }); c.advance(600000); usage.update({ paused: false }); c.advance(2000);
  assert.equal(usage.snapshot().usageMs,3000);
  c.advance(3600000); assert.equal(usage.snapshot().usageMs,3000);
  c.advance(500); assert.equal(usage.snapshot().usageMs,3500);
});
test('normal elapsed time is allocated across local midnight', () => {
  const start = new Date(2026,9,25,23,59,30).getTime();
  const c = clock(start), usage = new UsageTracker(c); usage.update({ main: true }); c.advance(60000);
  const s = usage.snapshot(); assert.equal(s.days['2026-10-25'].usageMs,30000); assert.equal(s.days['2026-10-26'].usageMs,30000);
});
test('system clock changes never inflate or reverse elapsed usage', () => {
  const c = clock(), usage = new UsageTracker(c); usage.update({ main: true }); c.advance(1000); c.jumpWall(86400000);
  assert.equal(usage.snapshot().usageMs,1000); c.advance(1000); c.jumpWall(-172800000); assert.equal(usage.snapshot().usageMs,2000);
});
test('usage saves atomically, survives restart, and session time starts fresh', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'yukino-usage-')); t.after(() => fs.rm(dir,{ recursive:true,force:true }));
  const c = clock(), file = path.join(dir,'usage.json'), usage = new UsageTracker({ ...c,file });
  await usage.load(); usage.update({ main: true }); c.advance(1700); await Promise.all([usage.save(),usage.save()]);
  const restart = new UsageTracker({ ...c,file }); await restart.load(); assert.equal(restart.snapshot().usageMs,1700); assert.equal(restart.snapshot().session.usageMs,0);
  assert.deepEqual((await fs.readdir(dir)),['usage.json']);
});
test('corrupt usage is reported without replacing user history', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'yukino-usage-')); t.after(() => fs.rm(dir,{ recursive:true,force:true }));
  const file = path.join(dir,'usage.json'); await fs.writeFile(file,'not-json');
  await assert.rejects(new UsageTracker({ file }).load(),/读取失败/); assert.equal(await fs.readFile(file,'utf8'),'not-json');
});
test('preferences validate modes, close decisions, language and bounded scale', () => {
  assert.equal(sanitizePreferences().closeAction,'ask');
  assert.equal(sanitizePreferences({ closeAction:'both',mode:'pet',bubbleLanguage:'ja' }).bubbleLanguage,'ja');
  assert.throws(() => sanitizePreferences({ mode:'http://example.org' }));
  assert.throws(() => sanitizePreferences({ closeAction:'none' }));
  assert.throws(() => sanitizePreferences({ scale:100 }));
  assert.equal(sanitizePreferences().mouseThrough,false);
  assert.throws(() => sanitizePreferences({mouseThrough:'true'}));
  assert.deepEqual(clampBounds({ x:-900,y:2000,width:330,height:410 },{ x:0,y:0,width:1920,height:1040 }),{ x:0,y:630,width:330,height:410 });
});
test('proactive greeting shares desktop delivery and cancels stale generation when chat starts',async t=>{
 const f=await fixture(t);f.powerMonitor.getSystemIdleTime=()=>0;await f.manager.setMode('both');
 const config={...f.manager.preferences.proactive,enabled:true,mode:'generate',intervalMinutes:5,startHour:0,endHour:0,prompt:'聊聊音乐'};
 await f.manager.setPreferences({proactive:config});let resolve;f.manager.onProactive=(_event,{signal})=>new Promise(done=>{resolve=done;assert.equal(signal.aborted,false)});
 const active=f.manager.deliverProactive({id:'pending',mode:'generate',prompt:'聊聊音乐'});f.manager.setChatBusy(true);resolve({zh:'迟到的消息'});await active;assert.equal(f.manager.reply,null);
 f.manager.setChatBusy(false);const spoken=[];f.manager.onReminder=e=>spoken.push(e.text);f.manager.onProactive=async()=>({zh:'今天听了什么？'});
 await f.manager.deliverProactive({id:'next',mode:'generate',prompt:'聊聊音乐'});assert.equal(f.manager.reply.zh,'今天听了什么？');assert.deepEqual(spoken,['今天听了什么？']);
});
test('proactive generation cannot display after a visual session begins or every companion is hidden',async t=>{
 const f=await fixture(t);f.powerMonitor.getSystemIdleTime=()=>0;await f.manager.setMode('pet');await f.manager.setPreferences({proactive:{...f.manager.preferences.proactive,enabled:true,mode:'generate',startHour:0,endHour:0}});
 let resolve;f.manager.onProactive=()=>new Promise(done=>{resolve=done});let run=f.manager.deliverProactive({id:'vision',mode:'generate',prompt:'问候'});f.manager.setVisionActive(true);resolve({zh:'不应显示'});await run;assert.equal(f.manager.reply,null);
 f.manager.setVisionActive(false);run=f.manager.deliverProactive({id:'hidden',mode:'generate',prompt:'问候'});f.manager.windows.get('pet').hide();resolve({zh:'也不应显示'});await run;assert.equal(f.manager.reply,null);assert.equal(f.manager.proactiveStatus.phase,'idle');
});
test('mouse-through preference persists and hit tests cannot break an active drag',async t=>{
 const f=await fixture(t);await f.manager.setMode('pet');const win=f.manager.windows.get('pet');
 const event={sender:win.webContents,senderFrame:win.webContents.mainFrame},calls=[];
 win.setIgnoreMouseEvents=(ignored,opts)=>calls.push({ignored,opts});
 await f.manager.viewCall(event,'prefs',{mouseThrough:true});
 assert.equal(f.manager.getState().mouseThrough,true);
 assert.equal(JSON.parse(await fs.readFile(path.join(f.manager.dataDir,'companions.json'),'utf8')).mouseThrough,true);
 await f.manager.viewCall(event,'hit-test',false);assert.deepEqual(calls.at(-1),{ignored:true,opts:{forward:true}});
 await f.manager.viewCall(event,'drag-start');assert.equal(calls.at(-1).ignored,false);
 const count=calls.length;await f.manager.viewCall(event,'hit-test',false);assert.equal(calls.length,count);
 await f.manager.viewCall(event,'drag-end');await f.manager.viewCall(event,'hit-test',true);assert.equal(calls.at(-1).ignored,false);
 await assert.rejects(f.manager.viewCall(event,'hit-test','false'),/命中/);
});
class FakeWindow extends EventEmitter {
  constructor(opts = {}) { super(); this.bounds = { x:opts.x??0,y:opts.y??0,width:opts.width??330,height:opts.height??410 }; this.visible = true; this.destroyed = false; this.webContents = new EventEmitter(); this.webContents.mainFrame = {}; this.webContents.send = () => {}; this.webContents.setWindowOpenHandler = () => {}; }
  isDestroyed() { return this.destroyed; } isVisible() { return this.visible; } isMinimized() { return false; }
  show() { this.visible=true; this.emit('show'); } showInactive() { this.show(); } hide() { this.visible=false; this.emit('hide'); }
  restore() {} focus() {} setAlwaysOnTop() {} setIgnoreMouseEvents() {}
  loadFile(file) { this.loadedFile=file;return Promise.resolve(); } getBounds() { return this.bounds; } setBounds(v) { this.bounds=v; } setPosition(x,y) { this.bounds={...this.bounds,x,y}; } getPosition() { return [this.bounds.x,this.bounds.y]; }
  destroy() { this.destroyed=true; this.emit('closed'); }
}
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'yukino-companion-'));
  const screen = new EventEmitter(), powerMonitor = new EventEmitter(), handlers = new Map();
  const workArea = { x:0,y:0,width:1920,height:1040 };
  screen.getPrimaryDisplay = screen.getDisplayNearestPoint = () => ({ workArea }); screen.getCursorScreenPoint = () => ({ x:800,y:800 });
  let requested = 0, quit = 0;
  const manager = new CompanionManager({ electron:{ BrowserWindow:FakeWindow,screen,powerMonitor,ipcMain:{ handle:(k,v)=>handlers.set(k,v),removeHandler:k=>handlers.delete(k) },app:{ quit:()=>quit++ } },dataDir:dir,onCloseRequested:()=>requested++,onQuit:()=>quit++ });
  await manager.initialize(); t.after(async () => { await manager.dispose(); await fs.rm(dir,{ recursive:true,force:true }); });
  const main = new FakeWindow(); manager.attachMainWindow(main);
  return { manager,main,screen,workArea,powerMonitor,handlers,requested:()=>requested,quit:()=>quit };
}
test('closing asks first, then pet/both selection hides main and persists', async t => {
  const f = await fixture(t); let prevented = false;
  f.main.emit('close',{ preventDefault:()=>prevented=true }); assert.equal(prevented,true); assert.equal(f.requested(),1); assert.equal(f.main.visible,true);
  await f.manager.closeChoice('both'); assert.equal(f.main.visible,false); assert.deepEqual(f.manager.getState().active,['model','pet']);
  await f.manager.updatePrefs({ closeAction:'pet' }); f.main.show(); f.main.emit('close',{ preventDefault(){} });
  assert.equal(f.main.visible,false); assert.deepEqual(f.manager.getState().active,['pet']); assert.equal(f.manager.getState().closeAction,'pet');
});
test('quit choice exits instead of silently keeping a companion alive', async t => {
  const f = await fixture(t); await f.manager.setMode('both'); await f.manager.closeChoice('quit'); assert.equal(f.quit(),1); assert.equal(f.manager.quitting,true);
});
test('companion IPC rejects foreign or nested frames', async t => {
  const f = await fixture(t); await f.manager.setMode('pet'); const win = f.manager.windows.get('pet');
  await assert.rejects(f.manager.viewCall({ sender:{},senderFrame:{} },'open-main'),/不允许/);
  await assert.rejects(f.manager.viewCall({ sender:win.webContents,senderFrame:{} },'open-main'),/不允许/);
  assert.equal(await f.manager.viewCall({ sender:win.webContents,senderFrame:win.webContents.mainFrame },'ready'),true);
});
test('overlapping sleep and screen lock require both to clear before resuming', async t => {
  const f = await fixture(t); f.powerMonitor.emit('lock-screen'); f.powerMonitor.emit('suspend');
  f.powerMonitor.emit('resume'); assert.equal(f.manager.usage.active.paused,true);
  f.powerMonitor.emit('unlock-screen'); assert.equal(f.manager.usage.active.paused,false);
});

test('all original pet preferences persist without overriding unrelated preferences', async t=>{
  const f=await fixture(t);
  const patch={scale:.6,opacity:.35,animation:false,interactionPaused:true,quietMode:true,randomQuotes:false,interactionQuotes:false,nightReminders:false,showBubbles:false,soundEnabled:false,soundVolume:0,alwaysOnTop:false};
  await f.manager.setPreferences(patch);
  const saved=JSON.parse(await fs.readFile(path.join(f.manager.dataDir,'companions.json'),'utf8'));
  for(const [key,value]of Object.entries(patch))assert.equal(saved[key],value,key);
  await f.manager.setPreferences({opacity:1,soundVolume:.75});
  assert.equal(f.manager.preferences.randomQuotes,false);assert.equal(f.manager.preferences.interactionPaused,true);
  for(const invalid of [{opacity:0},{opacity:1.1},{soundVolume:NaN},{soundVolume:-1},{scale:.59}])assert.throws(()=>sanitizePreferences(invalid));
});
test('close remembers the selected behavior only when requested', async t=>{
  const f=await fixture(t);await f.manager.closeChoice('pet');assert.equal(f.manager.preferences.closeAction,'ask');
  f.main.show();await f.manager.closeChoice('both',{remember:true});assert.equal(f.manager.preferences.closeAction,'both');
  f.main.show();f.main.emit('close',{preventDefault(){}});assert.equal(f.main.visible,false);assert.equal(f.requested(),0);
});
test('focus starts, persists, completes once and cancels without an API',async t=>{
  const f=await fixture(t);await f.manager.setMode('pet');const events=[];f.manager.windows.get('pet').webContents.send=(channel,data)=>events.push({channel,data});
  const before=Date.now();await f.manager.performAction('focus-25');assert.ok(f.manager.preferences.focusEnds>=before+25*60000);assert.equal(f.manager.getState().focus.active,true);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.manager.dataDir,'companions.json'),'utf8')).focusEnds,f.manager.preferences.focusEnds);
  f.manager.preferences.focusEnds=Date.now()-1;f.manager.tickFocus();f.manager.tickFocus();assert.equal(events.filter(x=>x.data.name==='focus-complete').length,1);assert.equal(f.manager.getState().focus.active,false);
  await f.manager.performAction('focus-50');await f.manager.performAction('focus-cancel');assert.equal(f.manager.preferences.focusEnds,0);
});
test('pet actions create the pet alongside a model and preview enables only pet sound',async t=>{
  const f=await fixture(t);await f.manager.setMode('model');await f.manager.setPreferences({soundEnabled:false});
  await f.manager.performAction('greet');assert.equal(f.manager.preferences.mode,'both');
  const events=[];f.manager.windows.get('pet').webContents.send=(channel,data)=>events.push({channel,data});
  await f.manager.performAction('voice');assert.equal(f.manager.preferences.soundEnabled,true);assert.ok(events.some(x=>x.data.name==='voice'));
  await assert.rejects(f.manager.performAction('execute-shell'),/未知/);
});
test('custom pet menu uses renderer events and cannot mutate close behavior through view prefs',async t=>{
  const f=await fixture(t);await f.manager.setMode('pet');const win=f.manager.windows.get('pet'),event={sender:win.webContents,senderFrame:win.webContents.mainFrame},events=[];win.webContents.send=(channel,data)=>events.push({channel,data});
  await f.manager.viewCall(event,'menu');assert.ok(f.manager.menus.has('pet'));assert.ok(events.some(item=>item.data.name==='menu-opened'));await f.manager.viewCall({sender:f.manager.menus.get('pet').webContents,senderFrame:f.manager.menus.get('pet').webContents.mainFrame},'menu-close');
  await f.manager.viewCall(event,'prefs',{closeAction:'quit',soundVolume:.5});assert.equal(f.manager.preferences.closeAction,'ask');assert.equal(f.manager.preferences.soundVolume,.5);
  await assert.rejects(f.manager.viewCall({sender:win.webContents,senderFrame:{}},'action','voice'),/不允许/);
  await assert.rejects(f.manager.viewCall({sender:win.webContents,senderFrame:{}},'catalog'),/不允许/);
});
test('walking obeys interaction, quiet and focus settings and moves both axes only within desktop',async t=>{
  const f=await fixture(t);await f.manager.setMode('pet');const win=f.manager.windows.get('pet'),event={sender:win.webContents,senderFrame:win.webContents.mainFrame};win.setBounds({x:500,y:500,width:330,height:410});
  assert.equal(await f.manager.viewCall(event,'walk-step',{x:-1,y:-1}),true);assert.equal(win.bounds.x,497);assert.equal(win.bounds.y,497);
  for(const patch of [{interactionPaused:true},{interactionPaused:false,quietMode:true},{quietMode:false,focusEnds:Date.now()+60000}]){await f.manager.setPreferences(patch);assert.equal(await f.manager.viewCall(event,'walk-step',1),false);}
  await f.manager.setPreferences({focusEnds:0});assert.equal(await f.manager.viewCall(event,'walk-step',{x:100,y:0}),false);
});
test('quote settings suppress matching sources while independent categories stay available',async t=>{
  const f=await fixture(t);await f.manager.setPreferences({interactionQuotes:false,randomQuotes:false,nightReminders:false});
  for(const trigger of ['Click','HeadPat','Mouse','Idle','Observation','Affection','Night'])assert.equal(f.manager.pickQuote(trigger),null,trigger);
  assert.ok(f.manager.pickQuote('Work'));
  await f.manager.setPreferences({quietMode:true});assert.equal(f.manager.pickQuote('Break'),null);
});

test('downloaded pet voices are hot-loaded and only catalogued audio may be requested',async t=>{
 const f=await fixture(t),root=path.join(f.manager.dataDir,'downloaded-pet');
 await fs.mkdir(path.join(root,'voices'),{recursive:true});await fs.writeFile(path.join(root,'voices','greeting.ogg'),'sound');
 await fs.writeFile(path.join(root,'voices.json'),JSON.stringify({files:[{file:'greeting.ogg',bytes:5}]}));
 await f.manager.setResourceRoot(root);assert.equal(f.manager.getState().voiceCount,1);
 assert.match(await f.manager.voiceUrl('greeting.ogg'),/^file:/);
 await assert.rejects(f.manager.voiceUrl('../secret.ogg'),/无效/);await assert.rejects(f.manager.voiceUrl('secret.ogg'),/尚未准备/);
 await fs.writeFile(path.join(root,'voices','greeting.ogg'),'truncated audio');await assert.rejects(f.manager.voiceUrl('greeting.ogg'),/不完整/);
});
test('downloaded voice catalog rejects path escapes and duplicate names before replacing the active pack',async t=>{
 const f=await fixture(t),root=path.join(f.manager.dataDir,'invalid-pet');await fs.mkdir(root);
 for(const files of [[{file:'../hidden.ogg'}],[{file:'voice.ogg'},{file:'VOICE.ogg'}]]){await fs.writeFile(path.join(root,'voices.json'),JSON.stringify({files}));await assert.rejects(f.manager.setResourceRoot(root),/文件名/);}
});

test('repeated drag keeps canonical dimensions and full movement range; cancellation ends movement',async t=>{
 const f=await fixture(t);await f.manager.setMode('pet');const win=f.manager.windows.get('pet'),event={sender:win.webContents,senderFrame:win.webContents.mainFrame};
 let cursor={x:100,y:100};f.screen.getCursorScreenPoint=()=>cursor;
 const dimensions={width:win.bounds.width,height:win.bounds.height};
 let positionCalls=0,resizeCalls=0;const position=win.setPosition.bind(win),resize=win.setBounds.bind(win);win.setPosition=(...args)=>{positionCalls++;position(...args);};win.setBounds=(...args)=>{resizeCalls++;resize(...args);};
 for(let i=0;i<40;i++){
  cursor={x:100,y:100};await f.manager.viewCall(event,'drag-start');cursor={x:i%2?10000:-10000,y:i%2?10000:-10000};await f.manager.viewCall(event,'drag-move');await f.manager.viewCall(event,i%3?'drag-end':'drag-cancel');
  assert.equal(win.bounds.width,dimensions.width);assert.equal(win.bounds.height,dimensions.height);
  assert.equal(win.bounds.x,i%2?f.workArea.width-dimensions.width:0);assert.equal(win.bounds.y,i%2?f.workArea.height-dimensions.height:0);
 }
 assert.equal(positionCalls,40);assert.equal(resizeCalls,0);
 const before={...win.bounds};cursor={x:0,y:0};assert.equal(await f.manager.viewCall(event,'drag-move'),false);assert.deepEqual(win.bounds,before);
});

test('drag constrains the visible pet instead of its transparent margins and preserves its actual release position',async t=>{
 const f=await fixture(t);await f.manager.setMode('pet');const win=f.manager.windows.get('pet'),event={sender:win.webContents,senderFrame:win.webContents.mainFrame};
 const body={x:.2,y:.3,width:.6,height:.5};let cursor={x:0,y:0};f.screen.getCursorScreenPoint=()=>cursor;
 await f.manager.viewCall(event,'drag-start',{body});cursor={x:-10000,y:-10000};await f.manager.viewCall(event,'drag-move');
 const atEdge={...win.bounds};assert.ok(atEdge.x<0);assert.ok(atEdge.y<0);
 assert.ok(Math.abs(atEdge.x+body.x*atEdge.width)<=.5);assert.ok(Math.abs(atEdge.y+body.y*atEdge.height)<=.5);
 await f.manager.setPreferences({soundVolume:.5});assert.deepEqual(win.bounds,atEdge,'unrelated settings do not interrupt drag');
 await f.manager.viewCall(event,'drag-end');assert.deepEqual(win.bounds,atEdge,'release does not reposition the pet');
 assert.deepEqual(f.manager.preferences.positions.pet,{x:atEdge.x,y:atEdge.y,body});assert.deepEqual(f.manager.boundsFor('pet'),atEdge);
});
test('release flushes the last drag even when no queued move reached the main process',async t=>{
 const f=await fixture(t);await f.manager.setMode('both');
 let cursor={x:100,y:100};f.screen.getCursorScreenPoint=()=>cursor;
 for(const kind of ['pet','model']){
  const win=f.manager.windows.get(kind),event={sender:win.webContents,senderFrame:win.webContents.mainFrame};
  win.setPosition(400,200);const start={...win.bounds};cursor={x:100,y:100};
  await f.manager.viewCall(event,'drag-start',{point:{x:100,y:100}});cursor={x:600,y:500};
  await f.manager.viewCall(event,'drag-end',{moved:true,point:{x:185,y:140}});
  assert.deepEqual(win.bounds,{...start,x:start.x+85,y:start.y+40},kind);
  assert.equal(await f.manager.viewCall(event,'drag-move'),false);
  assert.deepEqual(f.manager.preferences.positions[kind],{x:start.x+85,y:start.y+40});
 }
});
test('release clamps the visible figure, while clicks and cancellation do not move to the cursor',async t=>{
 const f=await fixture(t);await f.manager.setMode('pet');const win=f.manager.windows.get('pet'),event={sender:win.webContents,senderFrame:win.webContents.mainFrame};
 const body={x:.2,y:.3,width:.6,height:.5};let cursor={x:0,y:0};f.screen.getCursorScreenPoint=()=>cursor;win.setPosition(400,200);
 const start={...win.bounds};await f.manager.viewCall(event,'drag-start',{body});cursor={x:200,y:100};await f.manager.viewCall(event,'drag-end',{moved:false});assert.deepEqual(win.bounds,start);
 cursor={x:0,y:0};await f.manager.viewCall(event,'drag-start',{body});cursor={x:100,y:50};await f.manager.viewCall(event,'drag-move');const beforeCancel={...win.bounds};cursor={x:-10000,y:-10000};await f.manager.viewCall(event,'drag-cancel',{moved:true});assert.deepEqual(win.bounds,beforeCancel);
 cursor={x:0,y:0};await f.manager.viewCall(event,'drag-start',{body});cursor={x:-10000,y:-10000};await f.manager.viewCall(event,'drag-end',{moved:true});
 assert.ok(Math.abs(win.bounds.x+body.x*win.bounds.width)<=.5);assert.ok(Math.abs(win.bounds.y+body.y*win.bounds.height)<=.5);
});
test('walking after an edge drag never jumps opposite the chosen gait or forgets visible-body bounds',async t=>{
 const f=await fixture(t);await f.manager.setMode('pet');
 const win=f.manager.windows.get('pet'),event={sender:win.webContents,senderFrame:win.webContents.mainFrame};
 const body={x:.2,y:.3,width:.6,height:.5};let cursor={x:0,y:0};f.screen.getCursorScreenPoint=()=>cursor;
 await f.manager.viewCall(event,'drag-start',{body});cursor={x:-10000,y:0};await f.manager.viewCall(event,'drag-move');await f.manager.viewCall(event,'drag-end');
 const left=win.bounds.x;assert.ok(left<0);
 assert.equal(await f.manager.viewCall(event,'walk-step',{x:-1,y:0,elapsedMs:100}),false);
 assert.equal(win.bounds.x,left,'left gait at the edge must not jump right');
 assert.equal(await f.manager.viewCall(event,'walk-step',{x:1,y:0,elapsedMs:100}),true);
 assert.equal(win.bounds.x,left+3);assert.deepEqual(f.manager.preferences.positions.pet.body,body);
 await f.manager.viewCall(event,'drag-start',{body});cursor={x:10000,y:0};await f.manager.viewCall(event,'drag-move');await f.manager.viewCall(event,'drag-end');
 const right=win.bounds.x;assert.ok(right+win.bounds.width>f.workArea.width);
 assert.equal(await f.manager.viewCall(event,'walk-step',{x:1,y:0,elapsedMs:100}),false);
 assert.equal(win.bounds.x,right,'right gait at the edge must not jump left');
 assert.equal(await f.manager.viewCall(event,'walk-step',{x:-1,y:0,elapsedMs:100}),true);
 assert.equal(win.bounds.x,right-3);assert.deepEqual(f.manager.preferences.positions.pet.body,body);
});
test('walking with stale window geometry stops instead of teleporting to a work-area edge',async t=>{
 const f=await fixture(t);await f.manager.setMode('pet');const win=f.manager.windows.get('pet'),event={sender:win.webContents,senderFrame:win.webContents.mainFrame};
 win.setPosition(-90,100);f.manager.preferences.positions.pet={x:-90,y:100};
 for(const direction of [-1,1]){assert.equal(await f.manager.viewCall(event,'walk-step',{x:direction,y:0,elapsedMs:100}),false);assert.equal(win.bounds.x,-90);}
});
test('Windows move-induced window size drift is corrected without resizing normal moves',async t=>{
 const f=await fixture(t);await f.manager.setMode('model');const win=f.manager.windows.get('model'),event={sender:win.webContents,senderFrame:win.webContents.mainFrame};let cursor={x:20,y:20};f.screen.getCursorScreenPoint=()=>cursor;const original={...win.bounds};
 const move=win.setPosition.bind(win);win.setPosition=(x,y)=>{move(x,y);win.bounds.width+=9;win.bounds.height+=5;};
 await f.manager.viewCall(event,'drag-start');cursor={x:80,y:75};await f.manager.viewCall(event,'drag-move');assert.equal(win.bounds.width,original.width);assert.equal(win.bounds.height,original.height);
 await f.manager.viewCall(event,'drag-end');assert.equal(win.bounds.width,original.width);assert.equal(win.bounds.height,original.height);
});

test('visible drag bounds can cross an adjacent monitor seam but avoid gaps',()=>{
 const areas=[{x:0,y:0,width:100,height:100},{x:100,y:0,width:100,height:100}],body={x:.2,y:.2,width:.6,height:.6};
 assert.equal(covered({x:80,y:20,width:40,height:40},areas),true);
 const seam={x:70,y:0,width:100,height:100};assert.deepEqual(clampSubject(seam,body,areas),seam);
 const gap=[areas[0],{x:120,y:0,width:100,height:100}];assert.equal(covered({x:80,y:20,width:40,height:40},gap),false);
 const fixed=clampSubject(seam,body,gap);assert.equal(covered({x:fixed.x+20,y:fixed.y+20,width:60,height:60},gap),true);
 assert.equal(clampSubject(seam,{x:-1,y:0,width:2,height:1},areas),null);
});

test('elapsed-time walking has equivalent speed at 10 and 60 updates per second',async t=>{
 const f=await fixture(t);await f.manager.setMode('pet');const win=f.manager.windows.get('pet'),event={sender:win.webContents,senderFrame:win.webContents.mainFrame};
 async function distance(count,elapsedMs){win.setPosition(400,400);f.manager.walkFraction={x:0,y:0};for(let n=0;n<count;n++)await f.manager.viewCall(event,'walk-step',{x:1,y:-.5,elapsedMs});return {x:win.bounds.x-400,y:win.bounds.y-400};}
 const slow=await distance(10,100),fast=await distance(60,1000/60);assert.ok(Math.abs(slow.x-fast.x)<=1);assert.ok(Math.abs(slow.y-fast.y)<=1);assert.equal(slow.x,30);
 const before=win.bounds.x;await f.manager.viewCall(event,'walk-step',{x:1,y:0,elapsedMs:100000});assert.ok(win.bounds.x-before<=3,'suspended frames do not teleport');
});

test('settings uses one adjacent window and cannot cover or resize the pet',async t=>{
 const f=await fixture(t);await f.manager.setMode('pet');const owner=f.manager.windows.get('pet'),before={...owner.bounds};
 assert.equal(f.manager.openMenu('pet'),true);const popup=f.manager.menus.get('pet');assert.ok(popup);assert.deepEqual(owner.bounds,before);
 const b=popup.bounds;assert.ok(b.x+b.width<=before.x||b.x>=before.x+before.width||b.y+b.height<=before.y||b.y>=before.y+before.height);
 assert.equal(f.manager.openMenu('pet'),true);assert.equal(f.manager.menus.get('pet'),popup);
 const event={sender:popup.webContents,senderFrame:popup.webContents.mainFrame};await assert.rejects(f.manager.viewCall(event,'drag-start'),/不允许/);await assert.rejects(f.manager.viewCall(event,'chat-submit','hidden'),/不允许/);
 await f.manager.viewCall(event,'prefs',{inputPosition:'above'});assert.equal(f.manager.preferences.inputPosition,'above');
 await f.manager.viewCall(event,'menu-close');assert.equal(f.manager.menus.size,0);assert.equal(popup.destroyed,true);assert.deepEqual(owner.bounds,before);
});

test('small desktops use bounded canonical viewports and avoid overlapping popup fallback',async t=>{
 assert.deepEqual(viewportSize('pet',2,{width:320,height:240}),{width:320,height:240});
 assert.equal(adjacentMenuBounds({x:0,y:0,width:320,height:240},{x:0,y:0,width:320,height:240}),null);
 const f=await fixture(t);Object.assign(f.workArea,{width:320,height:240});await f.manager.setMode('pet');let opened=0;f.manager.onOpenSettings=pane=>{assert.equal(pane,'avatar');opened++;};
 assert.equal(f.manager.openMenu('pet'),false);assert.equal(opened,1);assert.equal(f.manager.menus.size,0);assert.equal(f.manager.windows.get('pet').bounds.width,320);
});

test('single-line pet chat shares busy lock, validates input and delegates stop without hidden vision',async t=>{
 const f=await fixture(t);await f.manager.setMode('pet');const win=f.manager.windows.get('pet'),event={sender:win.webContents,senderFrame:win.webContents.mainFrame},texts=[];let stop=0,vision=0;
 f.manager.onChat=async text=>{texts.push(text);return true;};f.manager.onChatStop=()=>stop++;f.manager.onVision=()=>vision++;
 for(const value of ['',null,'a\nb','x'.repeat(24001)])await assert.rejects(f.manager.viewCall(event,'chat-submit',value),/单行/);
 assert.equal(vision,0);await f.manager.viewCall(event,'chat-submit','  你好  ');assert.deepEqual(texts,['你好']);assert.equal(f.manager.chatBusy,true);
 await assert.rejects(f.manager.viewCall(event,'chat-submit','重复点击'),/正在回复/);assert.equal(texts.length,1);await f.manager.viewCall(event,'chat-stop');assert.equal(stop,1);
 f.manager.setChatBusy(false);f.manager.onChat=async()=>{throw Error('route unavailable');};await assert.rejects(f.manager.viewCall(event,'chat-submit','test'),/route unavailable/);assert.equal(f.manager.chatBusy,false);
 f.manager.onChat=async()=>false;await assert.rejects(f.manager.viewCall(event,'chat-submit','test'),/尚未准备/);assert.equal(f.manager.chatBusy,false);
 await f.manager.viewCall(event,'vision-open');assert.equal(vision,1,'only explicit camera action opens consent UI');
});

test('model companion loads real renderer and restricts model bytes to selected model identity',async t=>{
 const f=await fixture(t);let fetched=[];f.manager.onModelData=async id=>{fetched.push(id);return {bytes:new Uint8Array([1,2,3])};};
 f.manager.setCharacter({id:'custom',name:'测试角色',modelId:'yukino-02',persona:'private persona'});await f.manager.setMode('both');
 const model=f.manager.windows.get('model'),pet=f.manager.windows.get('pet'),event={sender:model.webContents,senderFrame:model.webContents.mainFrame};
 assert.match(model.loadedFile,/dist[/\\]model-window\.html$/);assert.match(pet.loadedFile,/companion-view[/\\]index\.html$/);
 assert.deepEqual(await f.manager.viewCall(event,'model-character'),{id:'custom',name:'测试角色',modelId:'yukino-02'});assert.equal(f.manager.getState().modelReady,true);
 const result=await f.manager.viewCall(event,'model-data','yukino-02');assert.deepEqual([...result.bytes],[1,2,3]);assert.deepEqual(fetched,['yukino-02']);
 await assert.rejects(f.manager.viewCall(event,'model-data','../../private'),/当前人物/);await assert.rejects(f.manager.viewCall({sender:pet.webContents,senderFrame:pet.webContents.mainFrame},'model-data','yukino-02'),/仅人物/);
 f.manager.setCharacter({id:'plain',name:'无模型'});assert.equal(f.manager.getState().modelReady,false);await assert.rejects(f.manager.viewCall(event,'model-data'),/当前人物/);
});

test('location-based daylight reaches the companion and invalid coordinates fall back',async t=>{
 const f=await fixture(t);await f.manager.setMode('model');
 const win=f.manager.windows.get('model');
 f.manager.setCharacter({id:'yukino',presentation:{scene:'beach',renderStyle:'lit',daylightLocation:{latitude:35.6895,longitude:139.6917}}});
 assert.deepEqual(f.manager.getState().character.presentation.daylightLocation,{latitude:35.6895,longitude:139.6917});
 f.manager.setCharacter({id:'yukino',presentation:{scene:'beach',daylightLocation:{latitude:91,longitude:0}}});
 assert.equal(f.manager.getState().character.presentation.daylightLocation,null);
 assert.ok(win,'model window is active for state broadcasts');
});

test('changing character identity clears the prior bubble and resets model mouth before publishing new state',async t=>{
 const f=await fixture(t);await f.manager.setMode('both');f.manager.openMenu('pet');
 const delivered=[];
 for(const [kind,win] of [...f.manager.windows,...f.manager.menus])win.webContents.send=(channel,payload)=>delivered.push({kind,channel,payload});
 f.manager.showReply({id:'old-reply',zh:'属于旧角色的回复',ja:'以前の返事です。'});f.manager.setMouthLevel(.25);delivered.length=0;
 f.manager.setCharacter({id:'new-character',name:'新角色',modelId:'new-model'});
 assert.equal(f.manager.reply,null);
 assert.equal(delivered[0].channel,'companion-mouth');assert.equal(delivered[0].payload,0);
 const states=delivered.filter(item=>item.channel==='companion-state');assert.equal(states.length,3);
 for(const {payload} of states){assert.equal(payload.character.id,'new-character');assert.equal(payload.reply,null);}
 assert.equal(JSON.stringify(states).includes('属于旧角色的回复'),false);
});

test('desktop replies preserve long bilingual text instead of silently truncating it',async t=>{
 const f=await fixture(t);await f.manager.setMode('both');const zh='完整中文🙂'.repeat(500),ja='日本語の本文。'.repeat(500);
 f.manager.showReply({id:'long',zh,ja});assert.equal(f.manager.reply.zh,zh);assert.equal(f.manager.reply.ja,ja);
});
test('same character wardrobe and display-name changes keep its reply and do not reset mouth',async t=>{
 const f=await fixture(t);await f.manager.setMode('both');
 f.manager.setCharacter({id:'same-character',name:'角色',modelId:'outfit-one'});
 f.manager.showReply({id:'kept-reply',zh:'当前角色的回复',ja:'同じ人物の返事です。'});
 const delivered=[];for(const [kind,win] of f.manager.windows)win.webContents.send=(channel,payload)=>delivered.push({kind,channel,payload});
 f.manager.setCharacter({id:'same-character',name:'同一角色的新名称',modelId:'outfit-two'});
 assert.equal(f.manager.reply.id,'kept-reply');assert.equal(f.manager.reply.zh,'当前角色的回复');
 assert.equal(delivered.some(item=>item.channel==='companion-mouth'),false);
 assert.equal(delivered.filter(item=>item.channel==='companion-state').length,2);
 for(const {payload} of delivered){assert.equal(payload.character.modelId,'outfit-two');assert.equal(payload.reply.id,'kept-reply');}
});

// Executes the real renderer script on the CPU with a minimal DOM/IPC harness.
// This covers event/state races; it does not assert browser layout or native FPS.
async function rendererHarness(){
 const vm=require('node:vm');let now=1000,stateListener,actionListener;const calls=[],painted=[],frames=[],timers=[],windowEvents=new Map(),mediaEvents=new Map();
 const classList=()=>({add(){},remove(){},toggle(){}});
 const context2d={clearRect(){},drawImage(...args){painted.push(args);},getImageData(){return {data:new Uint8Array([0,0,0,255])};}};
 function element(id=''){return {id,hidden:['bubble','pet-menu','model','chat-status','menu-error','focus-badge'].includes(id),value:'',textContent:'',scrollHeight:0,clientHeight:0,scrollTop:0,style:{setProperty(){}},classList:classList(),dataset:{},events:new Map(),getContext:()=>context2d,setAttribute(){},getBoundingClientRect:()=>({left:70,top:180,x:70,y:180,width:192,height:208}),addEventListener(name,fn){this.events.set(name,fn);},matches:()=>false,closest:()=>null,contains:()=>false,focus(){},blur(){},append(){},replaceChildren(){},querySelectorAll:()=>[],hasPointerCapture:()=>false};}
 const nodes=new Map();const get=id=>{if(!nodes.has(id))nodes.set(id,element(id));return nodes.get(id);};
 const media={matches:false,addEventListener:(name,fn)=>mediaEvents.set(name,fn),removeEventListener:(name,fn)=>{if(mediaEvents.get(name)===fn)mediaEvents.delete(name);}};
 let quoteResult=null,cursorResult={x:170,y:220};
 const bridge={onState:fn=>stateListener=fn,onAction:fn=>actionListener=fn,call:async(action,payload)=>{calls.push({action,payload});if(action==='catalog')return {voices:[]};if(action==='quote')return quoteResult;if(action==='cursor')return cursorResult;return true;}};
 const sandbox={console,URLSearchParams,Date,Math,Uint8Array,Promise,location:{search:''},performance:{now:()=>now},innerWidth:330,innerHeight:458,matchMedia:()=>media,Image:class{constructor(){this.complete=true;this.naturalWidth=4096;}},Audio:class{pause(){}},setTimeout:()=>1,clearTimeout(){},setInterval:fn=>{timers.push(fn);return timers.length;},clearInterval(){},requestAnimationFrame:fn=>frames.push(fn),document:{getElementById:get,querySelector:()=>get('menu-title'),createElement:tag=>element(tag),createTextNode:text=>({textContent:text}),body:element('body'),documentElement:element('html')},window:{companion:bridge,getSelection:()=>({rangeCount:0,isCollapsed:true}),addEventListener:(name,fn)=>windowEvents.set(name,fn)}};
 const context=vm.createContext(sandbox);vm.runInContext(await fs.readFile(path.join(__dirname,'../electron/companion-view/view.js'),'utf8'),context);
 const evaluate=code=>vm.runInContext(code,context);
 const state={kind:'pet',character:{id:'original',name:'原角色'},preferences:{...sanitizePreferences(),soundEnabled:false,randomQuotes:false,nightReminders:false},reply:null,focus:{active:false},voiceRevision:0};
 stateListener(state);await Promise.resolve();await Promise.resolve();
 return {calls,painted,media,mediaEvents,nodes,state,evaluate,emit:value=>stateListener(value),act:name=>actionListener({name}),action:value=>actionListener(value),setTime:value=>now=value,setReduced:value=>{media.matches=value;mediaEvents.get('change')?.({matches:value});},setQuote:value=>quoteResult=value,setCursor:value=>cursorResult=value,cursor:()=>timers[0](),frame:time=>{now=time;frames.shift()?.(time);},unload:()=>windowEvents.get('beforeunload')()};
}

test('only successful validation of the matching capability clears its desktop error',async()=>{
 const h=await rendererHarness();h.action({name:'chat-error',kind:'voice',message:'语音未就绪'});
 assert.equal(h.nodes.get('chat-status').textContent,'语音未就绪');
 h.action({name:'capability-recovered',kind:'chat'});assert.equal(h.nodes.get('chat-status').textContent,'语音未就绪');
 h.action({name:'capability-recovered',kind:'voice'});assert.equal(h.nodes.get('chat-status').hidden,true);
 h.action({name:'chat-error',kind:'chat',message:'对话未就绪'});h.emit({...h.state,chatBusy:true});h.emit({...h.state,chatBusy:false});
 assert.equal(h.nodes.get('chat-status').textContent,'对话未就绪','starting a request is not a successful validation');
 h.action({name:'capability-recovered',kind:'chat'});assert.equal(h.nodes.get('chat-status').hidden,true);h.unload();
});

test('live OS reduced-motion change paints neutral idle immediately and blocks new motion/gaze',async()=>{
 const h=await rendererHarness();h.act('jump');h.frame(1000);h.frame(1250);assert.equal(h.evaluate('clipName'),'jump');assert.ok(h.evaluate('frame')>0);
 h.evaluate("look=3;targetLook=6;sitUntil=9000;wander={x:1,y:0,until:9000,next:0};");h.setReduced(true);
 assert.equal(h.evaluate('clipName'),'idle');assert.equal(h.evaluate('frame'),0);assert.equal(h.evaluate('wander'),null);assert.equal(h.evaluate('sitUntil'),0);assert.equal(h.evaluate('look'),-1);assert.equal(h.evaluate('targetLook'),-1);
 assert.deepEqual(h.painted.at(-1).slice(1,5),[0,0,192,208],'the change handler repaints the first idle sprite without waiting for RAF');
 const before=h.calls.filter(item=>item.action==='walk-step'||item.action==='cursor').length;h.act('jump');h.act('walk');h.frame(1500);await h.cursor();
 assert.equal(h.evaluate('clipName'),'idle');assert.equal(h.evaluate('wander'),null);assert.equal(h.calls.filter(item=>item.action==='walk-step'||item.action==='cursor').length,before);
 h.setTime(20000);h.setReduced(false);assert.equal(h.evaluate('nextFrame'),24200);h.frame(20016);assert.equal(h.evaluate('frame'),0,'re-enabling motion starts a fresh idle clock, without catch-up');h.unload();assert.equal(h.mediaEvents.has('change'),false);
});

test('in-flight cursor result cannot restart gaze after reduced motion becomes enabled',async()=>{
 const h=await rendererHarness();let resolve;h.setCursor(new Promise(r=>resolve=r));const pending=h.cursor();h.setReduced(true);resolve({x:170,y:220});await pending;
 assert.equal(h.evaluate('look'),-1);assert.equal(h.evaluate('targetLook'),-1);h.unload();
});

test('character identity change clears a local quote even without a remote reply and ignores late old quotes',async()=>{
 const h=await rendererHarness();h.setQuote({Text:'旧角色本地语录'});assert.equal(await h.evaluate("quote('Click')"),true);assert.equal(h.nodes.get('bubble').hidden,false);assert.equal(h.nodes.get('zh').textContent,'旧角色本地语录');
 h.emit({...h.state,character:{id:'original',name:'原角色',modelId:'different-outfit'},reply:null});assert.equal(h.evaluate('localQuote'),'旧角色本地语录','same-character updates preserve the local quote');
 let resolve;h.setQuote(new Promise(r=>resolve=r));const pending=h.evaluate("quote('Click')");h.emit({...h.state,character:{id:'new',name:'新角色'},reply:null});
 assert.equal(h.evaluate('localQuote'),null);assert.equal(h.nodes.get('bubble').hidden,true);resolve({Text:'迟到的旧角色语录'});assert.equal(await pending,false);assert.equal(h.evaluate('localQuote'),null);assert.equal(h.nodes.get('bubble').hidden,true);
 h.setQuote({Text:'新角色语录'});assert.equal(await h.evaluate("quote('Click')"),true);assert.equal(h.nodes.get('zh').textContent,'新角色语录');h.unload();
});

test('speech clock relay rejects prior character and stale sequence and clears when renderer stops',async t=>{
 const f=await fixture(t);await f.manager.setMode('both');f.manager.setCharacter({id:'speaker',name:'角色',modelId:'school'});
 const sent=[];for(const [kind,win]of f.manager.windows)win.webContents.send=(channel,payload)=>sent.push({kind,channel,payload});
 const s={sequence:4,token:9,clockSeconds:10,characterId:'speaker',playing:true,paused:false,elapsedSeconds:1,durationSeconds:8,level:.25,hint:'neutral'};
 assert.equal(f.manager.setSpeechSnapshot({...s,characterId:'old'}),false);assert.equal(f.manager.setSpeechSnapshot(s),true);assert.equal(f.manager.setSpeechSnapshot({...s,elapsedSeconds:2}),false);
 assert.equal(sent.length,1);assert.equal(sent[0].kind,'model');assert.equal(sent[0].channel,'companion-speech');assert.equal(sent[0].payload.elapsedSeconds,1);
 f.manager.setCharacter({id:'new',name:'新人'});assert.ok(sent.some(v=>v.channel==='companion-speech'&&v.payload===null));assert.equal(f.manager.setSpeechSnapshot({...s,sequence:5}),false);
 f.manager.resetSpeechClock();assert.equal(f.manager.setSpeechSnapshot({...s,sequence:1,characterId:'new'}),true);
});

test('model-only and pet chat and vision actions do not open the main window',async t=>{
 const f=await fixture(t);await f.manager.setMode('both');f.main.hide();let opens=0,submitted,visualOwner;f.manager.onOpenMain=()=>opens++;f.manager.onChat=async text=>(submitted=text,true);f.manager.onVision=async(owner,kind)=>{visualOwner={owner,kind}};
 for(const kind of['model','pet']){const win=f.manager.windows.get(kind),event={sender:win.webContents,senderFrame:win.webContents.mainFrame};f.manager.setChatBusy(false);await f.manager.viewCall(event,'chat-submit','hello');assert.equal(submitted,'hello');await f.manager.viewCall(event,'vision-open');assert.equal(visualOwner.owner,win);assert.equal(visualOwner.kind,kind);assert.equal(opens,0);assert.equal(f.main.isVisible(),false)}
});
test('one global TTS owner stops pet audio and rejects prerecorded playback until released',async t=>{
 const f=await fixture(t);await f.manager.setMode('both');const events=[];for(const [kind,win]of f.manager.windows)win.webContents.send=(channel,value)=>events.push({kind,channel,value});f.manager.setSpeechBusy(true);assert.equal(events.filter(e=>e.value.name==='audio-stop').length,2);const pet=f.manager.windows.get('pet'),event={sender:pet.webContents,senderFrame:pet.webContents.mainFrame};f.manager.voiceUrl=async()=> 'file:///synthetic.ogg';await assert.rejects(f.manager.viewCall(event,'voice-url','test.ogg'),/正在朗读/);f.manager.setSpeechBusy(false);assert.equal(await f.manager.viewCall(event,'voice-url','test.ogg'),'file:///synthetic.ogg');assert.ok(events.filter(e=>e.channel==='companion-state').every(e=>typeof e.value.speechBusy==='boolean'));
});
test('one reminder policy serves both visible companions and never reads desktop pixels',async t=>{
 const f=await fixture(t);await f.manager.setMode('both');let now=0;const {CompanionReminderPolicy}=require('../electron/companion-reminders.cjs');f.manager.reminders=new CompanionReminderPolicy({now:()=>now});f.powerMonitor.getSystemIdleTime=()=>0;await f.manager.setPreferences({breakReminders:true,breakIntervalMinutes:30});const captions=[];f.manager.onReminder=value=>captions.push(value);f.manager.tickFocus();for(let i=0;i<120;i++){now+=15000;f.manager.tickFocus()}assert.equal(captions.length,1);assert.equal(f.manager.reply.zh,captions[0].text);f.manager.setSpeechBusy(true);for(let i=0;i<120;i++){now+=15000;f.manager.tickFocus()}assert.equal(captions.length,1);f.manager.setSpeechBusy(false);now+=1000;f.manager.tickFocus();assert.equal(captions.length,2);f.powerMonitor.getSystemIdleTime=()=>400;for(let i=0;i<120;i++){now+=15000;f.manager.tickFocus()}assert.equal(captions.length,2);
});

test('Japanese-only bubble preserves Chinese-only visual replies and reminders instead of blanking them',async()=>{const f=await rendererHarness();f.emit({...f.state,preferences:{...f.state.preferences,bubbleLanguage:'ja'},reply:{id:'vision',zh:'合成视觉回复',ja:''}});assert.equal(f.nodes.get('bubble').hidden,false);assert.equal(f.nodes.get('zh').textContent,'合成视觉回复');assert.match(f.nodes.get('ja').textContent,/中文/);f.unload()});
