const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const path=require('node:path'),root=path.resolve(__dirname,'..');
function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};}
const turn=()=>new Promise(setImmediate);
function harness(){
 const settings=deferred(),response=deferred(),events=[],requests=[];
 const state={chatMode:'api',activeCharacter:'a',activeProfile:'p',profiles:[],characters:[{id:'a'}],conversations:[],usedDates:[],relationship:{},conversationSkinSwitch:false};
 const session={current:null,push:text=>events.push('text:'+text),finish:()=>events.push('finish'),cancel(){this.current=null;}};
 const ctx={effectiveChatMode:state.chatMode,s:state,sref:{current:state},draft:'',busy:false,activeRequest:{current:null},profile:{id:'p',base:'https://example.test/v1',model:'model'},localStatus:{},conversation:null,models:[],
  api:{save:async()=>events.push('save'),send:async request=>{requests.push(request);events.push('chat');return response.promise;}},saveVoice:()=>{events.push('settings');return settings.promise;},
  setError(){},setModal(){},setS(){},setBusy(){},setDraft(){},setSpeechState(){},pinned:{current:false},previewSequence:{current:0},voiceRef:{current:{enabled:true}},speechRef:{current:session},playerRef:{current:{unlock:async()=>{}}},
  uid:(()=>{let n=0;return()=>String(++n)})(),conversationSkin:()=>'',recordUsedDate:()=>({state:[]}),friendlyError:e=>e.message,advanceRelationship:x=>x,
  stopSpeech(){ctx.previewSequence.current++;session.cancel();events.push('stop');},prepareSpeech(id){session.current={id,completion:Promise.resolve({synthesized:true,completed:true})};events.push('prepare:'+id);}};
 vm.createContext(ctx);const main=fs.readFileSync(path.join(root,'src/main.jsx'),'utf8');
 vm.runInContext(main.slice(main.indexOf('function effectiveVoiceRoute('),main.indexOf('async function voicePrepared(')),ctx);
 const source=main.split('async function send(text=draft,')[1].split('\nsendRef.current=send;')[0];
 vm.runInContext('async function send(text=draft,'+source,ctx);
 return {ctx,settings,response,events,requests,send:()=>vm.runInContext("send('hello')",ctx)};
}
test('chat starts while voice settings are saved and prewarms before the reply arrives',async()=>{
 const f=harness(),pending=f.send();await turn();assert.ok(f.events.includes('chat'));assert.ok(!f.events.some(value=>value.startsWith('prepare:')));
 f.settings.resolve({});await turn();assert.ok(f.events.some(value=>value.startsWith('prepare:')));
 f.response.resolve({bilingual:{zh:'你好',ja:'こんにちは。',translationStatus:'ready'}});await pending;
 assert.ok(f.events.indexOf('text:こんにちは。')>f.events.findIndex(value=>value.startsWith('prepare:')));assert.equal(f.events.at(-1),'finish');
});
test('stopping while voice settings are being saved cannot start a late voice session',async()=>{
 const f=harness(),pending=f.send();await turn();f.ctx.stopSpeech();f.response.resolve({stopped:true});await pending;
 f.settings.resolve({});await turn();assert.ok(!f.events.some(value=>value.startsWith('prepare:')||value.startsWith('text:')));
});
test('unassigned voice output keeps text chat working without starting GPT-SoVITS',async()=>{
 const f=harness();f.ctx.s.apiManagement={taskRoutes:{tts:'unassigned'}};
 const pending=f.send();await turn();f.response.resolve({bilingual:{zh:'你好',ja:'こんにちは。',translationStatus:'ready'}});await pending;
 assert.ok(f.events.includes('chat'));assert.ok(!f.events.includes('settings'));assert.ok(!f.events.some(value=>value.startsWith('prepare:')||value.startsWith('text:')));
});
test('character silent setting suppresses speech and explicit cloud binding overrides global output',async()=>{
 const muted=harness();muted.ctx.s.characters[0].voiceId='none';const first=muted.send();await turn();muted.response.resolve({bilingual:{zh:'你好',ja:'こんにちは。',translationStatus:'ready'}});await first;assert.ok(!muted.events.includes('settings'));
 const cloud=harness();cloud.ctx.s.characters[0].voiceId='cloud';cloud.ctx.s.apiManagement={configs:[{id:'cloud',providerId:'dashscope-tts',capabilities:['tts']}],taskRoutes:{tts:'unassigned'}};
 const pending=cloud.send();await turn();assert.ok(cloud.events.includes('settings'));cloud.settings.resolve({});await turn();assert.ok(cloud.events.some(value=>value.startsWith('prepare:')));cloud.response.resolve({bilingual:{zh:'你好',ja:'こんにちは。',translationStatus:'ready'}});await pending;
});
test('Chinese character speech uses the Chinese reply while preserving Japanese translation',async()=>{
 const f=harness();f.ctx.s.characters[0].voiceLanguage='zh';const pending=f.send();await turn();f.settings.resolve({});await turn();
 f.response.resolve({bilingual:{zh:'你好，今天也辛苦了。',ja:'こんにちは。今日もお疲れさま。',translationStatus:'ready'}});await pending;
 assert.equal(f.requests[0].streamSpeech,false);assert.ok(f.events.includes('text:你好，今天也辛苦了。'));assert.ok(!f.events.includes('text:こんにちは。今日もお疲れさま。'));assert.equal(f.events.at(-1),'finish');
});
