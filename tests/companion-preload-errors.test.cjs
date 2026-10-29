'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('companion errors keep the actionable cause without Electron IPC boilerplate',async()=>{
 let bridge;
 const electron={contextBridge:{exposeInMainWorld:(_name,value)=>{bridge=value}},ipcRenderer:{invoke:async()=>{throw Error("Error invoking remote method 'companion-view': Error: 本地模型尚未准备好；输入已保留。")},on(){},removeListener(){}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../electron/companion-preload.cjs'),'utf8'),{require:()=>electron,Promise,Error,String,Set});
 await assert.rejects(bridge.call('chat-submit','你好'),error=>error.message==='本地模型尚未准备好；输入已保留。');
 await assert.rejects(bridge.call('untrusted-action'),/无效操作/);
});
