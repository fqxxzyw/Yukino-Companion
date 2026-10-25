import React, { useEffect, useState } from 'react';

export const voiceDefaults = { enabled:false, python:'', root:'', gpt:'', sovits:'', reference:'', bert:'', hubert:'', ffmpeg:'',
  promptText:'', promptLang:'ja', textLang:'all_ja', version:'v1', device:'auto', half:false, cpuFallback:true, cpuThreads:4,
  speed:1, volume:0.8, timeout:300 };
export const phaseNames = { unloaded:'未加载', loading:'正在加载', ready:'模型就绪', synthesizing:'正在合成', playing:'正在播放', waiting:'等待文字', idle:'待机', paused:'已停止，待重新加载', error:'语音异常' };
const pathLabels = { python:'Python 可执行文件', root:'GPT-SoVITS 推理目录', gpt:'GPT 权重（.ckpt）', sovits:'SoVITS 权重（.pth）',
  reference:'参考音频（3–10 秒 WAV / FLAC）', bert:'BERT 基础模型目录', hubert:'HuBERT 基础模型目录', ffmpeg:'FFmpeg 可执行文件（可选，自动查找）' };
const langs = [['zh','中英混合'],['ja','日英混合'],['en','英语'],['auto','自动多语言'],['all_zh','中文'],['all_ja','日语'],['yue','粤英混合'],['ko','韩英混合']];

