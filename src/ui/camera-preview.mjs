// Periodic still-image analysis, not a realtime audiovisual call. Construction
// and opening the panel do not request a device or send a frame. The backend
// must independently enforce owner, token, profile, byte, rate and consent gates.
export const CAMERA_LIMITS = Object.freeze({width:1280,height:720,maxImageBytes:2*1024*1024,maxFrames:60,maxSessionMs:600000,minIntervalMs:5000,intervals:Object.freeze([5,15,30,60])});
const blank = () => ({phase:'idle',active:false,localPreview:false,sending:false,watching:false,result:'',error:'',sourceName:'',count:0,destination:'',model:'',expires:0,intervalSeconds:0,nextAllowedAt:0,stopReason:''});
const aborted = () => Object.assign(new Error('本次摄像头操作已取消。'),{name:'AbortError'});
const safeFailure = error => error?.name==='NotAllowedError'?'摄像头权限未获允许。':error?.name==='NotFoundError'?'未找到摄像头。':error?.name==='NotReadableError'?'摄像头被占用或无法读取。':'摄像头操作未完成，已停止预览与发送，请检查设置后重试。';
function stopTracks(stream){for(const track of stream?.getTracks?.()||[]){try{track.stop()}catch{}}}
function destinationOrigin(value){try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.origin:''}catch{return ''}}

