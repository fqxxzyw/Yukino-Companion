const test=require('node:test');
const assert=require('node:assert/strict');
const {VisionSession}=require('../electron/vision.cjs');
const image='data:image/png;base64,c3ludGhldGljLXRlc3Qtb25seQ==';
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
function fakeClock(){
 let now=1000;const timers=new Map();
 return {now:()=>now,timers,setTimer:(callback,delay)=>{const handle={unref(){}};timers.set(handle,{callback,at:now+delay});return handle;},clearTimer:handle=>timers.delete(handle),advance(ms){now+=ms;for(const [handle,timer] of [...timers])if(timer.at<=now){timers.delete(handle);timer.callback();}}};
}
function source(name='Synthetic window',url=image){return {id:'window:synthetic',name,thumbnail:{isEmpty:()=>false,toDataURL:()=>url}};}
function fixture(options={}){
 const calls={capture:[],transport:[],profiles:[]},events=[],clock=fakeClock();
 const settings={profile:{id:'visual',base:'https://vision.example.test/v1',model:'vision-fixture',visionEnabled:true},key:'SYNTHETIC_TEST_KEY',state:{conversations:[{text:'PRIVATE_HISTORY_MUST_NOT_SEND'}],memory:'PRIVATE_MEMORY_MUST_NOT_SEND'}};
 const session=new VisionSession({capturer:{getSources:async request=>{calls.capture.push(request);return options.capture?options.capture(request):[source()];}},resolveProfile:async id=>{calls.profiles.push(id);return options.resolve?options.resolve(id,settings):settings;},transport:async request=>{calls.transport.push(request);if(options.transport)return options.transport(request);request.onToken('テストの画像です。');},notify:event=>events.push(event),...clock});
 return {session,settings,calls,events,clock};
}
async function preview(f){return f.session.sources({consent:true,profileId:'visual'});}

