const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {readVoicePreset,mergeVoiceDefaults,bundledVoiceDefaults}=require('../electron/bundled-voice.cjs');
const {DEFAULTS,voiceReadiness,SpeechService}=require('../electron/speech.cjs');
const {VoiceResources}=require('../electron/voice-resources.cjs');
const sha=data=>createHash('sha256').update(data).digest('hex');
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'voice-preset-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
async function write(root,name,data='x'){const target=path.join(root,name);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,data);return target;}

test('bundle preset fills empty defaults but preserves custom pairs and reference text together',()=>{
 const bundle={defaults:{...DEFAULTS,python:path.resolve('/runtime/python.exe'),gpt:path.resolve('/bundle/default.ckpt'),sovits:path.resolve('/bundle/default.pth'),reference:path.resolve('/bundle/ref.wav'),promptText:'こんにちは。',promptLang:'all_ja'}};
 const empty=mergeVoiceDefaults({...DEFAULTS},bundle);assert.equal(empty.gpt,bundle.defaults.gpt);assert.equal(empty.promptText,'こんにちは。');
 const custom=mergeVoiceDefaults({...DEFAULTS,gpt:path.resolve('/custom/gpt.ckpt'),reference:path.resolve('/custom/ref.wav'),promptText:''},bundle);
 assert.equal(custom.gpt,path.resolve('/custom/gpt.ckpt'));assert.equal(custom.sovits,'');assert.equal(custom.promptText,'');assert.equal(custom.reference,path.resolve('/custom/ref.wav'));
 const textOnly=mergeVoiceDefaults({promptText:'ユーザーの原文。'},bundle);assert.equal(textOnly.reference,'');assert.equal(textOnly.promptText,'ユーザーの原文。');
});

test('reference metadata verifies audio bytes and rejects traversal or stale reference',async t=>{
 const root=await fixture(t),base=path.join(root,'voice-models'),files=[];
 for(const kind of ['gpt','sovits','reference']){const data=Buffer.from(kind);await write(base,kind+'.bin',data);files.push({kind,path:kind+'.bin',bytes:data.length,sha256:sha(data)});}
 const manifest={schemaVersion:1,id:'test',packId:'e2',version:'v1',promptLang:'all_ja',promptText:'こんにちは。',files};
 await write(base,'preset.json',JSON.stringify(manifest));assert.equal((await readVoicePreset(root)).metadata.ready,true);
 await write(base,'reference.bin','bad bytes');await assert.rejects(readVoicePreset(root),/校验失败/);
 manifest.files[2].path='../outside.wav';await write(base,'preset.json',JSON.stringify(manifest));await assert.rejects(readVoicePreset(root),/路径/);
});

test('downloaded common runtime is discovered without requiring a preinstalled Python',async t=>{
 const root=await fixture(t),resources=path.join(root,'resources'),data=path.join(root,'data'),runtime=path.join(data,'runtime/current');
 await write(runtime,'python-runtime/python.exe');await write(runtime,'python-runtime/ffmpeg.exe');
 await write(runtime,'inference-engine/yukino-runtime.json',JSON.stringify({revision:'a'.repeat(40)}));await write(runtime,'inference-engine/GPT_SoVITS/TTS_infer_pack/TTS.py');
 const result=await bundledVoiceDefaults({resourceRoot:resources,dataRoot:data});assert.equal(result.bundled,true);assert.equal(result.defaults.python,path.join(runtime,'python-runtime/python.exe'));assert.equal(result.preset,null);
});

