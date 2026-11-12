const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('studioWindow', {
  updateSupported: () => ipcRenderer.invoke('studio:update-supported').catch(() => false),
  updateCheck: () => ipcRenderer.invoke('studio:update-check'),
  updateDownload: () => ipcRenderer.invoke('studio:update-download'),
  updateOpen: () => ipcRenderer.invoke('studio:update-open'),
  minimize: () => ipcRenderer.invoke('studio:window-action', 'minimize'),
  maximize: () => ipcRenderer.invoke('studio:window-action', 'maximize'),
  close: () => ipcRenderer.invoke('studio:window-action', 'close'),
  openPlayer: () => ipcRenderer.invoke('studio:window-action', 'openPlayer'),
  getTheme: () => ipcRenderer.invoke('studio:theme-get').catch(() => null),
  getCompanionModelRequest: () => ipcRenderer.invoke('studio:companion-model-request').catch(() => null),
  readCompanionModel: (revision) => ipcRenderer.invoke('studio:companion-model-read', revision),
  onCompanionModel: (callback) => {
    const listener = (_event, request) => callback(request);
    ipcRenderer.on('studio:companion-model', listener);
    return () => ipcRenderer.removeListener('studio:companion-model', listener);
  },
  onTheme: (callback) => {
    const listener = (_event, theme) => callback(theme);
    ipcRenderer.on('studio:theme', listener);
    return () => ipcRenderer.removeListener('studio:theme', listener);
  },
});