test('vision defaults perform no capture or transport and require separate explicit consents',async()=>{
 const f=fixture();assert.equal(f.calls.capture.length,0);assert.equal(f.calls.transport.length,0);
 for(const consent of [undefined,false,'true',1])await assert.rejects(f.session.sources({consent,profileId:'visual'}),/同意/);
 assert.equal(f.calls.profiles.length,0);assert.equal(f.calls.capture.length,0);
 const result=await preview(f);assert.equal(f.calls.transport.length,0);
 for(const consent of [undefined,false,'true',1])await assert.rejects(f.session.analyze({token:result.sources[0].token,consent,profileId:'visual'}),/确认/);
 assert.equal(f.calls.transport.length,0);f.session.cancel();
});
test('vision capture is gated by saved model capability and returns only bounded in-memory previews',async()=>{
 const f=fixture();f.settings.profile.visionEnabled=false;await assert.rejects(preview(f),/支持图片/);assert.equal(f.calls.capture.length,0);
 f.settings.profile.visionEnabled=true;const result=await preview(f);assert.equal(result.destination,'https://vision.example.test');assert.equal(result.model,'vision-fixture');assert.equal(result.sources[0].preview,image);assert.ok(result.sources[0].token);
 assert.deepEqual(f.calls.capture[0],{types:['window','screen'],thumbnailSize:{width:1280,height:720},fetchWindowIcons:false});
 assert.ok(f.events.some(event=>event.phase==='capturing'&&event.active));assert.equal(f.events.at(-1).phase,'preview');f.session.cancel();
});
test('vision sends only the selected synthetic image and supplied prompt, then invalidates every preview token',async()=>{
 const f=fixture({capture:()=>[source('one'),source('two','data:image/png;base64,c2Vjb25k')]});const result=await preview(f),token=result.sources[1].token;
 const analyzed=await f.session.analyze({token,consent:true,profileId:'visual',prompt:'请说明这个窗口。'});
 assert.equal(analyzed.text,'テストの画像です。');assert.equal(f.calls.transport.length,1);
 const request=f.calls.transport[0];assert.equal(request.profile.id,'visual');assert.equal(request.key,'SYNTHETIC_TEST_KEY');assert.equal(request.messages.length,2);
 assert.deepEqual(request.messages[1],{role:'user',content:[{type:'text',text:'请说明这个窗口。'},{type:'image_url',image_url:{url:'data:image/png;base64,c2Vjb25k',detail:'auto'}}]});
 assert.match(request.messages[0].content,/untrusted content/);assert.doesNotMatch(JSON.stringify(request.messages),/PRIVATE_HISTORY|PRIVATE_MEMORY/);assert.equal(f.session.captures.size,0);
 for(const item of result.sources)await assert.rejects(f.session.analyze({token:item.token,consent:true,profileId:'visual'}),/过期/);
 assert.equal(f.calls.transport.length,1);assert.equal(f.events.at(-1).active,false);assert.equal(f.clock.timers.size,0);
});
test('vision cannot send a preview to a different saved endpoint, model, or profile',async()=>{
 for(const patch of [{base:'https://different.example.test/v1'},{model:'other-model'},{id:'other-profile'},{visionEnabled:false}]){
  const f=fixture(),result=await preview(f);Object.assign(f.settings.profile,patch);
  await assert.rejects(f.session.analyze({token:result.sources[0].token,consent:true,profileId:'visual'}),/配置已改变/);assert.equal(f.calls.transport.length,0);f.session.cancel();
 }
});
test('invalid tokens, oversized questions, and expired previews never invoke transport',async()=>{
 const f=fixture(),result=await preview(f),token=result.sources[0].token;
 await assert.rejects(f.session.analyze({token,consent:true,profileId:'visual',prompt:'x'.repeat(4001)}),/4000/);
 f.clock.advance(120001);assert.equal(f.session.captures.size,0);
 await assert.rejects(f.session.analyze({token,consent:true,profileId:'visual'}),/过期/);assert.equal(f.calls.transport.length,0);
 await assert.rejects(f.session.analyze({token:'not-a-token',consent:true,profileId:'visual'}),/过期/);
});
test('cancel aborts owned vision transport, rejects late output and permits a fresh preview',async()=>{
 const entered=deferred(),output=deferred();let request;
 const f=fixture({transport:async value=>{request=value;entered.resolve();await output.promise;value.onToken('遅れた画像の説明です。');}}),result=await preview(f);
 const active=f.session.analyze({token:result.sources[0].token,consent:true,profileId:'visual'});await entered.promise;
 await assert.rejects(f.session.analyze({token:result.sources[0].token,consent:true,profileId:'visual'}),/正在识别/);
 f.session.cancel();assert.equal(request.signal.aborted,true);output.resolve();await assert.rejects(active,error=>error.name==='AbortError'||/取消/.test(error.message));
 assert.equal(f.session.captures.size,0);assert.equal(f.events.at(-1).active,false);const next=await preview(f);assert.equal(next.sources.length,1);f.session.cancel();
});
test('cancel during pending profile resolution prevents any desktop access',async()=>{
 const gate=deferred(),entered=deferred();const f=fixture({resolve:async(_id,settings)=>{entered.resolve();await gate.promise;return settings;}});
 const pending=preview(f);await entered.promise;f.session.cancel();gate.resolve();await assert.rejects(pending,/取消/);assert.equal(f.calls.capture.length,0);assert.equal(f.calls.transport.length,0);assert.equal(f.session.captures.size,0);
});
test('late desktop capture after cancel is discarded without retaining or returning previews',async()=>{
 const gate=deferred(),entered=deferred();const f=fixture({capture:async()=>{entered.resolve();await gate.promise;return [source()];}});
 const pending=preview(f);await entered.promise;f.session.cancel();gate.resolve();await assert.rejects(pending,/取消/);assert.equal(f.session.captures.size,0);assert.equal(f.calls.transport.length,0);assert.equal(f.events.at(-1).active,false);
});
test('cancel while send-time profile resolution is pending prevents image transport',async()=>{
 const gate=deferred(),entered=deferred();let resolveCount=0;
 const f=fixture({resolve:async(_id,settings)=>{if(++resolveCount===2){entered.resolve();await gate.promise;}return settings;}}),result=await preview(f);
 const pending=f.session.analyze({token:result.sources[0].token,consent:true,profileId:'visual'});await entered.promise;f.session.cancel();gate.resolve();await assert.rejects(pending,/取消|过期/);assert.equal(f.calls.transport.length,0);assert.equal(f.session.captures.size,0);
});
test('capture filters empty, invalid and oversized thumbnail payloads',async()=>{
 const f=fixture({capture:()=>[{name:'empty',thumbnail:{isEmpty:()=>true,toDataURL:()=>{throw Error('must not read empty image');}}},source('invalid','https://example.test/image.png'),source('huge','data:image/png;base64,'+'A'.repeat(6000001)),source('valid')]});
 const result=await preview(f);assert.equal(result.sources.length,1);assert.equal(result.sources[0].name,'valid');assert.equal(f.session.captures.size,1);f.session.cancel();
});
test('empty vision output and overly long replies fail without leaving retained images',async()=>{
 for(const output of ['', 'あ'.repeat(48001)]){
  const f=fixture({transport:async request=>request.onToken(output)}),result=await preview(f);
  await assert.rejects(f.session.analyze({token:result.sources[0].token,consent:true,profileId:'visual'}),/没有返回|过长/);assert.equal(f.session.captures.size,0);assert.equal(f.session.controller,null);assert.equal(f.clock.timers.size,0);
 }
});

