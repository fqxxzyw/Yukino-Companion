// Local interaction state, not a diagnosis or proof of payment. No text is uploaded.
// The renderer may use mood as an animation hint; ordinary sadness never deducts affection.
const clamp = (value, fallback) => Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : fallback;
const safeNow = value => Number.isFinite(value) && value >= 0 ? value : Date.now();
const DAY = 86400000;
export function dayKey(now) {
  const date = new Date(safeNow(now));
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function createRelationship(now=Date.now()) {
  return {version:1,affection:35,stamina:100,lastUpdated:safeNow(now),lastMessage:0,turns:0,checkinDays:0,lastCheckin:'',lastCheckinAt:0,rewardDay:'',rewardToday:0,recentEvents:[],boundaryUntil:0};
}
function normalize(value, now) {
  const input=value&&typeof value==='object'?value:{},base=createRelationship(now);
  const out={...base,affection:clamp(input.affection,35),stamina:clamp(input.stamina,100)};
  for(const key of ['lastUpdated','lastMessage','lastCheckinAt','boundaryUntil']) if(Number.isFinite(input[key])&&input[key]>=0)out[key]=input[key];
  for(const key of ['turns','checkinDays','rewardToday']) if(Number.isFinite(input[key]))out[key]=Math.max(0,Math.min(100000,Math.floor(input[key])));
  for(const key of ['lastCheckin','rewardDay']) if(/^\d{4}-\d{2}-\d{2}$/.test(input[key]||''))out[key]=input[key];
  if(Array.isArray(input.recentEvents))out.recentEvents=input.recentEvents.filter(x=>typeof x==='string'&&x.length<=150).slice(-100);
  return out;
}
function rested(value, now) {
  const out=normalize(value,now);
  // Clock rollback never creates recovery or more daily rewards. A huge clock jump
  // can refill stamina, but cannot generate check-ins or paid entitlements.
  const elapsed=Math.max(0,Math.min(DAY,now-out.lastUpdated));
  out.stamina=clamp(out.stamina+elapsed/60000*2,100);
  out.lastUpdated=Math.max(out.lastUpdated,now);
  if(now-out.lastMessage>15*60000)out.turns=0;
  return out;
}
export function advanceRelationship(value,{type,id,now=Date.now()}={}) {
  now=safeNow(now);
  const out=rested(value,now);
  if(!['message','checkin','kindness','boundary'].includes(type))return out;
  if(typeof id!=='string'||!id||id.length>150)throw Error('互动记录需要唯一编号');
  if(out.recentEvents.includes(id))return out;
  out.recentEvents=[...out.recentEvents,id].slice(-100);
  const today=dayKey(now);
  if(today>out.rewardDay){out.rewardDay=today;out.rewardToday=0;}
  if(type==='message'){
    out.turns+=1;out.lastMessage=Math.max(out.lastMessage,now);
    out.stamina=clamp(out.stamina-(out.turns>5?4:2),100);
  }else if(type==='kindness'){
    if(today===out.rewardDay&&out.rewardToday<3){out.affection=clamp(out.affection+1,35);out.rewardToday+=1;}
  }else if(type==='boundary'){
    // Only an explicit, reviewable boundary event may deduct affection.
    // This module deliberately has no keyword sentiment classifier.
    out.affection=clamp(out.affection-2,35);out.stamina=clamp(out.stamina-4,100);out.boundaryUntil=now+5*60000;
  }else if(type==='checkin'&&today>out.lastCheckin&&now>=out.lastCheckinAt){
    out.lastCheckin=today;out.lastCheckinAt=now;out.checkinDays+=1;out.affection=clamp(out.affection+2,35);
  }
  return out;
}
export function summarizeRelationship(value,now=Date.now()) {
  now=safeNow(now);const out=rested(value,now);
  const mood=out.boundaryUntil>now?'uncomfortable':out.stamina<25?'tired':out.affection>=60?'content':'calm';
  return {affection:Math.round(out.affection),stamina:Math.round(out.stamina),mood,
    moodLabel:{calm:'平静',content:'愉快',tired:'有些疲倦',uncomfortable:'需要一点空间'}[mood],
    checkinDays:out.checkinDays,checkedToday:dayKey(now)<=out.lastCheckin,
    unlocks:[3,7,14].filter(days=>out.checkinDays>=days).map(days=>`checkin-${days}`),
    sponsorAvailable:false};
}
