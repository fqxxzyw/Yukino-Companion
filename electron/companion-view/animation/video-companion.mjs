import { TransparentVideoPlayer, videoFootprint } from './video-playback.mjs';

export const PREVIEW_ACTIONS = Object.freeze({ idle: 'idle', 'walk-left': 'walk_left', 'walk-right': 'walk_right' });
export const UNSUPPORTED_PREVIEW_ACTIONS = Object.freeze(['greet', 'head-tilt', 'jump', 'sit']);
export function previewClip(name) { return PREVIEW_ACTIONS[name] ?? 'idle'; }

// Only decoded-media progress contributes travel. Wall time detects a suspended
// renderer; it is never used as a substitute movement clock.
export class MediaGaitClock {
  reset() { this.previous = null; }
  step(snapshot, now, durationMs) {
    const current = { id: snapshot.clipId, media: snapshot.mediaTimeMs, now };
    const prior = this.previous; this.previous = current;
    if (snapshot.mode !== 'video' || snapshot.paused || snapshot.fading || !['walk_left', 'walk_right'].includes(current.id) || !Number.isFinite(current.media) || !Number.isFinite(now) || !prior || prior.id !== current.id || now - prior.now > 250 || now < prior.now) return 0;
    let delta = current.media - prior.media;
    if (delta < 0 && prior.media > durationMs - 250 && current.media < 250) delta += durationMs;
    return delta >= 0 && delta <= 100 ? delta : 0;
  }
}

function loadPoster(src, { document, signal, timeoutMs = 5000 }) {
  return new Promise((resolve, reject) => {
    const image = document.createElement('img'); let timer;
    const clean = () => { clearTimeout(timer); image.onload = image.onerror = null; signal?.removeEventListener('abort', abort); };
    const failed = message => { clean(); image.removeAttribute('src'); reject(Error(message)); };
    const abort = () => failed('动画预览已取消');
    image.onload = () => { clean(); if (signal?.aborted) return abort(); resolve(image); };
    image.onerror = () => failed('连续动画的静态回退帧无法加载');
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) return abort();
    timer = setTimeout(() => failed('连续动画的静态回退帧加载超时'), timeoutMs);
    image.src = src;
  });
}

export async function createVideoCompanion(options) {
  const document = options.document ?? options.canvas.ownerDocument;
  const poster = await loadPoster(options.pack.posterURL, { document, signal: options.signal });
  if (options.signal?.aborted) throw Error('动画预览已取消');
  if (poster.naturalWidth !== 640 || poster.naturalHeight !== 640) throw Error('连续动画静态帧尺寸不匹配');
  return new VideoCompanion({ ...options, document, poster });
}

export class VideoCompanion {
  constructor({ container, canvas, pack, poster, document, onPresentation = () => {}, onError = () => {}, Player = TransparentVideoPlayer }) {
    Object.assign(this, { container, canvas, pack, poster, document, onPresentation, onError });
    this.clock = new MediaGaitClock(); this.scale = 1; this.disposed = false; this.failed = false; this.ready = true; this.signature = '';
    this.context = canvas.getContext('2d', { willReadFrequently: true });
    this.probe = document.createElement('canvas'); this.probe.width = this.probe.height = 1; this.probeContext = this.probe.getContext('2d', { willReadFrequently: true });
    // Different idle/walk camera directions have no authored turn clip. Do not
    // overlay two silhouettes and pretend a cross-fade is a genuine turn.
    this.player = new Player({ container, document, manifest: pack.manifest, registration: { allowedAssetURLs: pack.allowedAssetURLs }, placement: this.placement(), fadeMs: 0, reducedMotion: false, mediaQuery: null,
      onState: state => this.present(state), onError: error => this.fail(error.code) });
  }
  placement(scale = this.scale) { return { subjectHeight: 198 * scale, footX: 95.5 * scale, footY: 203 * scale }; }
  present(state) {
    if (this.disposed || this.failed) return;
    if (state.mode === 'sprite' && !['initial', 'reduced-motion'].includes(state.reason)) { this.fail(state.reason); return; }
    const video = state.mode === 'video';
    this.presentation = video ? 'video' : 'poster';
    // Keep the preparation layer in layout: hidden/display:none can suppress
    // requestVideoFrameCallback. Unready videos themselves have opacity zero.
    this.container.hidden = false; this.canvas.classList.toggle('video-active', video);
    if (!video) {
      const idle = this.pack.manifest.clips.find(clip => clip.id === 'idle');
      const rectangle = videoFootprint(idle, this.placement(1));
      this.context.clearRect(0, 0, 192, 208);
      this.context.drawImage(this.poster, rectangle.left, rectangle.top, rectangle.width, rectangle.height);
    }
    this.onPresentation(video ? 'video' : 'poster');
  }
  fail(reason) {
    if (this.failed || this.disposed) return;
    this.failed = true; this.clock.reset(); this.container.hidden = true; this.canvas.classList.remove('video-active');
    this.player?.dispose(); this.onPresentation('sprite');
    this.onError(`连续动画预览不可用，已回到原 Q 版（${reason || '资源错误'}）。关闭再开启预览可重试。`);
  }
  update({ name = 'idle', scale = 1, hidden = false, staticPose = false }) {
    if (this.disposed || this.failed) return;
    if (scale !== this.scale) { this.scale = scale; this.player.setPlacement(this.placement()); }
    const id = staticPose ? 'idle' : previewClip(name), signature = `${id}:${hidden}:${staticPose}`;
    if (signature === this.signature) return;
    this.signature = signature; this.targetId = id; this.clock.reset();
    if (hidden || staticPose) {
      this.player.setHidden(true);
      // Save the intended idle before a later visibility resume, not old gait.
      void this.player.switchTo(id);
      this.present({ mode: 'hidden', reason: hidden ? 'hidden' : 'static-pose' });
    } else {
      // Queue the desired action while hidden, then resume only that action.
      if (this.player.hidden) { void this.player.switchTo(id); this.player.setHidden(false); }
      else void this.player.switchTo(id);
    }
  }
  movementElapsed(now) {
    if (this.disposed || this.failed) return 0;
    const snapshot = this.player.getPlaybackSnapshot();
    // A replacement gait can still be decoding while the prior direction is
    // painted. Never translate in the new direction using the old clip clock.
    if (snapshot.clipId !== this.targetId) { this.clock.reset(); return 0; }
    return this.clock.step(snapshot, now, this.pack.gait.durationMs);
  }
  hitTest(clientX, clientY) {
    if (this.disposed || this.failed) return null;
    const video = this.player.active?.video;
    if (!video || this.presentation !== 'video') return null;
    const box = video.getBoundingClientRect(), x = Math.floor((clientX - box.left) * video.videoWidth / box.width), y = Math.floor((clientY - box.top) * video.videoHeight / box.height);
    if (x < 0 || y < 0 || x >= video.videoWidth || y >= video.videoHeight) return false;
    try { this.probeContext.clearRect(0, 0, 1, 1); this.probeContext.drawImage(video, x, y, 1, 1, 0, 0, 1, 1); return this.probeContext.getImageData(0, 0, 1, 1).data[3] > 15; }
    catch { this.fail('像素读取失败'); return null; }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.clock.reset(); this.player.dispose(); this.container.hidden = true; this.canvas.classList.remove('video-active');
  }
}
