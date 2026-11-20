import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Download} from 'lucide-react';

function size(bytes) {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes || 0} B`;
}

function reason(error) {
  return String(error?.message || error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
}

function ReleaseNotes({text}) {
  if (!text?.trim()) return null;
  const lines = text.trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return <section className="app-update-notes" aria-label="更新内容" tabIndex={0}>
    <h4>更新内容</h4>
    <ul>{lines.map((line, index) => {
      const content = line.replace(/^[-*]\s+/, '');
      const category = /^([^：:]{1,18})[：:]\s*(.+)$/.exec(content);
      return <li key={index}>{category ? <><b>{category[1]}</b>　{category[2]}</> : content}</li>;
    })}</ul>
  </section>;
}

export default function UpdateNotice({api}) {
  const [release, setRelease] = useState(null);
  const [downloaded, setDownloaded] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState(null);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState('');
  const action = useRef('');
  const alive = useRef(true);
  const announcedVersion = useRef(null);

  const check = useCallback(async () => {
    if (action.current) return;
    action.current = 'check';
    setBusy('check');
    try {
      const value = await api.appUpdateCheck();
      if (!alive.current) return;
      setRelease(value);
      if (value?.version && announcedVersion.current !== value.version) {
        announcedVersion.current = value.version;
        setOpen(true);
      }
      setDownloaded(value?.ready || null);
      setFailed('');
      setMessage(value ? '' : '当前没有可用的正式版更新');
    } catch (error) {
      if (alive.current) {
        setFailed('check');
        setMessage('检查更新失败：' + reason(error));
      }
    } finally {
      action.current = '';
      if (alive.current) setBusy('');
    }
  }, [api]);

  useEffect(() => {
    if (!api?.appUpdateCheck) return;
    alive.current = true;
    const first = setTimeout(check, 5000);
    const timer = setInterval(check, 6 * 60 * 60 * 1000);
    const offProgress = api.onAppUpdateProgress?.(value => setProgress(value));
    const offOpen = api.onShowAppUpdates?.(() => setOpen(true));
    return () => {
      alive.current = false;
      clearTimeout(first);
      clearInterval(timer);
      offProgress?.();
      offOpen?.();
    };
  }, [api, check]);

  if (!api?.appUpdateCheck) return null;
  const portable = release?.portable === true;
  const ready = downloaded && !portable;
  const fullSize = release?.fullSize;
  const transfer = busy === 'download' ? progress : ready ? downloaded : null;
  const percent = transfer ? Math.max(0, Math.min(100, Math.round(transfer.percent ?? (transfer.ready ? 100 : 0)))) : 0;
  const heading = ready ? '更新已下载，重启完成更新' : release ? `发现新版本 ${release.version}` : '应用更新';

  async function download() {
    if (action.current) return;
    action.current = 'download';
    setBusy('download');
    setMessage('');
    setFailed('');
    setProgress(null);
    setDownloaded(null);
    try {
      const result = await api.appUpdateDownload();
      if (!alive.current) return;
      if (result?.cancelled) setMessage('已取消下载，可以重新下载。');
      else if (result?.saved) setMessage('完整安装包已保存。请关闭当前程序，再手动运行已保存的安装包。');
      else if (result?.ready && !portable) setDownloaded(result);
      else throw Error('未收到安装包校验结果，请重试。');
    } catch (error) {
      if (alive.current) { setFailed('download'); setMessage('下载失败：' + reason(error)); }
    } finally {
      action.current = '';
      if (alive.current) setBusy('');
    }
  }

  async function install() {
    if (action.current || !ready) return;
    action.current = 'install';
    setBusy('install');
    setFailed('');
    setMessage('');
    try {
      const result = await api.appUpdateInstall();
      if (!result?.installing) throw Error('安装程序未启动');
      setMessage('正在退出应用并启动安装程序…');
    } catch (error) {
      action.current = '';
      setBusy('');
      setFailed('install');
      setMessage('安装失败：' + reason(error));
    }
  }

  return <div className="app-update">
    <button className="app-update-trigger" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
      <Download size={14} aria-hidden="true"/><span>{ready ? '更新已下载' : busy === 'download' ? '下载中' : release ? release.version : '应用更新'}</span>
    </button>
    {open && <div className="app-update-popover" role="dialog" aria-label="应用更新" onKeyDown={event => {if (event.key === 'Escape') {event.stopPropagation(); setOpen(false);}}}>
      <strong>{heading}</strong>
      {release && <ReleaseNotes text={release.releaseNotes}/>}
      {release && <p>{portable ? '便携版将保存完整安装包，供稍后手动运行。' : ready ? release.version : '有可用缓存时只下载变化部分。'}{fullSize > 0 && <> · 总安装包 {size(fullSize)}</>}</p>}
      {release && !release.downloadable && <p>此发行版暂无基础安装包，请前往 GitHub 查看。</p>}
      {busy === 'download' && !transfer && <p role="status">{portable ? '准备下载完整安装包…' : '正在检查缓存与下载方式…'}</p>}
      {transfer?.fromCache && <p role="status">已校验本地缓存的安装包。</p>}
      {transfer && !transfer.fromCache && <section className="app-update-transfer" aria-label="下载进度">
        <b>{transfer.differential ? '变化部分' : '完整安装包'}</b>
        <span>{percent}%</span>
        <progress value={percent} max="100" aria-label="下载进度"/>
        <small>{size(transfer.bytes)} / {size(transfer.total)}</small>
        {transfer.fallbackReason && <small>{transfer.fallbackReason}</small>}
      </section>}
      {busy === 'install' && <p role="status">正在保存应用状态并启动安装程序…</p>}
      {message && <p role={failed ? 'alert' : 'status'}>{message}</p>}
      <div>
        {release?.downloadable && (!ready || failed === 'install') && <button className="update-primary" disabled={!!busy} onClick={download}>{failed === 'download' || failed === 'install' ? '重新下载' : portable ? '保存完整安装包' : '下载更新'}</button>}
        {ready && <button className="update-primary" disabled={!!busy} onClick={install}>重启并安装</button>}
        {busy === 'download' && <button onClick={() => api.appUpdateCancel().catch(error => setMessage(reason(error)))}>取消下载</button>}
        {!busy && !ready && <button onClick={check}>{failed === 'check' ? '重试检查' : '检查更新'}</button>}
        {busy === 'check' && <button disabled>检查中…</button>}
        <button onClick={() => api.appUpdateOpen().catch(error => setMessage(reason(error)))}>前往 GitHub</button>
        <button onClick={() => setOpen(false)}>{release ? '稍后' : '关闭'}</button>
      </div>
    </div>}
  </div>;
}
