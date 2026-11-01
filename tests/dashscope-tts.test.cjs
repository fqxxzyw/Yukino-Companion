const test=require('node:test'),assert=require('node:assert/strict');
const {DashScopeSpeech,audioUrl,origin}=require('../electron/dashscope-tts.cjs');
const config={model:'qwen3-tts-flash',fields:{region:'ap-southeast-1',voice:'Cherry'}};
const wav=()=>{const value=Buffer.alloc(44);value.write('RIFF');value.write('WAVE',8);return value;};
test('real protocol posts text to regional official endpoint and downloads validated audio without credential',async()=>{
 const calls=[],service=new DashScopeSpeech({fetcher:async(url,options)=>{calls.push({url,options});return calls.length===1?new Response(JSON.stringify({output:{audio:{url:'http://dashscope-result-sg.oss-ap-southeast-1.aliyuncs.com/audio.wav?token=signed'}}})):new Response(wav());}});
 service.begin('id',config,'secret');assert.equal(service.prewarm('id').metadata.capabilities.nativeBatch,false);
 assert.deepEqual(await service.synthesize('id','こんにちは。'),wav());
 assert.equal(calls[0].url,'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
 assert.deepEqual(JSON.parse(calls[0].options.body),{model:'qwen3-tts-flash',input:{text:'こんにちは。',voice:'Cherry',language_type:'Auto'}});
 assert.equal(calls[0].options.headers.Authorization,'Bearer secret');assert.equal(calls[0].options.redirect,'error');
 assert.match(calls[1].url,/^https:\/\/dashscope-result-sg/);assert.equal(calls[1].options.headers,undefined);assert.equal(calls[1].options.redirect,'error');
});
test('untrusted addresses and invalid WAV data fail without reporting success',async()=>{
 for(const value of ['http://127.0.0.1/a','https://dashscope-result-a.oss-b.aliyuncs.com.evil.invalid/a','https://x@y.invalid/'])assert.throws(()=>audioUrl(value));
 assert.equal(origin({fields:{region:'cn-beijing'}}),'https://dashscope.aliyuncs.com');
 const service=new DashScopeSpeech({fetcher:async()=>new Response(JSON.stringify({output:{audio:{url:'http://127.0.0.1/a'}}}))});service.begin('x',config,'secret');await assert.rejects(service.synthesize('x','こんにちは。'),/不受信任/);
});
test('cloned voices use the matching Qwen Audio model and dedicated workspace endpoint',async()=>{
 const calls=[],service=new DashScopeSpeech({fetcher:async(url,options)=>{calls.push({url,options});return calls.length===1?Response.json({output:{audio:{url:'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/a'}}}):new Response(wav());}});
 service.begin('clone',{model:'qwen-audio-3.1-tts-flash',fields:{region:'cn-beijing',workspaceId:'workspace-123',voice:'qwen-audio-3.1-tts-flash-myvoice-123'}},'secret');await service.synthesize('clone','你好。');
 assert.equal(calls[0].url,'https://workspace-123.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer');
 assert.deepEqual(JSON.parse(calls[0].options.body).input,{text:'你好。',voice:'qwen-audio-3.1-tts-flash-myvoice-123',format:'wav',sample_rate:24000});
 assert.throws(()=>origin({fields:{region:'cn-beijing',workspaceId:'example.com'}}),/业务空间/);
});
test('stop aborts pending network and a late response cannot complete old session',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve);const service=new DashScopeSpeech({fetcher:async()=>{await gate;return new Response('{}');}});
 service.begin('old',config,'secret');const pending=service.synthesize('old','こんにちは。');service.stop('old');service.begin('new',config,'secret');release();await assert.rejects(pending,/取消|过期/);assert.equal(service.prewarm('new').phase,'ready');
});
test('failure reports HTTP category without leaking service response or key',async()=>{
 const service=new DashScopeSpeech({fetcher:async()=>new Response('secret service details',{status:401})});service.begin('id',config,'secret');await assert.rejects(service.synthesize('id','こんにちは。'),error=>/API Key 无效/.test(error.message)&&!error.message.includes('secret'));
});
test('real main IPC honors saved character binding with no local runtime and sends untranslated Chinese',async()=>{
 const {mainHarness}=require('./helpers/main-harness.cjs');const seen=[];
 const cloudFetch=async(url,options)=>{seen.push({url,options});return seen.length%2?Response.json({output:{audio:{url:'http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/a.wav?x=signed'}}}):new Response(wav());};
 const state={profiles:[],conversations:[],activeCharacter:'a',characters:[{id:'a',name:'角色',voiceId:'tts'}],apiManagement:{configs:[{id:'tts',providerId:'dashscope-tts',model:'qwen3-tts-flash',fields:{region:'cn-beijing'}}],taskRoutes:{tts:'unassigned'}}};
 const app=await mainHarness({state,runtimeReady:false,voiceMissing:['gpt','sovits','bert','hubert','reference'],cloudFetch});await app.invoke('save',state);await app.invoke('api-credential-save','tts',{apiKey:'test-key'});
 await app.invoke('voice-begin','session');assert.equal((await app.invoke('voice-prewarm','session')).phase,'ready');assert.deepEqual(await app.invoke('voice-synthesize','session','你好，今天过得怎么样？'),wav());
 assert.equal(JSON.parse(seen[0].options.body).input.text,'你好，今天过得怎么样？');assert.equal(JSON.parse(seen[0].options.body).input.voice,'Cherry');assert.ok(!app.voiceActions.some(row=>row.method==='synthesize'));
 await app.invoke('voice-stop','session');const globallyRouted={...state,characters:[{...state.characters[0],voiceId:''}],apiManagement:{...state.apiManagement,taskRoutes:{tts:'tts'}}};await app.invoke('save',globallyRouted);await app.invoke('voice-begin','global');await app.invoke('voice-synthesize','global','这是最新任务分配。');await app.invoke('voice-stop','global');assert.equal(JSON.parse(seen[2].options.body).input.text,'这是最新任务分配。');
 const changed={...state,characters:[{...state.characters[0],voiceId:'none'}]};await app.invoke('save',changed);await assert.rejects(app.invoke('voice-begin','silent'),/不使用语音/);assert.equal(seen.length,4);
});
test('deleting a bound cloud configuration requires and saves a character voice replacement',async()=>{
 const {deleteConfiguration}=require('../electron/api-management.cjs');
 const state={profiles:[],characters:[{id:'heroine',name:'角色',voiceId:'tts'}],apiManagement:{configs:[{id:'tts',providerId:'dashscope-tts'}],taskRoutes:{tts:'unassigned'}}};
 assert.throws(()=>deleteConfiguration(state,'tts',{routes:{}}),/替代音色/);
 const next=deleteConfiguration(state,'tts',{routes:{},characterVoices:{heroine:'none'}});assert.equal(next.characters[0].voiceId,'none');assert.equal(state.characters[0].voiceId,'tts');
});
test('real main clone IPC stores the returned voice in a separate config using the same encrypted credential',async()=>{
 const {mainHarness}=require('./helpers/main-harness.cjs');const calls=[];
 const cloudFetch=async(url,options)=>{calls.push({url,options});return Response.json({output:{voice_id:'qwen-audio-3.1-tts-flash-yukino-123'},request_id:'test'});};
 const state={profiles:[],conversations:[],apiManagement:{configs:[{id:'source',providerId:'dashscope-tts',fields:{region:'cn-beijing'}}],taskRoutes:{tts:'builtin-local'}}};
 const app=await mainHarness({state,cloudFetch});await app.invoke('save',state);await app.invoke('api-credential-save','source',{apiKey:'secret'});
 const bytes=Buffer.alloc(44+16000*2*5);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(16000,24);bytes.writeUInt32LE(32000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(bytes.length-44,40);
 await app.invoke('voice-clone-recording',bytes);const result=await app.invoke('voice-clone-create',{configId:'source',authorized:true,language:'ja'});
 assert.notEqual(result.configId,'source');assert.equal(result.config.model,'qwen-audio-3.1-tts-flash');assert.equal(result.config.credentialId,'source');assert.equal(result.config.fields.voice,result.voiceId);
 const body=JSON.parse(calls[0].options.body);assert.equal(body.input.target_model,result.model);assert.match(body.input.audio,/^data:audio\/wav;base64,/);
 const saved=JSON.parse(app.storage.get('state.json'));assert.equal(saved.apiManagement.configs.length,2);assert.ok(!JSON.stringify(saved).includes('secret'));
});
