const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('blinkReview',{allow:()=>ipcRenderer.invoke('blink-review-consent',true),revoke:()=>ipcRenderer.invoke('blink-review-consent',false),data:()=>ipcRenderer.invoke('blink-review-data')});
