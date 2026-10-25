'use strict';
const api = window.companion;
const canvas = document.getElementById('pet'), ctx = canvas.getContext('2d', { willReadFrequently: true });
const bubble = document.getElementById('bubble'), zh = document.getElementById('zh'), ja = document.getElementById('ja');
const model = document.getElementById('model');
const clips = {
  idle: { row: 0, count: 7, durations: [4200,500,500,120,500,180,300], loop: true },
  wave: { row: 3, count: 4, durations: [130,105,165,230] },
  jump: { row: 4, count: 5, durations: [110,90,145,95,180] },
  lifted: { row: 4, start: 2, count: 1, durations: [220], loop: true },
  landing: { row: 4, start: 3, count: 2, durations: [95,210] },
  annoyed: { row: 5, count: 6, durations: [140,120,180,150,190,270] },
  tilt: { row: 8, count: 6, durations: [150,180,260,700,180,220] },
  'walk-left': { row: 0, count: 8, durations: [165,115,130,185,165,115,130,185], loop: true, sheet: 'left' },
  'walk-right': { row: 0, count: 8, durations: [165,115,130,185,165,115,130,185], loop: true, sheet: 'right' },
};
let settings = { animation: true, bubbleLanguage: 'zh', scale: 1 }, kind = 'pet', lastReply = '', dragging = false, down = null, clicks = [];
let clip = clips.idle, frame = 0, nextFrame = 0, lastHit = true, lastMove = 0, wander = null, nextWander = performance.now() + 18000;
const images = {};
for (const [key, file] of Object.entries({ base: 'spritesheet.png', left: 'walking-left.png', right: 'walking-right.png' })) { const img = new Image(); img.src = `assets/${file}`; images[key] = img; }
function call(action, payload) { return api ? api.call(action, payload).catch(() => {}) : Promise.resolve(false); }
function play(name) { clip = clips[name] || clips.idle; frame = 0; nextFrame = 0; }
function stopWalk() { wander = null; nextWander = performance.now() + 22000 + Math.random() * 18000; }
function draw(time) {
  if (kind === 'pet' && images.base.complete && images.base.naturalWidth) {
    if (settings.animation && !dragging && !wander && time > nextWander) {
      const direction = Math.random() < .5 ? -1 : 1; wander = { direction, until: time + 3500, next: 0 }; play(direction < 0 ? 'walk-left' : 'walk-right');
    }
    if (wander && settings.animation && !dragging) {
      if (time > wander.until) { stopWalk(); play('idle'); }
      else if (time > wander.next) { wander.next = time + 100; call('walk-step', wander.direction).then(moved => { if (moved === false) { stopWalk(); play('idle'); } }); }
    }
    if (!nextFrame) nextFrame = time + clip.durations[frame];
    if (settings.animation && time >= nextFrame) {
      frame++;
      if (frame >= clip.count) { if (clip.loop) frame = 0; else { clip = clips.idle; frame = 0; } }
      nextFrame = time + clip.durations[frame];
    }
    const image = images[clip.sheet || 'base'];
    if (image.complete && image.naturalWidth) { ctx.clearRect(0, 0, 192, 208); ctx.drawImage(image, ((clip.start || 0) + frame) * 192, clip.row * 208, 192, 208, 0, 0, 192, 208); }
  }
  requestAnimationFrame(draw);
}
api?.onState(state => {
  kind = state.kind; settings = state.preferences;
  document.documentElement.style.setProperty('--scale', settings.scale);
  canvas.hidden = kind !== 'pet'; model.hidden = kind !== 'model';
  if (kind === 'model') bubble.style.bottom = `${300 * settings.scale}px`;
  if (!settings.animation) stopWalk();
  const reply = state.reply;
  if (!reply || (!reply.zh && !reply.ja)) { bubble.hidden = true; zh.textContent = ''; ja.textContent = ''; return; }
  const language = settings.bubbleLanguage;
  zh.textContent = language === 'ja' ? '' : reply.zh;
  ja.textContent = language === 'zh' ? '' : (reply.ja || '日语翻译尚未完成');
  bubble.hidden = false;
  if (lastReply !== reply.id) { lastReply = reply.id; if (!dragging) { stopWalk(); play('wave'); } }
});
function hitTest(event) {
  if (dragging || event.target.closest('button,.bubble,.model')) return true;
  const box = canvas.getBoundingClientRect();
  const x = Math.floor((event.clientX - box.left) * 192 / box.width), y = Math.floor((event.clientY - box.top) * 208 / box.height);
  return !canvas.hidden && x >= 0 && x < 192 && y >= 0 && y < 208 && ctx.getImageData(x, y, 1, 1).data[3] > 15;
}
window.addEventListener('pointermove', event => {
  if (down && Math.hypot(event.screenX - down.x, event.screenY - down.y) > 4) {
    if (!dragging) { dragging = true; play('lifted'); }
    if (performance.now() - lastMove > 16) { lastMove = performance.now(); call('drag-move'); }
  }
  const hit = hitTest(event); if (hit !== lastHit) { lastHit = hit; call('hit-test', hit); }
});
for (const target of [canvas, model]) {
  target.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('button')) return;
    down = { x: event.screenX, y: event.screenY }; stopWalk(); target.setPointerCapture(event.pointerId); call('drag-start');
  });
  target.addEventListener('pointerup', () => {
    if (!down) return;
    call('drag-end'); down = null;
    if (dragging) { dragging = false; play('landing'); }
    else { clicks = clicks.filter(t => performance.now() - t < 2500); clicks.push(performance.now()); play(clicks.length > 3 ? 'annoyed' : 'wave'); }
  });
  target.addEventListener('pointercancel', () => { call('drag-end'); down = null; dragging = false; play('idle'); });
  target.addEventListener('contextmenu', event => { event.preventDefault(); stopWalk(); call('menu'); });
  target.addEventListener('dblclick', () => call('open-main'));
}
document.getElementById('open').addEventListener('click', () => call('open-main'));
document.getElementById('model-open').addEventListener('click', () => call('open-main'));
call('ready'); requestAnimationFrame(draw);
