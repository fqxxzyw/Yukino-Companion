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
// Observe only the public, already-computed appearance of the main UI. The
// editor receives no saved settings, conversation content, or credentials.
window.addEventListener('DOMContentLoaded', () => {
  const keys = ['--accent', '--accent-text', '--on-accent', '--bg', '--surface', '--surface-soft',
    '--text', '--secondary', '--tertiary', '--line', '--hover', '--shadow', '--danger', '--danger-bg'];
  let root, last = '', queued = false;
  const publish = () => {
    queued = false;
    if (!root?.isConnected) return;
    const computed = getComputedStyle(root);
    // Registered color properties interpolate in computed style; the bridge must
    // publish the authored target, not an in-between rgb() animation frame.
    const colors = Object.fromEntries(keys.map((key) => [key, root.style.getPropertyValue(key).trim() || computed.getPropertyValue(key).trim()]));
    const value = { colors, scheme: computed.getPropertyValue('--scheme').trim(), reduce: root.classList.contains('reduce') };
    const current = JSON.stringify(value);
    if (current === last) return;
    last = current;
    ipcRenderer.invoke('motion-editor-theme', value).catch(() => {});
  };
  const queue = () => { if (!queued) { queued = true; setTimeout(publish, 0); } };
  const attach = () => {
    const node = document.querySelector('.app');
    if (!node || node === root) return;
    root = node;
    observer.disconnect();
    observer.observe(root, { attributes: true, attributeFilter: ['style', 'class'] });
    queue();
  };
  const observer = new MutationObserver(() => { if (root?.isConnected) queue(); else attach(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  attach();
});
contextBridge.exposeInMainWorld('desktop', {
  appUpdateCheck:()=>invoke('app-update-check'),appUpdateDownload:()=>invoke('app-update-download'),appUpdateOpen:()=>invoke('app-update-open'),onAppUpdateProgress:fn=>subscribe('app-update-progress',fn),
  visionSources:options=>invoke('vision-sources',options), visionAnalyze:options=>invoke('vision-analyze',options), visionWatch:options=>invoke('vision-watch',options), onVisionStatus:fn=>subscribe('vision-status',fn), visionCancel:()=>invoke('vision-cancel'),
  wallpaperPick:()=>invoke('wallpaper-pick'), wallpaperRead:id=>invoke('wallpaper-read',id),
  sceneList:()=>invoke('scene-list'), sceneImport:()=>invoke('scene-import'), sceneRead:id=>invoke('scene-read',id), sceneRemove:id=>invoke('scene-remove',id),
  load:()=>invoke('load'), save:state=>invoke('save',state), saveKey:(id,key,base)=>invoke('key',id,key,base), copyText:value=>invoke('copy-text',value),
  apiProviders:()=>invoke('api-providers'), apiModels:request=>invoke('api-models',request),
  apiServiceCatalog:()=>invoke('api-service-catalog'), apiValidationStatus:()=>invoke('api-validation-status'), apiCredentialSave:(id,values)=>invoke('api-credential-save',id,values),
  apiConfigValidate:request=>invoke('api-config-validate',request),apiConfigDuplicate:id=>invoke('api-config-duplicate',id),apiConfigDelete:request=>invoke('api-config-delete',request),apiOpenOfficial:request=>invoke('api-open-official',request),
  microphonePermission:request=>invoke('microphone-permission',request),asrStart:request=>invoke('asr-start',request),asrAudio:request=>invoke('asr-audio',request),asrFinish:request=>invoke('asr-finish',request),asrStop:request=>invoke('asr-stop',request),onAsrStatus:fn=>subscribe('asr-status',fn),onMicrophoneRevoked:fn=>subscribe('microphone-revoked',fn),
  microphoneRelease:()=>invoke('microphone-release'),
  voiceChainState:()=>invoke('voice-chain-state'),
  resourceDirectoryPick:()=>invoke('resource-directory-pick'), setupStatus:options=>invoke('setup-status',options), setupInstall:options=>invoke('setup-install',options), setupCancel:()=>invoke('setup-cancel'),
  onSetupStatus:fn=>subscribe('setup-status',fn),
  localChatSettings:()=>invoke('local-chat-settings'), localChatStatus:()=>invoke('local-chat-status'),
  localChatSave:config=>invoke('local-chat-save',config), localChatLoad:config=>invoke('local-chat-load',config),
  localChatUnload:()=>invoke('local-chat-unload'), localChatProbe:()=>invoke('local-chat-probe'),
  onLocalChatStatus:fn=>subscribe('local-chat-status',fn), onOpenSettings:fn=>subscribe('open-settings',fn),
  send:request=>invoke('chat',request), conversationCommand:request=>invoke('conversation-command',request), stop:()=>invoke('stop'), test:id=>invoke('test',id),
  window:action=>invoke('window',action), openMotionEditor:modelId=>invoke('motion-editor-open',modelId), openCommunity:()=>invoke('community'), openHelp:topic=>invoke('help',topic),
  characterModelImport:id=>invoke('character-model-import',id), characterModelData:id=>invoke('character-model-data',id), characterActionData:id=>invoke('character-action-data',id), characterDocument:()=>invoke('character-document'), characterPreview:()=>invoke('character-preview'), characterDraft:request=>invoke('character-draft',request), characterDraftCancel:()=>invoke('character-draft-cancel'),
  reportAvatarRect:rect=>invoke('avatar-rect',rect), characterModelCatalog:()=>invoke('character-model-catalog'), characterModelInspect:()=>invoke('character-model-inspect'), characterModelConfirm:options=>invoke('character-model-confirm',options), characterModelCancel:()=>invoke('character-model-cancel'),
  openTripo:()=>invoke('open-tripo'),
  characterGuideLink:id=>invoke('character-guide-link',id),
  onChunk:fn=>subscribe('chunk',fn),onMemoryExtracted:fn=>subscribe('memory-extracted',fn),onSpeechText:fn=>subscribe('speech-text',fn), onError:fn=>subscribe('app-error',fn),
  voiceResources:()=>invoke('voice-resources'), voiceInstall:(id,options)=>invoke('voice-install',id,options), onVoiceConfig:fn=>subscribe('voice-config-updated',fn),
  voiceClonePick:()=>invoke('voice-clone-pick'),voiceCloneRecording:bytes=>invoke('voice-clone-recording',bytes),voiceCloneCreate:request=>invoke('voice-clone-create',request),voiceCloneCancel:()=>invoke('voice-clone-cancel'),
  voiceVerify:(id,component)=>invoke('voice-verify',id,component),voiceWeightStatus:component=>invoke('voice-weight-status',component),voiceRemove:(id,component)=>invoke('voice-remove',id,component),voiceReference:()=>invoke('voice-reference'),openVoiceDocs:()=>invoke('voice-docs'),
  voiceDownloadCancel:()=>invoke('voice-download-cancel'), onVoiceDownload:fn=>subscribe('voice-download',fn),
  voiceSettings:()=>invoke('voice-settings'), voiceSave:config=>invoke('voice-save',config), voicePatch:patch=>invoke('voice-patch',patch),
  voiceStatus:()=>invoke('voice-status'), voiceProbe:config=>invoke('voice-probe',config),
  aquaEnvironmentStatus:()=>invoke('aqua-environment-status'),aquaEnvironmentInstall:python=>invoke('aqua-environment-install',python),aquaEnvironmentCancel:()=>invoke('aqua-environment-cancel'),onAquaEnvironmentProgress:fn=>subscribe('aqua-environment-progress',fn),
  voiceLoad:config=>invoke('voice-load',config), voiceUnload:()=>invoke('voice-unload'),
  voiceBegin:id=>invoke('voice-begin',id), voicePrewarm:id=>invoke('voice-prewarm',id), voiceSynthesize:(id,text)=>invoke('voice-synthesize',id,text),
  voiceSynthesizeBatch:(id,texts)=>invoke('voice-synthesize-batch',id,texts),
  speechCacheStatus:()=>invoke('speech-cache-status'), speechCacheSave:config=>invoke('speech-cache-save',config),
  voiceStop:id=>invoke('voice-stop',id), voicePick:kind=>invoke('voice-pick',kind),
  onVoiceStatus:fn=>subscribe('voice-status',fn),
  translate:request=>invoke('translate',request), translationStatus:()=>invoke('translation-status'),
  translationSave:config=>invoke('translation-save',config), translationInstall:()=>invoke('translation-install'),
  translationCancel:id=>invoke('translation-cancel',id), translationPick:kind=>invoke('translation-pick',kind),
  onTranslationStatus:fn=>subscribe('translation-status',fn),
  onCompanionCaptionStop:fn=>subscribe('companion-caption-stop',fn),
  onCompanionCaption:fn=>subscribe('companion-caption',fn),
  companionChatAck:value=>invoke('companion-chat-ack',value), companionChatError:message=>invoke('companion-chat-error',message), companionSpeechBusy:value=>invoke('companion-speech-busy',value),
  onPetChat:fn=>subscribe('pet-chat-submit',fn), onPetChatStop:fn=>subscribe('pet-chat-stop',fn), onVisionOpen:fn=>subscribe('vision-open',fn), companionSpeech:value=>invoke('companion-speech',value), companionMouth:level=>invoke('companion-mouth',level), companionChatBusy:busy=>invoke('companion-chat-busy',busy),
  companionState:()=>invoke('companion-state'), companionSet:patch=>invoke('companion-set',patch),
  companionAction:action=>invoke('companion-action',action), closeChoice:(mode,options)=>invoke('close-choice',mode,options), onCompanionState:fn=>subscribe('companion-state',fn), onCompanionUse:fn=>subscribe('companion-use',fn),
  live2dViewer:()=>invoke('live2d-viewer'),
  avatarTouchFeedback:value=>invoke('avatar-touch-feedback',value),
  avatarTouchReply:value=>invoke('avatar-touch-reply',value),
  onAvatarHandoff:fn=>subscribe('avatar-handoff',fn), avatarHandoffReady:sequence=>invoke('avatar-handoff-ready',sequence), avatarLayoutReady:value=>invoke('avatar-layout-ready',value),
  onCloseRequested:fn=>subscribe('close-requested',fn), onCloseFeedback:fn=>subscribe('close-feedback',fn),
  onFlushState:fn=>subscribe('flush-state',fn), flushComplete:(id,ok)=>invoke('flush-complete',id,ok),
});
