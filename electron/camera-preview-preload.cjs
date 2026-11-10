const {contextBridge,ipcRenderer}=require('electron');
const subscribe=(channel,fn)=>{const listener=(_event,value)=>fn(value);ipcRenderer.on(channel,listener);return()=>ipcRenderer.removeListener(channel,listener)};
contextBridge.exposeInMainWorld('cameraPreview',{
 hide:()=>ipcRenderer.invoke('companion-visual','preview-hide'),
 stop:()=>ipcRenderer.invoke('companion-visual','preview-stop'),
 settings:()=>ipcRenderer.invoke('companion-visual','preview-settings'),
 onFrame:fn=>subscribe('camera-preview-frame',fn),
 onClear:fn=>subscribe('camera-preview-clear',fn)
});
