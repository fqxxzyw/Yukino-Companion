'use strict';
const api=window.companion,canvas=document.getElementById('pet'),ctx=canvas.getContext('2d',{willReadFrequently:true});
const bubble=document.getElementById('bubble'),zh=document.getElementById('zh'),ja=document.getElementById('ja'),model=document.getElementById('model');
const composer=document.getElementById('pet-composer'),input=document.getElementById('pet-input'),sendButton=document.getElementById('pet-send'),cameraButton=document.getElementById('pet-camera'),chatStatus=document.getElementById('chat-status');
const menu=document.getElementById('pet-menu'),menuBody=document.getElementById('menu-body'),menuError=document.getElementById('menu-error'),focusBadge=document.getElementById('focus-badge');
const clips={
 idle:{row:0,count:7,durations:[4200,500,500,120,500,180,300],loop:true},
 wave:{row:3,count:4,durations:[130,105,165,230]},jump:{row:4,count:5,durations:[110,90,145,95,180]},
 lifted:{row:4,start:2,count:1,durations:[220],loop:true},landing:{row:4,start:3,count:2,durations:[95,210]},
 annoyed:{row:5,count:6,durations:[140,120,180,150,190,270]},waiting:{row:6,count:6,durations:[240,210,260,230,300,420]},
 'head-tilt':{row:8,count:6,durations:[150,180,260,700,180,220]},sitting:{row:6,count:6,durations:[280,240,330,270,360,480],loop:true},
 'walk-left':{row:0,count:8,durations:[165,115,130,185,165,115,130,185],loop:true,sheet:'left'},
 'walk-right':{row:0,count:8,durations:[165,115,130,185,165,115,130,185],loop:true,sheet:'right'}
};
const menuView=new URLSearchParams(location.search).get('view')==='menu',motionPreference=matchMedia('(prefers-reduced-motion: reduce)');
const videoLayer=document.getElementById('pet-video-layer');
let videoPreview=null,videoLoading=null,videoGeneration=0,videoController=null,videoFailed=false,videoPresentation='sprite',playbackPaused=false,viewportScale=1;
function videoRequested(){return !menuView&&kind==='pet'&&settings.petRenderer==='video-preview'&&lastCharacterId==='yukino';}
function previewActive(){return videoRequested()&&videoPreview?.ready&&!videoPreview.failed;}
function updateVideoState(){videoPreview?.update({name:clipName,scale:viewportScale,hidden:!!document.hidden||playbackPaused,staticPose:motionPreference.matches||!settings.animation||settings.interactionPaused||settings.quietMode||focus.active||dragging});}
async function syncVideoPreview(){
 const wanted=videoRequested();
 if(!wanted){videoGeneration++;videoController?.abort();videoController=null;videoLoading=null;videoPreview?.dispose();videoPreview=null;videoFailed=false;videoPresentation='sprite';videoLayer.hidden=true;canvas.classList.remove('video-active');lastDraw='';return;}
 if(videoPreview){updateVideoState();return;}
 if(videoLoading||videoFailed)return;
 const generation=++videoGeneration;videoController=new AbortController();const signal=videoController.signal;
 videoLoading=(async()=>{
  try{const pack=await call('video-pack');if(signal.aborted||generation!==videoGeneration)return;const module=await import('./animation/video-companion.mjs');if(signal.aborted||generation!==videoGeneration)return;
   const preview=await module.createVideoCompanion({container:videoLayer,canvas,pack,signal,onPresentation:mode=>{if(generation===videoGeneration){videoPresentation=mode;if(mode==='sprite'){lastDraw='';resetMotion();}}},onError:message=>{if(generation===videoGeneration){videoFailed=true;stopWalk();showError(message);}}});
   if(signal.aborted||generation!==videoGeneration){preview.dispose();return;}videoPreview=preview;updateVideoState();
  }catch(error){if(!signal.aborted&&generation===videoGeneration){videoFailed=true;videoPresentation='sprite';lastDraw='';resetMotion();showError('连续动画预览无法加载，保留原 Q 版。'+error.message);}}
  finally{if(generation===videoGeneration)videoLoading=null;}
 })();
 return videoLoading;
}
let composing=false,dockHover=false,dockFocus=false,dockTimer=null,speechBusy=false;
const expandButton=document.getElementById('pet-expand');
function updateDock(){clearTimeout(dockTimer);const open=dockHover||dockFocus||input.value||chatBusy||submitting||visionActive;const apply=value=>{composer.classList.toggle('expanded',value);expandButton.setAttribute('aria-expanded',String(value));expandButton.tabIndex=value?-1:0;for(const el of[input,cameraButton,sendButton])el.tabIndex=value?0:-1;};if(open)apply(true);else dockTimer=setTimeout(()=>apply(false),320);}
let drawRequest=0;
function scheduleDraw(){if(!drawRequest&&!disposed&&!menuView&&!document.hidden&&!playbackPaused)drawRequest=requestAnimationFrame(draw);}
function refreshDrawLoop(){if(document.hidden||playbackPaused){if(drawRequest)window.cancelAnimationFrame?.(drawRequest);drawRequest=0;}else scheduleDraw();}
let menuOpen=menuView,chatBusy=false,visionActive=false,submitting=false,walkBusy=false,dragBusy=false,lastDraw='',lastWalkTime=0,disposed=false;
let lastCharacterId='',characterRevision=0;
let settings={animation:true,bubbleLanguage:'zh',scale:1,opacity:1,showBubbles:true,soundEnabled:true,soundVolume:.35},kind='pet',startupAvailable=false;
let dragging=false,down=null,clicks=[],lastHit=true,clip=clips.idle,frame=0,nextFrame=0,clipName='idle';
let dragFrame=0,dragPending=false;
let wander=null,nextDecision=performance.now()+8000,sitUntil=0,remoteReply=null,localQuote=null,localQuoteUntil=0,lastReply='',lastSettings='',focus={active:false};
let voiceFiles=[],voiceRevision=-1,voiceGeneration=0,audio=null,lastVoice=-1,nextVoice=performance.now()+30000,nextQuote=performance.now()+60000,nextNight=performance.now()+1200000,lastHoverQuote=0;
let look=-1,targetLook=-1,nextLook=0,cursorInsideSince=0,cursorBusy=false,initialized=false;
const images={};for(const [key,file] of Object.entries({base:'spritesheet.png',left:'walking-left.png',right:'walking-right.png'})){const image=new Image();image.src=`assets/${file}`;images[key]=image;}
function call(action,payload){return api?api.call(action,payload):Promise.resolve(false)}
function safely(action,payload){return call(action,payload).catch(error=>{console.warn('桌宠操作未完成',error.message);return false})}
function play(name){if(videoRequested()&&!['idle','walk-left','walk-right'].includes(name))name='idle';clipName=motionPreference.matches?'idle':name;clip=clips[clipName]||clips.idle;frame=0;nextFrame=0;targetLook=look=-1;updateVideoState();}
function stopWalk(){wander=null;if(videoRequested()&&['walk-left','walk-right'].includes(clipName))play('idle');nextDecision=performance.now()+8000+Math.random()*11000;}
function resetMotion(){
 stopWalk();sitUntil=0;cursorInsideSince=0;play('idle');nextFrame=performance.now()+clips.idle.durations[0];lastWalkTime=performance.now();canvas.style.transform='none';
 if(previewActive()){updateVideoState();return;}
 const image=images.base;if(image.complete&&image.naturalWidth){ctx.clearRect(0,0,192,208);ctx.drawImage(image,0,0,192,208,0,0,192,208);lastDraw='base:0:0';}else lastDraw='';
}
motionPreference.addEventListener('change',resetMotion);
function canAutoplay(){return !document.hidden&&!playbackPaused&&(!videoRequested()||previewActive())&&!menuView&&!menuOpen&&!dockHover&&!dockFocus&&!chatBusy&&!submitting&&!input.matches(':focus')&&!motionPreference.matches&&settings.animation&&!settings.interactionPaused&&!settings.quietMode&&!focus.active&&!dragging&&!down&&menu.hidden;}
function showError(error){const message=String(error?.message||error||'桌宠操作未完成');if(menuView){menuError.textContent=message;menuError.hidden=false;}else{chatStatus.textContent=message;chatStatus.hidden=false;}}
function renderChat(){updateDock();input.disabled=chatBusy||submitting;sendButton.disabled=!chatBusy&&(submitting||!input.value.trim());sendButton.textContent=chatBusy?'■':'↑';sendButton.title=chatBusy?'停止回复':'发送消息';sendButton.setAttribute('aria-label',sendButton.title);cameraButton.disabled=!visionActive&&(chatBusy||submitting);cameraButton.classList.toggle('vision-active',visionActive);cameraButton.title=visionActive?'视觉陪伴进行中 · 点击停止':'屏幕 / 摄像头（默认关闭）';cameraButton.setAttribute('aria-label',cameraButton.title);composer.classList.toggle('busy',chatBusy);if(chatBusy){chatStatus.textContent='正在回复 · 点击停止按钮可取消';chatStatus.hidden=false;}else if(chatStatus.textContent.startsWith('正在回复')){chatStatus.hidden=true;}}
async function submitChat(event){event?.preventDefault();if(composing)return;if(chatBusy){await call('chat-stop').catch(showError);return;}const text=input.value.trim();if(!text||submitting)return;submitting=true;renderChat();try{await call('chat-submit',text);input.value='';}catch(error){showError(error);}finally{submitting=false;renderChat();}}
function stopAudio(){voiceGeneration++;if(audio){audio.pause();audio.src='';audio=null;}}
async function playVoice(manual=false){
 if(speechBusy)return;
 if((!manual&&(!settings.soundEnabled||settings.quietMode||focus.active))||(!manual&&audio&&!audio.paused))return;
 if(!voiceFiles.length){if(manual)showError('桌宠预录语音尚未准备，请打开完整设置中的资源向导安装。');return;}
 let next=Math.floor(Math.random()*voiceFiles.length);if(voiceFiles.length>1&&next===lastVoice)next=(next+1)%voiceFiles.length;lastVoice=next;
 stopAudio();const sequence=voiceGeneration;
 try{const url=await call('voice-url',voiceFiles[next]);if(sequence!==voiceGeneration)return;if(typeof url!=='string'||!url.startsWith('file:'))throw Error('语音地址未准备');audio=new Audio(url);audio.volume=settings.soundVolume;await audio.play()}catch(error){if(sequence!==voiceGeneration)return;stopAudio();if(manual)showError('声音暂时无法播放，请检查系统输出设备。');}
 nextVoice=performance.now()+45000+Math.random()*45000;
}
function renderBubble(){
 if(menuView||!settings.showBubbles||settings.quietMode){bubble.hidden=true;return;}
 if(localQuote){zh.textContent=localQuote;ja.textContent='';bubble.hidden=false;return;}
 if(!remoteReply||(!remoteReply.zh&&!remoteReply.ja)){bubble.hidden=true;return;}
 zh.textContent=settings.bubbleLanguage==='ja'&&remoteReply.ja?'':remoteReply.zh;
 ja.textContent=settings.bubbleLanguage==='zh'?(remoteReply.zh?'':remoteReply.ja):(remoteReply.ja||'（当前仅有中文内容）');bubble.hidden=false;
}
async function quote(trigger,action=clipName){
 if(menuView||!settings.showBubbles||settings.quietMode)return false;
 const revision=characterRevision;const entry=await safely('quote',{trigger,action});if(revision!==characterRevision||!entry?.Text)return false;
 localQuote=entry.Text;localQuoteUntil=performance.now()+Math.min(18000,Math.max(5000,entry.Text.length*180));renderBubble();return true;
}
function startWalk(manual=false){
 if(motionPreference.matches||!settings.animation||settings.interactionPaused||focus.active||settings.quietMode||(videoRequested()&&!previewActive()))return;
 localQuote=null;bubble.hidden=true;sitUntil=0;const angle=videoRequested()?(Math.random()<.5?Math.PI:0):Math.random()*Math.PI*2;
 lastWalkTime=performance.now();wander={x:Math.cos(angle),y:Math.sin(angle)*.45,until:lastWalkTime+(manual?9000:4500)+Math.random()*4500,next:0};play(wander.x<0?'walk-left':'walk-right');
}
function act(name){
 if(videoRequested()&&['greet','head-tilt','jump','sit'].includes(name)){showError('连续动画预览仅支持待机和左右散步；切回原 Q 版可使用该动作。');return;}
 if(name==='audio-stop'){stopAudio();return;}
 if(name==='menu'){openMenu();return;}
 if(name==='menu-opened'){menuOpen=true;stopWalk();play('idle');return;}
 if(name==='menu-closed'){menuOpen=false;nextDecision=performance.now()+12000;return;}
 stopWalk();sitUntil=0;
 if(name==='greet'){play('wave');quote('Greeting');playVoice();}
 else if(name==='voice')playVoice(true);
 else if(name==='head-tilt')play('head-tilt');
 else if(name==='jump')play('jump');
 else if(name==='walk')startWalk(true);
 else if(name==='sit'){play('sitting');sitUntil=performance.now()+12000;quote('Observation','sitting');}
 else if(name==='focus-complete'){focus.active=false;play('wave');quote(Math.random()<.5?'Break':'Work');playVoice();}
}
function actionButton(parent,label,action,className=''){const button=document.createElement('button');button.type='button';button.className='menu-action '+className;button.textContent=label;button.addEventListener('click',()=>{Promise.resolve(action()).catch(showError)});parent.append(button);return button;}
function group(title){const section=document.createElement('div');section.className='menu-group';const heading=document.createElement('h3');heading.textContent=title;section.append(heading);menuBody.append(section);return section;}
function toggle(parent,label,key){const row=document.createElement('label');row.className='menu-toggle';const text=document.createElement('span');text.textContent=label;const input=document.createElement('input');input.type='checkbox';input.setAttribute('role','switch');input.checked=!!settings[key];input.setAttribute('aria-label',label);input.addEventListener('change',()=>call('prefs',{[key]:input.checked}).catch(showError));row.append(text,input);parent.append(row);return input;}
function range(parent,label,key,min,max,step){const row=document.createElement('label');row.className='menu-range';const heading=document.createElement('span');const value=document.createElement('b');value.textContent=Math.round(settings[key]*100)+'%';heading.append(document.createTextNode(label),value);const input=document.createElement('input');input.type='range';Object.assign(input,{min,max,step,value:settings[key]});input.setAttribute('aria-label',label);input.addEventListener('input',()=>{value.textContent=Math.round(Number(input.value)*100)+'%'});input.addEventListener('change',()=>call('prefs',{[key]:Number(input.value)}).catch(showError));row.append(heading,input);parent.append(row);}
function renderMenu(){
 const scroll=menuBody.scrollTop;menuBody.replaceChildren();
 let section=group('和她互动');actionButton(section,'打开聊天',()=>call('open-main').then(closeMenu),'primary');
 if(kind==='pet'){
  const grid=document.createElement('div');grid.className='menu-grid';section.append(grid);
  for(const [name,label]of[['greet','打个招呼'],['head-tilt','歪头看看'],['jump','原地跳一下'],['walk','安静地散步'],['sit','坐下来休息'],['voice','随机试听语音']]){const button=actionButton(grid,label,()=>call('action',name).then(closeMenu));button.disabled=settings.petRenderer==='video-preview'&&lastCharacterId==='yukino'&&['greet','head-tilt','jump','sit'].includes(name);}
  section=group('桌宠渲染');const renderer=document.createElement('select');renderer.setAttribute('aria-label','桌宠渲染模式');for(const [value,label]of[['sprite','原 Q 版 · 默认'],['video-preview','连续动画预览 · 3D 预渲染']]){const option=document.createElement('option');option.value=value;option.textContent=label;option.disabled=value==='video-preview'&&lastCharacterId!=='yukino';renderer.append(option);}renderer.value=settings.petRenderer||'sprite';renderer.addEventListener('change',()=>call('prefs',{petRenderer:renderer.value}).catch(showError));section.append(renderer);const previewNote=document.createElement('p');previewNote.className='menu-note';previewNote.textContent='预览仅限雪乃：24 fps 待机与左右散步，不是原 Q 版新素材。暂不支持挥手、摸头动作、抱起姿态、跳跃和坐下；拖动与聊天保留。转身/停步及 Windows 实机效果待验收。';section.append(previewNote);
  section=group('日常陪伴');toggle(section,'播放动画','animation');toggle(section,'暂停互动','interactionPaused');toggle(section,'安静模式','quietMode');
  section=group('语录与提醒');toggle(section,'随机语录','randomQuotes');toggle(section,'互动语录','interactionQuotes');toggle(section,'深夜提醒','nightReminders');toggle(section,'显示气泡','showBubbles');
  const note=document.createElement('p');note.className='menu-note';note.textContent='原桌宠语录为中文；聊天回复使用你选择的气泡语言。';section.append(note);
  section=group('桌宠预录语音');toggle(section,'播放预录语音','soundEnabled');range(section,'音量','soundVolume',0,1,.05);const count=document.createElement('p');count.className='menu-note';count.textContent=`已准备 ${voiceFiles.length} 条。与 GPT-SoVITS 朗读分别设置。`;section.append(count);
  section=group('专注计时');if(focus.active)actionButton(section,'取消本次专注',()=>call('action','focus-cancel'));else for(const minutes of[25,50])actionButton(section,`${minutes} 分钟`,()=>call('action',`focus-${minutes}`).then(closeMenu));
 }
 section=group('休息提醒');toggle(section,'久坐休息提醒（默认关闭）','breakReminders');const reminderSelect=document.createElement('select');reminderSelect.setAttribute('aria-label','休息提醒间隔');for(const minutes of[30,45,60,90,120]){const option=document.createElement('option');option.value=minutes;option.textContent=minutes+' 分钟';reminderSelect.append(option)}reminderSelect.value=settings.breakIntervalMinutes||60;reminderSelect.addEventListener('change',()=>call('prefs',{breakIntervalMinutes:Number(reminderSelect.value)}).catch(showError));section.append(reminderSelect);
 section=group('展示与启动');range(section,'形象大小','scale',.6,2,.05);range(section,'透明度','opacity',.35,1,.05);toggle(section,'总在最前','alwaysOnTop');const startup=toggle(section,'开机启动','startup');startup.disabled=!startupAvailable;
 section=group('聊天输入');const placement=document.createElement('label');placement.className='menu-toggle';placement.textContent='输入框位置';const select=document.createElement('select');select.setAttribute('aria-label','输入框位置');for(const [value,label]of[['below','形象下方'],['above','形象上方']]){const option=document.createElement('option');option.value=value;option.textContent=label;select.append(option);}select.value=settings.inputPosition||'below';select.addEventListener('change',()=>call('prefs',{inputPosition:select.value}).catch(showError));placement.append(select);section.append(placement);
 section=group('更多');actionButton(section,'打开完整设置',()=>call('settings'));actionButton(section,'隐藏到托盘',()=>call('hide'));actionButton(section,'完全退出',()=>call('quit'),'danger');menuBody.scrollTop=scroll;
}
function openMenu(){stopWalk();if(!dragging)play('idle');if(!menuView){safely('menu-open');return;}menuError.hidden=true;menu.hidden=false;document.body.classList.add('menu-active');renderMenu();document.getElementById('menu-close').focus();}
function closeMenu(){if(menuView){safely('menu-close');return;}menu.hidden=true;document.body.classList.remove('menu-active');nextDecision=performance.now()+12000;canvas.focus();}
function draw(time){
 drawRequest=0;if(disposed||menuView||document.hidden||playbackPaused)return;
 if(localQuote&&time>localQuoteUntil){localQuote=null;renderBubble();}
 if(kind==='pet'&&images.base.complete&&images.base.naturalWidth){
  if(canAutoplay()){
   if(sitUntil&&time>sitUntil){sitUntil=0;play('idle');}
   if(!wander&&!sitUntil&&clipName==='idle'&&bubble.hidden&&time>nextDecision){nextDecision=time+8000+Math.random()*11000;const roll=Math.random();if(roll<.24)startWalk();else if(roll<.4&&!videoRequested())play('head-tilt');}
   if(time>nextQuote){nextQuote=time+50000+Math.random()*60000;if(settings.randomQuotes&&!wander)quote('Idle');}
   if(time>nextVoice&&bubble.hidden&&!wander&&!sitUntil)playVoice();
   const hour=new Date().getHours();if(settings.nightReminders&&(hour>=23||hour<6)&&time>nextNight){nextNight=time+65*60000;quote('Night');}
  }
  if(wander){if(!canAutoplay()||time>wander.until){stopWalk();play('idle');}else if(!walkBusy&&time-wander.next>=16){const active=wander;const elapsedMs=videoRequested()?(videoPreview?.movementElapsed(time)||0):Math.min(100,Math.max(0,time-lastWalkTime));lastWalkTime=time;active.next=time;if(elapsedMs>0){walkBusy=true;safely('walk-step',{x:videoRequested()?Math.sign(active.x):active.x,y:videoRequested()?0:active.y,elapsedMs,...(videoRequested()?{videoPreview:true}:{})}).then(moved=>{if(moved===false&&wander===active){stopWalk();play('idle')}}).finally(()=>{walkBusy=false;});}}}
  if(previewActive()){updateVideoState();canvas.style.transform='none';scheduleDraw();return;}
  if(!nextFrame)nextFrame=time+clip.durations[frame];
  if(settings.animation&&!motionPreference.matches){let advanced=0;while(time>=nextFrame&&advanced++<12){frame++;if(frame>=clip.count){if(clip.loop)frame=0;else{clip=clips.idle;clipName='idle';frame=0;}}nextFrame+=clip.durations[frame];}if(advanced>=12)nextFrame=time+clip.durations[frame];}
  let row=clip.row,col=(clip.start||0)+frame;
  if(settings.animation&&!motionPreference.matches&&clipName==='idle'&&targetLook>=0&&time>nextLook){nextLook=time+75;if(look<0)look=targetLook;else if(look!==targetLook)look=(look+(((targetLook-look+16)%16)<=8?1:15))%16;}
  if(clipName==='idle'&&look>=0){row=look<8?9:10;col=look%8;}
  const image=images[clip.sheet||'base'],signature=`${clip.sheet||'base'}:${row}:${col}`;if(image.complete&&image.naturalWidth&&signature!==lastDraw){ctx.clearRect(0,0,192,208);ctx.drawImage(image,col*192,row*208,192,208,0,0,192,208);lastDraw=signature;}
  const breathing=canAutoplay()&&clipName==='idle'?Math.sin(time/1300)*.65:0;canvas.style.transform=breathing?`translateY(${breathing.toFixed(2)}px)`:'none';
 }
 scheduleDraw();
}
api?.onState(state=>{speechBusy=state.speechBusy===true;if(speechBusy)stopAudio();
 const identity=state.character?.id||'yukino';
 if(lastCharacterId&&identity!==lastCharacterId){characterRevision++;localQuote=null;localQuoteUntil=0;remoteReply=null;lastReply='';stopAudio();resetMotion();}
 lastCharacterId=identity;
 if(state.voiceRevision!==voiceRevision){voiceRevision=state.voiceRevision;refreshVoiceCatalog();}
 const rendererChanged=settings.petRenderer!==state.preferences.petRenderer;kind=state.kind;settings=state.preferences;playbackPaused=state.playbackPaused===true;if(rendererChanged)resetMotion();const title=state.character?.name||'雪之下雪乃';document.querySelector('.pet-menu h2').textContent=title;input.placeholder=`和${title}说话…`;canvas.setAttribute('aria-label',`${title}桌宠，拖动移动，双击打开聊天，右键打开设置`);chatBusy=!!state.chatBusy;visionActive=!!state.visionActive;startupAvailable=!!state.startupAvailable;focus=state.focus||{active:false};
 const displayScale=menuView?1:(state.viewportScale||settings.scale);viewportScale=displayScale;document.documentElement.style.setProperty('--scale',displayScale);document.body.dataset.inputPosition=settings.inputPosition||'below';document.documentElement.style.setProperty('--pet-opacity',settings.opacity??1);
 canvas.hidden=menuView||kind!=='pet';model.hidden=menuView||kind!=='model';composer.hidden=menuView;document.documentElement.style.setProperty('--figure-height',`${(kind==='model'?280:208)*displayScale}px`);
 void syncVideoPreview();refreshDrawLoop();updateCursorTimer();
 renderChat();
 if(playbackPaused||!settings.animation||settings.interactionPaused||settings.quietMode||focus.active){stopWalk();sitUntil=0;if(!dragging)play('idle');}
 if(speechBusy||!settings.soundEnabled||settings.quietMode||focus.active)stopAudio();else if(audio)audio.volume=settings.soundVolume;
 const replyId=state.reply?.id||'';if(replyId!==lastReply){lastReply=replyId;remoteReply=state.reply;localQuote=null;if(remoteReply&&!dragging){stopWalk();play('wave')}}else remoteReply=state.reply;
 renderBubble();focusBadge.hidden=!focus.active;focusBadge.textContent=focus.active?`专注 ${Math.ceil(focus.remainingMs/60000)} 分钟` :'';
 const signature=JSON.stringify(settings);if(signature!==lastSettings&&!menu.hidden)renderMenu();lastSettings=signature;
 if(!initialized){initialized=true;if(menuView)openMenu();else if(kind==='pet')quote('Greeting');}
});
api?.onAction(({name,message})=>{if(name==='chat-error')showError(message);else act(name)});
function hitTest(event){
 if(dragging||menuView||!menu.hidden||event.target.closest('button,input,select,.pet-composer,.chat-status,.bubble,.model'))return true;
 const videoHit=previewActive()?videoPreview.hitTest(event.clientX,event.clientY):null;if(videoHit!==null)return videoHit;
 const box=canvas.getBoundingClientRect(),x=Math.floor((event.clientX-box.left)*192/box.width),y=Math.floor((event.clientY-box.top)*208/box.height);
 return !canvas.hidden&&x>=0&&x<192&&y>=0&&y<208&&ctx.getImageData(x,y,1,1).data[3]>15;
}
// Keep the visible character inside the displays, not the transparent margins of its window.
function dragBodyBounds(){
 if(kind!=='pet')return null;
 const box=canvas.getBoundingClientRect(),width=innerWidth,height=innerHeight;
 if(!(box.width>0&&box.height>0&&width>0&&height>0))return null;
 let left=0,top=0,right=192,bottom=208;
 if(!previewActive())try{
  const pixels=ctx.getImageData(0,0,192,208).data;let minX=192,minY=208,maxX=-1,maxY=-1;
  for(let y=0;y<208;y++)for(let x=0;x<192;x++)if(pixels[(y*192+x)*4+3]>15){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y)}
  if(maxX>=minX&&maxY>=minY){left=minX;top=minY;right=maxX+1;bottom=maxY+1}
 }catch{}
 const x=Math.max(0,box.left+left*box.width/192),y=Math.max(0,box.top+top*box.height/208);
 const endX=Math.min(width,box.left+right*box.width/192),endY=Math.min(height,box.top+bottom*box.height/208);
 return endX>x&&endY>y?{x:x/width,y:y/height,width:(endX-x)/width,height:(endY-y)/height}:null;
}
function clearDragFrame(){dragPending=false;if(dragFrame)cancelAnimationFrame(dragFrame);dragFrame=0;}
function queueDragMove(){
 dragPending=true;if(dragBusy||dragFrame)return;
 dragFrame=requestAnimationFrame(()=>{dragFrame=0;if(!dragging||!down){dragPending=false;return;}dragPending=false;dragBusy=true;safely('drag-move').finally(()=>{dragBusy=false;if(dragPending&&dragging&&down)queueDragMove();});});
}
window.addEventListener('pointermove',event=>{
 if(down){
  const dx=event.screenX-down.x,dy=event.screenY-down.y,distance=Math.hypot(dx,dy);
  if(down.head&&!dragging){const movement=event.screenX-down.lastX,direction=Math.abs(movement)>=2?Math.sign(movement):0;if(direction&&down.direction&&direction!==down.direction&&Math.abs(dy)<22)down.reversals++;if(direction)down.direction=direction;down.lastX=event.screenX;if(down.reversals>=3&&performance.now()-down.time>=550){down.patted=true;play('waiting')}if(!down.patted&&(Math.abs(dy)>28||distance>46))down.head=false;}
  if(!down.head&&!down.patted&&distance>7){if(!dragging){dragging=true;localQuote=null;bubble.hidden=true;play('lifted')}queueDragMove();}
 }
 const hit=hitTest(event);if(hit!==lastHit){lastHit=hit;safely('hit-test',hit)}
});
for(const target of[canvas,model]){
 target.addEventListener('pointerdown',event=>{if(event.button!==0||event.target.closest('button')||settings.interactionPaused||menuOpen||!menu.hidden)return;const box=canvas.getBoundingClientRect();down={x:event.screenX,y:event.screenY,time:performance.now(),head:!videoRequested()&&kind==='pet'&&(event.clientY-box.top)<box.height*.42,lastX:event.screenX,direction:0,reversals:0,patted:false};stopWalk();target.setPointerCapture(event.pointerId);safely('drag-start',{body:dragBodyBounds()})});
 target.addEventListener('pointerup',event=>{if(!down)return;const previous=down;down=null;clearDragFrame();safely('drag-end');if(target.hasPointerCapture?.(event.pointerId))target.releasePointerCapture(event.pointerId);if(dragging){dragging=false;play('landing');renderBubble()}else if(previous.patted){play('head-tilt');quote('HeadPat');playVoice()}else{clicks=clicks.filter(time=>performance.now()-time<4500);clicks.push(performance.now());if(clicks.length>=7){play('annoyed');quote('Annoyed');clicks=[]}else if(clicks.length>=4){play('head-tilt');quote('Click')}else{play('wave');if(Math.random()<.35)quote('Click')}playVoice()}});
 function cancelDrag(){if(!down&&!dragging)return;clearDragFrame();safely('drag-cancel');down=null;dragging=false;play('idle');}
 target.addEventListener('pointercancel',cancelDrag);target.addEventListener('lostpointercapture',cancelDrag);
 target.addEventListener('contextmenu',event=>{event.preventDefault();openMenu()});target.addEventListener('dblclick',()=>safely('open-main'));
}
canvas.addEventListener('keydown',event=>{if(event.key==='Enter')safely('open-main');if(event.key==='ContextMenu'||event.key===' '){event.preventDefault();openMenu()}});
window.addEventListener('keydown',event=>{if(event.isComposing||composing||event.keyCode===229)return;if(event.key==='Escape'&&!menuView){if(chatBusy)safely('chat-stop');input.blur();return;}if(menu.hidden)return;if(event.key==='Escape'){event.preventDefault();closeMenu()}if(event.key==='Tab'){const items=[...menu.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)')].filter(el=>el.getClientRects().length),first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}});
document.getElementById('menu-close').addEventListener('click',closeMenu);document.getElementById('model-open').addEventListener('click',()=>safely('open-main'));
let cursorTimer=null;
async function pollCursor(){
 if(videoRequested()||menuView||cursorBusy||kind!=='pet'||!canAutoplay()||clipName!=='idle'){look=targetLook=-1;cursorInsideSince=0;return;}
 cursorBusy=true;try{const point=await call('cursor');if(!point||!canAutoplay()){look=targetLook=-1;return;}if(point.x<0||point.y<0||point.x>innerWidth||point.y>innerHeight){look=targetLook=-1;cursorInsideSince=0;return;}const box=canvas.getBoundingClientRect(),dx=point.x-(box.x+box.width/2),dy=point.y-(box.y+box.height*.38);if(Math.hypot(dx,dy)<210*settings.scale){let angle=Math.atan2(dx,-dy)*180/Math.PI;if(angle<0)angle+=360;targetLook=Math.round(angle/22.5)%16;if(!cursorInsideSince)cursorInsideSince=performance.now();if(performance.now()-cursorInsideSince>3200&&performance.now()-lastHoverQuote>45000){lastHoverQuote=performance.now();quote('Mouse')}}else{look=targetLook=-1;cursorInsideSince=0}}catch{}finally{cursorBusy=false}
}
function updateCursorTimer(){const enabled=!menuView&&!document.hidden&&!playbackPaused&&!videoRequested();if(!enabled&&cursorTimer){clearInterval(cursorTimer);cursorTimer=null;}else if(enabled&&!cursorTimer)cursorTimer=setInterval(pollCursor,120);}
updateCursorTimer();
function refreshVoiceCatalog(){return call('catalog').then(catalog=>{voiceFiles=(catalog?.voices||[]).filter(name=>/^[A-Za-z0-9_-]+\.ogg$/.test(name));lastVoice=-1;if(!menu.hidden)renderMenu()}).catch(()=>{});}
composer.addEventListener('pointerenter',()=>{dockHover=true;stopWalk();updateDock()});composer.addEventListener('pointerleave',()=>{dockHover=false;updateDock()});composer.addEventListener('focusin',()=>{dockFocus=true;updateDock()});composer.addEventListener('focusout',event=>{if(!composer.contains(event.relatedTarget)){dockFocus=false;updateDock()}});function focusDockInput(){composer.classList.add('expanded');input.focus()}expandButton.addEventListener('click',focusDockInput);expandButton.addEventListener('focus',focusDockInput);
composer.addEventListener('submit',submitChat);input.addEventListener('input',renderChat);input.addEventListener('compositionstart',()=>{composing=true});input.addEventListener('compositionend',()=>{composing=false});input.addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.isComposing||composing||event.keyCode===229))event.preventDefault();});
cameraButton.addEventListener('click',()=>{if(visionActive){call('vision-stop').catch(showError);return;}chatStatus.textContent='在独立视觉面板选择屏幕或摄像头；确认前不采集、不发送。';chatStatus.hidden=false;call('vision-open').catch(showError);});
window.addEventListener('blur',()=>{if(down||dragging){clearDragFrame();down=null;dragging=false;safely('drag-cancel');play('idle');}});
document.addEventListener?.('visibilitychange',()=>{if(document.hidden){stopWalk();play('idle');}updateVideoState();refreshDrawLoop();updateCursorTimer();});
window.addEventListener('beforeunload',()=>{disposed=true;clearDragFrame();if(drawRequest)window.cancelAnimationFrame?.(drawRequest);drawRequest=0;videoGeneration++;videoController?.abort();videoPreview?.dispose();clearTimeout(dockTimer);clearInterval(cursorTimer);motionPreference.removeEventListener('change',resetMotion);stopAudio();if(down||dragging)safely('drag-cancel');});
if(menuView)document.body.classList.add('menu-window');
refreshVoiceCatalog();renderChat();safely('ready');if(!menuView)scheduleDraw();
