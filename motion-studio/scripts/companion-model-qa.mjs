import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright-core';

// Exercise the actual embedded editor, IPC isolation and local-file path in hidden Electron windows.
const root = fileURLToPath(new URL('../../', import.meta.url));
const output = join(root, 'motion-studio/artifacts/companion-model-qa');
await mkdir(output, { recursive: true });
const testRoot = await mkdtemp(join(output, 'host-'));
for (const dir of ['electron', 'motion-studio/scripts', 'dist']) await mkdir(join(testRoot, dir), { recursive: true });
await cp(join(root, 'electron/motion-editor.cjs'), join(testRoot, 'electron/motion-editor.cjs'));
await cp(join(root, 'motion-studio/scripts/desktop-preload.cjs'), join(testRoot, 'motion-studio/scripts/desktop-preload.cjs'));
await cp(join(root, 'dist/motion-editor'), join(testRoot, 'dist/motion-editor'), { recursive: true });
const paths = ['Yukino04_UVPartsClean_PORTABLE.glb', 'Yukino07_UVDomainRepair.glb'].map((name) => join(root, 'public/characters', name));
const sha = await Promise.all(paths.map(async (path) => createHash('sha256').update(await readFile(path)).digest('hex')));
const host = `
const { app, BrowserWindow, ipcMain, net, protocol, screen, session } = require('electron');
const { readFile } = require('node:fs/promises');
class HiddenWindow extends BrowserWindow { show() {} }
const paths = ${JSON.stringify(paths)}, hashes = ${JSON.stringify(sha)};
const motion = require('./electron/motion-editor.cjs').createMotionEditor({ BrowserWindow: HiddenWindow, ipcMain, net, protocol, screen, session, development: false,
  getCompanionModel: async id => {
    const index = id === 'yukino-04-v1' ? 0 : id === 'custom-demo' ? 1 : -1;
    if (index < 0) throw Error('模型不可用');
    return { id, label: index ? '自定义示例' : '蓝色花纹和服', sha256: hashes[index], data: new Uint8Array(await readFile(paths[index])) };
  } });
app.whenReady().then(async () => {
  globalThis.qa = motion;
  const main = new HiddenWindow({ show: false });
  await main.loadURL('data:text/html,host');
});`;
await writeFile(join(testRoot, 'app.cjs'), host);
const executablePath = (await import('electron')).default;
const app = await _electron.launch({ executablePath, args: [join(testRoot, 'app.cjs'), `--user-data-dir=${join(testRoot, 'profile')}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  await app.firstWindow();
  await app.evaluate(() => globalThis.qa.open('yukino-04-v1'));
  const editor = (await app.windows()).find((window) => window.url().startsWith('yukino-motion:'));
  assert.ok(editor);
  await editor.getByText(/已载入 Companion 当前模型 · 蓝色花纹和服/).waitFor({ timeout: 60000 });
  assert.equal(await editor.evaluate(async () => { try { await window.studioWindow.readCompanionModel(-1); return false; } catch { return true; } }), true);
  await app.evaluate(() => globalThis.qa.open('custom-demo'));
  await editor.getByText(/已载入 Companion 当前模型 · 自定义示例/).waitFor({ timeout: 60000 });
  assert.equal((await app.windows()).filter((window) => window.url().startsWith('yukino-motion:')).length, 1);
  await app.evaluate(() => globalThis.qa.open('missing'));
  await editor.getByText(/无法载入 Companion 当前模型/).waitFor({ timeout: 60000 });
  assert.ok(await editor.getByText(/自定义示例/).count(), 'failed load keeps previous model');
  assert.ok(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every((window) => !window.isVisible())));
  console.log('Companion built-in and custom model loading, reopening, rejection and hidden windows passed.');
} finally { await app.close(); }
