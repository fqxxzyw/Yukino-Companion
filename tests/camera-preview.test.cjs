const test=require('node:test');
const assert=require('node:assert/strict');
const modulePromise=import('../src/ui/camera-preview.mjs');
const image='data:image/jpeg;base64,'+Buffer.from('synthetic camera image, not a real device').toString('base64');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
class Events{
 constructor(){this.listeners=new Map()}
 addEventListener(name,fn){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(fn)}
 removeEventListener(name,fn){this.listeners.get(name)?.delete(fn)}
 emit(name){for(const fn of [...this.listeners.get(name)||[]])fn()}
 count(){return [...this.listeners.values()].reduce((sum,set)=>sum+set.size,0)}
}
function makeStream({kind='video',label='Synthetic camera'}={}){
 const track=Object.assign(new Events(),{kind,label,readyState:'live',stops:0,stop(){this.stops++;this.readyState='ended'}});
 return {track,getTracks:()=>[track]};
}
async function fixture(options={}){
 const {CameraPreview,CAMERA_LIMITS}=await modulePromise;
 let now=100000,id=0,sequence=0;const timers=new Map(),snapshots=[],canvases=[],constraints=[],calls={start:[],send:[],stop:[]},streams=[];
 const media=Object.assign(new Events(),{async getUserMedia(request){constraints.push(request);if(options.getUserMedia)return options.getUserMedia(request);const stream=makeStream();streams.push(stream);return stream}});
 const visibility=Object.assign(new Events(),{hidden:false}),lifecycle=new Events();
 const video={videoWidth:1920,videoHeight:1080,readyState:2,srcObject:null,plays:0,pauses:0,async play(){this.plays++;return options.play?.()},pause(){this.pauses++}};
 const api={async startPreview(request){calls.start.push(request);if(options.start)return options.start(request);return {token:'token-'+(++sequence),expires:now+600000,destination:'https://example.test/v1?secret=never-display',model:'vision-test'}},async analyzeFrame(request){calls.send.push({...request});return options.send?options.send(request):{text:'Synthetic result'}},async stopPreview(request){calls.stop.push(request);return options.stop?.(request)}};
 const controller=new CameraPreview({mediaDevices:media,video,api,visibilityTarget:visibility,lifecycleTarget:lifecycle,now:()=>now,setTimer:(callback,delay)=>{const timer=++id;timers.set(timer,{callback,at:now+delay});return timer},clearTimer:timer=>timers.delete(timer),createCanvas:()=>{
  const canvas={width:0,height:0,clears:0,drawn:[],context:{drawImage(...args){canvas.drawn.push(args);if(options.draw)options.draw()},clearRect(){canvas.clears++}},getContext(){return options.noContext?null:this.context},toDataURL(type,quality){canvas.mime=type;canvas.quality=quality;canvas.rendered={width:canvas.width,height:canvas.height};return options.image??image}};canvases.push(canvas);return canvas;
 },onState:value=>{snapshots.push(value);options.onState?.(value,controller)}});
 async function settle(){for(let i=0;i<8;i++)await Promise.resolve()}
 async function advance(ms){now+=ms;for(const [key,timer] of [...timers])if(timer.at<=now){timers.delete(key);timer.callback()}await settle()}
 return {controller,limits:CAMERA_LIMITS,api,media,visibility,lifecycle,video,streams,calls,snapshots,canvases,constraints,timers,advance,settle,setNow:value=>{now=value},get now(){return now}};
}
const start=f=>f.controller.start({consent:true});

