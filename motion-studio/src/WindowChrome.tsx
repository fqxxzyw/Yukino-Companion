import { useEffect, useLayoutEffect, useState } from 'react';
import { Minus, Moon, Square, Sun, X } from 'lucide-react';
import './theme-transition.css';

interface SharedTheme { colors: Record<string, string>; scheme: 'light' | 'dark'; reduce: boolean }
export interface CompanionModelRequest { id: string; revision: number }
export interface CompanionModel { id: string; label: string; sha256: string; data: Uint8Array }

declare global {
  interface Window {
    studioWindow?: {
      updateSupported?: () => Promise<boolean>;
      updateCheck?: () => Promise<{version:string; downloadable:boolean}|null>;
      updateDownload?: () => Promise<{saved?:boolean}>;
      updateOpen?: () => Promise<void>;
      minimize: () => Promise<void>;
      maximize: () => Promise<void>;
      close: () => Promise<void>;
      openPlayer: () => Promise<void>;
      getTheme?: () => Promise<SharedTheme | null>;
      onTheme?: (callback: (theme: SharedTheme) => void) => () => void;
      getCompanionModelRequest?: () => Promise<CompanionModelRequest | null>;
      readCompanionModel?: (revision: number) => Promise<CompanionModel>;
      onCompanionModel?: (callback: (request: CompanionModelRequest) => void) => () => void;
    };
  }
}

export function StudioBrand({ subtitle, home = false }: { subtitle: string; home?: boolean }) {
  const content = <>
    <img className="brand-icon" src="/assets/companion-icon.png" alt="" width="34" height="34" />
    <span><b>动作编辑器</b><small>{subtitle}</small></span>
  </>;
  return home ? <a className="brand" href="./">{content}</a> : <div className="brand">{content}</div>;
}

