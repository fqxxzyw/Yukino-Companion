'use strict';
const api=window.companion,canvas=document.getElementById('pet'),ctx=canvas.getContext('2d',{willReadFrequently:true});
const bubble=document.getElementById('bubble'),zh=document.getElementById('zh'),ja=document.getElementById('ja'),model=document.getElementById('model');
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
let settings={animation:true,bubbleLanguage:'zh',scale:1,opacity:1,showBubbles:true,soundEnabled:true,soundVolume:.35},kind='pet',startupAvailable=false;
let dragging=false,down=null,clicks=[],lastMove=0,lastHit=true,clip=clips.idle,frame=0,nextFrame=0,clipName='idle';
let wander=null,nextDecision=performance.now()+8000,sitUntil=0,remoteReply=null,localQuote=null,localQuoteUntil=0,lastReply='',lastSettings='',focus={active:false};
let voiceFiles=[],audio=null,lastVoice=-1,nextVoice=performance.now()+30000,nextQuote=performance.now()+60000,nextNight=performance.now()+1200000,lastHoverQuote=0;
let look=-1,targetLook=-1,nextLook=0,cursorInsideSince=0,cursorBusy=false,initialized=false;
const images={};for(const [key,file] of Object.entries({base:'spritesheet.png',left:'walking-left.png',right:'walking-right.png'})){const image=new Image();image.src=`assets/${file}`;images[key]=image;}
function call(action,payload){return api?api.call(action,payload):Promise.resolve(false)}
function safely(action,payload){return call(action,payload).catch(error=>{console.warn('桌宠操作未完成',error.message);return false})}
function play(name){clipName=name;clip=clips[name]||clips.idle;frame=0;nextFrame=0;targetLook=look=-1;}
function stopWalk(){wander=null;nextDecision=performance.now()+8000+Math.random()*11000;}
function canAutoplay(){return settings.animation&&!settings.interactionPaused&&!settings.quietMode&&!focus.active&&!dragging&&!down&&menu.hidden;}
function showError(error){menuError.textContent=String(error?.message||error||'桌宠操作未完成');menuError.hidden=false;}
function stopAudio(){if(audio){audio.pause();audio.src='';audio=null;}}
async function playVoice(manual=false){
 if((!manual&&(!settings.soundEnabled||settings.quietMode||focus.active))||(!manual&&audio&&!audio.paused))return;
 if(!voiceFiles.length){if(manual)showError('桌宠预录语音库尚未准备，请重新安装包含桌宠素材的版本。');return;}
 let next=Math.floor(Math.random()*voiceFiles.length);if(voiceFiles.length>1&&next===lastVoice)next=(next+1)%voiceFiles.length;lastVoice=next;
 stopAudio();audio=new Audio(`assets/voices/${voiceFiles[next]}`);audio.volume=settings.soundVolume;
 try{await audio.play()}catch(error){stopAudio();if(manual)showError('声音暂时无法播放，请检查系统输出设备。');}
 nextVoice=performance.now()+45000+Math.random()*45000;
}
function renderBubble(){
 if(!settings.showBubbles||settings.quietMode){bubble.hidden=true;return;}
 if(localQuote){zh.textContent=localQuote;ja.textContent='';bubble.hidden=false;return;}
 if(!remoteReply||(!remoteReply.zh&&!remoteReply.ja)){bubble.hidden=true;return;}
 zh.textContent=settings.bubbleLanguage==='ja'?'':remoteReply.zh;
 ja.textContent=settings.bubbleLanguage==='zh'?'':(remoteReply.ja||'日语翻译尚未完成');bubble.hidden=false;
}
async function quote(trigger,action=clipName){
 if(!settings.showBubbles||settings.quietMode)return false;
 const entry=await safely('quote',{trigger,action});if(!entry?.Text)return false;
 localQuote=entry.Text;localQuoteUntil=performance.now()+Math.min(18000,Math.max(5000,entry.Text.length*180));renderBubble();return true;
}
function startWalk(manual=false){
 if(!settings.animation||settings.interactionPaused||focus.active||settings.quietMode)return;
 localQuote=null;bubble.hidden=true;sitUntil=0;const angle=Math.random()*Math.PI*2;
 wander={x:Math.cos(angle),y:Math.sin(angle)*.45,until:performance.now()+(manual?9000:4500)+Math.random()*4500,next:0};play(wander.x<0?'walk-left':'walk-right');
}
function act(name){
 if(name==='menu'){openMenu();return;}
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
 let section=group('和她互动');actionButton(section,'打开聊天',()=>{closeMenu();return call('open-main')},'primary');
 if(kind==='pet'){
  const grid=document.createElement('div');grid.className='menu-grid';section.append(grid);
  for(const [name,label]of[['greet','打个招呼'],['head-tilt','歪头看看'],['jump','原地跳一下'],['walk','安静地散步'],['sit','坐下来休息'],['voice','随机试听语音']])actionButton(grid,label,()=>{closeMenu();return call('action',name)});
  section=group('日常陪伴');toggle(section,'播放动画','animation');toggle(section,'暂停互动','interactionPaused');toggle(section,'安静模式','quietMode');
  section=group('语录与提醒');toggle(section,'随机语录','randomQuotes');toggle(section,'互动语录','interactionQuotes');toggle(section,'深夜提醒','nightReminders');toggle(section,'显示气泡','showBubbles');
  const note=document.createElement('p');note.className='menu-note';note.textContent='原桌宠语录为中文；聊天回复使用你选择的气泡语言。';section.append(note);
  section=group('桌宠预录语音');toggle(section,'播放预录语音','soundEnabled');range(section,'音量','soundVolume',0,1,.05);const count=document.createElement('p');count.className='menu-note';count.textContent=`已准备 ${voiceFiles.length} 条。与 GPT-SoVITS 朗读分别设置。`;section.append(count);
  section=group('专注计时');if(focus.active)actionButton(section,'取消本次专注',()=>call('action','focus-cancel'));else for(const minutes of[25,50])actionButton(section,`${minutes} 分钟`,()=>{closeMenu();return call('action',`focus-${minutes}`)});
 }
 section=group('展示与启动');range(section,'形象大小','scale',.6,2,.05);range(section,'透明度','opacity',.35,1,.05);toggle(section,'总在最前','alwaysOnTop');const startup=toggle(section,'开机启动','startup');startup.disabled=!startupAvailable;
 section=group('更多');actionButton(section,'打开完整设置',()=>{closeMenu();return call('settings')});actionButton(section,'隐藏到托盘',()=>{closeMenu();return call('hide')});actionButton(section,'完全退出',()=>call('quit'),'danger');menuBody.scrollTop=scroll;
}
function openMenu(){stopWalk();if(!dragging)play('idle');menuError.hidden=true;menu.hidden=false;document.body.classList.add('menu-active');safely('hit-test',true);renderMenu();document.getElementById('menu-close').focus();}
function closeMenu(){menu.hidden=true;document.body.classList.remove('menu-active');nextDecision=performance.now()+12000;canvas.focus();}
function draw(time){
 if(localQuote&&time>localQuoteUntil){localQuote=null;renderBubble();}
 if(kind==='pet'&&images.base.complete&&images.base.naturalWidth){
  if(canAutoplay()){
   if(sitUntil&&time>sitUntil){sitUntil=0;play('idle');}
   if(!wander&&!sitUntil&&clipName==='idle'&&bubble.hidden&&time>nextDecision){nextDecision=time+8000+Math.random()*11000;const roll=Math.random();if(roll<.24)startWalk();else if(roll<.4)play('head-tilt');}
   if(time>nextQuote){nextQuote=time+50000+Math.random()*60000;if(settings.randomQuotes&&!wander)quote('Idle');}
   if(time>nextVoice&&bubble.hidden&&!wander&&!sitUntil)playVoice();
   const hour=new Date().getHours();if(settings.nightReminders&&(hour>=23||hour<6)&&time>nextNight){nextNight=time+65*60000;quote('Night');}
  }
  if(wander){if(!canAutoplay()||time>wander.until){stopWalk();play('idle');}else if(time>wander.next){wander.next=time+100;safely('walk-step',{x:wander.x,y:wander.y}).then(moved=>{if(moved===false){stopWalk();play('idle')}});}}
  if(!nextFrame)nextFrame=time+clip.durations[frame];
  if(settings.animation&&time>=nextFrame){frame++;if(frame>=clip.count){if(clip.loop)frame=0;else{clip=clips.idle;clipName='idle';frame=0;}}nextFrame=time+(frame===0&&clipName==='idle'?3000+Math.random()*5000:clip.durations[frame]);}
  let row=clip.row,col=(clip.start||0)+frame;
  if(settings.animation&&clipName==='idle'&&targetLook>=0&&time>nextLook){nextLook=time+75;if(look<0)look=targetLook;else if(look!==targetLook)look=(look+(((targetLook-look+16)%16)<=8?1:15))%16;}
  if(clipName==='idle'&&look>=0){row=look<8?9:10;col=look%8;}
  const image=images[clip.sheet||'base'];if(image.complete&&image.naturalWidth){ctx.clearRect(0,0,192,208);ctx.drawImage(image,col*192,row*208,192,208,0,0,192,208);}
 }
 requestAnimationFrame(draw);
}
api?.onState(state=>{
 kind=state.kind;settings=state.preferences;startupAvailable=!!state.startupAvailable;focus=state.focus||{active:false};
 document.documentElement.style.setProperty('--scale',settings.scale);document.documentElement.style.setProperty('--pet-opacity',settings.opacity??1);
 canvas.hidden=kind!=='pet';model.hidden=kind!=='model';bubble.style.bottom=`${(kind==='model'?300:216)*settings.scale}px`;
 if(!settings.animation||settings.interactionPaused||settings.quietMode||focus.active){stopWalk();sitUntil=0;if(!dragging)play('idle');}
 if(!settings.soundEnabled||settings.quietMode||focus.active)stopAudio();else if(audio)audio.volume=settings.soundVolume;
 if(state.reply?.id!==lastReply){lastReply=state.reply?.id||'';remoteReply=state.reply;localQuote=null;if(remoteReply&&!dragging){stopWalk();play('wave')}}else remoteReply=state.reply;
 renderBubble();focusBadge.hidden=!focus.active;focusBadge.textContent=focus.active?`专注 ${Math.ceil(focus.remainingMs/60000)} 分钟` :'';
 const signature=JSON.stringify(settings);if(signature!==lastSettings&&!menu.hidden)renderMenu();lastSettings=signature;
 if(!initialized){initialized=true;if(kind==='pet')quote('Greeting');}
});
api?.onAction(({name})=>act(name));
function hitTest(event){
 if(dragging||!menu.hidden||event.target.closest('button,.bubble,.model'))return true;
 const box=canvas.getBoundingClientRect(),x=Math.floor((event.clientX-box.left)*192/box.width),y=Math.floor((event.clientY-box.top)*208/box.height);
 return !canvas.hidden&&x>=0&&x<192&&y>=0&&y<208&&ctx.getImageData(x,y,1,1).data[3]>15;
}
window.addEventListener('pointermove',event=>{
 if(down){
  const dx=event.screenX-down.x,dy=event.screenY-down.y,distance=Math.hypot(dx,dy);
  if(down.head&&!dragging){const movement=event.screenX-down.lastX,direction=Math.abs(movement)>=2?Math.sign(movement):0;if(direction&&down.direction&&direction!==down.direction&&Math.abs(dy)<22)down.reversals++;if(direction)down.direction=direction;down.lastX=event.screenX;if(down.reversals>=3&&performance.now()-down.time>=550){down.patted=true;play('waiting')}if(!down.patted&&(Math.abs(dy)>28||distance>46))down.head=false;}
  if(!down.head&&!down.patted&&distance>7){if(!dragging){dragging=true;localQuote=null;bubble.hidden=true;play('lifted')}if(performance.now()-lastMove>16){lastMove=performance.now();safely('drag-move')}}
 }
 const hit=hitTest(event);if(hit!==lastHit){lastHit=hit;safely('hit-test',hit)}
});
for(const target of[canvas,model]){
 target.addEventListener('pointerdown',event=>{if(event.button!==0||event.target.closest('button')||settings.interactionPaused||!menu.hidden)return;const box=canvas.getBoundingClientRect();down={x:event.screenX,y:event.screenY,time:performance.now(),head:kind==='pet'&&(event.clientY-box.top)<box.height*.42,lastX:event.screenX,direction:0,reversals:0,patted:false};stopWalk();target.setPointerCapture(event.pointerId);safely('drag-start')});
 target.addEventListener('pointerup',event=>{if(!down)return;const previous=down;down=null;safely('drag-end');if(target.hasPointerCapture?.(event.pointerId))target.releasePointerCapture(event.pointerId);if(dragging){dragging=false;play('landing')}else if(previous.patted){play('head-tilt');quote('HeadPat');playVoice()}else{clicks=clicks.filter(time=>performance.now()-time<4500);clicks.push(performance.now());if(clicks.length>=7){play('annoyed');quote('Annoyed');clicks=[]}else if(clicks.length>=4){play('head-tilt');quote('Click')}else{play('wave');if(Math.random()<.35)quote('Click')}playVoice()}});
 target.addEventListener('pointercancel',()=>{safely('drag-end');down=null;dragging=false;play('idle')});
 target.addEventListener('contextmenu',event=>{event.preventDefault();openMenu()});target.addEventListener('dblclick',()=>safely('open-main'));
}
canvas.addEventListener('keydown',event=>{if(event.key==='Enter')safely('open-main');if(event.key==='ContextMenu'||event.key===' '){event.preventDefault();openMenu()}});
window.addEventListener('keydown',event=>{if(menu.hidden)return;if(event.key==='Escape'){event.preventDefault();closeMenu()}if(event.key==='Tab'){const items=[...menu.querySelectorAll('button:not(:disabled),input:not(:disabled)')].filter(el=>el.getClientRects().length),first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}});
document.getElementById('menu-close').addEventListener('click',closeMenu);document.getElementById('model-open').addEventListener('click',()=>safely('open-main'));
setInterval(async()=>{
 if(cursorBusy||kind!=='pet'||!canAutoplay()||clipName!=='idle'){look=targetLook=-1;cursorInsideSince=0;return;}
 cursorBusy=true;try{const point=await call('cursor');if(!point)return;const box=canvas.getBoundingClientRect(),dx=point.x-(box.x+box.width/2),dy=point.y-(box.y+box.height*.38);if(Math.hypot(dx,dy)<210*settings.scale){let angle=Math.atan2(dx,-dy)*180/Math.PI;if(angle<0)angle+=360;targetLook=Math.round(angle/22.5)%16;if(!cursorInsideSince)cursorInsideSince=performance.now();if(performance.now()-cursorInsideSince>3200&&performance.now()-lastHoverQuote>45000){lastHoverQuote=performance.now();quote('Mouse')}}else{look=targetLook=-1;cursorInsideSince=0}}catch{}finally{cursorBusy=false}
},120);
call('catalog').then(catalog=>{voiceFiles=(catalog?.voices||[]).filter(name=>/^[A-Za-z0-9_-]+\.ogg$/.test(name));if(!menu.hidden)renderMenu()}).catch(()=>{});
safely('ready');requestAnimationFrame(draw);
