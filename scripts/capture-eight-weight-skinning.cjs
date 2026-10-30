'use strict';
// Actual Electron/WebGL readbacks and window-only screenshots. This never opens
// the application, a user profile, a provider, desktop capture, or a network URL.
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {fileURLToPath} = require('node:url');
const {withTimeout, finalizeCapture} = require('./qa-lifecycle.cjs');
const root = path.resolve(__dirname, '..');
const REQUIRED_CASES = Object.freeze(['standard', 'toon', 'outline-backside', 'unlit-alpha-mask',
  'normal', 'tangent-normal-map', 'depth', 'directional-shadow', 'point-shadow']);

function isAllowedLocalRequest(url, allowedRoot = root) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'data:' || parsed.protocol === 'blob:' || url === 'about:blank') return true;
    if (parsed.protocol !== 'file:') return false;
    const relative = path.relative(fsSync.realpathSync(allowedRoot), fsSync.realpathSync(fileURLToPath(parsed)));
    return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
  } catch { return false; }
}
function validateFixtureResult(result) {
  const fail = message => { throw Error('Eight-weight GPU evidence rejected: ' + message); };
  if (!result || result.done !== true || result.passed !== true) fail('fixture did not finish successfully');
  if (typeof result.renderer !== 'string' || !result.renderer.trim()) fail('no actual WebGL renderer identification');
  if (!Array.isArray(result.errors) || result.errors.length) fail('fixture reported shader/render errors');
  if (!Array.isArray(result.checks) || result.checks.length !== REQUIRED_CASES.length ||
      new Set(result.checks.map(check => check.name)).size !== REQUIRED_CASES.length) fail('missing or duplicate render cases');
  for (const name of REQUIRED_CASES) {
    const check = result.checks.find(item => item.name === name);
    if (!check || check.passed !== true || !Number.isFinite(check.meanAbsolute) || check.meanAbsolute < 0 || check.meanAbsolute >= .2 ||
        !Number.isInteger(check.pixelsOver3) || check.pixelsOver3 < 0 || check.pixelsOver3 >= 64 ||
        !Number.isInteger(check.referenceForegroundPixels) || check.referenceForegroundPixels <= 500 ||
        !Number.isFinite(check.max) || check.max < 0 || check.max > 255) fail(name + ' did not meet GPU/CPU pixel comparison thresholds');
  }
  if (result.negativeControl?.passed !== true || !Number.isInteger(result.negativeControl.pixelsOver3) ||
      result.negativeControl.pixelsOver3 <= 500) fail('four-weight negative control did not expose truncation');
  if (!Array.isArray(result.shadowNegativeControls) || result.shadowNegativeControls.length !== 2) fail('missing shadow negative controls');
  for (const name of ['directional-shadow', 'point-shadow']) {
    const control = result.shadowNegativeControls.find(item => item.name === name);
    if (control?.passed !== true || !Number.isInteger(control.pixelsOver3) || control.pixelsOver3 <= 25) fail(name + ' shader was not observably exercised');
  }
  return true;
}

function captureExitCode(code, report) {
  // Errors can arrive while finalizeCapture awaits cleanup; its initial failure
  // snapshot must not override the final persisted report.
  return code || !report.passed || report.errors.length ? 1 : 0;
}

