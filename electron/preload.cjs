const {contextBridge, ipcRenderer} = require('electron');
const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
function subscribe(channel, fn) {
  const handler = (_event, payload) => fn(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}
contextBridge.exposeInMainWorld('desktop', {
  load:()=>invoke('load'), save:state=>invoke('save',state), saveKey:(id,key)=>invoke('key',id,key),
  send:request=>invoke('chat',request), stop:()=>invoke('stop'), test:id=>invoke('test',id),
  window:action=>invoke('window',action), openCommunity:()=>invoke('community'),
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
  closeChoice:mode=>invoke('close-choice',mode), onCompanionState:fn=>subscribe('companion-state',fn),
  onCloseRequested:fn=>subscribe('close-requested',fn),
  onFlushState:fn=>subscribe('flush-state',fn), flushComplete:id=>invoke('flush-complete',id),
});
