const electron = require('electron');
const {app, BrowserWindow, ipcMain, safeStorage, shell, session, dialog, net} = electron;
const fs = require('node:fs/promises');
const path = require('node:path');
const {chat, endpoint} = require('./chat.cjs');
const {migratePersonaState, characterInfo, characterDocument, buildPersonaPrompt, preparePersonaChat} = require('./persona.cjs');
const {SpeechService, validateSettings} = require('./speech.cjs');
const {VoiceResources} = require('./voice-resources.cjs');
const {bundledVoiceDefaults, mergeVoiceDefaults} = require('./bundled-voice.cjs');
const {LocalChatService} = require('./local-chat.cjs');
const {RuntimeManager} = require('./runtime-manager.cjs');
const {SetupService} = require('./setup.cjs');
const {providerCatalog, discoverModels} = require('./providers.cjs');
const {TranslationService, validateConfig: validateTranslation} = require('./translation.cjs');
const {BILINGUAL_INSTRUCTION, BilingualStream, completeBilingual} = require('./bilingual.cjs');
const {CompanionManager} = require('./companions.cjs');
const voiceCatalog = require('../resources/voice-models.json');
const translationManifest = require('../translation/model-manifest.json');
const outputInstruction = local => local ? '请用简体中文自然回答。不要自行附加其他语言翻译。' : BILINGUAL_INSTRUCTION;
let win, controller, speech, voiceResources, voiceBundle, translation, companions, localChat, runtime, setup;
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
function apiOrigin(base) { endpoint(base); return new URL(base).origin; }
async function migrateKeys() {
  const keys=await read('keys.json',{}),state=await read('state.json',{});let changed=false;
  for(const [id,value] of Object.entries(keys))if(typeof value==='string'){
    let origin='';try{origin=apiOrigin(state?.profiles?.find(p=>p.id===id)?.base);}catch{}
    keys[id]={ciphertext:value,origin};changed=true;
  }
  if(changed)await write('keys.json',keys);
}
async function key(id,base) {
  const keys = await read('keys.json', {}), record=keys[id];
  if(!record)return '';
  if(!record.origin||record.origin!==apiOrigin(base))throw Error('API 地址已变更，请重新验证并保存该服务的密钥。');
  return safeStorage.decryptString(Buffer.from(record.ciphertext,'base64'));
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
    app.setAppUserModelId?.('io.github.fqxxzyw.yukino');
    await migrateKeys();
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    win = new BrowserWindow({width:1280,height:840,minWidth:760,minHeight:580,frame:false,icon:path.join(__dirname,'../dist/yukino-icon.png'),backgroundColor:'#f1f6fc',show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
    win.webContents.setWindowOpenHandler(() => ({action:'deny'}));
    win.webContents.on('will-navigate', event => event.preventDefault());
    const workerPath = name => app.isPackaged ? path.join(process.resourcesPath, name, 'worker.py') : path.join(__dirname, '..', name, 'worker.py');
    speech = new SpeechService({script:workerPath('inference'),stateDir:location('speech-runtime'),notify:status=>send('voice-status',status)});
    runtime=new RuntimeManager({dataRoot:app.getPath('userData'),resourceRoot:resourceRoot(),catalogPath:path.join(resourceRoot(),'runtime-catalog.json'),fetcher:(url,options)=>net.fetch(url,options),notify:progress=>setup?.report('runtime',progress)});
    const modelDir=app.isPackaged?path.join(process.resourcesPath,'translation-models',translationManifest.directory):path.join(__dirname,'../translation/models',translationManifest.directory);
    const localModelDir=app.isPackaged?path.join(resourceRoot(),'local-model/yukino-1.5b-persona-q4'):path.join(__dirname,'../resources/local-model/yukino-1.5b-persona-q4');
    const localScript=app.isPackaged?path.join(process.resourcesPath,'local-chat/desktop_worker.py'):path.join(__dirname,'../model-service/desktop_worker.py');
    const bundleReady=(async()=>{
      const current=await runtime.current();
      voiceBundle=await bundledVoiceDefaults({resourceRoot:resourceRoot(),dataRoot:app.getPath('userData'),runtimeRoot:current.root});
      const savedVoice=await read('speech.json',{}), savedTranslation=await read('translation.json',{}),savedLocal=await read('local-chat.json',{});
      const python=current.python||voiceBundle.defaults.python||savedVoice.python||process.env.YUKINO_PYTHON||'';
      translation=new TranslationService({script:workerPath('translation'),stateDir:location('translation-runtime'),modelDir,python,fetcher:(url,options)=>net.fetch(url,options),notify:status=>{send('translation-status',status);setup?.report('translation',status);}});
      translation.configure({...savedTranslation,python:savedTranslation.python||python,modelDir:savedTranslation.modelDir||modelDir});
      if(!(await translation.status()).modelInstalled&&savedTranslation.modelDir?.startsWith(path.join(location('translation-runtime'),'models')+path.sep))translation.configure({modelDir});
      localChat=new LocalChatService({script:localScript,stateDir:location('local-chat-runtime'),modelDir:localModelDir,python,notify:status=>send('local-chat-status',status)});
      localChat.configure({...savedLocal,python:savedLocal.python||python,modelDir:savedLocal.modelDir||localModelDir});
      makeVoiceResources();
      speech.configure(mergeVoiceDefaults(savedVoice,voiceBundle));
      return voiceBundle;
    })();
    function makeVoiceResources(){
      voiceResources=new VoiceResources({root:voiceBundle.modelRoot,catalog:voiceCatalog,bundledRoot:path.join(resourceRoot(),'voice-models'),bundledPackId:voiceBundle.preset?.packId,fetcher:(url,options)=>net.fetch(url,options),notify:status=>{send('voice-download',status);setup?.report('voiceCore',status);}});
    }
    async function voiceConfig(){await bundleReady;return mergeVoiceDefaults(await read('speech.json',{}),voiceBundle);}
    async function refreshRuntime(){
      const previous=voiceBundle,current=await runtime.current(),saved=await read('speech.json',{});
      voiceBundle=await bundledVoiceDefaults({resourceRoot:resourceRoot(),dataRoot:app.getPath('userData'),runtimeRoot:current.root});
      for(const field of ['root','python','ffmpeg','bert','hubert'])if(!saved[field]||saved[field]===previous.defaults[field])saved[field]=voiceBundle.defaults[field];
      const value=mergeVoiceDefaults(saved,voiceBundle);await write('speech.json',value);speech.configure(value);makeVoiceResources();
      for(const service of [translation,localChat])if(!service.config.python||service.config.python===previous.defaults.python)service.configure({python:current.python||value.python});
      await write('translation.json',translation.config);await write('local-chat.json',localChat.config);
    }
    setup=new SetupService({prepare:()=>bundleReady,notify:status=>send('setup-status',status),inspect:async()=>{
      await bundleReady;
      const [environment,local,translated,voices,voice]=await Promise.all([runtime.status(),localChat.status(),translation.status(),voiceResources.inspect(),speech.readiness(await voiceConfig())]);
      const coreReady=!voice.missing?.some(x=>['bert','hubert'].includes(x.key));
      const presetReady=!voice.missing?.some(x=>['gpt','sovits','reference','promptText'].includes(x.key));
      return {runtimeFlavor:environment.flavor,runtimeVariants:environment.variants,device:environment.metadata?.gpuAvailable?'GPU':'CPU',steps:[
        {id:'runtime',state:environment.ready?'ready':'missing',detail:environment.ready?`公共推理环境已安装 · ${environment.flavor}`:'Python 与推理依赖将统一安装，不影响已内置的模型。'},
        {id:'chat',state:local.modelInstalled?'ready':'missing',detail:local.modelInstalled?'角色权重已内置，首次发送时自动加载。':'本地角色权重缺失，请检查安装分卷。'},
        {id:'translation',state:translated.modelInstalled?'ready':'missing',detail:translated.modelInstalled?'中日翻译权重已安装，不会重复下载。':'需要准备中日翻译权重。'},
        {id:'voiceCore',state:coreReady||voices.coreReady?'ready':'missing',detail:'语音合成共用的 BERT 与 HuBERT 组件。'},
        {id:'voicePreset',state:presetReady?'ready':'missing',detail:presetReady?'音色权重、日语参考声音及文本已配置。':'请在声音设置中选择完整音色及参考声音。'}]};
    },installRuntime:flavor=>runtime.install(flavor),refresh:refreshRuntime,
      installTranslation:async()=>{const status=await translation.install();await write('translation.json',status.config);return status;},
      installVoice:async signal=>{const config=await voiceConfig();signal.throwIfAborted();const status=await speech.readiness(config);signal.throwIfAborted();if(!status.missing?.some(item=>['bert','hubert'].includes(item.key)))return {};const paths=await voiceResources.install('core');const missing=new Set(status.missing?.map(item=>item.key));return Object.fromEntries(Object.entries(paths).filter(([key])=>missing.has(key)));},saveVoice:async paths=>{const config=mergeVoiceDefaults({...await read('speech.json',{}),...paths},voiceBundle);await write('speech.json',config);speech.configure(config);},
      cancel:()=>{runtime.cancel();translation?.cancel();voiceResources?.cancel();}});
    bundleReady.catch(error=>send('app-error',{message:error.message}));
    companions = new CompanionManager({electron,dataDir:app.getPath('userData'),onOpenMain:openMain,onOpenSettings:tab=>{openMain();send('open-settings',tab);},onQuit:()=>app.quit(),onChange:state=>send('companion-state',state),onCloseRequested:()=>send('close-requested'),onError:error=>send('app-error',{message:error.message})});
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
      const prompt = buildPersonaPrompt(saved,saved.chatMode==='local'?{id:'builtin-local',name:'本地雪乃',model:'oregairu-small',base:'http://127.0.0.1'}:selected);
      const content=prompt.content+'\n\n'+outputInstruction(saved.translationMode==='local'||prompt.local);
      return {characters:content.length,mode:prompt.mode,enabled:prompt.enabled,local:prompt.local};
    });
    handle('api-providers',()=>providerCatalog());
    handle('api-models',async ({profileId,base,providerId,key:providedKey}={})=>{
      if(typeof profileId!=='string'||!profileId||typeof base!=='string'||(providedKey!==undefined&&(typeof providedKey!=='string'||providedKey.length>8192)))throw Error('模型查询参数无效');
      endpoint(base);
      return discoverModels({profile:{id:profileId,base,providerId},key:providedKey||await key(profileId,base),signal:AbortSignal.timeout(30000),fetcher:(url,options)=>net.fetch(url,options)});
    });
    handle('key', async (id,value,base) => {
      if(typeof id!=='string'||typeof value!=='string'||value.length>8192) throw Error('密钥格式无效');
      const keys = await read('keys.json',{});
      if(value){
        if(!safeStorage.isEncryptionAvailable()||(process.platform==='linux'&&safeStorage.getSelectedStorageBackend()==='basic_text')) throw Error('系统安全存储不可用');
        const state=await read('state.json',{}),origin=apiOrigin(base||state?.profiles?.find(p=>p.id===id)?.base);
        keys[id]={ciphertext:safeStorage.encryptString(value).toString('base64'),origin};
      } else delete keys[id];
      await write('keys.json',keys);
    });
    async function config(id) {
      const state = await read('state.json',null), profile = state?.profiles.find(p=>p.id===id);
      if(!profile?.base||!profile?.model) throw Error('请先保存 API 地址和模型名称');
      endpoint(profile.base); return {profile,key:await key(id,profile.base),state:migratePersonaState(state)};
    }
    handle('test', async id => {
      const settings = await config(id); let output='';
      await chat({...settings,messages:[{role:'user',content:'Reply with OK.'}],signal:AbortSignal.timeout(20000),onToken:text=>output+=text});
      if(!output) throw Error('连接成功但未返回正文'); return '连接成功 · 模型已返回内容';
    });
    handle('chat', async ({id,profileId,messages,mode}) => {
      if(controller) throw Error('请先停止当前回复');
      if(typeof id!=='string'||id.length>200||!Array.isArray(messages)||messages.length>200||messages.some(m=>!m||!['system','user','assistant'].includes(m.role)||typeof m.content!=='string'||m.content.length>100000)) throw Error('消息格式不正确');
      const ctrl = new AbortController(); controller=ctrl;
      let timer = setTimeout(()=>ctrl.abort(),180000);
      try {
        const state=migratePersonaState(await read('state.json',{})),useLocal=(mode||state.chatMode)==='local';
        const settings=useLocal?{state,profile:{id:'builtin-local',name:'本地雪乃',model:'oregairu-small',base:'http://127.0.0.1'}}:await config(profileId);
        if(useLocal){await bundleReady;clearTimeout(timer);timer=setTimeout(()=>ctrl.abort(),(localChat.config.timeout+30)*1000);}
        ctrl.signal.throwIfAborted();
        const prepared = preparePersonaChat(settings.state,settings.profile,messages);
        const localTranslation = useLocal || settings.state.translationMode === 'local' || prepared.localRoleplay;
        prepared.messages[0].content += '\n\n' + outputInstruction(localTranslation);
        let raw = '';
        const parser = new BilingualStream(text=>send('chunk',{id,text}));
        const onToken=text=>{
          raw+=text; if(raw.length>160000) throw Error('模型回复过长');
          if(localTranslation) send('chunk',{id,text}); else parser.push(text);
        };
        if(useLocal)await localChat.generate(prepared.messages,{requestId:id,signal:ctrl.signal,onChunk:onToken});
        else await chat({...settings,...prepared,signal:ctrl.signal,onToken});
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
    handle('stop',()=>{controller?.abort();localChat?.cancel();translation?.cancel();});
    handle('setup-status',()=>setup.status());
    handle('setup-install',options=>setup.install(options));
    handle('setup-cancel',()=>setup.cancel());
    handle('local-chat-settings',async()=>{await bundleReady;return localChat.config;});
    handle('local-chat-status',async()=>{await bundleReady;return localChat.status();});
    handle('local-chat-save',async input=>{await bundleReady;const value=localChat.configure(input);await write('local-chat.json',value);return value;});
    handle('local-chat-load',async input=>{await bundleReady;return localChat.load(input);});
    handle('local-chat-unload',async()=>{await bundleReady;return localChat.unload();});
    handle('local-chat-probe',async()=>{await bundleReady;return localChat.probe();});

    handle('voice-settings',voiceConfig);
    handle('voice-resources',async()=>{await bundleReady;return {...await voiceResources.inspect(),bundled:voiceBundle.bundled,preset:voiceBundle.preset};});
    handle('voice-install',async(id='core')=>{await bundleReady;return voiceResources.install(id);});
    handle('voice-download-cancel',()=>voiceResources?.cancel());
    handle('voice-save',async raw=>{
      const value=validateSettings(raw),previous=await read('speech.json',{});
      const ignored=new Set(['enabled','volume']);
      if(Object.keys(value).some(k=>!ignored.has(k)&&value[k]!==previous[k])) speech.unload();
      await write('speech.json',value);if(translation&&!translation.config.python&&value.python)translation.configure({python:value.python});return value;
    });
    handle('voice-status',async()=>speech.readiness(await voiceConfig()));
    handle('voice-probe',config=>speech.probe(config));
    handle('voice-load',config=>speech.load(config));
    handle('voice-unload',()=>speech.unload());
    handle('voice-begin',async id=>{speech.configure(await voiceConfig());return speech.begin(id);});
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
    handle('companion-action',action=>companions.performAction(action));
    handle('close-choice',(mode,options)=>companions.closeChoice(mode,options));
    handle('window',action=>{if(action==='minimize')win.minimize();if(action==='maximize')win.isMaximized()?win.unmaximize():win.maximize();if(action==='close')win.close();});
    handle('community',()=>shell.openExternal('https://github.com/fqxxzyw/Yukino-Companion'));
    win.on('closed',()=>{controller?.abort();setup?.cancel();localChat?.dispose();speech?.dispose();translation?.dispose();});
    win.webContents.on('render-process-gone',()=>{controller?.abort();setup?.cancel();localChat?.cancel();speech?.dispose();translation?.cancel();voiceResources?.cancel();});
    await win.loadFile(path.join(__dirname,'../dist/index.html'));
    win.show();
  }).catch(error=>{dialog.showErrorBox('Yukino Companion 启动失败',error.message);app.quit();});
}
app.on('activate',openMain);
app.on('window-all-closed',()=>{if(!companions || companions.quitting)app.quit();});
app.on('before-quit',event=>{
  if(shutdownComplete)return;
  event.preventDefault();if(shuttingDown)return;shuttingDown=true;
  controller?.abort();setup?.cancel();localChat?.dispose();speech?.dispose();translation?.dispose();voiceResources?.cancel();
  if(companions)companions.quitting=true;
  flushRenderer().then(()=>Promise.allSettled([companions?.dispose(),saveQueue])).finally(()=>{shutdownComplete=true;app.quit();});
});
