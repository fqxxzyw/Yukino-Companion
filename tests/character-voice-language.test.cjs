const test=require('node:test'),assert=require('node:assert/strict');
const {mainHarness}=require('./helpers/main-harness.cjs');
const wav=()=>{const value=Buffer.alloc(44);value.write('RIFF');value.write('WAVE',8);return value;};

test('the selected character language reaches the local engine without changing reference language',async()=>{
 const state={profiles:[],conversations:[],activeCharacter:'c',characters:[{id:'c',name:'角色',voiceLanguage:'zh'}]};
 const app=await mainHarness({state});await app.invoke('voice-begin','zh-session');
 const configured=app.voiceActions.filter(value=>value.method==='configure').at(-1).config;
 assert.equal(configured.speechLanguage,'zh');assert.equal(configured.textLang,'all_zh');
 await app.invoke('voice-synthesize','zh-session','你好，今天过得怎么样？');await app.invoke('voice-stop','zh-session');
});

test('the cloud request uses the selected output language independently of the cloned reference',async()=>{
 const calls=[],cloudFetch=async(url,options)=>{calls.push({url,options});return calls.length===1?Response.json({output:{audio:{url:'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/a.wav'}}}):new Response(wav());};
 const state={profiles:[],conversations:[],activeCharacter:'c',characters:[{id:'c',name:'角色',voiceId:'tts',voiceLanguage:'zh'}],apiManagement:{configs:[{id:'tts',providerId:'dashscope-tts',model:'qwen3-tts-flash',fields:{region:'cn-beijing'}}],taskRoutes:{tts:'unassigned'}}};
 const app=await mainHarness({state,cloudFetch});await app.invoke('save',state);await app.invoke('api-credential-save','tts',{apiKey:'key'});
 await app.invoke('voice-begin','cloud-zh');await app.invoke('voice-synthesize','cloud-zh','你好。');
 assert.equal(JSON.parse(calls[0].options.body).input.language_type,'Chinese');await app.invoke('voice-stop','cloud-zh');
});
