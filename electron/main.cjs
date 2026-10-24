const {app,BrowserWindow,ipcMain,safeStorage,shell,session}=require('electron');
const fs=require('node:fs/promises');const path=require('node:path');const {chat,endpoint}=require('./chat.cjs');
let win,controller;let saveQueue=Promise.resolve();const location=n=>path.join(app.getPath('userData'),n);
async function read(n,fallback){try{return JSON.parse(await fs.readFile(location(n),'utf8'))}catch(e){if(e.code==='ENOENT')return fallback;throw Error('本地数据读取失败，请保留数据并检查文件。')}}
function write(n,v){const job=saveQueue.then(async()=>{await fs.mkdir(app.getPath('userData'),{recursive:true});await fs.writeFile(location(n+'.tmp'),JSON.stringify(v),'utf8');await fs.rename(location(n+'.tmp'),location(n))});saveQueue=job.catch(()=>{});return job}
async function key(id){const keys=await read('keys.json',{});if(!keys[id])return '';return safeStorage.decryptString(Buffer.from(keys[id],'base64'))}
function handle(name,fn){ipcMain.handle(name,async(e,...args)=>{if(e.sender!==win.webContents||e.senderFrame!==win.webContents.mainFrame)throw Error('不允许的调用');return fn(...args)})}
app.whenReady().then(()=>{
 session.defaultSession.setPermissionRequestHandler((wc,p,callback)=>callback(false));
 win=new BrowserWindow({width:1280,height:840,minWidth:760,minHeight:580,frame:false,backgroundColor:'#f1f6fc',show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());
 handle('load',async()=>({state:await read('state.json',null),keyIds:Object.keys(await read('keys.json',{}))}));
 handle('save',async s=>{if(!s||!Array.isArray(s.conversations)||!Array.isArray(s.profiles)||JSON.stringify(s).length>10000000)throw Error('无效或过大的设置');return write('state.json',s)});
 handle('key',async(id,value)=>{if(typeof id!=='string'||typeof value!=='string'||value.length>8192)throw Error('密钥格式无效');const keys=await read('keys.json',{});if(value){if(!safeStorage.isEncryptionAvailable()||(process.platform==='linux'&&safeStorage.getSelectedStorageBackend()==='basic_text'))throw Error('系统安全存储不可用');keys[id]=safeStorage.encryptString(value).toString('base64')}else delete keys[id];await write('keys.json',keys)});
 async function config(id){const s=await read('state.json',null);const p=s?.profiles.find(p=>p.id===id);if(!p?.base||!p?.model)throw Error('请先保存 API 地址和模型名称');endpoint(p.base);return {profile:p,key:await key(id)}}
 handle('test',async id=>{const c=await config(id);let output='';await chat({...c,messages:[{role:'user',content:'Reply with OK.'}],signal:AbortSignal.timeout(20000),onToken:t=>output+=t});if(!output)throw Error('连接成功但未返回正文');return '连接成功 · 模型已返回内容'});
 handle('chat',async({id,profileId,messages})=>{if(controller)throw Error('请先停止当前回复');if(typeof id!=='string'||!Array.isArray(messages)||messages.length>200||messages.some(m=>!['system','user','assistant'].includes(m.role)||typeof m.content!=='string'||m.content.length>100000))throw Error('消息格式不正确');const c=await config(profileId);const ctrl=new AbortController();controller=ctrl;const timeout=setTimeout(()=>ctrl.abort(),180000);let received=false;try{await chat({...c,messages,signal:ctrl.signal,onToken:text=>{received=true;if(!win.isDestroyed())win.webContents.send('chunk',{id,text})}});if(!received)throw Error('模型没有返回文本');return {ok:true}}catch(e){if(ctrl.signal.aborted)return {stopped:true};throw e}finally{clearTimeout(timeout);if(controller===ctrl)controller=null}});
 handle('stop',()=>controller?.abort());handle('window',a=>{if(a==='minimize')win.minimize();if(a==='maximize')win.isMaximized()?win.unmaximize():win.maximize();if(a==='close')win.close()});
 handle('community',()=>shell.openExternal('https://github.com/fqxxzyw/Yukino-Companion'));
 win.loadFile(path.join(__dirname,'../dist/index.html'));win.once('ready-to-show',()=>win.show());win.on('close',()=>controller?.abort());
});app.on('window-all-closed',()=>app.quit());
