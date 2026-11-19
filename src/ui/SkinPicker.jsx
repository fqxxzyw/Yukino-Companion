import React,{useId,useState} from 'react';
import {Check,Lock,Shirt} from 'lucide-react';
import {getSkinStatus,usedDateStatus} from '../companion/skin-unlocks.mjs';
import './SkinPicker.css';
import {skinGroups} from './skin-groups.mjs';
function safeThumbnail(model){
 const value=model?.thumbnail||model?.thumbnailUrl;
 // Thumbnails must be actual local assets. Do not send browsing activity to a
 // remote image host merely by opening the wardrobe.
 return typeof value==='string'&&/^(?:\.\/|\/)[^\\]*\.(?:png|jpe?g|webp|avif)(?:\?[^#]*)?$/i.test(value)&&!value.startsWith('//')&&!value.includes('..')?value:'';
}
function Preview({model,locked}){
 const [failed,setFailed]=useState(false),source=safeThumbnail(model);
 return <div className={'skin-preview '+(locked?'is-locked':'')} aria-hidden="true">{source&&!failed?<img src={source} alt="" loading="lazy" onError={()=>setFailed(true)}/>:<div className="skin-outline"><Shirt size={34} strokeWidth={1}/><span>模型预览</span></div>}{locked&&<span className="skin-lock"><Lock size={16}/></span>}</div>;
}
export default function SkinPicker({models=[],relationship,usedDates,selectedId='',onSelect,busy=false,compact=false}){
 const titleId=useId(),usage=usedDateStatus(usedDates),account=relationship?.cloudAuthoritative===true,loginDays=account&&Number.isFinite(relationship?.cloudLoginDays)?Math.max(0,Math.floor(relationship.cloudLoginDays)):usage.totalDays;
 const groups=skinGroups(models,selectedId).map((group,index)=>({...group,index,status:getSkinStatus(group.model,{relationship,usedDates})})).sort((a,b)=>Number(b.status.unlocked)-Number(a.status.unlocked)||Number(b.model.id===selectedId)-Number(a.model.id===selectedId)||a.index-b.index);
 return <section className={'skin-picker '+(compact?'compact':'')} aria-labelledby={titleId}>
  <header><div><h3 id={titleId}>服装与模型</h3>{!compact&&<p>每套服装显示一个模型；已使用的版本会保留。</p>}</div><span className="skin-days">{account?'累计登录':'已使用'} {loginDays} 天</span></header>
  <div className="skin-grid">{groups.map(group=>{const model=group.model,status=group.status,selected=selectedId===model.id,disabled=busy||!status.unlocked;const label=String(group.label||model.label||model.id).replace(/[（(][^）)]*[）)]/g,'').trim();return <div className="skin-group" key={group.id}><button type="button" className={'skin-card '+(selected?'selected ':'')+(!status.unlocked?'locked':'')} disabled={disabled} aria-pressed={selected} aria-label={`${model.label||model.id}，${status.reason}${selected?'，当前选择':''}`} title={status.reason} onClick={()=>{if(status.unlocked&&!busy)onSelect?.(model.id)}}><Preview model={model} locked={!status.unlocked}/><span className="skin-label"><strong>{label}</strong>{selected&&<Check size={15}/>}</span>{!status.unlocked&&<span className={'skin-reason '+(status.hold?'hold':'')}>{status.reason}</span>}{status.rule.kind!=='base'&&!status.unlocked&&<><progress value={status.progress} max="1" aria-label={status.requirement}/>{(status.hold||!status.available)&&<small>{status.requirement}</small>}</>}</button></div>})}</div>
  {!models.length&&<p className="hint">暂未登记模型资源。</p>}<p className="skin-rule-note">{account?'账号服装以服务器确认的累计登录天数和好感度为准；离线时保留已确认资格。':'互动日期累计，同一天计一次；挂机不计入。登录后改以服务器确认进度为准。'}</p>
 </section>;
}
