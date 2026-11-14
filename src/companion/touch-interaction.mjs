const HEAD_REACTIONS = [
  {reaction:'shy', zh:'……突然摸头，我会有点不知所措。', ja:'……急に頭を撫でられると、少し困るわ。'},
  {reaction:'happy', zh:'……这样轻轻的，倒也不错。', ja:'……そんなに優しくなら、悪くないわね。'},
  {reaction:'chide', zh:'真是的……只许这一次。', ja:'もう……今回だけよ。'},
];
const BOUNDARY_REACTION = {
  reaction:'boundary', zh:'请停一下，给我留一点空间。', ja:'少しやめて。もう少し距離を取ってくれる？',
};
const HEAD_COOLDOWN_MS = 4200;
const FEEDBACK_COOLDOWN_MS = 1800;
const BOUNDARY_WINDOW_MS = 5500;
const BOUNDARY_SAMPLE_GAP_MS = 220;
const BOUNDARY_COOLDOWN_MS = 45000;
const BOUNDARY_TAPS = 3;
const DEDUP_WINDOW_MS = 60000;
const MAX_RECENT_IDS = 256;

export function normalizeAvatarTouch(input) {
  const {id, zone, gesture} = input || {};
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(id)) return null;
  if (!['head','face','near'].includes(zone)) return null;
  if (gesture !== 'tap' && !(gesture === 'stroke' && zone === 'head')) return null;
  return {id, zone, gesture};
}

export function createTouchInteraction({now=Date.now, random=Math.random}={}) {
  const recent = new Map();
  let lastTime = -Infinity;
  let lastFeedback = -Infinity;
  let lastHead = -Infinity;
  let lastBoundary = -Infinity;
  let lastHeadReaction;
  let boundaryTaps = [];

  function accept(input) {
    const event = normalizeAvatarTouch(input);
    if (!event) return null;
    const time = now();
    if (!Number.isFinite(time) || time < lastTime) return null;
    lastTime = time;

    for (const [id, seen] of recent) {
      if (time - seen < DEDUP_WINDOW_MS) break;
      recent.delete(id);
    }
    if (recent.has(event.id) || recent.size >= MAX_RECENT_IDS) return null;
    recent.set(event.id, time);

    if (event.zone === 'head') {
      boundaryTaps = [];
      if (time - lastHead < HEAD_COOLDOWN_MS || time - lastFeedback < FEEDBACK_COOLDOWN_MS) return null;
      const choices = HEAD_REACTIONS.filter(item => item.reaction !== lastHeadReaction);
      const index = Math.min(choices.length - 1, Math.max(0, Math.floor(random() * choices.length) || 0));
      const reaction = choices[index];
      lastHeadReaction = reaction.reaction;
      lastFeedback = lastHead = time;
      return {id:event.id, ...reaction, relationshipEvent:null, voice:true};
    }

    if (time - lastBoundary < BOUNDARY_COOLDOWN_MS) return null;
    if (time - (boundaryTaps.at(-1) ?? -Infinity) < BOUNDARY_SAMPLE_GAP_MS) return null;
    boundaryTaps = boundaryTaps.filter(seen => time - seen <= BOUNDARY_WINDOW_MS);
    boundaryTaps.push(time);
    if (boundaryTaps.length > BOUNDARY_TAPS) boundaryTaps.shift();
    if (boundaryTaps.length < BOUNDARY_TAPS || time - lastFeedback < FEEDBACK_COOLDOWN_MS) return null;

    boundaryTaps = [];
    lastFeedback = lastBoundary = time;
    return {id:event.id, ...BOUNDARY_REACTION, relationshipEvent:'touch-boundary', voice:true};
  }

  function clearPending() {
    boundaryTaps = [];
  }

  return {accept, clearPending};
}
