import {ResourceProgress} from '../ui/SetupWizard.jsx';
import ResourceHelp from '../ui/ResourceHelp.jsx';
import Select from '../ui/Select.jsx';
import React, { useEffect, useState } from 'react';
import VoiceAudition from './VoiceAudition.jsx';
import ReferenceAudioCheck from './ReferenceAudioCheck.jsx';
import VoiceGuide from './VoiceGuide.jsx';

export const voiceDefaults = { enabled:false, python:'', root:'', gpt:'', sovits:'', reference:'', bert:'', hubert:'', ffmpeg:'',
  promptText:'', promptLang:'ja', textLang:'all_ja', version:'v1', device:'auto', half:false, cpuFallback:true, cpuThreads:4,
  speed:1, volume:0.8, timeout:300 };
export const phaseNames = { unloaded:'语音模型尚未加载', loading:'正在加载语音模型', ready:'语音模型已就绪', synthesizing:'正在合成', playing:'正在播放', waiting:'等待文字', idle:'待机', paused:'已停止，待重新加载', error:'语音异常' };
const pathLabels = { python:'Python 可执行文件', root:'GPT-SoVITS 推理目录', gpt:'GPT 权重（.ckpt）', sovits:'SoVITS 权重（.pth）',
  reference:'参考音频（3–10 秒 WAV / FLAC）', bert:'BERT 基础模型目录', hubert:'HuBERT 基础模型目录', ffmpeg:'FFmpeg 可执行文件（可选，自动查找）' };
const langs = [['zh','中英混合'],['ja','日英混合'],['en','英语'],['auto','自动多语言'],['all_zh','中文'],['all_ja','日语'],['yue','粤英混合'],['ko','韩英混合']];

