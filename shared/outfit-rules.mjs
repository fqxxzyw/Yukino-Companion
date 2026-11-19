// Single source of truth for outfit identity, display metadata and unlock
// rules. The Worker, the renderer, the main process and the account page all
// read this file. Add a new outfit here once; pages render from this list.
import data from './outfit-rules.json' with {type: 'json'};

const outfits = data.outfits
  .filter((item) => item && typeof item.id === 'string' && /^[a-z0-9-]+$/.test(item.id))
  .map((item) => Object.freeze({...item}))
  .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
const aliases = Object.freeze(Object.fromEntries(
  Object.entries(data.legacyAliases || {}).map(([legacy, ids]) => [
    legacy,
    Object.freeze(Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : []),
  ]),
));
const byId = new Map(outfits.map((item) => [item.id, item]));
const outfitIds = new Set(byId.keys());

export const OUTFIT_RULES = Object.freeze({
  version: String(data.version || ''),
  outfits: Object.freeze(outfits),
  legacyAliases: aliases,
});

export const OUTFIT_RULE_VERSION = OUTFIT_RULES.version;
export const OUTFIT_IDS = Object.freeze([...outfitIds]);
export const OUTFIT_KIND_LABELS = Object.freeze({
  base: '默认开放',
  'login-days': '累计登录',
  affection: '好感度',
});

export function outfitRuleById(id) {
  if (typeof id !== 'string' || !id) return null;
  if (byId.has(id)) return byId.get(id);
  const mapped = aliases[id];
  return mapped?.length ? byId.get(mapped[0]) || null : null;
}

export function canonicalOutfitIds(value) {
  const result = new Set();
  for (const id of Array.isArray(value) ? value : []) {
    if (typeof id !== 'string') continue;
    if (byId.has(id)) result.add(id);
    else for (const target of aliases[id] || []) if (byId.has(target)) result.add(target);
  }
  return [...result];
}

export function outfitCondition(rule, {current = 0, account = false} = {}) {
  if (!rule || rule.kind === 'base') return '默认开放';
  if (rule.kind === 'affection') return `好感度 ${Math.min(current, rule.target)} / ${rule.target}`;
  if (rule.kind === 'login-days') return `${account ? '累计登录' : '累计使用'} ${Math.min(current, rule.target)} / ${rule.target} 天`;
  return '解锁条件尚未配置';
}
