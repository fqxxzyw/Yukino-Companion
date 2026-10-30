import React,{useEffect,useRef,useState} from 'react';
export const speechConfigSignature=config=>JSON.stringify(['python','root','gpt','sovits','bert','hubert','reference','promptText','promptLang','version','device','half','cpuFallback','speed'].map(key=>config?.[key]));

export default function VoiceAudition({api,config,onSave,onPreview,onStop,status={},onVerified}){
 const [text,setText]=useState('こんにちは。今日もよろしくお願いします。'),[phase,setPhase]=useState('idle'),[result,setResult]=useState(null),[error,setError]=useState('');
 const epoch=useRef(0),running=useRef(false),stop=useRef(onStop);stop.current=onStop;
 const signature=speechConfigSignature(config);
 useEffect(()=>{epoch.current++;if(running.current)stop.current?.();running.current=false;setPhase('idle');setResult(null);setError('');},[signature]);
 useEffect(()=>()=>{epoch.current++;if(running.current)stop.current?.();},[]);
 async function audition(){
  const current=++epoch.current;running.current=true;setPhase('preparing');setError('');setResult(null);const start=Date.now();
  try{
   if(!api||!onPreview)throw Error('请在桌面应用中试听。');
   await onSave?.();if(current!==epoch.current)return;
   setPhase('running');const completed=await onPreview({text,language:'ja'});
   if(current!==epoch.current)return;
   if(completed?.completed!==true)throw Error(completed?.error||(completed?.cancelled?'试听已停止。':'试听尚未确认完成；请检查语音状态后重试。'));
   const latest=await api.voiceStatus();if(current!==epoch.current)return;
   const metadata=latest.metadata?.sessionId===completed.id?latest.metadata:{};
   setResult({metadata,elapsedMs:Date.now()-start,signature});setPhase('complete');
  }catch(reason){if(current===epoch.current){setPhase('error');setError(String(reason?.message||reason).replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i,''));}}
  finally{if(current===epoch.current)running.current=false;}
 }
 const active=['preparing','running'].includes(phase),labels={loading:'正在加载音色',synthesizing:'正在生成语音',playing:'正在播放'};
 return <section className="settings-card voice-audition"><h3>听听雪乃的声音吧</h3><p className="hint">使用当前权重真实合成日语，再播放生成的声音。</p>
  <label className="field">日语试听文本<input value={text} maxLength={200} disabled={active} onChange={event=>{setText(event.target.value);setResult(null);setPhase('idle');}}/></label>
  <div className="button-row"><button type="button" className="primary" disabled={active||!text.trim()} onClick={audition}>{result?'重新试听':'试听雪乃的声音'}</button><button type="button" className="secondary" disabled={!active} onClick={()=>{epoch.current++;running.current=false;onStop?.();setPhase('idle');setResult(null);setError('试听已停止。');}}>停止试听</button></div>
  {active&&<p role="status">{phase==='preparing'?'正在检查和保存配置':labels[status.phase]||'正在合成并播放，请稍候…'}</p>}
  {error&&<p className="notice" role="alert">{error}</p>}
  {result&&<div className="voice-status" role="status"><strong>语音已合成并播放</strong><span>本次总耗时 {(result.elapsedMs/1000).toFixed(2)} 秒 · 实际设备：{result.metadata.device||'服务未返回'}</span>{Number.isFinite(result.metadata.synthesisMs)&&<span>最后一段合成耗时 {(result.metadata.synthesisMs/1000).toFixed(2)} 秒（不含播放）</span>}{result.metadata.cpuFallback&&<span>已回退 CPU：{result.metadata.cpuFallbackReason||'GPU 推理失败'}</span>}<p>声音听起来正常吗？</p><button type="button" className="primary" onClick={()=>{onVerified?.(result);setPhase('confirmed');}}>声音正常{onVerified?'，继续':'，已确认'}</button>{phase==='confirmed'&&<span>已确认当前音色；修改权重、参考音频或推理参数后需重新试听。</span>}</div>}
 </section>;
}
