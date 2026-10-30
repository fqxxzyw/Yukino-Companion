const test = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../electron/companion-view/animation/video-playback.mjs');
const tick = () => new Promise(setImmediate);
const source = id => `file:///registered/${id}.webm`;
function clip(id, extra = {}) { return { id, src: source(id), mime: 'video/webm; codecs="vp9"', alpha: true, width: 640, height: 360, subjectHeight: 300, fps: 24, durationMs: 10000, bytes: 1000, loop: true, anchor: { x: 320, y: 340 }, alphaProbe: { transparent: { x: 0, y: 0 }, opaque: { x: 320, y: 180 } }, fallback: { spriteId: 'idle', staticFrame: 0 }, provenance: { source: 'synthetic test fixture', license: 'CC0-1.0' }, poses: { entry: 'neutral', exit: 'neutral' }, motionWindows: [], ...extra }; }
function manifest(...clips) { return { version: 1, clips }; }
class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(name, callback) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(callback); }
  removeEventListener(name, callback) { this.listeners.get(name)?.delete(callback); }
  emit(name) { for (const callback of [...(this.listeners.get(name) ?? [])]) callback({ type: name }); }
  count() { return [...this.listeners.values()].reduce((sum, callbacks) => sum + callbacks.size, 0); }
}
class Video extends Events {
  constructor() { super(); Object.assign(this, { style: {}, src: '', readyState: 0, paused: true, currentTime: 0, loads: 0, plays: 0, removed: false, callbacks: new Map(), nextFrame: 0, codec: 'probably', videoWidth: 640, videoHeight: 360 }); }
  canPlayType() { return this.codec; }
  setAttribute() {}
  removeAttribute(name) { if (name === 'src') this.src = ''; }
  load() { this.loads++; this.readyState = 0; }
  play() { this.plays++; if (this.rejectPlay) return Promise.reject(Error('blocked')); this.paused = false; return this.playPromise ?? Promise.resolve(); }
  pause() { this.paused = true; }
  remove() { this.removed = true; }
  requestVideoFrameCallback(callback) { this.callbacks.set(++this.nextFrame, callback); return this.nextFrame; }
  cancelVideoFrameCallback(id) { this.callbacks.delete(id); }
  data() { this.readyState = 2; this.emit('loadeddata'); }
  frame() { const callbacks = [...this.callbacks.values()]; this.callbacks.clear(); callbacks.forEach(callback => callback(0, { presentedFrames: 1 })); }
}
class Clock {
  constructor() { this.now = 0; this.next = 0; this.timers = new Map(); this.calls = 0; }
  setTimeout(callback, ms) { this.timers.set(++this.next, { at: this.now + ms, callback }); return this.next; }
  clearTimeout(id) { this.timers.delete(id); }
  advance(ms) { this.now += ms; for (const [id, timer] of [...this.timers]) if (timer.at <= this.now) { this.timers.delete(id); this.calls++; timer.callback(); } }
}
async function setup(options = {}) {
  const { TransparentVideoPlayer } = await load();
  const document = new Events(); document.hidden = false;
  const mediaQuery = new Events(); mediaQuery.matches = false;
  const videos = [], states = [], errors = [], clock = new Clock();
  const clips = options.clips ?? [clip('idle'), clip('walk'), clip('wave')];
  const player = new TransparentVideoPlayer({ container: { clientWidth: 192, clientHeight: 208, appendChild() {}, ownerDocument: document }, document, mediaQuery, manifest: manifest(...clips), registration: { allowedAssetURLs: clips.map(clip => clip.src), ...options.registration }, createVideo: () => { const video = new Video(); videos.push(video); return video; }, clock, verifyAlpha: () => true, onState: state => states.push(state), onError: error => errors.push(error), ...options, registration: { allowedAssetURLs: clips.map(clip => clip.src), ...options.registration } });
  return { player, videos, states, errors, document, mediaQuery, clock };
}
async function ready(video) { video.data(); await tick(); video.frame(); await tick(); }
async function activate(ctx, id = 'idle') { const promise = ctx.player.switchTo(id); const video = ctx.videos.find(video => video.src === source(id)); await ready(video); assert.equal((await promise).status, 'playing'); return video; }

