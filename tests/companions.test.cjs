'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { UsageTracker } = require('../electron/usage.cjs');
const { CompanionManager, sanitizePreferences, clampBounds } = require('../electron/companions.cjs');

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
  assert.deepEqual(clampBounds({ x:-900,y:2000,width:330,height:410 },{ x:0,y:0,width:1920,height:1040 }),{ x:0,y:630,width:330,height:410 });
});
class FakeWindow extends EventEmitter {
  constructor(opts = {}) { super(); this.bounds = { x:0,y:0,width:330,height:410,...opts }; this.visible = true; this.destroyed = false; this.webContents = new EventEmitter(); this.webContents.mainFrame = {}; this.webContents.send = () => {}; this.webContents.setWindowOpenHandler = () => {}; }
  isDestroyed() { return this.destroyed; } isVisible() { return this.visible; } isMinimized() { return false; }
  show() { this.visible=true; this.emit('show'); } showInactive() { this.show(); } hide() { this.visible=false; this.emit('hide'); }
  restore() {} focus() {} setAlwaysOnTop() {} setIgnoreMouseEvents() {}
  loadFile() { return Promise.resolve(); } getBounds() { return this.bounds; } setBounds(v) { this.bounds=v; } getPosition() { return [this.bounds.x,this.bounds.y]; }
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
  return { manager,main,powerMonitor,handlers,requested:()=>requested,quit:()=>quit };
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
