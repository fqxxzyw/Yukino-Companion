'use strict';
const {performance}=require('node:perf_hooks');

const INTERVAL_MINUTES=Object.freeze([30,45,60,90,120]);
const REMINDER_DEFAULTS=Object.freeze({enabled:false,intervalMinutes:60});
const LIMITS=Object.freeze({idleSeconds:300,maxTickGapMs:60000,returnGraceMs:30000,reminderCooldownMs:15*60000,greetingCooldownMs:5*60000,globalCooldownMs:30000,rememberedResults:128});
const REMINDER_TEXT='已经连续使用电脑一段时间，休息一下眼睛和肩颈吧。';
const GREETING_TEXT='我在这里。需要我帮你看看或聊一会儿吗？';
const PROACTIVE_INTERVALS=Object.freeze([10,20,30,60,120]);
const PROACTIVE_DEFAULTS=Object.freeze({enabled:false,mode:'fixed',intervalMinutes:60,startHour:8,endHour:22,text:'在忙吗？有空的时候聊一会儿吧。',prompt:'结合当前角色的性格，自然地向我发起一句简短聊天。'});
function validateProactiveConfig(value={}) {
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('主动陪伴设置无效。');
  const v={...PROACTIVE_DEFAULTS,...value};
  if(typeof v.enabled!=='boolean'||!['fixed','generate'].includes(v.mode)||!Number.isInteger(v.intervalMinutes)||v.intervalMinutes<5||v.intervalMinutes>1440||![v.startHour,v.endHour].every(h=>Number.isInteger(h)&&h>=0&&h<=23)||typeof v.text!=='string'||v.text.length>200||typeof v.prompt!=='string'||v.prompt.length>500)throw Error('主动陪伴设置无效，间隔需为 5–1440 分钟。');
  if(v.enabled&&!(v.mode==='fixed'?v.text:v.prompt).trim())throw Error('请输入主动消息或生成提示词。');
  return {enabled:v.enabled,mode:v.mode,intervalMinutes:v.intervalMinutes,startHour:v.startHour,endHour:v.endHour,text:v.text,prompt:v.prompt};
}
function withinHours(hour,start,end){return Number.isInteger(hour)&&hour>=0&&hour<24&&(start===end||(start<end?hour>=start&&hour<end:hour>=start||hour<end));}

function validateReminderConfig(value={}) {
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('陪伴提醒设置无效。');
  const enabled=value.enabled===undefined?REMINDER_DEFAULTS.enabled:value.enabled;
  const intervalMinutes=value.intervalMinutes===undefined?REMINDER_DEFAULTS.intervalMinutes:value.intervalMinutes;
  if(typeof enabled!=='boolean'||!INTERVAL_MINUTES.includes(intervalMinutes))throw Error('提醒间隔只能选择 30、45、60、90 或 120 分钟。');
  return {enabled,intervalMinutes};
}
function activity(value={}) {
  const visible=value?.companionVisible===true;
  const present=visible&&value.locked!==true&&value.suspended!==true&&Number.isFinite(value.systemIdleSeconds)&&value.systemIdleSeconds>=0&&value.systemIdleSeconds<LIMITS.idleSeconds;
  return {present,deliver:present&&value.quiet!==true&&value.focus!==true&&value.chatBusy!==true&&value.speechBusy!==true};
}

