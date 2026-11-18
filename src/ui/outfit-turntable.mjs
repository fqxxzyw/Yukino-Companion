import {skinGroups} from './skin-groups.mjs';

// 44B wardrobe turntable timing. The rotation starts after the short entrance
// and uses the accepted 740 ms + 185 ms per ring slot curve.
export const TURNTABLE_ENTRANCE_MS = 360;
export const TURNTABLE_EXIT_MS = 320;
export const TURNTABLE_BASE_MS = 740;
export const TURNTABLE_STEP_MS = 185;
export const TURNTABLE_MIN_SCALE = .8;

const TAU = Math.PI * 2;

export function turntableEase(value) {
  const t = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  // Quintic ease-in-out: slow start, fast middle, slow landing.
  return t < .5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2;
}

export function turntableRadius(count, aspect = 1) {
  const slots = Math.max(2, Math.floor(Number(count) || 2));
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const spread = 1 + Math.min(.22, Math.max(0, (ratio - .6) * .18));
  // Keep a real carousel footprint even in the narrow character panel. Edge
  // cropping is intended; shrinking every figure until nine fit is not.
  return Math.max(.9, slots * .15) * spread;
}

export function turntableSlot(index, count, radius, frontAngle = 0) {
  const slots = Math.max(2, Math.floor(Number(count) || 2));
  const angle = frontAngle + (index / slots) * TAU;
  return {
    angle,
    position: [Math.sin(angle) * radius, 0, Math.cos(angle) * radius],
    rotation: angle,
  };
}

export function turntablePlan(count, toIndex, {fromIndex = 0} = {}) {
  const slots = Math.max(2, Math.floor(Number(count) || 2));
  const target = ((Math.floor(Number(toIndex) || 0) % slots) + slots) % slots;
  const from = ((Math.floor(Number(fromIndex) || 0) % slots) + slots) % slots;
  const forward = (target - from + slots) % slots;
  const backward = (slots - forward) % slots;
  if (!forward) return {steps: 0, direction: 0, rotation: 0, duration: 0, forward, backward};
  // A tie is deliberately resolved to the same direction every time.
  const direction = forward < backward ? -1 : 1;
  const steps = Math.min(forward, backward);
  return {
    steps,
    direction,
    rotation: direction * steps * TAU / slots,
    duration: TURNTABLE_BASE_MS + TURNTABLE_STEP_MS * steps,
    forward,
    backward,
  };
}

function loadable(model) {
  return Boolean(model?.id && model.url && model.ready === true && model.reviewOnly !== true);
}

function preferred(group, selectedId, targetId) {
  const versions = group.versions || [];
  if (targetId && versions.some(model => model.id === targetId)) {
    return versions.find(model => model.id === targetId && loadable(model)) || null;
  }
  if (selectedId && versions.some(model => model.id === selectedId)) {
    const selected = versions.find(model => model.id === selectedId && loadable(model));
    if (selected) return selected;
  }
  return versions.find(model => model.approvedV2 === true && loadable(model)) || versions.find(loadable) || null;
}

// One model per outfit group, in the existing wardrobe order. The current
// outfit is rotated to slot zero, so the ring always opens on the character
// that is already on screen; the target index is then a shortest-path problem.
export function turntableOrder(models = [], selectedId = '', targetId = '') {
  const groups = skinGroups(models, selectedId);
  const currentGroup = groups.find(group => group.versions?.some(model => model.id === selectedId));
  const targetGroup = groups.find(group => group.versions?.some(model => model.id === targetId));
  if (!targetGroup) throw Error('目标服装不在当前衣橱中。');
  const items = groups.map(group => {
    const model = preferred(group, selectedId, targetId);
    return model ? {id: group.id, label: group.label, model} : null;
  }).filter(Boolean);
  const currentIndex = currentGroup
    ? items.findIndex(item => item.id === currentGroup.id)
    : 0;
  const start = currentIndex < 0 ? 0 : currentIndex;
  const ordered = [...items.slice(start), ...items.slice(0, start)];
  const targetIndex = ordered.findIndex(item => item.model.id === targetId);
  if (targetIndex < 0) throw Error('目标服装没有可加载的版本。');
  return {items: ordered, currentIndex: 0, targetIndex, count: ordered.length};
}