async function runCapture(argv = process.argv, electron = require('electron')) {
  const {app, BrowserWindow, session} = electron;
  const index = argv.indexOf('--output');
  if (index >= 0 && (!argv[index + 1] || argv[index + 1].startsWith('--'))) throw Error('--output requires a directory');
  const output = path.resolve(index >= 0 ? argv[index + 1] : path.join(root, 'build/eight-weight-skinning-review'));
  const report = {passed: false, webglReadbacksVerified: false, execution: 'not_started',
    purpose: 'Synthetic eight-weight actual Electron/WebGL comparison, not model01 visual acceptance or hardware certification',
    platform: process.platform, versions: {electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node},
    startedAt: new Date().toISOString(), screenshots: [], errors: [], blockedRequests: [], deniedPermissions: []};
  // Synchronous setup intentionally occurs before app.ready. No existing user
  // profile, cookies, login session, or application's IPC/preload is accessed.
  const temp = fsSync.mkdtempSync(path.join(os.tmpdir(), 'yukino-skin8-qa-'));
  fsSync.mkdirSync(path.join(temp, 'session'));
  app.setPath('userData', temp);
  app.setPath('sessionData', path.join(temp, 'session'));
  // Electron otherwise quits when destroy() closes the last window, racing the
  // awaited report write. finalizeCapture exclusively owns the final exit code.
  app.on('window-all-closed', () => {});
  app.commandLine.appendSwitch('force-device-scale-factor', '1');
  app.commandLine.appendSwitch('disable-background-networking');
  let win, partition, finishing;
  const failure = error => {
    report.passed = false;
    report.failure = error?.message || String(error);
    if (!report.errors.includes(report.failure)) report.errors.push(report.failure);
  };
  async function finish() {
    if (finishing) return finishing;
    clearTimeout(watchdog);
    finishing = finalizeCapture({report, failed: !report.passed,
      dispose: () => { if (win && !win.isDestroyed()) win.destroy(); },
      cleanup: async () => {
        if (partition) await withTimeout(Promise.all([partition.clearCache(), partition.clearStorageData()]), 'Isolated session cleanup', 4000);
        await fs.rm(temp, {recursive: true, force: true, maxRetries: 3, retryDelay: 100});
      },
      save: async () => {
        report.finishedAt = new Date().toISOString();
        report.passed = report.passed && report.errors.length === 0;
        await fs.mkdir(output, {recursive: true});
        await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
      },
      exit: code => {
        process.removeListener('uncaughtException', handleFailure);
        process.removeListener('unhandledRejection', handleFailure);
        app.exit(captureExitCode(code, report));
      }, timeout: 10000,
    });
    return finishing;
  }
  const watchdog = setTimeout(() => { failure(Error('Eight-weight capture watchdog expired after 180 seconds')); void finish(); }, 180000);
  function handleFailure(error) { failure(error); void finish(); }
  process.on('uncaughtException', handleFailure);
  process.on('unhandledRejection', handleFailure);
  async function evaluate(source, label = 'Renderer evaluation') {
    if (finishing) throw Error('Eight-weight capture is shutting down');
    return withTimeout(win.webContents.executeJavaScript(source), label, 10000);
  }
  async function screenshot(file, rect) {
    const image = await withTimeout(win.webContents.capturePage(rect), 'Window screenshot', 10000);
    const size = image.getSize(), bytes = image.toPNG();
    if (image.isEmpty() || bytes.length < 500 || size.width < 400 || size.height < 200) throw Error('Empty or clipped capture: ' + file);
    await fs.writeFile(path.join(output, file), bytes);
    report.screenshots.push({file, bytes: bytes.length, width: size.width, height: size.height,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex')});
  }
  try {
    await fs.mkdir(output, {recursive: true});
    await withTimeout(app.whenReady(), 'Electron startup', 30000);
    partition = session.fromPartition('skin8-qa-' + crypto.randomUUID(), {cache: false});
    partition.setPermissionCheckHandler(() => false);
    partition.setPermissionRequestHandler((_contents, permission, callback) => { report.deniedPermissions.push(permission); callback(false); });
    partition.setDevicePermissionHandler(() => false);
    partition.setDisplayMediaRequestHandler((_request, callback) => { report.deniedPermissions.push('display-capture'); callback(null); });
    partition.on('will-download', event => { event.preventDefault(); report.errors.push('Unexpected download was blocked'); });
    partition.webRequest.onBeforeRequest({urls: ['<all_urls>']}, (details, callback) => {
      const allowed = isAllowedLocalRequest(details.url);
      if (!allowed) report.blockedRequests.push(details.url);
      callback({cancel: !allowed});
    });
    win = new BrowserWindow({width: 840, height: 720, useContentSize: true, show: true,
      backgroundColor: '#eaf0f9', webPreferences: {session: partition, contextIsolation: true,
        sandbox: true, nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false,
        backgroundThrottling: false, webviewTag: false}});
    win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.on('will-frame-navigate', event => event.preventDefault());
    win.webContents.on('will-attach-webview', event => event.preventDefault());
    win.webContents.on('console-message', details => { if (details.level === 'error') report.errors.push(details.message); });
    win.webContents.on('render-process-gone', (_event, details) => { if (!finishing && !win.isDestroyed()) { failure(Error('Renderer exited: ' + details.reason)); void finish(); } });
    report.execution = 'browser_started';
    await withTimeout(win.loadFile(path.join(root, 'tests/eight-weight-skinning-webgl.html')), 'Local fixture load', 30000);
    const deadline = Date.now() + 90000;
    let result;
    while (Date.now() < deadline) {
      result = await evaluate('window.eightWeightResult?.done ? window.eightWeightResult : null');
      if (result) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!result) throw Error('Eight-weight fixture did not finish within 90 seconds');
    report.execution = 'fixture_completed';
    report.fixture = result;
    // Capture failure evidence too; a fixture pass is not inferred from PNG size.
    await evaluate('(async () => { window.scrollTo(0, 0); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); })()');
    await screenshot('overview.png');
    const rows = await evaluate('document.querySelectorAll("#gallery section").length');
    for (let i = 0; i < Math.min(rows, REQUIRED_CASES.length); i++) {
      const rect = await evaluate(`(async () => {
        const row = document.querySelectorAll('#gallery section')[${i}];
        row.scrollIntoView({block: 'center'});
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const box = row.getBoundingClientRect();
        return {x: Math.max(0, Math.floor(box.left)), y: Math.max(0, Math.floor(box.top)),
          width: Math.min(Math.ceil(box.width), innerWidth - Math.max(0, Math.floor(box.left))),
          height: Math.min(Math.ceil(box.height), innerHeight - Math.max(0, Math.floor(box.top)))};
      })()`, 'Position screenshot row');
      await screenshot(String(i + 1).padStart(2, '0') + '-' + REQUIRED_CASES[i] + '.png', rect);
    }
    validateFixtureResult(result);
    if (rows !== REQUIRED_CASES.length) throw Error('Missing rendered comparison rows');
    if (report.blockedRequests.length || report.deniedPermissions.length) throw Error('Unexpected network/file/permission request');
    if (report.errors.length) throw Error('Renderer console errors: ' + report.errors.join('; '));
    report.webglReadbacksVerified = true;
    report.passed = true;
  } catch (error) { failure(error); }
  await finish();
}

module.exports = {REQUIRED_CASES, isAllowedLocalRequest, validateFixtureResult, captureExitCode, runCapture};
if (require.main === module) runCapture().catch(error => { console.error(error); require('electron').app.exit(1); });