test('video manifest validates explicit local registration, metadata and defensive copy', async () => {
  const { registerVideoManifest } = await load();
  const original = clip('idle'); const result = registerVideoManifest(manifest(original), { allowedAssetURLs: [source('idle')] });
  original.anchor.x = 1; assert.equal(result.clips.get('idle').anchor.x, 320); assert.ok(Object.isFrozen(result.clips.get('idle').anchor));
  for (const src of ['https://tracker.example/a.webm', 'file://remote/share/a.webm', 'data:video/webm,x', 'file:///unregistered.webm', 'file:///registered/idle.webm?x=1']) assert.throws(() => registerVideoManifest(manifest(clip('idle', { src })), { allowedAssetURLs: [source('idle')] }));
  for (const extra of [{ alpha: false }, { width: 4096 }, { bytes: 1e9 }, { durationMs: 60000 }, { fps: 120 }, { anchor: { x: 900, y: 0 } }, { provenance: {} }, { fallback: { spriteId: 'idle', staticFrame: -1 } }, { motionWindows: [{ startMs: 0, endMs: 15000, dx: 1, dy: 0 }] }]) assert.throws(() => registerVideoManifest(manifest(clip('idle', extra)), { allowedAssetURLs: [source('idle')] }));
  assert.throws(() => registerVideoManifest(manifest(clip('idle'), clip('idle')), { allowedAssetURLs: [source('idle')] }));
  assert.throws(() => registerVideoManifest(manifest(clip('idle')), { allowedAssetURLs: [source('idle')], limits: { residentBytes: Infinity } }));
});
test('video manifest loopback is development opt-in and cannot register external origins', async () => {
  const { registerVideoManifest } = await load(); const src = 'http://127.0.0.1:5173/assets/idle.webm';
  assert.throws(() => registerVideoManifest(manifest(clip('idle', { src })), { allowedAssetURLs: [src] }));
  assert.equal(registerVideoManifest(manifest(clip('idle', { src })), { allowedAssetURLs: [src], allowLocalhost: true }).clips.size, 1);
  assert.throws(() => registerVideoManifest(manifest(clip('idle')), { allowedAssetURLs: ['https://example.com/idle.webm'], allowLocalhost: true }));
});
test('video foot alignment normalizes different canvas padding to the same body height and floor', async () => {
  const { videoFootprint } = await load();
  const placement = { subjectHeight: 200, footX: 100, footY: 208 };
  for (const asset of [clip('idle'), clip('walk', { width: 1000, height: 800, subjectHeight: 500, anchor: { x: 450, y: 700 } })]) {
    const layout = videoFootprint(asset, placement), scale = layout.height / asset.height;
    assert.equal(layout.left + asset.anchor.x * scale, 100); assert.equal(layout.top + asset.anchor.y * scale, 208); assert.equal(asset.subjectHeight * scale, 200);
  }
});
test('video does not replace sprite on loadeddata or play alone: first composited frame gates swap', async () => {
  const ctx = await setup(); const pending = ctx.player.switchTo('idle'); const video = ctx.videos[0];
  video.data(); await tick(); assert.equal(ctx.states.at(-1).mode, 'sprite'); assert.equal(video.style.opacity, '0');
  video.frame(); assert.equal((await pending).status, 'playing'); assert.equal(ctx.states.at(-1).mode, 'video'); assert.equal(video.style.opacity, '1'); assert.equal(ctx.clock.timers.size, 0); ctx.player.dispose();
});
test('video A/B fade preserves current until ready, pauses outgoing, and releases after exactly 180 ms', async () => {
  const ctx = await setup(); const old = await activate(ctx); const pending = ctx.player.switchTo('walk');
  assert.equal(old.style.opacity, '1'); assert.equal(ctx.player.getPlaybackSnapshot().clipId, 'idle');
  await ready(ctx.videos[1]); await pending;
  assert.equal(ctx.player.getPlaybackSnapshot().clipId, 'walk'); assert.equal(old.paused, true); assert.equal(old.src, source('idle')); ctx.clock.advance(179); assert.equal(old.src, source('idle')); ctx.clock.advance(1); assert.equal(old.src, ''); assert.equal(ctx.player.getPlaybackSnapshot().residentSources, 1); ctx.player.dispose();
});
test('video latest request wins; stale decode cannot flash, release or overwrite the new source', async () => {
  const ctx = await setup(); await activate(ctx);
  const slow = ctx.player.switchTo('walk'); ctx.videos[1].data(); await tick(); const staleCallback = [...ctx.videos[1].callbacks.values()][0];
  const latest = ctx.player.switchTo('wave'); assert.equal((await slow).status, 'cancelled'); assert.equal(ctx.videos[1].src, source('wave'));
  staleCallback(); await tick(); assert.equal(ctx.player.getPlaybackSnapshot().clipId, 'idle');
  await ready(ctx.videos[1]); assert.equal((await latest).clipId, 'wave'); ctx.player.dispose();
});
test('video rapid switch during fade cancels old cleanup without unloading the new active clip', async () => {
  const ctx = await setup(); await activate(ctx); await activate(ctx, 'walk'); const active = ctx.videos[1];
  const pending = ctx.player.switchTo('wave'); assert.equal(ctx.videos[0].src, source('wave')); ctx.clock.advance(180); assert.equal(active.src, source('walk'));
  await ready(ctx.videos[0]); await pending; ctx.clock.advance(180); assert.equal(ctx.videos[0].src, source('wave')); assert.equal(active.src, ''); ctx.player.dispose();
});
test('video bounded preload is paused, replaceable, reusable and never eagerly loads the catalog', async () => {
  const ctx = await setup(); assert.equal(ctx.videos.filter(v => v.src).length, 0); await activate(ctx);
  const preload = ctx.player.preload('walk'); ctx.videos[1].data(); assert.equal((await preload).status, 'preloaded'); assert.equal(ctx.videos[1].plays, 0); assert.equal(ctx.videos[1].paused, true);
  const loads = ctx.videos[1].loads; const next = ctx.player.switchTo('walk'); await tick(); ctx.videos[1].frame(); await next; assert.equal(ctx.videos[1].loads, loads); assert.equal(ctx.videos.length, 2); ctx.player.dispose();
});
test('video preload cannot supersede a user switch; encoded-byte residency budget preserves current', async () => {
  const ctx = await setup({ registration: { limits: { residentBytes: 1500 } } }); await activate(ctx);
  const failed = await ctx.player.switchTo('walk'); assert.equal(failed.status, 'kept-current'); assert.equal(failed.reason, 'resident-budget'); assert.equal(ctx.videos[1].src, ''); ctx.player.dispose();
  const second = await setup(); const pending = second.player.switchTo('idle'); assert.equal((await second.player.preload('walk')).status, 'busy'); await ready(second.videos[0]); await pending; second.player.dispose();
});
test('video timeout, codec rejection, alpha failure and decode error fall back without black frame', async () => {
  for (const failure of ['timeout', 'codec', 'alpha', 'decode', 'play']) {
    const ctx = await setup({ verifyAlpha: () => { if (failure === 'alpha') throw Error('unsupported alpha'); return true; } });
    if (failure === 'codec') ctx.videos[0].codec = '';
    if (failure === 'play') ctx.videos[0].rejectPlay = true;
    const promise = ctx.player.switchTo('idle');
    if (failure === 'timeout') ctx.clock.advance(5000);
    if (failure === 'decode') ctx.videos[0].emit('error');
    if (failure === 'alpha' || failure === 'play') await ready(ctx.videos[0]);
    assert.equal((await promise).status, 'fallback', failure); assert.equal(ctx.states.at(-1).mode, 'sprite'); assert.equal(ctx.player.getPlaybackSnapshot().residentSources, 0); assert.equal(ctx.clock.timers.size, 0); assert.equal(ctx.videos[0].callbacks.size, 0); ctx.player.dispose();
  }
});
test('video failed switch preserves current, but active decode error returns to sprite', async () => {
  const ctx = await setup(); const active = await activate(ctx); const pending = ctx.player.switchTo('walk'); ctx.videos[1].emit('error'); assert.equal((await pending).status, 'kept-current'); assert.equal(active.style.opacity, '1'); assert.equal(active.paused, false);
  active.emit('error'); assert.equal(ctx.states.at(-1).mode, 'sprite'); assert.equal(ctx.player.getPlaybackSnapshot().residentSources, 0); ctx.player.dispose();
});
test('video caller cancellation settles, cleans handlers and keeps current', async () => {
  const ctx = await setup(); await activate(ctx); const abort = new AbortController(); const pending = ctx.player.switchTo('walk', { signal: abort.signal }); ctx.videos[1].data(); await tick(); abort.abort(); assert.equal((await pending).status, 'cancelled'); assert.equal(ctx.player.getPlaybackSnapshot().clipId, 'idle'); assert.equal(ctx.videos[1].callbacks.size, 0); assert.equal(ctx.videos[1].count(), 2); assert.equal(ctx.clock.timers.size, 0); ctx.player.dispose();
});
test('video hide cancels in-flight/fade, unloads all sources and creates no work over ten simulated minutes', async () => {
  const ctx = await setup(); await activate(ctx); const pending = ctx.player.switchTo('walk'); ctx.videos[1].data(); await tick();
  ctx.player.setHidden(true); await pending; const calls = ctx.clock.calls, plays = ctx.videos.reduce((sum, video) => sum + video.plays, 0);
  ctx.clock.advance(600000); assert.equal(ctx.clock.calls, calls); assert.equal(ctx.clock.timers.size, 0); assert.equal(ctx.player.getPlaybackSnapshot().residentSources, 0); assert.equal(ctx.videos.reduce((sum, video) => sum + video.plays, 0), plays); assert.ok(ctx.videos.every(video => video.paused && video.callbacks.size === 0));
  ctx.player.setHidden(false); await ready(ctx.videos[0]); assert.equal(ctx.player.getPlaybackSnapshot().clipId, 'walk'); ctx.player.dispose();
});
test('video document visibility and explicit hide cannot incorrectly resume each other', async () => {
  const ctx = await setup(); await activate(ctx); ctx.document.hidden = true; ctx.document.emit('visibilitychange'); await tick(); ctx.player.setHidden(true); ctx.document.hidden = false; ctx.document.emit('visibilitychange'); assert.equal(ctx.player.getPlaybackSnapshot().residentSources, 0); ctx.player.setHidden(false); await ready(ctx.videos[0]); assert.equal(ctx.player.getPlaybackSnapshot().clipId, 'idle'); ctx.player.dispose();
});
test('video reduced motion uses static sprite without decoding and resumes only when enabled', async () => {
  const ctx = await setup({ reducedMotion: true }); assert.equal((await ctx.player.switchTo('idle')).status, 'fallback'); assert.equal(ctx.videos[0].plays, 0); assert.equal(ctx.states.at(-1).static, true); assert.equal(ctx.states.at(-1).fallback.spriteId, 'idle');
  ctx.player.setReducedMotion(false); await ready(ctx.videos[0]); assert.equal(ctx.player.getPlaybackSnapshot().clipId, 'idle'); ctx.player.motionListener({ matches: true }); await tick(); assert.equal(ctx.player.getPlaybackSnapshot().residentSources, 0); assert.equal(ctx.states.at(-1).static, true); ctx.player.dispose();
});
test('video browsers without frame callbacks use loadeddata plus fulfilled play and still check alpha', async () => {
  let checked = 0; const ctx = await setup({ verifyAlpha: () => { checked++; return true; } }); ctx.videos[0].requestVideoFrameCallback = undefined;
  const pending = ctx.player.switchTo('idle'); ctx.videos[0].data(); assert.equal((await pending).status, 'playing'); assert.equal(checked, 1); ctx.player.dispose();
});
test('video dispose is idempotent, resolves pending promises and removes all listeners/resources', async () => {
  const ctx = await setup(); const pending = ctx.player.switchTo('idle'); ctx.videos[0].data(); await tick(); ctx.player.dispose(); ctx.player.dispose(); assert.equal((await pending).status, 'cancelled'); await tick(); assert.equal(ctx.clock.timers.size, 0); assert.equal(ctx.document.count(), 0); assert.equal(ctx.mediaQuery.count(), 0); assert.ok(ctx.videos.every(video => video.removed && video.count() === 0 && video.callbacks.size === 0 && !video.src)); assert.equal((await ctx.player.switchTo('walk')).status, 'disposed');
});
test('video alpha proof rejects opaque decoder output, empty frames, wrong dimensions and tainted canvas', async () => {
  const { verifyVideoAlpha } = await load();
  const video = { videoWidth: 640, videoHeight: 360, duration: 10 };
  for (const [transparent, opaque, passed] of [[0, 255, true], [255, 255, false], [0, 0, false]]) {
    const document = { createElement: () => ({ getContext: () => ({ clearRect() {}, drawImage() {}, getImageData: () => ({ data: [0, 0, 0, transparent, 0, 0, 0, opaque] }) }) }) };
    if (passed) assert.equal(verifyVideoAlpha(video, clip('idle'), document), true); else assert.throws(() => verifyVideoAlpha(video, clip('idle'), document), { code: 'alpha-unavailable' });
  }
  assert.throws(() => verifyVideoAlpha({ videoWidth: 640, videoHeight: 360, duration: 1000 }, clip('idle')), { code: 'duration-mismatch' });
  assert.throws(() => verifyVideoAlpha({ videoWidth: 1, videoHeight: 1 }, clip('idle')), { code: 'dimensions-mismatch' });
  assert.throws(() => verifyVideoAlpha(video, clip('idle'), { createElement: () => ({ getContext: () => ({ clearRect() {}, drawImage() { throw Error('SecurityError'); } }) }) }), { code: 'alpha-unavailable' });
});

