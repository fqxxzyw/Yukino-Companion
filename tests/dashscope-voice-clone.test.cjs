'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {VoiceCloneService,MODEL}=require('../electron/dashscope-voice-clone.cjs');
const config={providerId:'dashscope-tts',model:'qwen3-tts-flash',fields:{region:'cn-beijing'}},credentials={apiKey:'secret-test-key'};
async function wav(){const {encodeCloneWav}=await import('../src/speech/clone-audio.mjs');return encodeCloneWav([new Uint8Array(16000*2*5)]);}
test('enrollment sends only user-selected recording to official region and returns the model-bound ID',async()=>{
 const calls=[],service=new VoiceCloneService({fetcher:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({request_id:'r1',output:{voice_id:'qwen-audio-3.1-tts-flash-yukino-abc'}}),{status:200});}});
 const file=await wav();await service.selectRecording(file);
 await assert.rejects(service.create({config,credentials,authorized:false}),/有权/);assert.equal(calls.length,0);
 const result=await service.create({config,credentials,authorized:true,language:'ja'});
 assert.deepEqual(result,{voiceId:'qwen-audio-3.1-tts-flash-yukino-abc',model:MODEL,requestId:'r1'});
 assert.equal(calls[0].url,'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization');assert.equal(calls[0].options.redirect,'error');
 const payload=JSON.parse(calls[0].options.body);assert.equal(payload.model,'voice-enrollment');assert.equal(payload.input.target_model,MODEL);assert.equal(payload.input.action,'create_voice');assert.deepEqual(payload.input.language_hints,['ja']);assert.match(payload.input.audio,/^data:audio\/wav;base64,/);assert.equal(payload.input.audio.slice(22),Buffer.from(file).toString('base64'));
 await assert.rejects(service.create({config,credentials,authorized:true}),/选择录音/);
});
test('untrusted, missing and invalid recordings cannot reach the network',async()=>{
 let sent=0;const service=new VoiceCloneService({fetcher:async()=>{sent++;throw Error('unexpected')}});
 await assert.rejects(service.selectRecording(Uint8Array.of(1,2,3)),/无效/);
 await assert.rejects(service.selectFile('relative.wav'),/本机/);
 await service.selectRecording(await wav());await assert.rejects(service.create({config:{...config,providerId:'custom'},credentials,authorized:true}),/百炼/);
 await assert.rejects(service.create({config,credentials,authorized:true,language:'invalid'}),/语言/);assert.equal(sent,0);
});
test('a selected MP4 uses the local extractor and uploads only the resulting WAV',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-clone-media-test-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const file=path.join(directory,'sample.mp4'),video=Buffer.alloc(80,0x56),audio=Buffer.from(await wav());
 await fs.writeFile(file,video);
 const calls=[],service=new VoiceCloneService({
  extractAudio:async selected=>{assert.equal(selected,file);return audio;},
  fetcher:async(url,options)=>{calls.push(JSON.parse(options.body));return new Response(JSON.stringify({output:{voice_id:'voice-1'}}));},
 });
 assert.deepEqual(await service.selectFile(file),{name:'sample.mp4',bytes:audio.length,extracted:true});
 assert.equal(calls.length,0);
 await service.create({config,credentials,authorized:true});
 assert.equal(calls[0].input.audio,`data:audio/wav;base64,${audio.toString('base64')}`);
});
test('cancellation aborts in-flight upload and late responses cannot claim a created voice',async()=>{
 let complete;const service=new VoiceCloneService({fetcher:()=>new Promise(resolve=>{complete=resolve})});await service.selectRecording(await wav());
 const running=service.create({config,credentials,authorized:true});service.cancel();complete(new Response(JSON.stringify({output:{voice_id:'late'}}),{status:200}));
 await assert.rejects(running,/取消或超时/);await assert.rejects(service.create({config,credentials,authorized:true}),/选择录音/);
});
test('cancel or a later selection invalidates an earlier pending file read',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'yukino-clone-test-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const file=path.join(directory,'voice.wav');await fs.writeFile(file,await wav());
 const service=new VoiceCloneService({fetcher:async()=>{throw Error('unexpected')}});
 const pending=service.selectFile(file);service.cancel();await assert.rejects(pending,/取消/);assert.equal(service.selected,null);
 const first=service.selectFile(file);await service.selectRecording(await wav());await assert.rejects(first,/取消/);assert.equal(service.selected.name,'麦克风录音.wav');
});
test('recorded PCM becomes a bounded valid WAV without inventing missing samples',async()=>{
 const {encodeCloneWav}=await import('../src/speech/clone-audio.mjs');assert.throws(()=>encodeCloneWav([new Uint8Array(100)]),/至少需要 5 秒/);
 const data=encodeCloneWav([new Uint8Array(16000*2*61)]);assert.equal(data.length,44+16000*2*60);assert.equal(new DataView(data.buffer).getUint32(40,true),16000*2*60);
});