test('constructing the controller performs no permission, capture, device enumeration or upload',async()=>{
 const f=await fixture();assert.equal(f.controller.getSnapshot().phase,'idle');assert.deepEqual(f.calls,{start:[],send:[],stop:[]});assert.equal(f.constraints.length,0);assert.equal(f.canvases.length,0);assert.equal(f.video.srcObject,null);assert.equal(f.timers.size,0);f.controller.dispose();
});
test('preview requires explicit consent and uses video only with exact requested device',async()=>{
 const f=await fixture();await assert.rejects(f.controller.start({consent:false}),/允许/);assert.equal(f.calls.start.length,0);
 await f.controller.start({consent:true,deviceId:'test-device'});
 assert.deepEqual(f.calls.start,[{consent:true}]);assert.deepEqual(f.constraints,[{audio:false,video:{width:{ideal:1280},height:{ideal:720},deviceId:{exact:'test-device'}}}]);
 assert.equal(f.video.muted,true);assert.equal(f.video.playsInline,true);assert.equal(f.video.srcObject,f.streams[0]);assert.equal(f.calls.send.length,0);assert.equal(f.controller.getSnapshot().localPreview,true);assert.equal(f.controller.getSnapshot().destination,'https://example.test');f.controller.dispose();
});
test('double Start is rejected before it can request a second grant or device',async()=>{
 const gate=deferred(),f=await fixture({start:()=>gate.promise});const pending=start(f);await assert.rejects(start(f),/正在启动/);assert.equal(f.calls.start.length,1);gate.resolve({token:'first',expires:f.now+600000});await pending;f.controller.dispose();
});
test('Stop before backend grant arrives revokes late token without requesting camera',async()=>{
 const gate=deferred(),f=await fixture({start:()=>gate.promise});const pending=start(f);f.controller.stop();gate.resolve({token:'late-grant',expires:f.now+600000});await assert.rejects(pending,{name:'AbortError'});assert.deepEqual(f.calls.stop,[{token:'late-grant'}]);assert.equal(f.constraints.length,0);assert.equal(f.timers.size,0);f.controller.dispose();
});
test('Stop before getUserMedia resolves stops every late track and retains no stream',async()=>{
 const gate=deferred(),f=await fixture({getUserMedia:()=>gate.promise});const pending=start(f);await f.settle();f.controller.stop();const late=makeStream();gate.resolve(late);await assert.rejects(pending,{name:'AbortError'});assert.equal(late.track.stops,1);assert.equal(f.video.srcObject,null);assert.equal(f.calls.send.length,0);assert.equal(f.timers.size,0);f.controller.dispose();
});
test('a late old grant and revoke do not cancel a newly started preview',async()=>{
 const gate=deferred(),f=await fixture();let starts=0;f.api.startPreview=()=>++starts===1?gate.promise:Promise.resolve({token:'new',expires:f.now+600000});
 const old=start(f);f.controller.stop();await start(f);gate.resolve({token:'old',expires:f.now+600000});await assert.rejects(old,{name:'AbortError'});
 assert.equal(f.controller.getSnapshot().phase,'preview');assert.equal(f.video.srcObject,f.streams[0]);assert.deepEqual(f.calls.stop,[{token:'old'}]);f.controller.dispose();
});
test('a late video play completion cannot clear a newer session',async()=>{
 const gate=deferred(),f=await fixture();let plays=0;f.video.play=()=>++plays===1?gate.promise:Promise.resolve();const old=start(f);await f.settle();f.controller.stop();await start(f);gate.resolve();await assert.rejects(old,{name:'AbortError'});assert.equal(f.video.srcObject,f.streams[1]);assert.equal(f.streams[1].track.stops,0);f.controller.dispose();
});
test('invalid or expired backend grants fail closed before requesting camera',async()=>{
 for(const grant of [{token:'bad',expires:0},{token:'',expires:9999999},{token:'bad',expires:Infinity}]){
  const f=await fixture({start:async()=>grant});await assert.rejects(start(f));assert.equal(f.constraints.length,0);assert.equal(f.controller.getSnapshot().active,false);assert.equal(f.timers.size,0);f.controller.dispose();
 }
});
test('unexpected audio tracks are immediately stopped instead of attached',async()=>{
 const stream=makeStream({kind:'audio'}),f=await fixture({getUserMedia:async()=>stream});await assert.rejects(start(f));assert.equal(stream.track.stops,1);assert.equal(f.video.srcObject,null);assert.equal(f.controller.getSnapshot().active,false);f.controller.dispose();
});
test('device failure messages are bounded and do not echo backend data URLs',async()=>{
 const f=await fixture({getUserMedia:async()=>{throw Error(image)}});await assert.rejects(start(f),error=>!error.message.includes('data:'));assert.ok(f.snapshots.every(s=>!JSON.stringify(s).includes(image)));assert.equal(f.calls.stop.length,1);f.controller.dispose();
});
test('send requires a live preview and separate consent before any frame extraction',async()=>{
 const f=await fixture();assert.throws(()=>f.controller.sendOnce({consent:true}),/预览/);await start(f);assert.throws(()=>f.controller.sendOnce({consent:false}),/确认/);assert.throws(()=>f.controller.sendOnce({consent:true,prompt:'a'.repeat(4001)}),/4000/);assert.equal(f.canvases.length,0);assert.equal(f.calls.send.length,0);f.controller.dispose();
});
test('one-shot sends a bounded actual video frame, sanitizes metadata and erases canvas/request bytes',async()=>{
 let original;const f=await fixture({send:async request=>{original=request;return {text:'  Synthetic result  ',image:'must-not-forward'}}});await start(f);const result=await f.controller.sendOnce({consent:true,prompt:'what changed?'});
 assert.deepEqual(result,{text:'Synthetic result'});assert.deepEqual(f.calls.send[0],{token:'token-1',image,prompt:'what changed?',consent:true});assert.equal(original.image,'');assert.deepEqual(f.canvases[0].rendered,{width:1280,height:720});assert.equal(f.canvases[0].drawn[0][0],f.video);assert.equal(f.canvases[0].mime,'image/jpeg');assert.equal(f.canvases[0].width,0);assert.equal(f.canvases[0].height,0);assert.equal(f.canvases[0].clears,1);assert.equal(f.controller.getSnapshot().count,1);assert.ok(f.snapshots.every(s=>!JSON.stringify(s).includes(image)));f.controller.dispose();
});
test('portrait and small frames maintain aspect ratio and are not upscaled',async()=>{
 for(const [width,height,expected] of [[1080,1920,{width:405,height:720}],[320,200,{width:320,height:200}]]){
  const f=await fixture();await start(f);f.video.videoWidth=width;f.video.videoHeight=height;await f.controller.sendOnce({consent:true});assert.deepEqual(f.canvases[0].rendered,expected);f.controller.dispose();
 }
});
test('unready, malformed and oversized frames never reach backend and clear buffers',async()=>{
 for(const value of ['data:image/png;base64,AAAA','data:image/jpeg;base64,%INVALID%', 'data:image/jpeg;base64,'+Buffer.alloc(2*1024*1024+1).toString('base64')]){
  const f=await fixture({image:value});await start(f);await assert.rejects(f.controller.sendOnce({consent:true}));assert.equal(f.calls.send.length,0);assert.equal(f.video.srcObject,null);assert.equal(f.canvases[0].width,0);assert.equal(f.timers.size,0);f.controller.dispose();
 }
 const f=await fixture();await start(f);f.video.readyState=1;await assert.rejects(f.controller.sendOnce({consent:true}));assert.equal(f.calls.send.length,0);f.controller.dispose();
});
test('concurrent send/watch is rejected and completion rate is at least five seconds',async()=>{
 const gate=deferred(),f=await fixture({send:()=>gate.promise});await start(f);const first=f.controller.sendOnce({consent:true});assert.throws(()=>f.controller.sendOnce({consent:true}),/正在识别/);assert.throws(()=>f.controller.startWatch({consent:true,watchConsent:true}),/正在识别/);gate.resolve({text:'done'});await first;
 await assert.rejects(f.controller.sendOnce({consent:true}),/稍候/);assert.equal(f.controller.getSnapshot().active,true);assert.equal(f.calls.send.length,1);await f.advance(5000);await f.controller.sendOnce({consent:true});assert.equal(f.calls.send.length,2);f.controller.dispose();
});
test('Stop during network clears local bytes immediately and suppresses late result',async()=>{
 const gate=deferred();let request;const f=await fixture({send:r=>{request=r;return gate.promise}});await start(f);const pending=f.controller.sendOnce({consent:true});f.controller.stop();assert.equal(request.image,'');assert.equal(f.video.srcObject,null);assert.equal(f.streams[0].track.stops,1);gate.resolve({text:'old result'});await assert.rejects(pending,{name:'AbortError'});assert.equal(f.controller.getSnapshot().result,'');assert.equal(f.timers.size,0);f.controller.dispose();
});
test('late rejected send cannot overwrite a new preview or revoke its token',async()=>{
 const gate=deferred(),f=await fixture({send:()=>gate.promise});await start(f);const pending=f.controller.sendOnce({consent:true});f.controller.stop();await start(f);gate.reject(Error('old failure'));await assert.rejects(pending,{name:'AbortError'});assert.equal(f.controller.getSnapshot().phase,'preview');assert.equal(f.video.srcObject,f.streams[1]);assert.deepEqual(f.calls.stop,[{token:'token-1'}]);f.controller.dispose();
});
test('watch requires two consents and one of the bounded interval choices',async()=>{
 const f=await fixture();await start(f);assert.throws(()=>f.controller.startWatch({consent:true}),/单独/);assert.throws(()=>f.controller.startWatch({consent:true,watchConsent:true,intervalSeconds:.01}),/请选择/);assert.equal(f.calls.send.length,0);assert.equal(f.controller.getSnapshot().watching,false);f.controller.dispose();
});
test('watch sends serially, schedules only after completion and never catches up a backlog',async()=>{
 const gate=deferred(),f=await fixture({send:()=>gate.promise});await start(f);f.controller.startWatch({consent:true,watchConsent:true,intervalSeconds:15});await f.advance(0);assert.equal(f.calls.send.length,1);await f.advance(120000);assert.equal(f.calls.send.length,1);gate.resolve({text:'done'});await f.settle();await f.advance(14999);assert.equal(f.calls.send.length,1);await f.advance(1);assert.equal(f.calls.send.length,2);await f.settle();f.controller.stop();await f.advance(60000);assert.equal(f.calls.send.length,2);f.controller.dispose();
});
test('watch stops the camera and erases timers after sixty frames',async()=>{
 const f=await fixture();await start(f);f.controller.startWatch({consent:true,watchConsent:true,intervalSeconds:5});await f.advance(0);for(let i=1;i<60;i++)await f.advance(5000);assert.equal(f.calls.send.length,60);assert.equal(f.controller.getSnapshot().stopReason,'frame-limit');assert.equal(f.video.srcObject,null);assert.equal(f.timers.size,0);await f.advance(5000);assert.equal(f.calls.send.length,60);f.controller.dispose();
});
test('backend TTL and absolute ten minute budget stop preview without sending',async()=>{
 for(const expiresAfter of [2000,3600000]){
  const f=await fixture({start:async()=>({token:'ttl',expires:f.now+expiresAfter})});await start(f);await f.advance(Math.min(expiresAfter,600000));assert.equal(f.controller.getSnapshot().stopReason,'expired');assert.equal(f.streams[0].track.stops,1);assert.equal(f.video.srcObject,null);assert.equal(f.timers.size,0);assert.equal(f.calls.send.length,0);f.controller.dispose();
 }
});
test('expired and rolled-back clocks are checked before frame extraction even if timer has not run',async()=>{
 for(const now of [1,9999999]){const f=await fixture();await start(f);f.setNow(now);assert.throws(()=>f.controller.sendOnce({consent:true}),{name:'AbortError'});assert.equal(f.canvases.length,0);assert.equal(f.video.srcObject,null);f.controller.dispose();}
});
test('hidden owner, pagehide, device replacement and unplug immediately stop every track',async()=>{
 for(const action of [f=>{f.visibility.hidden=true;f.visibility.emit('visibilitychange')},f=>f.lifecycle.emit('pagehide'),f=>f.media.emit('devicechange'),f=>f.streams[0].track.emit('ended')]){
  const f=await fixture();await start(f);action(f);assert.equal(f.video.srcObject,null);assert.equal(f.streams[0].track.stops,1);assert.equal(f.timers.size,0);assert.equal(f.calls.stop.length,1);f.controller.dispose();
 }
});
test('hidden and disposed controllers cannot start and disposal removes lifecycle listeners',async()=>{
 const f=await fixture();f.controller.setHidden(true);await assert.rejects(start(f),/不可/);f.controller.setHidden(false);await start(f);f.controller.dispose();assert.equal(f.media.count(),0);assert.equal(f.visibility.count(),0);assert.equal(f.lifecycle.count(),0);assert.equal(f.streams[0].track.listeners.get('ended').size,0);await assert.rejects(start(f),/不可/);f.controller.dispose();assert.equal(f.calls.stop.length,1);
});
test('backend rejection does not retain frame/image text or silently continue capture',async()=>{
 const f=await fixture({send:async()=>{throw Error(image)}});await start(f);await assert.rejects(f.controller.sendOnce({consent:true}),error=>!error.message.includes(image));assert.equal(f.controller.getSnapshot().phase,'error');assert.equal(f.video.srcObject,null);assert.equal(f.timers.size,0);assert.ok(f.snapshots.every(value=>!JSON.stringify(value).includes(image)));f.controller.dispose();
});
test('a UI stop invoked at starting/sending state cannot dispatch a stale request',async()=>{
 for(const phase of ['starting','sending']){
  const f=await fixture({onState:(state,controller)=>{if(state.phase===phase)controller.stop()}});
  if(phase==='starting'){await assert.rejects(start(f),{name:'AbortError'});assert.equal(f.calls.start.length,0)}
  else {await start(f);await assert.rejects(f.controller.sendOnce({consent:true}),{name:'AbortError'});assert.equal(f.calls.send.length,0)}
  assert.equal(f.timers.size,0);f.controller.dispose();
 }
});
