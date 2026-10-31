const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {bundledVoiceDefaults,mergeVoiceDefaults}=require('../electron/bundled-voice.cjs');
const {createHash}=require('node:crypto');
const hash=data=>createHash('sha256').update(data).digest('hex');
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-voice-scope-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
async function write(root,name,data='fixture'){const file=path.join(root,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,data);return file;}
async function runtime(root){
 await write(root,'python-runtime/python.exe');await write(root,'python-runtime/ffmpeg.exe');
 await write(root,'inference-engine/yukino-runtime.json',JSON.stringify({revision:'a'.repeat(40)}));
 await write(root,'inference-engine/GPT_SoVITS/TTS_infer_pack/TTS.py','engine fixture');
}
async function preset(root){
 const files=[];
 for(const kind of ['gpt','sovits','reference']){const data=Buffer.from(kind+' fixture');await write(root,'voice-models/'+kind+'.bin',data);files.push({kind,path:kind+'.bin',bytes:data.length,sha256:hash(data)});}
 await write(root,'voice-models/preset.json',JSON.stringify({schemaVersion:1,version:'v1',promptText:'こんにちは。',promptLang:'ja',files}));
}

test('old runtime files cannot make the current voice bundle installed even when runtimeRoot points to them',async t=>{
 const root=await fixture(t),legacyDataRoot=path.join(root,'old-data'),oldRuntime=path.join(legacyDataRoot,'runtime','current'),dataRoot=path.join(root,'new-data'),resourceRoot=path.join(root,'new-resources');
 await runtime(oldRuntime);await preset(legacyDataRoot);
 const options={legacyDataRoot,dataRoot,resourceRoot,runtimeRoot:oldRuntime};
 const missing=await bundledVoiceDefaults(options);
 assert.equal(missing.bundled,false);assert.equal(missing.defaults.python,'');assert.equal(missing.defaults.ffmpeg,'');assert.equal(missing.defaults.root,'');assert.equal(missing.preset,null);
 await assert.rejects(fs.access(path.join(dataRoot,'speech-engine')),{code:'ENOENT'});
 assert.equal(await fs.readFile(path.join(oldRuntime,'inference-engine/GPT_SoVITS/TTS_infer_pack/TTS.py'),'utf8'),'engine fixture');
 // A same-prefix sibling is not within the selected data root either.
 const sibling=dataRoot+'-old';await runtime(sibling);
 assert.equal((await bundledVoiceDefaults({...options,runtimeRoot:sibling})).bundled,false);
 const current=path.join(dataRoot,'runtime','new');await runtime(current);
 const ready=await bundledVoiceDefaults({...options,runtimeRoot:current});
 assert.equal(ready.bundled,true);assert.equal(ready.defaults.python,path.join(current,'python-runtime','python.exe'));assert.ok(ready.defaults.root.startsWith(dataRoot+path.sep));
 assert.equal(await fs.readFile(path.join(oldRuntime,'python-runtime/python.exe'),'utf8'),'fixture');
});

test('only current packaged resources provide a bundled runtime and voice preset',async t=>{
 const root=await fixture(t),legacyDataRoot=path.join(root,'legacy'),dataRoot=path.join(root,'data'),resourceRoot=path.join(root,'resources');
 await runtime(legacyDataRoot);await preset(legacyDataRoot);
 assert.equal((await bundledVoiceDefaults({dataRoot,resourceRoot,legacyDataRoot})).bundled,false);
 await runtime(resourceRoot);await preset(resourceRoot);
 const ready=await bundledVoiceDefaults({dataRoot,resourceRoot,legacyDataRoot});
 assert.equal(ready.bundled,true);assert.equal(ready.preset.ready,true);assert.equal(ready.defaults.gpt,path.join(resourceRoot,'voice-models','gpt.bin'));
 const custom={gpt:await write(root,'custom/gpt.ckpt','custom GPT'),sovits:await write(root,'custom/sovits.pth','custom SoVITS'),reference:await write(root,'custom/reference.wav','custom audio'),promptText:'ユーザーの原文。'};
 const saved=Object.freeze({...custom});const merged=mergeVoiceDefaults(saved,ready);
 for(const [key,value] of Object.entries(custom))assert.equal(merged[key],value);
 assert.equal(await fs.readFile(custom.gpt,'utf8'),'custom GPT');assert.equal(await fs.readFile(custom.sovits,'utf8'),'custom SoVITS');assert.equal(await fs.readFile(custom.reference,'utf8'),'custom audio');
 assert.deepEqual(saved,custom);
});
