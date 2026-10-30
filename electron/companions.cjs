'use strict';
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const fs = require('node:fs/promises');
const { UsageTracker } = require('./usage.cjs');
const { PET_DEFAULTS, petPreferences, parseLegacySettings, QuotePicker } = require('./pet-features.cjs');
const petQuotes = require('./companion-view/quotes.json');
const {CompanionReminderPolicy,validateReminderConfig,validateProactiveConfig,withinHours,PROACTIVE_DEFAULTS}=require('./companion-reminders.cjs');
const {speechSnapshot}=require('./speech-snapshot.cjs');
const {verifyVideoPreviewPack,VIDEO_GAIT}=require('./companion-video-pack.cjs');
const {validBody,clampSubject}=require('./companion-geometry.cjs');
const MODES = new Set(['none', 'model', 'pet', 'both']);
const CLOSE_ACTIONS = new Set(['ask', 'quit', 'model', 'pet', 'both']);
const DEFAULTS = Object.freeze({ mode: 'none', petRenderer:'sprite', closeAction: 'ask', bubbleLanguage: 'zh', position: 'right', scale: 1, alwaysOnTop: true, mouseThrough:false, animation: true, positions: {}, inputPosition:'below', breakReminders:false,breakIntervalMinutes:60,proactive:PROACTIVE_DEFAULTS,...PET_DEFAULTS });
function daylightLocation(value){
 if(!value||typeof value.latitude!=='number'||typeof value.longitude!=='number'||!Number.isFinite(value.latitude)||!Number.isFinite(value.longitude)||Math.abs(value.latitude)>90||Math.abs(value.longitude)>180)return null;
 return {latitude:value.latitude,longitude:value.longitude};
}
function sanitizePreferences(value = {}, base = DEFAULTS) {
  const next = { ...base, ...value };
  if(!['sprite','video-preview'].includes(next.petRenderer))throw Error('无效的桌宠渲染模式');
  if (!MODES.has(next.mode)) throw Error('无效的桌面形象模式');
  if (!CLOSE_ACTIONS.has(next.closeAction)) throw Error('无效的关闭行为');
  if (!['zh', 'ja', 'both'].includes(next.bubbleLanguage)) throw Error('无效的气泡语言');
  if(!['above','below'].includes(next.inputPosition))throw Error('无效的输入框位置');
  if(typeof next.mouseThrough!=='boolean')throw Error('无效的鼠标穿透设置');
  if (!['left', 'right'].includes(next.position)) throw Error('无效的人物位置');
  if (!Number.isFinite(next.scale) || next.scale < .6 || next.scale > 2) throw Error('桌宠缩放应在 0.6–2 倍之间');
  const reminder=validateReminderConfig({enabled:next.breakReminders,intervalMinutes:next.breakIntervalMinutes});
  const proactive=validateProactiveConfig(next.proactive);
  const positions = {};
  for (const kind of ['pet', 'model']) {
    const p = next.positions?.[kind];
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) positions[kind] = { x: Math.round(p.x), y: Math.round(p.y), ...(validBody(p.body)?{body:validBody(p.body)}:{}) };
  }
  return { ...petPreferences(next),breakReminders:reminder.enabled,breakIntervalMinutes:reminder.intervalMinutes,proactive, mode: next.mode, petRenderer:next.petRenderer, closeAction: next.closeAction, bubbleLanguage: next.bubbleLanguage, position: next.position, inputPosition:next.inputPosition, scale: next.scale, alwaysOnTop: !!next.alwaysOnTop, mouseThrough:next.mouseThrough, animation: !!next.animation, positions };
}
function kindsForMode(mode) { return mode === 'both' ? ['model', 'pet'] : mode === 'none' ? [] : [mode]; }
function clampBounds(bounds, area) {
  return { x: Math.round(Math.max(area.x, Math.min(bounds.x, area.x + area.width - bounds.width))), y: Math.round(Math.max(area.y, Math.min(bounds.y, area.y + area.height - bounds.height))), width: bounds.width, height: bounds.height };
}
// Sizes always come from preferences, never from a prior native move or bubble layout.
function viewportSize(kind, scale, area) {
  return {width:Math.min(area.width, Math.max(320, Math.round((kind==='pet'?330:350)*scale))),height:Math.min(area.height, Math.round((kind==='pet'?410:470)*scale)+48)};
}
function adjacentMenuBounds(anchor, area) {
  const width=Math.min(300,area.width),height=Math.min(560,area.height),gap=12;
  const candidates=[
    {x:anchor.x+anchor.width+gap,y:anchor.y},
    {x:anchor.x-width-gap,y:anchor.y},
    {x:anchor.x,y:anchor.y-height-gap},
    {x:anchor.x,y:anchor.y+anchor.height+gap},
  ];
  for(const point of candidates){
    const bounds=clampBounds({...point,width,height},area);
    if(bounds.x+width<=anchor.x-gap||bounds.x>=anchor.x+anchor.width+gap||bounds.y+height<=anchor.y-gap||bounds.y>=anchor.y+anchor.height+gap)return bounds;
  }
  return null; // Small displays use full settings rather than covering the character.
}
function moveWindow(win, bounds) {
  // Position-only API avoids native/DPI resize feedback during repeated dragging.
  win.setPosition(bounds.x,bounds.y,false);
  // Some Windows/DPI combinations resize transparent windows during a move.
  // Correct only an actual size drift, never resize on an ordinary drag.
  const actual=win.getBounds();
  if(actual.width!==bounds.width||actual.height!==bounds.height)win.setBounds(bounds,false);
}

