const { contextBridge, ipcRenderer } = require('electron');
const allowed = new Set(['ready','open-main','hit-test','drag-start','drag-move','drag-end','menu','walk-step']);
contextBridge.exposeInMainWorld('companion', {
  call: (action, payload) => { if (!allowed.has(action)) return Promise.reject(Error('无效操作')); return ipcRenderer.invoke('companion-view', action, payload); },
  onState: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('companion-state', listener); return () => ipcRenderer.removeListener('companion-state', listener); },
});