export class CameraPreview {
 constructor({mediaDevices=globalThis.navigator?.mediaDevices,video,createCanvas=()=>document.createElement('canvas'),api,onState=()=>{},now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout,visibilityTarget=globalThis.document,lifecycleTarget=globalThis.window}={}) {
  this.mediaDevices=mediaDevices;this.video=video;this.createCanvas=createCanvas;this.api=api;this.onState=onState;this.now=now;this.setTimer=setTimer;this.clearTimer=clearTimer;this.visibilityTarget=visibilityTarget;this.lifecycleTarget=lifecycleTarget;this.hidden=visibilityTarget?.hidden===true;this.disposed=false;this.epoch=0;this.session=null;this.state=blank();this.cleanups=[];
  const listen=(target,event,fn)=>{target?.addEventListener?.(event,fn);this.cleanups.push(()=>target?.removeEventListener?.(event,fn))};
  listen(mediaDevices,'devicechange',()=>{if(this.session)this.stop('device-change')});
  listen(visibilityTarget,'visibilitychange',()=>this.setHidden(visibilityTarget.hidden===true));
  listen(lifecycleTarget,'pagehide',()=>this.stop('hidden'));
 }
 getSnapshot(){return {...this.state}}
 emit(patch){this.state={...this.state,...patch};try{this.onState(this.getSnapshot())}catch{/* UI listeners cannot interrupt device teardown. */}}
 current(session){return !this.disposed&&!this.hidden&&this.session===session&&session.epoch===this.epoch}
 check(session){if(!this.current(session))throw aborted();const time=this.now();if(time<session.startedAt||time>=session.expires){this.stop(time<session.startedAt?'clock-change':'expired');throw aborted()}return time}
 revoke(token){if(!token)return Promise.resolve();try{return Promise.resolve(this.api?.stopPreview?.({token})).catch(()=>{})}catch{return Promise.resolve()}}
 async start({consent,deviceId}={}) {
  if(consent!==true)throw Error('请先允许本次摄像头本机预览。');
  if(this.disposed||this.hidden)throw Error('当前窗口不可预览摄像头。');
  if(this.session)throw Error('摄像头已开启或正在启动，请先停止。');
  if(deviceId!==undefined&&(typeof deviceId!=='string'||deviceId.length>512))throw Error('摄像头选择无效。');
  if(!this.video||!this.mediaDevices?.getUserMedia||!this.api?.startPreview)throw Error('当前环境不支持摄像头预览。');
  const session={epoch:++this.epoch,token:'',startedAt:this.now(),expires:this.now()+CAMERA_LIMITS.maxSessionMs,stream:null,trackCleanups:[],timer:null,expiry:null,request:null,watch:null,lastComplete:null,count:0};
  this.session=session;session.expiry=this.setTimer(()=>{if(this.session===session)this.stop('expired')},CAMERA_LIMITS.maxSessionMs);
  this.emit({...blank(),phase:'starting',active:true});
  try{
   this.check(session);
   const grant=await this.api.startPreview({consent:true});
   if(!this.current(session)){await this.revoke(grant?.token);throw aborted()}
   if(typeof grant?.token!=='string'||!grant.token||grant.token.length>200||!Number.isFinite(grant.expires)||grant.expires<=this.now()){
    await this.revoke(grant?.token);throw Error('摄像头预览授权无效。');
   }
   session.token=grant.token;session.expires=Math.min(grant.expires,session.startedAt+CAMERA_LIMITS.maxSessionMs);
   this.clearTimer(session.expiry);session.expiry=this.setTimer(()=>{if(this.session===session)this.stop('expired')},Math.max(0,session.expires-this.now()));
   this.check(session);
   const stream=await this.mediaDevices.getUserMedia({audio:false,video:{width:{ideal:CAMERA_LIMITS.width},height:{ideal:CAMERA_LIMITS.height},...(deviceId?{deviceId:{exact:deviceId}}:{})}});
   if(!this.current(session)){stopTracks(stream);throw aborted()}
   session.stream=stream;this.check(session);
   const tracks=stream.getTracks?.()||[],videoTracks=tracks.filter(track=>track.kind==='video');
   if(videoTracks.length!==1||tracks.some(track=>track.kind!=='video')||videoTracks[0].readyState==='ended')throw Error('摄像头没有提供单一视频轨。');
   for(const track of tracks){const ended=()=>{if(this.session===session)this.stop('device-ended')};track.addEventListener?.('ended',ended);session.trackCleanups.push(()=>track.removeEventListener?.('ended',ended))}
   this.video.muted=true;this.video.playsInline=true;this.video.srcObject=stream;
   await this.video.play();this.check(session);
   this.emit({phase:'preview',localPreview:true,sourceName:String(videoTracks[0].label||'摄像头').slice(0,160),destination:destinationOrigin(grant.destination),model:typeof grant.model==='string'?grant.model.slice(0,160):'',expires:session.expires});
   return this.getSnapshot();
  }catch(error){
   if(this.session===session){const message=safeFailure(error);this.stop('error');this.emit({phase:'error',error:message});throw Error(message)}
   throw aborted();
  }
 }
 validateSend(options,watch=false){
  if(options?.consent!==true||(watch&&options.watchConsent!==true))throw Error(watch?'持续发送摄像头画面需要单独确认。':'请先确认将摄像头画面发送至所示 API。');
  const prompt=options.prompt??'请用中文说明当前画面中的内容。';
  if(typeof prompt!=='string'||prompt.length>4000)throw Error('识别问题最多 4000 字符。');
  const session=this.session;if(!session)throw Error('请先开启本机预览。');this.check(session);
  if(!session.stream||!this.state.localPreview)throw Error('摄像头预览尚未准备好。');
  if(session.request||session.watch)throw Error('正在识别，请先停止当前任务。');
  if(session.count>=CAMERA_LIMITS.maxFrames){this.stop('frame-limit');throw Error('本次已达到 60 帧上限，请重新确认。')}
  return {session,prompt:prompt.trim()||'请用中文说明当前画面中的内容。'};
 }
 capture(session){
  this.check(session);
  const width=Number(this.video.videoWidth),height=Number(this.video.videoHeight);
  if(this.video.readyState<2||!Number.isFinite(width)||!Number.isFinite(height)||width<1||height<1)throw Error('摄像头画面尚未就绪。');
  const ratio=Math.min(1,CAMERA_LIMITS.width/width,CAMERA_LIMITS.height/height),canvas=this.createCanvas();
  try{
   canvas.width=Math.max(1,Math.floor(width*ratio));canvas.height=Math.max(1,Math.floor(height*ratio));
   const context=canvas.getContext('2d',{alpha:false});if(!context)throw Error('无法读取摄像头画面。');
   context.drawImage(this.video,0,0,canvas.width,canvas.height);this.check(session);
   const image=canvas.toDataURL('image/jpeg',.8),prefix='data:image/jpeg;base64,';
   if(typeof image!=='string'||!image.startsWith(prefix))throw Error('摄像头图像格式无效。');
   const encoded=image.slice(prefix.length);
   if(!encoded||encoded.length>Math.ceil(CAMERA_LIMITS.maxImageBytes/3)*4||encoded.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)||encoded.length/4*3-(encoded.endsWith('==')?2:encoded.endsWith('=')?1:0)>CAMERA_LIMITS.maxImageBytes)throw Error('摄像头画面超过大小限制。');
   return image;
  }finally{try{canvas.getContext('2d')?.clearRect(0,0,canvas.width,canvas.height)}catch{}canvas.width=0;canvas.height=0;}
 }
 async dispatch(session,prompt,watch){
  this.check(session);if(session.request)throw Error('当前帧尚未完成。');
  const time=this.now();if(session.lastComplete!==null&&time-session.lastComplete<CAMERA_LIMITS.minIntervalMs)throw Error('请稍候再发送下一帧。');
  if(session.count>=CAMERA_LIMITS.maxFrames){this.stop('frame-limit');throw aborted()}
  const request={token:session.token,image:'',prompt,consent:true};session.request=request;
  try{
   request.image=this.capture(session);this.check(session);session.count++;
   this.emit({phase:'sending',sending:true,count:session.count,error:''});
   this.check(session);
   const result=await this.api.analyzeFrame(request);this.check(session);
   if(typeof result?.text!=='string'||!result.text.trim()||result.text.length>48000)throw Error('视觉 API 没有返回有效内容。');
   session.lastComplete=this.now();this.emit({phase:watch?'watching':'preview',sending:false,result:result.text.trim(),nextAllowedAt:session.lastComplete+CAMERA_LIMITS.minIntervalMs});
   if(session.count>=CAMERA_LIMITS.maxFrames){this.stop('frame-limit');return {text:result.text.trim()}}
   return {text:result.text.trim()};
  }catch(error){if(this.session===session){this.stop('error');const message=safeFailure(error);this.emit({phase:'error',error:message});throw Error(message)}throw aborted();
  }finally{request.image='';if(session.request===request)session.request=null;}
 }
 sendOnce(options={}){const {session,prompt}=this.validateSend(options);return this.dispatch(session,prompt,false)}
 startWatch(options={}){
  const {session,prompt}=this.validateSend(options,true),intervalSeconds=options.intervalSeconds??30;
  if(!CAMERA_LIMITS.intervals.includes(intervalSeconds))throw Error('请选择 5、15、30 或 60 秒间隔。');
  session.watch={prompt,intervalSeconds};this.emit({phase:'watching',watching:true,intervalSeconds,error:''});
  const delay=session.lastComplete===null?0:Math.max(0,session.lastComplete+CAMERA_LIMITS.minIntervalMs-this.now());
  if(this.current(session))this.schedule(session,delay);return this.getSnapshot();
 }
 schedule(session,delay){
  session.timer=this.setTimer(()=>{session.timer=null;void this.cycle(session)},delay);
 }
 async cycle(session){
  if(!this.current(session)||!session.watch)return;
  try{await this.dispatch(session,session.watch.prompt,true);if(this.current(session)&&session.watch)this.schedule(session,session.watch.intervalSeconds*1000)}catch{/* dispatch already tears down; stale results never requeue. */}
 }
 stop(reason='user'){
  const session=this.session;this.session=null;this.epoch++;
  if(session){this.clearTimer(session.timer);this.clearTimer(session.expiry);session.watch=null;for(const cleanup of session.trackCleanups)cleanup();session.trackCleanups=[];stopTracks(session.stream);session.stream=null;if(session.request)session.request.image='';session.request=null;}
  try{this.video?.pause?.()}catch{}if(this.video)this.video.srcObject=null;
  this.emit({...blank(),phase:'stopped',stopReason:['user','hidden','expired','frame-limit','device-change','device-ended','error','clock-change','dispose'].includes(reason)?reason:'user'});
  return this.revoke(session?.token);
 }
 setHidden(hidden){this.hidden=hidden===true;if(this.hidden)this.stop('hidden')}
 dispose(){if(this.disposed)return;this.disposed=true;for(const cleanup of this.cleanups.splice(0))cleanup();return this.stop('dispose')}
}
