import {solarClips} from './scene-solar.mjs?v=full-native-solar-27';
import {getSceneMedia} from './scene-media-preload.mjs?v=19';
import {isDataConstrained} from './media-warm.mjs?v=14';

export function createSolarPlayback(onChange) {
  const video = document.createElement('video');
  video.className = 'scene-poster-paint scene-solar-video';
  video.setAttribute('aria-hidden','true');
  video.setAttribute('disablepictureinpicture','');
  video.muted = true;
  video.playsInline = true;
  const positions = new Map();
  const unableHD = new Set();
  let key, config, layer, target, usable = false, rejected = false, remembered = 0;
  let playRequested = false, blobURL, sourceGeneration=0;
  let primed=false, movingFrame=false, frameWatch=0;

  function clear() {
    video.pause();
    if (key && movingFrame && !video.seeking) {
      const t=video.currentTime;
      // Returning to a scene after the whole clip ended plays a fresh cycle.
      // A short nudge at its edge still preserves the in-progress time.
      if (video.ended || Number.isFinite(video.duration) && t >= video.duration-.12) positions.delete(key);
      else if (t>.04) positions.set(key,t);
    }
    if(frameWatch&&video.cancelVideoFrameCallback)video.cancelVideoFrameCallback(frameWatch);
    frameWatch=0;
    primed=movingFrame=false;
    video.remove();
    video.removeAttribute('src');
    video.load();
    ++sourceGeneration;
    if(blobURL)URL.revokeObjectURL(blobURL);
    blobURL=undefined;
    video.classList.remove('is-painted');
    key = config = layer = target = undefined;
    usable = rejected = playRequested = false; remembered = 0;
  }

  function variant(id,aspect) {
    const fit=aspect==='wide' && solarClips[id]?.wideHD && !unableHD.has(id) &&
      innerWidth*(devicePixelRatio||1)>=850 && !isDataConstrained();
    return fit ? 'wideHD' : aspect;
  }

  function source(id,aspect){
    const clip=solarClips[id]?.[variant(id,aspect)]||solarClips[id]?.[aspect];
    return clip&&video.canPlayType('video/mp4')?'/assets/scenes-native/'+clip[0]+'.mp4':null;
  }

  function choose(id, aspect, preload) {
    const encoding=variant(id,aspect);
    if (rejected && key === id+':'+encoding) return false;
    const clip = solarClips[id]?.[encoding] || solarClips[id]?.[aspect];
    if (!clip || !video.canPlayType('video/mp4')) {
      if (key) clear();
      return false;
    }
    const nextKey = id+':'+encoding;
    if (key === nextKey) {
      if (preload === 'auto') video.preload = 'auto';
      return true;
    }
    if (key) clear();
    key = nextKey;
    config = clip;
    remembered = positions.get(key) || 0;
    video.preload = preload;
    const path='/assets/scenes-native/'+clip[0]+'.mp4';
    const generation=++sourceGeneration;
    if(isDataConstrained())video.src=path;
    else void getSceneMedia(path,'high').then(blob=>{
      if(generation!==sourceGeneration)return;
      if(blob)blobURL=URL.createObjectURL(blob);
      video.src=blobURL||path;
      onChange();
    });
    return true;
  }

  function sync(id, aspect, nextLayer) {
    if (!choose(id,aspect,'auto')) return;
    if (layer !== nextLayer || video.parentNode !== nextLayer) nextLayer.append(video);
    layer = nextLayer; target = key;
    if (movingFrame&&!video.seeking&&video.readyState>=2) show();
    if (primed&&!video.ended&&video.paused&&!video.seeking&&!playRequested&&video.readyState>=3) {
      playRequested = true;
      const original = key;
      void video.play().catch(() => {}).finally(() => {if(key===original)playRequested=false;});
    }
  }

  function show() {
    if (!movingFrame || !key || target !== key || !layer || video.readyState < 2 || video.seeking || rejected) return;
    usable = true;
    video.classList.add('is-painted');
  }

  video.addEventListener('loadedmetadata',()=>{
    if(!key||!config||!Number.isFinite(video.duration))return;
    // Native captures have a short static preroll before their time sweep.
    // Skip the held samples, but do not skip the native dawn/night transition.
    const first=Math.min(Math.max(0,video.duration-.08),(Number(config[3])||0)+1/30);
    const point=Math.min(video.duration-.06,Math.max(first,remembered));
    primed=true;
    if(Math.abs(video.currentTime-point)>.015)video.currentTime=point;
    onChange();
  });
  function confirmMovingFrame(){
    if(movingFrame||frameWatch||!primed||!key)return;
    const generation=sourceGeneration;
    const commit=()=>{
      frameWatch=0;
      if(generation!==sourceGeneration||!primed||video.seeking||video.paused)return;
      movingFrame=true;
      show();
      onChange();
    };
    if(video.requestVideoFrameCallback)frameWatch=video.requestVideoFrameCallback(commit);
    else requestAnimationFrame(()=>requestAnimationFrame(commit));
  }
  video.addEventListener('playing',confirmMovingFrame);
  for(const event of ['loadeddata','canplay','seeked','ended']) video.addEventListener(event,()=>{
    if(key&&!rejected)onChange();
  });
  video.addEventListener('error',() => {
    if (!key || !video.error) return;
    rejected = true; usable = false; movingFrame=false;
    if (key.endsWith(':wideHD')) unableHD.add(key.slice(0,-7));
    video.classList.remove('is-painted');
    onChange();
  });

  return {
    sync,
    source,
    warm(id,aspect,priority='low') {
      const next=source(id,aspect);
      if(next&&!isDataConstrained())void getSceneMedia(next,priority);
    },
    pause(id, aspect) {
      video.pause();
      if (id && key !== id+':'+variant(id,aspect)) {
        video.classList.remove('is-painted');
        video.remove();
        layer=undefined;
      }
    },
    clear,
    posterHour(id,aspect,fallback) {
      if (!usable || !config || key !== id+':'+variant(id,aspect)) return fallback;
      const [,start,end,head,tail]=config;
      const progress = Math.min(1,Math.max(0,(video.currentTime-head)/Math.max(.1,video.duration-head-tail)));
      return start+(end-start)*progress;
    }
  };
}
