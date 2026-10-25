import React, {useEffect, useState} from 'react';
import {Check, Download, LoaderCircle, Minus, RefreshCw, X, Monitor, AudioLines, Languages} from 'lucide-react';
import Select from './Select.jsx';
import {friendlyError} from './errors.mjs';

const labels = {runtime:'公共推理环境',chat:'雪乃本地对话模型',translation:'中日翻译模型',voiceCore:'语音公共模型',voicePreset:'默认雪乃音色与参考声音'};
const stateLabels = {ready:'已准备好',missing:'需要准备',installing:'正在安装',downloading:'正在下载',checking:'正在检查',extracting:'正在解压',assembling:'正在整理',cancelled:'已取消',error:'需要处理',skipped:'已跳过',pending:'等待中'};
const features = [['chat','本地对话','无需 API Key，也能离线回复。',Monitor],['translation','日语翻译','中文阅读，日语朗读。',Languages],['voice','语音合成','准备声音模型与参考音频。',AudioLines]];
const busyStates = ['checking','installing','downloading','extracting','assembling','running'];
function byteLabel(value) {return value>=1073741824?`${(value/1073741824).toFixed(2)} GB`:`${Math.round(value/1048576)} MB`;}
export default function SetupWizard({api,status={},onStatus,onClose,onFinished}) {
  const [selection,setSelection] = useState(['chat','translation','voice']), [flavor,setFlavor] = useState('auto'), [working,setWorking] = useState(false), [error,setError] = useState('');
  const busy=working||busyStates.includes(status.phase), steps=Array.isArray(status.steps)?status.steps:[];
  const runtimeVariants=Array.isArray(status.runtimeVariants)?status.runtimeVariants:null;
  const cudaAvailable=runtimeVariants===null||runtimeVariants.includes('cu124');
  const cpuOnly=runtimeVariants?.includes('cpu')&&!cudaAvailable;
  const current=steps.find(step=>busyStates.includes(step.state||step.phase));
  const total=Number(current?.total||current?.progress?.total||status.progress?.total||status.total||0),bytes=Number(current?.bytes||current?.received||current?.progress?.bytes||current?.progress?.received||status.progress?.bytes||status.progress?.received||status.received||0);
  useEffect(()=>{if(api?.setupStatus)api.setupStatus().then(onStatus).catch(e=>setError(friendlyError(e)));},[api]);
  useEffect(()=>{if(!cudaAvailable&&flavor==='cu124')setFlavor('auto');},[cudaAvailable,flavor]);
  async function install(){if(!api?.setupInstall){setError('请在桌面版中使用一键配置。');return;}setWorking(true);setError('');try{const next=await api.setupInstall({runtimeFlavor:flavor,features:selection});if(next)onStatus(next);if(next?.phase==='ready'||next?.phase==='complete')onFinished?.(next);}catch(e){setError(friendlyError(e,'资源准备没有完成，请重试。'));}finally{setWorking(false)}}
  const allReady=steps.length>0&&steps.every(step=>['ready','skipped'].includes(step.state||step.phase));
  return <div className="modal-backdrop setup-backdrop"><section className="setup-dialog" role="dialog" aria-modal="true" aria-labelledby="setup-title">
    <header><img src="./yukino-icon.png" alt=""/><div><span className="eyebrow">A LITTLE PREPARATION</span><h2 id="setup-title">让她准备好，留在你身边。</h2></div><button className="icon" aria-label={busy?'后台继续配置':'关闭首次配置'} onClick={onClose}><X size={18}/></button></header>
    <div className="setup-content"><p className="intro">先检查已经带来的模型，再补齐需要的公共组件。你可以现在配置，也可以稍后从设置顶部继续。</p>
      <div className="setup-features">{features.map(([id,label,detail,Icon])=><label key={id} className={'setup-feature '+(selection.includes(id)?'selected':'')}><Icon size={20}/><span><strong>{label}</strong><small>{detail}</small></span><input type="checkbox" role="switch" disabled={busy} checked={selection.includes(id)} onChange={event=>setSelection(old=>event.target.checked?[...old,id]:old.filter(value=>value!==id))}/></label>)}</div>
      <div className="setup-runtime"><label>推理环境<Select aria-label="首次配置推理环境" value={flavor} disabled={busy} onChange={event=>setFlavor(event.target.value)}><option value="auto">{cpuOnly?'自动 · 此测试包使用 CPU 环境':'自动检测 · 有兼容 NVIDIA 显卡时优先 GPU'}</option><option value="cpu">CPU 通用环境</option><option value="cu124" disabled={!cudaAvailable}>{cudaAvailable?'NVIDIA CUDA 环境':'NVIDIA CUDA · 后续版本提供'}</option></Select></label><small>{cpuOnly?'此测试包可下载 CPU 环境，NVIDIA 电脑也可用 CPU 运行；GPU 环境将在后续版本提供。公共环境包含 Python 与推理依赖，模型权重已随应用提供。':'公共环境包含 Python 与推理依赖；模型权重单独列在下面。GPU 不可用时可以选择 CPU。'}</small></div>
      <div className="setup-steps" aria-live="polite">{steps.length?steps.map(step=>{const state=step.state||step.phase||'pending';return <div key={step.id} className={'setup-step '+state}><span className="setup-step-icon">{state==='ready'?<Check size={17}/>:busyStates.includes(state)?<LoaderCircle size={17} className="spin"/>:state==='error'?<X size={17}/>:<Minus size={17}/>}</span><div><strong>{step.label||labels[step.id]||'所需组件'}</strong><small>{step.detail||step.error|| (step.id==='runtime'?'供本地对话、翻译与语音共用':'检查本机文件，完整资源不会重复下载。')}</small></div><span className="setup-state">{stateLabels[state]||'等待中'}</span></div>;}):<div className="setup-checking"><LoaderCircle className="spin" size={18}/><span>正在检查本机资源…</span></div>}</div>
      {busy&&<div className="setup-progress" role="status"><span>{current?.label||labels[current?.id]||'正在准备资源'}{total>0&&<b>{byteLabel(bytes)} / {byteLabel(total)}</b>}</span>{total>0?<progress value={Math.min(bytes,total)} max={total}/>:<progress/>}<small>进度来自实际下载与校验，首次准备时间取决于网络和电脑性能。</small></div>}
      {(error||status.error)&&<p className="notice" role="alert">{friendlyError(error||status.error)}</p>}
      {allReady&&!busy&&<div className="setup-complete"><Check size={19}/><span>资源已准备好。模型将在第一次使用时加载，暂不占用推理内存。</span></div>}
    </div>
    <footer><button className="text-link" onClick={onClose}>{busy?'后台继续，先使用文字聊天':allReady?'完成，开始聊天':'先跳过，稍后配置'}</button><div>{busy?<button className="secondary" onClick={()=>api?.setupCancel?.().catch(e=>setError(friendlyError(e)))}>取消准备</button>:<button className="primary" disabled={!selection.length} onClick={install}>{allReady?<RefreshCw size={16}/>:<Download size={16}/>} {allReady?'重新检查所选功能':'一键配置所选功能'}</button>}</div></footer>
  </section></div>;
}
