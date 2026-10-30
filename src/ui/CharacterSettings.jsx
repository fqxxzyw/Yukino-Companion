import React,{useEffect,useRef,useState} from 'react';
import Select from './Select.jsx';
import {getSkinStatus} from '../companion/skin-unlocks.mjs';
import SkinPicker from './SkinPicker.jsx';
import './CharacterSettings.css';
import {modelCardPreviews} from './model-card-preview.mjs';
function thumbnail(model){const value=model?.thumbnail||model?.thumbnailUrl;return typeof value==='string'&&/^(?:\.\/|\/)[^\\]*\.(?:png|jpe?g|webp|avif)(?:\?[^#]*)?$/i.test(value)&&!value.startsWith('//')&&!value.includes('..')?value:'';}
function CharacterCard({character,model,current,busy,onSelect}){
 const card=useRef(null),[failed,setFailed]=useState(false),[snapshot,setSnapshot]=useState(''),[previewState,setPreviewState]=useState('idle'),image=thumbnail(model)||snapshot;
 useEffect(()=>{
  setSnapshot('');setFailed(false);setPreviewState('idle');
  if(!model?.custom||!model.ready||thumbnail(model))return;
  const controller=new AbortController();let observer,started=false;
  const start=()=>{if(started||controller.signal.aborted)return;started=true;observer?.disconnect();setPreviewState('loading');modelCardPreviews.get(model,{signal:controller.signal,api:window.desktop}).then(url=>{if(!controller.signal.aborted){setSnapshot(url);setPreviewState('ready')}}).catch(()=>{if(!controller.signal.aborted)setPreviewState('error')});};
  if(typeof IntersectionObserver==='undefined')start();else{observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))start()});observer.observe(card.current);}
  return()=>{observer?.disconnect();controller.abort()};
 },[model?.id,model?.sha256,model?.ready]);
 return <button ref={card} type="button" className={'character-summary'+(current?' selected':'')} aria-pressed={current} disabled={busy} onClick={()=>onSelect(character.id)}>
  <div className="character-summary-avatar" aria-hidden="true">{character.builtin?<img src="./yukino-q.png" alt=""/>:image&&!failed?<img src={image} alt="" onError={()=>setFailed(true)}/>:<span>{character.name.slice(0,1)}</span>}</div>
  <div className="character-summary-copy"><strong><span className="character-summary-name">{character.name}</span><span className={'character-summary-status'+(current?' active':'')}>{current?'使用中':'切换'}</span></strong><p>{character.persona?.trim()||(character.builtin?'雪之下雪乃':'未填写介绍')}</p></div>
  <div className="character-summary-model"><span>{!character.modelId?'模型':model?.label||'模型'}</span>{!character.modelId?<small>无</small>:image&&!failed?<img src={image} alt={model?.label||'角色模型截图'} onError={()=>setFailed(true)}/>:<small>{!model?'不可用':previewState==='loading'?'生成截图…':'暂无截图'}</small>}</div>
 </button>;
}
export default function CharacterSettings({characters,current,models,relationship,usedDates,onCreate,onSelect,onModelChange,busy}){
 const creatingRef=useRef(false);
 const [name,setName]=useState(''),[persona,setPersona]=useState(''),[modelId,setModelId]=useState(''),[error,setError]=useState(''),[creating,setCreating]=useState(false);
 async function submit(event){event.preventDefault();if(creatingRef.current)return;creatingRef.current=true;setCreating(true);try{await onCreate({name,persona,modelId});setName('');setPersona('');setModelId('');setError('')}catch(error){setError(error.message)}finally{creatingRef.current=false;setCreating(false)}}
 return <><div className="character-summary-list" aria-label="角色列表">{characters.map(item=><CharacterCard key={`${item.id}:${item.modelId||''}`} character={item} model={models.find(model=>model.id===item.modelId)} current={item.id===current.id} busy={busy} onSelect={onSelect}/>)}</div><label className="field">当前角色的 3D 模型<Select disabled={busy} value={current.modelId||''} onChange={event=>onModelChange(event.target.value)}><option value="">不使用 3D 模型</option>{models.map(model=><option key={model.id} value={model.id} disabled={!getSkinStatus(model,{relationship,usedDates}).unlocked}>{model.label}{' · '+getSkinStatus(model,{relationship,usedDates}).reason}</option>)}</Select></label><SkinPicker models={models} relationship={relationship} usedDates={usedDates} selectedId={current.modelId} onSelect={onModelChange} busy={busy}/><form onSubmit={submit}><h3 className="subsection-title">新建角色</h3><label className="field">姓名<input value={name} maxLength={60} required onChange={event=>setName(event.target.value)}/></label><label className="field">角色设定<textarea value={persona} maxLength={6000} rows={5} onChange={event=>setPersona(event.target.value)} placeholder="身份、性格与交流风格"/></label><label className="field">模型（可选）<Select value={modelId} onChange={event=>setModelId(event.target.value)}><option value="">暂不选择</option>{models.filter(item=>getSkinStatus(item,{relationship,usedDates}).unlocked).map(model=><option key={model.id} value={model.id}>{model.label} · {model.version}</option>)}</Select></label><button className="primary" disabled={busy||creating||!name.trim()} type="submit">创建并切换</button>{error&&<p className="notice" role="alert">{error}</p>}</form></>;
}