/** Pure event policy. It owns no timer, native capture, audio, persistence or history. */
class CompanionReminderPolicy {
  constructor({now=()=>performance.now(),config=REMINDER_DEFAULTS,proactive=PROACTIVE_DEFAULTS}={}) {
    if(typeof now!=='function')throw Error('提醒计时器无效。');
    this.now=now;this.config=validateReminderConfig(config);this.proactive=validateProactiveConfig(proactive);this.reset();
  }
  configureProactive(value={}) {
    const next=validateProactiveConfig({...this.proactive,...value});
    if(next.enabled!==this.proactive.enabled||next.intervalMinutes!==this.proactive.intervalMinutes||next.mode!==this.proactive.mode)this.proactiveMs=0;
    this.proactive=next;
    return this.snapshot();
  }
  configure(patch={}) {
    if(!patch||typeof patch!=='object'||Array.isArray(patch))throw Error('陪伴提醒设置无效。');
    const next=validateReminderConfig({...this.config,...patch});
    // Enabling/disabling must not retroactively count the disabled period.
    if(next.enabled!==this.config.enabled){this.activeUsageMs=0;this.lastTick=null;this.wasPresent=false;this.returnActiveMs=0;}
    this.config=next;
    return this.snapshot();
  }
  reset() {
    this.activeUsageMs=0;this.proactiveMs=0;this.returnActiveMs=0;this.lastTick=null;this.wasPresent=false;
    this.lastReminderAt=-Infinity;this.lastGreetingAt=-Infinity;this.lastEventAt=-Infinity;
    this.seenResults=new Map();this.sequence=0;this.current={present:false,deliver:false};
    return this.snapshot();
  }
  advance(input) {
    const stamp=this.now(),state=activity(input);
    if(!Number.isFinite(stamp)){this.lastTick=null;this.wasPresent=false;this.returnActiveMs=0;this.current={present:false,deliver:false};return null;}
    const previous=this.lastTick,delta=previous===null?0:stamp-previous;
    this.lastTick=stamp;this.current=state;
    if(previous!==null&&delta<0) {
      // Clock rollback never grants negative cooldowns or creates a catch-up event.
      if(Number.isFinite(this.lastReminderAt))this.lastReminderAt=stamp;
      if(Number.isFinite(this.lastGreetingAt))this.lastGreetingAt=stamp;
      if(Number.isFinite(this.lastEventAt))this.lastEventAt=stamp;
      this.returnActiveMs=0;this.wasPresent=false;return stamp;
    }
    if(!state.present||delta>LIMITS.maxTickGapMs){this.returnActiveMs=0;this.wasPresent=state.present;return stamp;}
    if(this.wasPresent&&delta>0) {
      this.returnActiveMs=Math.min(LIMITS.returnGraceMs,this.returnActiveMs+delta);
      if(this.config.enabled)this.activeUsageMs=Math.min(this.config.intervalMinutes*60000,this.activeUsageMs+delta);
      if(input.chatBusy===true)this.proactiveMs=0;
      else if(this.proactive.enabled&&state.deliver&&input.visualBusy!==true)this.proactiveMs=Math.min(this.proactive.intervalMinutes*60000,this.proactiveMs+delta);
    }
    this.wasPresent=state.present;
    return stamp;
  }
  ready(stamp) {return stamp!==null&&this.current.deliver&&this.returnActiveMs>=LIMITS.returnGraceMs&&stamp-this.lastEventAt>=LIMITS.globalCooldownMs;}
  tick(input={}) {
    const stamp=this.advance(input);
    if(!this.ready(stamp))return null;
    if(this.config.enabled&&this.activeUsageMs>=this.config.intervalMinutes*60000&&stamp-this.lastReminderAt>=LIMITS.reminderCooldownMs){
      this.activeUsageMs=0;this.lastReminderAt=stamp;this.lastEventAt=stamp;
      return Object.freeze({type:'break-reminder',id:`reminder-${++this.sequence}`,title:'休息提醒',text:REMINDER_TEXT,readAloudEligible:true});
    }
    if(!this.proactive.enabled||input.visualBusy===true||input.showBubbles===false||this.proactiveMs<this.proactive.intervalMinutes*60000||!withinHours(input.hour,this.proactive.startHour,this.proactive.endHour))return null;
    this.proactiveMs=0;this.lastEventAt=stamp;
    return Object.freeze({type:'proactive-message',id:`proactive-${++this.sequence}`,mode:this.proactive.mode,text:this.proactive.text.trim(),prompt:this.proactive.prompt.trim(),readAloudEligible:true});
  }
  observe(input={}) {
    // Calling this method does not start or authorize visual capture. The caller
    // must have an already active, explicitly consented visual session.
    const stamp=this.advance(input),id=input?.resultId;
    if(input?.consent!==true||input.visualSessionActive!==true||typeof id!=='string'||!/^[-A-Za-z0-9_]{1,128}$/.test(id)||this.seenResults.has(id))return null;
    // Mark even postponed results consumed: a stale observation must never be
    // replayed later merely because quiet mode ended or the user returned.
    this.seenResults.set(id,true);if(this.seenResults.size>LIMITS.rememberedResults)this.seenResults.delete(this.seenResults.keys().next().value);
    if(!this.ready(stamp)||stamp-this.lastGreetingAt<LIMITS.greetingCooldownMs||this.config.enabled&&this.activeUsageMs>=this.config.intervalMinutes*60000)return null;
    this.lastGreetingAt=stamp;this.lastEventAt=stamp;
    return Object.freeze({type:'visual-greeting',id:`greeting-${++this.sequence}`,title:'陪伴问候',text:GREETING_TEXT,readAloudEligible:true});
  }
  snapshot() {
    const threshold=this.config.intervalMinutes*60000;
    return {config:{...this.config},proactive:{...this.proactive,remainingMs:this.proactive.enabled?Math.max(0,this.proactive.intervalMinutes*60000-this.proactiveMs):null},activeUsageMs:this.activeUsageMs,nextReminderInMs:this.config.enabled?Math.max(0,threshold-this.activeUsageMs):null,pending:this.config.enabled&&this.activeUsageMs>=threshold,present:this.current?.present===true,deliverySuppressed:this.current?.deliver!==true,lastReminderAt:Number.isFinite(this.lastReminderAt)?this.lastReminderAt:null,lastGreetingAt:Number.isFinite(this.lastGreetingAt)?this.lastGreetingAt:null};
  }
}
module.exports={CompanionReminderPolicy,validateReminderConfig,validateProactiveConfig,withinHours,PROACTIVE_DEFAULTS,PROACTIVE_INTERVALS,REMINDER_DEFAULTS,INTERVAL_MINUTES,LIMITS,REMINDER_TEXT,GREETING_TEXT};