export function ThemeButton() {
  const [dark, setDark] = useState(() => localStorage.getItem('yukino-motion-theme') === 'dark');
  const [independent, setIndependent] = useState(() => localStorage.getItem('yukino-motion-theme-independent') === 'true');
  const [shared, setShared] = useState<SharedTheme | null>(null);
  const applied = independent ? null : shared;
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = applied?.scheme ?? (dark ? 'dark' : 'light');
    root.dataset.reducedMotion = shared?.reduce ? 'true' : 'false';
    const variables: Record<string, string> = applied ? {
      '--bg': applied.colors['--bg'], '--panel': applied.colors['--surface'], '--raised': applied.colors['--surface-soft'],
      '--field': applied.colors['--surface-soft'], '--border': applied.colors['--line'], '--text': applied.colors['--text'],
      '--muted': applied.colors['--secondary'], '--faint': applied.colors['--tertiary'], '--accent': applied.colors['--accent'],
      '--accent-ink': applied.colors['--accent-text'], '--accent-fill': applied.colors['--accent-text'],
      '--accent-text': applied.colors['--on-accent'], '--red': applied.colors['--danger'], '--danger-bg': applied.colors['--danger-bg'],
      '--shadow': applied.colors['--shadow'], '--selection': 'color-mix(in srgb, var(--accent) 10%, var(--panel))',
      '--stage-bg': 'color-mix(in srgb, var(--accent) 5%, var(--bg))',
    } : {};
    for (const [key, value] of Object.entries(variables)) root.style.setProperty(key, value);
    return () => { for (const key of Object.keys(variables)) root.style.removeProperty(key); };
  }, [dark, shared, applied]);
  useEffect(() => {
    function sync(event: StorageEvent) {
      if (event.key === 'yukino-motion-theme') setDark(event.newValue === 'dark');
      if (event.key === 'yukino-motion-theme-independent') setIndependent(event.newValue === 'true');
    }
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  useEffect(() => {
    const bridge = window.studioWindow;
    if (!bridge?.onTheme || !bridge.getTheme) return;
    let alive = true;
    let revision = 0;
    const unsubscribe = bridge.onTheme((value) => { revision++; if (alive) setShared(value); });
    void bridge.getTheme().then((value) => { if (alive && revision === 0 && value) setShared(value); });
    return () => { alive = false; unsubscribe(); };
  }, []);
  function toggle() {
    const next = !currentDark;
    localStorage.setItem('yukino-motion-theme', next ? 'dark' : 'light');
    localStorage.setItem('yukino-motion-theme-independent', 'true');
    setDark(next); setIndependent(true);
  }
  const currentDark = applied ? applied.scheme === 'dark' : dark;
  return <><button className="theme-button" title={currentDark ? '切换浅色主题' : '切换深色主题'} aria-label="切换主题" onClick={toggle}>
    {currentDark ? <Sun size={16} /> : <Moon size={16} />}
  </button>{shared && independent && <button className="theme-button" title="跟随 Companion 主题" aria-label="跟随 Companion 主题" onClick={() => {localStorage.removeItem('yukino-motion-theme-independent');setIndependent(false);}}>跟随</button>}</>;
}

export function WindowControls() {
  const chrome = window.studioWindow;
  if (!chrome) return null;
  return <div className="window-actions" role="group" aria-label="窗口控制">
    <button title="最小化" aria-label="最小化" onClick={() => void chrome.minimize()}><Minus size={15} /></button>
    <button title="最大化或还原" aria-label="最大化或还原" onClick={() => void chrome.maximize()}><Square size={12} /></button>
    <button title="关闭窗口" aria-label="关闭窗口" onClick={() => void chrome.close()}><X size={17} /></button>
  </div>;
}


export function StudioUpdateNotice() {
  const bridge=window.studioWindow;
  const [release,setRelease]=useState<{version:string;downloadable:boolean}|null>(null);
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[supported,setSupported]=useState(false);
  useEffect(()=>{let active=true;bridge?.updateSupported?.().then(value=>{if(active)setSupported(value)});return()=>{active=false}},[bridge]);
  useEffect(()=>{if(!supported||!bridge?.updateCheck)return;let active=true;const check=()=>bridge.updateCheck!().then(value=>{if(active)setRelease(value)}).catch(()=>{});const first=setTimeout(check,5000),timer=setInterval(check,6*60*60*1000);return()=>{active=false;clearTimeout(first);clearInterval(timer)}},[bridge,supported]);
  if(!supported||!bridge?.updateCheck)return null;
  async function check(){setBusy(true);setMessage('');try{const value=await bridge!.updateCheck!();setRelease(value);if(!value)setMessage('当前没有可用的正式版更新。')}catch(error){setMessage(String(error))}finally{setBusy(false)}}
  async function download(){setBusy(true);setMessage('正在下载并校验更新包…');try{const value=await bridge!.updateDownload!();setMessage(value.saved?'下载完成。关闭应用后运行安装包并选择原安装目录。':'')}catch(error){setMessage(String(error))}finally{setBusy(false)}}
  return <div className="studio-update"><button type="button" onClick={()=>setOpen(!open)} aria-expanded={open}>{release?`发现新版本 ${release.version}`:'应用更新'}</button>{open&&<div className="studio-update-popover" role="dialog" aria-label="应用更新"><strong>{release?`发现新版本 ${release.version}`:'应用更新'}</strong><p>选择原安装目录更新，个人数据和已下载资源会保留。</p>{release&&!release.downloadable&&<p>此版本暂无基础安装包，请前往 GitHub 查看。</p>}{message&&<p role="status">{message}</p>}<div>{release?.downloadable&&<button disabled={busy} onClick={download}>下载更新</button>}<button disabled={busy} onClick={check}>检查更新</button><button onClick={()=>bridge.updateOpen!().catch(error=>setMessage(String(error)))}>前往 GitHub</button><button onClick={()=>setOpen(false)}>关闭</button></div></div>}</div>;
}
