import ResourceHelp from './ResourceHelp.jsx';
import Select from './Select.jsx';
import StatusMark from './StatusMark.jsx';
import React,{useState,useEffect,useRef} from 'react';
import {LoaderCircle,Play} from 'lucide-react';
import {friendlyError} from './errors.mjs';
import './translation-settings.css';

const deviceName={auto:'自动检测',cpu:'CPU',cuda:'NVIDIA GPU',gpu:'GPU'};
const TEST_ENGINES=[['local','本地翻译'],['api','已配置 API 翻译']];
const MODES=[['none','不翻译','保留回复原文，不生成、不补齐第二种语言，也不加载翻译模型。'],['local','本地翻译','缺少译文时，在本机使用 Hy-MT2 补译。'],['api','已配置 API 翻译','使用「模型与 API」中已分配的翻译配置补译。']];
export default function TranslationSettings({api,status={},onStatus,onOpenSetup,mode='api',onModeChange}){
 const [notice,setNotice]=useState(''),[config,setConfig]=useState(status.config||{device:'auto',python:'',modelDir:''});
 const [checking,setChecking]=useState(false),[checkedAt,setCheckedAt]=useState(status.checkedAt||null);
 const [testing,setTesting]=useState(false),[testEngine,setTestEngine]=useState(mode==='local'?'local':'api'),[testText,setTestText]=useState('今天天气很好，我们一起散步吧。'),[testResult,setTestResult]=useState(null);
 const checkSequence=useRef(0),testSequence=useRef(0);
 useEffect(()=>{if(status.config)setConfig(status.config)},[status.config]);
 useEffect(()=>{setTestEngine(mode==='local'?'local':'api')},[mode]);
 useEffect(()=>()=>{testSequence.current++},[]);
 const shown=status.phase||status.state||'unloaded',total=status.total||status.progress?.total||0,received=status.received||status.bytes||status.progress?.received||0;
 const installed=status.modelInstalled??status.installed??(status.available||status.ready),runtime=status.runtimeAvailable??status.available;
 const downloading=['checking','downloading'].includes(shown)||status.phase==='downloading';
 const resourceKind=downloading?'downloading':installed?'installed':'pending';
 const engineKind=runtime===false?'error':runtime===true?'ready':'idle';
 const verified=testResult?.status==='ready'?'ready':testResult?.status==='error'?'error':'idle';
 async function act(fn){if(!api){setNotice('请在桌面版配置本地翻译。');return}try{await fn()}catch(e){setNotice(friendlyError(e))}}
 async function refresh(){
  if(checking)return;const sequence=++checkSequence.current;
  if(!api?.translationStatus){setNotice('浏览器预览无法检查本地资源，请在桌面版刷新。');return}
  setChecking(true);setNotice('');
  try{const next=await api.translationStatus();if(sequence!==checkSequence.current)return;onStatus(next);if(next?.config)setConfig(next.config);setCheckedAt(new Date().toISOString())}
  catch(e){if(sequence===checkSequence.current)setNotice(friendlyError(e))}
  finally{if(sequence===checkSequence.current)setChecking(false)}
 }
 async function test(){
  if(testing)return;const sequence=++testSequence.current,text=testText.trim();
  if(!text){setNotice('请填写要翻译的测试文本。');return}
  if(!api?.translate){setNotice('浏览器预览无法发起真实翻译，请在桌面版测试。');return}
  setTesting(true);setNotice('');setTestResult(null);
  const started=performance.now();
  try{const result=await api.translate({text,requestId:`translation-test-${Date.now()}`,mode:testEngine});if(sequence!==testSequence.current)return;setTestResult({status:'ready',text:result?.text||'',ms:Math.round(performance.now()-started),engine:result?.source||testEngine,model:result?.model});}
  catch(e){if(sequence!==testSequence.current)return;setTestResult({status:'error',error:friendlyError(e,'翻译没有完成。'),ms:Math.round(performance.now()-started),engine:testEngine})}
  finally{if(sequence===testSequence.current)setTesting(false)}
 }
 return <>
 <p className="intro">决定角色的回复是否附带第二种语言。显示语言、朗读语言与翻译方式分别设置。</p>
 <section className="settings-section">
  <h3>翻译方式</h3>
  <div className="translation-mode-grid" role="radiogroup" aria-label="翻译方式">{[...MODES].map(([value,label,detail])=><label key={value} className={'translation-mode-option'+(mode===value?' selected':'')}>
   <input type="radio" name="translation-mode" value={value} checked={mode===value} disabled={!onModeChange} onChange={()=>onModeChange?.(value)}/>
   <span><strong>{label}</strong><small>{detail}</small></span>
  </label>)}</div>
  {mode==='none'&&<p className="hint" role="status">普通聊天会保留回复原文，不调用本地或云端翻译，也不会为了朗读自动改写语言。朗读需要音色支持原文语言。</p>}
 </section>
 <section className="settings-section">
  <h3>本地翻译资源</h3>
  <div className="voice-status resource-card">
   <div className="status-mark-row" role="status" aria-live="polite"><StatusMark kind={resourceKind} label={downloading?'下载中':installed?'已安装':'待下载'} detail={installed?'完整权重文件已找到，首次翻译时才会加载':'尚未找到完整的翻译权重文件。'}/><StatusMark kind={engineKind} label={runtime===false?'等待公共环境':runtime===true?'公共环境可用':'公共环境未检查'}/><StatusMark kind={verified} label={verified==='ready'?'测试通过':verified==='error'?'测试失败':'尚未验证'} detail={checkedAt?`上次检查：${new Date(checkedAt).toLocaleString()}`:'还没有执行过检查。'}/></div>
   <span className="resource-card-sub">Hy-MT2-1.8B · Q4 量化{status.modelBytes?` · ${(status.modelBytes/1e9).toFixed(2)} GB`:' · 约 1.13 GB'}</span>
   <details className="advanced-settings"><summary>资源详情与设备</summary><p>权重来源：{status.modelSource==='bundled'?'随安装包提供':status.modelSource==='custom'?'你选择的本地目录':status.modelSource==='downloaded'?'本机下载目录':'检查内置权重与本地目录后再按需下载。'}</p><p>{runtime===false?'公共环境尚未准备好，模型文件仍保留在本机。':'权重安装和模型加载是两件事：未加载只表示暂未占用推理内存。'}</p>{status.device&&<p>翻译设备：{deviceName[status.device]||'自动检测'}</p>}{status.error&&<p>{friendlyError(status.error,'本地翻译暂不可用，请检查资源。')}</p>}</details>
   {total>0&&downloading&&<><progress value={received} max={total}/><span>{Math.round(received/1048576)} / {Math.round(total/1048576)} MB</span></>}
   <div className="button-row"><button className="primary" disabled={checking||downloading} onClick={()=>act(async()=>{const next=await api.translationInstall();onStatus(next);if(next.config)setConfig(next.config);setCheckedAt(new Date().toISOString());setNotice('翻译权重已校验，完整文件不会再次下载。')})}>{installed?'校验翻译权重':'准备翻译权重'}</button><button className="secondary" disabled={checking} aria-busy={checking||undefined} onClick={refresh}>{checking?<LoaderCircle size={14} className="spin"/>:<Play size={14}/>}{checking?'刷新中':'刷新状态'}</button>{downloading&&<button className="text-link" onClick={()=>api?.translationCancel().catch(e=>setNotice(friendlyError(e)))}>取消下载</button>}{runtime===false&&<button className="text-link" onClick={onOpenSetup}>一键准备公共环境</button>}</div>
   <p className="hint">刷新只检查文件、绑定和引擎状态，不会发起翻译请求，也不会产生费用。</p>
  </div>
 </section>
 <section className="settings-section translation-test">
  <h3>测试翻译</h3>
  <p className="hint">只有点击下方按钮才会执行一次真实翻译，可能产生服务商费用。</p>
  <label className="field">测试文本<textarea rows={3} maxLength={2000} value={testText} disabled={testing} onChange={event=>setTestText(event.target.value)}/></label>
  <div className="translation-test-row"><label className="field">使用方式<Select value={testEngine} disabled={testing} onChange={event=>setTestEngine(event.target.value)}>{TEST_ENGINES.map(([value,label])=><option key={value} value={value}>{label}</option>)}</Select></label><button type="button" className="primary" disabled={testing||!testText.trim()} aria-busy={testing||undefined} onClick={test}>{testing?<LoaderCircle size={14} className="spin"/>:<Play size={14}/>}{testing?'翻译中':'测试翻译'}</button></div>
  {testResult?.status==='ready'&&<div className="translation-test-result" role="status"><span>译文</span><p>{testResult.text||'（返回为空）'}</p><small>耗时 {testResult.ms} ms · 方式：{testResult.engine==='local'?'本地翻译':'已配置 API'}{testResult.model?` · 模型：${testResult.model}`:''}</small></div>}
  {testResult?.status==='error'&&<div className="translation-test-result error" role="alert"><span>翻译失败</span><p>{testResult.error}</p><small>耗时 {testResult.ms} ms · 方式：{testResult.engine==='local'?'本地翻译':'已配置 API'}</small></div>}
 </section>
 <ResourceHelp api={api}/>
 <details className="advanced-settings"><summary>高级 · 自定义翻译环境与设备</summary><label className="field">翻译推理设备<Select value={config.device||'auto'} disabled={checking} onChange={e=>setConfig({...config,device:e.target.value})}><option value="auto">自动 · 兼容 GPU 可用时优先使用</option><option value="cpu">CPU</option><option value="cuda">NVIDIA GPU</option></Select><small>GPU 模式需要兼容的运行环境。显存不足时按照配置回退 CPU。</small></label><p className="hint">一般无需填写路径。仅在使用自己的运行环境或权重时修改。</p><label className="field">Python 可执行文件<div className="voice-path"><input value={config.python||''} onChange={e=>setConfig({...config,python:e.target.value})} placeholder="自动选择已准备的公共环境"/><button className="secondary" onClick={()=>act(async()=>{const path=await api.translationPick('python');if(path)setConfig({...config,python:path})})}>浏览</button></div></label><label className="field">本地翻译模型目录<div className="voice-path"><input value={config.modelDir||''} onChange={e=>setConfig({...config,modelDir:e.target.value})} placeholder="自动使用已准备的翻译权重"/><button className="secondary" onClick={()=>act(async()=>{const path=await api.translationPick('modelDir');if(path)setConfig({...config,modelDir:path})})}>浏览</button></div></label><button className="secondary" disabled={checking} onClick={()=>act(async()=>{const saved=await api.translationSave(config);if(saved?.config)setConfig(saved.config);const next=await api.translationStatus();onStatus(next);if(next.config)setConfig(next.config);setCheckedAt(new Date().toISOString());setNotice('翻译配置已保存。')})}>保存翻译设置</button></details>
 {notice&&<p className="notice" role="status">{notice}</p>}
 <p className="hint">气泡语言仅影响显示。朗读语言跟随所选音色与语音输出设置，不会为了朗读而自动翻译原文。</p>
 </>;
}
