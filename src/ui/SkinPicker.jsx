import React,{useId,useState} from 'react';
import {Check,Lock,Shirt} from 'lucide-react';
import {getSkinStatus,usedDateStatus} from '../companion/skin-unlocks.mjs';
import './SkinPicker.css';
import {skinGroups} from './skin-groups.mjs';
import Select from './Select.jsx';
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
 const titleId=useId(),usage=usedDateStatus(usedDates),[versions,setVersions]=useState({});
 const groups=skinGroups(models,selectedId,versions).map((group,index)=>({...group,index,status:getSkinStatus(group.model,{relationship,usedDates})})).sort((a,b)=>Number(b.status.unlocked)-Number(a.status.unlocked)||Number(b.model.id===selectedId)-Number(a.model.id===selectedId)||a.index-b.index);
 return <section className={'skin-picker '+(compact?'compact':'')} aria-labelledby={titleId}><header><div><h3 id={titleId}>服装与模型</h3><p>七套服装的不同版本共享解锁；校服默认可用，其他按好感或使用日期解锁。</p></div><span className="skin-days">已使用 {usage.totalDays} 天</span></header><div className="skin-grid">{groups.map(group=>{const model=group.model,status=group.status,selected=selectedId===model.id,disabled=busy||!status.unlocked;return <div className="skin-group" key={group.id}><button type="button" className={'skin-card '+(selected?'selected ':'')+(!status.unlocked?'locked':'')} disabled={disabled} aria-pressed={selected} aria-label={`${model.label||model.id}，${status.reason}${selected?'，当前选择':''}`} title={status.reason} onClick={()=>{if(status.unlocked&&!busy)onSelect?.(model.id)}}><Preview model={model} locked={!status.unlocked}/><span className="skin-label"><strong>{group.label}</strong>{selected&&<Check size={15}/>}</span>{model.variantLabel&&<small className="skin-version">{model.variantLabel}</small>}<span className={'skin-reason '+(status.hold?'hold':'')}>{status.reason}</span>{status.rule.kind!=='base'&&!status.unlocked&&<><progress value={status.progress} max="1" aria-label={status.requirement}/>{(status.hold||!status.available)&&<small>{status.requirement}</small>}</>}</button>{group.versions.length>1&&<label className="skin-version-select"><span>版本（共享解锁条件）</span><Select aria-label={group.label+'版本'} disabled={busy} value={model.id} onChange={event=>setVersions(current=>({...current,[group.id]:event.target.value}))}>{group.versions.map(version=><option key={version.id} value={version.id}>{version.variantLabel||version.label||version.id}{version.id===selectedId?' · 当前':''}</option>)}</Select></label>}{model.garment&&<small className="skin-variant-warning">{model.limits?.find(text=>text.includes('10个'))||'正常姿态修正，不是通用布料物理；原生图形验收待完成。'}</small>}</div>})}</div>{!models.length&&<p className="hint">暂未登记模型资源。</p>}<p className="skin-rule-note">聊天或主动互动当天计入使用日期；同一天只计一次，无需连续，挂机不计入。7 天不等于运行 168 小时。</p></section>;
}
