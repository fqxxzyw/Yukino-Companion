import React,{useEffect,useState} from 'react';
import {summarizeRelationship} from '../companion/relationship.mjs';
export default function RelationshipSettings({value,onCheckin}){
 const [now,setNow]=useState(Date.now());
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),30000);return()=>clearInterval(timer)},[]);
 const state=summarizeRelationship(value,now);
 return <section className="relationship-settings"><h3 className="settings-section-title">相处的日常</h3><div className="relationship-summary"><div><span>心情</span><strong>{state.moodLabel}</strong></div><div><span>好感</span><strong>{state.affection}<small> / 100</small></strong></div><div><span>体力</span><strong>{state.stamina}<small> / 100</small></strong></div></div><div className="row"><div><strong>今天也来见个面</strong><small>累计签到 {state.checkinDays} 天</small></div><button type="button" className="secondary" disabled={state.checkedToday} onClick={()=>{onCheckin();setNow(Date.now())}}>{state.checkedToday?'今天已签到':'签到'}</button></div><p className="hint">连续交谈会消耗体力，休息时自然恢复。不会因为表达难过或负面感受扣除好感，也不会限制继续聊天。</p><div className="checkin-milestones" aria-label="签到解锁进度">{[3,7,14].map(days=><span key={days} className={state.unlocks.includes(`checkin-${days}`)?'reached':''}>{days} 天 · {state.unlocks.includes(`checkin-${days}`)?'资格已达成':'待达成'}</span>)}</div><p className="hint">当前记录皮肤解锁资格，正式服装仍待接入。赞助解锁尚未启用。</p></section>;
}
