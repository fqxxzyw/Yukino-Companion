// Server-authoritative progression rules. Both the Worker and the desktop
// account client read this module; the desktop never sends reward amounts.
// Outfit unlock rules live in shared/outfit-rules.json so the account page,
// renderer, main process and Worker all read one list.
import {OUTFIT_RULES, canonicalOutfitIds} from './outfit-rules.mjs';

export const PROGRESS_RULES = Object.freeze({
  version: '2026-11-19.1',
  timeZone: 'Asia/Shanghai',
  affection: Object.freeze({initial: 35, min: 35, max: 100}),
  dailyCheckIn: Object.freeze({affection: 2}),
  globalDailyAffectionCap: 12,
  events: Object.freeze({
    message: Object.freeze({affection: 1, dailyCap: 8}),
    'pet-interaction': Object.freeze({affection: 1, dailyCap: 6}),
    'manual-voice': Object.freeze({affection: 1, dailyCap: 3}),
  }),
  // Permanent login-day and affection unlocks. `base` outfits need no cloud
  // check. The catalog is generated from the shared outfit configuration.
  skins: Object.freeze(OUTFIT_RULES.outfits.map((outfit) => Object.freeze({
    id: outfit.id,
    label: outfit.label,
    kind: outfit.kind,
    target: outfit.target,
    order: outfit.order,
  }))),
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
  // Existing rows may use the retired V1 ids. They are permanently preserved
  // in the database and map to the matching approved V2 outfit here; no row is
  // ever deleted or silently revoked.
  const owned = new Set(canonicalOutfitIds(unlocked));
  return PROGRESS_RULES.skins.map((skin) => {
    const current = skin.kind === 'affection' ? clampAffection(affection)
      : skin.kind === 'login-days' ? loginDays : 0;
    const eligible = skin.kind === 'base' || current >= skin.target;
    return {
      id: skin.id,
      label: skin.label,
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
