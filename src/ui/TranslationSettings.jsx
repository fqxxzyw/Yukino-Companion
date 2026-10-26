import ResourceHelp from './ResourceHelp.jsx';
import Select from './Select.jsx';
import React,{useState,useEffect} from 'react';
import {friendlyError} from './errors.mjs';
const names={unloaded:'翻译模型尚未加载',ready:'翻译模型正在待命',loading:'正在加载翻译模型',translating:'正在翻译为日语',checking:'正在校验翻译权重',downloading:'正在下载翻译权重',complete:'翻译权重已准备好',error:'翻译需要处理',missing:'翻译权重尚未安装',installed:'翻译权重已准备好',paused:'翻译准备已暂停'};
const deviceName={auto:'自动检测',cpu:'CPU',cuda:'NVIDIA GPU',gpu:'GPU'};
export default function TranslationSettings({api,status,onStatus,onOpenSetup}){
 const [working,setWorking]=useState(false),[notice,setNotice]=useState(''),[config,setConfig]=useState(status.config||{device:'auto',python:'',modelDir:''});
 useEffect(()=>{if(status.config)setConfig(status.config)},[status.config]);
 async function act(fn){if(!api){setNotice('请在桌面版配置本地翻译。');return}setWorking(true);try{await fn()}catch(e){setNotice(friendlyError(e))}finally{setWorking(false)}}
 const shown=status.phase||status.state||'unloaded',total=status.total||status.progress?.total||0,received=status.received||status.bytes||status.progress?.received||0;
 const installed=status.modelInstalled??status.installed??(status.available||status.ready),runtime=status.runtimeAvailable??status.available;
 let title=names[shown]||'正在检查翻译资源';
 if(installed&&['unloaded','installed','complete'].includes(shown))title=runtime===false?'翻译权重已安装 · 等待公共环境':'翻译权重已安装 · 首次翻译时自动加载';
 const downloading=['checking','downloading'].includes(shown);
 return <>
 <p className="intro">这里准备的是 <strong>Hy-MT2 中日翻译模型</strong>。Python 属于公共推理环境，可在「一键配置」中统一准备。</p>
 <div className="voice-status resource-card"><strong>{title}</strong><span>Hy-MT2-1.8B · Q4 量化{status.modelBytes?` · ${(status.modelBytes/1e9).toFixed(2)} GB`:' · 约 1.13 GB'}</span><span>{status.modelSource==='bundled'?'权重来源：随安装包提供':status.modelSource==='custom'?'权重来源：你选择的本地目录':status.modelSource==='downloaded'?'权重来源：本机下载目录':'检查内置权重与本地目录后再按需下载。'}</span><span>{runtime===false?'公共环境尚未准备好，模型文件仍保留在本机。':'权重安装和模型加载是两件事：未加载只表示暂未占用推理内存。'}</span>{status.device&&<span>翻译设备：{deviceName[status.device]||'自动检测'}</span>}
 {status.error&&<p>{friendlyError(status.error,'本地翻译暂不可用，请检查资源。')}</p>}{total>0&&downloading&&<><progress value={received} max={total}/><span>{Math.round(received/1048576)} / {Math.round(total/1048576)} MB</span></>}
 <div className="button-row"><button className="primary" disabled={working||downloading} onClick={()=>act(async()=>{const next=await api.translationInstall();onStatus(next);if(next.config)setConfig(next.config);setNotice('翻译权重已校验，完整文件不会再次下载。')})}>{installed?'检查已安装的翻译权重':'准备翻译权重'}</button><button className="secondary" disabled={working} onClick={()=>act(async()=>{const next=await api.translationStatus();onStatus(next);if(next.config)setConfig(next.config)})}>刷新状态</button>{downloading&&<button className="text-link" onClick={()=>api?.translationCancel().catch(e=>setNotice(friendlyError(e)))}>取消下载</button>}{runtime===false&&<button className="text-link" onClick={onOpenSetup}>一键准备公共环境</button>}</div></div>
 <ResourceHelp api={api}/><label className="field">翻译推理设备<Select value={config.device||'auto'} disabled={working} onChange={e=>setConfig({...config,device:e.target.value})}><option value="auto">自动 · 兼容 GPU 可用时优先使用</option><option value="cpu">CPU</option><option value="cuda">NVIDIA GPU</option></Select><small>GPU 模式需要兼容的运行环境。显存不足时按照配置回退 CPU。</small></label>
 <details className="advanced-settings"><summary>自定义翻译环境</summary><p className="hint">一般无需填写路径。仅在使用自己的运行环境或权重时修改。</p><label className="field">Python 可执行文件<div className="voice-path"><input value={config.python||''} onChange={e=>setConfig({...config,python:e.target.value})} placeholder="自动选择已准备的公共环境"/><button className="secondary" onClick={()=>act(async()=>{const path=await api.translationPick('python');if(path)setConfig({...config,python:path})})}>浏览</button></div></label><label className="field">本地翻译模型目录<div className="voice-path"><input value={config.modelDir||''} onChange={e=>setConfig({...config,modelDir:e.target.value})} placeholder="自动使用已准备的翻译权重"/><button className="secondary" onClick={()=>act(async()=>{const path=await api.translationPick('modelDir');if(path)setConfig({...config,modelDir:path})})}>浏览</button></div></label></details>
 <button className="secondary" disabled={working} onClick={()=>act(async()=>{const saved=await api.translationSave(config);if(saved?.config)setConfig(saved.config);const next=await api.translationStatus();onStatus(next);if(next.config)setConfig(next.config);setNotice('翻译配置已保存。')})}>保存翻译设置</button>{notice&&<p className="notice" role="status">{notice}</p>}<p className="hint">本地对话和 API 回复都可使用它补译日语。气泡语言只影响阅读，语音始终朗读日语；翻译未完成时保留中文。</p>
 </>;
}
