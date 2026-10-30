'use strict';
// Standalone supported-desktop Electron QA. Never starts Yukino, its preload,
// provider connections, microphone, personal profile or third-party network URLs.
// Run: node_modules/.bin/electron tests/video-playback-capture.cjs
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { fileURLToPath } = require('node:url');
const root = path.resolve(__dirname, '..');
const outputIndex = process.argv.indexOf('--output');
if (outputIndex >= 0 && !process.argv[outputIndex + 1]) throw Error('--output needs a directory');
const output = path.resolve(outputIndex < 0 ? path.join(root, 'build/video-playback-review') : process.argv[outputIndex + 1]);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'yukino-video-qa-'));
app.setPath('userData', temporary);
app.on('window-all-closed', () => {});
const report = { passed: false, purpose: 'Synthetic VP9-alpha playback only; no Yukino animation pack, app integration or Windows hardware certification implied', versions: { ...process.versions }, platform: process.platform, blockedRequests: [], errors: [] };
let window, watchdog;
function save() { fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); }
function allowed(url) {
  try {
    const parsed = new URL(url); if (parsed.protocol !== 'file:') return false;
    const relative = path.relative(fs.realpathSync(root), fs.realpathSync(fileURLToPath(parsed)));
    return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
  } catch { return false; }
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function run() {
  await app.whenReady();
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => { const permit = allowed(details.url); if (!permit) report.blockedRequests.push(details.url); callback({ cancel: !permit }); });
  window = new BrowserWindow({ width: 900, height: 800, show: true, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  await window.loadFile(path.join(root, 'tests/video-playback-browser.html'));
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    const result = await window.webContents.executeJavaScript('window.videoQA ?? null');
    if (result?.done) { report.renderer = result; break; }
    await wait(100);
  }
  if (!report.renderer?.done) throw Error('Video renderer did not finish within 25 seconds');
  if (!report.renderer.passed) throw Error('Video renderer checks failed');
  const image = await window.webContents.capturePage(); if (image.isEmpty()) throw Error('Screenshot empty');
  fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, 'synthetic-video.png'), image.toPNG());
  await window.webContents.executeJavaScript('window.disposeVideoQA()');
  report.passed = report.blockedRequests.length === 0;
}
watchdog = setTimeout(() => { report.errors.push('Outer 40-second watchdog'); try { save(); } finally { app.exit(1); } }, 40000);
run().catch(error => report.errors.push(error.stack ?? String(error))).finally(async () => {
  window?.destroy(); clearTimeout(watchdog); if (report.errors.length) report.passed = false;
  report.finishedAt = new Date().toISOString(); save();
  // Chromium may still hold its disposable cache; do not turn a passing playback
  // check into a retry loop or remove any existing user profile.
  try { await fs.promises.rm(temporary, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 }); } catch (error) { report.cleanupWarning = error.code; save(); }
  console.log(JSON.stringify({ passed: report.passed, output, errors: report.errors })); app.exit(report.passed ? 0 : 1);
});
