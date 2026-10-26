'use strict';
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const fs = require('node:fs/promises');
const { UsageTracker } = require('./usage.cjs');
const { PET_DEFAULTS, petPreferences, parseLegacySettings, QuotePicker } = require('./pet-features.cjs');
const petQuotes = require('./companion-view/quotes.json');
const MODES = new Set(['none', 'model', 'pet', 'both']);
const CLOSE_ACTIONS = new Set(['ask', 'quit', 'model', 'pet', 'both']);
const DEFAULTS = Object.freeze({ mode: 'none', closeAction: 'ask', bubbleLanguage: 'zh', position: 'right', scale: 1, alwaysOnTop: true, animation: true, positions: {}, ...PET_DEFAULTS });
function sanitizePreferences(value = {}, base = DEFAULTS) {
  const next = { ...base, ...value };
  if (!MODES.has(next.mode)) throw Error('无效的桌面形象模式');
  if (!CLOSE_ACTIONS.has(next.closeAction)) throw Error('无效的关闭行为');
  if (!['zh', 'ja', 'both'].includes(next.bubbleLanguage)) throw Error('无效的气泡语言');
  if (!['left', 'right'].includes(next.position)) throw Error('无效的人物位置');
  if (!Number.isFinite(next.scale) || next.scale < .6 || next.scale > 2) throw Error('桌宠缩放应在 0.6–2 倍之间');
  const positions = {};
  for (const kind of ['pet', 'model']) {
    const p = next.positions?.[kind];
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) positions[kind] = { x: Math.round(p.x), y: Math.round(p.y) };
  }
  return { ...petPreferences(next), mode: next.mode, closeAction: next.closeAction, bubbleLanguage: next.bubbleLanguage, position: next.position, scale: next.scale, alwaysOnTop: !!next.alwaysOnTop, animation: !!next.animation, positions };
}
function kindsForMode(mode) { return mode === 'both' ? ['model', 'pet'] : mode === 'none' ? [] : [mode]; }
function clampBounds(bounds, area) {
  return { x: Math.round(Math.max(area.x, Math.min(bounds.x, area.x + area.width - bounds.width))), y: Math.round(Math.max(area.y, Math.min(bounds.y, area.y + area.height - bounds.height))), width: bounds.width, height: bounds.height };
}

