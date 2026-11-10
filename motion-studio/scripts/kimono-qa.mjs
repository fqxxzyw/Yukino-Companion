import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { selectOption } from './select-qa.mjs';

// Run against a built editor. Supply the two original sample files in MOTION_KIMONO_DIR.
const origin = process.argv[2] ?? 'http://127.0.0.1:5197';
const samples = process.env.MOTION_KIMONO_DIR ? resolve(process.env.MOTION_KIMONO_DIR)
  : fileURLToPath(new URL('../artifacts/kimono-handoff/', import.meta.url));
const output = join(samples, 'browser');
const vrm = join(samples, 'Yukino_Kimono_Unified_Hair_RESEARCH.vrm');
const glb = join(samples, 'Yukino_Kimono_Unified_Demo_v4_SkirtCorrection_REVIEW.glb');
const candidates = [process.env.MOTION_CHROMIUM, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean);
const browsers = await Promise.all(candidates.map((path) => access(path).then(() => path, () => undefined)));
const executablePath = browsers.find(Boolean);
assert.ok(executablePath, 'Set MOTION_CHROMIUM to Chrome, Edge or Chromium.');
await Promise.all([access(vrm), access(glb), mkdir(output, { recursive: true })]);

const browser = await chromium.launch({ executablePath, headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 940 }, acceptDownloads: true });
const page = await context.newPage();
page.setDefaultTimeout(30000);
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const report = {};
const button = (name) => page.getByRole('button', { name, exact: true });
const panel = page.getByRole('region', { name: '表情控制', exact: true });
const faceTab = page.locator('.inspector').getByRole('button', { name: '表情', exact: true });
const library = page.locator('.library');

async function rendered(id) {
  await page.waitForFunction((id) => {
    const scene = window.motionSnapshot?.();
    return scene?.modelId === id && scene.rendered && scene.triangles > 10000;
  }, id);
}
const snapshot = () => page.evaluate(() => window.motionSnapshot());
async function expression(id, value) {
  await page.waitForFunction(({ id, value }) => {
    const weight = window.motionSnapshot?.()?.pose?.expressions[id];
    return typeof weight === 'number' && Math.abs(weight - value) < 0.001;
  }, { id, value });
}
async function importModel(file) {
  await button('导入模型').click();
  await page.getByLabel('模型文件', { exact: true }).setInputFiles(file);
  await button('载入模型').click();
  await rendered(`local:${basename(file)}`);
  await selectOption(page.getByRole('combobox', { name: '相机视角' }), 'face');
  await faceTab.click();
}
async function testEyes(prefix) {
  const eye = (name) => panel.getByRole('button', { name, exact: true });
  await eye('闭上双眼').click();
  await expression('blinkLeft', 1);
  await expression('blinkRight', 1);
  await page.screenshot({ path: join(output, `${prefix}-closed.png`) });
  await eye('睁开左眼').click();
  await expression('blinkLeft', 0);
  await expression('blinkRight', 1);
  await eye('睁开双眼').click();
  await expression('blinkLeft', 0);
  await expression('blinkRight', 0);
  await page.screenshot({ path: join(output, `${prefix}-open.png`) });
  await eye('交还时间线').click();
}
async function scrub(seconds) {
  const ruler = page.locator('.ruler');
  const width = await ruler.evaluate((element) => Number.parseFloat(getComputedStyle(element).getPropertyValue('--second')));
  const bounds = await ruler.boundingBox();
  assert.ok(width > 0 && bounds);
  await page.mouse.click(bounds.x + width * seconds + 0.15, bounds.y + bounds.height / 2);
}
async function newProject() {
  await button('新建工程').click();
  await button('创建工程').click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await rendered(`local:${basename(glb)}`);
}

