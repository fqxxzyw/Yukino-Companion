import React,{useEffect,useRef,useState} from 'react';
export default function ReferenceAudioCheck({api,reference,onSave}){
 const [checking,setChecking]=useState(false),[info,setInfo]=useState(null),[error,setError]=useState(''),[url,setUrl]=useState('');const epoch=useRef(0);
 useEffect(()=>{epoch.current++;setChecking(false);setInfo(null);setError('');setUrl('');},[reference]);
 useEffect(()=>()=>{epoch.current++;},[]);
 useEffect(()=>()=>{if(url)URL.revokeObjectURL(url);},[url]);
 async function inspect(){const current=++epoch.current;setChecking(true);setError('');setInfo(null);setUrl('');try{await onSave?.();const result=await api.voiceReference();if(current!==epoch.current)return;setInfo(result);if(result.preview){const raw=atob(result.preview.base64),bytes=Uint8Array.from(raw,character=>character.charCodeAt(0));setUrl(URL.createObjectURL(new Blob([bytes],{type:result.preview.mimeType})));}}catch(reason){if(current===epoch.current)setError(String(reason?.message||reason).replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i,''));}finally{if(current===epoch.current)setChecking(false);}}
 return <div className="settings-card"><div className="button-row"><button type="button" className="secondary" disabled={checking||!reference||!api?.voiceReference} onClick={inspect}>{checking?'正在检查…':'检查并播放参考录音'}</button></div>{error&&<p className="notice" role="alert">{error}</p>}{info&&<><p>{info.durationSeconds.toFixed(2)} 秒 · {info.sampleRate} Hz · {info.channels} 声道</p><p className={info.usable?'hint':'notice'}>{info.message}</p>{url&&<audio controls preload="metadata" src={url} onError={()=>setError('录音结构可读，但当前系统无法播放，请转换为普通 PCM WAV 后重试。')}/>}<small>这里播放原参考录音，不计作音色合成测试通过。</small></>}</div>;
}
