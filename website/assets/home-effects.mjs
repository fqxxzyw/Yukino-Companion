// Small, dependency-free interactions for the product page. Content remains
// visible when this file fails to load; animations are opt-in via .v2-anim.
const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)');

if (!reduced?.matches) {
  document.documentElement.classList.add('v2-anim');
}

const reveal = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    entry.target.classList.add('in');
    reveal.unobserve(entry.target);
  }
}, {rootMargin: '0px 0px -8% 0px', threshold: 0.08});
const revealNodes = [...document.querySelectorAll('[data-reveal]')];
for (const node of revealNodes) reveal.observe(node);
// Scenes wait until they fill most of the viewport, so the day-to-night
// transition is seen instead of finishing above the fold.
const sceneObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    entry.target.classList.add('in');
    sceneObserver.unobserve(entry.target);
  }
}, {threshold: 0.55});
for (const node of document.querySelectorAll('[data-scene]')) sceneObserver.observe(node);
function sweepReveal() {
  const limit = window.innerHeight * 1.08;
  for (const node of revealNodes) {
    if (node.classList.contains('in')) continue;
    const rect = node.getBoundingClientRect();
    if (rect.top < limit && rect.bottom > -80) node.classList.add('in');
  }
}
sweepReveal();
let sweepQueued = false;
window.addEventListener('scroll', () => {
  if (sweepQueued) return;
  sweepQueued = true;
  requestAnimationFrame(() => { sweepQueued = false; sweepReveal(); });
}, {passive: true});

// Header becomes more opaque after leaving the first screen.
const header = document.querySelector('.v2-header');
const onScroll = () => header?.classList.toggle('scrolled', window.scrollY > 24);
onScroll();
window.addEventListener('scroll', onScroll, {passive: true});

// Hero image parallax on capable pointers; disabled for reduced motion.
const hero = document.querySelector('[data-parallax]');
const media = hero?.querySelector('.v2-hero-media');
if (hero && media && !reduced?.matches && window.matchMedia('(pointer: fine)').matches) {
  hero.addEventListener('pointermove', (event) => {
    const rect = hero.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    media.style.transform = `translate3d(${(-x * 14).toFixed(2)}px, ${(-y * 10).toFixed(2)}px, 0)`;
  }, {passive: true});
  hero.addEventListener('pointerleave', () => { media.style.transform = ''; });
}

// Appearance tabs.
const tabs = [...document.querySelectorAll('[data-v2-tab]')];
const panels = [...document.querySelectorAll('[data-v2-panel]')];
for (const tab of tabs) {
  tab.addEventListener('click', () => {
    const target = tab.dataset.v2Tab;
    for (const item of tabs) item.setAttribute('aria-selected', String(item === tab));
    for (const panel of panels) panel.classList.toggle('is-active', panel.dataset.v2Panel === target);
  });
}

// Real V2 outfit stage: the ring selects the left figure, and the caption
// follows the card that is actually at the front of the ring.
const outfitData = [
  {name:'冬季制服', cutout:'/assets/app/winter-cutout.png', toon:'/assets/app/winter-toon-cutout.png', spin:'/assets/app/winter-spin.webp'},
  {name:'黑色旗袍', cutout:'/assets/outfits/cutout-05.png'},
  {name:'双马尾', cutout:'/assets/outfits/cutout-06.png'},
  {name:'贝雷帽', cutout:'/assets/outfits/cutout-07.png'},
  {name:'象牙大衣', cutout:'/assets/app/character-cutout.png'},
  {name:'冰蓝连帽冬装', cutout:'/assets/outfits/cutout-09.png'},
  {name:'和服', cutout:'/assets/outfits/cutout-01.png'},
  {name:'夏日制服', cutout:'/assets/outfits/cutout-02.png'},
  {name:'泳装', cutout:'/assets/outfits/cutout-03.png'},
];
for (const item of outfitData) {
  for (const src of [item.cutout, item.toon, item.spin]) if (src) { const image = new Image(); image.src = src; }
}
const outfitName = document.querySelector('[data-v2-outfit-name]');
const ring = document.querySelector('[data-v2-ring]');
const ringCards = [...document.querySelectorAll('.v2-ring-card')];
const figure = document.querySelector('[data-v2-figure]');
const figureImage = document.querySelector('[data-v2-figure-img]');
const figureCaption = document.querySelector('[data-v2-figure-caption]');
const spinImage = document.querySelector('[data-v2-spin-img]');
const spinButton = document.querySelector('[data-v2-spin-button]');
const materialButtons = [...document.querySelectorAll('[data-v2-material]')];
let selected = 0;
let material = 'original';
let ringPausedTimer = 0;
let spinTimer = 0;