try {
  await page.goto(`${origin}/?qa=1`, { waitUntil: 'domcontentloaded' });
  await rendered('yukino-04-v1');
  await faceTab.click();
  await panel.getByText('缺少双眼闭合通道', { exact: true }).waitFor();
  assert.equal(await panel.getByRole('button', { name: '闭上双眼', exact: true }).count(), 0);
  await panel.getByRole('slider', { name: '张嘴权重', exact: true }).waitFor();

  await importModel(vrm);
  await testEyes('01-vrm');
  await panel.getByRole('slider', { name: '微笑权重', exact: true }).waitFor();
  await panel.getByRole('slider', { name: '口型 A权重', exact: true }).waitFor();
  const vrmSnapshot = await snapshot();
  assert.equal(vrmSnapshot.vrm.version, '1');
  assert.equal(vrmSnapshot.vrm.springJoints.length, 10);
  await button('开始录制').click();
  await panel.getByRole('button', { name: '闭上双眼', exact: true }).click();
  await page.waitForTimeout(700);
  await panel.getByRole('button', { name: '睁开双眼', exact: true }).click();
  await button('停止录制').click();
  await library.getByText('此模型没有内嵌动作，可以使用支持的动作模块或自己录制。').waitFor();
  await page.locator('.track-lane').first().click({ position: { x: 12, y: 12 } });
  await button('回到起点').click();
  await faceTab.click();
  await panel.getByRole('slider', { name: '微笑权重', exact: true }).press('End');
  await expression('smile', 1);
  await panel.getByRole('button', { name: '写入关键帧', exact: true }).click();
  await faceTab.click();
  assert.ok(await panel.getByRole('button', { name: '交还时间线', exact: true }).isDisabled());
  await scrub(0.2);
  await expression('smile', 1);
  await button('回到起点').click();
  const download = page.waitForEvent('download');
  await button('保存').click();
  const saved = await download;
  const project = JSON.parse(await readFile(await saved.path(), 'utf8'));
  const recording = project.modules.find((item) => item.name.startsWith('动作录制'));
  assert.ok(recording && recording.duration < 0.15);
  assert.deepEqual(recording.channels.map(({ key }) => key).sort(), ['blinkLeft', 'blinkRight']);
  assert.ok(project.modules.some((item) => item.channels?.some(({ key, keys }) => key === 'smile' && keys[0].value === 1)));
  report.vrm = { triangles: vrmSnapshot.triangles, springJoints: vrmSnapshot.vrm.springJoints.length,
    recordedSeconds: recording.duration, channels: recording.channels.map(({ key }) => key), smileKeyframe: true };
  console.log('Old kimono capability and supplied VRM controls, rendered eyes and compact recording passed.');

  await importModel(glb);
  await newProject();
  await page.locator('.inspector').getByRole('button', { name: '操控', exact: true }).click();
  for (const limb of ['右上臂', '左前臂', '右大腿', '左脚踝']) {
    const joint = page.getByRole('button', { name: `图上选择${limb}`, exact: true });
    await joint.waitFor();
    assert.ok(await joint.isEnabled());
  }
  await page.getByRole('button', { name: '图上选择右上臂', exact: true }).click();
  await page.screenshot({ path: join(output, '04-glb-body-pose.png') });
  await faceTab.click();
  await testEyes('02-glb');
  const defaultSmile = (await snapshot()).pose.expressions.smile;
  assert.ok(Math.abs(defaultSmile - 0.09645062) < 0.0001);
  const smile = panel.getByRole('slider', { name: '微笑权重', exact: true });
  await smile.press('Home');
  for (let i = 0; i < 12; i++) await smile.press('ArrowRight');
  await expression('smile', 0.12);
  await button('动作模块').click();
  const native = (name) => library.getByRole('button', { name, exact: true });
  await native('SmallStepWalk').waitFor();
  await native('GentleGreeting').waitFor();
  await native('Blink').click();
  await button('循环预览').click();
  await button('播放').click();
  const blink = await page.waitForFunction(() => {
    const pose = window.motionSnapshot?.()?.pose?.expressions;
    return pose && pose.blink > 0.65 ? { blink: pose.blink, smile: pose.smile } : false;
  });
  const duringBlink = await blink.jsonValue();
  assert.ok(Math.abs(duringBlink.smile - 0.12) < 0.001);
  await button('暂停').click();
  await button('循环预览').click();
  await button('删除选中片段').click();
  await button('回到起点').click();
  const start = (await snapshot()).positions.root;
  await native('SmallStepWalk').click();
  assert.ok(await page.getByRole('spinbutton', { name: /循环次数/ }).isDisabled());
  assert.ok(await page.getByRole('spinbutton', { name: /权重/ }).isDisabled());
  await scrub(3.2);
  const walk = await page.waitForFunction((start) => {
    const root = window.motionSnapshot?.()?.positions?.root;
    const distance = root && Math.hypot(...root.map((n, i) => n - start[i]));
    return distance > 0.4 ? { distance } : false;
  }, start);
  const { distance } = await walk.jsonValue();
  await button('删除选中片段').click();
  await button('回到起点').click();
  await native('GentleGreeting').click();
  await selectOption(page.getByRole('combobox', { name: '相机视角' }), 'full');
  await scrub(2);
  const greeting = await page.waitForFunction(() => {
    const pose = window.motionSnapshot?.()?.pose;
    if (!pose || Object.values(pose.rotations).filter((rotation) => Math.abs(rotation[3]) < 0.999).length < 5) return false;
    const skirt = Object.entries(pose.expressions).filter(([id]) => /Kimono_.*CalfClearance/.test(id));
    return skirt.length === 2 && skirt.every(([, weight]) => weight > 0.999) ? Object.fromEntries(skirt) : false;
  });
  const skirt = await greeting.jsonValue();
  await page.screenshot({ path: join(output, '03-gentle-greeting.png') });
  report.glb = { defaultSmile, duringBlink, normalizedWalkDistance: distance, skirt };
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log('Supplied GLB eyes, native Blink preserving smile, walk root and baked greeting skirt passed.');
} catch (error) {
  const state = await snapshot().catch(() => undefined);
  if (state?.pose) {
    console.error({ model: state.modelId, animatedJoints: Object.keys(state.pose.rotations)
      .filter((id) => Math.abs(state.pose.rotations[id][3]) < 0.999),
    skirt: Object.fromEntries(Object.entries(state.pose.expressions).filter(([id]) => /Kimono_|CalfClearance/.test(id))) });
  }
  await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
