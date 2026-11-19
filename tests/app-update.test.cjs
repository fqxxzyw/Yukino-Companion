const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {createUpdater,newer,trustedAsset}=require('../electron/app-update.cjs');
test('only newer numeric stable versions and trusted GitHub assets qualify',()=>{assert.equal(newer('v0.5.0','0.4.0'),true);assert.equal(newer('v0.4.0-base.4','0.4.0'),false);assert.equal(newer('v0.4.0','0.4.0'),false);assert.equal(trustedAsset({browser_download_url:'https://evil.example/a',size:2}),false)});
test('download verifies bytes before replacing the chosen file',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-update-'));const dest=path.join(dir,'installer.exe');const payload=Buffer.from('test installer');const digest=crypto.createHash('sha256').update(payload).digest('hex');const asset={name:'Yukino-Companion-0.5.0-Base-Setup.exe',size:payload.length,digest:'sha256:'+digest,browser_download_url:'https://github.com/fqxxzyw/Yukino-Companion/releases/download/v0.5.0/setup.exe'};const oldFetch=global.fetch;let bad=false;
 global.fetch=async url=>url.includes('api.github.com')?new Response(JSON.stringify([{tag_name:'v0.5.0',assets:[asset]}])):new Response(bad?Buffer.from('bad installer!'):payload);
 try{const updater=createUpdater({app:{getVersion:()=> '0.4.0',getPath:()=>dir},dialog:{showSaveDialog:async()=>({filePath:dest})},shell:{showItemInFolder(){}},send(){}});assert.deepEqual(await updater.check(),{version:'v0.5.0',downloadable:true,portable:true,native:false});await updater.download();assert.deepEqual(await fs.readFile(dest),payload);bad=true;await assert.rejects(updater.download());assert.deepEqual(await fs.readFile(dest),payload);assert.deepEqual((await fs.readdir(dir)),['installer.exe'])}finally{global.fetch=oldFetch;await fs.rm(dir,{recursive:true,force:true})}
});

test('newer releases without installer still appear with GitHub as the available route',async()=>{const oldFetch=global.fetch;global.fetch=async()=>new Response(JSON.stringify([{tag_name:'v0.5.0',assets:[]} ]));try{const updater=createUpdater({app:{getVersion:()=> '0.4.0'},dialog:{},shell:{},send(){}});assert.deepEqual(await updater.check(),{version:'v0.5.0',downloadable:false,portable:true,native:false});await assert.rejects(updater.download(),/GitHub/)}finally{global.fetch=oldFetch}});

test('installed builds use electron-updater differential download and restart-to-install',async()=>{
 const listeners={};
 const nativeUpdater={
  autoDownload:true,autoInstallOnAppQuit:true,allowPrerelease:true,allowDowngrade:true,disableDifferentialDownload:false,logger:null,
  on(name,fn){listeners[name]=fn},
  async checkForUpdates(){return {isUpdateAvailable:true,updateInfo:{version:'0.5.0',files:[{url:'https://github.com/fqxxzyw/Yukino-Companion/releases/download/v0.5.0/setup.exe',size:1000,sha512:'sha512'}]}}},
  async downloadUpdate(){listeners['download-progress']?.({transferred:200,total:300,percent:66.7});return ['C:\cache\setup.exe']},
  quitAndInstall(silent,force){this.quitArgs=[silent,force];return true},
 };
 const progress=[];
 const updater=createUpdater({app:{isPackaged:true,getVersion:()=> '0.4.0'},dialog:{},shell:{openExternal(){}},send:(channel,value)=>progress.push({channel,value}),nativeUpdater,isPortable:false});
 assert.deepEqual(await updater.check(),{version:'v0.5.0',downloadable:true,portable:false,native:true,differential:true,fullSize:1000});
 assert.equal(nativeUpdater.autoDownload,false);
 assert.equal(nativeUpdater.autoInstallOnAppQuit,false);
 const result=await updater.download();
 assert.equal(result.ready,true);assert.equal(result.differential,true);assert.equal(result.bytes,200);assert.equal(result.total,300);assert.equal(result.fullSize,1000);
 assert.equal(progress.at(-1).channel,'app-update-progress');assert.equal(progress.at(-1).value.differential,true);
 await updater.install();assert.deepEqual(nativeUpdater.quitArgs,[false,true]);
});

test('a full fallback download is reported as full, and no-update checks return null',async()=>{
 const listeners={},nativeUpdater={autoDownload:true,autoInstallOnAppQuit:true,allowPrerelease:true,allowDowngrade:true,disableDifferentialDownload:false,logger:null,on(name,fn){listeners[name]=fn},async checkForUpdates(){return {isUpdateAvailable:false,updateInfo:{version:'0.4.0',files:[]}}},async downloadUpdate(){listeners['download-progress']?.({transferred:1000,total:1000,percent:100});return ['setup.exe']},quitAndInstall(){return true}};
 const updater=createUpdater({app:{isPackaged:true,getVersion:()=> '0.4.0'},dialog:{},shell:{openExternal(){}},send(){},nativeUpdater,isPortable:false});
 assert.equal(await updater.check(),null);
 const secondNative={...nativeUpdater,async checkForUpdates(){return {isUpdateAvailable:true,updateInfo:{version:'0.5.0',files:[{url:'https://github.com/fqxxzyw/Yukino-Companion/releases/download/v0.5.0/setup.exe',size:1000,sha512:'sha512'}]}}},on(name,fn){listeners[name]=fn}};
 const second=createUpdater({app:{isPackaged:true,getVersion:()=> '0.4.0'},dialog:{},shell:{openExternal(){}},send(){},nativeUpdater:secondNative,isPortable:false});
 await second.check();const result=await second.download();assert.equal(result.differential,false);assert.equal(result.total,1000);
});
