const {canUseSkin}=require('./skin-policy.cjs');
const electron = require('electron');
const {app, BrowserWindow, ipcMain, safeStorage, shell, session, dialog, net, clipboard} = electron;
const fs = require('node:fs/promises');
const path = require('node:path');
const {chat, endpoint} = require('./chat.cjs');
const {translateWithApi}=require('./api-translation.cjs');
const {VisionSession}=require('./vision.cjs');
const {CharacterModelStore}=require('./character-models.cjs');
const {CompanionVisual,signature:visualSignature}=require('./companion-visual.cjs');
const {CompanionChatRequests}=require('./companion-chat-requests.cjs');
let stateSignature=null;
let vision,companionVisual,mainVisionActive=false,companionVisionActive=false;
const companionChatRequests=new CompanionChatRequests({dispatch:payload=>send('pet-chat-submit',payload)});
function updateVisionIndicator(){companions?.setVisionActive?.(mainVisionActive||companionVisionActive);}
let characterModels,modelPickEpoch=0,modelPickerOpen=false;
const translationRequests=new Map();
const {isYukinoLocal,migratePersonaState, characterInfo, characterDocument, buildPersonaPrompt, preparePersonaChat} = require('./persona.cjs');
const {SpeechService, validateSettings, DEFAULTS: VOICE_DEFAULTS} = require('./speech.cjs');
const {VoiceSessionStart} = require('./voice-session-start.cjs');
const {VoiceResources} = require('./voice-resources.cjs');
const {bundledVoiceDefaults, mergeVoiceDefaults} = require('./bundled-voice.cjs');
const {LocalChatService} = require('./local-chat.cjs');
const {RuntimeManager} = require('./runtime-manager.cjs');
const {managedRuntimeBinary}=require('./runtime-paths.cjs');
const {SetupService} = require('./setup.cjs');
const {ResourcePacks}=require('./resource-packs.cjs');
const {resourceSources}=require('./resource-sources.cjs');
const defaultVoicePreset=require('../resources/voice-presets/yukino-default.json');
const {providerCatalog, discoverModels} = require('./providers.cjs');
const {TranslationService, validateConfig: validateTranslation} = require('./translation.cjs');
const {BILINGUAL_INSTRUCTION, BilingualStream, completeBilingual} = require('./bilingual.cjs');
const {CompanionManager} = require('./companions.cjs');
const voiceCatalog = require('../resources/voice-models.json');
const translationManifest = require('../translation/model-manifest.json');
const outputInstruction = local => local ? '请用简体中文自然回答。不要自行附加其他语言翻译。' : BILINGUAL_INSTRUCTION;
let win, controller, speech, voiceStart, voiceResources, voiceBundle, translation, companions, localChat, runtime, setup, resourcePacks;
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
function updateVoice(update){
  // Concurrent voice-core and voice-preset downloads must merge against the
  // latest saved settings inside the same serialized write transaction.
  const job=saveQueue.then(async()=>{const previous=await read('speech.json',{}),value=update(previous);if(value===null)return null;await fs.mkdir(app.getPath('userData'),{recursive:true});await fs.writeFile(location('speech.json.tmp'),JSON.stringify(value),'utf8');await fs.rename(location('speech.json.tmp'),location('speech.json'));return value;});
  saveQueue=job.catch(()=>{});return job;
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
function modelStore(){return characterModels??=new CharacterModelStore({dataRoot:app.getPath('userData'),builtinRoot:path.join(__dirname,'../dist')});}
function characterEntry(id){return modelStore().entry(id);}
async function readCharacterModel(id){await modelStore().initialize();const entry=characterEntry(id),state=await read('state.json',{});if(!canUseSkin(entry,state))throw Error('此服装尚未解锁或未通过模型验收。');return modelStore().read(id);}
async function updateCompanionCharacter(state){try{await modelStore().initialize();}catch(error){send('app-error',{message:error.message});}const selected=state?.characters?.find(item=>item.id===state.activeCharacter)||{id:'yukino',name:'雪之下雪乃',modelId:'yukino-07-v1'};let modelId='';try{const entry=characterEntry(selected.modelId);modelId=canUseSkin(entry,state)?entry.id:'yukino-07-v1'}catch{}companions?.setCharacter?.({id:selected.id,name:selected.name,modelId,presentation:state?.presentation});}
function openMain() { if (win && !win.isDestroyed()) { win.show(); win.restore(); win.focus(); } }

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', openMain);
  app.whenReady().then(async () => {
    app.setAppUserModelId?.('io.github.fqxxzyw.yukino');
    await migrateKeys();
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler?.(()=>false);
    win = new BrowserWindow({width:1280,height:840,minWidth:760,minHeight:580,frame:false,icon:path.join(__dirname,'../dist/yukino-icon.png'),backgroundColor:'#f1f6fc',show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
    let speechClockReady=true;
    win.webContents.setWindowOpenHandler(() => ({action:'deny'}));
    win.webContents.on('will-navigate', event => event.preventDefault());
    const workerPath = name => app.isPackaged ? path.join(process.resourcesPath, name, 'worker.py') : path.join(__dirname, '..', name, 'worker.py');
    speech = new SpeechService({script:workerPath('inference'),stateDir:location('speech-runtime'),notify:status=>send('voice-status',status)});
    voiceStart = new VoiceSessionStart({speech,readConfig:voiceConfig,onBusy:value=>companions?.setSpeechBusy?.(value),canBegin:()=>speechClockReady&&!shuttingDown});
    resourcePacks=new ResourcePacks({dataRoot:app.getPath('userData'),fetcher:(url,options)=>net.fetch(url,options),notify:(id,progress)=>setup?.report(id,progress)});
    runtime=new RuntimeManager({dataRoot:app.getPath('userData'),resourceRoot:resourceRoot(),catalogPath:path.join(resourceRoot(),'runtime-catalog.json'),fetcher:(url,options)=>net.fetch(url,options),notify:progress=>setup?.report('runtime',progress)});
    const modelDir=app.isPackaged?path.join(process.resourcesPath,'translation-models',translationManifest.directory):path.join(__dirname,'../translation/models',translationManifest.directory);
    const localModelDir=app.isPackaged?path.join(resourceRoot(),'local-model/yukino-1.5b-persona-q4'):path.join(__dirname,'../resources/local-model/yukino-1.5b-persona-q4');
    const localScript=app.isPackaged?path.join(process.resourcesPath,'local-chat/desktop_worker.py'):path.join(__dirname,'../model-service/desktop_worker.py');
    const managedBinary=(saved,selected)=>managedRuntimeBinary(saved,selected,{dataRoot:app.getPath('userData'),resourceRoot:resourceRoot()});
    const bundleReady=(async()=>{
      const current=await runtime.current(),chatPack=await resourcePacks.status('chat');
      voiceBundle=await bundledVoiceDefaults({resourceRoot:resourceRoot(),dataRoot:app.getPath('userData'),runtimeRoot:current.root});
      const savedVoice=await read('speech.json',{}), savedTranslation=await read('translation.json',{}),savedLocal=await read('local-chat.json',{});
      const selectedPython=current.python||voiceBundle.defaults.python||process.env.YUKINO_PYTHON||'';
      savedVoice.python=managedBinary(savedVoice.python,selectedPython);savedVoice.ffmpeg=managedBinary(savedVoice.ffmpeg,current.ffmpeg||voiceBundle.defaults.ffmpeg);
      const python=selectedPython||savedVoice.python;
      translation=new TranslationService({script:workerPath('translation'),stateDir:location('translation-runtime'),modelDir,python,fetcher:(url,options)=>net.fetch(url,options),notify:status=>{send('translation-status',status);setup?.report('translation',status);}});
      translation.configure({...savedTranslation,python:managedBinary(savedTranslation.python,python),modelDir:savedTranslation.modelDir||modelDir});
      if(!(await translation.status()).modelInstalled&&savedTranslation.modelDir?.startsWith(path.join(location('translation-runtime'),'models')+path.sep))translation.configure({modelDir});
      localChat=new LocalChatService({script:localScript,stateDir:location('local-chat-runtime'),modelDir:localModelDir,python,notify:status=>send('local-chat-status',status)});
      localChat.configure({...savedLocal,python:managedBinary(savedLocal.python,python),modelDir:savedLocal.modelDir||chatPack.root||localModelDir});
      makeVoiceResources();
      speech.configure(mergeVoiceDefaults(savedVoice,voiceBundle));
      return voiceBundle;
    })();
    function makeVoiceResources(){
      if(voiceResources?.controller)return; // Keep a background download owned until it finishes.
      voiceResources=new VoiceResources({root:voiceBundle.modelRoot,catalog:voiceCatalog,bundledRoot:path.join(resourceRoot(),'voice-models'),bundledPackId:voiceBundle.preset?.packId,fetcher:(url,options)=>net.fetch(url,options),notify:status=>{send('voice-download',status);setup?.report(status.packId==='core'?'voiceCore':status.packId?'voicePreset':setup?.active==='voicePreset'?'voicePreset':'voiceCore',status);}});
    }
    async function voiceConfig(){await bundleReady;const saved=await read('speech.json',{}),current=await runtime.current();saved.python=managedBinary(saved.python,current.python||voiceBundle.defaults.python);saved.ffmpeg=managedBinary(saved.ffmpeg,current.ffmpeg||voiceBundle.defaults.ffmpeg);if(saved.promptText===defaultVoicePreset.promptText&&[voiceBundle.defaults.reference,path.join(location('voice-presets'),'yukino-reference.wav')].includes(saved.reference))saved.promptText='';return mergeVoiceDefaults(saved,voiceBundle);}
    async function refreshRuntime(signal){
      const previous=voiceBundle,current=await runtime.current();
      const nextBundle=await bundledVoiceDefaults({resourceRoot:resourceRoot(),dataRoot:app.getPath('userData'),runtimeRoot:current.root});signal?.throwIfAborted();voiceBundle=nextBundle;
      const value=await updateVoice(saved=>{
        signal?.throwIfAborted();
        for(const field of ['root','bert','hubert'])if(!saved[field]||saved[field]===previous.defaults[field])saved[field]=voiceBundle.defaults[field];
        saved.python=managedBinary(saved.python,current.python||voiceBundle.defaults.python);saved.ffmpeg=managedBinary(saved.ffmpeg,current.ffmpeg||voiceBundle.defaults.ffmpeg);
        return mergeVoiceDefaults(saved,voiceBundle);
      });
      signal?.throwIfAborted();speech.configure(value);send('voice-config-updated',value);makeVoiceResources();
      for(const service of [translation,localChat])service.configure({python:managedBinary(service.config.python,current.python||value.python)});
      await write('translation.json',translation.config);await write('local-chat.json',localChat.config);
    }
    async function installChat(signal){
      if((await localChat.status()).modelInstalled)return;
      if(localChat.config.modelDir&&localChat.config.modelDir!==localModelDir&&!localChat.config.modelDir.startsWith(resourcePacks.root+path.sep))throw Error('已选择的自定义角色模型不完整，请在本地模型设置中重新选择或清空路径。');
      const installed=await resourcePacks.install('chat',{signal});signal.throwIfAborted();
      localChat.configure({modelDir:installed.root});await write('local-chat.json',localChat.config);
    }
    async function installPet(signal){const installed=await resourcePacks.install('pet',{signal});signal.throwIfAborted();await companions?.setResourceRoot?.(installed.root);return installed;}
    async function installVoicePreset(signal){
      const config=await voiceConfig(),readiness=await speech.readiness(config);signal.throwIfAborted();
      if(!readiness.missing?.some(item=>['gpt','sovits','reference','promptText'].includes(item.key)))return;
      const saved=await read('speech.json',{});
      // An incomplete custom pair/reference must never be silently replaced.
      const defaultPack=voiceCatalog.packs[voiceCatalog.defaultVoicePack||'yukino-e2'];
      const isManaged=(field,value)=>!value||value===voiceBundle.defaults[field]||value===path.join(voiceResources.root,defaultPack.paths[field]);
      const needsWeights=readiness.missing?.some(item=>['gpt','sovits'].includes(item.key));
      if(needsWeights&&(!isManaged('gpt',saved.gpt)||!isManaged('sovits',saved.sovits)))throw Error('已选择自定义音色，请在声音设置中补齐 GPT 与 SoVITS 权重。');
      if(!saved.reference&&saved.promptText?.trim())throw Error('已填写自定义参考文本，请选择与其匹配的参考音频。');
      if(saved.reference&&readiness.missing?.some(item=>item.key==='reference'))throw Error('已选择的参考音频不存在，请重新选择；原设置已保留。');
      const paths=needsWeights?await voiceResources.install(voiceCatalog.defaultVoicePack||'yukino-e2'):{};signal.throwIfAborted();
      let reference=saved.reference||config.reference;
      if(!reference){const source=app.isPackaged?path.join(resourceRoot(),'voice-presets',defaultVoicePreset.reference.sourcePath):path.join(__dirname,'../resources/voice-presets',defaultVoicePreset.reference.sourcePath);
       const bytes=await fs.readFile(source);if(bytes.length!==defaultVoicePreset.reference.bytes||require('node:crypto').createHash('sha256').update(bytes).digest('hex')!==defaultVoicePreset.reference.sha256)throw Error('默认参考音频校验失败');
       const refDir=location('voice-presets');await fs.mkdir(refDir,{recursive:true});reference=path.join(refDir,'yukino-reference.wav');await fs.writeFile(reference+'.tmp',bytes);signal.throwIfAborted();await fs.rename(reference+'.tmp',reference);}
      const value=await updateVoice(latest=>{
       if(needsWeights&&(!isManaged('gpt',latest.gpt)||!isManaged('sovits',latest.sovits)))throw Error('下载期间已选择自定义音色，未覆盖你的选择。');
       if(!latest.reference&&latest.promptText?.trim())throw Error('已填写自定义参考文本，请选择与其匹配的参考音频。');
       return mergeVoiceDefaults({...latest,...paths,reference:latest.reference||reference,promptText:latest.promptText||'',promptLang:latest.promptLang||defaultVoicePreset.promptLang},voiceBundle);
      });speech.configure(value);send('voice-config-updated',value);
    }
    setup=new SetupService({prepare:()=>bundleReady,notify:status=>send('setup-status',status),inspect:async({features=null}={})=>{
      await bundleReady;
      const selected=id=>features===null||features.includes(id),needsRuntime=features===null||features.some(id=>id!=='pet');
      const [environment,local,translated,voices,voice,pet,chatPack,runtimeCatalog]=await Promise.all([needsRuntime?runtime.status():{},selected('chat')?localChat.status():{},selected('translation')?translation.status():{},selected('voice')?voiceResources.inspect():{},selected('voice')?speech.readiness(await voiceConfig()):{},selected('pet')?resourcePacks.status('pet'):{},selected('chat')?resourcePacks.status('chat'):{},needsRuntime?runtime.catalog():{}]);
      const helpUrl='https://fqxxzyw.github.io/Yukino-Companion/#help';
      const describe=files=>({downloadBytes:files.reduce((sum,file)=>sum+(file.bytes||file.size||0),0),downloadSources:[...new Set(files.flatMap(file=>resourceSources(file.url||`${translationManifest.baseUrl}/${file.path}`,file.sources)))],helpUrl});
      const coreReady=!voice.missing?.some(x=>['bert','hubert'].includes(x.key));
      const presetReady=!voice.missing?.some(x=>['gpt','sovits','reference','promptText'].includes(x.key));
      return {runtimeFlavor:environment.flavor,runtimeVariants:environment.variants,hardware:environment.hardware||null,device:environment.ready?(environment.metadata?.gpuAvailable?'GPU':'CPU'):null,steps:[
        {id:'runtime',...describe(runtimeCatalog.variants?.cpu?.parts||[]),state:environment.ready?'ready':'missing',detail:environment.ready?`公共推理环境已安装 · ${environment.flavor}`:'按需安装 Python 与推理依赖；仅桌宠不需要。'},
        {id:'chat',downloadBytes:local.modelInstalled?0:chatPack.downloadBytes,downloadSources:chatPack.downloadSources,helpUrl,state:local.modelInstalled?(local.runtimeAvailable?'ready':'waiting-runtime'):'missing',detail:local.modelInstalled?(local.runtimeAvailable?'角色权重已安装，首次发送时自动加载验证。':'角色权重已安装，等待本地推理环境。'):'安装已训练的角色模型，无需重新训练。'},
        {id:'translation',...describe(translationManifest.files),downloadBytes:translated.modelInstalled?0:describe(translationManifest.files).downloadBytes,state:translated.modelInstalled?(translated.runtimeAvailable?'ready':'waiting-runtime'):'missing',detail:translated.modelInstalled?(translated.runtimeAvailable?'中日翻译权重已安装，首次翻译时自动加载验证。':'中日翻译权重已安装，等待本地推理环境。'):'需要准备中日翻译权重。'},
        {id:'voiceCore',...describe(voiceCatalog.packs.core.files),state:coreReady||voices.coreReady?'ready':'missing',detail:'语音合成共用的 BERT 与 HuBERT 组件。'},
        {id:'voicePreset',...describe(voiceCatalog.packs[voiceCatalog.defaultVoicePack||'yukino-e2'].files),state:presetReady?'ready':'missing',detail:presetReady?'音色权重与日语参考声音已配置。':'按需下载默认音色，参考声音自动准备。'},
        {id:'pet',downloadBytes:pet.downloadBytes,downloadSources:pet.downloadSources,helpUrl,state:pet.installed?'ready':'missing',detail:'2,391 段桌宠预录语音；不依赖 Python。'}]};
    },installRuntime:flavor=>runtime.install(flavor),refresh:refreshRuntime,installChat,installPet,installVoicePreset,
      installTranslation:async()=>{const status=await translation.install();await write('translation.json',status.config);return status;},
      installVoice:async signal=>{const config=await voiceConfig();signal.throwIfAborted();const status=await speech.readiness(config);signal.throwIfAborted();if(!status.missing?.some(item=>['bert','hubert'].includes(item.key)))return {paths:{},expected:config};const paths=await voiceResources.install('core');const missing=new Set(status.missing?.map(item=>item.key));return {paths:Object.fromEntries(Object.entries(paths).filter(([key])=>missing.has(key))),expected:config};},saveVoice:async result=>{const config=await updateVoice(latest=>{const current=mergeVoiceDefaults(latest,voiceBundle),paths=Object.fromEntries(Object.entries(result.paths||{}).filter(([key])=>current[key]===result.expected?.[key]));return mergeVoiceDefaults({...latest,...paths},voiceBundle);});speech.configure(config);send('voice-config-updated',config);},
      cancel:()=>{runtime.cancel();translation?.cancelInstall();voiceResources?.cancel();resourcePacks?.cancel();}});
    bundleReady.catch(error=>send('app-error',{message:error.message}));
    companions = new CompanionManager({electron,dataDir:app.getPath('userData'),onOpenMain:openMain,onModelData:readCharacterModel,onModelCatalog:()=>modelStore().catalog(),onUse:()=>send('companion-use',{type:'pet-interaction'}),onReminder:result=>send('companion-caption',{text:result.text,characterId:companions.character?.id,source:'reminder'}),onChat:text=>companionChatRequests.submit(text),onChatStop:()=>{companionChatRequests.cancel('本次消息已停止，未接受的输入仍保留。');controller?.abort();localChat?.cancel();translation?.cancelRequests();send('pet-chat-stop');},onVision:(owner,kind)=>companionVisual?.open(owner,kind),onVisionStop:()=>{vision?.cancel();companionVisual?.stop();},onOpenSettings:tab=>{openMain();send('open-settings',tab);},onQuit:()=>app.quit(),onChange:state=>send('companion-state',state),onCloseRequested:()=>send('close-requested'),onError:error=>send('app-error',{message:error.message})});
    await companions.initialize();const installedPet=await resourcePacks.status('pet');if(installedPet.installed)await companions.setResourceRoot?.(installedPet.root);companions.attachMainWindow(win);

    handle('flush-complete', id=>{if(flushResolver?.id===id)flushResolver.resolve();});
    handle('copy-text', value=>{if(typeof value!=='string'||value.length>200000)throw Error('复制内容无效');clipboard.writeText(value);return true;});
    handle('load', async () => {
      const saved = await read('state.json',null);stateSignature=visualSignature(saved);
      await updateCompanionCharacter(saved);
      return {state:saved?migratePersonaState(saved):null,keyIds:Object.keys(await read('keys.json',{})),character:characterInfo()};
    });
    handle('save', async state => {
      if (!state || !Array.isArray(state.conversations) || !Array.isArray(state.profiles) || JSON.stringify(state).length > 10000000) throw Error('无效或过大的设置');
      const nextSignature=visualSignature(state);if(stateSignature!==null&&stateSignature!==nextSignature)vision?.cancel();stateSignature=nextSignature;companionVisual?.stateChanged(state);await write('state.json',migratePersonaState(state));await updateCompanionCharacter(state);
    });
    handle('character-model-data',readCharacterModel);
    handle('character-model-catalog',()=>modelStore().catalog());
    async function pickCharacterModel(title){if(modelPickerOpen)throw Error('模型文件选择窗口已打开');const epoch=++modelPickEpoch;modelStore().cancel();modelPickerOpen=true;try{const result=await dialog.showOpenDialog(win,{title,properties:['openFile'],filters:[{name:'GLB 人物模型（最多 64 MiB）',extensions:['glb']}]});return result.canceled||epoch!==modelPickEpoch?null:result.filePaths[0];}finally{modelPickerOpen=false;}}
    handle('character-model-inspect',async()=>{const file=await pickCharacterModel('选择自定义 GLB，先检查再确认导入');return file?modelStore().inspectFile(file):null;});
    handle('character-model-confirm',options=>modelStore().confirm(options));
    const cancelModelImport=()=>{modelPickEpoch++;characterModels?.cancel();return true;};
    handle('character-model-cancel',cancelModelImport);
    win.on('closed',cancelModelImport);win.on('hide',cancelModelImport);win.webContents.on('render-process-gone',cancelModelImport);
    handle('character-model-import',async id=>{await modelStore().initialize();const entry=characterEntry(id);if(entry.custom)throw Error('自定义模型请使用检查后导入');const file=await pickCharacterModel('导入 '+entry.label+' 的已发布 GLB');return file?modelStore().importBuiltin(id,file):false;});
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
      companionVisual?.stop();vision?.cancel();
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
    vision=new VisionSession({capturer:electron.desktopCapturer,resolveProfile:async id=>{const settings=await config(id);if(settings.state.chatMode==='local'||isYukinoLocal(settings.profile))throw Error('本地文本模型不能识别图片，请选择视觉 API。');return settings;},transport:chat,notify:state=>{send('vision-status',state);mainVisionActive=state.active===true;updateVisionIndicator()}});
    companionVisual=new CompanionVisual({electron,readState:()=>read('state.json',{}),resolveProfile:config,onConfigure:()=>{openMain();send('open-settings','api');},onStop:()=>send('companion-caption-stop',{source:'visual'}),onActive:active=>{companionVisionActive=active;updateVisionIndicator();},onResult:(result,characterId)=>{if(companions.character?.id===characterId){companions.showReply({id:require('node:crypto').randomUUID(),zh:result.text,ja:''});if(result.readAloud===true)send('companion-caption',{text:result.text,characterId,source:'visual'});}}});
    handle('vision-sources',options=>vision.sources(options));
    handle('vision-analyze',options=>vision.analyze(options));
    handle('vision-watch',options=>vision.startWatch(options));
    win.on('hide',()=>vision.cancel());win.on('minimize',()=>vision.cancel());
    electron.powerMonitor?.on?.('suspend',()=>{vision.cancel();companionVisual?.stop();});electron.powerMonitor?.on?.('lock-screen',()=>{vision.cancel();companionVisual?.stop();});
    handle('vision-cancel',()=>{vision.cancel();return true;});
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
        const bilingual = await completeBilingual(pair,{requestId:id,signal:ctrl.signal,preferLocal:localTranslation,translationSource:localTranslation?'local':'api',translate:async (request,options)=>{if(!localTranslation)return translateWithApi({...settings,...request,...options,transport:chat});await bundleReady;return translation.translate(request,options);}});
        ctrl.signal.throwIfAborted();
        companions.showReply({id,...bilingual});
        companions.clearCapabilityError?.('chat');
        return {ok:true,bilingual};
      } catch(error) {
        if(ctrl.signal.aborted) return {stopped:true}; throw error;
      } finally {clearTimeout(timer);if(controller===ctrl)controller=null;}
    });
    handle('stop',()=>{controller?.abort();for(const request of translationRequests.values())request.abort();localChat?.cancel();translation?.cancelRequests();});
    handle('setup-status',options=>setup.status(options));
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
    handle('voice-install',async(id='core',options={})=>{await bundleReady;if(typeof options?.apply!=='boolean'&&options?.apply!==undefined||options?.component!==undefined&&(!['gpt','sovits'].includes(options.component)||id==='core'))throw Error('无效音色选择');const before=await voiceConfig(),owner=voiceResources,paths=await owner.install(id,{component:options.component});let applied=false;if(options?.apply){const value=await updateVoice(saved=>{const current=mergeVoiceDefaults(saved,voiceBundle);if(Object.keys(paths).some(key=>current[key]!==before[key]))return null;return mergeVoiceDefaults({...saved,...paths},voiceBundle);});if(value){voiceStart.cancel();speech.configure(value);send('voice-config-updated',value);applied=true;}}return {...paths,applied};});
    handle('voice-download-cancel',()=>voiceResources?.cancel());
    async function saveVoiceSettings(raw, partial=false){
      await bundleReady;
      if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('无效语音配置');
      if(partial&&Object.keys(raw).some(key=>!Object.hasOwn(VOICE_DEFAULTS,key)))throw Error('无效语音设置');
      const requested=partial?raw:validateSettings(raw);let previous;
      const value=await updateVoice(saved=>{
        previous=mergeVoiceDefaults(saved,voiceBundle);
        return validateSettings(partial?{...previous,...requested}:requested);
      });
      const ignored=new Set(['enabled','volume']);
      if(Object.keys(value).some(key=>!ignored.has(key)&&value[key]!==previous[key])){voiceStart.cancel();speech.unload();}
      if(translation&&!translation.config.python&&value.python)translation.configure({python:value.python});
      return value;
    }
    handle('voice-save',raw=>saveVoiceSettings(raw));
    handle('voice-patch',raw=>saveVoiceSettings(raw,true));
    handle('voice-status',async()=>speech.readiness(await voiceConfig()));
    handle('voice-probe',config=>speech.probe(config));
    handle('voice-load',config=>{voiceStart.cancel();return speech.load(config);});
    handle('voice-unload',()=>{voiceStart.cancel();return speech.unload();});
    handle('voice-begin',id=>voiceStart.begin(id));
    handle('voice-prewarm',async id=>{if(!id||speech.session!==id)throw Error('语音会话已过期');await speech.ensureLoaded();if(speech.session!==id)throw Error('语音会话已过期');return true;});
    handle('voice-synthesize',async(id,text)=>{const audio=await speech.synthesize(id,text);companions?.clearCapabilityError?.('voice');return audio;});
    handle('voice-stop',id=>voiceStart.stop(id));
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
    handle('translation-cancel',id=>{if(id)translationRequests.get(id)?.abort();else for(const request of translationRequests.values())request.abort();return translation?.cancelRequests(id);});
    handle('translate',async request=>{
      if(!request||typeof request.requestId!=='string'||request.requestId.length>200||typeof request.text!=='string'||request.text.length>24000)throw Error('翻译请求无效');
      if(translationRequests.has(request.requestId))throw Error('该翻译正在进行');
      // Register before the first await: Stop and duplicate IDs must work during disk/config preflight.
      const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),90000);translationRequests.set(request.requestId,ctrl);
      try{
        const saved=await read('state.json',{});ctrl.signal.throwIfAborted();
        const mode=request.mode||saved.chatMode||'api';
        if(!['local','api'].includes(mode))throw Error('翻译模式无效');
        if(mode==='local'||saved.translationMode==='local'){
          await bundleReady;ctrl.signal.throwIfAborted();const status=await translation.status();ctrl.signal.throwIfAborted();
          if(status.modelInstalled===false||status.runtimeAvailable===false)throw Error('本地翻译尚未配置，请在双语与翻译设置中准备翻译模型与公共环境。');
          return await translation.translate(request,{signal:ctrl.signal});
        }
        const profile=await config(request.profileId||saved.activeProfile);ctrl.signal.throwIfAborted();
        return await translateWithApi({...profile,text:request.text,requestId:request.requestId,signal:ctrl.signal,transport:chat});
      }finally{clearTimeout(timer);if(translationRequests.get(request.requestId)===ctrl)translationRequests.delete(request.requestId);}

    });
    handle('translation-pick',async kind=>{
      if(!['python','modelDir'].includes(kind)) throw Error('无效翻译资源类型');
      const result=await dialog.showOpenDialog(win,{title:'选择本地翻译资源',properties:[kind==='modelDir'?'openDirectory':'openFile']});return result.canceled?null:result.filePaths[0];
    });
    handle('companion-chat-ack',value=>companionChatRequests.ack(value));
    handle('companion-chat-error',message=>{companions?.showError?.(message);return true;});
    handle('companion-speech-busy',value=>{if(typeof value!=='boolean')throw Error('语音状态无效');companions?.setSpeechBusy?.(value);return true;});
    handle('companion-speech',value=>speechClockReady?companions.setSpeechSnapshot(value):false);
    handle('companion-mouth',level=>{if(!Number.isFinite(level)||level<0||level>1)throw Error('口型幅度无效');companions.setMouthLevel?.(level);});
    handle('companion-chat-busy',busy=>{if(typeof busy!=='boolean')throw Error('状态无效');companions.setChatBusy?.(busy);return true;});
    handle('companion-state',()=>companions.getState());
    handle('companion-set',patch=>companions.updatePrefs(patch));
    handle('companion-action',action=>companions.performAction(action));
    handle('close-choice',(mode,options)=>companions.closeChoice(mode,options));
    handle('window',action=>{if(action==='minimize')win.minimize();if(action==='maximize')win.isMaximized()?win.unmaximize():win.maximize();if(action==='close')win.close();});
    handle('community',()=>shell.openExternal('https://fqxxzyw.github.io/Yukino-Companion/'));
    handle('help',topic=>{if(topic!==undefined&&!['downloads','integrity','api','first-run'].includes(topic))throw Error('未知帮助主题');return shell.openExternal('https://fqxxzyw.github.io/Yukino-Companion/#help');});
    win.on('closed',()=>{voiceStart.cancel();companionChatRequests.cancel();companionVisual?.close();vision?.cancel();controller?.abort();setup?.cancel();localChat?.dispose();speech?.dispose();translation?.dispose();});
    win.webContents.on('did-start-navigation',details=>{if(details.isMainFrame===true&&details.isSameDocument===false){speechClockReady=false;voiceStart.cancel();companionChatRequests.cancel();companionVisual?.stop();companions?.setSpeechBusy?.(false);companions?.resetSpeechClock?.();companions?.setMouthLevel?.(0);companions?.setChatBusy?.(false);vision?.cancel();controller?.abort();localChat?.cancel();speech?.stop?.();translation?.cancel();}});
    win.webContents.on('dom-ready',()=>{companions?.resetSpeechClock?.();speechClockReady=true;});
    win.webContents.on('render-process-gone',()=>{speechClockReady=false;voiceStart.cancel();companionChatRequests.cancel();companionVisual?.stop();companions?.setSpeechBusy?.(false);companions?.showError?.('聊天服务窗口已停止，请打开主窗口恢复。');companions?.setChatBusy?.(false);companions?.setMouthLevel?.(0);companions?.resetSpeechClock?.();vision?.cancel();controller?.abort();setup?.cancel();localChat?.cancel();speech?.dispose();translation?.cancel();voiceResources?.cancel();});
    await win.loadFile(path.join(__dirname,'../dist/index.html'));
    win.show();
  }).catch(error=>{dialog.showErrorBox('Yukino Companion 启动失败',error.message);app.quit();});
}
app.on('activate',openMain);
app.on('window-all-closed',()=>{if(!companions || companions.quitting)app.quit();});
app.on('before-quit',event=>{
  if(shutdownComplete)return;
  event.preventDefault();if(shuttingDown)return;shuttingDown=true;
  voiceStart?.cancel();companionChatRequests.cancel();companionVisual?.close();vision?.cancel();controller?.abort();setup?.cancel();localChat?.dispose();speech?.dispose();translation?.dispose();voiceResources?.cancel();
  if(companions)companions.quitting=true;
  flushRenderer().then(()=>Promise.allSettled([companions?.dispose(),saveQueue])).finally(()=>{shutdownComplete=true;app.quit();});
});
