'use strict';
// Behaviour and settings parity with the original YukinoPet desktop companion.
const PET_DEFAULTS = Object.freeze({opacity:1,interactionPaused:false,randomQuotes:true,interactionQuotes:true,nightReminders:true,showBubbles:true,quietMode:false,soundEnabled:true,soundVolume:.35,startup:false,focusEnds:0});
function petPreferences(input) {
  const value={...PET_DEFAULTS,...input};
  for(const [name,min,max] of [['opacity',.35,1],['soundVolume',0,1]]) {
    if(typeof value[name]!=='number'||!Number.isFinite(value[name])||value[name]<min||value[name]>max)throw Error(name==='opacity'?'透明度应在 35%–100% 之间':'桌宠音量应在 0%–100% 之间');
  }
  const result={opacity:value.opacity,soundVolume:value.soundVolume};
  for(const name of ['interactionPaused','randomQuotes','interactionQuotes','nightReminders','showBubbles','quietMode','soundEnabled','startup'])result[name]=!!value[name];
  result.focusEnds=Number.isSafeInteger(value.focusEnds)&&value.focusEnds>=0?value.focusEnds:0;
  return result;
}
function parseLegacySettings(text) {
  const source=Object.fromEntries(text.split(/\r?\n/).filter(line=>line.includes('=')).map(line=>{const n=line.indexOf('=');return [line.slice(0,n).trim().toLowerCase(),line.slice(n+1).trim()]}));
  const result={};
  for(const [from,to] of Object.entries({interactionpaused:'interactionPaused',randomquotes:'randomQuotes',interactionquotes:'interactionQuotes',nightreminders:'nightReminders',showbubbles:'showBubbles',quietmode:'quietMode',soundenabled:'soundEnabled',topmost:'alwaysOnTop'}))if(/^(true|false)$/i.test(source[from]||''))result[to]=source[from].toLowerCase()==='true';
  if(/^(true|false)$/i.test(source.paused||''))result.animation=source.paused.toLowerCase()!=='true';
  for(const [from,min,max] of [['scale',.6,2],['opacity',.35,1],['soundvolume',0,1]]){const number=Number(source[from]);if(source[from]!==undefined&&Number.isFinite(number))result[from==='soundvolume'?'soundVolume':from]=Math.max(min,Math.min(max,number));}
  if(Number.isFinite(Number(source.left))&&Number.isFinite(Number(source.top)))result.positions={pet:{x:Math.round(Number(source.left)),y:Math.round(Number(source.top))}};
  return result;
}
function allowedHour(entry,hour){return entry.StartHour===entry.EndHour||(entry.StartHour<entry.EndHour?hour>=entry.StartHour&&hour<entry.EndHour:hour>=entry.StartHour||hour<entry.EndHour);}
class QuotePicker {
  constructor(entries,{random=Math.random,now=Date.now}={}){this.entries=entries;this.random=random;this.now=now;this.lastGlobal=-Infinity;this.byText=new Map();this.byCategory=new Map();}
  pick(trigger,{mood='Calm',affection=12,action='idle',high=false}={}){
    const now=this.now(),hour=new Date(now).getHours();
    if(now-this.lastGlobal<(high?1500:30000))return null;
    const candidates=this.entries.filter(e=>e.TriggerType?.toLowerCase()===trigger.toLowerCase()&&(!e.RequiredState||e.RequiredState==='Any'||e.RequiredState===mood)&&affection>=(e.MinAffection||0)&&affection<=(e.MaxAffection||100)&&(!e.RequiredAction||e.RequiredAction==='Any'||e.RequiredAction===action)&&allowedHour(e,hour)&&(e.AllowRepeat||now-(this.byText.get(e.Text)??-Infinity)>=Math.max(90,e.CooldownSeconds||0)*1000)&&now-(this.byCategory.get(e.Category)??-Infinity)>=Math.max(4,(e.CooldownSeconds||0)/3)*1000);
    let roll=this.random()*candidates.reduce((n,e)=>n+Math.max(1,e.Weight||1),0);
    for(const entry of candidates){roll-=Math.max(1,entry.Weight||1);if(roll<0){this.lastGlobal=now;this.byText.set(entry.Text,now);this.byCategory.set(entry.Category,now);return entry;}}
    return null;
  }
}
module.exports={PET_DEFAULTS,petPreferences,parseLegacySettings,allowedHour,QuotePicker};
