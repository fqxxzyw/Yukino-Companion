import React,{useEffect,useMemo,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import VisionDialog from './ui/VisionDialog.jsx';
import {CameraPreview} from './ui/camera-preview.mjs';
import './visual-window.css';
const bridge=window.visualCompanion;
function VisualWindow(){
 const [info,setInfo]=useState(null),[mode,setMode]=useState(''),[state,setState]=useState({phase:'idle'}),[error,setError]=useState(''),[captureConsent,setCaptureConsent]=useState(false),[sendConsent,setSendConsent]=useState(false),[watchConsent,setWatchConsent]=useState(false),[deviceId,setDeviceId]=useState(''),[devices,setDevices]=useState([]),[prompt,setPrompt]=useState('请简短描述当前画面，合适时自然问候；不要复述密码或其他私人信息。'),[interval,setIntervalSeconds]=useState(15),[readAloud,setReadAloud]=useState(false);
 const video=useRef(null),camera=useRef(null),intent=useRef(0);
 const call=(action,payload)=>bridge?.call(action,payload)||Promise.reject(Error('请在桌面版打开视觉面板'));
 const screenApi=useMemo(()=>({visionSources:options=>call('screen-sources',options),visionAnalyze:options=>call('screen-analyze',options),visionWatch:options=>call('screen-watch',options),visionCancel:()=>call('screen-stop'),onVisionStatus:fn=>bridge?.onStatus(value=>{if(!value.phase.startsWith('camera-'))fn(value)})}),[]);
 useEffect(()=>{call('info').then(setInfo).catch(error=>setError(error.message));const off=bridge?.onStatus(value=>{if(['stopped','configuration-changed'].includes(value.phase)){intent.current++;camera.current?.stop('external-stop');setCaptureConsent(false);setSendConsent(false);setWatchConsent(false);if(value.phase==='configuration-changed'){setMode('');setInfo(null);setError('角色或 API 设置已变更，请关闭后重新打开面板。')}}});const hide=()=>{if(document.hidden){intent.current++;camera.current?.setHidden(true);call('stop').catch(()=>{})}else camera.current?.setHidden(false)};document.addEventListener('visibilitychange',hide);return()=>{intent.current++;off?.();camera.current?.dispose();document.removeEventListener('visibilitychange',hide);call('stop').catch(()=>{})}},[]);
 useEffect(()=>{if(mode!=='camera'||!video.current)return;const controller=new CameraPreview({mediaDevices:navigator.mediaDevices,video:video.current,createCanvas:()=>document.createElement('canvas'),api:{startPreview:options=>call('camera-start',options),analyzeFrame:options=>call('camera-frame',options),stopPreview:options=>call('camera-stop',options)},onState:setState});camera.current=controller;return()=>{controller.dispose();if(camera.current===controller)camera.current=null}},[mode]);
 function stop(){intent.current++;camera.current?.stop('user-stop');call('stop').catch(()=>{});setCaptureConsent(false);setSendConsent(false);setWatchConsent(false)}
 function selectMode(next){stop();setError('');setState({phase:'idle'});setMode(next);setDevices([]);setDeviceId('')}
 async function start(){const seq=++intent.current;setError('');setSendConsent(false);setWatchConsent(false);try{await camera.current.start({consent:captureConsent,deviceId});if(seq!==intent.current)return;const list=await navigator.mediaDevices.enumerateDevices();if(seq===intent.current)setDevices(list.filter(d=>d.kind==='videoinput').map((d,i)=>({id:d.deviceId,label:d.label||`摄像头 ${i+1}`})))}catch(error){if(seq===intent.current)setError(error.message)}}
 async function send(watch=false){const seq=intent.current;setError('');try{if(watch)await camera.current.startWatch({consent:sendConsent,watchConsent,prompt,intervalSeconds:interval});else await camera.current.sendOnce({consent:sendConsent,prompt});}catch(error){if(seq===intent.current)setError(error.message)}}
 const active=state.active===true,preview=state.localPreview===true,busy=['starting','requesting','sending'].includes(state.phase)||state.sending===true;
 return <main className="visual-panel"><header><div><strong>视觉陪伴</strong><small>定时图片识别 · 不是实时音视频通话</small></div><button aria-label="关闭并停止视觉陪伴" onClick={()=>{stop();call('close')}}>×</button></header><p>默认不读取屏幕或摄像头。先本机预览，再确认发送。不会启用麦克风，不录制、不保存图片；隐藏、切换角色／服务、锁屏或关闭即停止。</p><p className="destination">视觉 API：{info?.profile?.base||'未配置'} · {info?.profile?.model||'未选择'}</p>
 <label><input type="checkbox" checked={readAloud} onChange={e=>{setReadAloud(e.target.checked);call('read-aloud',{enabled:e.target.checked}).catch(error=>setError(error.message))}}/>朗读识别结果（还需已开启并配置对话语音；日语补译可能产生 API 费用）</label>
 <nav aria-label="选择视觉来源"><button aria-pressed={mode==='screen'} onClick={()=>selectMode('screen')}>屏幕 / 窗口</button><button aria-pressed={mode==='camera'} onClick={()=>selectMode('camera')}>摄像头</button></nav>
 {!info?.profile?.visionEnabled&&<p role="alert">请先在主窗口选择支持图片输入的 API 并确认视觉能力；本地文本模型不可用。</p>}
 {mode==='screen'&&info&&<VisionDialog api={screenApi} profile={info.profile} companionship onClose={()=>selectMode('')}/>}
 {mode==='camera'&&<section aria-label="摄像头预览和发送"><p>本机预览不上传。只有下方单次确认或持续确认才发送画面。建议避开证件、其他人和私人空间。</p><label><input type="checkbox" checked={captureConsent} disabled={active||busy} onChange={e=>setCaptureConsent(e.target.checked)}/>允许本次启动摄像头（仅视频，无麦克风）</label>
 {devices.length>0&&<label>摄像头<select value={deviceId} onChange={e=>{stop();setDeviceId(e.target.value)}}><option value="">系统默认摄像头</option>{devices.map(d=><option value={d.id} key={d.id}>{d.label}</option>)}</select></label>}
 <button disabled={!captureConsent||active||busy||!info?.profile?.visionEnabled} onClick={start}>开始本机预览</button>
 <video ref={video} muted playsInline autoPlay aria-label="本机摄像头预览，确认前不发送"/>
 {(active||busy)&&<p className="indicator" role="status"><span/> {state.sending?'正在向已确认的 API 发送一帧':state.watching?'已开启定时识别':'摄像头本机预览中，尚未持续发送'} · {state.count||0}/60 帧 <button onClick={stop}>停止全部</button></p>}
 <label>识别问题<input value={prompt} maxLength={4000} disabled={state.watching||busy} onChange={e=>{setPrompt(e.target.value);setSendConsent(false);setWatchConsent(false)}}/></label>
 <label><input type="checkbox" checked={sendConsent} disabled={!preview||busy||state.watching} onChange={e=>setSendConsent(e.target.checked)}/>确认发送当前画面至 {info?.profile?.base}（{info?.profile?.model}），可能产生费用</label>
 <button disabled={!preview||!sendConsent||busy||state.watching} onClick={()=>send(false)}>发送当前画面并识别一次</button>
 <details><summary>持续视觉陪伴（默认关闭）</summary><p>每次回复结束后再等待下列间隔，无并行积压。最多 10 分钟 / 60 帧，随后重新确认。网络和模型速度会影响响应，不是实时视频流。</p><label>间隔<select value={interval} disabled={state.watching} onChange={e=>{setIntervalSeconds(Number(e.target.value));setWatchConsent(false)}}>{[5,15,30,60].map(n=><option key={n} value={n}>{n} 秒</option>)}</select></label><label><input type="checkbox" checked={watchConsent} disabled={!preview||state.watching} onChange={e=>setWatchConsent(e.target.checked)}/>同意持续发送这台摄像头的新画面，直到停止或达到上限</label><button disabled={!preview||!sendConsent||!watchConsent||busy||state.watching} onClick={()=>send(true)}>开始定时识别</button></details>
 {state.result&&<div className="vision-result" aria-live="polite">{typeof state.result==='string'?state.result:state.result.text}</div>}{state.error&&<p role="alert">{state.error}</p>}</section>}
 {error&&<p role="alert">{error}</p>}<footer>识别文字会直接显示在桌面角色和桌宠气泡中；截图不会进入聊天历史。</footer></main>
}
createRoot(document.getElementById('root')).render(<VisualWindow/>);
