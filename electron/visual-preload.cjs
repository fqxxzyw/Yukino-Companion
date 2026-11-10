const {contextBridge,ipcRenderer}=require('electron');
const actions=new Set(['read-aloud','info','configure','close','stop','screen-sources','screen-analyze','screen-watch','screen-stop','camera-start','camera-frame','camera-stop','preview-open','preview-visible','preview-frame']);
const subscribe=(channel,fn)=>{const listener=(_event,value)=>fn(value);ipcRenderer.on(channel,listener);return()=>ipcRenderer.removeListener(channel,listener)};
contextBridge.exposeInMainWorld('visualCompanion',{call:(action,payload)=>actions.has(action)?ipcRenderer.invoke('companion-visual',action,payload):Promise.reject(Error('无效视觉操作')),onStatus:fn=>subscribe('visual-status',fn),onIntent:fn=>subscribe('visual-intent',fn)});
