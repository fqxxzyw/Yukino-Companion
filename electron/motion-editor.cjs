'use strict';
const { access } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const scheme = 'yukino-motion';
const origin = `${scheme}://local`;
const pages = { editor: '/index.html', player: '/player.html' };
const appRoot = path.join(__dirname, '..');
const editorRoot = path.join(appRoot, 'dist', 'motion-editor');
const themeKeys = ['--accent', '--accent-text', '--on-accent', '--bg', '--surface', '--surface-soft',
  '--text', '--secondary', '--tertiary', '--line', '--hover', '--shadow', '--danger', '--danger-bg'];

function sanitizeTheme(value) {
  if (!value || typeof value !== 'object' || !['light', 'dark'].includes(value.scheme) || typeof value.reduce !== 'boolean') return null;
  const colors = {};
  for (const key of themeKeys) {
    if (typeof value.colors?.[key] !== 'string' || !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value.colors[key])) return null;
    colors[key] = value.colors[key];
  }
  return { colors, scheme: value.scheme, reduce: value.reduce };
}

function motionEditorFile(url, characterRoot) {
  const parsed = URL.parse(url);
  if (!parsed || parsed.protocol !== `${scheme}:` || parsed.host !== 'local' || parsed.username || parsed.password) return null;
  const name = parsed.pathname;
  if (name === '/' || Object.values(pages).includes(name)) return path.join(editorRoot, name === '/' ? pages.editor : name);
  if (/^\/assets\/[a-zA-Z0-9_.-]+$/.test(name)) {
    const file = path.basename(name);
    if (file !== '.' && file !== '..') return path.join(editorRoot, 'assets', file);
  }
  const model = /^\/models\/(Yukino0[1-7]_[a-zA-Z0-9_]+\.glb)$/.exec(name);
  return model ? path.join(characterRoot, model[1]) : null;
}

function createMotionEditor({ BrowserWindow, ipcMain, net, protocol, screen, session, development, getCompanionModel }) {
  protocol?.registerSchemesAsPrivileged([{
    scheme, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  }]);
  const characterRoot = path.join(appRoot, development ? 'public' : 'dist', 'characters');
  const windows = new Map();
  let partition;
  let theme = null;
  let requestedModel = null;
  let modelRevision = 0;

  function trustedEditor(event) {
    const window = windows.get('editor');
    return !!window && !window.isDestroyed() && window.webContents === event.sender
      && event.senderFrame === event.sender.mainFrame && event.senderFrame?.url === origin + pages.editor;
  }

  function updateTheme(value) {
    const next = sanitizeTheme(value);
    if (!next) return false;
    theme = next;
    for (const window of windows.values()) if (!window.isDestroyed()) window.webContents.send('studio:theme', theme);
    return true;
  }

  function initialize() {
    if (partition) return partition;
    partition = session.fromPartition('persist:yukino-motion-editor');
    partition.setPermissionRequestHandler((_contents, _permission, reply) => reply(false));
    partition.setPermissionCheckHandler(() => false);
    partition.protocol.handle(scheme, async (request) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 });
      const file = motionEditorFile(request.url, characterRoot);
      if (!file) return new Response(null, { status: 404 });
      try {
        return await net.fetch(pathToFileURL(file).href, { method: request.method });
      } catch {
        return new Response(null, { status: 404 });
      }
    });
    ipcMain.handle('studio:window-action', (event, action) => {
      const kind = [...windows.keys()].find((kind) => windows.get(kind).webContents === event.sender);
      if (!kind || event.senderFrame !== event.sender.mainFrame || event.senderFrame?.url !== origin + pages[kind]) return;
      const window = windows.get(kind);
      if (action === 'minimize') window.minimize();
      if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize();
      if (action === 'close') window.close();
      if (action === 'openPlayer' && kind === 'editor') return open('player');
    });
    ipcMain.handle('studio:theme-get', (event) => {
      const kind = [...windows.keys()].find((item) => windows.get(item).webContents === event.sender);
      if (!kind || event.senderFrame !== event.sender.mainFrame || event.senderFrame?.url !== origin + pages[kind]) return null;
      return theme;
    });
    ipcMain.handle('studio:companion-model-request', (event) => trustedEditor(event) ? requestedModel : null);
    ipcMain.handle('studio:companion-model-read', async (event, revision) => {
      if (!trustedEditor(event) || !requestedModel || revision !== requestedModel.revision || !getCompanionModel) throw Error('模型请求已失效。');
      const request = requestedModel;
      const result = await getCompanionModel(request.id);
      if (!trustedEditor(event) || requestedModel !== request) throw Error('模型请求已失效。');
      return result;
    });
    return partition;
  }

  async function open(kind, modelId) {
    await access(path.join(editorRoot, pages[kind])).catch(() => {
      throw Error('动作编辑器资源尚未构建。开发时请执行 npm run build:motion-editor。');
    });
    if (kind === 'editor' && modelId !== undefined) {
      if (typeof modelId !== 'string' || !modelId || modelId.length > 100 || !getCompanionModel) throw Error('当前角色没有可用的人物模型。');
      requestedModel = { id: modelId, revision: ++modelRevision };
    }
    const existing = windows.get(kind);
    if (existing && !existing.isDestroyed()) {
      if (kind === 'editor' && requestedModel) existing.webContents.send('studio:companion-model', requestedModel);
      if (existing.isMinimized()) existing.restore();
      if (existing.isVisible()) existing.focus();
      return true;
    }
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    const window = new BrowserWindow({
      title: kind === 'editor' ? '动作编辑器' : '动作包播放器',
      width: Math.min(1460, width), height: Math.min(930, height),
      minWidth: Math.min(720, width), minHeight: Math.min(560, height),
      frame: false, autoHideMenuBar: true, show: false, backgroundColor: '#f1f6fc',
      icon: path.join(appRoot, development ? 'public' : 'dist', 'yukino-icon.png'),
      webPreferences: {
        session: initialize(), sandbox: true, contextIsolation: true, nodeIntegration: false,
        preload: path.join(appRoot, 'motion-studio', 'scripts', 'desktop-preload.cjs'),
      },
    });
    windows.set(kind, window);
    window.on('closed', () => { if (windows.get(kind) === window) windows.delete(kind); });
    window.once('ready-to-show', () => window.show());
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    try {
      await window.loadURL(origin + pages[kind]);
      return true;
    } catch (error) {
      if (!window.isDestroyed()) window.destroy();
      throw error;
    }
  }

  return { open: (modelId) => open('editor', modelId), updateTheme };
}

module.exports = { createMotionEditor, motionEditorFile, sanitizeTheme };