test('preview count and aggregate memory are bounded and cancel erases retained image references',async()=>{
 const large='data:image/png;base64,'+'A'.repeat(5000000),f=fixture({capture:()=>Array.from({length:80},(_,index)=>source(`window ${index}`,large))});
 const result=await preview(f);assert.ok(result.sources.length>0&&result.sources.length<=24);assert.ok(result.sources.reduce((total,row)=>total+row.preview.length,0)<=20000000);
 const retained=[...f.session.captures.values()];f.session.cancel();assert.ok(retained.every(capture=>capture.image===''));assert.equal(f.clock.timers.size,0);
 const small=fixture({capture:()=>Array.from({length:80},(_,index)=>source(`window ${index}`))}),smallResult=await preview(small);assert.equal(smallResult.sources.length,24);small.session.cancel();
});
test('capture thumbnail conversion failure cannot retain a partial set of sensitive previews',async()=>{
 const f=fixture({capture:()=>[source(),{name:'broken',thumbnail:{isEmpty:()=>false,toDataURL:()=>{throw Error('synthetic conversion error');}}}]});
 await assert.rejects(preview(f),/conversion/);assert.equal(f.session.captures.size,0);assert.equal(f.calls.transport.length,0);assert.equal(f.events.at(-1).active,false);assert.equal(f.clock.timers.size,0);
});
test('owned vision timeout aborts transport and releases all capture state',async()=>{
 const entered=deferred();const f=fixture({transport:async request=>{entered.resolve();return new Promise((resolve,reject)=>request.signal.addEventListener('abort',()=>reject(request.signal.reason),{once:true}));}}),result=await preview(f);
 const active=f.session.analyze({token:result.sources[0].token,consent:true,profileId:'visual'});await entered.promise;f.clock.advance(90000);await assert.rejects(active,error=>error.name==='AbortError');assert.equal(f.session.controller,null);assert.equal(f.session.activeCapture,null);assert.equal(f.session.captures.size,0);assert.equal(f.clock.timers.size,0);
});

test('rapid capture restart discards the old result without clearing the newer preview',async()=>{
 const oldGate=deferred(),entered=deferred();let count=0;
 const f=fixture({capture:async()=>{if(++count===1){entered.resolve();await oldGate.promise;return [source('old')];}return [source('new')];}});
 const old=preview(f);await entered.promise;const fresh=await preview(f);assert.equal(fresh.sources[0].name,'new');oldGate.resolve();await assert.rejects(old,/取消/);
 assert.equal(f.session.captures.size,1);assert.ok(f.session.captures.has(fresh.sources[0].token));assert.equal(f.events.at(-1).phase,'preview');f.session.cancel();
});
test('rapid send restart isolates late output and cleanup from the newer in-flight request',async()=>{
 const oldGate=deferred(),newGate=deferred(),oldEntered=deferred(),newEntered=deferred();let count=0,newRequest;
 const f=fixture({transport:async request=>{if(++count===1){oldEntered.resolve();await oldGate.promise;request.onToken('古い結果です。');}else{newRequest=request;newEntered.resolve();await newGate.promise;request.onToken('新しい結果です。');}}});
 const first=await preview(f),old=f.session.analyze({token:first.sources[0].token,consent:true,profileId:'visual'});await oldEntered.promise;f.session.cancel();
 const second=await preview(f),active=f.session.analyze({token:second.sources[0].token,consent:true,profileId:'visual'});await newEntered.promise;
 oldGate.resolve();await assert.rejects(old,error=>error.name==='AbortError');assert.equal(f.session.controller.signal,newRequest.signal);assert.equal(newRequest.signal.aborted,false);assert.equal(f.events.at(-1).phase,'sending');
 newGate.resolve();assert.equal((await active).text,'新しい結果です。');assert.equal(f.session.captures.size,0);assert.equal(f.session.activeCapture,null);assert.equal(f.clock.timers.size,0);
});

