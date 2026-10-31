import React, { useEffect, useId, useRef, useState } from 'react';

function messageOf(reason) {
  const message = typeof reason === 'string' ? reason : reason?.message;
  return String(message || '无法读取或保存音频缓存设置，请重试。')
    .replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, '');
}

function checkedStatus(value) {
  if (!value || typeof value.enabled !== 'boolean' || !Number.isInteger(value.retentionDays) ||
      value.retentionDays < 1 || value.retentionDays > 30 || typeof value.root !== 'string' || !value.root.trim() ||
      !Number.isSafeInteger(value.files) || value.files < 0 || !Number.isSafeInteger(value.bytes) || value.bytes < 0) {
    throw Error(value?.error ? messageOf(value.error) : '桌面端未返回有效缓存状态，未确认保存成功。');
  }
  return value;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

// The main process selects root. This component never sends a filesystem path.
export default function SpeechCacheSettings({ api }) {
  const available = typeof api?.speechCacheStatus === 'function' && typeof api?.speechCacheSave === 'function';
  const [status, setStatus] = useState(null);
  const [enabled, setEnabled] = useState(false);
  const [days, setDays] = useState('7');
  const [phase, setPhase] = useState('idle');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const epoch = useRef(0);
  const privacyId = useId();
  const daysValid = /^\d+$/.test(days) && Number(days) >= 1 && Number(days) <= 30;
  const dirty = status && (enabled !== status.enabled || Number(days) !== status.retentionDays);
  const busy = phase !== 'idle';
  const locked = !available || !status || busy;

  async function request(kind, resetDraft = false) {
    if (!available) return;
    const current = ++epoch.current;
    setPhase(kind === 'save' ? 'saving' : 'loading');
    setError(''); setNotice('');
    try {
      const result = checkedStatus(await (kind === 'save'
        ? api.speechCacheSave({ enabled, retentionDays: Number(days) })
        : api.speechCacheStatus()));
      if (current !== epoch.current) return;
      setStatus(result);
      const confirmed = result.enabled === enabled && result.retentionDays === Number(days);
      if (resetDraft || (kind === 'save' && confirmed)) {
        setEnabled(result.enabled); setDays(String(result.retentionDays));
      }
      if (result.error) setError(`${kind === 'save' ? '保存后缓存不可用' : '缓存不可用'}：${messageOf(result.error)}`);
      else if (kind === 'save' && !confirmed) setError('保存未确认：桌面端返回的配置与本次更改不一致，请刷新后重试。');
      else setNotice(kind === 'save' ? '音频缓存设置已保存。' : '已刷新本机缓存状态。');
    } catch (reason) {
      if (current === epoch.current) setError(`${kind === 'save' ? '保存失败' : '读取状态失败'}：${messageOf(reason)}`);
    } finally {
      if (current === epoch.current) setPhase('idle');
    }
  }

  useEffect(() => {
    setStatus(null); setEnabled(false); setDays('7'); setError(''); setNotice('');
    if (available) void request('load', true);
    else setPhase('idle');
    // Invalidate every pending response on unmount or desktop API replacement.
    return () => { epoch.current++; };
  }, [api, available]);

  return <section className="settings-card speech-cache-settings" aria-busy={busy}>
    <h3>合成音频本机缓存（可选）</h3>
    <p className="hint" id={privacyId}>默认关闭以保护对话隐私。开启后，合成语音会作为可播放的音频文件保存在本机安装位置，不是加密保险箱；能访问该目录的人可能听到对话内容。</p>
    {!available && <p className="notice" role="status">需要桌面版及真实 IPC 支持；浏览器预览不能读取或保存磁盘缓存设置。</p>}
    <label className="row">
      <div><strong>允许在本机保存合成音频</strong><small>关闭后停止读取和写入缓存，但不会自动删除已有文件。</small></div>
      <input type="checkbox" role="switch" aria-describedby={privacyId} checked={enabled} disabled={locked}
        onChange={event => { setEnabled(event.target.checked); setNotice(''); }} />
    </label>
    <label className="field">保留天数（1–30 天）
      <input type="number" min="1" max="30" step="1" value={days} disabled={locked} aria-invalid={!daysValid}
        onChange={event => { setDays(event.target.value); setNotice(''); }} />
      <small>默认 7 天；从文件写入时间计算，重复播放不会延长保留期。</small>
    </label>
    {!daysValid && <p className="notice" role="alert">请输入 1 到 30 之间的整数天数。</p>}
    <div className="voice-status">
      <span>当前安装的专用缓存目录（实际路径由桌面主进程确定，不能在此输入路径）</span>
      <span><code>{status?.root || (available ? '尚未读取到桌面端目录' : '需桌面版读取')}</code></span>
      {status && <span>已确认配置：{status.enabled ? '开启' : '关闭'} · {status.retentionDays} 天；模块缓存文件：{status.files} 个，占用 {formatBytes(status.bytes)}。</span>}
    </div>
    <p className="hint">自动清理仅在缓存开启、应用运行并触发启用、写入、状态刷新或清理检查时进行；只删除本模块命名且已过期的文件，不处理其他文件。关闭缓存或退出应用后不会按时清理；重新开启时才会继续检查。</p>
    <div className="button-row">
      <button type="button" className="primary" disabled={locked || !daysValid || !dirty}
        onClick={() => void request('save')}>{phase === 'saving' ? '正在保存…' : '保存缓存设置'}</button>
      <button type="button" className="secondary" disabled={!available || busy}
        onClick={() => void request('load', !status)}>刷新状态</button>
    </div>
    {dirty && <p className="hint">更改尚未保存；刷新状态不会覆盖当前编辑。</p>}
    {phase === 'loading' && <p role="status">正在读取本机缓存状态…</p>}
    {error && <p className="notice" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