test('video pre-aborted and externally cancelled switches never become a surprise resume target', async () => {
  const ctx = await setup(); await activate(ctx); const cancelled = new AbortController(); cancelled.abort();
  assert.equal((await ctx.player.switchTo('walk', { signal: cancelled.signal })).status, 'cancelled'); assert.equal(ctx.player.getPlaybackSnapshot().requestedId, 'idle');
  const activeAbort = new AbortController(); const pending = ctx.player.switchTo('wave', { signal: activeAbort.signal }); activeAbort.abort(); await pending;
  assert.equal(ctx.player.getPlaybackSnapshot().requestedId, 'idle'); ctx.player.setHidden(true); await tick(); ctx.player.setHidden(false); await ready(ctx.videos[0]); assert.equal(ctx.player.getPlaybackSnapshot().clipId, 'idle'); ctx.player.dispose();
});
test('video unknown latest request cancels old pending work rather than later revealing it', async () => {
  const ctx = await setup(); await activate(ctx); const pending = ctx.player.switchTo('walk'); assert.equal((await ctx.player.switchTo('unknown')).status, 'kept-current'); assert.equal((await pending).status, 'cancelled'); assert.equal(ctx.player.getPlaybackSnapshot().clipId, 'idle'); assert.equal(ctx.videos[1].src, ''); ctx.player.dispose();
});
test('video pending play promise cannot make hidden content active after a late resolution', async () => {
  const ctx = await setup(); let resolvePlay; ctx.videos[0].playPromise = new Promise(resolve => { resolvePlay = resolve; }); const pending = ctx.player.switchTo('idle'); ctx.videos[0].data(); await tick(); ctx.videos[0].frame(); ctx.player.setHidden(true); await pending; resolvePlay(); await tick(); assert.equal(ctx.player.getPlaybackSnapshot().clipId, null); assert.equal(ctx.states.at(-1).mode, 'hidden'); assert.equal(ctx.videos[0].src, ''); assert.equal(ctx.clock.timers.size, 0); ctx.player.dispose();
});
test('video initial hidden state loads nothing and external event listeners cannot break cleanup', async () => {
  const ctx = await setup({ onState() { throw Error('host observer'); }, onError() { throw Error('host observer'); } });
  ctx.document.hidden = true; ctx.document.emit('visibilitychange'); assert.equal((await ctx.player.switchTo('idle')).status, 'fallback'); assert.equal(ctx.videos[0].src, ''); ctx.player.dispose(); assert.equal(ctx.videos[0].count(), 0);
});
test('video non-loop ending holds last frame and reports media-time motion metadata without a JS tick loop', async () => {
  const events = []; const ctx = await setup({ clips: [clip('idle', { loop: false, motionWindows: [{ startMs: 100, endMs: 500, dx: 16, dy: 0 }] })], onEnded: event => events.push(event) }); const video = await activate(ctx);
  video.currentTime = 1.5; video.emit('ended'); assert.deepEqual(events, [{ clipId: 'idle' }]); const snapshot = ctx.player.getPlaybackSnapshot(); assert.equal(snapshot.mediaTimeMs, 1500); assert.equal(snapshot.motionWindows[0].dx, 16); assert.equal(snapshot.clipId, 'idle'); assert.equal(ctx.clock.timers.size, 0); ctx.player.dispose();
});
test('video synchronous media-method failure removes readiness listeners and returns a safe fallback', async () => {
  const ctx = await setup(); ctx.videos[0].load = () => { throw Error('load failed'); }; const pending = ctx.player.switchTo('idle'); assert.equal((await pending).status, 'fallback'); assert.equal(ctx.videos[0].count(), 2); assert.equal(ctx.clock.timers.size, 0); ctx.player.dispose();
});