const flush=()=>new Promise(setImmediate);
async function startWatch(f,options={}){const result=await preview(f);return f.session.startWatch({token:result.sources[0].token,consent:true,watchConsent:true,profileId:'visual',intervalSeconds:15,...options});}
test('continuous vision is off by default and requires extra explicit watch consent and bounded intervals',async()=>{
 const f=fixture(),result=await preview(f),options={token:result.sources[0].token,consent:true,profileId:'visual',intervalSeconds:15};
 for(const watchConsent of [undefined,false,'true',1])await assert.rejects(f.session.startWatch({...options,watchConsent}),/单独确认/);
 for(const intervalSeconds of [0,1,14,16,90,'15'])await assert.rejects(f.session.startWatch({...options,watchConsent:true,intervalSeconds}),/15.*30.*60/);
 assert.equal(f.calls.transport.length,0);assert.equal(f.session.watch,null);f.session.cancel();
});
test('continuous vision reads only the fixed source kind and never converts or sends another window',async()=>{
 const selected={...source('Chosen window'),id:'window:chosen'};let rounds=0;
 const f=fixture({capture:()=>++rounds===1?[selected]:[{...source('Unselected window'),id:'window:other',thumbnail:{isEmpty:()=>false,toDataURL:()=>{throw Error('unselected thumbnail must not be converted');}}},selected]});
 const result=await startWatch(f);await flush();assert.equal(result.active,true);assert.equal(f.calls.transport.length,1);assert.equal(f.calls.capture.length,1);assert.equal(f.events.at(-1).phase,'watching');assert.equal(f.events.at(-1).active,true);
 f.clock.advance(14999);await flush();assert.equal(f.calls.capture.length,1);f.clock.advance(1);await flush();
 assert.equal(f.calls.capture.length,2);assert.deepEqual(f.calls.capture[1].types,['window']);assert.equal(f.calls.transport.length,2);assert.equal(f.session.captures.size,0);assert.equal(f.clock.timers.size,2);f.session.cancel();
});
test('continuous vision never overlaps requests or accumulates a timer backlog',async()=>{
 const first=deferred(),entered=deferred();let calls=0,active=0,maxActive=0;
 const f=fixture({transport:async request=>{active++;maxActive=Math.max(active,maxActive);try{if(++calls===1){entered.resolve();await first.promise;}request.onToken('現在の画面です。');}finally{active--;}}});
 await startWatch(f);await entered.promise;f.clock.advance(60000);await flush();assert.equal(f.calls.capture.length,1);assert.equal(f.calls.transport.length,1);
 first.resolve();await flush();assert.equal(f.clock.timers.size,2);f.clock.advance(14999);await flush();assert.equal(f.calls.transport.length,1);f.clock.advance(1);await flush();assert.equal(f.calls.transport.length,2);assert.equal(maxActive,1);assert.equal(f.clock.timers.size,2);f.session.cancel();
});
test('continuous vision stops instead of falling back when the selected source disappears or changes title',async()=>{
 for(const replacement of [[],[{...source('Other window'),id:'window:other'}],[{...source('Changed title'),id:'window:synthetic'}]]){
  let rounds=0;const f=fixture({capture:()=>++rounds===1?[source()]:replacement});await startWatch(f);await flush();f.clock.advance(15000);await flush();
  assert.equal(f.calls.transport.length,1);assert.equal(f.session.watch,null);assert.equal(f.clock.timers.size,0);assert.equal(f.events.at(-1).phase,'error');assert.equal(f.events.at(-1).active,false);
 }
});
test('continuous vision revalidates saved endpoint, model and profile before reading new pixels',async()=>{
 for(const patch of [{base:'https://changed.example.test/v1'},{model:'changed'},{id:'changed-profile'},{visionEnabled:false}]){
  const f=fixture();await startWatch(f);await flush();Object.assign(f.settings.profile,patch);f.clock.advance(15000);await flush();
  assert.equal(f.calls.capture.length,1);assert.equal(f.calls.transport.length,1);assert.equal(f.session.watch,null);assert.equal(f.events.at(-1).active,false);assert.equal(f.clock.timers.size,0);
 }
});
test('stopping continuous vision while waiting removes timers and never captures again',async()=>{
 const f=fixture();await startWatch(f);await flush();f.session.cancel();f.clock.advance(3600000);await flush();assert.equal(f.calls.capture.length,1);assert.equal(f.calls.transport.length,1);assert.equal(f.clock.timers.size,0);assert.equal(f.session.watch,null);assert.equal(f.events.at(-1).active,false);
});
test('stopping continuous vision during capture discards late pixels without any upload',async()=>{
 let rounds=0;const entered=deferred(),captureGate=deferred();const f=fixture({capture:async()=>{if(++rounds>1){entered.resolve();await captureGate.promise;}return [source()];}});
 await startWatch(f);await flush();f.clock.advance(15000);await entered.promise;f.session.cancel();captureGate.resolve();await flush();assert.equal(f.calls.transport.length,1);assert.equal(f.session.captures.size,0);assert.equal(f.clock.timers.size,0);assert.equal(f.events.at(-1).active,false);
});
test('stopping continuous vision during transport suppresses results and prevents restart',async()=>{
 const entered=deferred(),gate=deferred();let request;const f=fixture({transport:async value=>{request=value;entered.resolve();await gate.promise;value.onToken('停止後の返事です。');}});
 await startWatch(f);await entered.promise;f.session.cancel();assert.equal(request.signal.aborted,true);gate.resolve();await flush();assert.ok(!f.events.some(event=>event.result));assert.equal(f.session.watch,null);assert.equal(f.clock.timers.size,0);assert.equal(f.session.activeCapture,null);
});
test('simultaneous continuous-start requests cannot replace or cancel each other after profile lookup',async()=>{
 const gate=deferred(),enteredA=deferred(),enteredB=deferred();let lookups=0;
 const f=fixture({resolve:async(_id,settings)=>{lookups++;if(lookups===2){enteredA.resolve();await gate.promise;}if(lookups===3){enteredB.resolve();await gate.promise;}return settings;},transport:async request=>new Promise((resolve,reject)=>request.signal.addEventListener('abort',()=>reject(request.signal.reason),{once:true}))});
 const result=await preview(f),options={token:result.sources[0].token,consent:true,watchConsent:true,profileId:'visual',intervalSeconds:15};
 const first=f.session.startWatch(options),second=f.session.startWatch(options);await Promise.all([enteredA.promise,enteredB.promise]);gate.resolve();const settled=await Promise.allSettled([first,second]);await flush();
 assert.equal(settled.filter(row=>row.status==='fulfilled').length,1);assert.equal(settled.filter(row=>row.status==='rejected').length,1);assert.equal(f.calls.transport.length,1);assert.ok(f.session.watch);assert.ok(f.session.controller);f.session.cancel();await flush();
});