function validDragPoint(value) {
  return value&&Number.isFinite(value.x)&&Number.isFinite(value.y)&&Math.abs(value.x)<=1000000&&Math.abs(value.y)<=1000000
    ? {x:Math.round(value.x),y:Math.round(value.y)} : null;
}
function moveDraggedWindow(win, drag, screen, finalInputPoint=null) {
  // Pointer coordinates describe the release event itself. The native cursor
  // may already have moved again by the time this IPC is handled.
  const point=finalInputPoint&&drag.inputPoint
    ? {x:drag.point.x+finalInputPoint.x-drag.inputPoint.x,y:drag.point.y+finalInputPoint.y-drag.inputPoint.y}
    : screen.getCursorScreenPoint();
  const area=screen.getDisplayNearestPoint(point).workArea;
  const candidate={x:drag.x+point.x-drag.point.x,y:drag.y+point.y-drag.point.y,width:drag.width,height:drag.height};
  const areas=screen.getAllDisplays?.().map(item=>item.workArea)||[area];
  const bounds=clampSubject(candidate,drag.body,areas)||clampBounds(candidate,area);
  const current=win.getBounds();
  if(['x','y','width','height'].some(key=>current[key]!==bounds[key]))moveWindow(win,bounds);
}


class CompanionManager {
  constructor({ electron, dataDir, onOpenMain = () => {}, onQuit = () => electron.app.quit(), onChange = () => {}, onCloseRequested = () => {}, onError = () => {}, onOpenSettings = () => {}, onChat = async () => false, onChatStop = () => {}, onVision = () => {}, onVisionStop = () => {}, onModelCatalog = async()=>({models:[]}), onUse=()=>{}, onReminder=()=>{}, onProactive=async()=>{throw Error('主动生成尚未准备');}, onModelData = async () => { throw Error('人物模型数据尚未准备好'); } }) {
    this.e = electron; this.dataDir = dataDir; this.onOpenMain = onOpenMain; this.onQuit = onQuit; this.onChange = onChange; this.onCloseRequested = onCloseRequested; this.onError = onError; this.onOpenSettings = onOpenSettings; this.onChat=onChat; this.onChatStop=onChatStop; this.onVision=onVision;this.onVisionStop=onVisionStop;this.visionActive=false;this.onModelData=onModelData;this.onModelCatalog=onModelCatalog;this.onUse=onUse;this.onReminder=onReminder;this.reminders=new CompanionReminderPolicy();this.character={id:'yukino',name:'雪之下雪乃',modelId:''};
    this.quotes = new QuotePicker(petQuotes); this.petMood={affection:12,annoyance:0,lastInteraction:Date.now()};
    this.preferences = { ...DEFAULTS, positions: {} }; this.windows = new Map(); this.menus = new Map(); this.chatBusy=false; this.listeners = [];
    this.usage = new UsageTracker({ file: path.join(dataDir, 'companionship.json') });
    this.onProactive=onProactive;this.proactiveController=null;this.proactiveStatus={phase:'idle'};
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
      listen(powerMonitor, event, () => { if (paused){this.pauses.add(flag);this.cancelProactive();} else this.pauses.delete(flag); this.usage.update({ paused: this.pauses.size > 0 }); this.walkFraction={x:0,y:0};for(const [kind,win] of this.windows)this.sendState(win,kind);this.flush(); });
    }
    listen(screen, 'display-removed', () => this.repositionAll());
    listen(screen, 'display-metrics-changed', () => this.repositionAll());
    ipcMain.handle('companion-view', (event, action, payload) => this.viewCall(event, action, payload));
    this.listeners.push(() => ipcMain.removeHandler('companion-view'));
    this.timer = setInterval(() => this.flush(), 15000);
    this.focusTimer=setInterval(()=>this.tickFocus(),1000); this.focusTimer.unref?.(); this.timer.unref?.();
    this.reminders.configure({enabled:this.preferences.breakReminders,intervalMinutes:this.preferences.breakIntervalMinutes});this.reminders.configureProactive(this.preferences.proactive);this.ensureTray(); this.applyMode(); return this.getState();
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
  getState() { const usage = this.usage.snapshot(); return { ...structuredClone(this.preferences), preferences: structuredClone(this.preferences), proactiveStatus:{...this.proactiveStatus}, usage: { ...usage, available: !this.usageReadError, warning: this.usageReadError || '', totalMs: usage.usageMs, todayMs: usage.today.usageMs, sessionMs: usage.session.usageMs }, startupAvailable:this.startupAvailable, voiceCount:this.voiceCatalog?.files?.length||0, focus:{active:this.preferences.focusEnds>Date.now(),endsAt:this.preferences.focusEnds,remainingMs:Math.max(0,this.preferences.focusEnds-Date.now())}, chatBusy:this.chatBusy, visionActive:this.visionActive, character:{...this.character}, modelReady: Boolean(this.character.modelId), petReady: true, active: [...this.windows.keys()] }; }
  updatePrefs(patch) { return this.setPreferences(patch); }
  async closeChoice(mode, {remember=false}={}) { if(remember && CLOSE_ACTIONS.has(mode))await this.setPreferences({closeAction:mode}); if (mode === 'quit') { this.quit(); return; } if (!MODES.has(mode)) throw Error('无效的关闭选项'); await this.setMode(mode); this.mainWindow?.hide(); this.refreshActivity(); this.emit(); return this.getState(); }
  async setPreferences(patch) {
    if (this.preferencesReadError) {
      await fs.copyFile(path.join(this.dataDir, 'companions.json'), path.join(this.dataDir, `companions.corrupt-${Date.now()}.json`));
      this.preferencesReadError = false;
    }
    const previousPosition = this.preferences.position, previousRenderer = this.preferences.petRenderer;
    const next = sanitizePreferences(patch, this.preferences);
    if(JSON.stringify(next.proactive)!==JSON.stringify(this.preferences.proactive)||next.quietMode||next.focusEnds>Date.now()||next.mode==='none'||!next.showBubbles)this.cancelProactive();
    if(next.startup!==this.preferences.startup){
      if(!this.startupAvailable)throw Error('开机启动仅在已安装的 Windows 或 macOS 版本可设置。');
      this.e.app.setLoginItemSettings({openAtLogin:next.startup});
      if(!!this.e.app.getLoginItemSettings().openAtLogin!==next.startup)throw Error('系统未保存开机启动设置，请检查系统登录项权限。');
    }
    this.preferences = next;
    if(next.petRenderer!==previousRenderer)this.walkFraction={x:0,y:0};
    this.reminders.configure({enabled:next.breakReminders,intervalMinutes:next.breakIntervalMinutes});
    this.reminders.configureProactive(next.proactive);
    if (this.preferences.position !== previousPosition) this.preferences.positions = {};
    this.applyMode();
    for (const [kind, win] of this.windows) {
      const bounds = this.boundsFor(kind);
      const current=win.getBounds();
      if(this.drag?.kind!==kind&&['x','y','width','height'].some(key=>current[key]!==bounds[key]))win.setBounds(bounds);
      win.setAlwaysOnTop(this.preferences.alwaysOnTop, 'floating'); this.sendState(win, kind);
    }
    for(const [kind,menu] of this.menus){const owner=this.windows.get(kind);if(!owner)continue;const anchor=owner.getBounds(),area=this.e.screen.getDisplayNearestPoint({x:anchor.x+anchor.width/2,y:anchor.y+anchor.height/2}).workArea,bounds=adjacentMenuBounds(anchor,area);if(!bounds){this.closeMenu(kind);this.openMain();this.onOpenSettings('avatar');}else{menu.setBounds(bounds);menu.setAlwaysOnTop(this.preferences.alwaysOnTop,'floating');this.sendState(menu,kind,true);}}
    await this.persist(); this.emit(); return this.getState();
  }
  setCharacter(value={}) {
    const next={id:typeof value.id==='string'?value.id.slice(0,120):'yukino',name:typeof value.name==='string'?value.name.slice(0,120):'雪之下雪乃',modelId:typeof value.modelId==='string'?value.modelId.slice(0,200):'',...(value.presentation&&typeof value.presentation==='object'?{presentation:{scene:value.presentation.scene,timeOfDay:value.presentation.timeOfDay,renderStyle:value.presentation.renderStyle,daylightLocation:daylightLocation(value.presentation.daylightLocation)}}:{})};
    // A conversation belongs to the character identity, not the currently worn model.
    // Clear before broadcasting the new identity so no window receives its predecessor's reply.
    if(next.id!==this.character.id){this.cancelProactive();this.walkFraction={x:0,y:0};this.reply=null;this.setMouthLevel(0);this.clearSpeechSnapshot();}
    this.character=next;
    for(const [kind,win] of this.windows)this.sendState(win,kind);
    for(const [kind,win] of this.menus)this.sendState(win,kind,true);
    this.emit();
  }
  clearSpeechSnapshot(){const win=this.windows.get('model');if(win&&!win.isDestroyed())win.webContents.send('companion-speech',null);}
  setSpeechSnapshot(value){const snapshot=speechSnapshot(value);if(snapshot.characterId!==this.character.id||snapshot.sequence<=(this.speechSequence??-1))return false;this.speechSequence=snapshot.sequence;const win=this.windows.get('model');if(win&&!win.isDestroyed())win.webContents.send('companion-speech',snapshot);return true;}
  resetSpeechClock(){this.speechSequence=-1;this.clearSpeechSnapshot();}
  setMouthLevel(level){const win=this.windows.get('model');if(win&&!win.isDestroyed())win.webContents.send('companion-mouth',level);}
  setVisionActive(value){this.visionActive=value===true;if(this.visionActive)this.cancelProactive();for(const [kind,win] of this.windows)this.sendState(win,kind);this.emit();}
  showError(input){const kind=input&&typeof input==='object'&&input.kind==='voice'?'voice':'chat',message=typeof input==='string'?input:input?.message;const value=typeof message==='string'?message.slice(0,400):'请求没有完成';for(const win of this.windows.values())if(!win.isDestroyed())win.webContents.send('companion-action',{name:'chat-error',kind,message:value});}
  clearCapabilityError(kind){if(!['chat','voice'].includes(kind))return;for(const win of this.windows.values())if(!win.isDestroyed())win.webContents.send('companion-action',{name:'capability-recovered',kind});}
  setSpeechBusy(value){this.speechBusy=value===true;if(this.speechBusy)this.cancelProactive();for(const [kind,win] of this.windows){if(this.speechBusy)win.webContents.send('companion-action',{name:'audio-stop'});this.sendState(win,kind);}}
  setChatBusy(value) { this.chatBusy=value===true;if(this.chatBusy)this.cancelProactive(); for(const [kind,win] of this.windows)this.sendState(win,kind); for(const [kind,win] of this.menus)this.sendState(win,kind,true); this.emit(); }
  setMode(mode) { return this.setPreferences({ mode }); }
  showReply(reply) {
    // Chat already has its own 160k generation limit; never truncate a reply
    // when forwarding it to the desktop windows. Their body scrolls separately.
    this.reply = { zh: typeof reply?.zh === 'string' ? reply.zh : '', ja: typeof reply?.ja === 'string' ? reply.ja : '', id: typeof reply?.id === 'string' ? reply.id : '' };
    for (const [kind, win] of this.windows) this.sendState(win, kind);
  }
  clearReply() { this.reply = null; for (const [kind, win] of this.windows) this.sendState(win, kind); }
  boundsFor(kind) {
    const scale = this.preferences.scale;
    const saved = this.preferences.positions[kind];
    const area = (saved ? this.e.screen.getDisplayNearestPoint(saved) : this.e.screen.getPrimaryDisplay()).workArea;
    const {width,height}=viewportSize(kind,scale,area);
    const offset = this.preferences.mode === 'both' && kind === 'model' ? Math.round(230 * scale) : 0;
    const bounds={ x: saved?.x ?? (this.preferences.position === 'left' ? area.x + 24 + offset : area.x + area.width - width - 24 - offset), y: saved?.y ?? area.y + area.height - height, width, height };
    const areas=this.e.screen.getAllDisplays?.().map(item=>item.workArea)||[area];
    return clampSubject(bounds,saved?.body,areas)||clampBounds(bounds,area);
  }
  applyMode() {
    const desired = kindsForMode(this.preferences.mode);
    for (const [kind, win] of this.windows) if (!desired.includes(kind)) { if(this.drag?.kind===kind)this.drag=null; this.windows.delete(kind); this.closeMenu(kind); win.destroy(); }
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
    win.on('closed', () => { this.closeMenu(kind); if (this.windows.get(kind) === win) this.windows.delete(kind); this.refreshActivity(); });
    win.loadFile(path.join(__dirname, kind==='model'?'../dist/model-window.html':'companion-view/index.html'), { query: { kind } }).catch(error => this.onError(error));
    return win;
  }
  sendState(win, kind, menu=false) { if (!win.isDestroyed()) win.webContents.send('companion-state', { kind, menu, playbackPaused:this.pauses.size>0, speechBusy:this.speechBusy===true, chatBusy:this.chatBusy, visionActive:this.visionActive, viewportScale:Math.min(this.preferences.scale,Math.max(.25,(win.getBounds().height-190)/(kind==='pet'?208:280)),Math.max(.25,(win.getBounds().width-28)/192)), startupAvailable:this.startupAvailable, preferences: this.preferences, voiceRevision:this.voiceRevision||0, reply: this.reply, focus:{active:this.preferences.focusEnds>Date.now(),remainingMs:Math.max(0,this.preferences.focusEnds-Date.now())}, character:{...this.character}, modelReady:Boolean(this.character.modelId) }); }
  async viewCall(event, action, payload) {
    const entry = [...this.windows,...this.menus].find(([, win]) => !win.isDestroyed() && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame);
    if (!entry) throw Error('不允许的桌宠调用');
    const [kind, win] = entry;
    const isMenu=this.menus.get(kind)===win;
    if(isMenu&&!['ready','catalog','voice-url','settings','prefs','action','hide','quit','open-main','menu-close','menu-open'].includes(action))throw Error('设置窗口不允许该操作');
    if(action==='video-pack'){
      if(isMenu||kind!=='pet'||this.preferences.petRenderer!=='video-preview'||this.character.id!=='yukino')throw Error('仅已选择连续动画预览的雪乃桌宠可读取该素材。');
      const pack=await verifyVideoPreviewPack();
      if(this.windows.get('pet')!==win||win.isDestroyed()||this.preferences.petRenderer!=='video-preview'||this.character.id!=='yukino')throw Error('连续动画预览选择已改变。');
      return pack;
    }
    if(action==='model-character'){if(isMenu||kind!=='model')throw Error('仅人物窗口可读取模型配置');return {...this.character};}
    if(action==='model-catalog'){if(isMenu||kind!=='model')throw Error('仅人物窗口可读取模型目录');return this.onModelCatalog();}
    if(action==='model-data'){if(isMenu||kind!=='model')throw Error('仅人物窗口可读取模型资源');const id=payload===undefined?this.character.modelId:payload;if(typeof id!=='string'||!id||id!==this.character.modelId)throw Error('请选择当前人物的模型资源');return this.onModelData(id);}
    if(action==='menu-open'){return this.openMenu(kind);}
    if(action==='menu-close'){this.closeMenu(kind);return true;}
    if(action==='chat-submit'){
      if(this.chatBusy)throw Error('正在回复，请先停止当前回复。');
      if(typeof payload!=='string'||!payload.trim()||payload.length>24000||/[\r\n]/.test(payload))throw Error('请输入单行消息，最多 24000 字符。');
      this.setChatBusy(true);
      try {const accepted=await this.onChat(payload.trim());if(accepted===false){this.setChatBusy(false);throw Error('聊天尚未准备好，请打开主窗口检查对话设置。');}return true;}catch(error){this.setChatBusy(false);throw error;}
    }
    if(action==='chat-stop'){await this.onChatStop();return true;}
    if(action==='vision-stop'){await this.onVisionStop();return true;}
    if(action==='vision-open'){const opened=await this.onVision(win,kind);if(opened===false)throw Error('视觉窗口已关闭，请重新打开。');return true;}
    if (action === 'catalog') return {voices:(this.voiceCatalog?.files||[]).map(item=>item.file).filter(name=>/^[A-Za-z0-9_-]+\.ogg$/.test(name))};
    if (action === 'voice-url') {if(this.speechBusy)throw Error('角色正在朗读，请等待或停止。');return this.voiceUrl(payload);}
    if (action === 'settings') { this.closeMenu(kind); this.openMain(); this.onOpenSettings('avatar'); return true; }
    if (action === 'prefs') { const allowed=['animation','interactionPaused','quietMode','randomQuotes','interactionQuotes','nightReminders','showBubbles','soundEnabled','soundVolume','opacity','scale','alwaysOnTop','mouseThrough','startup','bubbleLanguage','inputPosition','breakReminders','breakIntervalMinutes','petRenderer']; const patch=Object.fromEntries(Object.entries(payload||{}).filter(([key])=>allowed.includes(key))); return this.setPreferences(patch); }
    if (action === 'action'){this.onUse();return this.performAction(payload);}
    if (action === 'quote') return this.pickQuote(payload);
    if (action === 'cursor') { const cursor=this.e.screen.getCursorScreenPoint();const bounds=win.getBounds();return {x:cursor.x-bounds.x,y:cursor.y-bounds.y}; }
    if (action === 'hide') return this.setMode(this.preferences.mode === 'both' ? (kind === 'pet' ? 'model' : 'pet') : 'none');
    if (action === 'quit') {this.quit();return true;}
    if (action === 'ready') { this.sendState(win, kind,isMenu); return true; }
    if (action === 'open-main') { this.openMain(); return true; }
    if (action === 'hit-test') { if(typeof payload!=='boolean')throw Error('无效的命中状态');if(this.drag?.kind===kind&&!payload)return true;win.setIgnoreMouseEvents(!payload, { forward: true }); return true; }
    if (action === 'drag-start') { this.onUse(); this.walkFraction={x:0,y:0}; const point = this.e.screen.getCursorScreenPoint(); const [x,y] = win.getPosition(); this.closeMenu(kind); this.drag = { kind, point, inputPoint:validDragPoint(payload?.point), x, y, width:win.getBounds().width, height:win.getBounds().height,body:validBody(payload?.body) }; win.setIgnoreMouseEvents(false); return true; }
    if (action === 'drag-move' && this.drag?.kind === kind) {
      moveDraggedWindow(win,this.drag,this.e.screen); return true;
    }
    if (['drag-end','drag-cancel'].includes(action) && this.drag?.kind === kind) {
      // A release can arrive before the coalesced animation-frame move. Flush
      // its release position, but never move a click or a cancel.
      if(action==='drag-end'&&payload?.moved===true)moveDraggedWindow(win,this.drag,this.e.screen,validDragPoint(payload.point));
      const body=this.drag.body;this.drag = null;const [x,y] = win.getPosition();this.preferences.positions[kind] = {x,y,...(body?{body}:{})};this.sendState(win,kind);await this.persist(); return true;
    }
    if (action === 'walk-step' && kind === 'pet' && !this.drag && this.preferences.animation && !this.preferences.interactionPaused && !this.preferences.quietMode && this.preferences.focusEnds<=Date.now() && !this.chatBusy && !this.menus.has(kind) && (payload === -1 || payload === 1 || (payload&&Number.isFinite(payload.x)&&Number.isFinite(payload.y)&&Math.abs(payload.x)<=1&&Math.abs(payload.y)<=1))) {
      const bounds = win.getBounds(); const area = this.e.screen.getDisplayNearestPoint({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }).workArea;
      const elapsed=typeof payload==='object'&&Number.isFinite(payload.elapsedMs)?Math.max(0,Math.min(100,payload.elapsedMs)):100;
      const videoPreview=this.preferences.petRenderer==='video-preview'&&this.character.id==='yukino';
      if(videoPreview&&(this.character.id!=='yukino'||payload?.videoPreview!==true||![1,-1].includes(payload.x)||payload.y!==0||!Number.isFinite(payload.elapsedMs)||this.pauses.size>0||!win.isVisible()))return false;
      if(!videoPreview&&payload?.videoPreview===true)return false;
      const viewportScale=Math.min(this.preferences.scale,Math.max(.25,(bounds.height-190)/208),Math.max(.25,(bounds.width-28)/192));
      const travel=videoPreview?VIDEO_GAIT.strideHeightRatio*VIDEO_GAIT.subjectHeight*viewportScale*elapsed/VIDEO_GAIT.durationMs:30*this.preferences.scale*elapsed/1000;
      this.walkFraction ||= {x:0,y:0};this.walkFraction.x+=travel*(typeof payload==='number'?payload:payload.x);this.walkFraction.y+=travel*(typeof payload==='number'?0:payload.y);
      const dx=Math.trunc(this.walkFraction.x),dy=Math.trunc(this.walkFraction.y);this.walkFraction.x-=dx;this.walkFraction.y-=dy;
      if(!dx&&!dy)return true;
      // Dragging permits transparent window margins outside a display while the
      // visible figure stays on screen. Walking must use that same body, or a
      // full-window clamp can abruptly move the pet opposite its gait.
      const body=validBody(this.preferences.positions[kind]?.body);
      const areas=this.e.screen.getAllDisplays?.().map(display=>display.workArea)||[area];
      const candidate={...bounds,x:bounds.x+dx,y:bounds.y+dy};
      const next=clampSubject(candidate,body,areas)||clampBounds(candidate,area);
      const movedX=next.x-bounds.x,movedY=next.y-bounds.y;
      // A correction across a display gap or stale saved geometry must never
      // turn a left/right or vertical step into movement in another direction.
      if((dx===0?movedX!==0:movedX*dx<0||Math.abs(movedX)>Math.abs(dx))||
         (dy===0?movedY!==0:movedY*dy<0||Math.abs(movedY)>Math.abs(dy))){
        this.walkFraction={x:0,y:0};return false;
      }
      if (next.x === bounds.x && next.y === bounds.y) {this.walkFraction={x:0,y:0};return false;} moveWindow(win,next); this.preferences.positions[kind] = { x: next.x, y: next.y, ...(body?{body}:{}) }; return true;
    }
    if (action === 'menu') { this.contextMenu(kind, win); return true; }
    return false;
  }
  contextMenu(kind) { return this.openMenu(kind); }
  openMenu(kind) {
    const existing=this.menus.get(kind);if(existing&&!existing.isDestroyed()){existing.show();existing.focus();return true;}
    const owner=this.windows.get(kind);if(!owner||owner.isDestroyed())return false;
    if(this.drag?.kind===kind)this.drag=null;
    const anchor=owner.getBounds(),area=this.e.screen.getDisplayNearestPoint({x:anchor.x+anchor.width/2,y:anchor.y+anchor.height/2}).workArea;
    const bounds=adjacentMenuBounds(anchor,area);
    if(!bounds){this.openMain();this.onOpenSettings('avatar');return false;}
    const popup=new this.e.BrowserWindow({...bounds,frame:false,transparent:false,resizable:false,maximizable:false,minimizable:false,skipTaskbar:true,show:false,alwaysOnTop:this.preferences.alwaysOnTop,backgroundColor:'#f5f9ff',webPreferences:{preload:path.join(__dirname,'companion-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:true}});
    this.menus.set(kind,popup);owner.webContents.send('companion-action',{name:'menu-opened'});
    popup.webContents.setWindowOpenHandler(()=>({action:'deny'}));popup.webContents.on('will-navigate',event=>event.preventDefault());
    popup.webContents.on('did-finish-load',()=>this.sendState(popup,kind,true));
    popup.on('ready-to-show',()=>{if(!popup.isDestroyed()){popup.show();popup.focus();}});
    popup.on('closed',()=>{if(this.menus.get(kind)===popup)this.menus.delete(kind);if(!owner.isDestroyed())owner.webContents.send('companion-action',{name:'menu-closed'});});
    popup.loadFile(path.join(__dirname,'companion-view/index.html'),{query:{kind,view:'menu'}}).catch(error=>{this.closeMenu(kind);this.onError(error);});return true;
  }
  closeMenu(kind) { const popup=this.menus.get(kind);if(popup){this.menus.delete(kind);if(!popup.isDestroyed())popup.destroy();} }

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
    if(this.preferences.petRenderer==='video-preview'&&this.character.id==='yukino'&&['greet','head-tilt','jump','sit'].includes(action))throw Error('连续动画预览仅支持待机、左右散步和拖动位置；其他动作请切回原 Q 版桌宠。');
    if(action==='focus-cancel'){await this.setPreferences({focusEnds:0});return this.getState();}
    if(action.startsWith('focus-')) { await this.setPreferences({focusEnds:Date.now()+Number(action.slice(6))*60000});return this.getState(); }
    if(!this.windows.has('pet'))await this.setMode(this.preferences.mode==='model'?'both':'pet');
    const win=this.windows.get('pet');this.closeMenu('pet');
    if(action==='voice'&&!this.preferences.soundEnabled)await this.setPreferences({soundEnabled:true});
    const send=()=>{if(!win.isDestroyed())win.webContents.send('companion-action',{name:action});};
    if(win.webContents.isLoading?.())win.webContents.once('did-finish-load',send);else send();
    return this.getState();
  }
  reminderActivity(){let idle=Infinity;try{idle=this.e.powerMonitor.getSystemIdleTime()}catch{}return {companionVisible:[...this.windows.values()].some(win=>!win.isDestroyed()&&win.isVisible()&&!win.isMinimized?.()),locked:this.pauses.has('lock'),suspended:this.pauses.has('sleep'),systemIdleSeconds:idle,quiet:this.preferences.quietMode,focus:this.preferences.focusEnds>Date.now(),chatBusy:this.chatBusy,speechBusy:this.speechBusy===true,visualBusy:this.visionActive||!!this.proactiveController,showBubbles:this.preferences.showBubbles,hour:new Date().getHours()};}
  cancelProactive(){const controller=this.proactiveController;if(!controller)return;this.proactiveController=null;controller.abort();this.proactiveStatus={phase:'idle'};}
  async deliverProactive(event){
    if(event.mode==='fixed'){this.showReply({id:event.id,zh:event.text,ja:''});this.onReminder(event);return;}
    const controller=new AbortController(),characterId=this.character.id;this.proactiveController=controller;this.proactiveStatus={phase:'generating'};this.emit();
    try{
      const result=await this.onProactive(event,{signal:controller.signal,characterId});
      const activity=this.reminderActivity();
      if(this.proactiveController!==controller||controller.signal.aborted||this.quitting||characterId!==this.character.id||!this.preferences.proactive.enabled||this.preferences.proactive.mode!=='generate'||!this.preferences.showBubbles||!activity.companionVisible||activity.locked||activity.suspended||!Number.isFinite(activity.systemIdleSeconds)||activity.systemIdleSeconds<0||activity.systemIdleSeconds>=300||activity.quiet||activity.focus||activity.chatBusy||activity.speechBusy||this.visionActive||!withinHours(activity.hour,this.preferences.proactive.startHour,this.preferences.proactive.endHour))return;
      if(typeof result?.zh!=='string'||!result.zh.trim())throw Error('模型没有返回有效的中文主动消息');
      const text=result.zh.trim().slice(0,1000);this.proactiveController=null;this.proactiveStatus={phase:'ready'};
      this.showReply({id:event.id,zh:text,ja:typeof result.ja==='string'?result.ja:''});this.onReminder({...event,text});
    }catch(error){if(this.proactiveController===controller&&!controller.signal.aborted)this.proactiveStatus={phase:'error',error:String(error?.message||'主动消息生成失败').slice(0,200)};}
    finally{if(this.proactiveController===controller){this.proactiveController=null;if(this.proactiveStatus.phase==='generating')this.proactiveStatus={phase:'idle'};}this.emit();}
  }
  tickFocus() {
    if(this.quitting)return;
    const reminder=this.reminders.tick(this.reminderActivity());if(reminder){if(reminder.type==='proactive-message')void this.deliverProactive(reminder);else{this.showReply({id:reminder.id,zh:reminder.text,ja:''});this.onReminder(reminder);}}
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
      ...[['none','隐藏桌面形象'],['model','只显示人物模型'],['pet','只显示桌宠'],['both','同时显示两种形象']].map(([mode,label]) => ({ label,type: 'radio',checked: this.preferences.mode === mode,click: () => this.setMode(mode).catch(this.onError) })),
      {label:'人物鼠标穿透',type:'checkbox',checked:this.preferences.mouseThrough,click:item=>this.setPreferences({mouseThrough:!!item.checked}).catch(this.onError)},
      { type: 'separator' }, { label: '完全退出',click: () => this.quit() },
    ]));
  }
  repositionAll() { for (const kind of [...this.menus.keys()])this.closeMenu(kind); for (const [kind, win] of this.windows) {win.setBounds(this.boundsFor(kind));this.sendState(win,kind);} }
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
    this.quitting = true;this.cancelProactive(); clearInterval(this.timer); clearInterval(this.focusTimer); this.usage.update({ main: false, companion: false });
    for (const cleanup of this.listeners.splice(0)) cleanup();
    for(const kind of [...this.menus.keys()])this.closeMenu(kind);
    for (const win of this.windows.values()) if (!win.isDestroyed()) win.destroy();
    this.windows.clear(); this.tray?.destroy(); this.tray = null;
    await Promise.all([this.persist(), this.usage.save()]);
  }
}
module.exports = { CompanionManager, DEFAULTS, sanitizePreferences, kindsForMode, clampBounds, viewportSize, adjacentMenuBounds };
