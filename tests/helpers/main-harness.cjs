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

async function mainHarness({state, reply = {zh:'收到。',ja:'わかりました。'}, translate, packaged = false, files = {}} = {}) {
  const filename = path.resolve(__dirname, '../../electron/main.cjs');
  const originalRequire = createRequire(filename);
  const handlers = new Map(), sent = [], requests = [], translated = [], cancelled = [], errors = [], windows = [];
  const storage = new Map(Object.entries({'state.json':JSON.stringify(state),...files}));
  const dataRoot = path.resolve('/virtual-user');
  const defaultModelRoot = packaged ? path.join('/virtual-resources','translation-models',translationManifest.id) : path.resolve(__dirname,'../../translation/models',translationManifest.id);
  function fileKey(file) { return path.relative(dataRoot, file); }
  const virtualFS = {
    async readFile(file) {
      if (storage.has(fileKey(file))) return storage.get(fileKey(file));
      const error = Error('not found');error.code = 'ENOENT';throw error;
    },
    async mkdir(){},
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
    async status(){return {ready:true,phase:'unloaded',config:{...this.config},modelDir:this.config.modelDir};}
    async translate(request,options={}) {
      translated.push({request,options});
      if(translate)return translate(request,options);
      return {text:'ローカルで翻訳しました。',source:'zh',target:'ja',device:'cpu'};
    }
    cancel(id){cancelled.push(id);}
    dispose(){this.cancel();}
    async install(){return this.status();}
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
    app,BrowserWindow:MockWindow,ipcMain:{handle:(name,callback)=>handlers.set(name,callback)},
    safeStorage:{},shell:{openExternal:async()=>{}},session:{defaultSession:{setPermissionRequestHandler(){}}},
    dialog:{showErrorBox:(_title,message)=>errors.push(message),showOpenDialog:async()=>({canceled:true,filePaths:[]})},
    net:{fetch:()=>{throw Error('unexpected network call');}},
  };
  let companions;
  const sandbox = {
    __dirname:path.dirname(filename),AbortController,AbortSignal,Buffer,setTimeout,clearTimeout,
    process:{env:{},platform:process.platform,resourcesPath:'/virtual-resources'},
    require:name=>{
      if(name==='electron')return fakeElectron;
      if(name==='node:fs/promises')return virtualFS;
      if(name==='./bundled-voice.cjs')return {bundledVoiceDefaults:async()=>({defaults:{python:path.resolve('/embedded/python'),root:path.resolve('/embedded/voice'),bert:path.resolve('/embedded/bert'),hubert:path.resolve('/embedded/hubert')},modelRoot:path.resolve('/embedded/models'),bundled:true})};
      if(name==='./translation.cjs')return {TranslationService:MockTranslation,validateConfig};
      if(name==='./companions.cjs')return {CompanionManager:class extends MockCompanions{constructor(options){super(options);companions=this;}}};
      if(name==='./chat.cjs')return {endpoint,chat:options=>chat({...options,fetcher:async(_url,init)=>{
        requests.push(JSON.parse(init.body));
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
  return {handlers,sent,requests,translated,cancelled,storage,window,companions,defaultModelRoot,invoke:(name,...args)=>handlers.get(name)(event,...args)};
}
module.exports={mainHarness};
