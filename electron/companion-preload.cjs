const { contextBridge, ipcRenderer } = require('electron');
const allowed = new Set(['ready','video-pack','catalog','voice-url','open-main','settings','prefs','action','quote','cursor','hide','quit','hit-test','drag-start','drag-move','drag-end','menu','menu-open','menu-close','walk-step','drag-cancel','chat-submit','chat-stop','vision-open','vision-stop','model-character','model-data','model-catalog']);
contextBridge.exposeInMainWorld('companion', {
  call: (action, payload) => { if (!allowed.has(action)) return Promise.reject(Error('无效操作')); return ipcRenderer.invoke('companion-view', action, payload); },
  onSpeech: callback => { const listener=(_event,value)=>callback(value);ipcRenderer.on('companion-speech',listener);return()=>ipcRenderer.removeListener('companion-speech',listener); },
  onMouth: callback => { const listener=(_event,value)=>callback(value);ipcRenderer.on('companion-mouth',listener);return()=>ipcRenderer.removeListener('companion-mouth',listener); },
  onState: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('companion-state', listener); return () => ipcRenderer.removeListener('companion-state', listener); },
  onAction: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('companion-action', listener); return () => ipcRenderer.removeListener('companion-action', listener); },
});
