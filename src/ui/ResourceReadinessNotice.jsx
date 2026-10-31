import React,{useEffect,useState} from 'react';
import {CircleX,Download,LoaderCircle,X} from 'lucide-react';
import {DEPLOYMENT_FEATURES,observeResourceReadiness} from './resource-readiness.mjs';

export default function ResourceReadinessNotice({api,onOpenSetup}){
 const [readiness,setReadiness]=useState({kind:'checking'}),[dismissed,setDismissed]=useState(false);
 useEffect(()=>{if(!dismissed)return observeResourceReadiness(api,setReadiness);},[api,dismissed]);
 const {kind,missing=0,waiting=0,failed=0}=readiness;
 if(dismissed||kind==='ready')return null;
 if(kind==='unavailable')return <p className="settings-resource-hint">浏览器预览无法检查本地资源，请在桌面版中检查与部署。</p>;
 if(kind==='checking')return <p className="settings-resource-hint" role="status">正在检查本地资源…</p>;
 if(kind==='unknown'||kind==='error')return <div className="settings-resource-notice"><div><strong>本地资源状态尚未确认</strong><p>可以打开部署向导重新检查；未检查不代表资源缺失。</p></div><button type="button" className="secondary" onClick={()=>onOpenSetup([...DEPLOYMENT_FEATURES])}>检查资源</button></div>;
 const active=kind==='active',Icon=active?LoaderCircle:CircleX;
 const details=[missing&&`${missing} 项资源缺失`,waiting&&`${waiting} 项等待运行环境`,failed&&`${failed} 项需要处理`].filter(Boolean).join('，');
 return <div className={'settings-resource-notice'+(active?' is-active':'')}>
  <Icon className={active?'spin':''} size={18} aria-hidden="true"/>
  <div><strong>{active?'本地资源正在准备':'部分本地功能尚未准备好'}</strong><p>{active?'可打开向导查看真实进度，已完成的资源会保留。':`${details}。已有完整资源会复用，打开后可确认所需功能再安装。`}</p></div>
  <button type="button" className="secondary" onClick={()=>onOpenSetup([...DEPLOYMENT_FEATURES])}>{!active&&<Download size={14}/>}<span>{active?'查看部署进度':'一键部署全部'}</span></button>
  <button type="button" className="icon settings-resource-dismiss" aria-label="暂时隐藏资源提示" title="暂时隐藏资源提示" onClick={()=>setDismissed(true)}><X size={14}/></button>
 </div>;
}