function renderFigure() {
  const item = outfitData[selected];
  if (!item) return;
  if (material === 'toon' && !item.toon) setMaterial('original', {render: false});
  const toon = material === 'toon';
  figureImage.src = toon && item.toon ? item.toon : item.cutout;
  figureImage.classList.remove('is-toon-filter');
  if (figureCaption) figureCaption.textContent = `3D 人物 · ${item.name}`;
  if (outfitName) outfitName.textContent = item.name;
  for (const [index, card] of ringCards.entries()) card.classList.toggle('selected', index === selected);
}

function setMaterial(next, {render = true} = {}) {
  material = next === 'toon' ? 'toon' : 'original';
  for (const other of materialButtons) other.setAttribute('aria-pressed', String(other.dataset.v2Material === material));
  if (figure) figure.dataset.material = material;
  if (render) renderFigure();
}

function playSpin() {
  if (!spinImage) return;
  clearTimeout(spinTimer);
  setMaterial('original');
  const item = outfitData[selected];
  spinImage.src = (item.spin || '/assets/app/winter-spin.webp') + '?t=' + Date.now();
  figure.classList.add('is-spinning');
  spinTimer = setTimeout(() => figure.classList.remove('is-spinning'), 1650);
}

function selectOutfit(index, {spin = false, pauseRing = false} = {}) {
  selected = ((index % outfitData.length) + outfitData.length) % outfitData.length;
  renderFigure();
  if (pauseRing && ring && !reduced?.matches) {
    ring.style.animationPlayState = 'paused';
    clearTimeout(ringPausedTimer);
    ringPausedTimer = setTimeout(() => { ring.style.animationPlayState = ''; }, 5000);
  }
  if (spin) playSpin();
}

for (const [index, card] of ringCards.entries()) {
  card.addEventListener('click', () => selectOutfit(index, {spin: index === 0, pauseRing: true}));
}
for (const button of materialButtons) {
  button.addEventListener('click', () => {
    if (button.dataset.v2Material === 'toon') {
      setMaterial('toon', {render: false});
      selectOutfit(0, {pauseRing: true});
    } else {
      setMaterial('original');
    }
  });
}
// The section opens with one real 360° capture instead of a frozen screenshot.
// It plays once, then returns to the selected still so the wardrobe stays calm.
const appearanceSection = document.querySelector('#characters');
if (appearanceSection) {
  // Keep the ring paused off-screen; otherwise it can finish several outfits
  // before the visitor reaches the section.
  const ringVisibility = new IntersectionObserver((entries) => {
    for (const entry of entries) appearanceSection.classList.toggle('is-active', entry.isIntersecting);
  }, {threshold: 0.12});
  ringVisibility.observe(appearanceSection);
  if (figure && !reduced?.matches) {
    const autoSpin = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      autoSpin.disconnect();
      setTimeout(() => { if (selected === 0 && material === 'original') playSpin(); }, 1100);
    }, {threshold: 0.35});
    autoSpin.observe(appearanceSection);
  }
}

spinButton?.addEventListener('click', () => {
  if (selected !== 0) selectOutfit(0);
  playSpin();
});

// Track the card at the front of the rotating ring. The CSS animation runs at
// 36 seconds per turn and the ring front advances one card every 40 degrees.
let lastFront = -1;
setInterval(() => {
  if (!ring) return;
  const matrix = new DOMMatrixReadOnly(getComputedStyle(ring).transform);
  const angle = Math.atan2(-matrix.m13, matrix.m11) * 180 / Math.PI;
  const front = ((Math.floor(-angle / 40) % 9) + 9) % 9;
  if (front === lastFront) return;
  lastFront = front;
  // Keep a user-clicked selection for the five-second inspection pause.
  if (ring.style.animationPlayState === 'paused') return;
  selectOutfit(front);
}, 220);
renderFigure();

// Real reference voice sample.
const voiceStage = document.querySelector('.v2-voice-stage');
for (const button of document.querySelectorAll('[data-v2-audio]')) {
  const audio = document.getElementById(button.dataset.v2Audio);
  if (!audio) continue;
  const label = button.textContent;
  button.addEventListener('click', async () => {
    try {
      if (audio.paused) {
        await audio.play();
        button.textContent = '暂停参考语音';
        voiceStage?.classList.add('is-playing');
      } else {
        audio.pause();
        audio.currentTime = 0;
        button.textContent = label;
        voiceStage?.classList.remove('is-playing');
      }
    } catch { button.textContent = '无法播放'; }
  });
  audio.addEventListener('ended', () => {
    button.textContent = label;
    voiceStage?.classList.remove('is-playing');
  });
}

