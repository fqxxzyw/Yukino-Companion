import {renders} from './wardrobe-media.mjs?v=wardrobe-cache-15';
import {afterHero,isDataConstrained} from './media-warm.mjs?v=14';
import {createWardrobeCache} from './wardrobe-cache.mjs?v=wardrobe-parallel-16';

const section = document.querySelector('#characters');
if (section) setupWardrobe(section);

function setupWardrobe(section) {
  const assets=createWardrobeCache();
  const splitPositions=new Map();
  const cards = [...section.querySelectorAll('[data-v2-outfit]')];
  const byId = cards.map((card, i) => card.dataset.v2Id || ['04','05','06','07','08','09','01','02','03'][i]);
  const $ = (name) => section.querySelector(`[data-v2-${name}]`);
  const figure = $('figure');
  let still = $('figure-img'), video = $('spin-video');
  const caption = $('figure-caption'), ringName = $('outfit-name'), rotate = $('rotate'), picker=$('outfit-picker');
  const wipe = $('wipe'), wipeOriginal = $('wipe-original'), wipeCel = $('wipe-cel');
  const range = $('wipe-range'), ring = $('ring'), status=$('wardrobe-status');
  if (ring && wipe.parentElement !== ring) ring.append(wipe);
  // Old snapshots can still be loaded with this module. Remove obsolete actions.
  $('wipe-toggle')?.remove();
  $('spin-button')?.remove();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const icons = {
    pause: '<path d="M9 5H6v14h3zm9 0h-3v14h3z" fill="currentColor" stroke="none"/>',
    play: '<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/>',
  };
  const icon = (name) => `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`;
  let index = 0;
  let visible = false;
  let three = true;
  let rotateEnabled = !reduced.matches;
  let titleEpoch = 0;
  let turnEpoch = 0;
  let playAttempt = 0;
  let completionGuard = 0;
  let bufferController = null;
  let timer = 0;
  let phase = 'waiting';
  let pairReady = false;
  let pairPending = false;
  let hovered = false, comparing = false, splitFrame = 0, pointerX;

  const id = () => byId[index];
  const inView = () => visible && three && !document.hidden;
  const media = () => renders[id()]?.original;
  const comparisonEngaged = () => hovered || comparing || document.activeElement === range || document.activeElement === picker;
  const setPhase = (value) => {
    phase = value;
    figure.dataset.orbitState = value;
  };
  const setSplit = (value) => {
    const n = Math.round(Math.min(100, Math.max(0, Number(value))));
    range.value = String(n);
    range.setAttribute('aria-valuetext', `常规 ${n}%，赛璐璐 ${100 - n}%`);
    wipe.style.setProperty('--wipe-x', `${n}%`);
    splitPositions.set(id(),n);
  };
  function syncWipe() {
    wipe.hidden = !pairReady;
    ring?.toggleAttribute('data-v2-has-pair', pairReady);
  }
  function paintControls() {
    rotate.innerHTML = icon(rotateEnabled ? 'pause' : 'play');
    rotate.setAttribute('aria-label', '自动切换服装');
    rotate.setAttribute('aria-pressed', String(rotateEnabled));
    rotate.title = rotateEnabled ? '暂停' : '继续';
    rotate.disabled = reduced.matches;
  }

  function queueAdvance() {
    clearTimeout(timer);
    if (!rotateEnabled || reduced.matches || !inView() || phase !== 'done' || comparisonEngaged()) return;
    timer = setTimeout(() => {
      if (rotateEnabled && inView() && phase === 'done' && !comparisonEngaged()) select(index + 1);
    }, 3900);
  }
  function cancelPendingBuffer() {
    bufferController?.abort();
    bufferController = null;
    clearTimeout(completionGuard);
  }
  function releaseVideo() {
    video.pause();
    video.preload = 'none';
    if (video.hasAttribute('src')) {
      video.removeAttribute('src');
      video.load();
    }
  }
  function closeOrbit() {
    if (phase === 'done') return;
    playAttempt += 1;
    cancelPendingBuffer();
    setPhase('done');
    figure.classList.remove('is-spinning');
    releaseVideo();
    queueAdvance();
  }
  function suspendOrbit() {
    if (phase !== 'playing' && phase !== 'loading') return;
    playAttempt += 1;
    cancelPendingBuffer();
    setPhase('suspended');
    video.pause();
    video.preload = 'none';
    figure.classList.remove('is-spinning');
  }
  function clearOrbit() {
    playAttempt += 1;
    cancelPendingBuffer();
    clearTimeout(timer);
    setPhase('waiting');
    figure.classList.remove('is-spinning');
    releaseVideo();
  }
  function bufferedBeyondPlayhead() {
    const t = video.currentTime || 0;
    for (let n = 0; n < video.buffered.length; n += 1) {
      if (video.buffered.start(n) <= t + .075 && video.buffered.end(n) >= t) {
        return video.buffered.end(n) - t;
      }
    }
    return 0;
  }
  function readyToStart() {
    const remaining = Number.isFinite(video.duration) ? Math.max(0,video.duration-video.currentTime) : .27;
    return video.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA ||
      (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA && bufferedBeyondPlayhead() + .035 >= Math.min(.27,remaining));
  }
  function warmVideo() {
    const src = media()?.spin;
    if (!src || reduced.matches || document.hidden || !video.canPlayType('video/webm')) return;
    return assets.get(src,0);
  }
  function bindSource(clip,source) {
    if(clip.getAttribute('src')===source)return;
    clip.preload='auto'; clip.loop=false; clip.muted=true;
    clip.src=source;
  }
  function waitForBuffer(signal) {
    if (readyToStart()) return Promise.resolve(true);
    const clip=video;
    return new Promise((resolve) => {
      let settled = false;
      let timeout;
      const events = ['loadeddata','canplay','progress','canplaythrough'];
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        for (const event of events) clip.removeEventListener(event, check);
        clip.removeEventListener('error', cancel);
        signal.removeEventListener('abort', cancel);
        resolve(value);
      };
      const check = () => { if (video === clip && readyToStart()) finish(true); };
      const cancel = () => finish(false);
      timeout = setTimeout(() => finish(clip.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA), 3600);
      for (const event of events) clip.addEventListener(event, check);
      clip.addEventListener('error', cancel, {once:true});
      signal.addEventListener('abort', cancel, {once:true});
      if (signal.aborted) cancel(); else check();
    });
  }
  function displayFrame(clip,signal) {
    if (typeof clip.requestVideoFrameCallback !== 'function') return Promise.resolve(clip.readyState >= 2 && clip.videoWidth > 0);
    return new Promise(resolve=>{
      let callback=0, timer=0;
      function finish(ok){
        clip.cancelVideoFrameCallback?.(callback);
        clearTimeout(timer);
        signal.removeEventListener('abort',abort);
        resolve(ok);
      }
      const abort=()=>finish(false);
      callback=clip.requestVideoFrameCallback(()=>finish(clip.videoWidth>0));
      timer=setTimeout(abort,1700);
      signal.addEventListener('abort',abort,{once:true});
    });
  }
  async function startOrbit() {
    if (!inView() || (phase !== 'waiting' && phase !== 'suspended')) return;
    const src = media()?.spin, clip = video;
    if (!src || reduced.matches || !clip.canPlayType('video/webm')) { closeOrbit(); return; }
    const epoch = turnEpoch, attempt = ++playAttempt;
    const current=()=>video===clip && turnEpoch===epoch && playAttempt===attempt && inView();
    const controller = new AbortController();
    bufferController = controller;
    setPhase('loading');
    let source=assets.peek(src) || await assets.get(src,2) || src;
    if(!current())return;
    bindSource(clip,source);
    let prepared = await waitForBuffer(controller.signal);
    if(!current())return;
    if(!prepared && source!==src){
      source=src;
      bindSource(clip,source);
      prepared=await waitForBuffer(controller.signal);
    }
    if(!current())return;
    if(!prepared){closeOrbit();return;}
    completionGuard = setTimeout(() => { if (current()) closeOrbit(); }, 6500);
    try {
      if (Number.isFinite(clip.duration)) clip.playbackRate = Math.min(1.16,Math.max(1,clip.duration/2.15));
      const firstFrame=displayFrame(clip,controller.signal);
      await clip.play();
      const painted=await firstFrame;
      if (!current()) return;
      if(!painted || new URL(source,location.href).href!==clip.currentSrc){closeOrbit();return;}
      figure.classList.add('is-spinning');
      setPhase('playing');
    } catch {
      if (current()) closeOrbit();
    }
  }
  function bindVideo(clip) {
    clip.addEventListener('ended', () => {
      if (clip===video && clip.ended && (phase === 'loading' || phase === 'playing' || phase === 'suspended')) closeOrbit();
    });
    clip.addEventListener('error', () => {
      if (clip===video && clip.error && phase === 'playing') closeOrbit();
    });
  }
  bindVideo(video);

  function configurePair() {
    ++titleEpoch;
    pairReady = pairPending = hovered = comparing = false;
    setSplit(splitPositions.get(id()) ?? 50);
    cancelAnimationFrame(splitFrame);splitFrame=0;
    wipeOriginal.removeAttribute('src');
    wipeCel.removeAttribute('src');
    syncWipe();
  }
  function preparePair(current, priority = 'high') {
    const pair = renders[current]?.compare;
    const epoch = titleEpoch;
    if (!pair || pairReady) return;
    const urls=[pair.original,pair.toon];
    const rank=priority==='high' ? 3 : priority==='auto' ? 2 : 0;
    const work=urls.map(url=>assets.get(url,rank));
    if (pairPending) return;
    pairPending=true;
    // One matching, static pair in the right card; reuse each encoded pair
    // during this page visit without retaining all 18 decoded images.
    const load=async(img,url,local)=>{
      img.src=local||url;
      try{await img.decode();}
      catch(error){if(!local||titleEpoch!==epoch)throw error;img.src=url;await img.decode();}
    };
    Promise.all(work).then(async ([original,toon]) => {
      if (titleEpoch !== epoch) return;
      await Promise.all([load(wipeOriginal,pair.original,original),load(wipeCel,pair.toon,toon)]);
      if (titleEpoch !== epoch) return;
      pairReady = true;
      pairPending = false;
      syncWipe();
    }).catch(() => {if(titleEpoch===epoch){pairPending=false;syncWipe();}});
  }
  function updatePoster(src, fallback, thumb, name) {
    if (still.dataset.wardrobeSource !== src) {
      const next=still.cloneNode(false);next.removeAttribute('src');
      next.dataset.wardrobeSource=src;
      next.loading='eager';
      still.replaceWith(next);still=next;
      next.addEventListener('error',()=>{
        if(next!==still)return;
        if(next.getAttribute('src')?.startsWith('blob:')){next.src=src;return;}
        if(next.getAttribute('src')!==fallback){next.src=fallback;return;}
        if(status)status.textContent='这套服装图片暂未载入。';
      });
      const cached=assets.peek(src);
      next.src=cached || thumb || fallback;
      if(!cached)void assets.get(src,2).then(source=>{
        if(next===still)next.src=source||src;
      });
    }
    still.alt = `${name}全身模型`;
  }
  function paint() {
    const current = id();
    const name = cards[index].dataset.v2Outfit;
    const fallback = '/assets/outfits/cutout-'+current+'.png';
    const hasPair=Boolean(renders[current]?.compare);
    // The current card is not a thumbnail. Keep its background until both
    // high-quality layers are ready; the movie never owns this state.
    ring?.toggleAttribute('data-v2-pair-expected',hasPair);
    configurePair();
    if (inView()) preparePair(current);
    if(status)status.textContent='';
    updatePoster(media()?.still || fallback, fallback, media()?.thumb, name);
    figure.dataset.activeOutfit = current;
    figure.dataset.material = 'original';
    if (caption) caption.textContent = name;
    ringName.textContent = name;
    if (picker) picker.value=current;
    for (const [i, card] of cards.entries()) {
      const position = ((i - index + cards.length + 4) % cards.length) - 4;
      card.dataset.ringPosition = String(position);
      card.setAttribute('aria-label',card.dataset.v2Outfit);
      card.setAttribute('aria-pressed', String(i === index));
      card.tabIndex = Math.abs(position) <= 2 ? 0 : -1;
      card.toggleAttribute('inert', Math.abs(position) > 2);
      const rendition = renders[byId[i]]?.original;
      const cardSrc = i === index
        ? (hasPair ? null : rendition?.cardStill || rendition?.still)
        : rendition?.thumb || rendition?.still;
      const cardImg = card.querySelector('img');
      if (cardImg && cardSrc && cardImg.getAttribute('src') !== cardSrc) cardImg.src=cardSrc;
      else if (cardImg && !cardSrc) cardImg.removeAttribute('src');
    }
  }
  function select(next) {
    const normalized = (next + cards.length) % cards.length;
    if (normalized === index) return;
    turnEpoch += 1;
    clearOrbit();
    // A fresh element cannot present a stale decoder frame during a rapid outfit change.
    const nextClip=video.cloneNode(false);
    video.replaceWith(nextClip);video=nextClip;bindVideo(video);
    index = normalized;
    paint();
    if (inView()) void startOrbit();
  }
  function chooseByHand(next) {
    if(next<0) return;
    if(rotateEnabled){ rotateEnabled=false; clearTimeout(timer); paintControls(); }
    select(next);
  }
  picker?.addEventListener('change',()=>{const target=byId.indexOf(picker.value);if(target>=0)chooseByHand(target);});
  function viewportChanged() {
    if (!inView()) {
      hovered = false;
      clearTimeout(timer);
      suspendOrbit();
      syncWipe();
      return;
    }
    preparePair(id());
    if (phase === 'waiting' || phase === 'suspended') void startOrbit();
    else queueAdvance();
  }

  rotate.addEventListener('click', () => {
    rotateEnabled = !rotateEnabled;
    paintControls();
    queueAdvance();
  });
  // Native range provides drag, touch and keyboard interaction in-place.
  wipe.addEventListener('pointerenter', (event) => {
    if (event.pointerType !== 'mouse') return;
    hovered = true;
    queueAdvance();
  });
  wipe.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse' || comparing || !pairReady) return;
    pointerX=event.clientX;
    if(splitFrame)return;
    splitFrame=requestAnimationFrame(()=>{
      splitFrame=0;
      if(!pairReady || comparing || !hovered)return;
      const rect=wipe.getBoundingClientRect();
      if(rect.width>0)setSplit(100*(pointerX-rect.left)/rect.width);
    });
  });
  wipe.addEventListener('pointerleave', () => {
    hovered = false;
    queueAdvance();
  });
  range.addEventListener('pointerdown', () => { comparing = true; queueAdvance(); });
  for (const event of ['pointerup','pointercancel','lostpointercapture']) {
    range.addEventListener(event, () => { comparing = false; queueAdvance(); });
  }
  range.addEventListener('input', () => setSplit(range.value));
  range.addEventListener('focus', queueAdvance);
  range.addEventListener('blur', () => queueMicrotask(queueAdvance));
  picker?.addEventListener('focus', queueAdvance);
  picker?.addEventListener('blur', () => queueMicrotask(queueAdvance));
  for (const [i, card] of cards.entries()) {

    card.addEventListener('click', () => chooseByHand(i));
  }
  for (const button of section.querySelectorAll('[data-v2-outfit-step]')) {
    button.addEventListener('click', () => chooseByHand((index + Number(button.dataset.v2OutfitStep) + cards.length) % cards.length));
  }
  for (const tab of section.querySelectorAll('[data-v2-tab]')) {
    tab.addEventListener('click', () => {
      three = tab.dataset.v2Tab === 'three';
      viewportChanged();
    });
  }
  new IntersectionObserver(([entry]) => {
    const next = entry.isIntersecting && entry.intersectionRatio >= .34;
    if (visible !== next) { visible = next; viewportChanged(); }
  }, {threshold: [.34]}).observe(figure);
  const prefetch=new IntersectionObserver(([entry])=>{
    if(!entry.isIntersecting)return;
    preparePair(id(), 'auto');
    if (!isDataConstrained() && !inView()) void warmVideo();
    prefetch.disconnect();
  },{rootMargin:'950px 0px'});
  prefetch.observe(figure);
  document.addEventListener('visibilitychange', viewportChanged);
  reduced.addEventListener('change', () => {
    if (reduced.matches) {
      rotateEnabled = false;
      closeOrbit();
    }
    paintControls();
    queueAdvance();
  });
  still.dataset.wardrobeSource=media()?.still || '';
  paint();
  paintControls();
  void afterHero.then(() => {
    if (location.pathname !== '/' || isDataConstrained()) return;
    const first = id();
    preparePair(first, 'low');
    if (!inView()) void warmVideo();
  });
}
