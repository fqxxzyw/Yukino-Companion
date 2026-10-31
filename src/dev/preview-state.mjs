// UI-only development persistence. Never stores API keys or simulates IPC.
const prefix = 'yukino-ui-preview-v1:';
export function readPreviewState(defaults) {
  if (!import.meta.env.DEV || window.desktop) return defaults;
  try {
    const saved = JSON.parse(localStorage.getItem(prefix + 'state'));
    if (!saved || !Array.isArray(saved.profiles) || !saved.profiles.length || !Array.isArray(saved.conversations)) return defaults;
    return {...defaults, ...saved};
  } catch { return defaults; }
}
export function savePreviewState(state) {
  if (!import.meta.env.DEV || window.desktop) return;
  try { localStorage.setItem(prefix + 'state', JSON.stringify(state)); }
  catch { console.warn('浏览器预览存储不可用，刷新后外观设置可能丢失。'); }
}
export function readDevelopmentDraft() {
  if (!import.meta.env.DEV) return '';
  // A new Electron process has a new sessionStorage. Its isolated Chromium
  // localStorage survives controlled main/preload restarts without using IPC.
  try { return (window.desktop ? localStorage : sessionStorage).getItem(prefix + 'draft') || ''; } catch { return ''; }
}
export function saveDevelopmentDraft(draft) {
  if (!import.meta.env.DEV) return;
  try { (window.desktop ? localStorage : sessionStorage).setItem(prefix + 'draft', draft); } catch {}
}
