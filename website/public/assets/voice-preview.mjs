export function bootVoice(doc=document){
  const section=doc.querySelector('#voice');
  const stage=section?.querySelector('.v2-voice-stage');
  const video=stage?.querySelector('[data-voice-video]');
  const audio=stage?.querySelector('[data-voice-fallback]');
  const play=stage?.querySelector('[data-voice-play]');
  const fallback=stage?.querySelector('[data-voice-fallback-play]');
  const status=stage?.querySelector('[data-voice-status]');
  if(!video||!audio||!play||!fallback||!status||stage.dataset.voiceBound)return;
  stage.dataset.voiceBound='true';
  let active=video, wantPlay=0, playing=false, failed=false;
  function refresh(){
    const running=!active.paused&&!active.ended&&playing;
    const resume=active.paused&&!active.ended&&active.currentTime>.05;
    stage.classList.toggle('is-playing',running);
    stage.dataset.voiceMode=active===video?'video':'audio';
    play.setAttribute('aria-pressed',String(active===video&&running));
    fallback.setAttribute('aria-pressed',String(active===audio&&running));
    play.textContent=failed?'重试朗读':active===video&&running?'暂停朗读':active===video&&resume?'继续朗读':'播放朗读';
    fallback.textContent=active===audio&&running?'暂停语音':active===audio&&resume?'继续语音':'仅播放语音';
  }
  function problem(medium){
    if(medium===video){
      failed=true;fallback.hidden=false;
      status.textContent='口型视频暂时无法播放，可以单独听原声。';
    }else status.textContent='原声暂时无法播放，请重试。';
    refresh();
  }
  function toggle(medium){
    if(active===medium&&!medium.paused&&!medium.ended){
      ++wantPlay;medium.pause();return;
    }
    if(active!==medium)active.pause();
    active=medium;playing=false;
    const seq=++wantPlay;
    status.textContent='';
    // Playback is initiated in this click handler, not after an async fetch or
    // a muted autoplay. Mouth frames and Japanese audio use one media clock.
    medium.defaultMuted=false;
    medium.muted=false;
    if(medium.volume!==1)try{medium.volume=1;}catch{}
    if(medium===video&&failed){
      failed=false;video.load();
    }
    if(medium.ended)medium.currentTime=0;
    try{
      Promise.resolve(medium.play()).catch(()=>{
        if(wantPlay===seq&&active===medium)problem(medium);
      });
    }catch{
      if(wantPlay===seq&&active===medium)problem(medium);
    }
    refresh();
  }
  for(const medium of [video,audio]){
    medium.addEventListener('playing',()=>{
      if(active!==medium)return;
      playing=true;status.textContent=medium===audio?'正在播放原声，口型画面未随播。':'';
      refresh();
    });
    for(const event of ['pause','waiting','ended'])medium.addEventListener(event,()=>{
      if(active===medium){playing=false;refresh();}
    });
    medium.addEventListener('error',()=>{
      if(active===medium)problem(medium);
    });
  }
  play.addEventListener('click',()=>toggle(video));
  fallback.addEventListener('click',()=>toggle(audio));
  const pauseOut=()=>{
    ++wantPlay;
    if(!active.paused)active.pause();
  };
  if(typeof IntersectionObserver==='function'){
    const observer=new IntersectionObserver(([entry])=>{
      if(!entry.isIntersecting){pauseOut();return;}
      if(video.preload==='none')video.preload='metadata';
    },{threshold:0});
    observer.observe(stage);
  }
  doc.addEventListener('visibilitychange',()=>{if(doc.hidden)pauseOut();});
  video.controls=false;
  play.hidden=false;
  refresh();
}
if(typeof document!=='undefined'){
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>bootVoice(),{once:true});
  else bootVoice();
}
