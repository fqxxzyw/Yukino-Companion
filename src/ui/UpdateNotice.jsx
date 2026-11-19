import React,{useEffect,useState} from 'react';
import {Download} from 'lucide-react';

function size(value){
  const bytes=Number(value)||0;
  if(bytes>=1024**2)return `${(bytes/1024**2).toFixed(bytes>=100*1024**2?0:1)} MB`;
  if(bytes>=1024)return `${(bytes/1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export default function UpdateNotice({api}){
  const [release,setRelease]=useState(null),[open,setOpen]=useState(false),[busy,setBusy]=useState(''),[checking,setChecking]=useState(false),[progress,setProgress]=useState(null),[downloaded,setDownloaded]=useState(null),[message,setMessage]=useState('');
  useEffect(()=>{
    if(!api?.appUpdateCheck)return;
    let active=true;
    const check=()=>api.appUpdateCheck().then(value=>{if(active)setRelease(value)}).catch(()=>{});
    const timer=setTimeout(check,5000),interval=setInterval(check,6*60*60*1000);
    const off=api.onAppUpdateProgress?.(value=>{if(active)setProgress(value)});
    return()=>{active=false;clearTimeout(timer);clearInterval(interval);off?.()};
  },[api]);
  if(!api?.appUpdateCheck)return null;

  async function check(){
    setChecking(true);setMessage('');setDownloaded(null);setProgress(null);
    try{
      const value=await api.appUpdateCheck();
      setRelease(value);
      if(!value)setMessage('当前没有可用的正式版更新。');
    }catch(error){setMessage('检查更新失败：'+error.message)}
    finally{setChecking(false)}
  }
  async function download(){
    setBusy('download');setProgress(null);setMessage('');
    try{
      const result=await api.appUpdateDownload();
      if(result?.cancelled){setMessage('已取消下载。');return}
      if(result?.ready){
        setDownloaded(result);
        setMessage(result.differential?'更新已下载，本次只下载了变化部分。':'更新已下载；本次使用了完整安装包。');
      }else if(result?.saved){
        setMessage('安装包已保存。关闭应用后运行它，并选择原安装目录更新。');
      }
    }catch(error){setMessage(error.message)}
    finally{setBusy('')}
  }
  async function install(){
    if(!api.appUpdateInstall){setMessage('当前版本不支持应用内安装，请运行已下载的安装包。');return}
    setBusy('install');setMessage('');
    try{
      const result=await api.appUpdateInstall();
      if(result?.installing)setMessage('正在退出应用并启动安装程序…');
      else setMessage('安装程序没有启动，请重试或前往 GitHub 下载。');
    }catch(error){setMessage(error.message)}
    finally{setBusy('')}
  }

  const portable=release?.portable===true;
  const canDownload=release?.downloadable===true&&!downloaded;
  return <div className="app-update">
    <button type="button" className="app-update-trigger" onClick={()=>setOpen(!open)} aria-expanded={open}><Download size={14} aria-hidden="true"/><span>{release?`发现新版本 ${release.version}`:'应用更新'}</span></button>
    {open&&<div className="app-update-popover" role="dialog" aria-label="应用更新">
      <strong>{release?`发现新版本 ${release.version}`:'应用更新'}</strong>
      <p>{portable?'便携版不能原地安装，会保存完整安装包；安装版会优先只下载变化区块。':'安装版优先使用 blockmap 增量下载；首次更新或本地缓存缺失时会回退完整安装包。'}</p>
      {release&&!release.downloadable&&<p>此版本暂无可下载的基础安装包，请前往 GitHub 查看。</p>}
      {busy==='download'&&<p role="status">正在下载{progress?.differential?'变化部分':'更新'} {progress?.total?`${Math.round(progress.percent||0)}%`:'…'}{progress?.bytes&&progress?.total?` · ${size(progress.bytes)} / ${size(progress.total)}`:''}</p>}
      {busy==='install'&&<p role="status">正在启动安装程序…</p>}
      {message&&<p role="status">{message}</p>}
      <div>
        {canDownload&&<button type="button" disabled={Boolean(busy)} onClick={download}>下载更新</button>}
        {downloaded&&api.appUpdateInstall&&<button type="button" disabled={Boolean(busy)} onClick={install}>{busy==='install'?'正在重启…':'重启并安装'}</button>}
        <button type="button" disabled={busy||checking} onClick={check}>{checking?'检查中…':'检查更新'}</button>
        <button type="button" onClick={()=>api.appUpdateOpen().catch(error=>setMessage(error.message))}>前往 GitHub</button>
        <button type="button" onClick={()=>setOpen(false)}>关闭</button>
      </div>
    </div>}
  </div>;
}
