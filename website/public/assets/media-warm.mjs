// One same-origin image queue for the product page. Nearby content can jump the
// queue; the rest waits for the hero and does not play or render offscreen.
const pending = new Map();
const decoded = new Map();
const rank = {low: 0, auto: 1, high: 2};
const connection = navigator.connection;
const narrow = matchMedia('(max-width: 680px)').matches;
const limit = (narrow || (navigator.deviceMemory && navigator.deviceMemory <= 4) ? 25 : 52) * 1024 * 1024;
let memory = 0, active = 0, released = false, timer = 0;
export const isDataConstrained = () => Boolean(connection?.saveData || /^(slow-)?2g$/.test(connection?.effectiveType || ''));
const homeVisible = () => location.pathname === '/' && !document.hidden;
const idle = callback => window.requestIdleCallback
  ? window.requestIdleCallback(callback,{timeout:650}) : setTimeout(callback,100);

function schedule() {
  if (timer) return;
  timer = setTimeout(() => { timer = 0; drain(); },0);
}
function drain() {
  if (!homeVisible()) return;
  const constrained = isDataConstrained();
  while (active < (constrained ? 2 : 4)) {
    const eligible = [...pending.values()].filter(item => !item.running &&
      (item.priority === 2 || (released && active < (constrained ? 1 : 3))))
      .sort((a,b) => b.priority-a.priority)[0];
    if (!eligible) return;
    eligible.running = true;
    active++;
    const image = new Image();
    image.decoding = 'async';
    image.fetchPriority = eligible.priority === 2 ? 'high' : eligible.priority === 1 ? 'auto' : 'low';
    image.src = eligible.key;
    const finish = result => {
      active--;
      pending.delete(eligible.key);
      if (result) {
        const bytes = result.naturalWidth * result.naturalHeight * 4;
        if (bytes <= limit) {
          while (memory + bytes > limit && decoded.size) {
            const oldest = decoded.keys().next().value;
            memory -= decoded.get(oldest).bytes;
            decoded.delete(oldest);
          }
          decoded.set(eligible.key,{image:result,bytes});
          memory += bytes;
        }
      }
      eligible.resolve(result);
      schedule();
    };
    image.decode().then(() => finish(image), () => finish(null));
  }
}
export function warmImage(url, {priority='low'}={}) {
  if (!url) return Promise.resolve(null);
  const key = new URL(url,location.href).href;
  const cached = decoded.get(key);
  if (cached) {
    decoded.delete(key); decoded.set(key,cached);
    return Promise.resolve(cached.image);
  }
  const level = rank[priority] ?? 0;
  const existing = pending.get(key);
  if (existing) {
    existing.priority = Math.max(existing.priority,level);
    schedule();
    return existing.promise;
  }
  const item = {key,priority:level,running:false};
  item.promise = new Promise(resolve => { item.resolve=resolve; });
  pending.set(key,item);
  schedule();
  return item.promise;
}

const hero = document.querySelector('.v2-hero-media img');
const afterPaint = () => new Promise(resolve => {
  if (document.hidden) { resolve(); return; }
  requestAnimationFrame(() => requestAnimationFrame(resolve));
});
export const afterHero = Promise.race([
  hero && location.pathname === '/' ? hero.decode().catch(() => {}) : Promise.resolve(),
  new Promise(resolve => setTimeout(resolve,1700)),
]).then(afterPaint).then(() => new Promise(resolve => idle(resolve))).then(() => {
  released = true; schedule();
});
document.addEventListener('visibilitychange',schedule);
window.addEventListener('popstate',schedule);
// The account view and home share one document. A same-page home link can
// change the path without causing popstate.
document.addEventListener('click',event => {
  if (event.target.closest?.('a[data-link]')) schedule();
},true);
