'use strict';

// Electron window coordinates are device-independent pixels. Animate all four
// dimensions on one timeline so a resize never follows a completed move.
const KEYS = ['x', 'y', 'width', 'height'];
function validBounds(bounds) {
  return bounds && KEYS.every(key => Number.isFinite(bounds[key])) && bounds.width > 0 && bounds.height > 0;
}
function equalBounds(a, b) { return KEYS.every(key => Math.round(a[key]) === Math.round(b[key])); }
function transitionDuration(from, to) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const resize = Math.max(Math.abs(Math.log(to.width / from.width)), Math.abs(Math.log(to.height / from.height)));
  return Math.round(Math.min(800, Math.max(250, 250 + distance * 0.35 + resize * 250)));
}
// Use the measured canvas bottom-centre rather than the transparent window's
// edges: toolbar/input insets stay in native pixels while the canvas changes.
// Width and height are quantized first; derive x/y from the desired anchor so
// their rounding errors cannot accumulate into a second, opposing movement.
function interpolateBounds(from, to, progress, canvasInsets = {left:0,right:0,bottom:0}) {
  const t = Math.min(1, Math.max(0, progress));
  const eased = t * t * (3 - 2 * t);
  const {left,right,bottom}=canvasInsets;
  const lerp=(a,b)=>a+(b-a)*eased;
  const width=Math.round(lerp(from.width,to.width)),height=Math.round(lerp(from.height,to.height));
  const anchorX=bounds=>bounds.x+left+(bounds.width-left-right)/2;
  const anchorY=bounds=>bounds.y+bounds.height-bottom;
  const x=Math.round(lerp(anchorX(from),anchorX(to))-left-(width-left-right)/2);
  const y=Math.round(lerp(anchorY(from),anchorY(to))-height+bottom);
  return {x,y,width,height};
}

// `isCurrent` invalidates stale work when a newer open/close intent arrives.
// On cancellation leave the window at its current interpolated rectangle.
async function animateWindowBounds(win, target, options = {}) {
  if (!win || win.isDestroyed() || !validBounds(target)) return false;
  const from = win.getBounds();
  if (!validBounds(from)) return false;
  const final = Object.fromEntries(KEYS.map(key => [key, Math.round(target[key])]));
  const isCurrent = options.isCurrent || (() => true);
  const insets=options.canvasInsets;
  const validInsets=insets&&['left','right','bottom'].every(key=>Number.isFinite(insets[key])&&insets[key]>=0)&&insets.left+insets.right<Math.min(from.width,final.width)&&insets.bottom<Math.min(from.height,final.height);
  const anchorInsets=validInsets?insets:{left:0,right:0,bottom:0};
  if (!isCurrent()) return false;
  if (equalBounds(from, final)) return true;
  if (options.reducedMotion) { win.setBounds(final); return true; }
  const duration = Math.max(1, options.duration ?? transitionDuration(from, final));
  const now = options.now || (() => performance.now());
  const wait = options.wait || (() => new Promise(resolve => setTimeout(resolve, 16)));
  const start = now();
  let last = from;
  for (;;) {
    await wait();
    if (!isCurrent() || win.isDestroyed()) return false;
    const progress = Math.min(1, Math.max(0, (now() - start) / duration));
    const next = interpolateBounds(from, final, progress, anchorInsets);
    if (!equalBounds(last, next)) { win.setBounds(next); last = next; }
    if (progress >= 1) return true;
  }
}

module.exports = { animateWindowBounds, interpolateBounds, transitionDuration };
