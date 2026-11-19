// Local progression only. Dates are awarded by explicit use events, never by
// uptime, installation age, opening the app, or replaying a usage timer.
// Outfit identity and thresholds come from shared/outfit-rules.json. A signed-in
// account is governed only by the server-confirmed list, not by local counters.
import {OUTFIT_RULES,canonicalOutfitIds,outfitCondition,outfitRuleById} from '../../shared/outfit-rules.mjs';
export const MAX_USED_DATES=3650;
export const SWIMSUIT_USED_DAYS=outfitRuleById('swimsuit-v2')?.target||2;
export const AFFINITY_THRESHOLDS=Object.freeze(Object.fromEntries(OUTFIT_RULES.outfits.filter(outfit=>outfit.kind==='affection').map(outfit=>[outfit.id,outfit.target])));
export const USE_EVENT_TYPES=Object.freeze(['message','pet-interaction','manual-voice','checkin']);
const useEvents=new Set(USE_EVENT_TYPES);
const ISO_DATE=/^\d{4}-\d{2}-\d{2}$/;
const DAY=86400000;
function validDate(value){
 if(typeof value!=='string'||!ISO_DATE.test(value)||Number(value.slice(0,4))<1)return false;
 const date=new Date(`${value}T00:00:00.000Z`);
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
export function localDateKey(now=Date.now()){
 const date=new Date(now);
 if(!Number.isFinite(date.getTime()))return '';
 const year=date.getFullYear();if(year<1||year>9999)return '';
 return `${String(year).padStart(4,'0')}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
function archiveCountLimit(date){return Math.floor((Date.parse(`${date}T00:00:00.000Z`)-Date.parse('0001-01-01T00:00:00.000Z'))/DAY)+1;}
export function normalizeUsedDates(value){
 const input=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
 // Older counters, first-use timestamps and elapsed hours cannot establish that
 // the app was actually used on specific dates. Migrate only explicit dates.
 const raw=Array.isArray(value)?value:Array.isArray(input.dates)?input.dates:Array.isArray(input.usedDates)?input.usedDates:[];
 let archivedThrough=input.version===1&&validDate(input.archivedThrough)?input.archivedThrough:'';
 let archivedCount=archivedThrough&&Number.isSafeInteger(input.archivedCount)&&input.archivedCount>=0?Math.min(input.archivedCount,archiveCountLimit(archivedThrough)):0;
 if(!archivedCount)archivedThrough='';
 let dates=[...new Set(raw.filter(validDate))].filter(date=>!archivedThrough||date>archivedThrough).sort();
 if(dates.length>MAX_USED_DATES){const remove=dates.length-MAX_USED_DATES;archivedCount+=remove;archivedThrough=dates[remove-1];dates=dates.slice(remove);}
 return {version:1,dates,archivedCount,archivedThrough,lifetimeCount:archivedCount+dates.length};
}
export function usedDateStatus(value,now=Date.now()){
 const state=normalizeUsedDates(value),date=localDateKey(now),lastDate=state.dates.at(-1)||state.archivedThrough;
 return {totalDays:state.lifetimeCount,date,lastDate,usedToday:Boolean(date&&state.dates.includes(date)),archivedDate:Boolean(date&&state.archivedThrough&&date<=state.archivedThrough),clockRollback:Boolean(date&&lastDate&&date<lastDate),swimsuitDays:Math.min(SWIMSUIT_USED_DAYS,state.lifetimeCount),swimsuitRequired:SWIMSUIT_USED_DAYS};
}
export function recordUsedDate(value,{type,now=Date.now()}={}){
 const state=normalizeUsedDates(value),date=localDateKey(now);
 const result=reason=>({state,added:false,reason,date,totalDays:state.lifetimeCount});
 if(!useEvents.has(type))return result('not-user-activity');
 if(!date)return result('invalid-date');
 if(state.dates.includes(date))return result('already-counted');
 if(state.archivedThrough&&date<=state.archivedThrough)return result('archived-date');
 const last=state.dates.at(-1)||state.archivedThrough;
 if(last&&date<last)return result('clock-rollback');
 const next=normalizeUsedDates({...state,dates:[...state.dates,date]});
 return {state:next,added:true,reason:'recorded',date,totalDays:next.lifetimeCount};
}
export function skinRule(model){
 const id=typeof model==='string'?model:model?.id||'',configured=outfitRuleById(id);
 if(configured)return {kind:configured.kind,target:configured.target,outfitId:configured.id,label:configured.label};
 if(id.startsWith('yukino-'))return {kind:'unconfigured',target:0};
 return {kind:'base',target:0}; // Explicitly imported local models stay independent.
}
export function getSkinStatus(model,{relationship,usedDates}={}){
 const rule=skinRule(model),cloudAuthoritative=relationship?.cloudAuthoritative===true;
 const raw=cloudAuthoritative?relationship?.cloudAffection:relationship?.affection;
 const affection=Number.isFinite(raw)?Math.max(0,Math.min(100,raw)):(cloudAuthoritative?0:35);
 const totalDays=cloudAuthoritative
  ?(Number.isFinite(relationship?.cloudLoginDays)?Math.max(0,Math.floor(relationship.cloudLoginDays)):0)
  :normalizeUsedDates(usedDates).lifetimeCount;
 const current=rule.kind==='affection'?affection:rule.kind==='login-days'?totalDays:0;
 const preview=relationship?.skinPreviewEnabled===true;
 const owned=new Set(canonicalOutfitIds(relationship?.cloudUnlocked));
 const cloudUnlocked=owned.has(model?.id)||Boolean(rule.outfitId&&owned.has(rule.outfitId));
 // A signed-in account never falls back to local counters. The cached,
// server-confirmed list is the only source of earned outfit rights offline.
 const eligible=cloudUnlocked||preview||rule.kind==='base'||(!cloudAuthoritative&&rule.kind!=='unconfigured'&&current>=rule.target);
 const hold=model?.hold===true||/hold/i.test(String(model?.status||''));
 const available=model?.ready===true&&!hold;
 const requirement=outfitCondition(rule,{current,account:cloudAuthoritative});
 const reason=hold?'模型仍待确认，暂不可选':!available?'模型资源尚未准备好':cloudUnlocked?'账号已确认':preview&&rule.kind!=='base'?'本地预览':eligible?(rule.kind==='base'?'默认开放':'已解锁'):requirement;
 return {id:model?.id||'',rule,affection,totalDays,current,target:rule.target,eligible,available,hold,preview,cloudUnlocked,cloudAuthoritative,unlocked:eligible&&available,progress:rule.kind==='base'?1:rule.kind==='unconfigured'?0:Math.min(1,Math.max(0,current/rule.target)),requirement,reason};
}
// Deterministic user-command routing only. Model/assistant text cannot grant an
// unlock or issue an automatic skin command, and all seven base outfits must pass.
export function conversationSkin(text,models,progress,{role='user',enabled=true}={}){
 if(!enabled||role!=='user'||typeof text!=='string'||!/(?:换上|换成|切换到|切换成|穿上)/.test(text))return null;
 const defaults=OUTFIT_RULES.outfits.filter(outfit=>outfit.kind==='base'),base=defaults.map(rule=>models.find(item=>item.id===rule.id));
 if(base.some(item=>!item||!getSkinStatus(item,progress).unlocked))return null;
 const requested=[...models].filter(item=>!item.retired&&item.label&&text.includes(item.label)).sort((a,b)=>b.label.length-a.label.length)[0];
 if(requested&&getSkinStatus(requested,progress).unlocked)return requested.id;
 if(/(?:换上|换成|切换到|切换成|穿上)\s*(?:原版)?校服/.test(text))return models.find(item=>item.id==='summer-uniform-v2'&&item.ready)?.id||null;
 return null;
}
// Preserve explicit legacy per-day records without inventing dates from total
// hours/install age. These are recorded usage, not proof of a historical click.
export function migrateRecordedUsageDates(value,days,{now=Date.now(),alreadyMigrated=false}={}){
 const original=normalizeUsedDates(value),today=localDateKey(now);
 if(alreadyMigrated||!today)return {state:original,imported:0,legacyDates:[],migrated:false};
 const records=days&&typeof days==='object'&&!Array.isArray(days)?Object.entries(days).slice(0,20000):[];
 const legacyDates=records.filter(([date,row])=>validDate(date)&&date<today&&row&&typeof row==='object'&&((Number.isFinite(row.usageMs)&&row.usageMs>0)||(Number.isFinite(row.companionshipMs)&&row.companionshipMs>0))).map(([date])=>date).sort();
 const state=normalizeUsedDates({...original,dates:[...original.dates,...legacyDates]});
 return {state,imported:Math.max(0,state.lifetimeCount-original.lifetimeCount),legacyDates,migrated:true};
}
