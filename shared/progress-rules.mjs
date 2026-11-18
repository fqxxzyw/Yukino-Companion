// Server-authoritative progression rules. Both the Worker and the desktop
// account client read this module; the desktop never sends reward amounts.
// Keep this list in sync with src/companion/skin-unlocks.mjs (local guest rules).
export const PROGRESS_RULES = Object.freeze({
  version: '2026-11-17.1',
  timeZone: 'Asia/Shanghai',
  affection: Object.freeze({initial: 35, min: 35, max: 100}),
  dailyCheckIn: Object.freeze({affection: 2}),
  globalDailyAffectionCap: 12,
  events: Object.freeze({
    message: Object.freeze({affection: 1, dailyCap: 8}),
    'pet-interaction': Object.freeze({affection: 1, dailyCap: 6}),
    'manual-voice': Object.freeze({affection: 1, dailyCap: 3}),
  }),
  // Permanent login-day and affection unlocks. `base` skins need no cloud check.
  skins: Object.freeze([
    Object.freeze({id: 'yukino-01-v1', kind: 'login-days', target: 7}),
    Object.freeze({id: 'yukino-02-v1', kind: 'affection', target: 40}),
    Object.freeze({id: 'yukino-03-v1', kind: 'login-days', target: 7}),
    Object.freeze({id: 'yukino-04-v1', kind: 'affection', target: 50}),
    Object.freeze({id: 'yukino-05-v1', kind: 'affection', target: 60}),
    Object.freeze({id: 'yukino-06-v1', kind: 'affection', target: 70}),
    Object.freeze({id: 'yukino-07-v1', kind: 'base', target: 0}),
  ]),
});

export const EVENT_TYPES = Object.freeze(Object.keys(PROGRESS_RULES.events));
export const MAX_EVENTS_PER_REQUEST = 20;

// The server's business day is always Asia/Shanghai. Client clocks are used
// only for local hints, never to choose a cloud reward date.
export function businessDate(now = Date.now(), timeZone = PROGRESS_RULES.timeZone) {
  const date = new Date(Number.isFinite(now) ? now : Date.now());
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function clampAffection(value) {
  const {min, max, initial} = PROGRESS_RULES.affection;
  const number = Number.isFinite(value) ? value : initial;
  return Math.max(min, Math.min(max, Math.round(number)));
}

// Returns the skins that should exist for a confirmed progress row. Permanent
// rows are inserted with ON CONFLICT DO NOTHING and are never deleted here.
export function eligibleSkins({affection = PROGRESS_RULES.affection.initial, loginDays = 0} = {}) {
  return PROGRESS_RULES.skins
    .filter((skin) => {
      if (skin.kind === 'base') return false;
      if (skin.kind === 'affection') return clampAffection(affection) >= skin.target;
      if (skin.kind === 'login-days') return loginDays >= skin.target;
      return false;
    })
    .map((skin) => skin.id);
}

export function skinCatalog({affection = PROGRESS_RULES.affection.initial, loginDays = 0, unlocked = []} = {}) {
  const owned = new Set(unlocked);
  return PROGRESS_RULES.skins.map((skin) => {
    const current = skin.kind === 'affection' ? clampAffection(affection)
      : skin.kind === 'login-days' ? loginDays : 0;
    const eligible = skin.kind === 'base' || current >= skin.target;
    return {
      id: skin.id,
      kind: skin.kind,
      target: skin.target,
      current,
      eligible,
      unlocked: skin.kind === 'base' ? true : owned.has(skin.id) || eligible,
      rulesVersion: PROGRESS_RULES.version,
    };
  });
}

// OpenAPI-visible event limits, also used by tests and docs.
export function eventRule(type) {
  return Object.hasOwn(PROGRESS_RULES.events, type) ? PROGRESS_RULES.events[type] : null;
}