export default function VoiceSettings({api,config,onChange,onRemote,onSave,status,playbackStatus,onPreview,onStop,onOpenSetup}) {
  const [notice,setNotice]=useState(''),[working,setWorking]=useState(false),[hardware,setHardware]=useState(null),[weights,setWeights]=useState({}),[pendingDelete,setPendingDelete]=useState(null),[inspection,setInspection]=useState(null);
  const [resources,setResources]=useState({phase:'idle'}),[selectedPack,setSelectedPack]=useState('yukino-e2');
  const downloading=resources.activePacks?.length>0||['checking','downloading','extracting','merging','assembling'].includes(resources.phase);
  const selectedInfo=(resources.packs||[]).find(pack=>pack.id===selectedPack);
  const selectedBundled=Boolean(selectedInfo?.bundled);
  const cleanError=error=>String(error?.message||error||'操作未完成，请重试。').replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i,'').replace(/^Error:\s*/i,'');
  const refresh=async()=>{if(api?.voiceResources)setResources(await api.voiceResources());};
  const needsTranscript=['v3','v4','v5dev','v5turbo'].includes(config.version);
  const readyReference=Boolean(config.reference&&(!needsTranscript||config.promptText.trim()));
  const incompleteCustomReference=Boolean(!config.reference&&config.promptText.trim());
  useEffect(()=>setWeights({}),[config.gpt,config.sovits]);
  useEffect(()=>setPendingDelete(null),[selectedPack]);
  useEffect(()=>{let current=true;setInspection(null);const timer=setTimeout(async()=>{try{if(!api?.voiceStatus)return;await onSave();const result=await api.voiceStatus();if(current)setInspection(result);}catch{if(current)setInspection(null);}},500);return()=>{current=false;clearTimeout(timer);};},[api,config.python,config.root,config.gpt,config.sovits,config.bert,config.hubert,config.reference,config.promptText,config.version]);
  useEffect(()=>{if(!api)return;api.voiceResources().then(setResources).catch(e=>setNotice(cleanError(e)));return api.onVoiceDownload(status=>setResources(old=>({...old,...status})))},[api]);
  const patch = value => onChange({...value,textLang:'all_ja'});
  async function action(fn) {
    if(!api){setNotice('请在桌面应用中配置本地语音。');return;}
    setWorking(true); setNotice('');
    try { await fn(); } catch(e) { setNotice(cleanError(e)); } finally { setWorking(false); }
  }
  const pathField = key => <label className="field" key={key}>{pathLabels[key]}<div className="voice-path"><input value={config[key]} onChange={e=>patch({[key]:e.target.value})} placeholder="选择本机文件或目录"/><button type="button" className="secondary" onClick={()=>action(async()=>{const selected=await api.voicePick(key);if(selected)patch({[key]:selected})})}>浏览</button></div></label>;
  const chooseWeight=key=>action(async()=>{const selected=await api.voicePick(key);if(selected){patch({[key]:selected});await onSave();setNotice('已选择本地音色文件；首次朗读时自动加载。')}});
  const downloadWeight=key=>action(async()=>{const result=await api.voiceInstall(selectedPack,{apply:true,component:key});onRemote(await api.voiceSettings());await refresh();setNotice(result.applied?'文件已校验并选用；两个模型和运行资源齐全后可试听。':'文件已下载；期间该选择已改变，未覆盖你的设置。')});
  async function save() { const value=await onSave();setNotice('配置已保存；模型、语言、语速等推理设置修改后需重新加载。');return value; }
  return <>
    <ResourceHelp api={api}/>
    <p className="intro">用雪乃的声音朗读日语回复。准备好后，开启自动朗读即可。</p>
    {onOpenSetup&&<div className="settings-card"><strong>一键准备声音</strong><p className="hint">自动检查并准备所需环境和默认声音；优先使用可用的 GPU。</p><button type="button" className="primary" onClick={onOpenSetup}>检查 / 一键配置</button></div>}
    <details className="advanced-settings"><summary>当前配置检查</summary><div className="voice-status">{[['python','Python 推理环境'],['root','GPT-SoVITS 推理组件'],['bert','BERT 公共模型'],['hubert','HuBERT 公共模型'],['gpt','GPT .ckpt 权重'],['sovits','SoVITS .pth 权重'],['reference','参考音频'],...(['v3','v4','v5dev','v5turbo'].includes(config.version)?[['promptText','参考原文']]:[])].map(([key,label])=>{const missing=inspection?.missing?.find(item=>item.key===key);return <span key={key}>{label}：{!inspection?'待检查':missing?(missing.reason==='missing-file'?'文件不存在或无效':'需要配置'):'文件或配置检查通过，推理待验证'}</span>;})}</div></details>
    <details className="advanced-settings"><summary>音色与资源管理（可选）</summary>
    <div className="voice-status resource-card">
      <span className="card-kicker">01 · 运行资源</span><strong>{resources.bundled?'语音运行环境已就绪':'语音运行环境待准备'}</strong>
      <span>{resources.bundled?'已找到 Python、语音推理组件和 FFmpeg。':'应用专用 Python 与推理库为本地对话、翻译和声音提供运行环境。'}</span>
      <span>{resources.coreReady?'BERT 与 HuBERT 公共模型已安装。':'BERT / HuBERT 是语音合成使用的文本与声音特征模型，下载约 802 MiB。'}</span>
      {resources.total>0&&<><progress max={resources.total} value={resources.received||0}/><span>{Math.round((resources.received||0)/1048576)} / {Math.round(resources.total/1048576)} MiB · {resources.phase==='complete'?'下载与校验完成':resources.file||resources.phase}</span><ResourceProgress progress={resources}/></>}
      {resources.error&&<span>{resources.error}</span>}
      <div className="button-row"><button className="primary" disabled={working||downloading} onClick={()=>action(async()=>{const result=await api.voiceInstall('core',{apply:true});onRemote(await api.voiceSettings());await refresh();setNotice(result.applied?'公共模型已校验并选用；首次朗读时自动加载。':'公共模型已下载；期间设置已变更，未覆盖你的选择。')})}>{resources.coreReady?'校验公共模型':'下载公共模型'}</button><button className="secondary" disabled={!downloading} onClick={()=>api?.voiceDownloadCancel().catch(e=>setNotice(cleanError(e)))}>取消下载</button></div>
    </div>
    <div className="voice-status resource-card">
      <span className="card-kicker">02 · 选择她的声音</span><strong>选择两个音色模型文件</strong>
      <span>两个文件可分别下载，也可以各自选择本机已有文件；默认雪乃声音使用 GPT e2 和 SoVITS e1。</span>
      <label className="field">音色模型<Select value={selectedPack} onChange={e=>setSelectedPack(e.target.value)}>
        {(resources.packs||[]).filter(p=>p.kind==='voice').map(p=><option value={p.id} key={p.id}>{p.label}{p.bundled?' · 已内置':p.installed?' · 已下载':''}</option>)}
        {!(resources.packs||[]).some(p=>p.kind==='voice')&&<option value="yukino-e2">雪乃 · 默认 GPT e2 / SoVITS e1（v1）</option>}
      </Select></label>
      {['gpt','sovits'].map(key=><div className="field" key={key}><strong>{pathLabels[key]}</strong><div className="voice-path"><input readOnly aria-label={pathLabels[key]} value={config[key]} placeholder="尚未选择"/><button type="button" className="secondary" disabled={working} onClick={()=>chooseWeight(key)}>选择本地文件</button><button type="button" className="primary" disabled={working||downloading} onClick={()=>downloadWeight(key)}>{selectedInfo?.components?.[key]?'使用已下载文件':'下载此文件'}</button></div><div className="button-row"><button type="button" className="text-link" disabled={working||!config[key]||!api?.voiceWeightStatus} onClick={()=>action(async()=>{await onSave();const result=await api.voiceWeightStatus(key);setWeights(value=>({...value,[key]:result}));})}>检查所选文件</button><button type="button" className="text-link" disabled={working||downloading||!api?.voiceVerify} onClick={()=>action(async()=>{const result=await api.voiceVerify(selectedPack,key);setNotice(result.message);await refresh();})}>校验下载文件</button>{selectedInfo?.componentDetails?.[key]?.canDelete&&<button type="button" className="text-link" disabled={working||downloading||!api?.voiceRemove} onClick={()=>setPendingDelete({pack:selectedPack,component:key,path:selectedInfo.componentDetails[key].path})}>删除下载文件</button>}</div>{weights[key]&&<small>{weights[key].message}{weights[key].bytes?` · ${(weights[key].bytes/1048576).toFixed(1)} MiB`:''}</small>}{selectedInfo?.componentDetails?.[key]&&<small>预设缓存：{selectedInfo.componentDetails[key].path} · {(selectedInfo.componentDetails[key].bytes/1048576).toFixed(1)} MiB · {selectedInfo.componentDetails[key].installed?'文件已下载，推理待验证':'未下载'}</small>}</div>)}
      {pendingDelete&&<div className="notice" role="alert"><p>删除此受管理的下载文件？共享该文件的其他预设也会变为缺失；本地自定义文件不会被删除。</p><p>{pendingDelete.path}</p><div className="button-row"><button type="button" className="secondary" disabled={working} onClick={()=>setPendingDelete(null)}>保留文件</button><button type="button" className="secondary" disabled={working} onClick={()=>action(async()=>{await api.voiceRemove(pendingDelete.pack,pendingDelete.component);onRemote(await api.voiceSettings());setPendingDelete(null);await refresh();setNotice('受管理的下载文件已删除，可随时重新下载。');})}>确认删除下载文件</button></div></div>}
      <div className="button-row"><button className="secondary" disabled={working||downloading} onClick={()=>action(async()=>{const result=await api.voiceInstall(selectedPack,{apply:true});onRemote(await api.voiceSettings());await refresh();setNotice(result.applied?'两个音色文件已校验并选用，首次朗读时自动加载。':'文件已下载；期间选择已改变，未覆盖你的设置。')})}>{selectedBundled?'使用内置音色':selectedInfo?.installed?'使用这组音色':'同时下载这组音色'}</button></div>
      <span>{readyReference?'参考声音已配置。':incompleteCustomReference?'自定义文本尚未匹配参考音频；不影响默认资源下载。':'参考声音尚未配置，请先检查 / 一键配置。'}</span>
    </div>
    </details>
    <div className="voice-status" role="status"><strong>{phaseNames[status.phase]||status.phase}</strong>
      {status.metadata&&<span>{status.metadata.device} · {status.metadata.half?'FP16':'FP32'} · {status.metadata.version}{status.metadata.cpuFallback?' · GPU 不可用，已回退 CPU':''}</span>}
      {status.metadata?.cpuFallbackReason&&<span>回退原因：{status.metadata.cpuFallbackReason}</span>}
      {status.phase==='unloaded'&&<span>{status.configured?'资源已齐全；当前没有占用模型内存，首次朗读时会自动加载。':'这里指语音合成模型，和本地对话模型、翻译模型的状态相互独立。'}</span>}
      {status.missing?.length>0&&<span>还需准备：{status.missing.map(item=>item.label).join('、')}</span>}
      {status.error&&<p>{cleanError(status.error)}</p>}
    </div>
    <label className="row"><div><strong>自动朗读新回复</strong><small>中文回复先完成日语翻译再朗读。气泡显示语言不会改变语音语言。</small></div><input type="checkbox" role="switch" checked={config.enabled} onChange={e=>patch({enabled:e.target.checked})}/></label>
    <label className="field">播放音量 · {Math.round(config.volume*100)}%<input type="range" min="0" max="1" step="0.05" value={config.volume} onChange={e=>patch({volume:Number(e.target.value)})}/></label>
    <label className="field">语速 · {config.speed.toFixed(1)}×<input type="range" min="0.5" max="2" step="0.1" value={config.speed} onChange={e=>patch({speed:Number(e.target.value)})}/></label>
    <fieldset disabled={working}>
      <details className="advanced-settings"><summary>参考声音：默认 / 自定义</summary><p className="hint">自定义时，音频和文本必须来自同一段录音。填写文本不影响资源下载。</p><button type="button" className="secondary" onClick={()=>action(async()=>{await onSave();await api.voicePatch({reference:'',promptText:'',promptLang:'all_ja'});onRemote(await api.voiceSettings());setNotice('已改用默认参考声音，自定义参考文本已清除。')})}>改用默认参考声音</button>{pathField('reference')}
      <label className="field">参考音频对应文本<textarea rows="3" maxLength={3000} value={config.promptText} onChange={e=>patch({promptText:e.target.value})} placeholder="填写参考音频中实际说出的内容。"/></label>
      <label className="field">参考音频语言<Select value={config.promptLang} onChange={e=>patch({promptLang:e.target.value})}>{langs.map(([v,l])=><option key={v} value={v}>{l}</option>)}</Select></label><ReferenceAudioCheck api={api} reference={config.reference} onSave={onSave}/></details>
      <details className="advanced-settings"><summary>推理环境与基础模型路径</summary><p className="hint">一键配置会自动填入这些路径。使用自己的环境或模型目录时，再修改它们。</p>{['python','root','bert','hubert','ffmpeg'].map(pathField)}</details>
      <details className="advanced-settings"><summary>高级：设备与合成参数</summary><p className="hint">默认自动优先使用 GPU，通常无需更改。</p>
      <h3 className="settings-section-title">合成偏好</h3><div className="voice-grid">
        <label className="field">模型版本<Select value={config.version} onChange={e=>patch({version:e.target.value})}>{['v1','v2','v2Pro','v2ProPlus','v3','v4','v5dev','v5turbo'].map(v=><option key={v}>{v}</option>)}</Select></label>
        <label className="field">推理设备<Select value={config.device} onChange={e=>patch({device:e.target.value})}><option value="auto">自动：CUDA 可用时使用 GPU</option><option value="cpu">CPU</option><option value="cuda" disabled={hardware?.cudaAvailable!==true}>{hardware?.cudaAvailable===true?'NVIDIA CUDA GPU':'NVIDIA GPU · 检测 CUDA 可用后可选'}</option></Select><small>CPU 支持情况和速度取决于当前权重与运行环境，仍需试听确认。</small></label>
        <label className="field">合成语言<input value="日语（固定）" readOnly/><small>只朗读日语译文；翻译失败时保留文字，不朗读中文。</small></label>
      </div>
      <label className="row"><div><strong>GPU 半精度</strong><small>默认关闭以兼容更多设备；CPU 始终使用 FP32。</small></div><input type="checkbox" role="switch" checked={config.half} onChange={e=>patch({half:e.target.checked})}/></label>
      <label className="row"><div><strong>GPU 推理失败时回退 CPU</strong><small>显存、驱动或 CUDA 出错时重新加载模型，速度可能变慢。</small></div><input type="checkbox" role="switch" checked={config.cpuFallback} onChange={e=>patch({cpuFallback:e.target.checked})}/></label>
      <div className="voice-grid">
        <label className="field">CPU 线程（1–32）<input type="number" min="1" max="32" value={config.cpuThreads} onChange={e=>patch({cpuThreads:Number(e.target.value)})}/></label>
        <label className="field">单次超时（30–900 秒）<input type="number" min="30" max="900" value={config.timeout} onChange={e=>patch({timeout:Number(e.target.value)})}/></label>
      </div>
      <div className="button-row"><button className="secondary" onClick={()=>action(save)}>保存配置</button><button className="secondary" onClick={()=>action(async()=>setHardware(await api.voiceProbe(config)))}>检测 GPU / CPU</button><button className="primary" disabled={!readyReference} onClick={()=>action(async()=>{onStop();const latest=await save();await api.voiceLoad(latest);setNotice('声音已加载，可以试听。')})}>加载 / 重新加载</button></div></details>
    </fieldset>
    {!readyReference&&<p className="notice">{incompleteCustomReference?'请为自定义文本选择对应录音，或改用默认参考声音；资源下载可以继续。':needsTranscript?'当前模型版本需要参考音频及对应原文，请配置参考声音。':'参考声音尚未就绪，请先检查 / 一键配置。'}</p>}
    {hardware&&<p className="notice">PyTorch {hardware.torch} · {hardware.cudaAvailable?hardware.devices.map(d=>`${d.name} (${d.vramGiB} GiB)`).join('，'):'无可用 CUDA，将使用 CPU'}{hardware.cudaError?`；${hardware.cudaError}`:''}</p>}
    <VoiceAudition api={api} config={config} onSave={onSave} onPreview={onPreview} onStop={onStop} status={playbackStatus||status}/>
    <button type="button" className="secondary" onClick={()=>action(async()=>{onStop();await api.voiceUnload();setNotice('已卸载模型并释放推理进程。')})}>释放音色模型内存</button>
    <VoiceGuide api={api}/>
    {notice&&<p className="notice" role="status">{notice}</p>}
    <p className="hint">中止正在合成的语音会结束本软件启动的推理进程，下次朗读自动重新加载。CPU 运行环境即使检测到显卡也不能启用 CUDA；使用带 CUDA 的运行环境后，自动模式才会优先使用 GPU。</p>
  </>;
}
