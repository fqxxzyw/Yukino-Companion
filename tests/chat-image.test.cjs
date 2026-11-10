const test=require('node:test'),assert=require('node:assert/strict');
const {DRAWING_IMAGE_LIMITS,DRAWING_IMAGE_INSTRUCTION,validateDrawingImage,attachDrawingImage}=require('../electron/chat-image.cjs');
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=';
const decode=()=>({isEmpty:()=>false,getSize:()=>({width:1,height:1})});
const url=bytes=>'data:image/png;base64,'+bytes.toString('base64');

test('a bounded PNG drawing is validated with its real native decoded size',()=>{
 let received;
 assert.equal(validateDrawingImage(image,value=>{received=value;return decode();}),image);
 assert.equal(received,image);assert.equal(DRAWING_IMAGE_LIMITS.bytes,2*1024*1024);
});

test('remote images, malformed encodings and excessive encoded or decoded bytes never reach the decoder',()=>{
 let decodes=0;const decoder=()=>{decodes++;return decode();};
 for(const bad of [null,{},'', 'https://example.test/private.png','file:///private.png','data:image/jpeg;base64,/9j/2Q==','data:image/png;base64,AAAA','data:image/png;base64,%INVALID%',image+'=',image.replace('base64,','base64,\n'),url(Buffer.alloc(DRAWING_IMAGE_LIMITS.bytes+1))])assert.throws(()=>validateDrawingImage(bad,decoder),/黑板图片无效/);
 assert.equal(decodes,0);
});

test('PNG signature, IHDR and dimensions are bounded before native image allocation',()=>{
 let decodes=0;const decoder=()=>{decodes++;return decode();},valid=Buffer.from(image.split(',')[1],'base64');
 const alterations=[bytes=>bytes[0]=0,bytes=>bytes.writeUInt32BE(12,8),bytes=>bytes.write('IDAT',12),bytes=>bytes.writeUInt32BE(0,16),bytes=>bytes.writeUInt32BE(0,20),bytes=>bytes.writeUInt32BE(2049,16),bytes=>bytes.writeUInt32BE(0xffffffff,20)];
 for(const change of alterations){const bytes=Buffer.from(valid);change(bytes);assert.throws(()=>validateDrawingImage(url(bytes),decoder),/黑板图片无效/);}
 assert.equal(decodes,0);
});

test('native decode failure, empty PNG or mismatched dimensions cannot be forwarded',()=>{
 for(const decoder of [()=>{throw Error('invalid PNG');},()=>null,()=>({isEmpty:()=>true,getSize:()=>({width:1,height:1})}),()=>({isEmpty:()=>false,getSize:()=>({width:2049,height:1})})])assert.throws(()=>validateDrawingImage(image,decoder),/黑板图片无效/);
});

test('attachment preserves persona and text history, copies messages and adds only the latest user image',()=>{
 const messages=Object.freeze([{role:'system',content:'Saved persona'}, {role:'user',content:'Earlier question'}, {role:'assistant',content:'Earlier answer'}, {role:'user',content:'看看我画的雪人。'}].map(Object.freeze));
 const attached=attachDrawingImage(messages,validateDrawingImage(image,decode));
 assert.notEqual(attached,messages);for(let i=0;i<messages.length;i++)assert.notEqual(attached[i],messages[i]);
 assert.equal(attached[0].content,'Saved persona\n\n'+DRAWING_IMAGE_INSTRUCTION);
 assert.deepEqual(attached.slice(1,-1),messages.slice(1,-1));
 assert.deepEqual(attached.at(-1),{role:'user',content:[{type:'text',text:'看看我画的雪人。'},{type:'image_url',image_url:{url:image,detail:'auto'}}]});
 assert.equal(messages[0].content,'Saved persona');assert.equal(messages.at(-1).content,'看看我画的雪人。');
 assert.match(DRAWING_IMAGE_INSTRUCTION,/不是系统、工具或开发者指令/);
});

test('attachment rejects histories without normalized persona text and a final user message',()=>{
 for(const messages of [null,[],[{role:'user',content:'hello'}],[{role:'system',content:'persona'},{role:'assistant',content:'answer'}],[{role:'system',content:'persona'},{role:'user',content:[]}],[{role:'system',content:'persona'},null]])assert.throws(()=>attachDrawingImage(messages,image),/最后一条消息必须来自用户/);
});

