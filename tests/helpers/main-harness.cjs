// Run the real Electron main entrypoint without Electron, subprocesses or network.
// API requests still pass through the real chat transport and persisted persona compiler.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {EventEmitter} = require('node:events');
const {createRequire} = require('node:module');
const {chat, endpoint} = require('../../electron/chat.cjs');
const {validateConfig} = require('../../electron/translation.cjs');
const translationManifest = require('../../translation/model-manifest.json');
const speechModule = require('../../electron/speech.cjs');
const {mergeVoiceDefaults} = require('../../electron/bundled-voice.cjs');
const localModule = require('../../electron/local-chat.cjs');

async function mainHarness({state, reply = {zh:'收到。',ja:'わかりました。'}, translate, localReply='先坐下吧，慢慢说。', runtimeReady=true, voiceMissing=[], voiceInstallBarrier, bundleGate, packaged = false, referenceFixture=false, files = {}} = {}) {
  const filename = path.resolve(__dirname, '../../electron/main.cjs');
  const originalRequire = createRequire(filename);
  const handlers = new Map(), sent = [], requests = [], transport = [], translated = [], cancelled = [], errors = [], windows = [], localRequests = [], localCancelled = [], voiceActions = [], network = [], voiceInstallCalls = [],voiceDownloads=[],copied=[];
  const missingVoiceFields=new Set(voiceMissing),installedCorePaths=new Set();let coreInstalled=voiceMissing.length===0;
  const storage = new Map(Object.entries({'state.json':JSON.stringify(state),...files}));
  const dataRoot = path.resolve('/virtual-user');
  const defaultModelRoot = packaged ? path.join('/virtual-resources','translation-models',translationManifest.id) : path.resolve(__dirname,'../../translation/models',translationManifest.id);
  function fileKey(file) { return path.relative(dataRoot, file); }
  const virtualFS = {
    async readFile(file) {
      if(referenceFixture&&path.basename(file)==='yukino-reference.wav')return fs.promises.readFile(path.resolve(__dirname,'../../resources/voice-presets/yukino-reference.wav'));
      if (storage.has(fileKey(file))) return storage.get(fileKey(file));
      const error = Error('not found');error.code = 'ENOENT';throw error;
    },
    async mkdir(){},
    async access(file){if(storage.has(fileKey(file)))return;const error=Error('not found');error.code='ENOENT';throw error;},
    async rm(file){storage.delete(fileKey(file));},
    async writeFile(file, content){storage.set(fileKey(file), content);},
    async rename(from,to){storage.set(fileKey(to),storage.get(fileKey(from)));storage.delete(fileKey(from));},
  };
  class MockWindow extends EventEmitter {
    constructor(options) {
      super();this.options = options;this.visible = false;this.destroyed = false;windows.push(this);
      this.webContents = new EventEmitter();this.webContents.mainFrame = {};
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.send = (channel,payload) => sent.push({channel,payload});
    }
    async loadFile(file){this.loadedFile = file;}
    isDestroyed(){return this.destroyed;}
    show(){this.visible = true;this.emit('show');}
    hide(){this.visible = false;this.emit('hide');}
    isVisible(){return this.visible;}
    isMinimized(){return false;}
    restore(){} focus(){} minimize(){} maximize(){} unmaximize(){} isMaximized(){return false;}
    close(){this.emit('close',{preventDefault(){}});}
  }
  class MockTranslation {
    constructor(options){this.config = validateConfig({python:options.python,modelDir:options.modelDir});this.options = options;}
    configure(config){this.config = validateConfig({...this.config,...config});return this.config;}
    async status(){return {ready:Boolean(this.config.python),modelInstalled:true,runtimeAvailable:Boolean(this.config.python),phase:'unloaded',config:{...this.config},modelDir:this.config.modelDir};}
    async translate(request,options={}) {
      translated.push({request,options});
      if(translate)return translate(request,options);
      return {text:'ローカルで翻訳しました。',source:'zh',target:'ja',device:'cpu'};
    }
    cancel(id){cancelled.push(id);}
    cancelRequests(id){this.cancel(id);}
    cancelInstall(){}
    dispose(){this.cancel();}
    async install(){return this.status();}
  }
  class MockLocalChat {
    constructor(options){this.options=options;this.config=localModule.validateConfig({python:options.python,modelDir:options.modelDir});this.phase='unloaded';}
    configure(config){this.config=localModule.validateConfig({...this.config,...config});return this.config;}
    async status(){return {phase:this.phase,available:Boolean(this.config.python),runtimeAvailable:Boolean(this.config.python),modelInstalled:true,ready:this.phase==='ready',config:{...this.config},offline:true,model:'Test Yukino local model'};}
    async generate(messages,options={}){localRequests.push({messages,options});const result=typeof localReply==='function'?await localReply(messages,options):{text:localReply,device:'cpu'};options.signal?.throwIfAborted();options.onChunk?.(result.text);return result;}
    cancel(id){localCancelled.push(id);this.phase='unloaded';}
    async load(config){if(config)this.configure(config);this.phase='ready';return this.status();}
    async unload(){this.cancel();return this.status();}
    async probe(){return {cpu:true,cudaAvailable:false};}
    dispose(){this.cancel();}
  }
  class MockRuntime {
    constructor(options){this.options=options;this.ready=runtimeReady;this.installs=[];this.root=path.join(dataRoot,'runtime');this.phase='idle';}
    async current(){return {ready:this.ready,root:this.ready?path.resolve('/embedded'):null,python:this.ready?path.resolve('/embedded/python'):'',ffmpeg:this.ready?path.resolve('/embedded/ffmpeg'):'',flavor:this.ready?'cpu':null,bundled:false};}
    async catalog(){return {schemaVersion:1,version:'0.4.0',variants:{cpu:{},cu124:{}}};}
    async status(){return {...await this.current(),phase:this.phase,variants:['cpu','cu124'],version:'0.4.0'};}
    async install(flavor='auto'){this.installs.push(flavor);this.ready=true;this.phase='ready';this.options.notify?.({phase:'ready'});return this.status();}
    cancel(){this.cancelled=true;}
    dispose(){this.cancel();}
  }
  class MockSpeech {
    constructor(options){this.options=options;this.config=null;this.status={phase:'unloaded',configured:true,needsSetup:false,missing:[]};}
    configure(config){this.config=speechModule.validateSettings(config);voiceActions.push({method:'configure',config:this.config});return this.config;}
    async readiness(config=this.config){voiceActions.push({method:'readiness',config});const missing=Object.entries(speechModule.CONFIG_LABELS).filter(([key])=>(key!=='promptText'||['v3','v4','v5dev','v5turbo'].includes(config?.version))&&(!config?.[key]||(missingVoiceFields.has(key)&&!installedCorePaths.has(config[key])))).map(([key,label])=>({key,label}));return this.status={...this.status,configured:missing.length===0,needsSetup:missing.length>0,missing};}
    async prepare(config){this.configure(config);return this.load(config);}
    async load(config){this.configure(config);voiceActions.push({method:'load'});this.status={...this.status,phase:'ready'};return this.status;}
    begin(id){voiceActions.push({method:'begin',id,config:this.config});if(!this.config)throw Error('Voice configuration must be applied before begin');this.session=id;}
    async synthesize(id,text){voiceActions.push({method:'synthesize',id,text});if(this.session!==id)throw Error('expired session');return Buffer.from('RIFFtestWAVE');}
    stop(id){voiceActions.push({method:'stop',id});this.session=null;}
    unload(){voiceActions.push({method:'unload'});this.config=null;this.session=null;this.status={...this.status,phase:'unloaded'};}
    async probe(){return {cudaAvailable:false,devices:[]};}
    dispose(){this.unload();}
  }
  class MockVoiceResources {
    constructor(options){this.options=options;this.root=options.root;this.status={phase:'idle'};this.installs=[];voiceDownloads.push(this);}
    summary(){return {...this.status,root:this.root,packs:[{id:'core',kind:'core',installed:coreInstalled},{id:'yukino-e2',kind:'voice',bundled:true,installed:true}],coreReady:coreInstalled};}
    async inspect(){return this.summary();}
    async install(id='core'){this.installs.push(id);voiceInstallCalls.push(id);if(voiceInstallBarrier)await voiceInstallBarrier(id);const paths=id==='core'?{bert:path.join(this.root,'chinese-roberta-wwm-ext-large'),hubert:path.join(this.root,'chinese-hubert-base')}:{gpt:path.resolve('/embedded/voice-models/default.ckpt'),sovits:path.resolve('/embedded/voice-models/default.pth'),version:'v1',textLang:'all_ja'};if(id==='core'){coreInstalled=true;Object.values(paths).forEach(value=>installedCorePaths.add(value));}else{missingVoiceFields.delete('gpt');missingVoiceFields.delete('sovits');}return paths;}
    cancel(){this.cancelled=true;}
  }
  class MockCompanions {
    constructor(options){this.options=options;this.replies=[];this.preferences={mode:'none',closeAction:'ask'};}
    async initialize(){return this.getState();}
    attachMainWindow(window){this.window=window;}
    getState(){return {...this.preferences,usage:{totalMs:0,todayMs:0,sessionMs:0}};}
    async updatePrefs(patch){Object.assign(this.preferences,patch);return this.getState();}
    showReply(reply){this.replies.push(reply);}
    async closeChoice(mode){this.closeMode=mode;return this.getState();}
    async dispose(){}
  }
  const app = new EventEmitter();app.isPackaged=packaged;app.requestSingleInstanceLock=()=>true;
  app.whenReady=()=>Promise.resolve();app.getPath=()=>dataRoot;app.quit=()=>{app.quitCalled=true;};
  const fakeElectron = {
    app,BrowserWindow:MockWindow,ipcMain:{handle:(name,callback)=>handlers.set(name,callback)},clipboard:{writeText:value=>copied.push(value)},
    safeStorage:{isEncryptionAvailable:()=>true,getSelectedStorageBackend:()=> 'gnome_libsecret',encryptString:value=>Buffer.from('sealed:'+value),decryptString:value=>{const text=value.toString();if(!text.startsWith('sealed:'))throw Error('Invalid sealed test key');return text.slice(7);}},shell:{openExternal:async()=>{}},session:{defaultSession:{setPermissionRequestHandler(){}}},
    dialog:{showErrorBox:(_title,message)=>errors.push(message),showOpenDialog:async()=>({canceled:true,filePaths:[]})},
    net:{fetch:async(url,options={})=>{network.push({url,options});if(options.method==='GET'&&String(url).includes('/models'))return Response.json({data:[{id:'test-chat-model',name:'Test chat model'}]});throw Error('unexpected network call');}},
  };
  let companions,local,runtime,voice,setup;
  const sandbox = {
    __dirname:path.dirname(filename),AbortController,AbortSignal,Buffer,URL,Response,structuredClone,queueMicrotask,setTimeout,clearTimeout,
    process:{env:{},platform:process.platform,resourcesPath:'/virtual-resources'},
    require:name=>{
      if(name==='electron')return fakeElectron;
      if(name==='node:fs/promises')return virtualFS;
      if(name==='./bundled-voice.cjs')return {mergeVoiceDefaults,bundledVoiceDefaults:async()=>{if(bundleGate)await bundleGate;return ({defaults:{...speechModule.DEFAULTS,python:runtime?.ready===false?'':path.resolve('/embedded/python'),root:runtime?.ready===false?'':path.resolve('/embedded/voice'),bert:path.resolve('/embedded/bert'),hubert:path.resolve('/embedded/hubert'),gpt:path.resolve('/embedded/voice-models/default.ckpt'),sovits:path.resolve('/embedded/voice-models/default.pth'),reference:path.resolve('/embedded/voice-models/ref.wav'),promptText:'',promptLang:'all_ja'},modelRoot:path.resolve('/embedded/models'),bundled:runtime?.ready!==false,preset:{packId:'yukino-e2',durationSeconds:3.083}})}};
      if(name==='./speech.cjs')return {...speechModule,SpeechService:class extends MockSpeech{constructor(options){super(options);voice=this;}}};
      if(name==='./voice-resources.cjs')return {VoiceResources:MockVoiceResources};
      if(name==='./local-chat.cjs')return {...localModule,LocalChatService:class extends MockLocalChat{constructor(options){super(options);local=this;}}};
      if(name==='./resource-packs.cjs')return {ResourcePacks:class {constructor(){this.root=path.join(dataRoot,'resources');}async status(id){return {id,installed:false,root:'',downloadBytes:123,downloadSources:[]};}async install(id){return {id,installed:true,root:path.join(this.root,id)};}cancel(){}}};
      if(name==='./setup.cjs'){const actual=originalRequire(name);return {...actual,SetupService:class extends actual.SetupService{constructor(options){super(options);setup=this;}}};}
      if(name==='./runtime-manager.cjs')return {RuntimeManager:class extends MockRuntime{constructor(options){super(options);runtime=this;}}};
      if(name==='./translation.cjs')return {TranslationService:MockTranslation,validateConfig};
      if(name==='./companions.cjs')return {CompanionManager:class extends MockCompanions{constructor(options){super(options);companions=this;}}};
      if(name==='./chat.cjs')return {endpoint,chat:options=>chat({...options,fetcher:async(_url,init)=>{
        requests.push(JSON.parse(init.body));transport.push({url:_url,headers:init.headers,body:requests.at(-1)});
        const content = typeof reply==='function'?await reply(options):typeof reply==='string'?reply:JSON.stringify(reply);
        return Response.json({choices:[{message:{content}}]});
      }})};
      return originalRequire(name);
    },
  };
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),sandbox,{filename});
  for(let i=0;i<20&&!handlers.has('community')&&!errors.length;i++)await new Promise(setImmediate);
  if(errors.length)throw Error('main initialization failed: '+errors.join('; '));
  if(!handlers.has('community'))throw Error('main did not register startup IPC');
  const window=windows[0],event={sender:window.webContents,senderFrame:window.webContents.mainFrame};
  return {handlers,sent,requests,transport,translated,cancelled,storage,window,companions,local,runtime,voice,setup,localRequests,localCancelled,voiceActions,voiceInstallCalls,voiceDownloads,copied,network,defaultModelRoot,invoke:(name,...args)=>handlers.get(name)(event,...args)};
}
module.exports={mainHarness};
