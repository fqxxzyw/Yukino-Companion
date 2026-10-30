/** Optional local-only transparent-video renderer. No asset pack is bundled here.
 * Keep the existing sprite renderer until onState reports mode: 'video'.
 */
const MIME = 'video/webm; codecs="vp9"';
const DEFAULT_LIMITS = Object.freeze({ clips: 32, width: 1920, height: 1080, fps: 60, durationMs: 30000, clipBytes: 16 * 1024 * 1024, residentBytes: 24 * 1024 * 1024 });
const fail = (code, message = code) => Object.assign(new Error(message), { code });
const finite = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
function localURL(value, baseURL, allowLocalhost) {
  const url = new URL(value, baseURL);
  const loopback = allowLocalhost && url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
  if (!(url.protocol === 'file:' && !url.hostname || loopback) || url.username || url.password || url.search || url.hash) throw fail('unregistered-url', 'Only registered local file assets (or explicitly enabled loopback development assets) are permitted');
  return url.href;
}
function point(value, width, height) {
  return value && Number.isInteger(value.x) && Number.isInteger(value.y) && finite(value.x, 0, width - 1) && finite(value.y, 0, height - 1);
}

/** Registration is a separate trust boundary: the host must verify pack hashes,
 * byte sizes, file containment (including symlinks), provenance and licences.
 * A manifest cannot grant itself access by listing a URL.
 */
export function registerVideoManifest(manifest, { baseURL, allowedAssetURLs = [], allowLocalhost = false, limits = {} } = {}) {
  const bounds = { ...DEFAULT_LIMITS, ...limits };
  for (const [key, ceiling] of Object.entries(DEFAULT_LIMITS)) if (!finite(bounds[key], 1, ceiling)) throw fail('invalid-limits', key);
  const allowed = new Set(allowedAssetURLs.map(url => localURL(url, baseURL, allowLocalhost)));
  if (manifest?.version !== 1 || !Array.isArray(manifest.clips) || !manifest.clips.length || manifest.clips.length > bounds.clips) throw fail('invalid-manifest');
  const clips = new Map();
  for (const input of manifest.clips) {
    const clip = structuredClone(input);
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(clip.id) || clips.has(clip.id)) throw fail('invalid-clip-id');
    clip.src = localURL(clip.src, baseURL, allowLocalhost);
    if (!allowed.has(clip.src)) throw fail('unregistered-url');
    if (clip.mime !== MIME || clip.alpha !== true || typeof clip.loop !== 'boolean') throw fail('unsupported-format');
    if (!Number.isInteger(clip.width) || !Number.isInteger(clip.height) || !finite(clip.width, 1, bounds.width) || !finite(clip.height, 1, bounds.height) || !finite(clip.fps, 1, bounds.fps) || !finite(clip.durationMs, 1, bounds.durationMs) || !Number.isInteger(clip.bytes) || !finite(clip.bytes, 1, Math.min(bounds.clipBytes, bounds.residentBytes))) throw fail('invalid-clip-size');
    if (!point(clip.anchor, clip.width, clip.height) || !finite(clip.subjectHeight, 1, clip.height) || !point(clip.alphaProbe?.transparent, clip.width, clip.height) || !point(clip.alphaProbe?.opaque, clip.width, clip.height)) throw fail('invalid-footprint-or-probe');
    const label = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 2048;
    if (!label(clip.fallback?.spriteId) || !Number.isInteger(clip.fallback?.staticFrame) || !finite(clip.fallback.staticFrame, 0, 32767) || !label(clip.provenance?.source) || !label(clip.provenance?.license) || !label(clip.poses?.entry) || !label(clip.poses?.exit)) throw fail('missing-asset-contract');
    clip.motionWindows ??= [];
    if (!Array.isArray(clip.motionWindows) || clip.motionWindows.length > 16 || clip.motionWindows.some(window => !finite(window.startMs, 0, clip.durationMs) || !finite(window.endMs, window.startMs, clip.durationMs) || !finite(window.dx, -10000, 10000) || !finite(window.dy, -10000, 10000))) throw fail('invalid-motion-windows');
    // The map is kept private by the controller; nested metadata cannot change
    // after registration, including through an original manifest reference.
    const freeze = object => { if (object && typeof object === 'object') { Object.values(object).forEach(freeze); Object.freeze(object); } return object; };
    clips.set(clip.id, freeze(clip));
  }
  return { clips, limits: Object.freeze(bounds) };
}

