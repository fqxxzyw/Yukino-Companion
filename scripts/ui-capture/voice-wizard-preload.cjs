// QA ONLY: dedicated voice-wizard synthetic fixture. No microphone, network or TTS.
// QA ONLY. This preload is never included in the application package.
// It exercises the production renderer with deterministic, in-memory fixtures.
// Download progress advances only when the QA runner explicitly supplies an event.
const {contextBridge} = require('electron');
const subscriptions = new Map();
function on(name, fn) {const listeners=subscriptions.get(name)||new Set();listeners.add(fn);subscriptions.set(name,listeners);return()=>listeners.delete(fn);}
function emit(name,value) {for(const fn of subscriptions.get(name)||[])fn(value);}
const copy=value=>JSON.parse(JSON.stringify(value));
const zh='先不必急着给今天下结论。\n\n把让你在意的那件事说清楚，我们再一起想办法。窗外的雨已经停了，留一点时间给自己，也没有什么不好。';
const ja='今日のことを、今すぐ結論づける必要はないわ。\n\n気になっていることを話してみて。一緒に考えましょう。外の雨も上がったし、自分のために少し時間を残してもいいでしょう。';
let state={
  voiceChatWizard:{version:1,status:'skipped',step:0,evidence:{}},
  characters:[{id:'yukino',name:'雪之下雪乃',modelId:'',builtin:true,persona:'',personaEnabled:true,personaPromptMode:'detailed',memory:'',useMemory:false}],activeCharacter:'yukino',
  collapsed:false,showAvatar:true,width:290,accent:'#477fd1',background:'#f1f6fc',reduce:true,
  bubbleLanguage:'both',translationMode:'api',chatMode:'api',setupDismissedVersion:'0.4.0-base.1',
  profiles:[{id:'visual-qa',name:'界面验证 · 无网络请求',providerId:'custom',base:'https://example.invalid/v1',model:'qa-chat'}],activeProfile:'visual-qa',
  conversations:[{id:'qa-conversation',title:'雨后的图书馆（界面测试）',messages:[
    {id:'qa-user',role:'user',content:'今天有点累，想先安静地待一会儿。'},
    {id:'qa-assistant',role:'assistant',content:zh,zh,ja,status:'done',translationStatus:'ready',source:'api'},
  ]}],activeConversation:null,personaEnabled:true,personaPromptMode:'detailed',persona:'',memory:'',useMemory:false,
};
const scenario=process.argv.find(value=>value.startsWith('--voice-wizard-scenario='))?.split('=')[1]||'fresh';
let configurationSignature=scenario==='stale'?'synthetic-new-credential-version':'synthetic-current-configuration';
if(['fresh','configured-delayed'].includes(scenario))delete state.voiceChatWizard;
if(scenario==='stale')state.voiceChatWizard={version:1,status:'completed',step:7,evidence:Object.fromEntries(['asr','audition','chain'].map(name=>[name,{verified:true,signature:'synthetic-old-configuration',verifiedAt:1}]))};
if(scenario==='skipped')state.voiceChatWizard={version:1,status:'skipped',step:2,evidence:{}};
let voice={enabled:false,python:'',root:'',gpt:'',sovits:'',reference:'',bert:'',hubert:'',ffmpeg:'',promptText:'',promptLang:'ja',textLang:'all_ja',version:'v1',device:'auto',half:false,cpuFallback:true,cpuThreads:4,speed:1,volume:.8,timeout:300};
let companions={mode:'none',closeAction:'ask',bubbleLanguage:'zh',position:'right',scale:1,opacity:1,alwaysOnTop:true,animation:true,modelReady:false,petReady:true,voiceCount:0,startupAvailable:true,usage:{todayMs:5760000,sessionMs:1380000,totalMs:48960000}};
let translation={ready:false,available:false,phase:'unloaded',modelInstalled:false,runtimeAvailable:false,modelSource:'downloaded',model:'tencent/Hy-MT2-1.8B-GGUF',modelBytes:1133107392,device:'auto',config:{python:'',modelDir:'',device:'auto',cpuThreads:4,cpuFallback:true,timeout:180}};
let local={phase:'unloaded',modelInstalled:false,runtimeAvailable:false,available:false,ready:false,model:'雪乃本地角色模型 · 1.5B',config:{device:'auto',cpuFallback:true,maxNewTokens:256,cpuThreads:4,python:'',modelDir:''}};
let setup={phase:'idle',ready:false,runtimeVariants:['cpu'],steps:[
  {id:'runtime',state:'missing',downloadBytes:681369634,detail:'需要公共 Python 与推理依赖，仅桌宠不需要'},
  {id:'chat',state:'missing',downloadBytes:964897463,detail:'按需安装已训练的 1.5B 角色权重'},
  {id:'translation',state:'missing',downloadBytes:1133107392,detail:'按需安装 Hy-MT2 翻译权重'},
  {id:'voiceCore',state:'missing',downloadBytes:840308148,detail:'需要 BERT 与 HuBERT 公共语音模型'},
  {id:'voicePreset',state:'missing',downloadBytes:233655246,detail:'默认音色需下载；小型参考声音随应用提供'},
  {id:'pet',state:'missing',downloadBytes:80380288,detail:'2,391 段预录声音，独立下载，不依赖 Python'},
]};
const qaCalls={help:[],install:[],cancel:0,asrStart:0,microphone:0,synthesize:0,send:0,save:0,voiceStatusRequests:0,voiceStatusReturned:0};
let selectedFeatures=[];
const selectedStep=id=>id==='runtime'?selectedFeatures.some(value=>value!=='pet'):selectedFeatures.includes(({voiceCore:'voice',voicePreset:'voice'})[id]||id);
let setupResolve;
let keyIds=['visual-qa'];
const no=async()=>undefined;
const noNetwork=async()=>{throw Error('界面截图模式不会访问网络或加载真实模型。');};
const voiceStatus=()=>scenario==='configured-delayed'?{phase:'unloaded',configured:true,needsSetup:false,missing:[],message:'Synthetic existing-user configured state; no real inference was performed.'}:({phase:'unloaded',configured:false,needsSetup:true,missing:[{key:'python',label:'公共运行环境'},{key:'bert',label:'语音公共模型'}],message:'语音资源尚未准备好，请完成声音配置。'});
const updateCompanions=patch=>{companions={...companions,...copy(patch)};emit('companion-state',copy(companions));return copy(companions);};
contextBridge.exposeInMainWorld('desktop',{
  load:async()=>({state:copy(state),keyIds:[...keyIds],character:{version:'1.1.0'}}),
  save:async value=>{qaCalls.save++;state=copy(value);},saveKey:async(id,key)=>{keyIds=key.trim()?[...new Set([...keyIds,id])]:keyIds.filter(value=>value!==id);},test:async()=> '界面验证模式 · 未发送请求',
  apiProviders:async()=>[
    {id:'deepseek',name:'DeepSeek',base:'https://api.deepseek.com',note:'界面验证目录，不发送请求。'},
    {id:'openai',name:'OpenAI',base:'https://api.openai.com/v1',note:'界面验证目录，不发送请求。'},
    {id:'custom',name:'自定义兼容服务',base:'',keyOptional:true,note:'界面验证目录，不发送请求。'},
  ],
  apiModels:async()=>({status:'ok',verified:true,message:'界面验证：已载入 2 个合成测试模型，未发送网络请求。',models:[{id:'qa-chat',name:'界面测试对话模型'},{id:'qa-vision',name:'界面测试视觉模型'}]}),
  send:async request=>{qaCalls.send++;emit('chunk',{id:request.id,text:zh});return{ok:true,bilingual:{zh,ja,translationStatus:'ready',source:request.mode==='local'?'local':'api'}};},
  stop:no,window:async action=>{if(action==='close')emit('close');},openCommunity:no,openHelp:async topic=>{qaCalls.help.push(topic);},qaCalls:async()=>copy(qaCalls),
  characterDocument:async()=>({version:'1.1.0',text:'界面验证仅使用占位文本。正式角色档案由生产主进程提供。'}),
  characterPreview:async()=>({characters:4810,mode:'detailed',enabled:true,local:false}),
  onChunk:fn=>on('chunk',fn),onError:fn=>on('error',fn),
  voiceResources:async()=>({phase:'idle',bundled:false,coreReady:false,preset:null,packs:Array.from({length:5},(_,i)=>({id:`yukino-e${i+1}`,kind:'voice',bundled:false,installed:false,label:`雪乃 · GPT e${i+1} / SoVITS e1（v1）`}))}),
  voiceInstall:noNetwork,voiceDownloadCancel:no,onVoiceDownload:fn=>on('voice-download',fn),
  voiceSettings:async()=>copy(voice),voiceSave:async value=>{voice=copy(value);return copy(voice);},voicePatch:async value=>{voice={...voice,...copy(value)};return copy(voice);},
  voiceStatus:async()=>{qaCalls.voiceStatusRequests++;if(scenario==='configured-delayed')await new Promise(done=>setTimeout(done,800));qaCalls.voiceStatusReturned++;return voiceStatus();},voiceProbe:async()=>({torch:'界面测试',cudaAvailable:false,devices:[]}),
  voiceLoad:noNetwork,voiceUnload:no,voiceBegin:no,voicePrewarm:no,voiceSynthesize:noNetwork,voiceStop:no,voicePick:async()=>null,
  onVoiceStatus:fn=>on('voice-status',fn),
  translate:async()=>({text:ja,source:'zh',target:'ja',device:'qa-fixture'}),
  translationStatus:async()=>copy(translation),translationSave:async config=>{translation.config=copy(config);return copy(translation);},
  translationInstall:noNetwork,translationCancel:no,translationPick:async()=>null,onTranslationStatus:fn=>on('translation-status',fn),
  localChatSettings:async()=>copy(local.config),localChatSave:async config=>{local.config=copy(config);return copy(local);},localChatStatus:async()=>copy(local),
  localChatLoad:async()=>{local={...local,phase:'ready',ready:true,metadata:{device:'cpu'}};emit('local-status',copy(local));return copy(local);},
  localChatUnload:async()=>{local={...local,phase:'unloaded',ready:false};emit('local-status',copy(local));return copy(local);},
  localChatProbe:async()=>({gpuRuntimeAvailable:false}),onLocalChatStatus:fn=>on('local-status',fn),
  setupStatus:async()=>copy(setup),onSetupStatus:fn=>on('setup-status',fn),
  setupInstall:async options=>{
    selectedFeatures=[...options.features];qaCalls.install.push(copy(options));
    const active=selectedFeatures.some(value=>value!=='pet')?'runtime':'pet';
    const total=active==='runtime'?1073741824:80380288,received=active==='runtime'?268435456:20095072;
    setup={...setup,phase:'installing',steps:setup.steps.map(step=>!selectedStep(step.id)?{...step,state:'skipped'}:step.id===active?{...step,state:'downloading',bytes:received,total,progress:{engine:'aria2',received,total,sourceLabel:'GitHub Release · QA fixture'}}:{...step,state:'missing'})};
    emit('setup-status',copy(setup));return new Promise(resolve=>{setupResolve=resolve;});
  },
  setupCancel:async()=>{qaCalls.cancel++;setup={...setup,phase:'cancelled',steps:setup.steps.map(step=>({...step,state:'missing',bytes:0,total:0,progress:null}))};emit('setup-status',copy(setup));setupResolve?.(copy(setup));setupResolve=null;return copy(setup);},
  qaCompleteSetup:async()=>{
    setup={...setup,phase:'ready',ready:true,steps:setup.steps.map(step=>({...step,state:selectedStep(step.id)?'ready':'skipped',bytes:0,total:0,progress:null}))};
    const runtimeAvailable=selectedFeatures.some(value=>value!=='pet');
    if(selectedFeatures.includes('chat'))local={...local,modelInstalled:true,runtimeAvailable,available:true};
    if(selectedFeatures.includes('translation'))translation={...translation,modelInstalled:true,runtimeAvailable,available:true};
    if(selectedFeatures.includes('pet'))updateCompanions({voiceCount:2391});
    emit('setup-status',copy(setup));emit('local-status',copy(local));emit('translation-status',copy(translation));setupResolve?.(copy(setup));setupResolve=null;
  },
  companionState:async()=>copy(companions),companionSet:async patch=>updateCompanions(patch),
  companionAction:async action=>updateCompanions(action.startsWith('focus-')?{focus:action==='focus-cancel'?{active:false}:{active:true,remainingMs:Number(action.slice(6))*60000}}:{mode:'pet',lastAction:action}),
  closeChoice:async(mode,options={})=>updateCompanions({mode:mode==='quit'?'none':mode,...(options.remember?{closeAction:mode}:{})}),
  onCompanionState:fn=>on('companion-state',fn),onOpenSettings:fn=>on('open-settings',fn),onCloseRequested:fn=>on('close',fn),onFlushState:fn=>on('flush',fn),flushComplete:no,
  qaState:async()=>copy(state),
  qaChangeConfigurationSignature:async()=>{configurationSignature+='-changed';return configurationSignature;},
  voiceChainState:async()=>({configurationSignature,asr:{configId:'synthetic-asr',provider:'Synthetic QA only',model:'no-real-asr',validation:{state:'untested'}},chat:{configId:'visual-qa',model:'qa-chat',kind:'api',validation:{state:'untested'}},voice:{status:voiceStatus(),config:copy(voice)},translation:{kind:'api',model:'qa-chat'}}),
  apiServiceCatalog:async()=>({providers:[{id:'openai-asr',brand:'openai',name:'OpenAI · synthetic fixture',capabilities:['asr'],implementation:'synthetic-only',realAdaptationStatus:'catalog-only',languages:['zh','ja'],fields:[],description:'Synthetic renderer fixture; no real API connection.'}]}),apiValidationStatus:async()=>({}),
  asrStart:async()=>{qaCalls.asrStart++;throw Error('QA forbids ASR');},asrStop:no,asrAudio:no,asrFinish:no,onAsrStatus:fn=>on('asr',fn),onMicrophoneRevoked:fn=>on('microphone-revoked',fn),microphonePermission:async()=>{qaCalls.microphone++;throw Error('QA forbids microphone');},
  voiceSynthesize:async()=>{qaCalls.synthesize++;throw Error('QA forbids real speech synthesis');},

});
