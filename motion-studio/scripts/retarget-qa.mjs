import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { selectOption } from './select-qa.mjs';

const output = resolve('artifacts/retarget-qa');
const model = resolve('artifacts/kimono-handoff/Yukino_Kimono_Unified_Demo_v4_SkirtCorrection_REVIEW.glb');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.MOTION_CHROMIUM || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 940 }, acceptDownloads: true });
page.setDefaultTimeout(45000);
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const button = (name) => page.getByRole('button', { name, exact: true });
const snapshot = () => page.evaluate(() => window.motionSnapshot());
const direction = (scene, upper = 'leftUpperArm', lower = 'leftLowerArm') => {
  const a = scene.positions[upper], b = scene.positions[lower];
  assert.ok(a && b, `${upper} and ${lower} are available`);
  const delta = b.map((v, i) => v - a[i]);
  const length = Math.hypot(...delta);
  return delta.map((v) => v / length);
};
const distance = (a, b) => Math.hypot(...a.map((value, index) => value - b[index]));
async function rendered(id) {
  await page.waitForFunction((id) => {
    const state = window.motionSnapshot?.();
    return state?.modelId === id && state.rendered && state.triangles > 10000;
  }, id);
}
async function scrub(seconds) {
  const ruler = page.locator('.ruler');
  const width = await ruler.evaluate((element) => parseFloat(getComputedStyle(element).getPropertyValue('--second')));
  const box = await ruler.boundingBox();
  await page.mouse.click(box.x + width * seconds + 0.15, box.y + box.height / 2);
}
try {
  await page.goto(`${process.argv[2] ?? 'http://127.0.0.1:5260'}/?qa=1`);
  await rendered('yukino-04-v1');
  await button('左上臂').click();
  await button('开始录制').click();
  const slider = page.getByRole('slider', { name: '旋转 Z', exact: true });
  await slider.press('ArrowRight');
  for (let index = 0; index < 29; index++) await slider.press('ArrowRight');
  await button('停止录制').click();
  await scrub(0.5);
  await page.waitForFunction(() => Math.abs(window.motionSnapshot().pose.rotations.leftUpperArm?.[2] ?? 0) > 0.1);
  const origin = await snapshot();
  const original = direction(origin);
  const download = page.waitForEvent('download');
  await button('保存').click();
  const file = await download;
  const project = JSON.parse(await readFile(await file.path(), 'utf8'));
  const recording = project.modules.find((entry) => entry.name.startsWith('动作录制'));
  assert.ok(recording?.restDirections?.leftUpperArm, 'recording stores actual source reference');
  await button('导入模型').click();
  await page.getByLabel('模型文件', { exact: true }).setInputFiles(model);
  await button('载入模型').click();
  await rendered(`local:${basename(model)}`);
  await page.waitForFunction(() => Math.abs(window.motionSnapshot().pose.rotations.leftUpperArm?.[2] ?? 0) > 0.1);
  const transferred = direction(await snapshot());
  const error = distance(original, transferred);
  assert.ok(error < 0.08, `source and target arm directions differ by ${error}`);
  await page.screenshot({ path: join(output, 'recorded-transfer.png') });
  await button('新建工程').click();
  await button('创建工程').click();
  await rendered(`local:${basename(model)}`);
  await button('动作模块').click();
  await button('左手挥动').click();
  await scrub(1.3);
  await page.waitForFunction(() => Math.abs(window.motionSnapshot().pose.rotations.leftUpperArm?.[2] ?? 0) > 0.1);
  const waveT = direction(await snapshot());
  await selectOption(page.getByRole('combobox', { name: '角色模型', exact: true }), 'yukino-04-v1');
  await rendered('yukino-04-v1');
  await page.waitForFunction(() => Math.abs(window.motionSnapshot().pose.rotations.leftUpperArm?.[2] ?? 0) > 0.1);
  const waveA = direction(await snapshot());
  const waveError = distance(waveT, waveA);
  assert.ok(waveError < 0.08, `procedural wave directions differ by ${waveError}`);
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'report.json'), JSON.stringify({ original, transferred, error, waveT, waveA, waveError }, null, 2));
  console.log(JSON.stringify({ error, waveError }));
} catch (error) {
  await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  throw error;
} finally { await browser.close(); }
