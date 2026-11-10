import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright-core';

// Uses isolated app data and two hidden windows. Build the editor before running.
const root = fileURLToPath(new URL('../../', import.meta.url));
const studio = fileURLToPath(new URL('../', import.meta.url));
const output = join(studio, 'artifacts', 'theme-qa');
await mkdir(output, { recursive: true });
const testRoot = await mkdtemp(join(output, 'host-'));
for (const dir of ['electron', 'motion-studio/scripts', 'dist']) await mkdir(join(testRoot, dir), { recursive: true });
await cp(join(root, 'electron/motion-editor.cjs'), join(testRoot, 'electron/motion-editor.cjs'));
await cp(join(root, 'electron/preload.cjs'), join(testRoot, 'electron/preload.cjs'));
await cp(join(studio, 'scripts/desktop-preload.cjs'), join(testRoot, 'motion-studio/scripts/desktop-preload.cjs'));
await cp(resolve(process.env.MOTION_THEME_DIST || join(studio, 'dist')), join(testRoot, 'dist/motion-editor'), { recursive: true });
const host = `
const electron = require('electron');
const { app, BrowserWindow, ipcMain, net, protocol, screen, session } = electron;
const path = require('node:path');
class HiddenWindow extends BrowserWindow { show() {} }
const motion = require('./electron/motion-editor.cjs').createMotionEditor({ BrowserWindow: HiddenWindow, ipcMain, net, protocol, screen, session, development: false });
let main;
ipcMain.handle('motion-editor-theme', (event, value) => {
  if (!main || event.sender !== main.webContents || event.senderFrame !== main.webContents.mainFrame) throw Error('bad sender');
  return motion.updateTheme(value);
});
app.whenReady().then(async () => {
  main = new HiddenWindow({ show: false, webPreferences: { preload: path.join(__dirname, 'electron/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  globalThis.themeHost = { main, motion };
  await main.loadFile(path.join(__dirname, 'host.html'));
});`;
await writeFile(join(testRoot, 'app.cjs'), host);
const defaults = {
  '--accent': '#477fd1', '--accent-text': '#3266ad', '--on-accent': '#ffffff', '--bg': '#f1f6fc',
  '--surface': '#fdfeff', '--surface-soft': '#f9fbfe', '--text': '#202c3c', '--secondary': '#4e6076',
  '--tertiary': '#52647a', '--line': '#19334d1c', '--hover': '#1c416509', '--shadow': '#3454750c',
  '--danger': '#a33227', '--danger-bg': '#fff0ed', '--scheme': 'light',
};
const themeCss = await readFile(join(studio, 'src/theme-transition.css'), 'utf8');
await writeFile(join(testRoot, 'host.html'), `<html><head><style>${themeCss}</style></head><body><main class="app" style="${Object.entries(defaults).map(([key, value]) => `${key}:${value}`).join(';')}"></main></body></html>`);
const executablePath = (await import('electron')).default;
const app = await _electron.launch({ executablePath, args: [join(testRoot, 'app.cjs'), `--user-data-dir=${join(testRoot, 'profile')}`,
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const main = await app.firstWindow();
  await main.waitForSelector('.app', { state: 'attached' });
  await app.evaluate(async () => { await globalThis.themeHost.motion.open(); });
  const editor = (await app.windows()).find((page) => page !== main);
  assert.ok(editor);
  await editor.waitForFunction(() => document.documentElement.style.getPropertyValue('--accent') === '#477fd1');
  assert.equal(await editor.getByRole('button', { name: '切换主题' }).isDisabled(), true);
  await Promise.all([
    app.waitForEvent('window'),
    editor.getByRole('link', { name: '独立播放器' }).click(),
  ]);
  const player = (await app.windows()).find((page) => page !== main && page !== editor);
  assert.ok(player);
  await player.waitForFunction(() => document.documentElement.style.getPropertyValue('--accent') === '#477fd1');
  // Drive the real CSS transition to an exact midpoint, independent of hidden-window throttling.
  await main.evaluate(() => {
    const root = document.querySelector('.app');
    root.style.setProperty('transition-duration', '4s', 'important');
    getComputedStyle(root).getPropertyValue('--bg');
  });
  await Promise.all([editor, player].map((page) => page.evaluate(() => {
    document.documentElement.style.setProperty('transition-duration', '4s', 'important');
    getComputedStyle(document.documentElement).getPropertyValue('--bg');
  })));
  await main.evaluate(() => {
    const root = document.querySelector('.app');
    root.style.setProperty('--accent', '#8a75af');
    root.style.setProperty('--accent-text', '#d1b5ef');
    root.style.setProperty('--bg', '#111b2c');
    root.style.setProperty('--scheme', 'dark');
  });
  await editor.waitForFunction(() => {
    const root = document.documentElement;
    return root.style.getPropertyValue('--accent') === '#8a75af' && root.dataset.theme === 'dark';
  });
  await player.waitForFunction(() => document.documentElement.style.getPropertyValue('--accent') === '#8a75af'
    && document.documentElement.dataset.theme === 'dark');
  const midpoint = async (page, selector) => page.evaluate((selector) => {
    const root = document.querySelector(selector);
    getComputedStyle(root).getPropertyValue('--bg');
    const transition = root.getAnimations().find((item) => item.transitionProperty === '--bg');
    if (!transition) throw new Error(`Missing background transition on ${selector}`);
    transition.pause(); transition.currentTime = 2000;
    return getComputedStyle(root).getPropertyValue('--bg').trim();
  }, selector);
  const mid = await Promise.all([midpoint(main, '.app'), midpoint(editor, 'html'), midpoint(player, 'html')]);
  for (const value of mid) {
    assert.notEqual(value, 'rgb(241, 246, 252)', 'Transition moves away from light');
    assert.notEqual(value, 'rgb(17, 27, 44)', 'Transition has a visible midpoint');
  }
  await main.evaluate(() => document.querySelector('.app').classList.add('reduce'));
  await Promise.all([editor, player].map((page) => page.waitForFunction(() => document.documentElement.dataset.reducedMotion === 'true')));
  const state = await editor.evaluate(() => ({ accent: document.documentElement.style.getPropertyValue('--accent'),
    background: document.documentElement.style.getPropertyValue('--bg'), reduce: document.documentElement.dataset.reducedMotion }));
  assert.deepEqual(state, { accent: '#8a75af', background: '#111b2c', reduce: 'true' });
  assert.ok(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every((window) => !window.isVisible())));
  await writeFile(join(output, 'report.json'), JSON.stringify({ initial: true, live: state, player: true, hidden: true }, null, 2));
  console.log('Initial and live theme propagation passed through actual isolated preloads and hidden Electron windows.');
} finally { await app.close(); }
