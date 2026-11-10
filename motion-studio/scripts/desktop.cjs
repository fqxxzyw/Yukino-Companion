const { app, BrowserWindow, dialog, ipcMain, net, protocol, screen } = require('electron');
const { existsSync } = require('node:fs');
const path = require('node:path');

const scheme = 'yukino-studio';
const entry = `${scheme}://local/`;
const hiddenQA = process.env.MOTION_EDITOR_QA_HIDDEN === '1';
const previousProfile = path.join(app.getPath('appData'), 'Yukino Motion Studio');
if (!app.commandLine.hasSwitch('user-data-dir') && existsSync(previousProfile)) app.setPath('userData', previousProfile);
protocol.registerSchemesAsPrivileged([{
  scheme, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}]);

function isStudioPage(url) {
  const parsed = URL.parse(url);
  return parsed?.protocol === `${scheme}:` && parsed.host === 'local'
    && ['/', '/index.html', '/player.html'].includes(parsed.pathname);
}

function findModels() {
  if (process.env.YUKINO_MOTION_MODELS) return;
  let parent = path.dirname(process.execPath);
  for (let index = 0; index < 8; index += 1) {
    const directory = path.join(parent, 'public', 'characters');
    if (existsSync(path.join(directory, 'Yukino04_UVPartsClean_PORTABLE.glb'))) {
      process.env.YUKINO_MOTION_MODELS = directory;
      return;
    }
    const next = path.dirname(parent);
    if (parent === next) return;
    parent = next;
  }
}

function windowOptions() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  return {
    width: Math.min(1460, width), height: Math.min(930, height),
    minWidth: Math.min(720, width), minHeight: Math.min(560, height),
    frame: false, backgroundColor: '#f1f6fc', autoHideMenuBar: true, show: false,
    icon: path.join(__dirname, '../dist/assets/companion-icon.png'),
    webPreferences: {
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      backgroundThrottling: !hiddenQA,
      preload: path.join(__dirname, 'desktop-preload.cjs'),
    },
  };
}

function configureWindow(window) {
  const contents = window.webContents;
  if (!hiddenQA) window.once('ready-to-show', () => window.show());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => {
    if (!isStudioPage(url)) event.preventDefault();
  });
}

let playerWindow;
async function openPlayer() {
  if (playerWindow) {
    if (playerWindow.isMinimized()) playerWindow.restore();
    playerWindow.focus();
    return;
  }
  const window = playerWindow = new BrowserWindow({ ...windowOptions(), title: '动作包播放器' });
  window.on('closed', () => { playerWindow = undefined; });
  configureWindow(window);
  try {
    await window.loadURL(`${entry}player.html`);
  } catch (error) {
    if (!window.isDestroyed()) window.destroy();
    dialog.showErrorBox('无法打开播放器', error.message);
  }
}

ipcMain.handle('studio:window-action', (event, action) => {
  if (event.senderFrame !== event.sender.mainFrame || !isStudioPage(event.senderFrame?.url ?? '')) return;
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;
  if (action === 'minimize') window.minimize();
  if (action === 'maximize') {
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  }
  if (action === 'close') window.close();
  if (action === 'openPlayer') return openPlayer();
});

let server;
app.whenReady().then(async () => {
  findModels();
  const { startServer } = await import('./serve.mjs');
  server = await startServer(0);
  const origin = `http://127.0.0.1:${server.address().port}`;
  // The renderer keeps one origin across restarts while the backing port can vary.
  protocol.handle(scheme, (request) => {
    const url = new URL(request.url);
    if (url.host !== 'local') return new Response(null, { status: 404 });
    return net.fetch(`${origin}${url.pathname}${url.search}`, { method: request.method });
  });
  const studio = new BrowserWindow({ ...windowOptions(), title: '动作编辑器' });
  configureWindow(studio);
  await studio.loadURL(entry);
}).catch((error) => {
  dialog.showErrorBox('动作编辑器', error.message);
  app.exit(1);
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => server?.close());