export default function VoiceSettings({api,config,onChange,status,onPreview,onStop}) {
  const [notice,setNotice]=useState(''),[working,setWorking]=useState(false),[hardware,setHardware]=useState(null),[sample,setSample]=useState('こんにちは。今日は何を話しましょうか。');
  const [resources,setResources]=useState({phase:'idle'}),[selectedPack,setSelectedPack]=useState('yukino-e1');
  const downloading=['checking','downloading','extracting'].includes(resources.phase);
  const readyReference=Boolean(config.reference&&config.promptText.trim());
  useEffect(()=>{if(!api)return;api.voiceResources().then(setResources).catch(e=>setNotice(e.message));return api.onVoiceDownload(status=>setResources(old=>({...old,...status})))},[api]);
  const patch = value => onChange({...config,...value,textLang:'all_ja'});
  async function action(fn) {
    if(!api){setNotice('请在桌面应用中配置本地语音。');return;}
    setWorking(true); setNotice('');
    try { await fn(); } catch(e) { setNotice(e.message); } finally { setWorking(false); }
  }
  async function save() { await api.voiceSave({...config,textLang:'all_ja'}); setNotice('配置已保存；模型、语言、语速等推理设置修改后需重新加载。'); }
  return <>
    <p className="intro">使用你已训练好的 GPT-SoVITS 权重在本机合成声音。只运行推理，不启动训练或 WebUI。</p>
    <div className="voice-status">
      <strong>{resources.bundled?'内嵌推理环境已就绪':'推理运行环境'}</strong>
      <span>{resources.bundled?'Python、推理代码和 FFmpeg 由安装包提供，无需另开网页。':'开发版需准备运行环境；完整 Windows 安装包会携带运行环境。'}</span>
      <span>公共基础模型约 802 MiB。完成后可安装下方已发布音色，或导入自己的训练文件。</span>
      {resources.total>0&&<><progress max={resources.total} value={resources.received||0}/><span>{Math.round((resources.received||0)/1048576)} / {Math.round(resources.total/1048576)} MiB · {resources.phase==='complete'?'下载与校验完成':resources.file||resources.phase}</span></>}
      {resources.error&&<span>{resources.error}</span>}
      <div className="button-row"><button className="primary" disabled={working||downloading} onClick={()=>action(async()=>{const paths=await api.voiceInstall('core');const next={...config,...paths};onChange(next);await api.voiceSave(next);setNotice('公共模型已校验并安装，接下来选择音色与参考音频。')})}>下载 / 校验公共模型</button><button className="secondary" onClick={()=>api?.voiceDownloadCancel().catch(e=>setNotice(e.message))}>取消下载</button></div>
    </div>
    <div className="voice-status">
      <strong>已发布音色</strong>
      <span>已收录你的 GPT e1–e5 与 SoVITS e1 权重；轮次不代表音质排名，可以逐个试听选择。</span>
      <label className="field">音色模型<select value={selectedPack} onChange={e=>setSelectedPack(e.target.value)}>
        {(resources.packs||[]).filter(p=>p.kind==='voice').map(p=><option value={p.id} key={p.id}>{p.label}</option>)}
        {!(resources.packs||[]).some(p=>p.kind==='voice')&&<option value="yukino-e1">雪乃 · GPT e1 / SoVITS e1（v1）</option>}
      </select></label>
      <div className="button-row"><button className="primary" disabled={working||downloading} onClick={()=>action(async()=>{onStop();await api.voiceUnload();const paths=await api.voiceInstall(selectedPack);const next={...config,...paths,textLang:'all_ja'};onChange(next);await api.voiceSave(next);setNotice('音色权重已下载、校验并选中。请补充参考音频及其准确转录，然后加载模型。')})}>下载 / 选用音色</button></div>
      <span>首次约 223 MiB；不同 GPT 轮次共用 SoVITS 文件。仍可在下方选择任意本地 .ckpt 和 .pth。</span>
      <span>该 Release 未提供参考音频。需要你选择 3–10 秒干净音频并填写准确原文，才能合成；不会自动猜测转录。</span>
    </div>
    <div className="voice-status" role="status"><strong>{phaseNames[status.phase]||status.phase}</strong>
      {status.metadata&&<span>{status.metadata.device} · {status.metadata.half?'FP16':'FP32'} · {status.metadata.version}{status.metadata.cpuFallback?' · 显存不足，已回退 CPU':''}</span>}
      {status.error&&<p>{status.error}</p>}
    </div>
    <label className="row"><div><strong>自动朗读新回复</strong><small>中文回复先完成日语翻译再朗读。气泡显示语言不会改变语音语言。</small></div><input type="checkbox" checked={config.enabled} onChange={e=>patch({enabled:e.target.checked})}/></label>
    <label className="field">播放音量 · {Math.round(config.volume*100)}%<input type="range" min="0" max="1" step="0.05" value={config.volume} onChange={e=>patch({volume:Number(e.target.value)})}/></label>
    <fieldset disabled={working}>
      {Object.entries(pathLabels).map(([key,label])=><label className="field" key={key}>{label}<div className="voice-path"><input value={config[key]} onChange={e=>patch({[key]:e.target.value})} placeholder="选择本机文件或目录"/><button type="button" className="secondary" onClick={()=>action(async()=>{const selected=await api.voicePick(key);if(selected)patch({[key]:selected})})}>浏览</button></div></label>)}
      <p className="hint">GPT .ckpt 与 SoVITS .pth 是两个模型。BERT / HuBERT 是公共基础资源；v3/v4/Pro/LoRA 等版本还可能需要对应底模或声码器。路径仅引用原文件，不复制权重。</p>
      <div className="voice-grid">
        <label className="field">模型版本<select value={config.version} onChange={e=>patch({version:e.target.value})}>{['v1','v2','v2Pro','v2ProPlus','v3','v4','v5dev','v5turbo'].map(v=><option key={v}>{v}</option>)}</select></label>
        <label className="field">推理设备<select value={config.device} onChange={e=>patch({device:e.target.value})}><option value="auto">自动：CUDA 可用时使用 GPU</option><option value="cpu">CPU</option><option value="cuda">CUDA GPU（不可用时报错）</option></select></label>
        <label className="field">合成语言<input value="日语（固定）" readOnly/><small>只朗读日语译文；翻译失败时保留文字，不朗读中文。</small></label>
        <label className="field">参考音频语言<select value={config.promptLang} onChange={e=>patch({promptLang:e.target.value})}>{langs.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
      </div>
      <label className="field">参考音频对应文本<textarea rows="3" maxLength={3000} value={config.promptText} onChange={e=>patch({promptText:e.target.value})} placeholder="填写参考音频实际说出的内容，不是待合成的回复。"/></label>
      <label className="row"><div><strong>GPU 半精度</strong><small>默认关闭以兼容更多设备；CPU 始终使用 FP32。</small></div><input type="checkbox" checked={config.half} onChange={e=>patch({half:e.target.checked})}/></label>
      <label className="row"><div><strong>显存不足时回退 CPU</strong><small>会重新加载模型，合成速度可能明显变慢。</small></div><input type="checkbox" checked={config.cpuFallback} onChange={e=>patch({cpuFallback:e.target.checked})}/></label>
      <div className="voice-grid">
        <label className="field">语速（0.5–2）<input type="number" min="0.5" max="2" step="0.1" value={config.speed} onChange={e=>patch({speed:Number(e.target.value)})}/></label>
        <label className="field">CPU 线程（1–32）<input type="number" min="1" max="32" value={config.cpuThreads} onChange={e=>patch({cpuThreads:Number(e.target.value)})}/></label>
        <label className="field">单次超时（30–900 秒）<input type="number" min="30" max="900" value={config.timeout} onChange={e=>patch({timeout:Number(e.target.value)})}/></label>
      </div>
      <div className="button-row"><button className="secondary" onClick={()=>action(save)}>保存配置</button><button className="secondary" onClick={()=>action(async()=>setHardware(await api.voiceProbe(config)))}>检测 GPU / CPU</button><button className="primary" disabled={!readyReference} onClick={()=>action(async()=>{onStop();await save();await api.voiceLoad({...config,textLang:'all_ja'});setNotice('权重与参考音频已加载，可以试听。')})}>加载 / 重新加载</button></div>
    </fieldset>
    {!readyReference&&<p className="notice">尚未选择参考音频或填写对应原文，暂时不能加载与试听。参考音频语言请按音频实际内容选择。</p>}
    {hardware&&<p className="notice">PyTorch {hardware.torch} · {hardware.cudaAvailable?hardware.devices.map(d=>`${d.name} (${d.vramGiB} GiB)`).join('，'):'无可用 CUDA，将使用 CPU'}{hardware.cudaError?`；${hardware.cudaError}`:''}</p>}
    <label className="field">日语试听文本<input maxLength={200} value={sample} onChange={e=>setSample(e.target.value)}/></label>
    <div className="button-row"><button className="primary" disabled={working||!sample.trim()||!['ready','paused','error'].includes(status.phase)} onClick={()=>onPreview({text:sample,language:'ja'})}>试听</button><button className="secondary" onClick={onStop}>停止朗读</button><button className="secondary" onClick={()=>action(async()=>{onStop();await api.voiceUnload();setNotice('已卸载模型并释放推理进程。')})}>卸载模型</button></div>
    {notice&&<p className="notice" role="status">{notice}</p>}
    <p className="hint">中止正在合成的语音会结束本软件启动的推理进程，下次朗读自动重新加载。CPU 运行环境即使检测到显卡也不能启用 CUDA；使用带 CUDA 的运行环境后，自动模式才会优先使用 GPU。</p>
  </>;
}