/** Pixel-coordinate foot anchors keep differently padded clips on one floor. */
export function videoFootprint(clip, { subjectHeight, footX, footY }) {
  if (!finite(subjectHeight, 1, 8192) || !finite(footX, -16384, 16384) || !finite(footY, -16384, 16384)) throw fail('invalid-placement');
  const scale = subjectHeight / clip.subjectHeight;
  return { width: clip.width * scale, height: clip.height * scale, left: footX - clip.anchor.x * scale, top: footY - clip.anchor.y * scale };
}

/** canPlayType only checks codec support, not alpha. Check actual decoded pixels.
 * Authors must choose transparent padding and an opaque interior pixel that
 * remain valid throughout the entry pose / first few frames of a clip.
 */
export function verifyVideoAlpha(video, clip, document = globalThis.document) {
  if (video.videoWidth !== clip.width || video.videoHeight !== clip.height) throw fail('dimensions-mismatch');
  if (!Number.isFinite(video.duration) || video.duration <= 0 || Math.abs(video.duration * 1000 - clip.durationMs) > Math.max(250, 2000 / clip.fps)) throw fail('duration-mismatch');
  const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw fail('alpha-unavailable');
  const { transparent, opaque } = clip.alphaProbe;
  try {
    context.clearRect(0, 0, 2, 1);
    context.drawImage(video, transparent.x, transparent.y, 1, 1, 0, 0, 1, 1);
    context.drawImage(video, opaque.x, opaque.y, 1, 1, 1, 0, 1, 1);
    const pixels = context.getImageData(0, 0, 2, 1).data;
    if (pixels[3] > 8 || pixels[7] < 247) throw fail('alpha-unavailable');
  } catch (error) { throw fail('alpha-unavailable', error.message); }
  return true;
}

/** No RAF, interval, telemetry, fetch, or background prefetch. The browser plays
 * video at its encoded frame rate. A maximum of two sources can be resident.
 */
