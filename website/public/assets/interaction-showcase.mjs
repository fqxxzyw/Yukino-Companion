// This is a scripted, browser-local showcase. No desktop API, data collection,
// vision model call, permission prompt, or account endpoints are used.
const reduceMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : {matches: false};

let petSheetPromise;
function loadPetSheet() {
  if (petSheetPromise) return petSheetPromise;
  petSheetPromise = new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => image.naturalWidth === 960 && image.naturalHeight === 208
      ? resolve(image) : reject(new Error('Unexpected sprite sheet size.'));
    image.onerror = () => reject(new Error('Sprite sheet unavailable.'));
    image.src = '/assets/pet-demo/wave-strip.png';
  }).catch(error => { petSheetPromise = undefined; throw error; });
  return petSheetPromise;
}
const waveFrames = [130, 105, 165, 230];

function attachPet(demo) {
  if (demo.dataset.ykxBound) return;
  demo.dataset.ykxBound = 'true';
  const status = demo.querySelector('[data-ykx-pet-status]');
  const window = demo.querySelector('[data-ykx-pet-window]');
  const toggle = demo.querySelector('button.ykx-primary[data-ykx-pet-close]');
  const canvas = demo.querySelector('[data-ykx-pet-canvas]');
  const still = demo.querySelector('.ykx-pet-sprite img');
  const context = canvas?.getContext('2d');
  if (!status || !window || !toggle || !context || !still) return;
  let revision = 0, timeout = 0;
  const draw = (sheet, row = 0, column = 0) => {
    context.clearRect(0, 0, 192, 208);
    const frame = row === 3 ? column + 1 : 0;
    context.drawImage(sheet, frame * 192, 0, 192, 208, 0, 0, 192, 208);
    canvas.hidden = false;
    still.hidden = true;
  };
  const wave = async () => {
    clearTimeout(timeout);
    const current = ++revision;
    status.textContent = '「嗯，你好。」';
    try {
      const sheet = await loadPetSheet();
      if (current !== revision || !demo.isConnected) return;
      if (reduceMotion.matches || document.hidden) { draw(sheet, 3, 2); return; }
      const frame = index => {
        if (current !== revision || !demo.isConnected) return;
        if (index >= waveFrames.length || document.hidden || reduceMotion.matches) { draw(sheet); return; }
        draw(sheet, 3, index);
        timeout = setTimeout(() => frame(index + 1), waveFrames[index]);
      };
      frame(0);
    } catch {
      status.textContent = '「嗯，你好。」';
    }
  };
  demo.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || !demo.contains(button)) return;
    if (button.matches('[data-ykx-pet-wave]')) { void wave(); return; }
    if (!button.matches('[data-ykx-pet-close]')) return;
    const closed = demo.dataset.ykxClosed !== 'true';
    demo.dataset.ykxClosed = String(closed);
    if (closed && window.contains(document.activeElement)) toggle.focus({preventScroll: true});
    window.inert = closed;
    window.setAttribute('aria-hidden', String(closed));
    toggle.setAttribute('aria-pressed', String(closed));
    toggle.textContent = closed ? '重新打开聊天窗' : '关上聊天窗';
    status.textContent = closed ? '聊天窗关了，她还在。' : '聊天窗打开了。';
  });
  // Only load the five-frame strip made from the authentic app sprite sheet when a visitor approaches this section.
  // Keep the Q portrait as fallback, avoiding layout change when the demo is off-screen.
  const showIdle = () => loadPetSheet().then(sheet => {
    if (!revision && demo.isConnected) draw(sheet);
  }).catch(() => {});
  if (typeof IntersectionObserver === 'function') {
    const observer = new IntersectionObserver(items => {
      if (!items.some(item => item.isIntersecting)) return;
      observer.disconnect(); void showIdle();
    }, {rootMargin: '100px'});
    observer.observe(demo);
  }
}

function initialize() {
  for (const demo of document.querySelectorAll('[data-ykx-pet]')) attachPet(demo);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, {once:true});
else initialize();
