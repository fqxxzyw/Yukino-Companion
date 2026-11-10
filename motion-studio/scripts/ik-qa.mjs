import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { resolve } from 'node:path';

const browser = await chromium.launch({ executablePath: process.env.MOTION_CHROMIUM || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1520, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
page.setDefaultTimeout(30000);
const file = resolve('artifacts/kimono-handoff/Yukino_Kimono_Unified_Demo_v4_SkirtCorrection_REVIEW.glb');
const button = (name) => page.getByRole('button', { name, exact: true });
try {
  await page.goto((process.argv[2] || 'http://127.0.0.1:5271') + '/?qa=1');
  await page.waitForFunction(() => window.motionSnapshot?.()?.rendered);
  await button('导入模型').click();
  await page.getByLabel('模型文件', { exact: true }).setInputFiles(file);
  await button('载入模型').click();
  await page.waitForFunction(() => window.motionSnapshot?.()?.modelId?.includes('SkirtCorrection') && window.motionSnapshot()?.rendered);
  await page.waitForTimeout(1500);
  const read = () => page.evaluate(() => window.motionSnapshot());
  const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
  const drag = async (name, dx, dy) => {
    const box = await button(name).boundingBox(); assert.ok(box);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 });
    await page.mouse.up(); await page.waitForTimeout(250);
  };
  await button('开始录制').click();
  const before = await read();
  await drag('图上选择左手腕', -10, -30);
  const hand = await read();
  assert.ok(distance(before.positions.leftHand, hand.positions.leftHand) > 0.08, 'Hand moves in actual model');
  assert.ok(distance(before.pose.rotations.leftUpperArm, hand.pose.rotations.leftUpperArm) > 0.01);
  assert.ok(distance(before.pose.rotations.leftLowerArm, hand.pose.rotations.leftLowerArm) > 0.01);
  await button('停止录制').click();
  const download = page.waitForEvent('download'); await button('保存').click();
  const project = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  const recording = project.modules.find((entry) => entry.name.startsWith('动作录制'));
  assert.deepEqual(recording.channels.map(({ key }) => key).sort(), ['leftLowerArm', 'leftUpperArm']);
  await button('回到起点').click();
  await page.locator('.inspector').getByRole('button', { name: '操控', exact: true }).click();
  await page.locator('.body-pose[data-ik-ready="true"]').waitFor();
  const legBefore = await read();
  await drag('图上选择右脚踝', -18, -18);
  const leg = await read();
  assert.ok(distance(legBefore.positions.rightFoot, leg.positions.rightFoot) > 0.05, 'Foot moves in actual model');
  assert.ok(distance(legBefore.pose.rotations.rightUpperLeg, leg.pose.rotations.rightUpperLeg) > 0.01);
  assert.ok(distance(legBefore.pose.rotations.rightLowerLeg, leg.pose.rotations.rightLowerLeg) > 0.01);
  await page.screenshot({ path: resolve('artifacts/kimono-handoff/ik-qa.png') });
  await button('参考姿态').click();
  await page.waitForFunction(() => window.motionSnapshot().reference);
  await drag('图上选择左手腕', -10, -20);
  await page.getByRole('status').filter({ hasText: '无法使用 IK' }).waitFor();
  assert.equal((await read()).reference, true);
  console.log(JSON.stringify({ recorded: recording.channels.map(({ key }) => key), handMovement: distance(before.positions.leftHand, hand.positions.leftHand),
    footMovement: distance(legBefore.positions.rightFoot, leg.positions.rightFoot) }));
} finally { await browser.close(); }
