import { TransparentVideoPlayer } from '../electron/companion-view/animation/video-playback.mjs';
const stage = document.querySelector('#stage'), sprite = document.querySelector('#sprite'), status = document.querySelector('#status');
const report = window.videoQA = { done: false, passed: false, syntheticOnly: true, checks: [], errors: [], timing: {}, states: [] };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function check(name, value, detail = {}) { report.checks.push({ name, passed: Boolean(value), ...detail }); if (!value) throw Error(name); }
const clips = ['blue', 'pink'].map((id, index) => ({ id, src: new URL(`./fixtures/video/${id}.webm`, import.meta.url).href, mime: 'video/webm; codecs="vp9"', alpha: true, width: 128, height: 128, subjectHeight: 80, fps: 24, durationMs: 2000, bytes: index ? 5231 : 5341, loop: true, anchor: { x: 64, y: 112 }, alphaProbe: { transparent: { x: 0, y: 0 }, opaque: { x: 64, y: 76 } }, fallback: { spriteId: 'synthetic-static', staticFrame: 0 }, provenance: { source: 'tests/fixtures/video/generate-video-fixtures.py', license: 'CC0-1.0' }, poses: { entry: 'neutral', exit: 'neutral' }, motionWindows: [] }));
let player;
async function run() {
  player = new TransparentVideoPlayer({ container: stage, manifest: { version: 1, clips }, registration: { allowedAssetURLs: clips.map(clip => clip.src) }, placement: { subjectHeight: 180, footX: 120, footY: 240 }, reducedMotion: false,
    onState: state => { report.states.push(state); sprite.hidden = state.mode === 'video'; }, onError: error => report.errors.push(error) });
  window.disposeVideoQA = () => player.dispose();
  const start = performance.now(); const first = await player.switchTo('blue');
  report.timing.firstFrameMs = performance.now() - start;
  check('Actual VP9 decode, compositor readiness and transparent/opaque pixel proof', first.status === 'playing', first);
  const video = [...stage.querySelectorAll('video')].find(video => video.style.opacity === '1');
  let frameCount = 0, frameId = null;
  const countFrame = () => { frameCount++; frameId = video.requestVideoFrameCallback(countFrame); };
  if (video.requestVideoFrameCallback) frameId = video.requestVideoFrameCallback(countFrame);
  const before = video.getVideoPlaybackQuality?.(); const measuredAt = performance.now();
  await wait(2200);
  if (frameId !== null) video.cancelVideoFrameCallback(frameId);
  const elapsedMs = performance.now() - measuredAt, quality = video.getVideoPlaybackQuality?.();
  report.timing.playback = { elapsedMs, presentedCallbacks: frameCount, observedFps: frameCount / (elapsedMs / 1000), decodedFrames: quality && before ? quality.totalVideoFrames - before.totalVideoFrames : null, droppedFrames: quality && before ? quality.droppedVideoFrames - before.droppedVideoFrames : null };
  check('Encoded 24 fps clip advances over a real-time observation window', !video.paused && (!video.requestVideoFrameCallback || frameCount >= 20), report.timing.playback);
  check('Only current source remains loaded during steady playback', player.getPlaybackSnapshot().residentSources === 1);
  check('Paused explicit preloading', (await player.preload('pink')).status === 'preloaded' && [...stage.querySelectorAll('video')].filter(video => !video.paused).length === 1);
  const swapAt = performance.now(); check('A/B switch succeeds', (await player.switchTo('pink')).status === 'playing'); await wait(220);
  report.timing.preloadedSwitchAndFadeMs = performance.now() - swapAt;
  check('Outgoing source released after fade', player.getPlaybackSnapshot().residentSources === 1);
  for (let index = 0; index < 8; index++) {
    const obsolete = player.switchTo('blue'); const latest = player.switchTo('pink'); await Promise.all([obsolete, latest]);
    check(`Latest wins, repeat ${index + 1}`, player.getPlaybackSnapshot().clipId === 'pink');
  }
  player.setHidden(true); const hiddenAt = performance.now(); await wait(2200);
  report.timing.hiddenObservationMs = performance.now() - hiddenAt;
  check('Hidden for two seconds: no resident sources or playing decoder', player.getPlaybackSnapshot().residentSources === 0 && [...stage.querySelectorAll('video')].every(video => video.paused && !video.getAttribute('src')));
  player.setReducedMotion(true); player.setHidden(false);
  check('Reduced motion stays on static fallback without loading video', player.getPlaybackSnapshot().residentSources === 0 && !sprite.hidden);
  player.dispose(); check('Dispose removes both video elements', stage.querySelectorAll('video').length === 0);
  player = new TransparentVideoPlayer({ container: stage, manifest: { version: 1, clips }, registration: { allowedAssetURLs: clips.map(clip => clip.src) }, placement: { subjectHeight: 180, footX: 120, footY: 240 }, reducedMotion: false, onState: state => { sprite.hidden = state.mode === 'video'; } });
  check('Fresh instance can play after disposal', (await player.switchTo('blue')).status === 'playing');
  report.passed = report.errors.length === 0;
}
run().catch(error => { report.errors.push({ message: error.message, stack: error.stack }); player?.dispose(); }).finally(() => { report.done = true; status.textContent = JSON.stringify(report, null, 2); });
