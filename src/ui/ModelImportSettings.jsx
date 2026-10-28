import React,{useEffect,useRef,useState} from 'react';
import {Check,FileUp,LoaderCircle,X} from 'lucide-react';
import './SkinPicker.css';
const count=value=>Number.isFinite(value)?Math.max(0,Math.floor(value)).toLocaleString():Array.isArray(value)?value.length.toLocaleString():'未报告';
const size=value=>Number.isFinite(value)?(value/1048576).toFixed(2)+' MiB':'未报告';
const modesFor=value=>Array.isArray(value?.allowedModes)?value.allowedModes.filter(mode=>['rigged','static'].includes(mode)):[];
export function ModelImportDiagnostics({inspection}){
 if(!inspection)return null;
 const d=inspection.diagnostics||{},warnings=[...new Set([...(Array.isArray(inspection.warnings)?inspection.warnings:[]),...(Array.isArray(d.warnings)?d.warnings:[])].filter(value=>typeof value==='string'))];
 return <section className="model-import-report" aria-label="模型检查结果"><header><strong>{inspection.filename||'本地 GLB 模型'}</strong><span>{size(inspection.bytes??d.bytes)}</span></header><dl className="model-import-diagnostics">{[['骨骼',d.bones],['蒙皮',d.skins],['已蒙皮网格',d.skinnedMeshes],['带权重顶点',d.weightedVertices],['网格',d.meshes],['顶点',d.vertices],['三角面',d.triangles],['形态键',d.morphs],['动画片段',d.animations],['纹理',d.textures]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{count(value)}</dd></div>)}</dl><p className="hint">{d.usableSkin?'检测到可用蒙皮数据。导入方式以检查结果允许的选项为准。':'静态展示：保留模型原始姿态。若需骨骼动作，请先完成绑定和蒙皮权重。'}</p>{Array.isArray(d.morphNames)&&d.morphNames.length>0&&<details><summary>形态键名称 · {d.morphNames.length}</summary><p className="model-import-names">{d.morphNames.filter(name=>typeof name==='string').join('、')}</p></details>}{warnings.length>0&&<ul className="model-import-warnings">{warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul>}<p className="hint">复用本项目骨架需要匹配静止姿态、绑定矩阵与逐顶点权重。当前不会直接复制骨架或自动重定向动作；无可用蒙皮的文件可选择静态导入。</p></section>;
}
export default function ModelImportSettings({api,onImported}){
 const [inspection,setInspection]=useState(null),[label,setLabel]=useState(''),[mode,setMode]=useState(''),[approved,setApproved]=useState(false),[phase,setPhase]=useState('idle'),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const sequence=useRef(0),mounted=useRef(true),operation=useRef('idle');
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;sequence.current++;api?.characterModelCancel?.().catch(()=>{});}},[api]);
 const allowed=modesFor(inspection),working=phase!=='idle',canImport=inspection&&allowed.includes(mode)&&approved&&label.trim()&&!working;
 async function inspect(){
  if(operation.current!=='idle')return;
  if(!api?.characterModelInspect){setError('请在桌面版中选择并检查本地 GLB 模型。');return;}
  const current=++sequence.current;operation.current='inspecting';setPhase('inspecting');setInspection(null);setLabel('');setMode('');setApproved(false);setError('');setNotice('');
  try{
   await api.characterModelCancel?.();const result=await api.characterModelInspect();
   if(!mounted.current||current!==sequence.current)return;
   if(!result){setNotice('已取消选择，未导入文件。');return;}
   setInspection(result);setLabel(String(result.filename||'导入模型').replace(/\.glb$/i,'').slice(0,60));
   if(!modesFor(result).length)setError('此模型暂不支持导入，请根据检查提示重新导出。');
  }catch(problem){if(mounted.current&&current===sequence.current)setError(problem?.message||'模型检查未完成，请重新选择文件。');}
  finally{if(mounted.current&&current===sequence.current){operation.current='idle';setPhase('idle');}}
 }
 async function cancel(){
  if(operation.current==='confirming')return;
  sequence.current++;operation.current='idle';setInspection(null);setLabel('');setMode('');setApproved(false);setPhase('idle');setError('');setNotice('已取消检查，未导入文件。');
  try{await api?.characterModelCancel?.();}catch(problem){if(mounted.current)setError(problem?.message||'取消检查未完成，请重试。');}
 }
 async function confirm(){
  if(!canImport||operation.current!=='idle')return;
  if(Number.isFinite(inspection.expires)&&inspection.expires<=Date.now()){setError('本次检查已过期，请重新选择并检查文件。');return;}
  if(!api?.characterModelConfirm){setError('当前桌面版没有导入确认接口。');return;}
  const current=++sequence.current;operation.current='confirming';setPhase('confirming');setError('');setNotice('');
  try{
   const entry=await api.characterModelConfirm({token:inspection.token,confirm:true,mode,label:label.trim()});
   if(!mounted.current||current!==sequence.current)return;
   setInspection(null);setMode('');setApproved(false);setNotice('已导入 '+(entry.label||label.trim())+'。模型保存在本机，可在模型列表中选择。');
   try{await onImported?.(entry);}catch(problem){if(mounted.current)setError('模型已导入，列表刷新未完成：'+(problem?.message||'请重新打开设置'));}
  }catch(problem){if(mounted.current&&current===sequence.current)setError(problem?.message||'导入未完成，请重新检查模型。');}
  finally{if(mounted.current&&current===sequence.current){operation.current='idle';setPhase('idle');}}
 }
 return <section className="model-import-settings" aria-labelledby="model-import-title"><h3 id="model-import-title">导入本地模型</h3><p className="intro">选择独立 GLB 文件，先检查骨骼、蒙皮、形态键与大小，再确认导入。文件最大 64 MiB，仅保存在本机。</p><div className="button-row"><button type="button" className="secondary" disabled={working} onClick={inspect}>{phase==='inspecting'?<LoaderCircle size={16} className="spin"/>:<FileUp size={16}/>} {inspection?'重新选择模型':'选择并检查 GLB'}</button>{(inspection||phase==='inspecting')&&<button type="button" className="text-link" disabled={phase==='confirming'} onClick={cancel}><X size={14}/>取消检查</button>}</div>{phase==='inspecting'&&<p role="status" className="hint">正在读取并验证本地模型…</p>}<ModelImportDiagnostics inspection={inspection}/>{inspection&&<><label className="field">模型名称<input maxLength={60} value={label} disabled={working} onChange={event=>setLabel(event.target.value)}/></label><fieldset className="model-import-modes" disabled={working||!allowed.length}><legend>确认导入方式</legend>{allowed.includes('rigged')&&<label><input type="radio" name="model-import-mode" value="rigged" checked={mode==='rigged'} onChange={()=>{setMode('rigged');setApproved(false);}}/><span><strong>保留原骨骼与蒙皮</strong><small>使用该文件已验证的绑定、权重、形态键与动画。</small></span></label>}{allowed.includes('static')&&<label><input type="radio" name="model-import-mode" value="static" checked={mode==='static'} onChange={()=>{setMode('static');setApproved(false);}}/><span><strong>静态模型</strong><small>显示原始姿态；不提供骨骼动作或自动套用现有骨架。</small></span></label>}</fieldset>{allowed.length>0&&<label className="model-import-ack"><input type="checkbox" checked={approved} disabled={working||!mode} onChange={event=>setApproved(event.target.checked)}/><span>我已确认检查结果，并选择{mode==='rigged'?'保留原骨骼与蒙皮':mode==='static'?'静态展示':'以上导入方式'}。</span></label>}<button type="button" className="primary" disabled={!canImport} onClick={confirm}>{phase==='confirming'?<LoaderCircle size={16} className="spin"/>:<Check size={16}/>} {phase==='confirming'?'正在保存到本机…':'确认导入'}</button></>}{error&&<p className="notice" role="alert">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}</section>;
}
