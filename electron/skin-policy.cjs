'use strict';
// Local progression is not DRM/account authorization. IPC nevertheless obeys the
// same catalogue lock rules as the UI; editing local progress is not protected.
// Outfit identity and thresholds are read from the shared configuration.
const rules = require('../shared/outfit-rules.json');
const byId = new Map((rules.outfits || []).map((outfit) => [outfit.id, outfit]));
const aliases = rules.legacyAliases || {};
function canonicalOutfitIds(value) {
  const result = new Set();
  for (const id of Array.isArray(value) ? value : []) {
    if (typeof id !== 'string') continue;
    if (byId.has(id)) result.add(id);
    else for (const target of aliases[id] || []) if (byId.has(target)) result.add(target);
  }
  return result;
}
function outfitRule(id) {
  if (typeof id !== 'string' || !id) return null;
  if (byId.has(id)) return byId.get(id);
  const mapped = aliases[id];
  return mapped && mapped.length ? byId.get(mapped[0]) || null : null;
}
function validDate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number(value.slice(0,4))<1)return false;const date=new Date(value+'T00:00:00.000Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;}
function usedDays(value){const input=value&&typeof value==='object'&&!Array.isArray(value)?value:{},raw=Array.isArray(value)?value:Array.isArray(input.dates)?input.dates:Array.isArray(input.usedDates)?input.usedDates:[];let through=input.version===1&&validDate(input.archivedThrough)?input.archivedThrough:'';const limit=through?Math.floor((Date.parse(through+'T00:00:00.000Z')-Date.parse('0001-01-01T00:00:00.000Z'))/86400000)+1:0;const archived=through&&Number.isSafeInteger(input.archivedCount)&&input.archivedCount>=0?Math.min(input.archivedCount,limit):0;if(!archived)through='';return new Set(raw.filter(validDate).filter(date=>!through||date>through)).size+archived;}
function canUseSkin(entry,state={}){
  if(!entry?.ready||/hold/i.test(entry.status||'')||entry.hold)return false;
  const rule=outfitRule(entry.id),relationship=state.relationship||{};
  const owned=canonicalOutfitIds(relationship.cloudUnlocked);
  if(owned.has(entry.id)||Boolean(rule&&owned.has(rule.id)))return true;
  if(relationship.skinPreviewEnabled===true)return true;
  if(!rule)return !String(entry.id||'').startsWith('yukino-');
  if(rule.kind==='base')return true;
  if(relationship.cloudAuthoritative===true)return false;
  if(rule.kind==='login-days')return usedDays(state.usedDates)>=rule.target;
  if(rule.kind==='affection')return (Number.isFinite(relationship.affection)?Math.max(0,Math.min(100,relationship.affection)):35)>=rule.target;
  return false;
}
module.exports={canUseSkin,usedDays,outfitRule,canonicalOutfitIds};
