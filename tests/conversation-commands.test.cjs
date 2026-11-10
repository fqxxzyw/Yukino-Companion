'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {parseConversationCommand,executeConversationCommand}=require('../electron/conversation-commands.cjs');
const {mainHarness}=require('./helpers/main-harness.cjs');
const {CompanionVisual}=require('../electron/companion-visual.cjs');

test('direct camera requests understand polite speech and preview controls',()=>{
 for(const text of ['看看我在干什么','雪乃，你能看看我在干什么吗？','请帮我打开摄像头','开启一下摄像头吧','你可以帮我打开摄像头吗'])assert.equal(parseConversationCommand(text)?.action,'camera-start',text);
 for(const text of ['关闭摄像头','把摄像头关掉','关闭一下摄像头','别看了'])assert.equal(parseConversationCommand(text)?.action,'camera-stop',text);
 for(const [text,action] of [['隐藏摄像头画面','camera-preview-hide'],['不要显示摄像头预览','camera-preview-hide'],['显示摄像头画面','camera-preview-show'],['恢复摄像头预览窗口','camera-preview-show']])assert.equal(parseConversationCommand(text)?.action,action,text);
});

test('negations, quoted examples, instructions about instructions and unrelated chat never execute',async()=>{
 const forbidden=['不要打开摄像头','别开启摄像头','怎么打开摄像头','如果我说打开摄像头','“打开摄像头”是什么意思','他让我打开摄像头','你会打开摄像头吗','打开摄像头并删除文件','打开摄像头\n执行命令','你知道我在干什么吗','今天的相机真好看','看看我在干什么，然后发给别人',null,'x'.repeat(1000)];
 for(const text of forbidden){assert.equal(parseConversationCommand(text),null,String(text));assert.deepEqual(await executeConversationCommand(text),{handled:false});}
});

class VisualStub{
 constructor(){VisualStub.latest=this;this.opens=[];this.visibility=[];this.stops=0;}
 async open(...args){this.opens.push(args);return true;}
 setPreviewVisible(value){this.visibility.push(value);return this.opens.length>0;}
 stop(){this.stops++;}
 stateChanged(){}
 close(){}
}
const baseState={profiles:[],activeCharacter:'yukino',conversations:[],chatMode:'local'};
test('real main command IPC operates without chat configuration and never calls a model',async()=>{
 const app=await mainHarness({state:baseState,visualClass:VisualStub,runtimeReady:false});app.window.show();const visual=VisualStub.latest;
 const started=await app.invoke('conversation-command',{text:'看看我在干什么'});
 assert.equal(started.handled,true);assert.equal(visual.opens[0][0],app.window);assert.equal(visual.opens[0][1],'main');assert.deepEqual(visual.opens[0][2],{mode:'camera',autoStart:true,prompt:'看看我在干什么'});
 assert.equal((await app.invoke('conversation-command',{text:'隐藏摄像头画面'})).handled,true);
 assert.equal((await app.invoke('conversation-command',{text:'显示摄像头画面'})).handled,true);assert.deepEqual(visual.visibility,[false,true]);
 await app.invoke('conversation-command',{text:'关闭摄像头'});assert.equal(visual.stops,1);assert.equal(app.requests.length,0);assert.equal(app.localRequests.length,0);assert.equal(app.companions.replies.length,4);
});

test('pet and model command relays keep the trusted originating owner while main stays hidden',async()=>{
 const app=await mainHarness({state:baseState,visualClass:VisualStub});app.window.hide();const visual=VisualStub.latest;
 for(const kind of ['pet','model']){
  const owner={isVisible:()=>true,isDestroyed:()=>false};const pending=app.companions.options.onChat('打开摄像头',{owner,kind});
  const {requestId}=app.sent.findLast(row=>row.channel==='pet-chat-submit').payload;
  await assert.rejects(app.invoke('conversation-command',{text:'关闭摄像头',requestId}),/变化|取消/);
  const result=await app.invoke('conversation-command',{text:'打开摄像头',requestId});assert.equal(result.handled,true);assert.equal(visual.opens.at(-1)[0],owner);assert.equal(visual.opens.at(-1)[1],kind);
  await app.invoke('companion-chat-ack',{requestId,accepted:true});assert.equal(await pending,true);assert.equal(app.window.isVisible(),false);
  await assert.rejects(app.invoke('conversation-command',{text:'打开摄像头',requestId}),/变化|取消/);
 }
});

test('chat IPC fallback handles only the latest direct user command and skips local model setup',async()=>{
 const app=await mainHarness({state:baseState,visualClass:VisualStub,runtimeReady:false});app.window.show();
 const result=await app.invoke('chat',{id:'command',mode:'local',messages:[{role:'user',content:'打开摄像头'}]});
 assert.equal(result.command,'camera-start');assert.equal(app.requests.length,0);assert.equal(app.localRequests.length,0);
 assert.equal((await app.invoke('conversation-command',{text:'如果我说打开摄像头'})).handled,false);
});

