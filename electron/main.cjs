const electron = require('electron');
const {app, BrowserWindow, ipcMain, safeStorage, shell, session, dialog, net} = electron;
const fs = require('node:fs/promises');
const path = require('node:path');
const {chat, endpoint} = require('./chat.cjs');
const {migratePersonaState, characterInfo, characterDocument, buildPersonaPrompt, preparePersonaChat} = require('./persona.cjs');
const {SpeechService, validateSettings} = require('./speech.cjs');
const {VoiceResources} = require('./voice-resources.cjs');
const {bundledVoiceDefaults} = require('./bundled-voice.cjs');
const {TranslationService, validateConfig: validateTranslation} = require('./translation.cjs');
const {BILINGUAL_INSTRUCTION, BilingualStream, completeBilingual} = require('./bilingual.cjs');
const {CompanionManager} = require('./companions.cjs');
const voiceCatalog = require('../resources/voice-models.json');
const translationManifest = require('../translation/model-manifest.json');
const outputInstruction = local => local ? '请用简体中文自然回答。不要自行附加其他语言翻译。' : BILINGUAL_INSTRUCTION;
let win, controller, speech, voiceResources, voiceBundle, translation, companions;
let saveQueue = Promise.resolve(), shuttingDown = false, shutdownComplete = false, flushResolver;
function flushRenderer() {
  if(!win || win.isDestroyed()) return Promise.resolve();
  return new Promise(resolve => { const id=require('node:crypto').randomUUID(); const timer=setTimeout(()=>{flushResolver=null;resolve();},2000); flushResolver={id,resolve:()=>{clearTimeout(timer);flushResolver=null;resolve();}}; send('flush-state',{id}); });
}
const location = name => path.join(app.getPath('userData'), name);
const resourceRoot = () => app.isPackaged ? process.resourcesPath : path.join(__dirname, '../build');
const send = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };
async function read(name, fallback) {
  try { return JSON.parse(await fs.readFile(location(name), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw Error('本地数据读取失败，请保留数据并检查文件。'); }
}
function write(name, value) {
  const encoded = JSON.stringify(value);
  const job = saveQueue.then(async () => {
    await fs.mkdir(app.getPath('userData'), {recursive:true});
    await fs.writeFile(location(name + '.tmp'), encoded, 'utf8');
    await fs.rename(location(name + '.tmp'), location(name));
  });
  saveQueue = job.catch(() => {}); return job;
}
async function key(id) {
  const keys = await read('keys.json', {});
  return keys[id] ? safeStorage.decryptString(Buffer.from(keys[id], 'base64')) : '';
}
function handle(name, fn) {
  ipcMain.handle(name, async (event, ...args) => {
    if (!win || win.isDestroyed() || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw Error('不允许的调用');
    return fn(...args);
  });
}
function openMain() { if (win && !win.isDestroyed()) { win.show(); win.restore(); win.focus(); } }

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', openMain);
  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    win = new BrowserWindow({width:1280,height:840,minWidth:760,minHeight:580,frame:false,backgroundColor:'#f1f6fc',show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
    win.webContents.setWindowOpenHandler(() => ({action:'deny'}));
    win.webContents.on('will-navigate', event => event.preventDefault());
    const workerPath = name => app.isPackaged ? path.join(process.resourcesPath, name, 'worker.py') : path.join(__dirname, '..', name, 'worker.py');
    speech = new SpeechService({script:workerPath('inference'),stateDir:location('speech-runtime'),notify:status=>send('voice-status',status)});
    const bundleReady = bundledVoiceDefaults({resourceRoot:resourceRoot(),dataRoot:app.getPath('userData')}).then(async bundle => {
      voiceBundle = bundle;
      voiceResources = new VoiceResources({root:bundle.modelRoot,catalog:voiceCatalog,fetcher:(url,options)=>net.fetch(url,options),notify:status=>send('voice-download',status)});
      const savedVoice = await read('speech.json', {}), savedTranslation = await read('translation.json', {});
      const modelDir = app.isPackaged ? path.join(process.resourcesPath,'translation-models',translationManifest.directory) : path.join(__dirname,'../translation/models',translationManifest.directory);
      translation = new TranslationService({script:workerPath('translation'),stateDir:location('translation-runtime'),modelDir,python:bundle.defaults.python||savedVoice.python||process.env.YUKINO_PYTHON||'',fetcher:(url,options)=>net.fetch(url,options),notify:status=>send('translation-status',status)});
      translation.configure({...savedTranslation,python:savedTranslation.python||translation.config.python,modelDir:savedTranslation.modelDir||modelDir});
      return bundle;
    });
    bundleReady.catch(error => send('voice-status',{phase:'error',error:error.message}));
    companions = new CompanionManager({electron,dataDir:app.getPath('userData'),onOpenMain:openMain,onQuit:()=>app.quit(),onChange:state=>send('companion-state',state),onCloseRequested:()=>send('close-requested'),onError:error=>send('app-error',{message:error.message})});
    await companions.initialize(); companions.attachMainWindow(win);

    handle('flush-complete', id=>{if(flushResolver?.id===id)flushResolver.resolve();});
    handle('load', async () => {
      const saved = await read('state.json',null);
      return {state:saved?migratePersonaState(saved):null,keyIds:Object.keys(await read('keys.json',{})),character:characterInfo()};
    });
    handle('save', async state => {
      if (!state || !Array.isArray(state.conversations) || !Array.isArray(state.profiles) || JSON.stringify(state).length > 10000000) throw Error('无效或过大的设置');
      return write('state.json',migratePersonaState(state));
    });
    handle('character-document', () => characterDocument());
    handle('character-preview', async () => {
      const saved = migratePersonaState(await read('state.json',{}));
      const selected = saved.profiles?.find(p=>p.id===saved.activeProfile)||{};
      const prompt = buildPersonaPrompt(saved,selected);
      const content=prompt.content+'\n\n'+outputInstruction(saved.translationMode==='local'||prompt.local);
      return {characters:content.length,mode:prompt.mode,enabled:prompt.enabled,local:prompt.local};
    });
    handle('key', async (id,value) => {
      if(typeof id!=='string'||typeof value!=='string'||value.length>8192) throw Error('密钥格式无效');
      const keys = await read('keys.json',{});
      if(value){
        if(!safeStorage.isEncryptionAvailable()||(process.platform==='linux'&&safeStorage.getSelectedStorageBackend()==='basic_text')) throw Error('系统安全存储不可用');
        keys[id]=safeStorage.encryptString(value).toString('base64');
      } else delete keys[id];
      await write('keys.json',keys);
    });
    async function config(id) {
      const state = await read('state.json',null), profile = state?.profiles.find(p=>p.id===id);
      if(!profile?.base||!profile?.model) throw Error('请先保存 API 地址和模型名称');
      endpoint(profile.base); return {profile,key:await key(id),state:migratePersonaState(state)};
    }
    handle('test', async id => {
      const settings = await config(id); let output='';
      await chat({...settings,messages:[{role:'user',content:'Reply with OK.'}],signal:AbortSignal.timeout(20000),onToken:text=>output+=text});
      if(!output) throw Error('连接成功但未返回正文'); return '连接成功 · 模型已返回内容';
    });
    handle('chat', async ({id,profileId,messages}) => {
      if(controller) throw Error('请先停止当前回复');
      if(typeof id!=='string'||id.length>200||!Array.isArray(messages)||messages.length>200||messages.some(m=>!m||!['system','user','assistant'].includes(m.role)||typeof m.content!=='string'||m.content.length>100000)) throw Error('消息格式不正确');
      const ctrl = new AbortController(); controller=ctrl;
      let timer = setTimeout(()=>ctrl.abort(),180000);
      try {
        const settings = await config(profileId);
        ctrl.signal.throwIfAborted();
        const prepared = preparePersonaChat(settings.state,settings.profile,messages);
        const localTranslation = settings.state.translationMode === 'local' || prepared.localRoleplay;
        prepared.messages[0].content += '\n\n' + outputInstruction(localTranslation);
        let raw = '';
        const parser = new BilingualStream(text=>send('chunk',{id,text}));
        await chat({...settings,...prepared,signal:ctrl.signal,onToken:text=>{
          raw+=text; if(raw.length>160000) throw Error('模型回复过长');
          if(localTranslation) send('chunk',{id,text}); else parser.push(text);
        }});
        ctrl.signal.throwIfAborted();
        clearTimeout(timer); timer=setTimeout(()=>ctrl.abort(),300000);
        const pair = localTranslation ? {zh:raw,ja:''} : parser.value();
        const bilingual = await completeBilingual(pair,{requestId:id,signal:ctrl.signal,preferLocal:localTranslation,translate:async (request,options)=>{await bundleReady;return translation.translate(request,options);}});
        ctrl.signal.throwIfAborted();
        companions.showReply({id,...bilingual});
        return {ok:true,bilingual};
      } catch(error) {
        if(ctrl.signal.aborted) return {stopped:true}; throw error;
      } finally {clearTimeout(timer);if(controller===ctrl)controller=null;}
    });
    handle('stop',()=>{controller?.abort();translation?.cancel();});

    handle('voice-settings',async()=>{
      const bundle=await bundleReady,saved=await read('speech.json',{}),config={...bundle.defaults,...saved};
      for(const key of ['root','python','ffmpeg','bert','hubert']) if(!config[key])config[key]=bundle.defaults[key];
      return validateSettings(config);
    });
    handle('voice-resources',async()=>{await bundleReady;return {...voiceResources.summary(),bundled:voiceBundle.bundled};});
    handle('voice-install',async(id='core')=>{await bundleReady;return voiceResources.install(id);});
    handle('voice-download-cancel',()=>voiceResources?.cancel());
    handle('voice-save',async raw=>{
      const value=validateSettings(raw),previous=await read('speech.json',{});
      const ignored=new Set(['enabled','volume']);
      if(Object.keys(value).some(k=>!ignored.has(k)&&value[k]!==previous[k])) speech.unload();
      await write('speech.json',value);if(translation&&!translation.config.python&&value.python)translation.configure({python:value.python});return value;
    });
    handle('voice-status',()=>speech.status);
    handle('voice-probe',config=>speech.probe(config));
    handle('voice-load',config=>speech.load(config));
    handle('voice-unload',()=>speech.unload());
    handle('voice-begin',id=>speech.begin(id));
    handle('voice-synthesize',(id,text)=>speech.synthesize(id,text));
    handle('voice-stop',id=>speech.stop(id));
    handle('voice-pick',async kind=>{
      const directories=['root','bert','hubert'];
      const filters={python:[{name:'Python',extensions:process.platform==='win32'?['exe']:['*']}],gpt:[{name:'GPT weights',extensions:['ckpt']}],sovits:[{name:'SoVITS weights',extensions:['pth']}],reference:[{name:'Reference audio',extensions:['wav','flac']}],ffmpeg:[{name:'FFmpeg',extensions:process.platform==='win32'?['exe']:['*']}]};
      if(!directories.includes(kind)&&!filters[kind]) throw Error('无效文件选择类型');
      const result=await dialog.showOpenDialog(win,{title:'选择语音推理资源',properties:[directories.includes(kind)?'openDirectory':'openFile'],...(filters[kind]?{filters:filters[kind]}:{})});
      return result.canceled?null:result.filePaths[0];
    });
    handle('translation-status',async()=>{await bundleReady;return translation.status();});
    handle('translation-save',async raw=>{
      await bundleReady;
      const savedVoice=await read('speech.json',{});
      const fallbackModel=app.isPackaged?path.join(process.resourcesPath,'translation-models',translationManifest.directory):path.join(__dirname,'../translation/models',translationManifest.directory);
      const value=validateTranslation({...translation.config,...raw,python:raw?.python||voiceBundle.defaults.python||savedVoice.python||process.env.YUKINO_PYTHON||translation.config.python,modelDir:raw?.modelDir||translation.config.modelDir||fallbackModel});
      translation.configure(value);await write('translation.json',value);return translation.status();
    });
    handle('translation-install',async()=>{await bundleReady;const status=await translation.install();await write('translation.json',status.config);return status;});
    handle('translation-cancel',id=>translation?.cancel(id));
    handle('translate',async request=>{await bundleReady;return translation.translate(request);});
    handle('translation-pick',async kind=>{
      if(!['python','modelDir'].includes(kind)) throw Error('无效翻译资源类型');
      const result=await dialog.showOpenDialog(win,{title:'选择本地翻译资源',properties:[kind==='modelDir'?'openDirectory':'openFile']});return result.canceled?null:result.filePaths[0];
    });
    handle('companion-state',()=>companions.getState());
    handle('companion-set',patch=>companions.updatePrefs(patch));
    handle('close-choice',mode=>companions.closeChoice(mode));
    handle('window',action=>{if(action==='minimize')win.minimize();if(action==='maximize')win.isMaximized()?win.unmaximize():win.maximize();if(action==='close')win.close();});
    handle('community',()=>shell.openExternal('https://github.com/fqxxzyw/Yukino-Companion'));
    win.on('closed',()=>{controller?.abort();speech?.dispose();translation?.dispose();});
    win.webContents.on('render-process-gone',()=>{controller?.abort();speech?.dispose();translation?.cancel();voiceResources?.cancel();});
    await win.loadFile(path.join(__dirname,'../dist/index.html'));
    win.show();
  }).catch(error=>{dialog.showErrorBox('Yukino Companion 启动失败',error.message);app.quit();});
}
app.on('activate',openMain);
app.on('window-all-closed',()=>{if(!companions || companions.quitting)app.quit();});
app.on('before-quit',event=>{
  if(shutdownComplete)return;
  event.preventDefault();if(shuttingDown)return;shuttingDown=true;
  controller?.abort();speech?.dispose();translation?.dispose();voiceResources?.cancel();
  if(companions)companions.quitting=true;
  flushRenderer().then(()=>Promise.allSettled([companions?.dispose(),saveQueue])).finally(()=>{shutdownComplete=true;app.quit();});
});