// Close effect: only the chat window fades in place. The figure never moves.
const closeDemo = document.querySelector('[data-v2-close-demo]');
const closeButton = document.querySelector('[data-v2-close]');
let closeTimer = 0;
closeButton?.addEventListener('click', () => {
  if (!closeDemo) return;
  clearTimeout(closeTimer);
  closeDemo.classList.remove('is-closing');
  void closeDemo.offsetWidth;
  closeDemo.classList.add('is-closing');
  closeButton.textContent = '正在关闭窗口…';
  closeTimer = setTimeout(() => {
    closeDemo.classList.remove('is-closing');
    closeButton.textContent = '预览关闭';
  }, 2100);
});

// All-scene gallery: thumbnails swap the complete viewer, and dragging pans the
// captured scene so the page shows the same camera freedom as the desktop gallery.
const sceneViewer = document.querySelector('[data-scene-viewer]');
const sceneViewerImg = document.querySelector('[data-scene-viewer-img]');
const sceneViewerName = document.querySelector('[data-scene-viewer-name]');
const sceneThumbs = [...document.querySelectorAll('[data-scene-pick]')];
let scenePan = 0;
function resetScenePan() {
  scenePan = 0;
  if (sceneViewerImg) sceneViewerImg.style.transform = '';
}
for (const thumb of sceneThumbs) {
  thumb.addEventListener('click', () => {
    if (!sceneViewerImg || !sceneViewerName) return;
    sceneViewerImg.src = thumb.dataset.full;
    sceneViewerImg.alt = `${thumb.dataset.label}完整场景`;
    sceneViewerName.textContent = thumb.dataset.label;
    for (const other of sceneThumbs) other.setAttribute('aria-pressed', String(other === thumb));
    resetScenePan();
  });
}
const firstSceneThumb = sceneThumbs[0];
if (firstSceneThumb) firstSceneThumb.setAttribute('aria-pressed', 'true');
if (sceneViewer && sceneViewerImg && !reduced?.matches) {
  let drag = null;
  sceneViewer.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    drag = {id: event.pointerId, x: event.clientX, start: scenePan};
    sceneViewer.setPointerCapture(event.pointerId);
    sceneViewer.classList.add('is-dragging');
  });
  sceneViewer.addEventListener('pointermove', (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    scenePan = Math.max(-26, Math.min(26, drag.start + (event.clientX - drag.x) * 0.12));
    sceneViewerImg.style.transform = `scale(1.045) translateX(${scenePan.toFixed(2)}px)`;
  });
  const endDrag = (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    drag = null;
    sceneViewer.classList.remove('is-dragging');
  };
  sceneViewer.addEventListener('pointerup', endDrag);
  sceneViewer.addEventListener('pointercancel', endDrag);
  sceneViewer.addEventListener('lostpointercapture', endDrag);
}

// 2D illustration: a little pointer parallax, disabled for reduced motion.
const art2d = document.querySelector('[data-v2-2d]');
if (art2d && !reduced?.matches && window.matchMedia('(pointer: fine)').matches) {
  art2d.addEventListener('pointermove', (event) => {
    const rect = art2d.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    art2d.style.setProperty('--v2-px', `${(-x * 10).toFixed(2)}px`);
    art2d.style.setProperty('--v2-py', `${(-y * 8).toFixed(2)}px`);
  }, {passive: true});
  art2d.addEventListener('pointerleave', () => {
    art2d.style.setProperty('--v2-px', '0px');
    art2d.style.setProperty('--v2-py', '0px');
  });
}

// Typewriter in the conversation card; starts when the card enters view.
const typeNode = document.querySelector('[data-v2-type]');
const fullText = typeNode?.dataset.v2Type || '';
if (typeNode && fullText) {
  let started = false;
  const startTyping = () => {
    if (started) return;
    started = true;
    if (reduced?.matches) { typeNode.textContent = fullText; return; }
    let index = 0;
    let deleting = false;
    const tick = () => {
      if (!deleting) {
        index += 1;
        typeNode.textContent = fullText.slice(0, index);
        if (index >= fullText.length) { deleting = true; setTimeout(tick, 4200); return; }
        setTimeout(tick, 42 + Math.random() * 55);
      } else {
        index -= 1;
        typeNode.textContent = fullText.slice(0, Math.max(0, index));
        if (index <= 0) { deleting = false; setTimeout(tick, 900); return; }
        setTimeout(tick, 18);
      }
    };
    // Begin with a short pause so the section is settled.
    setTimeout(tick, 600);
  };
  const typeObserver = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) { startTyping(); typeObserver.disconnect(); }
  }, {threshold: 0.4});
  typeObserver.observe(typeNode.closest('.v2-chat-demo') || typeNode);
}