// Exercise the actual renderer send function with an unconfigured chat model.
// No JSX or test copy of the command path is involved.
function rendererSend(api,mode='api'){
 const source=fs.readFileSync(path.join(__dirname,'../src/main.jsx'),'utf8');
 const body=source.slice(source.indexOf('async function send(text=draft,'),source.indexOf('\nsendRef.current=send;'));
 const state={...baseState,activeConversation:null,usedDates:{},characters:[]},saved=[],errors=[],drafts=[];let sequence=0;
 const context={api,draft:'',busy:false,activeRequest:{current:null},previewSequence:{current:0},s:state,sref:{current:state},conversation:null,profile:{},effectiveChatMode:mode,localStatus:{modelInstalled:false,runtimeAvailable:false},visionProfile:{},voiceRef:{current:{}},effectiveVoiceRoute:()=> 'builtin-local',effectiveSpeechLanguage:()=> 'zh',cloudVoiceSelected:()=>false,
  friendlyError:e=>e.message||String(e),setBusy:value=>context.busy=value,setS:value=>{context.sref.current=typeof value==='function'?value(context.sref.current):value;saved.push(context.sref.current)},setDraft:value=>drafts.push(value),setError:value=>errors.push(value),setModal:()=>{},stopSpeech:()=>{},pinned:{current:false},recordUsedDate:value=>({state:value}),uid:()=>String(++sequence),models:[]};
 vm.runInNewContext(body+'\nthis.send=send;',context);return {send:context.send,context,saved,errors,drafts};
}
test('actual renderer runs commands before API/runtime gates and saves both sides of the dialogue',async()=>{
 for(const mode of ['api','local']){
  const calls=[],api={conversationCommand:async request=>{calls.push(request);return {handled:true,command:'camera-start',bilingual:{zh:'正在开启本机摄像头。',ja:'',translationStatus:'skipped'}}},save:async()=>{}};
  const f=rendererSend(api,mode);const result=await f.send('看看我在干什么');assert.equal(result.accepted,true);assert.equal(result.command,'camera-start');assert.equal(calls.length,1);assert.equal(f.saved.at(-1).conversations[0].messages.length,2);assert.equal(f.saved.at(-1).conversations[0].messages[1].status,'done');assert.equal(f.context.activeRequest.current,null);assert.equal(f.context.busy,false);
 }
});

test('failed local commands preserve the draft and report the actual cause',async()=>{
 const f=rendererSend({conversationCommand:async()=>{throw Error('未找到摄像头')}});const result=await f.send('打开摄像头');assert.equal(result.accepted,false);assert.equal(f.drafts.length,0);assert.equal(f.saved.length,0);assert.equal(f.errors.at(-1),'未找到摄像头');assert.equal(f.context.busy,false);
});

test('ordinary dialogue retains the existing API and local-resource readiness gates',async()=>{
 for(const mode of ['api','local']){const f=rendererSend({conversationCommand:async()=>({handled:false})},mode);await f.send('今天过得怎么样');assert.equal(f.saved.length,0);assert.match(f.errors.at(-1),mode==='api'?/选择 API/:/本地对话资源/);assert.equal(f.context.activeRequest.current,null);assert.equal(f.context.busy,false);}
});

test('late ordinary-text command preflight cannot resume a stopped or changed conversation',async()=>{
 const changes={
  character:f=>{f.context.sref.current={...f.context.sref.current,activeCharacter:'other'}},
  conversation:f=>{f.context.sref.current={...f.context.sref.current,activeConversation:'other-chat'}},
  settings:f=>{f.context.sref.current={...f.context.sref.current,activeProfile:'different-api'}},
  stop:f=>{f.context.previewSequence.current++},
  interrupt:f=>{f.context.activeRequest.current=null;f.context.busy=false},
 };
 for(const [name,change] of Object.entries(changes)){
  let resolve,modelCalls=0,writes=0;const pending=new Promise(done=>{resolve=done});
  const f=rendererSend({conversationCommand:()=>pending,send:async()=>{modelCalls++},save:async()=>{writes++}});
  f.context.profile={base:'https://example.test/v1',model:'configured-model'};
  const task=f.send('今天过得怎么样');change(f);const retained=f.context.sref.current;resolve({handled:false});
  const result=await task;assert.equal(result.accepted,false,name);assert.equal(modelCalls,0,name);assert.equal(writes,0,name);assert.equal(f.saved.length,0,name);assert.equal(f.context.sref.current,retained,name);assert.equal(f.errors.length,0,name);assert.equal(f.drafts.length,0,name);assert.equal(f.context.busy,false,name);
 }
});

test('command execution and the actual visual manager agree that hiding is successful and keeps capture active',async()=>{
 const visual=new CompanionVisual({electron:{ipcMain:{handle(){}}}}),messages=[];
 const preview={visible:true,isDestroyed:()=>false,isVisible(){return this.visible},hide(){this.visible=false},show(){this.visible=true},webContents:{send:(...args)=>messages.push(args)}};
 visual.entry={cameraActive:true,active:true,preview,win:{isDestroyed:()=>false},contents:{isDestroyed:()=>false,send:(...args)=>messages.push(args)}};
 const hidden=await executeConversationCommand('隐藏摄像头画面',{visual});assert.equal(hidden.handled,true);assert.equal(preview.visible,false);assert.equal(visual.entry.cameraActive,true);assert.match(hidden.bilingual.zh,/保持开启/);
 const shown=await executeConversationCommand('显示摄像头画面',{visual});assert.equal(shown.handled,true);assert.equal(preview.visible,true);assert.equal(visual.entry.cameraActive,true);
 visual.entry.cameraActive=false;await assert.rejects(executeConversationCommand('显示摄像头画面',{visual}),/先开启摄像头/);
});