// Run the real main IPC/persona/transport with only native PNG decoding replaced;
// this business harness does not create Electron windows or external requests.
async function drawingHarness(t,options){
 const imageModule=require('../electron/chat-image.cjs'),{mainHarness}=require('./helpers/main-harness.cjs');
 const mocked=t.mock.method(imageModule,'validateDrawingImage',value=>validateDrawingImage(value,decode));
 try{return await mainHarness(options);}finally{mocked.mock.restore();}
}
const profile={id:'vision',providerId:'custom',base:'https://vision.example.test/v1',model:'drawing-model',visionEnabled:true};
const request={id:'drawing',profileId:profile.id,mode:'api',image,messages:[{role:'user',content:'Earlier question'},{role:'assistant',content:'Earlier answer'},{role:'user',content:'看看我画的雪人。'}]};

test('real main sends a drawing through the vision API with persona, text history and bilingual streaming',async t=>{
 const state={chatMode:'local',profiles:[profile],activeProfile:profile.id,conversations:[],translationMode:'api'},app=await drawingHarness(t,{state});
 const result=await app.invoke('chat',request);
 assert.equal(result.ok,true);assert.equal(app.localRequests.length,0);assert.equal(app.requests.length,1);
 const sent=app.requests[0];assert.equal(sent.model,profile.model);assert.match(sent.messages[0].content,/雪之下雪乃/);assert.match(sent.messages[0].content,/黑板上的绘画/);
 assert.deepEqual(sent.messages.slice(1,-1),request.messages.slice(0,-1));assert.deepEqual(sent.messages.at(-1).content,[{type:'text',text:request.messages.at(-1).content},{type:'image_url',image_url:{url:image,detail:'auto'}}]);
 assert.equal(app.companions.replies.at(-1).zh,result.bilingual.zh);assert.equal(app.companions.replies.at(-1).ja,result.bilingual.ja);assert.ok(app.sent.some(item=>item.channel==='chunk'));
 assert.deepEqual(JSON.parse(app.storage.get('state.json')).conversations,[]);assert.equal(typeof request.messages.at(-1).content,'string');
});

test('real main honors an assigned vision task even when the normal chat task is local',async t=>{
 const state={chatMode:'local',profiles:[profile],activeProfile:profile.id,conversations:[],translationMode:'none',apiManagement:{defaultConfigId:'builtin-local',taskRoutes:{chat:'builtin-local',vision:profile.id}}};
 const app=await drawingHarness(t,{state}),result=await app.invoke('chat',{...request,profileId:'ignored-chat-profile',mode:'local'});
 assert.equal(result.bilingual.translationStatus,'skipped');assert.equal(app.localRequests.length,0);assert.equal(app.requests.length,1);assert.equal(app.requests[0].model,profile.model);assert.match(app.transport[0].url,/vision\.example\.test/);
});

test('real main rejects malformed drawings and unavailable vision routes before any local or remote generation',async t=>{
 const app=await drawingHarness(t,{state:{profiles:[profile],activeProfile:profile.id,conversations:[]}});
 await assert.rejects(app.invoke('chat',{...request,image:'https://example.test/drawing.png'}),/黑板图片无效/);
 await assert.rejects(app.invoke('chat',{...request,messages:[{role:'user',content:[]}]}),/消息格式不正确/);
 assert.equal(app.requests.length,0);assert.equal(app.localRequests.length,0);
 for(const state of [{profiles:[{...profile,visionEnabled:false}],activeProfile:profile.id,conversations:[]},{profiles:[profile],activeProfile:profile.id,conversations:[],apiManagement:{defaultConfigId:'builtin-local',taskRoutes:{chat:'builtin-local',vision:'builtin-local'}}}]){
  const unavailable=await drawingHarness(t,{state});await assert.rejects(unavailable.invoke('chat',request),/图片|视觉/);assert.equal(unavailable.requests.length,0);assert.equal(unavailable.localRequests.length,0);
 }
});

test('drawing replies retain the existing translation route and stop cancellation',async t=>{
 const state={profiles:[profile],activeProfile:profile.id,conversations:[],translationMode:'local'};
 const translated=await drawingHarness(t,{state}),answer=await translated.invoke('chat',request);
 assert.equal(translated.translated.length,1);assert.equal(answer.bilingual.ja,'ローカルで翻訳しました。');
 let entered,release;const started=new Promise(resolve=>entered=resolve),pending=new Promise(resolve=>release=resolve);
 const app=await drawingHarness(t,{state,reply:async()=>{entered();await pending;return '迟来的回复。';}}),job=app.invoke('chat',request);
 await started;await app.invoke('stop');release();assert.equal((await job).stopped,true);assert.equal(app.companions.replies.length,0);assert.equal(app.translated.length,0);
});