export class TransparentVideoPlayer {
  constructor({ container, manifest, registration, placement, document = container?.ownerDocument,
    createVideo = () => document.createElement('video'), verifyAlpha = verifyVideoAlpha,
    onState = () => {}, onError = () => {}, onEnded = () => {}, timeoutMs = 5000, fadeMs = 180,
    reducedMotion, mediaQuery = document?.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)'),
    clock = { setTimeout: (...args) => setTimeout(...args), clearTimeout: id => clearTimeout(id) } } = {}) {
    if (!container || !document || !finite(timeoutMs, 1, 30000) || !finite(fadeMs, 0, 1000)) throw fail('invalid-options');
    const registered = registerVideoManifest(manifest, registration);
    this.clips = registered.clips; this.limits = registered.limits;
    Object.assign(this, { container, document, placement, verifyAlpha, onState, onError, onEnded, timeoutMs, fadeMs, clock, mediaQuery });
    this.active = null; this.pending = null; this.fade = null; this.requestedId = null; this.disposed = false; this.explicitHidden = false;
    this.documentHidden = Boolean(document.hidden); this.reducedMotion = reducedMotion ?? Boolean(mediaQuery?.matches);
    this.slots = [0, 1].map(() => {
      const video = createVideo(); video.muted = true; video.defaultMuted = true; video.playsInline = true; video.preload = 'none'; video.controls = false;
      video.setAttribute('aria-hidden', 'true'); video.setAttribute('tabindex', '-1');
      Object.assign(video.style, { position: 'absolute', pointerEvents: 'none', opacity: '0', background: 'transparent', objectFit: 'fill' });
      container.appendChild(video);
      const slot = { video, clip: null, ready: false };
      slot.error = () => { if (this.active === slot) this._fallback('decode-error'); };
      slot.ended = () => { if (this.active === slot && !slot.clip.loop) this._notify(this.onEnded, { clipId: slot.clip.id }); };
      video.addEventListener('error', slot.error); video.addEventListener('ended', slot.ended); return slot;
    });
    this.visibilityListener = () => { this.documentHidden = Boolean(document.hidden); this._visibilityChanged(); };
    this.motionListener = event => this.setReducedMotion(event.matches);
    document.addEventListener('visibilitychange', this.visibilityListener);
    mediaQuery?.addEventListener?.('change', this.motionListener);
    this._emit(this.hidden ? 'hidden' : 'sprite', this.reducedMotion ? 'reduced-motion' : 'initial');
  }
  get hidden() { return this.explicitHidden || this.documentHidden; }
  _notify(callback, value) { try { callback(value); } catch { /* Host observers cannot corrupt resource cleanup. */ } }
  _emit(mode, reason) { this.state = { mode, reason, clipId: this.active?.clip.id ?? null, requestedId: this.requestedId, static: this.reducedMotion, fallback: this.clips.get(this.requestedId)?.fallback ?? null }; this._notify(this.onState, { ...this.state }); }
  _layout(slot) {
    if (!slot.clip) return;
    const placement = this.placement ?? { subjectHeight: this.container.clientHeight, footX: this.container.clientWidth / 2, footY: this.container.clientHeight };
    for (const [key, value] of Object.entries(videoFootprint(slot.clip, placement))) slot.video.style[key] = `${value}px`;
  }
  setPlacement(placement) { videoFootprint({ width: 1, height: 1, anchor: { x: 0, y: 0 }, subjectHeight: 1 }, placement); this.placement = { ...placement }; this.slots.forEach(slot => this._layout(slot)); }
  _release(slot) {
    if (!slot) return;
    slot.video.pause(); slot.video.style.opacity = '0'; slot.video.style.transition = 'none';
    if (slot.clip) { slot.video.removeAttribute('src'); slot.video.preload = 'none'; try { slot.video.load(); } catch { /* Source is detached even if reset fails. */ } }
    slot.clip = null; slot.ready = false;
  }
  _cancelPending(reason = 'superseded') { this.pending?.controller.abort(fail(reason)); }
  _finishFade() {
    if (!this.fade) return;
    this.clock.clearTimeout(this.fade.timer); this._release(this.fade.outgoing); this.fade = null;
    if (this.active) this.active.video.style.transition = 'none';
  }
  _fallback(reason) {
    this._cancelPending(reason); this._finishFade(); this.active = null; this.slots.forEach(slot => this._release(slot)); this._emit(this.hidden ? 'hidden' : 'sprite', reason);
  }
  _visibilityChanged() {
    if (this.disposed) return;
    if (this.hidden || this.reducedMotion) this._fallback(this.hidden ? 'hidden' : 'reduced-motion');
    else if (this.requestedId) void this.switchTo(this.requestedId);
    else this._emit('sprite', 'initial');
  }
  setHidden(hidden) { if (this.explicitHidden !== Boolean(hidden)) { this.explicitHidden = Boolean(hidden); this._visibilityChanged(); } }
  setReducedMotion(reduced) { if (this.reducedMotion !== Boolean(reduced)) { this.reducedMotion = Boolean(reduced); this._visibilityChanged(); } }
  _result(status, reason) { return { status, reason, clipId: this.active?.clip.id ?? null }; }
  async preload(id, options = {}) { return this._prepare(id, false, options); }
  async switchTo(id, options = {}) { return this._prepare(id, true, options); }
  async _prepare(id, activate, { signal } = {}) {
    if (this.disposed) return this._result('disposed');
    if (signal?.aborted) return this._result('cancelled', 'aborted');
    if (activate) this.requestedId = id;
    if (this.hidden || this.reducedMotion) {
      const reason = this.hidden ? 'hidden' : 'reduced-motion';
      if (activate) this._emit(this.hidden ? 'hidden' : 'sprite', reason);
      return this._result('fallback', reason);
    }
    if (!activate && this.pending) return this._result('busy');
    if (activate) { this._cancelPending(); this._finishFade(); }
    const clip = this.clips.get(id);
    if (!clip) return this._failed(fail('unknown-clip'));
    if (this.active?.clip.id === id) return this._result('playing');
    const slot = this.slots.find(candidate => candidate !== this.active);
    if ((this.active?.clip.bytes ?? 0) + clip.bytes > this.limits.residentBytes) return this._failed(fail('resident-budget'));
    try { if (!slot.video.canPlayType(clip.mime)) return this._failed(fail('unsupported-format')); } catch { return this._failed(fail('unsupported-format')); }
    if (slot.clip?.id !== id) this._release(slot);
    const controller = new AbortController();
    const operation = { controller, slot }; this.pending = operation;
    const forwardAbort = () => controller.abort(fail('aborted'));
    signal?.addEventListener('abort', forwardAbort, { once: true });
    let timer;
    const timeout = () => controller.abort(fail('decode-timeout'));
    try {
      timer = this.clock.setTimeout(timeout, this.timeoutMs);
      if (!slot.clip) { slot.clip = clip; this._layout(slot); slot.video.loop = clip.loop; slot.video.preload = 'auto'; }
      await this._waitForData(slot, controller.signal);
      if (activate) {
        await this._firstFrame(slot, controller.signal);
        if (controller.signal.aborted) throw controller.signal.reason;
        if (this.verifyAlpha(slot.video, clip, this.document) !== true) throw fail('alpha-unavailable');
        if (controller.signal.aborted) throw controller.signal.reason;
        const outgoing = this.active; this.active = slot; slot.video.style.transition = outgoing && this.fadeMs ? `opacity ${this.fadeMs}ms linear` : 'none'; slot.video.style.opacity = '1';
        if (outgoing) {
          outgoing.video.pause(); outgoing.video.style.transition = `opacity ${this.fadeMs}ms linear`; outgoing.video.style.opacity = '0';
          if (this.fadeMs) this.fade = { outgoing, timer: this.clock.setTimeout(() => this._finishFade(), this.fadeMs) }; else this._release(outgoing);
        }
        this._emit('video', 'ready');
      } else slot.video.pause();
      return this._result(activate ? 'playing' : 'preloaded');
    } catch (error) {
      // A superseding request may already have reused this slot. Its resources
      // belong to that request; a stale completion must never release them.
      if (this.pending === operation && this.active !== slot) this._release(slot);
      if (error.code === 'aborted' && this.pending === operation && activate) this.requestedId = this.active?.clip.id ?? null;
      if (['superseded', 'aborted', 'hidden', 'reduced-motion', 'disposed'].includes(error.code)) return this._result('cancelled', error.code);
      if (this.pending !== operation) return this._result('cancelled', 'superseded');
      return this._failed(error);
    } finally {
      this.clock.clearTimeout(timer); signal?.removeEventListener('abort', forwardAbort);
      if (this.pending === operation) this.pending = null;
    }
  }
  _failed(error) {
    this._notify(this.onError, { code: error.code ?? 'decode-error', requestedId: this.requestedId });
    if (!this.active) this._emit(this.hidden ? 'hidden' : 'sprite', error.code ?? 'decode-error');
    return this._result(this.active ? 'kept-current' : 'fallback', error.code ?? 'decode-error');
  }
  _waitForData(slot, signal) {
    return new Promise((resolve, reject) => {
      const video = slot.video;
      const cleanup = () => { video.removeEventListener('loadeddata', ready); video.removeEventListener('error', error); signal.removeEventListener('abort', abort); };
      const ready = () => { if (video.readyState >= 2) { cleanup(); slot.ready = true; resolve(); } };
      const error = () => { cleanup(); reject(fail('decode-error')); };
      const abort = () => { cleanup(); reject(signal.reason); };
      video.addEventListener('loadeddata', ready); video.addEventListener('error', error); signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) return abort();
      if (slot.ready && video.readyState >= 2) return ready();
      try { video.src = slot.clip.src; video.load(); ready(); } catch { error(); }
    });
  }
  _firstFrame(slot, signal) {
    return new Promise((resolve, reject) => {
      const video = slot.video;
      let frame = null, played = false, presented = typeof video.requestVideoFrameCallback !== 'function', settled = false;
      const cleanup = () => { if (frame !== null) video.cancelVideoFrameCallback?.(frame); video.removeEventListener('error', error); signal.removeEventListener('abort', abort); };
      const finish = failure => { if (settled) return; if (!failure && !(played && presented)) return; settled = true; cleanup(); failure ? reject(failure) : resolve(); };
      const error = () => finish(fail('decode-error'));
      const abort = () => finish(signal.reason);
      video.addEventListener('error', error); signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) return abort();
      try {
        if (!presented) frame = video.requestVideoFrameCallback(() => { frame = null; presented = true; finish(); });
        Promise.resolve(video.play()).then(() => { played = true; finish(); }, () => finish(fail('play-rejected'))); } catch { finish(fail('play-rejected')); }
    });
  }
  getPlaybackSnapshot() {
    const video = this.active?.video;
    return { ...this.state, paused: video ? video.paused : true, requestedId: this.requestedId, clipId: this.active?.clip.id ?? null, mediaTimeMs: video ? video.currentTime * 1000 : 0,
      motionWindows: this.active?.clip.motionWindows ?? [], residentSources: this.slots.filter(slot => slot.clip).length,
      declaredResidentBytes: this.slots.reduce((sum, slot) => sum + (slot.clip?.bytes ?? 0), 0), pending: Boolean(this.pending), fading: Boolean(this.fade) };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this._fallback('disposed');
    this.document.removeEventListener('visibilitychange', this.visibilityListener); this.mediaQuery?.removeEventListener?.('change', this.motionListener);
    for (const slot of this.slots) { slot.video.removeEventListener('error', slot.error); slot.video.removeEventListener('ended', slot.ended); slot.video.remove(); }
  }
}
