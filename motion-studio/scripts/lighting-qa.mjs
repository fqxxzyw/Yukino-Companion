import assert from 'node:assert/strict';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { selectOption } from './select-qa.mjs';

const executablePaths = [process.env.MOTION_CHROMIUM, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].filter(Boolean);
const found = await Promise.all(executablePaths.map((path) => access(path).then(() => path, () => undefined)));
assert.ok(found.find(Boolean), 'Set MOTION_CHROMIUM to an installed browser.');
const output = fileURLToPath(new URL('../artifacts/lighting-qa/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: found.find(Boolean), headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${process.argv[2] ?? 'http://127.0.0.1:5220'}/?qa=1`);
  await page.waitForFunction(() => window.motionSnapshot?.()?.rendered && window.motionSnapshot().triangles > 10000);
  await page.waitForTimeout(500);
  const canvas = page.locator('canvas[aria-label="角色三维视窗"]');
  const control = page.getByRole('combobox', { name: '预览灯光' });
  const before = await page.evaluate(() => window.motionSnapshot());
  const initial = await canvas.screenshot();
  await page.getByRole('button', { name: '开始录制' }).click();
  const frames = {};
  const labels = { indoorWarm: '暖光室内', indoorCool: '冷光室内', daylight: '户外晴天', overcast: '户外阴天', sunset: '户外夕阳' };
  for (const preset of Object.keys(labels)) {
    await selectOption(control, preset);
    assert.match(await control.textContent(), new RegExp(labels[preset]), `${preset} is selected`);
    await page.waitForTimeout(100);
    const frame = await canvas.screenshot();
    assert.notDeepEqual(frame, initial, `${preset} changes actual rendered pixels`);
    if (preset === 'daylight' || preset === 'sunset') await writeFile(join(output, `${preset}.png`), frame);
    frames[preset] = frame.length;
  }
  const after = await page.evaluate(() => window.motionSnapshot());
  assert.deepEqual(after.pose, before.pose);
  assert.deepEqual(after.camera, before.camera);
  assert.equal(await page.locator('.stage-time').textContent(), '00:00:00');
  await page.getByRole('button', { name: '停止录制' }).click();
  assert.equal(await page.locator('.clip-label').count(), 0);
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'report.json'), JSON.stringify({ frames, unchangedPose: true, unchangedCamera: true,
    excludedFromRecording: true }, null, 2));
  console.log('Five lighting presets change rendered pixels without changing pose, camera, or recording.');
} finally {
  await browser.close();
}
