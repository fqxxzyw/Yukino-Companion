import './scene-cinema.mjs?v=full-native-solar-27';
import './wardrobe.mjs?v=wardrobe-parallel-16';
// Small, dependency-free interactions for the product page. Content remains
// visible when this file fails to load; animations are opt-in via .v2-anim.
const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)');

// Quiet, reversible entrances. Never hide something while it is on screen.
const supplemental = '.v2-hero-copy, .v2-showcase > .v2-wrap:first-child, .v2-feature-copy .v2-kicker, .v2-feature-copy > .v2-tabs, .v2-wave, .v2-download-inner > :not([hidden]), .v2-footer-inner';
for (const el of document.querySelectorAll(supplemental)) {
  if (el.closest('[data-reveal]') !== null) continue;
  el.setAttribute('data-reveal', '');
}
const revealNodes = [...document.querySelectorAll('[data-reveal]')].filter(el => !el.closest('.scene-run'));
if (!reduced?.matches && 'IntersectionObserver' in window) {
  const enter = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) entry.target.classList.add('in');
    }
  }, {rootMargin:'0px 0px -7% 0px',threshold:.045});
  const exit = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const r = entry.boundingClientRect;
      if (!entry.isIntersecting && (r.bottom < 0 || r.top > innerHeight) &&
          !entry.target.contains(document.activeElement)) entry.target.classList.remove('in');
    }
  }, {rootMargin:'14% 0px 14% 0px',threshold:0});
  for (const node of revealNodes) {
    const r = node.getBoundingClientRect();
    if (r.width && r.height && r.top < innerHeight * .86 && r.bottom > 0) node.classList.add('in');
    enter.observe(node);
    exit.observe(node);
    node.addEventListener('focusin', () => node.classList.add('in'));
  }
  document.documentElement.classList.add('v2-anim');
}

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

// Explicit language switching; both replies exist in the DOM without timers.
const languageDemo = document.querySelector('[data-chat-preview]');
languageDemo?.addEventListener('click', event => {
  const button = event.target.closest('[data-chat-lang]');
  if (!button) return;
  const lang = button.dataset.chatLang;
  languageDemo.dataset.lang = lang;
  for (const control of languageDemo.querySelectorAll('[data-chat-lang]')) {
    control.setAttribute('aria-pressed',String(control === button));
  }
  for (const line of languageDemo.querySelectorAll('[data-chat-line]')) {
    line.hidden = lang !== 'both' && line.dataset.chatLine !== lang;
  }
});

// The figure is a sibling of the window, so closing never moves or crossfades it.
const closeDemo = document.querySelector('[data-v2-close-demo]');
const closeButton = closeDemo?.querySelector('[data-v2-close]');
const windowClose = closeDemo?.querySelector('[data-v3-window-close]');
const demoWindow = closeDemo?.querySelector('[data-v2-close-window]');
const windowCursor = closeDemo?.querySelector('[data-window-cursor]');
let autoPlayed = false;
let autoTimer;
let cursorAnimation;
let cursorEpoch = 0;
function cancelDemoAuto() {
  ++cursorEpoch;
  clearTimeout(autoTimer);
  cursorAnimation?.cancel();
  cursorAnimation = null;
  closeDemo?.classList.remove('is-cursor-moving','is-cursor-click','is-close-target');
}
function setDemoClosed(closed, fromWindow = false) {
  if (!closeDemo || !closeButton) return;
  if (fromWindow) closeButton.focus({preventScroll:true});
  closeDemo.classList.toggle('is-closing', closed);
  closeButton.textContent = closed ? '重播关窗' : '关闭窗口';
  closeButton.setAttribute('aria-pressed', String(closed));
  if (demoWindow) demoWindow.inert = closed;
}
async function playDemoClose() {
  if (!windowCursor || !windowClose || reduced?.matches || !windowCursor.animate) {
    autoPlayed = true;
    setDemoClosed(true);
    return;
  }
  const monitor = windowCursor.parentElement.getBoundingClientRect();
  const btn = windowClose.getBoundingClientRect();
  if (!monitor.width || !btn.width) return;
  const x = btn.left + btn.width * .5 - monitor.left - 2;
  const y = btn.top + btn.height * .5 - monitor.top - 2;
  const translate = (px,py) => `translate3d(${Math.round(px)}px,${Math.round(py)}px,0)`;
  const ticket = ++cursorEpoch;
  closeDemo.classList.add('is-cursor-moving');
  cursorAnimation=windowCursor.animate([
    {transform:translate(monitor.width*.105,monitor.height*.156),opacity:0,offset:0},
    {transform:translate(monitor.width*.118,monitor.height*.14),opacity:1,offset:.18},
    {transform:translate(monitor.width*.68,monitor.height*.10),opacity:1,offset:.72},
    {transform:translate(x,y),opacity:1,offset:1}
  ],{duration:980,easing:'cubic-bezier(.24,.55,.22,1)',fill:'forwards'});
  try { await cursorAnimation.finished; } catch { return; }
  if (ticket !== cursorEpoch) return;
  closeDemo.classList.add('is-cursor-click','is-close-target');
  autoTimer=setTimeout(()=>{
    if (ticket !== cursorEpoch) return;
    autoPlayed = true;
    setDemoClosed(true);
    autoTimer=setTimeout(cancelDemoAuto,340);
  },200);
}
closeButton?.addEventListener('click', () => {
  autoPlayed = true;
  cancelDemoAuto();
  if(closeDemo.classList.contains('is-closing')) {
    setDemoClosed(false);
    autoTimer=setTimeout(playDemoClose,reduced?.matches ? 800 : 700);
  } else playDemoClose();
});
windowClose?.addEventListener('click', () => {
  autoPlayed = true;
  cancelDemoAuto();
  setDemoClosed(true, true);
});
if (closeDemo && !reduced?.matches && 'IntersectionObserver' in window) {
  const desktopWatcher = new IntersectionObserver(([entry]) => {
    if (!entry?.isIntersecting || entry.intersectionRatio < .60) {
      if (!closeDemo.classList.contains('is-closing')) cancelDemoAuto();
      return;
    }
    if (autoPlayed) return;
    autoTimer = setTimeout(() => {
      if (!autoPlayed && !closeDemo.contains(document.activeElement)) {
        playDemoClose();
      }
    }, 1150);
  }, {threshold:.60});
  desktopWatcher.observe(closeDemo.querySelector('.v3-monitor') || closeDemo);
}

const sceneMenu = document.querySelector('.v3-scene-menu');
sceneMenu?.addEventListener('click', event => {
  if (event.target.closest('a')) sceneMenu.open = false;
});
sceneMenu?.addEventListener('keydown', event => {
  if (event.key === 'Escape' && sceneMenu.open) {
    sceneMenu.open = false;
    sceneMenu.querySelector('summary')?.focus({preventScroll:true});
  }
});
