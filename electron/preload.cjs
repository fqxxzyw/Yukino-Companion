const {contextBridge, ipcRenderer} = require('electron');
const invoke = async (channel, ...args) => {
  try{return await ipcRenderer.invoke(channel, ...args);}
  catch(error){let message=String(error?.message||error).replace(/^Error invoking remote method '[^']+':\s*/,'').replace(/^Error:\s*/,'');
    if(/ENOENT|cannot find|no such file/i.test(message))message='所需的本地文件尚未准备好，请打开设置中的一键配置。';
    else if(/fetch failed|Failed to fetch|ECONNREFUSED|ENOTFOUND|network error/i.test(message))message='连接失败，请检查网络、服务地址或本地服务是否已启动。';
    throw Error(message);
  }
};
function subscribe(channel, fn) {
  const handler = (_event, payload) => fn(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}
contextBridge.exposeInMainWorld('desktop', {
  load:()=>invoke('load'), save:state=>invoke('save',state), saveKey:(id,key,base)=>invoke('key',id,key,base),
  apiProviders:()=>invoke('api-providers'), apiModels:request=>invoke('api-models',request),
  setupStatus:()=>invoke('setup-status'), setupInstall:options=>invoke('setup-install',options), setupCancel:()=>invoke('setup-cancel'),
  onSetupStatus:fn=>subscribe('setup-status',fn),
  localChatSettings:()=>invoke('local-chat-settings'), localChatStatus:()=>invoke('local-chat-status'),
  localChatSave:config=>invoke('local-chat-save',config), localChatLoad:config=>invoke('local-chat-load',config),
  localChatUnload:()=>invoke('local-chat-unload'), localChatProbe:()=>invoke('local-chat-probe'),
  onLocalChatStatus:fn=>subscribe('local-chat-status',fn), onOpenSettings:fn=>subscribe('open-settings',fn),
  send:request=>invoke('chat',request), stop:()=>invoke('stop'), test:id=>invoke('test',id),
  window:action=>invoke('window',action), openCommunity:()=>invoke('community'), openHelp:topic=>invoke('help',topic),
  characterDocument:()=>invoke('character-document'), characterPreview:()=>invoke('character-preview'),
  onChunk:fn=>subscribe('chunk',fn), onError:fn=>subscribe('app-error',fn),
  voiceResources:()=>invoke('voice-resources'), voiceInstall:id=>invoke('voice-install',id),
  voiceDownloadCancel:()=>invoke('voice-download-cancel'), onVoiceDownload:fn=>subscribe('voice-download',fn),
  voiceSettings:()=>invoke('voice-settings'), voiceSave:config=>invoke('voice-save',config),
  voiceStatus:()=>invoke('voice-status'), voiceProbe:config=>invoke('voice-probe',config),
  voiceLoad:config=>invoke('voice-load',config), voiceUnload:()=>invoke('voice-unload'),
  voiceBegin:id=>invoke('voice-begin',id), voiceSynthesize:(id,text)=>invoke('voice-synthesize',id,text),
  voiceStop:id=>invoke('voice-stop',id), voicePick:kind=>invoke('voice-pick',kind),
  onVoiceStatus:fn=>subscribe('voice-status',fn),
  translate:request=>invoke('translate',request), translationStatus:()=>invoke('translation-status'),
  translationSave:config=>invoke('translation-save',config), translationInstall:()=>invoke('translation-install'),
  translationCancel:id=>invoke('translation-cancel',id), translationPick:kind=>invoke('translation-pick',kind),
  onTranslationStatus:fn=>subscribe('translation-status',fn),
  companionState:()=>invoke('companion-state'), companionSet:patch=>invoke('companion-set',patch),
  companionAction:action=>invoke('companion-action',action), closeChoice:(mode,options)=>invoke('close-choice',mode,options), onCompanionState:fn=>subscribe('companion-state',fn),
  onCloseRequested:fn=>subscribe('close-requested',fn),
  onFlushState:fn=>subscribe('flush-state',fn), flushComplete:id=>invoke('flush-complete',id),
});