test('voice readiness distinguishes runtime, public weights, trained pair and reference without starting inference',async t=>{
 const root=await fixture(t),config={...DEFAULTS,promptText:'こんにちは。'};
 for(const key of ['python','gpt','sovits','reference'])config[key]=await write(root,key+'.file');
 config.root=path.join(root,'engine');await write(config.root,'GPT_SoVITS/TTS_infer_pack/TTS.py');
 for(const key of ['bert','hubert']){config[key]=path.join(root,key);await write(config[key],'config.json');await write(config[key],'pytorch_model.bin');await write(config[key],key==='bert'?'tokenizer.json':'preprocessor_config.json');}
 assert.equal((await voiceReadiness(config)).configured,true);
 await fs.rm(path.join(config.bert,'pytorch_model.bin'));const status=await voiceReadiness(config);assert.equal(status.configured,false);assert.deepEqual(status.missing.map(x=>x.key),['bert']);assert.match(status.message,/BERT 公共模型/);
 config.reference='';config.promptText='';const missing=await voiceReadiness(config);assert.deepEqual(missing.missing.map(x=>x.key),['reference','bert','promptText']);
});

test('first speech automatically loads prepared config and incomplete setup never starts a worker',async t=>{
 const root=await fixture(t),config={...DEFAULTS,python:process.execPath,root,gpt:path.join(root,'gpt'),sovits:path.join(root,'sovits'),reference:path.join(root,'ref'),bert:root,hubert:root,promptText:'こんにちは。'};
 let started=0,ready=false;
 const wav=Buffer.alloc(44);wav.write('RIFF');wav.write('WAVE',8);
 const service=new SpeechService({script:__filename,stateDir:root,readinessChecker:async()=>({configured:ready,needsSetup:!ready,missing:ready?[]:[{key:'bert',label:'BERT 公共模型'}],message:'请准备 BERT 公共模型。'}),workerFactory:()=>{started++;return {closed:false,close(){this.closed=true;},request:async method=>method==='load'?{device:'cpu'}:{audio:wav.toString('base64'),metadata:{device:'cpu'}}};}});
 service.configure(config);service.begin('one');await assert.rejects(service.synthesize('one','こんにちは。'),/BERT 公共模型/);assert.equal(started,0);
 ready=true;service.configure(config);service.begin('two');assert.deepEqual(await service.synthesize('two','こんにちは。'),wav);assert.equal(started,1);assert.equal(service.status.phase,'ready');service.dispose();
});

test('selecting bundled default weights performs no duplicate network download',async t=>{
 const root=await fixture(t),bundled=path.join(root,'bundle'),cache=path.join(root,'download');const gpt=Buffer.from('gpt'),sovits=Buffer.from('sovits');
 await write(bundled,'voice/gpt.ckpt',gpt);await write(bundled,'voice/sovits.pth',sovits);
 const pack={kind:'voice',label:'default',version:'v1',paths:{gpt:'voice/gpt.ckpt',sovits:'voice/sovits.pth'},files:[{path:'voice/gpt.ckpt',bytes:gpt.length,algorithm:'sha256',digest:sha(gpt)},{path:'archive.zip',extract:{path:'voice/sovits.pth',bytes:sovits.length,digest:sha(sovits)}}]};
 const service=new VoiceResources({root:cache,bundledRoot:bundled,bundledPackId:'e2',catalog:{packs:{e2:pack}},fetcher:async()=>{throw Error('unexpected download');}});
 const result=await service.install('e2');assert.equal(result.gpt,path.join(bundled,'voice/gpt.ckpt'));assert.equal(service.status.source,'bundled');assert.equal((await service.inspect()).packs[0].installed,true);
});


test('cancellation during preflight checking never starts a new download',async t=>{
 const root=await fixture(t);let fetched=0,service;
 service=new VoiceResources({root,catalog:{packs:{core:{files:[{path:'weights.bin',bytes:5,algorithm:'sha256',digest:sha(Buffer.from('voice')),url:'https://example.test/weights'}]}}},fetcher:async()=>{fetched++;throw Error('unexpected download');},notify:status=>{if(status.phase==='checking')service.cancel();}});
 await assert.rejects(service.install('core'));assert.equal(fetched,0);assert.equal(service.status.phase,'cancelled');
});