test('video 200 interrupted/repeated operations stay within two sources and fully drain on disposal', async () => {
  const ctx = await setup(); const operations = [];
  for (let index = 0; index < 200; index++) {
    if (index % 13 === 0) ctx.player.setHidden(true);
    if (index % 13 === 1) ctx.player.setHidden(false);
    if (index % 19 === 0) ctx.player.setReducedMotion(true);
    if (index % 19 === 1) ctx.player.setReducedMotion(false);
    operations.push(index % 7 === 0 ? ctx.player.preload(['idle', 'walk', 'wave'][index % 3]) : ctx.player.switchTo(['idle', 'walk', 'wave'][index % 3]));
    for (const video of ctx.videos) if (video.src) video.data();
    await tick();
    if (index % 3 === 0) for (const video of ctx.videos) video.frame();
    if (index % 11 === 0) ctx.clock.advance(5001); else ctx.clock.advance(33);
    await tick();
    assert.ok(ctx.player.getPlaybackSnapshot().residentSources <= 2); assert.ok(ctx.clock.timers.size <= 2); assert.ok(ctx.videos.every(video => video.count() <= 4 && video.callbacks.size <= 1));
  }
  ctx.player.dispose(); await Promise.all(operations); await tick();
  assert.equal(ctx.clock.timers.size, 0); assert.equal(ctx.player.getPlaybackSnapshot().residentSources, 0); assert.ok(ctx.videos.every(video => video.count() === 0 && video.callbacks.size === 0));
});