test('cancel during continuous-start profile lookup prevents the initial upload',async()=>{
 const entered=deferred(),gate=deferred();let lookups=0;const f=fixture({resolve:async(_id,settings)=>{if(++lookups===2){entered.resolve();await gate.promise;}return settings;}}),result=await preview(f);
 const starting=f.session.startWatch({token:result.sources[0].token,consent:true,watchConsent:true,profileId:'visual',intervalSeconds:15});await entered.promise;f.session.cancel();gate.resolve();await assert.rejects(starting,/取消/);await flush();assert.equal(f.calls.transport.length,0);assert.equal(f.session.watch,null);assert.equal(f.clock.timers.size,0);
});
test('cancel during a later watch profile lookup prevents the next desktop capture',async()=>{
 const entered=deferred(),gate=deferred();let lookups=0;const f=fixture({resolve:async(_id,settings)=>{if(++lookups===4){entered.resolve();await gate.promise;}return settings;}});
 await startWatch(f);await flush();assert.equal(f.calls.transport.length,1);f.clock.advance(15000);await entered.promise;f.session.cancel();gate.resolve();await flush();assert.equal(f.calls.capture.length,1);assert.equal(f.calls.transport.length,1);assert.equal(f.session.watch,null);assert.equal(f.clock.timers.size,0);
});


test('opted-in companionship skips unchanged screenshots but sends a changed selected window',async()=>{
 let round=0;const changed='data:image/png;base64,Y2hhbmdlZA==';
 const f=fixture({capture:()=>[source('Chosen',++round<3?image:changed)]});
 await startWatch(f,{skipUnchanged:true});await flush();assert.equal(f.calls.transport.length,1);
 f.clock.advance(15000);await flush();assert.equal(f.calls.capture.length,2);assert.equal(f.calls.transport.length,1);assert.equal(f.session.captures.size,0);assert.equal(f.events.at(-1).unchanged,true);assert.equal(f.events.at(-1).skipped,1);
 f.clock.advance(15000);await flush();assert.equal(f.calls.transport.length,2);assert.equal(f.events.at(-1).count,2);f.session.cancel();assert.equal(f.clock.timers.size,0);
});
test('automatic observation expires and aborts an in-flight response without replaying it',async()=>{
 const entered=deferred(),gate=deferred();let request;
 const f=fixture({transport:async value=>{request=value;entered.resolve();await gate.promise;value.onToken('late response');}});
 await startWatch(f,{skipUnchanged:true});await entered.promise;f.clock.advance(600000);assert.equal(f.session.watch,null);assert.equal(request.signal.aborted,true);assert.equal(f.events.at(-1).phase,'completed');assert.equal(f.clock.timers.size,0);gate.resolve();await flush();assert.ok(!f.events.some(value=>value.result));
});