class CompanionManager {
  constructor({ electron, dataDir, onOpenMain = () => {}, onQuit = () => electron.app.quit(), onChange = () => {}, onCloseRequested = () => {}, onError = () => {}, onOpenSettings = () => {} }) {
    this.e = electron; this.dataDir = dataDir; this.onOpenMain = onOpenMain; this.onQuit = onQuit; this.onChange = onChange; this.onCloseRequested = onCloseRequested; this.onError = onError; this.onOpenSettings = onOpenSettings;
    this.quotes = new QuotePicker(petQuotes); this.petMood={affection:12,annoyance:0,lastInteraction:Date.now()};
    this.preferences = { ...DEFAULTS, positions: {} }; this.windows = new Map(); this.listeners = [];
    this.usage = new UsageTracker({ file: path.join(dataDir, 'companionship.json') });
    this.writeQueue = Promise.resolve(); this.quitting = false; this.pauses = new Set(); this.reply = null;
  }
  async initialize() {
    try { await this.usage.load(); } catch (error) {
      // Keep a damaged history intact. The app remains usable, but this session is not written over it.
      this.usageReadError = error.message; this.usage.file = null; this.onError(error);
    }
    try { this.preferences = sanitizePreferences(JSON.parse(await fs.readFile(path.join(this.dataDir, 'companions.json'), 'utf8'))); }
    catch (error) { if (error.code !== 'ENOENT') { this.preferencesReadError = true; this.onError(new Error('桌面形象设置读取失败，已使用默认设置；原文件已保留。', { cause: error })); } }
    if (process.env.LOCALAPPDATA && !this.preferencesReadError) {
      try { await fs.access(path.join(this.dataDir,'companions.json')); } catch (error) {
        if(error.code==='ENOENT')try { const old=await fs.readFile(path.join(process.env.LOCALAPPDATA,'YukinoPet/settings.ini'),'utf8'); this.preferences=sanitizePreferences(parseLegacySettings(old),this.preferences); await this.persist(); } catch(legacyError) { if(legacyError.code!=='ENOENT')this.onError(new Error('旧桌宠设置未能导入，已保留原文件。')); }
      }
    }
    await this.setResourceRoot(path.join(__dirname,'companion-view/assets'), {notify:false});
    this.startupAvailable=['win32','darwin'].includes(process.platform)&&!!this.e.app.isPackaged&&typeof this.e.app.setLoginItemSettings==='function';
    if(this.startupAvailable)this.preferences.startup=!!this.e.app.getLoginItemSettings().openAtLogin;
    const { powerMonitor, ipcMain, screen } = this.e;
    const listen = (emitter, name, fn) => { emitter.on(name, fn); this.listeners.push(() => emitter.removeListener(name, fn)); };
    for (const [event, flag, paused] of [['suspend','sleep',true], ['resume','sleep',false], ['lock-screen','lock',true], ['unlock-screen','lock',false]]) {
      listen(powerMonitor, event, () => { if (paused) this.pauses.add(flag); else this.pauses.delete(flag); this.usage.update({ paused: this.pauses.size > 0 }); this.flush(); });
    }
    listen(screen, 'display-removed', () => this.repositionAll());
    listen(screen, 'display-metrics-changed', () => this.repositionAll());
    ipcMain.handle('companion-view', (event, action, payload) => this.viewCall(event, action, payload));
    this.listeners.push(() => ipcMain.removeHandler('companion-view'));
    this.timer = setInterval(() => this.flush(), 15000);
    this.focusTimer=setInterval(()=>this.tickFocus(),1000); this.focusTimer.unref?.(); this.timer.unref?.();
    this.ensureTray(); this.applyMode(); return this.getState();
  }
  async setResourceRoot(root, {notify=true}={}) {
    if(typeof root!=='string'||!path.isAbsolute(root))throw Error('桌宠语音目录必须是本机绝对路径');
    const resolved=path.resolve(root);
    let catalog;
    try {
      const stat=await fs.lstat(resolved);
      if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('桌宠语音目录不安全');
      catalog=JSON.parse(await fs.readFile(path.join(resolved,'voices.json'),'utf8'));
      if(!Array.isArray(catalog.files)||catalog.files.length>10000)throw Error('桌宠语音清单无效');
      const names=new Set();
      for(const item of catalog.files){
        if(!item||!/^[-A-Za-z0-9_]+\.ogg$/.test(item.file)||names.has(item.file.toLowerCase()))throw Error('桌宠语音清单文件名无效');
        names.add(item.file.toLowerCase());
      }
    }catch(error){if(error.code!=='ENOENT')throw error;catalog={files:[]};}
    this.voiceRoot=resolved;this.voiceCatalog=catalog;this.voiceRevision=(this.voiceRevision||0)+1;
    if(notify){for(const [kind,win] of this.windows)this.sendState(win,kind);this.emit();}
    return {voiceCount:catalog.files.length};
  }
  async voiceUrl(name){
    if(typeof name!=='string'||!/^[-A-Za-z0-9_]+\.ogg$/.test(name))throw Error('无效的桌宠语音');
    const item=this.voiceCatalog?.files?.find(item=>item.file===name);
    if(!item||!this.voiceRoot)throw Error('桌宠语音尚未准备');
    const directory=path.join(this.voiceRoot,'voices'),file=path.join(directory,name);
    const [dirStat,stat]=await Promise.all([fs.lstat(directory),fs.lstat(file)]);
    if(!dirStat.isDirectory()||dirStat.isSymbolicLink()||!stat.isFile()||stat.isSymbolicLink()||(Number.isSafeInteger(item.bytes)&&stat.size!==item.bytes))throw Error('桌宠语音文件不完整');
    return pathToFileURL(file).href;
  }
  attachMainWindow(win) {
    this.mainWindow = win;
    const refresh = () => this.refreshActivity();
    for (const event of ['show','hide','minimize','restore','closed']) win.on(event, refresh);
    win.on('close', event => {
      if (this.quitting) return;
      event.preventDefault();
      if (this.preferences.closeAction === 'quit') { this.quit(); return; }
      if (this.preferences.closeAction === 'ask') { this.onCloseRequested(); return; }
      try {
        this.preferences = sanitizePreferences({ mode: this.preferences.closeAction }, this.preferences);
        this.applyMode(); win.hide(); this.persist().catch(this.onError); this.emit();
      } catch (error) { this.onError(error); }
    });
    this.refreshActivity();
  }
  refreshActivity() {
    const main = this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.isVisible() && !this.mainWindow.isMinimized();
    const companion = [...this.windows.values()].some(w => !w.isDestroyed() && w.isVisible());
    this.usage.update({ main: !this.quitting && !!main, companion: !this.quitting && companion });
  }
  getState() { const usage = this.usage.snapshot(); return { ...structuredClone(this.preferences), preferences: structuredClone(this.preferences), usage: { ...usage, available: !this.usageReadError, warning: this.usageReadError || '', totalMs: usage.usageMs, todayMs: usage.today.usageMs, sessionMs: usage.session.usageMs }, startupAvailable:this.startupAvailable, voiceCount:this.voiceCatalog?.files?.length||0, focus:{active:this.preferences.focusEnds>Date.now(),endsAt:this.preferences.focusEnds,remainingMs:Math.max(0,this.preferences.focusEnds-Date.now())}, modelReady: false, petReady: true, active: [...this.windows.keys()] }; }
  updatePrefs(patch) { return this.setPreferences(patch); }
  async closeChoice(mode, {remember=false}={}) { if(remember && CLOSE_ACTIONS.has(mode))await this.setPreferences({closeAction:mode}); if (mode === 'quit') { this.quit(); return; } if (!MODES.has(mode)) throw Error('无效的关闭选项'); await this.setMode(mode); this.mainWindow?.hide(); this.refreshActivity(); this.emit(); return this.getState(); }
  async setPreferences(patch) {
    if (this.preferencesReadError) {
      await fs.copyFile(path.join(this.dataDir, 'companions.json'), path.join(this.dataDir, `companions.corrupt-${Date.now()}.json`));
      this.preferencesReadError = false;
    }
    const previousPosition = this.preferences.position;
    const next = sanitizePreferences(patch, this.preferences);
    if(next.startup!==this.preferences.startup){
      if(!this.startupAvailable)throw Error('开机启动仅在已安装的 Windows 或 macOS 版本可设置。');
      this.e.app.setLoginItemSettings({openAtLogin:next.startup});
      if(!!this.e.app.getLoginItemSettings().openAtLogin!==next.startup)throw Error('系统未保存开机启动设置，请检查系统登录项权限。');
    }
    this.preferences = next;
    if (this.preferences.position !== previousPosition) this.preferences.positions = {};
    this.applyMode();
    for (const [kind, win] of this.windows) {
      const bounds = this.boundsFor(kind);
      win.setBounds(bounds); win.setAlwaysOnTop(this.preferences.alwaysOnTop, 'floating'); this.sendState(win, kind);
    }
    await this.persist(); this.emit(); return this.getState();
  }
  setMode(mode) { return this.setPreferences({ mode }); }
  showReply(reply) {
    this.reply = { zh: typeof reply?.zh === 'string' ? reply.zh.slice(0, 1800) : '', ja: typeof reply?.ja === 'string' ? reply.ja.slice(0, 1800) : '', id: typeof reply?.id === 'string' ? reply.id : '' };
    for (const [kind, win] of this.windows) this.sendState(win, kind);
  }
  clearReply() { this.reply = null; for (const [kind, win] of this.windows) this.sendState(win, kind); }
  boundsFor(kind) {
    const scale = this.preferences.scale;
    const width = Math.round((kind === 'pet' ? 330 : 350) * scale), height = Math.round((kind === 'pet' ? 410 : 470) * scale);
    const saved = this.preferences.positions[kind];
    const area = (saved ? this.e.screen.getDisplayNearestPoint(saved) : this.e.screen.getPrimaryDisplay()).workArea;
    const offset = this.preferences.mode === 'both' && kind === 'model' ? Math.round(230 * scale) : 0;
    return clampBounds({ x: saved?.x ?? (this.preferences.position === 'left' ? area.x + 24 + offset : area.x + area.width - width - 24 - offset), y: saved?.y ?? area.y + area.height - height, width, height }, area);
  }
  applyMode() {
    const desired = kindsForMode(this.preferences.mode);
    for (const [kind, win] of this.windows) if (!desired.includes(kind)) { this.windows.delete(kind); win.destroy(); }
    for (const kind of desired) if (!this.windows.has(kind)) this.createWindow(kind);
    this.refreshActivity(); this.updateTray();
  }
  createWindow(kind) {
    const win = new this.e.BrowserWindow({ ...this.boundsFor(kind), transparent: true, frame: false, resizable: false, maximizable: false, minimizable: false, skipTaskbar: true, show: false, alwaysOnTop: this.preferences.alwaysOnTop, hasShadow: false, backgroundColor: '#00000000', webPreferences: { preload: path.join(__dirname, 'companion-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, autoplayPolicy:'no-user-gesture-required' } });
    this.windows.set(kind, win);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.on('did-finish-load', () => this.sendState(win, kind));
    win.on('ready-to-show', () => { if (!win.isDestroyed()) { win.showInactive(); this.refreshActivity(); } });
    win.on('closed', () => { if (this.windows.get(kind) === win) this.windows.delete(kind); this.refreshActivity(); });
    win.loadFile(path.join(__dirname, 'companion-view/index.html'), { query: { kind } }).catch(error => this.onError(error));
    return win;
  }
  sendState(win, kind) { if (!win.isDestroyed()) win.webContents.send('companion-state', { kind, startupAvailable:this.startupAvailable, preferences: this.preferences, voiceRevision:this.voiceRevision||0, reply: this.reply, focus:{active:this.preferences.focusEnds>Date.now(),remainingMs:Math.max(0,this.preferences.focusEnds-Date.now())}, modelReady: false }); }
  async viewCall(event, action, payload) {
    const entry = [...this.windows].find(([, win]) => !win.isDestroyed() && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame);
    if (!entry) throw Error('不允许的桌宠调用');
    const [kind, win] = entry;
    if (action === 'catalog') return {voices:(this.voiceCatalog?.files||[]).map(item=>item.file).filter(name=>/^[A-Za-z0-9_-]+\.ogg$/.test(name))};
    if (action === 'voice-url') return this.voiceUrl(payload);
    if (action === 'settings') { this.openMain(); this.onOpenSettings('avatar'); return true; }
    if (action === 'prefs') { const allowed=['animation','interactionPaused','quietMode','randomQuotes','interactionQuotes','nightReminders','showBubbles','soundEnabled','soundVolume','opacity','scale','alwaysOnTop','startup','bubbleLanguage']; const patch=Object.fromEntries(Object.entries(payload||{}).filter(([key])=>allowed.includes(key))); return this.setPreferences(patch); }
    if (action === 'action') return this.performAction(payload);
    if (action === 'quote') return this.pickQuote(payload);
    if (action === 'cursor') { const cursor=this.e.screen.getCursorScreenPoint();const bounds=win.getBounds();return {x:cursor.x-bounds.x,y:cursor.y-bounds.y}; }
    if (action === 'hide') return this.setMode(this.preferences.mode === 'both' ? (kind === 'pet' ? 'model' : 'pet') : 'none');
    if (action === 'quit') {this.quit();return true;}
    if (action === 'ready') { this.sendState(win, kind); return true; }
    if (action === 'open-main') { this.openMain(); return true; }
    if (action === 'hit-test') { win.setIgnoreMouseEvents(payload === false, { forward: true }); return true; }
    if (action === 'drag-start') { const point = this.e.screen.getCursorScreenPoint(); const [x,y] = win.getPosition(); this.drag = { kind, point, x, y }; win.setIgnoreMouseEvents(false); return true; }
    if (action === 'drag-move' && this.drag?.kind === kind) {
      const point = this.e.screen.getCursorScreenPoint(); const area = this.e.screen.getDisplayNearestPoint(point).workArea;
      const bounds = win.getBounds(); win.setBounds(clampBounds({ ...bounds, x: this.drag.x + point.x - this.drag.point.x, y: this.drag.y + point.y - this.drag.point.y }, area)); return true;
    }
    if (action === 'drag-end' && this.drag?.kind === kind) { this.drag = null; const [x,y] = win.getPosition(); this.preferences.positions[kind] = { x,y }; await this.persist(); return true; }
    if (action === 'walk-step' && kind === 'pet' && !this.drag && this.preferences.animation && !this.preferences.interactionPaused && !this.preferences.quietMode && this.preferences.focusEnds<=Date.now() && (payload === -1 || payload === 1 || (payload&&Number.isFinite(payload.x)&&Number.isFinite(payload.y)&&Math.abs(payload.x)<=1&&Math.abs(payload.y)<=1))) {
      const bounds = win.getBounds(); const area = this.e.screen.getDisplayNearestPoint({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }).workArea;
      const next = clampBounds({ ...bounds, x: bounds.x + Math.round(3 * this.preferences.scale) * (typeof payload==='number'?payload:payload.x), y:bounds.y+(typeof payload==='number'?0:Math.round(3*this.preferences.scale)*payload.y) }, area);
      if (next.x === bounds.x && next.y === bounds.y) return false; win.setBounds(next); this.preferences.positions[kind] = { x: next.x, y: next.y }; return true;
    }
    if (action === 'menu') { this.contextMenu(kind, win); return true; }
    return false;
  }
  contextMenu(kind, win) { win.webContents.send('companion-action',{name:'menu'}); }
  pickQuote(raw) {
    let trigger=typeof raw==='string'?raw:raw?.trigger;
    if(trigger==='Idle'&&this.petMood.affection>=45&&Math.random()<.25)trigger='Affection';
    if(!['Greeting','Click','HeadPat','Annoyed','Mouse','Night','Idle','Observation','Affection','Break','Work','Farewell'].includes(trigger))throw Error('未知桌宠语录类型');
    const interactive=['Click','HeadPat','Annoyed','Mouse'].includes(trigger);
    if(interactive&&!this.preferences.interactionPaused){
      if(trigger==='HeadPat'){this.petMood.affection=Math.min(100,this.petMood.affection+.7);this.petMood.annoyance=Math.max(0,this.petMood.annoyance-1.3);}
      if(trigger==='Click')this.petMood.affection=Math.min(100,this.petMood.affection+.15);
      if(trigger==='Annoyed'){this.petMood.affection=Math.max(0,this.petMood.affection-.2);this.petMood.annoyance=Math.min(100,this.petMood.annoyance+10);}
      this.petMood.lastInteraction=Date.now();
    }
    if(!this.preferences.showBubbles||this.preferences.quietMode||(interactive&&(!this.preferences.interactionQuotes||this.preferences.interactionPaused)))return null;
    if(trigger==='Night'&&!this.preferences.nightReminders)return null;
    if(['Idle','Observation','Affection'].includes(trigger)&&!this.preferences.randomQuotes)return null;
    const hour=new Date().getHours();const mood=this.petMood.annoyance>=32?'Annoyed':hour>=23||hour<6?'Sleepy':Date.now()-this.petMood.lastInteraction>480000?'Bored':this.petMood.affection>=55?'Relaxed':'Calm';
    return this.quotes.pick(trigger,{mood,affection:this.petMood.affection,action:typeof raw?.action==='string'?raw.action:'idle',high:['Greeting','HeadPat','Annoyed','Break','Work','Farewell'].includes(trigger)});
  }
  async performAction(action) {
    if(!['greet','voice','head-tilt','jump','walk','sit','focus-25','focus-50','focus-cancel'].includes(action))throw Error('未知桌宠动作');
    if(action==='focus-cancel'){await this.setPreferences({focusEnds:0});return this.getState();}
    if(action.startsWith('focus-')) { await this.setPreferences({focusEnds:Date.now()+Number(action.slice(6))*60000});return this.getState(); }
    if(!this.windows.has('pet'))await this.setMode(this.preferences.mode==='model'?'both':'pet');
    const win=this.windows.get('pet');
    if(action==='voice'&&!this.preferences.soundEnabled)await this.setPreferences({soundEnabled:true});
    const send=()=>{if(!win.isDestroyed())win.webContents.send('companion-action',{name:action});};
    if(win.webContents.isLoading?.())win.webContents.once('did-finish-load',send);else send();
    return this.getState();
  }
  tickFocus() {
    if(this.quitting)return;
    if(this.preferences.focusEnds>0&&this.preferences.focusEnds<=Date.now()&&!this.drag){
      this.preferences.focusEnds=0;this.persist().catch(this.onError);
      const pet=this.windows.get('pet');if(pet&&!pet.isDestroyed())pet.webContents.send('companion-action',{name:'focus-complete'});
      if(this.e.Notification?.isSupported?.())new this.e.Notification({title:'这段专注完成了',body:'休息几分钟，再继续。',silent:this.preferences.quietMode}).show();
      this.emit();
    }else if(this.preferences.focusEnds>Date.now()){for(const [kind,win] of this.windows)this.sendState(win,kind);this.emit();}
    this.petMood.annoyance=Math.max(0,this.petMood.annoyance-.035);
  }
  openMain() { this.onOpenMain(); if (this.mainWindow && !this.mainWindow.isDestroyed()) { this.mainWindow.show(); this.mainWindow.restore(); this.mainWindow.focus(); } }
  ensureTray() {
    if (this.tray || !this.e.Tray || !this.e.nativeImage) return;
    const source = this.e.nativeImage.createFromPath(path.join(__dirname, '../dist/yukino-icon.png'));
    const icon = source.isEmpty() ? this.e.nativeImage.createEmpty() : source.resize({ width: 32,height: 32 });
    this.tray = new this.e.Tray(icon); this.tray.setToolTip('Yukino Companion · 雪乃在这里');
    this.tray.on('double-click', () => this.openMain()); this.updateTray();
  }
  updateTray() {
    this.tray?.setContextMenu(this.e.Menu.buildFromTemplate([
      { label: '打开对话', click: () => this.openMain() },
      ...[['none','隐藏桌面形象'],['model','只显示人物模型'],['pet','只显示 Q 版桌宠'],['both','同时显示两种形象']].map(([mode,label]) => ({ label,type: 'radio',checked: this.preferences.mode === mode,click: () => this.setMode(mode).catch(this.onError) })),
      { type: 'separator' }, { label: '完全退出',click: () => this.quit() },
    ]));
  }
  repositionAll() { for (const [kind, win] of this.windows) win.setBounds(this.boundsFor(kind)); }
  emit() { this.onChange(this.getState()); }
  async persist() {
    if (this.preferencesReadError) return;
    const value = JSON.stringify(this.preferences);
    const job = this.writeQueue.then(async () => { await fs.mkdir(this.dataDir, { recursive: true }); const file = path.join(this.dataDir, 'companions.json'); await fs.writeFile(file + '.tmp', value, 'utf8'); await fs.rename(file + '.tmp', file); });
    this.writeQueue = job.catch(() => {}); return job;
  }
  flush() { this.usage.save().then(() => this.emit()).catch(this.onError); }
  quit() { this.quitting = true; this.onQuit(); }
  async dispose() {
    this.quitting = true; clearInterval(this.timer); clearInterval(this.focusTimer); this.usage.update({ main: false, companion: false });
    for (const cleanup of this.listeners.splice(0)) cleanup();
    for (const win of this.windows.values()) if (!win.isDestroyed()) win.destroy();
    this.windows.clear(); this.tray?.destroy(); this.tray = null;
    await Promise.all([this.persist(), this.usage.save()]);
  }
}
module.exports = { CompanionManager, DEFAULTS, sanitizePreferences, kindsForMode, clampBounds };
