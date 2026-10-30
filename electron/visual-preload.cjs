const {contextBridge,ipcRenderer}=require('electron');
const actions=new Set(['read-aloud','info','configure','close','stop','screen-sources','screen-analyze','screen-watch','screen-stop','camera-start','camera-frame','camera-stop']);
contextBridge.exposeInMainWorld('visualCompanion',{call:(action,payload)=>actions.has(action)?ipcRenderer.invoke('companion-visual',action,payload):Promise.reject(Error('无效视觉操作')),onStatus:fn=>{const listener=(_event,value)=>fn(value);ipcRenderer.on('visual-status',listener);return()=>ipcRenderer.removeListener('visual-status',listener)}});
