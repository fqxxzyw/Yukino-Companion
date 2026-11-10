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
export default function SkinPicker({models=[],relationship,usedDates,selectedId='',onSelect,onSkinPreviewChange,busy=false,compact=false}){
 const titleId=useId(),usage=usedDateStatus(usedDates);
 const groups=skinGroups(models,selectedId).map((group,index)=>({...group,index,status:getSkinStatus(group.model,{relationship,usedDates})})).sort((a,b)=>Number(b.status.unlocked)-Number(a.status.unlocked)||Number(b.model.id===selectedId)-Number(a.model.id===selectedId)||a.index-b.index);
 return <section className={'skin-picker '+(compact?'compact':'')} aria-labelledby={titleId}>
  <header><div><h3 id={titleId}>服装与模型</h3>{!compact&&<p>每套服装显示一个模型；已使用的版本会保留。</p>}</div><span className="skin-days">已使用 {usage.totalDays} 天</span></header>
  {onSkinPreviewChange&&<label className="skin-preview-toggle"><input type="checkbox" checked={relationship?.skinPreviewEnabled===true} disabled={busy} onChange={event=>onSkinPreviewChange(event.target.checked)}/>本地预览已验收服装</label>}
  {relationship?.skinPreviewEnabled&&<p className="skin-rule-note">预览不会改变好感或使用日期；待验收的模型仍不可用。</p>}
  <div className="skin-grid">{groups.map(group=>{const model=group.model,status=group.status,selected=selectedId===model.id,disabled=busy||!status.unlocked;return <div className="skin-group" key={group.id}><button type="button" className={'skin-card '+(selected?'selected ':'')+(!status.unlocked?'locked':'')} disabled={disabled} aria-pressed={selected} aria-label={`${model.label||model.id}，${status.reason}${selected?'，当前选择':''}`} title={status.reason} onClick={()=>{if(status.unlocked&&!busy)onSelect?.(model.id)}}><Preview model={model} locked={!status.unlocked}/><span className="skin-label"><strong>{group.label}</strong>{selected&&<Check size={15}/>}</span><span className={'skin-reason '+(status.hold?'hold':'')}>{status.reason}</span>{status.rule.kind!=='base'&&!status.unlocked&&<><progress value={status.progress} max="1" aria-label={status.requirement}/>{(status.hold||!status.available)&&<small>{status.requirement}</small>}</>}</button></div>})}</div>
  {!models.length&&<p className="hint">暂未登记模型资源。</p>}<p className="skin-rule-note">互动日期累计，同一天计一次；挂机不计入。</p>
 </section>;
}
