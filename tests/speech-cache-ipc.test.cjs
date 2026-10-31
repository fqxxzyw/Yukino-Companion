const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os'),fs=require('node:fs/promises');
const {mainHarness}=require('./helpers/main-harness.cjs');
const {SpeechCache}=require('../electron/speech-cache.cjs');

test('real main uses install-scoped resource settings, preserving but ignoring legacy top-level paths',async()=>{
 const old=path.resolve('/old-install'),legacyFiles={'speech.json':JSON.stringify({python:path.join(old,'python.exe'),gpt:path.join(old,'voice.ckpt'),reference:path.join(old,'ref.wav')}),'translation.json':JSON.stringify({modelDir:path.join(old,'translation-models')}),'local-chat.json':JSON.stringify({modelDir:path.join(old,'chat-models')}),'resource-directory.json':JSON.stringify({directory:path.join(old,'Yukino-Data')})};
 const app=await mainHarness({state:{},packaged:true,legacyFiles,runtimeReady:false});
 const status=await app.invoke('setup-status',{features:['pet']});assert.equal(status.resourceDirectory,path.resolve('/virtual-install/Yukino-Data'));
 const speech=await app.invoke('voice-settings');assert.notEqual(speech.gpt,path.join(old,'voice.ckpt'));assert.notEqual(speech.reference,path.join(old,'ref.wav'));assert.notEqual((await app.invoke('local-chat-settings')).modelDir,path.join(old,'chat-models'));
 for(const [name,value]of Object.entries(legacyFiles))assert.equal(app.diskStorage.get(name),value);
 await app.invoke('voice-patch',{speed:1.2});assert.equal(JSON.parse(app.storage.get('speech.json')).speed,1.2);assert.equal(app.diskStorage.get('speech.json'),legacyFiles['speech.json']);assert.ok([...app.diskStorage.keys()].some(name=>/^installations[\\/][a-f0-9]{64}[\\/]speech.json$/.test(name)));
});
test('moving the executable cannot activate settings saved in another install namespace',async()=>{
 const first=await mainHarness({state:{},packaged:true});await first.invoke('voice-patch',{gpt:path.resolve('/old-custom/voice.ckpt'),sovits:path.resolve('/old-custom/voice.pth')});await first.invoke('speech-cache-save',{enabled:true,retentionDays:9});
 const next=await mainHarness({state:{},packaged:true,executable:path.resolve('/second-install/Yukino Companion.exe'),legacyFiles:Object.fromEntries(first.diskStorage)});
 assert.notEqual((await next.invoke('voice-settings')).gpt,path.resolve('/old-custom/voice.ckpt'));
 assert.equal((await next.invoke('setup-status',{features:['pet']})).resourceDirectory,path.resolve('/second-install/Yukino-Data'));
 const cache=await next.invoke('speech-cache-status');assert.equal(cache.enabled,false);assert.equal(cache.retentionDays,7);assert.equal(cache.root,path.resolve('/second-install/Yukino-Data/speech-cache'));
 for(const [name,value]of first.diskStorage)assert.equal(next.diskStorage.get(name),value);
});
test('same-install restart retains explicitly saved resources and cache preferences',async()=>{
 const first=await mainHarness({state:{},packaged:true});await first.invoke('voice-patch',{gpt:path.resolve('/custom/voice.ckpt'),sovits:path.resolve('/custom/voice.pth')});await first.invoke('speech-cache-save',{enabled:true,retentionDays:11});
 const restart=await mainHarness({state:{},packaged:true,legacyFiles:Object.fromEntries(first.diskStorage)});assert.equal((await restart.invoke('voice-settings')).gpt,path.resolve('/custom/voice.ckpt'));assert.equal((await restart.invoke('speech-cache-status')).retentionDays,11);assert.equal((await restart.invoke('speech-cache-status')).enabled,true);
});
test('cache IPC has a fixed install root, persists only safe preferences, and uses real disk status',async t=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-cache-ipc-'));t.after(()=>fs.rm(temp,{recursive:true,force:true}));let givenRoot,cache;
 class IsolatedCache extends SpeechCache{constructor(options){givenRoot=options.root;super({root:path.join(temp,'cache')});cache=this;}}
 const app=await mainHarness({state:{},packaged:true,cacheClass:IsolatedCache});assert.equal(givenRoot,path.resolve('/virtual-install/Yukino-Data/speech-cache'));
 assert.equal((await app.invoke('speech-cache-status')).enabled,false);assert.deepEqual(await fs.readdir(temp),[]);
 await assert.rejects(Promise.resolve().then(()=>app.invoke('speech-cache-save',{enabled:true,retentionDays:7,root:path.resolve('/unauthorized')})),/无效/);
 const status=await app.invoke('speech-cache-save',{enabled:true,retentionDays:3});assert.equal(status.error,null);assert.equal(status.retentionDays,3);assert.deepEqual(JSON.parse(app.storage.get('speech-cache.json')),{enabled:true,retentionDays:3});
 await assert.rejects(app.invoke('speech-cache-save',{enabled:true,retentionDays:31}));assert.equal(cache.enabled,true);assert.equal((await app.invoke('speech-cache-status')).retentionDays,3);
 await app.invoke('speech-cache-save',{enabled:false,retentionDays:3});assert.equal(cache.enabled,false);
});
test('new batch IPC forwards only the active session and actual audio result',async()=>{
 const app=await mainHarness({state:{}});await app.invoke('voice-begin','batch');const audio=await app.invoke('voice-synthesize-batch','batch',['こんにちは。','そうですね。']);assert.equal(audio.toString(),'RIFFbatchWAVE');assert.deepEqual(app.voiceActions.find(action=>action.method==='synthesizeBatch').texts,['こんにちは。','そうですね。']);
 await app.invoke('voice-stop','batch');await assert.rejects(app.invoke('voice-synthesize-batch','batch',['こんにちは。']),/expired/);
});
