// QA ONLY. This preload is never included in the application package.
// It exercises the production renderer with deterministic, in-memory fixtures.
const {contextBridge} = require('electron');
const subscriptions = new Map();
function on(name, fn) {
  const listeners = subscriptions.get(name) || new Set();
  listeners.add(fn); subscriptions.set(name, listeners);
  return () => listeners.delete(fn);
}
function emit(name, value) { for (const fn of subscriptions.get(name) || []) fn(value); }
const copy = value => JSON.parse(JSON.stringify(value));
const zh = '先不必急着给今天下结论。\n\n把让你在意的那件事说清楚，我们再一起想办法。窗外的雨已经停了，留一点时间给自己，也没有什么不好。';
const ja = '今日のことを、今すぐ結論づける必要はないわ。\n\n気になっていることを話してみて。一緒に考えましょう。外の雨も上がったし、自分のために少し時間を残してもいいでしょう。';
let state = {
  collapsed:false, side:'left', showAvatar:true, width:290, accent:'#477fd1', background:'#f1f6fc', reduce:true,
  bubbleLanguage:'both', translationMode:'api',
  profiles:[{id:'visual-qa',name:'界面验证 · 无网络请求',base:'https://example.invalid/v1',model:'已连接的对话模型'}],activeProfile:'visual-qa',
  conversations:[{id:'qa-conversation',title:'雨后的图书馆（界面测试）',messages:[
    {id:'qa-user',role:'user',content:'今天有点累，想先安静地待一会儿。'},
    {id:'qa-assistant',role:'assistant',content:zh,zh,ja,status:'done',translationStatus:'ready',source:'api'},
  ]}],activeConversation:null,personaEnabled:true,personaPromptMode:'detailed',persona:'',memory:'',useMemory:false,
};
let voice = {enabled:false,python:'C:\\Yukino\\resources\\python-runtime\\python.exe',root:'',gpt:'',sovits:'',reference:'',bert:'',hubert:'',ffmpeg:'',promptText:'',promptLang:'ja',textLang:'all_ja',version:'v1',device:'auto',half:false,cpuFallback:true,cpuThreads:4,speed:1,volume:.8,timeout:300};
let companions = {mode:'none',closeAction:'ask',bubbleLanguage:'zh',position:'right',scale:1,alwaysOnTop:true,animation:true,modelReady:false,petReady:true,usage:{todayMs:5760000,sessionMs:1380000,totalMs:48960000}};
let translation = {ready:true,available:true,phase:'unloaded',model:'tencent/Hy-MT2-1.8B-GGUF',modelBytes:1133107392,device:'auto',config:{python:'',modelDir:'',device:'auto',cpuThreads:4,cpuFallback:true,timeout:180}};
const no = async () => undefined;
const noNetwork = async () => { throw Error('界面截图模式不会访问网络或加载真实模型。'); };
contextBridge.exposeInMainWorld('desktop', {
  load:async()=>({state:copy(state),keyIds:[],character:{version:'1.1.0'}}),
  save:async value=>{state=copy(value);},saveKey:no,test:async()=> '界面验证模式 · 未发送请求',
  send:async request=>{emit('chunk',{id:request.id,text:zh});return {ok:true,bilingual:{zh,ja,translationStatus:'ready',source:'api'}};},
  stop:no,window:async action=>{if(action==='close')emit('close');},openCommunity:no,
  characterDocument:async()=>({version:'1.1.0',text:'界面验证仅使用占位文本。正式角色档案由生产主进程提供。'}),
  characterPreview:async()=>({characters:4810,mode:'detailed',enabled:true,local:false}),
  onChunk:fn=>on('chunk',fn),onError:fn=>on('error',fn),
  voiceResources:async()=>({phase:'idle',bundled:true,packs:Array.from({length:5},(_,i)=>({id:`yukino-e${i+1}`,kind:'voice',label:`雪乃 · GPT e${i+1} / SoVITS e1（v1）`}))}),
  voiceInstall:noNetwork,voiceDownloadCancel:no,onVoiceDownload:fn=>on('voice-download',fn),
  voiceSettings:async()=>copy(voice),voiceSave:async value=>{voice=copy(value);return copy(voice);},
  voiceStatus:async()=>({phase:'unloaded'}),voiceProbe:async()=>({torch:'界面测试',cudaAvailable:false,devices:[]}),
  voiceLoad:noNetwork,voiceUnload:no,voiceBegin:no,voiceSynthesize:noNetwork,voiceStop:no,voicePick:async()=>null,
  onVoiceStatus:fn=>on('voice-status',fn),
  translate:async()=>({text:ja,source:'zh',target:'ja',device:'qa-fixture'}),
  translationStatus:async()=>copy(translation),translationSave:async config=>{translation.config=copy(config);return copy(translation);},
  translationInstall:noNetwork,translationCancel:no,translationPick:async()=>null,onTranslationStatus:fn=>on('translation-status',fn),
  companionState:async()=>copy(companions),companionSet:async patch=>{companions={...companions,...copy(patch)};emit('companion-state',copy(companions));return copy(companions);},
  closeChoice:no,onCompanionState:fn=>on('companion-state',fn),onCloseRequested:fn=>on('close',fn),
  onFlushState:fn=>on('flush',fn),flushComplete:no,
});
