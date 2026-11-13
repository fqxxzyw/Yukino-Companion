import React,{useEffect,useRef,useState} from 'react';
import {Check,Copy,LoaderCircle,Plus,UserRound,X} from 'lucide-react';
import Select from './Select.jsx';
import CloudVoiceClone from '../speech/CloudVoiceClone.jsx';
import {getSkinStatus} from '../companion/skin-unlocks.mjs';
import SkinPicker from './SkinPicker.jsx';
import {skinGroups} from './skin-groups.mjs';
import './CharacterSettings.css';
import {modelCardPreviews} from './model-card-preview.mjs';
import {buildCharacterPrompt} from './character-prompt.mjs';
import {SCENES} from './scene-catalog.mjs';

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
const VOICE_NONE='none',VOICE_CLONE='__clone__';
export default function CharacterSettings({characters,current,models,wardrobeModels=models,voices=[],draftConfigs=[],cloneConfigs=[],importedScenes=[],createRequest=0,relationship,usedDates,api,onPrepareDraft,onCloneCreated,onCreate,onSelect,onModelChange,onSkinPreviewChange,onVoiceLanguageChange,onDefaultSceneChange,busy}){
 const creatingRef=useRef(false),copyAttempt=useRef(null),draftAttempt=useRef(null),nameInput=useRef(null),createToggle=useRef(null);
 const [createOpen,setCreateOpen]=useState(false),[name,setName]=useState(''),[persona,setPersona]=useState(''),[modelId,setModelId]=useState(''),[voiceId,setVoiceId]=useState(''),[promptKind,setPromptKind]=useState('unknown'),[work,setWork]=useState(''),[notes,setNotes]=useState(''),[error,setError]=useState(''),[creating,setCreating]=useState(false),[copyState,setCopyState]=useState('idle');
 const [draftConfig,setDraftConfig]=useState(''),[draftText,setDraftText]=useState(''),[draftState,setDraftState]=useState('idle'),[draftError,setDraftError]=useState('');
 const [voiceLanguage,setVoiceLanguage]=useState('ja');
 const [defaultSceneId,setDefaultSceneId]=useState('');
 const selectedDraftId=draftConfigs.some(item=>item.id===draftConfig)?draftConfig:draftConfigs[0]?.id||'';
 let prompt='',promptError='';try{prompt=buildCharacterPrompt(name,{kind:promptKind,work,notes})}catch(error){promptError=error.message}
 const currentModels=skinGroups(wardrobeModels,current.modelId).map(group=>group.model);
 const existingGroups=new Set(skinGroups(wardrobeModels,current.modelId).map(group=>group.id));
 const libraryModels=skinGroups(models).filter(group=>!existingGroups.has(group.id)).map(group=>group.model);
 const unlockedModels=skinGroups(models,modelId).map(group=>group.model).filter(item=>getSkinStatus(item,{relationship,usedDates}).unlocked);
 const sceneChoices=[...Object.entries(SCENES).map(([id,{label}])=>({id,label})),...importedScenes.map(({id,label})=>({id,label:`${label} · 导入`}))];
 const sceneOptions=id=>[
  <option key="" value="">跟随场景设置</option>,
  id&&!sceneChoices.some(scene=>scene.id===id)&&<option key={id} value={id} disabled>场景不可用</option>,
  ...sceneChoices.map(scene=><option key={scene.id} value={scene.id}>{scene.label}</option>)
 ];
 useEffect(()=>{if(createRequest){setCreateOpen(true);nameInput.current?.focus()}},[createRequest]);
 useEffect(()=>{if(createOpen)nameInput.current?.focus()},[createOpen]);
 useEffect(()=>()=>{copyAttempt.current=null;if(draftAttempt.current){draftAttempt.current=null;api?.characterDraftCancel?.().catch(()=>{})}},[]);
 function resetPromptCopy(){copyAttempt.current=null;setCopyState('idle');if(draftAttempt.current){draftAttempt.current=null;api?.characterDraftCancel?.().catch(()=>{})}setDraftText('');setDraftError('');setDraftState('idle')}
 async function generateDraft(){
  if(!prompt||!selectedDraftId||!api?.characterDraft||draftAttempt.current)return;
  const attempt={};draftAttempt.current=attempt;setDraftState('pending');setDraftError('');setDraftText('');
  try{await onPrepareDraft?.();if(draftAttempt.current!==attempt)return;const result=await api.characterDraft({configId:selectedDraftId,prompt});if(draftAttempt.current===attempt){setDraftText(result.text);setDraftState('ready')}}
  catch(error){if(draftAttempt.current===attempt){setDraftError(error.message||'草稿生成失败，请重试。');setDraftState('error')}}
  finally{if(draftAttempt.current===attempt)draftAttempt.current=null}
 }
 async function copyPrompt(){
  if(!prompt||copyAttempt.current)return;
  const attempt={};copyAttempt.current=attempt;setCopyState('pending');
  try{
   if(typeof api?.copyText==='function')await api.copyText(prompt);
   else{
    const clipboard=globalThis.navigator?.clipboard;
    if(typeof clipboard?.writeText!=='function')throw Error('clipboard unavailable');
    await clipboard.writeText(prompt);
   }
   if(copyAttempt.current===attempt)setCopyState('success');
  }catch{
   if(copyAttempt.current===attempt)setCopyState('error');
  }finally{
   if(copyAttempt.current===attempt)copyAttempt.current=null;
  }
 }
 function resetDraft(){setName('');setPersona('');setModelId('');setVoiceId('');setVoiceLanguage('ja');setDefaultSceneId('');setPromptKind('unknown');setWork('');setNotes('');resetPromptCopy()}
 async function submit(event){
  event.preventDefault();if(creatingRef.current)return;creatingRef.current=true;setCreating(true);
  try{
   if(voiceId===VOICE_CLONE)throw Error('录音创建音色尚未接入，请先选择其他音色或跟随全局。');
   const voice=voiceId&&voiceId!==VOICE_CLONE?voiceId:'';
   await onCreate({name,persona,modelId,voiceLanguage,...(voice?{voiceId:voice}:{}),...(defaultSceneId?{defaultSceneId}:{})});
   resetDraft();setError('');
  }catch(error){setError(error.message)}
  finally{creatingRef.current=false;setCreating(false)}
 }
 return <>
  <div className="character-list-head"><h3>我的角色</h3><p>选择角色后会同步对应的人设、音色与形象。</p></div>
  <div className="character-summary-list" aria-label="角色列表">{characters.map(item=><CharacterCard key={`${item.id}:${item.modelId||''}`} character={item} model={models.find(model=>model.id===item.modelId)} current={item.id===current.id} busy={busy} onSelect={onSelect}/>)}</div>
  <section className="character-create" aria-labelledby="character-create-title">
   <button ref={createToggle} type="button" className="character-create-toggle" aria-labelledby="character-create-title" aria-expanded={createOpen} aria-controls="character-create-body" disabled={busy||creating} onClick={()=>setCreateOpen(open=>!open)}><UserRound size={17}/><span className="character-create-copy"><strong id="character-create-title">新建角色</strong><small>填写姓名和角色设定即可创建，音色、模型和场景可选。</small></span>{createOpen?<X size={15}/>:<Plus size={15}/>}</button>
   <div className="character-create-body" id="character-create-body" hidden={!createOpen}>
    <form onSubmit={submit}>
     <label className="field">姓名 *<input ref={nameInput} value={name} maxLength={60} required aria-label="角色姓名" onChange={event=>{setName(event.target.value);resetPromptCopy()}} placeholder="例如：绫波丽"/></label>
     <details className="character-prompt">
      <summary>可选：复制提示词，让外部 AI 起草角色设定</summary>
      <p className="hint">提示词只包含下方填写的资料，不会自动发送。把结果粘贴到「角色设定」后仍可自由编辑；本应用不会自动导入或创建角色。</p>
      <div className="character-prompt-fields">
       <label className="field">角色类型<Select value={promptKind} onChange={event=>{setPromptKind(event.target.value);resetPromptCopy()}}><option value="unknown">未确定</option><option value="canon">已有作品角色</option><option value="original">原创角色</option></Select></label>
       <label className="field">作品或背景<input value={work} maxLength={200} onChange={event=>{setWork(event.target.value);resetPromptCopy()}} placeholder="作品名称；原创角色可留空"/></label>
      </div>
      <label className="field">补充资料<textarea rows={3} maxLength={1000} value={notes} onChange={event=>{setNotes(event.target.value);resetPromptCopy()}} placeholder="希望保留的经历、喜好或说话习惯；未提供则留空"/></label>
      {prompt?<label className="field">提示词预览<textarea aria-label="角色设定提示词" value={prompt} readOnly rows={4} onFocus={event=>event.target.select()}/></label>:<p className="hint">{promptError}</p>}
      <div className="character-copy-row"><button className="secondary" type="button" aria-label="复制角色设定提示词" disabled={!prompt||copyState==='pending'} aria-busy={copyState==='pending'||undefined} onClick={copyPrompt}>{copyState==='pending'?<LoaderCircle size={14} className="spin"/>:<Copy size={14}/>}{copyState==='pending'?'正在复制…':copyState==='success'?'已复制':'复制提示词'}</button>{copyState==='success'&&<span className="character-copy-note" role="status"><Check size={13}/>提示词已复制，可粘贴到外部 AI。</span>}{copyState==='error'&&<span className="character-copy-note error" role="alert">无法复制到剪贴板，请在上方提示词中全选并手动复制。</span>}</div>
      <label className="field">用已配置的对话 API 起草<Select aria-label="起草角色设定的 API" value={selectedDraftId} disabled={!draftConfigs.length||draftState==='pending'} onChange={event=>{resetPromptCopy();setDraftConfig(event.target.value)}}>{!draftConfigs.length&&<option value="">请先添加对话 API</option>}{draftConfigs.map(item=><option key={item.id} value={item.id}>{item.name} · {item.model||'未选模型'}</option>)}</Select><small>仅在点击起草后发送上方提示词，服务商可能按用量收费。生成结果不会自动覆盖现有设定。</small></label>
      <div className="character-copy-row"><button className="secondary" type="button" aria-label="用 API 起草角色设定" disabled={!prompt||!selectedDraftId||!api?.characterDraft||draftState==='pending'} aria-busy={draftState==='pending'||undefined} onClick={generateDraft}>{draftState==='pending'?<LoaderCircle size={14} className="spin"/>:<UserRound size={14}/>}{draftState==='pending'?'正在起草…':'起草角色设定'}</button>{draftState==='pending'&&<button type="button" className="secondary" onClick={resetPromptCopy}>取消</button>}</div>
      {draftText&&<><label className="field">起草结果<textarea aria-label="起草结果" value={draftText} readOnly rows={5}/></label><button className="secondary" type="button" onClick={()=>setPersona(draftText)}>使用此结果</button><small className="hint">请先审阅；如果结果是澄清问题，请补充资料后重新起草。</small></>}
      {draftError&&<p className="hint" role="alert">{draftError}</p>}
     </details>
     <label className="field">角色设定 *<textarea value={persona} maxLength={6000} rows={5} required onChange={event=>setPersona(event.target.value)} placeholder="身份、性格与交流风格"/></label>
     <div className="character-create-fields">
      <label className="field">音色（可选）<Select aria-label="角色音色" value={voiceId} onChange={event=>setVoiceId(event.target.value)}><option value="">跟随全局语音设置</option><option value={VOICE_NONE}>不使用语音</option>{voices.filter(item=>item.kind!=='cloud').map(item=><option key={item.id} value={item.id}>{item.label} · 本地音色</option>)}{voices.filter(item=>item.kind==='cloud').length>0&&<optgroup label="云端音色">{voices.filter(item=>item.kind==='cloud').map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>}<option value={VOICE_CLONE}>从录音创建云端音色…</option></Select><small>跟随全局会使用「语音输出」中的设置；选「不使用语音」只进行文字聊天。</small></label>
      <label className="field">生成语音语言<Select aria-label="新角色生成语音语言" value={voiceLanguage} disabled={voiceId===VOICE_NONE} onChange={event=>setVoiceLanguage(event.target.value)}><option value="ja">日语</option><option value="zh">中文</option></Select><small>日语朗读使用日文译文；中文朗读使用中文回复。实际效果取决于音色支持的语言。</small></label>
      <label className="field">3D 模型（可选）<Select aria-label="新建角色的 3D 模型" value={modelId} onChange={event=>setModelId(event.target.value)}><option value="">暂不选择</option>{unlockedModels.map(model=><option key={model.id} value={model.id}>{(model.label||model.id).split('·')[0]}</option>)}</Select><small>没有模型也可以创建，之后可在角色形象中补充。</small></label>
      <label className="field">默认场景（可选）<Select aria-label="新建角色的默认场景" value={defaultSceneId} onChange={event=>setDefaultSceneId(event.target.value)}>{sceneOptions(defaultSceneId)}</Select><small>切换到此角色时会打开所选场景。</small></label>
     </div>
     {createOpen&&voiceId===VOICE_CLONE&&<CloudVoiceClone api={api} configs={cloneConfigs} onPrepare={onPrepareDraft} onCreated={result=>{onCloneCreated?.(result);setVoiceId(result.configId)}}/>}
     <div className="character-create-actions"><button className="primary" disabled={busy||creating||!name.trim()||!persona.trim()} type="submit">{creating?'正在创建…':'创建角色'}</button><button className="secondary" type="button" disabled={busy||creating} onClick={()=>{resetDraft();setError('');setCreateOpen(false);createToggle.current?.focus()}}>取消</button></div>
     {error&&<p className="notice" role="alert">{error}</p>}
    </form>
   </div>
  </section>
  <section className="settings-section character-current">
   <h3>当前角色的形象</h3>
   <label className="field">当前角色的默认场景<Select aria-label="当前角色的默认场景" disabled={busy||!onDefaultSceneChange} value={current.defaultSceneId||''} onChange={event=>onDefaultSceneChange?.(event.target.value)}>{sceneOptions(current.defaultSceneId)}</Select></label>
   <label className="field">当前角色的语音语言<Select aria-label="当前角色生成语音语言" disabled={busy||!onVoiceLanguageChange} value={current.voiceLanguage||'ja'} onChange={event=>onVoiceLanguageChange?.(event.target.value)}><option value="ja">日语</option><option value="zh">中文</option></Select><small>选择不改变双语文字显示；音色需要支持所选语言。</small></label>
   <label className="field">当前角色的 3D 模型<Select aria-label="当前角色的 3D 模型" disabled={busy} value={current.modelId||''} onChange={event=>onModelChange(event.target.value)}><option value="">不使用 3D 模型</option>{currentModels.map(model=><option key={model.id} value={model.id} disabled={!getSkinStatus(model,{relationship,usedDates}).unlocked}>{(model.label||model.id).split('·')[0]}{' · '+getSkinStatus(model,{relationship,usedDates}).reason}</option>)}</Select></label>
   <label className="field">添加本机已有模型到当前角色<Select aria-label="添加本机已有模型到当前角色" disabled={busy||!libraryModels.length} value="" onChange={event=>{if(event.target.value)onModelChange(event.target.value)}}><option value="">{libraryModels.length?'选择模型并添加':'没有其他模型'}</option>{libraryModels.map(model=><option key={model.id} value={model.id} disabled={!getSkinStatus(model,{relationship,usedDates}).unlocked}>{(model.label||model.id).split('·')[0]}{' · '+getSkinStatus(model,{relationship,usedDates}).reason}</option>)}</Select><small>模型文件仍保留在本机模型库；添加到角色后可随时切换。</small></label>
   <SkinPicker models={wardrobeModels} relationship={relationship} usedDates={usedDates} selectedId={current.modelId} onSelect={onModelChange} onSkinPreviewChange={onSkinPreviewChange} busy={busy}/>
  </section>
 </>;
}
