import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { optionValues, selectedOptionValue, selectOption } from './select-qa.mjs';

// Run with the studio server open. Set MOTION_CHROMIUM for a nonstandard browser location.
const origin = process.argv[2] ?? 'http://127.0.0.1:5197';
const artifacts = process.env.MOTION_QA_OUTPUT ? resolve(process.env.MOTION_QA_OUTPUT) : fileURLToPath(new URL('../artifacts/browser-qa/', import.meta.url));
const browsers = [process.env.MOTION_CHROMIUM,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].filter(Boolean);
const available = await Promise.all(browsers.map((path) => access(path).then(() => path, () => undefined)));
const executablePath = available.find(Boolean);
if (!executablePath) throw new Error('Set MOTION_CHROMIUM to an installed Chrome, Edge or Chromium executable.');
await mkdir(artifacts, { recursive: true });

const browser = await chromium.launch({ executablePath, headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];
const evidence = {};
const videos = new Map();
const viewport = { width: 1520, height: 1000 };
const context = await browser.newContext({
  viewport, acceptDownloads: true,
  recordVideo: process.env.MOTION_QA_VIDEO === '1' ? { dir: join(artifacts, 'sessions'), size: viewport } : undefined,
});

async function open(path) {
  const page = await context.newPage();
  const video = page.video();
  if (video) videos.set(path === '/' ? 'studio-session.webm' : 'player-session.webm', video);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${origin}${path}?qa=1`, { waitUntil: 'domcontentloaded' });
  return page;
}

async function waitForRig(page, id) {
  await page.waitForFunction((id) => {
    const model = window.motionSnapshot?.();
    const canvas = document.querySelector('.stage-canvas canvas');
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
    return model?.modelId === id && model.rendered && model.triangles > 10000 && canvas
      && canvas.width === Math.floor(canvas.clientWidth * pixelRatio) && canvas.height === Math.floor(canvas.clientHeight * pixelRatio);
  }, id, { timeout: 30000 });
}

async function newCurrentProject(page, id) {
  await page.getByRole('button', { name: '新建工程', exact: true }).click();
  await page.getByRole('button', { name: '创建工程', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await waitForRig(page, id);
}

function boneRotation(page, bone) {
  return page.evaluate((bone) => window.motionSnapshot().pose.rotations[bone], bone);
}

function nearlyEqualRotation(first, second) {
  return Math.abs(first.reduce((sum, value, axis) => sum + value * second[axis], 0)) > 1 - 1e-6;
}

async function waitForBoneRotation(page, bone, expected) {
  await page.waitForFunction(({ bone, expected }) => {
    const pose = window.motionSnapshot?.()?.pose?.rotations[bone];
    return pose && Math.abs(pose.reduce((sum, value, axis) => sum + value * expected[axis], 0)) > 1 - 1e-6;
  }, { bone, expected });
}

async function atRange(range, fraction) {
  const bounds = await range.boundingBox();
  assert.ok(bounds, 'Range control is on screen');
  await range.click({ position: { x: Math.round(bounds.width * fraction), y: Math.round(bounds.height / 2) } });
}

async function dragRange(page, range, from, to) {
  await range.scrollIntoViewIfNeeded();
  const bounds = await range.boundingBox();
  assert.ok(bounds, 'Range control is on screen');
  const y = bounds.y + bounds.height / 2;
  const x = (fraction) => bounds.x + bounds.width * fraction;
  await page.mouse.move(x(from), y);
  await page.mouse.down();
  const steps = 6;
  for (let step = 1; step <= steps; step++) {
    await page.waitForTimeout(55);
    await page.mouse.move(x(from + (to - from) * step / steps), y);
  }
  await page.mouse.up();
}

async function scrubEditor(page, frame, fps = 30) {
  const ruler = page.locator('.ruler');
  const pixels = await ruler.evaluate((element) => Number.parseFloat(getComputedStyle(element).getPropertyValue('--second')));
  const rulerBounds = await ruler.boundingBox();
  assert.ok(rulerBounds && pixels > 0, 'Timeline ruler has a scale');
  await page.mouse.click(rulerBounds.x + frame / fps * pixels + 0.15, rulerBounds.y + rulerBounds.height / 2);
}

async function save(page, button, filename) {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: button, exact: true }).click()]);
  const path = join(artifacts, filename);
  await download.saveAs(path);
  return path;
}

async function exerciseDock(page) {
  const panel = (id) => page.locator(`[data-dock-panel="${id}"]`);
  const timeline = panel('timeline');
  const preview = panel('preview');
  const library = panel('library');
  const before = { timeline: await timeline.boundingBox(), library: await library.boundingBox() };
  await page.evaluate(() => { window.qaOriginalCanvas = document.querySelector('.stage-canvas canvas'); });

  const splitter = await page.getByRole('separator', { name: '调整属性与时间线的尺寸' }).boundingBox();
  assert.ok(splitter, 'Timeline splitter is visible');
  const x = splitter.x + splitter.width / 2;
  const y = splitter.y + splitter.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 36, { steps: 5 });
  await page.mouse.up();
  await page.waitForFunction((height) => document.querySelector('[data-dock-panel="timeline"]').getBoundingClientRect().height > height + 30, before.timeline.height);

  await page.getByRole('separator', { name: '调整动作资源与三维预览的尺寸' }).press('ArrowRight');
  assert.ok((await library.boundingBox()).width > before.library.width + 8, 'Keyboard resizes a column');

  const original = await preview.boundingBox();
  const previewHeading = await preview.locator('.dock-pane-heading').boundingBox();
  await page.mouse.move(previewHeading.x + 40, previewHeading.y + 15);
  await page.mouse.down();
  await page.mouse.move(previewHeading.x + 174, previewHeading.y + 116, { steps: 7 });
  await page.waitForFunction(() => document.querySelector('[data-dock-panel="preview"]').dataset.dragging === 'true');
  const moving = await preview.boundingBox();
  assert.ok(Math.abs(moving.x - original.x - 134) < 1.1);
  assert.ok(Math.abs(moving.y - original.y - 101) < 1.1);
  assert.equal(moving.width, original.width);
  assert.equal(moving.height, original.height);
  assert.equal(await page.locator('.dock-drop-preview').count(), 0, 'No stand-in preview box is created');
  assert.ok(await page.evaluate(() => window.qaOriginalCanvas === document.querySelector('.stage-canvas canvas')), 'The real WebGL canvas follows the pointer');
  await page.screenshot({ path: join(artifacts, '10-panel-live-drag.png') });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('[data-dock-panel="preview"]').dataset.dragging === 'false');
  assert.deepEqual(await preview.boundingBox(), original, 'Escape returns the lifted pane to its slot');

  const heading = await timeline.locator('.dock-pane-heading').boundingBox();
  const workspace = await page.locator('.dock-workspace').boundingBox();
  await page.mouse.move(heading.x + 45, heading.y + 14);
  await page.mouse.down();
  await page.mouse.move(workspace.x + workspace.width - 8, workspace.y + workspace.height / 2, { steps: 9 });
  await page.waitForFunction(() => document.querySelector('.dock-workspace').dataset.dockEdge === 'right');
  await page.mouse.up();
  await page.waitForFunction(() => {
    const preview = document.querySelector('[data-dock-panel="preview"]').getBoundingClientRect();
    const timeline = document.querySelector('[data-dock-panel="timeline"]').getBoundingClientRect();
    return timeline.left > preview.right && Math.abs(timeline.top - preview.top) < 1;
  });
  assert.ok((await timeline.boundingBox()).height > workspace.height - 20, 'The workspace edge creates a full-height column');

  const inspectorBeforeSwap = await panel('inspector').boundingBox();
  const previewBeforeSwap = await preview.boundingBox();
  await page.mouse.move(inspectorBeforeSwap.x + 36, inspectorBeforeSwap.y + 15);
  await page.mouse.down();
  await page.mouse.move(previewBeforeSwap.x + previewBeforeSwap.width / 2, previewBeforeSwap.y + previewBeforeSwap.height / 2, { steps: 6 });
  await page.waitForFunction(() => document.querySelector('[data-dock-panel="preview"]').dataset.dockTarget === 'true');
  await page.mouse.up();
  await page.waitForFunction((x) => document.querySelector('[data-dock-panel="inspector"]').getBoundingClientRect().x === x, previewBeforeSwap.x);

  const moveInspector = page.getByRole('button', { name: '移动属性面板' });
  await moveInspector.press('Enter');
  await selectOption(page.getByRole('combobox', { name: '停靠位置' }), 'top');
  await page.getByRole('button', { name: '移动', exact: true }).press('Enter');
  const inspector = await panel('inspector').boundingBox();
  const previewAfter = await preview.boundingBox();
  assert.ok(inspector.y + inspector.height < previewAfter.y && inspector.width > workspace.width - 20, 'Keyboard menu docks above the workspace');
  assert.ok(await page.evaluate(() => window.qaOriginalCanvas === document.querySelector('.stage-canvas canvas')), 'Docking retains the live WebGL canvas');
  await waitForRig(page, 'yukino-04-v1');
  await page.screenshot({ path: join(artifacts, '09-dock-layout.png') });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForRig(page, 'yukino-04-v1');
  assert.deepEqual(await preview.boundingBox(), previewAfter, 'Layout survives a reload');
  await page.getByRole('button', { name: '视图', exact: true }).click();
  await page.getByRole('menuitem', { name: '恢复默认布局', exact: true }).click();
  await page.waitForFunction((y) => document.querySelector('[data-dock-panel="timeline"]').getBoundingClientRect().top === y, before.timeline.y);
  assert.deepEqual(await timeline.boundingBox(), before.timeline, 'View menu reset restores the default layout');
  await moveInspector.click();
  await page.getByRole('combobox', { name: '停靠位置' }).press('Escape');
  assert.equal(await moveInspector.getAttribute('aria-expanded'), 'false');
  return { resized: true, livePanelDrag: true, escapeCancels: true, edgeDocked: true, centerSwapped: true,
    menuDocked: true, preservedCanvas: true, persisted: true, reset: true };
}

async function run() {
  const studio = await open('/');
  await waitForRig(studio, 'yukino-04-v1');
  evidence.dock = await exerciseDock(studio);
  if (process.env.MOTION_QA_DOCK_ONLY === '1') {
    console.log(JSON.stringify(evidence, null, 2));
    return;
  }
  await studio.getByRole('button', { name: '头部', exact: true }).click();
  await studio.getByRole('button', { name: '骨架', exact: true }).click();
  await studio.getByRole('button', { name: '局部坐标轴', exact: true }).click();
  await studio.screenshot({ path: join(artifacts, '01-kimono-rig.png') });

  const rotation = studio.getByRole('slider', { name: '旋转 Z', exact: true });
  await rotation.evaluate((element) => {
    const gestures = window.qaSliderGestures = [];
    element.addEventListener('pointerdown', () => gestures.push({ start: performance.now() }));
    element.addEventListener('input', () => {
      const gesture = gestures.at(-1);
      if (gesture && gesture.end === undefined) gesture.lastChange = performance.now();
    });
    window.addEventListener('pointerup', () => {
      const gesture = gestures.at(-1);
      if (gesture && gesture.end === undefined) gesture.end = performance.now();
    });
  });
  const manualBefore = await boneRotation(studio, 'head');
  await studio.getByRole('button', { name: '开始录制', exact: true }).click();
  const armedAt = performance.now();
  await studio.waitForTimeout(500);
  await dragRange(studio, rotation, 0.5, 0.69);
  await studio.waitForFunction(() => window.motionSnapshot().pose.rotations.head[2] > 0.35);
  const manualTurned = await boneRotation(studio, 'head');
  assert.ok(!nearlyEqualRotation(manualBefore, manualTurned), 'Manual control changes the actual bone quaternion');
  await studio.waitForTimeout(1100);
  await dragRange(studio, rotation, 0.69, 0.31);
  await studio.waitForFunction(() => window.motionSnapshot().pose.rotations.head[2] < -0.35);
  const manualReversed = await boneRotation(studio, 'head');
  await studio.waitForTimeout(550);
  const armedSeconds = (performance.now() - armedAt) / 1000;
  await studio.getByRole('button', { name: '停止录制', exact: true }).click();
  const gestures = await studio.evaluate(() => window.qaSliderGestures);
  assert.equal(gestures.length, 2);
  assert.ok(gestures.every(({ start, lastChange, end }) => start < lastChange && lastChange <= end), 'Both gestures actually move the slider');
  const gapSeconds = (gestures[1].start - gestures[0].end) / 1000;
  const activeSeconds = gestures.reduce((sum, { start, lastChange }) => sum + lastChange - start, 0) / 1000;
  assert.ok(gapSeconds >= 1, 'There is a deliberate idle pause between gestures');
  const recorded = studio.locator('.clip-label').filter({ hasText: '动作录制 1' });
  await recorded.waitFor({ state: 'visible' });
  const speed = studio.getByRole('spinbutton', { name: /播放速度/ });
  await speed.fill('2');
  await speed.press('Enter');
  assert.equal(await speed.inputValue(), '2');
  const projectTitle = studio.getByRole('textbox', { name: '工程名称' });
  await projectTitle.fill('雪乃录制验证');
  await projectTitle.press('Enter');

  const projectFile = await save(studio, '保存', 'recording.yukinomotion');
  const rawProject = JSON.parse(await readFile(projectFile, 'utf8'));
  const savedProject = rawProject.project ?? rawProject;
  const savedClip = savedProject.tracks.flatMap((track) => track.clips)[0];
  assert.equal(savedClip.speed, 2);
  const recordedModule = Object.values(savedProject.modules).find((item) => item.id === savedClip.moduleId);
  const recordedHead = recordedModule.channels.find((item) => item.key === 'head' && item.type === 'rotation');
  assert.ok(recordedHead.keys.some(({ value }) => nearlyEqualRotation(value, manualTurned)), 'Recording preserves the first gesture endpoint');
  assert.ok(nearlyEqualRotation(recordedHead.keys.at(-1).value, manualReversed), 'Recording preserves the second gesture endpoint');
  assert.ok(recordedHead.keys.length > 2);
  assert.ok(Math.abs(recordedModule.duration - activeSeconds) < 0.25,
    `Clip should approximate active drag time (${activeSeconds.toFixed(2)}s), found ${recordedModule.duration.toFixed(2)}s`);
  assert.ok(armedSeconds - recordedModule.duration > 1.8, 'Arming, idle between gestures, and stopping do not extend the clip');
  const animatedKey = recordedHead.keys.find(({ value }) => nearlyEqualRotation(value, manualTurned));
  const frame = Math.max(1, Math.round(animatedKey.time / savedClip.speed * savedProject.fps));

  await scrubEditor(studio, frame, savedProject.fps);
  await studio.waitForFunction(() => Math.abs(window.motionSnapshot().pose.rotations.head[2]) > 0.15);
  const editedPose = await boneRotation(studio, 'head');
  await studio.screenshot({ path: join(artifacts, '02-recorded-timeline.png') });
  const runtimeFile = await save(studio, '导出动作包', 'recording.motion.json');
  evidence.recording = {
    samples: recordedHead.keys.length, speed: savedClip.speed, sourceDuration: recordedModule.duration,
    armedSeconds, activeSeconds, gapSeconds, frame, editedPose,
  };

  await studio.reload({ waitUntil: 'domcontentloaded' });
  await waitForRig(studio, 'yukino-04-v1');
  await studio.locator('input[type=file][accept*="yukinomotion"]').setInputFiles(projectFile);
  await studio.waitForFunction(() => document.querySelector('.project-name')?.value === '雪乃录制验证');
  await waitForRig(studio, 'yukino-04-v1');
  await scrubEditor(studio, frame, savedProject.fps);
  await waitForBoneRotation(studio, 'head', editedPose);
  await studio.screenshot({ path: join(artifacts, '03-reopened-project.png') });

  const player = await open('/player.html');
  await player.locator('input[type=file][accept=".json"]').setInputFiles(runtimeFile);
  await waitForRig(player, 'yukino-04-v1');
  const progress = player.getByRole('slider', { name: '播放器进度' });
  await progress.press('Home');
  for (let index = 0; index < frame; index++) await progress.press('ArrowRight');
  await waitForBoneRotation(player, 'head', editedPose);
  await player.screenshot({ path: join(artifacts, '04-independent-player.png') });
  await player.getByRole('button', { name: '回到起点', exact: true }).click();
  await player.getByRole('button', { name: '循环播放', exact: true }).click();
  await player.getByRole('button', { name: '播放', exact: true }).click();
  await player.waitForFunction(() => Math.abs(window.motionSnapshot().pose.rotations.head[2]) > 0.15);
  if (process.env.MOTION_QA_VIDEO === '1') await player.waitForTimeout(2300);
  await player.getByRole('button', { name: '暂停', exact: true }).click();
  evidence.reopenedAndPlayed = true;

  const chooser = studio.getByRole('combobox', { name: '角色模型', exact: true });
  await selectOption(chooser, 'yukino-07-v1');
  await waitForRig(studio, 'yukino-07-v1');
  await waitForBoneRotation(studio, 'head', editedPose);
  await studio.getByPlaceholder('搜索关节或表情').fill('微笑');
  await studio.getByRole('button', { name: '微笑', exact: true }).click();
  await atRange(studio.getByRole('slider', { name: '微笑权重', exact: true }), 0.72);
  await studio.waitForFunction(() => window.motionSnapshot().pose.expressions.smile > 0.65);
  await selectOption(studio.getByRole('combobox', { name: '相机视角' }), 'face');
  await studio.screenshot({ path: join(artifacts, '05-school-expression.png') });
  evidence.schoolSmile = await studio.evaluate(() => window.motionSnapshot().pose.expressions.smile);

  await newCurrentProject(studio, 'yukino-07-v1');
  const neutralRightHandHeight = await studio.evaluate(() => window.motionSnapshot().positions.rightHand[1]);
  await studio.getByRole('button', { name: '动作模块', exact: true }).click();
  const search = studio.getByPlaceholder('搜索动作');
  await search.fill('眨眼');
  assert.ok(await studio.locator('.module-row').filter({ hasText: '眨眼' }).isDisabled(), 'Missing blink target disables the module');
  for (const name of ['歪头', '右手挥动', '微笑']) {
    await search.fill(name);
    await studio.getByRole('button', { name, exact: true }).click();
  }
  await scrubEditor(studio, 30);
  await studio.waitForFunction(() => {
    const pose = window.motionSnapshot().pose;
    return pose.expressions.smile > 0.6 && Math.abs(pose.rotations.head[2]) > 0.07
      && Math.abs(pose.rotations.rightLowerArm[2]) > 0.3;
  });
  const wavingRightHandHeight = await studio.evaluate(() => window.motionSnapshot().positions.rightHand[1]);
  assert.ok(wavingRightHandHeight > neutralRightHandHeight + 0.2, 'Wave raises the actual right hand joint');
  await selectOption(studio.getByRole('combobox', { name: '相机视角' }), 'full');
  await studio.screenshot({ path: join(artifacts, '06-layered-motions.png') });
  evidence.layeredHeadArmAndSmile = { neutralRightHandHeight, wavingRightHandHeight };

  const ids = (await optionValues(chooser)).filter((id) => id !== 'none');
  evidence.renderedModels = {};
  for (const id of ids) {
    await selectOption(chooser, id);
    await waitForRig(studio, id);
    evidence.renderedModels[id] = await studio.evaluate(() => window.motionSnapshot().triangles);
  }
  await selectOption(chooser, 'yukino-07-walk14-preview');
  await waitForRig(studio, 'yukino-07-walk14-preview');
  await newCurrentProject(studio, 'yukino-07-walk14-preview');
  await studio.getByRole('button', { name: '动作模块', exact: true }).click();
  await search.fill('原地慢步');
  const neutralFoot = await studio.evaluate(() => window.motionSnapshot().positions.leftFoot);
  await studio.getByRole('button', { name: '原地慢步（评审）', exact: true }).click();
  await scrubEditor(studio, 12);
  await studio.waitForFunction((rest) => Math.hypot(...window.motionSnapshot().positions.leftFoot.map((axis, index) => axis - rest[index])) > 0.04, neutralFoot);
  evidence.embeddedWalk = { neutralFoot, animatedFoot: await studio.evaluate(() => window.motionSnapshot().positions.leftFoot) };
  await studio.screenshot({ path: join(artifacts, '07-walk-review.png') });

  await studio.getByRole('button', { name: '新建工程', exact: true }).click();
  await studio.getByRole('textbox', { name: '新工程名称' }).fill('外部绑定动作');
  await selectOption(studio.getByRole('combobox', { name: '起始模型' }), 'none');
  await studio.screenshot({ path: join(artifacts, '08-new-project.png') });
  await studio.getByRole('button', { name: '创建工程', exact: true }).click();
  await studio.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(await selectedOptionValue(chooser), 'none');
  assert.equal(await studio.getByRole('textbox', { name: '工程名称', exact: true }).inputValue(), '外部绑定动作');

  const source = await readFile(new URL('../../public/characters/Yukino04_UVPartsClean_PORTABLE.glb', import.meta.url));
  const jsonLength = source.readUInt32LE(12);
  const manifest = JSON.parse(source.toString('utf8', 20, 20 + jsonLength));
  manifest.buffers[0].uri = 'rig-data.bin';
  const modelFile = { name: 'bound-rig.gltf', mimeType: 'model/gltf+json', buffer: Buffer.from(JSON.stringify(manifest)) };
  const dependency = { name: 'rig-data.bin', mimeType: 'application/octet-stream', buffer: source.subarray(28 + jsonLength) };
  await studio.getByRole('button', { name: '导入模型', exact: true }).click();
  await studio.getByLabel('模型文件', { exact: true }).setInputFiles(modelFile);
  await studio.getByRole('button', { name: '载入模型', exact: true }).click();
  await studio.getByRole('alert').filter({ hasText: '缺少依赖文件' }).waitFor();
  assert.match(await chooser.textContent(), /未选择模型/, 'A failed import keeps the active project binding while the dialog remains open');
  await studio.getByLabel('glTF 依赖文件', { exact: true }).setInputFiles(dependency);
  await studio.getByRole('button', { name: '载入模型', exact: true }).click();
  await studio.getByRole('dialog').waitFor({ state: 'hidden' });
  await waitForRig(studio, 'local:bound-rig.gltf');
  assert.equal(await selectedOptionValue(chooser), 'local:bound-rig.gltf');
  await studio.getByRole('button', { name: '头部', exact: true }).click();
  await atRange(studio.getByRole('slider', { name: '旋转 Z', exact: true }), 0.66);
  await studio.waitForFunction(() => Math.abs(window.motionSnapshot().pose.rotations.head[2]) > 0.15);
  await studio.screenshot({ path: join(artifacts, '09-imported-rig.png') });
  const importedProject = await save(studio, '保存', 'imported-rig.yukinomotion');
  assert.equal(JSON.parse(await readFile(importedProject, 'utf8')).modelId, 'local:bound-rig.gltf');
  const reopened = await open('/');
  await reopened.locator('input[type=file][accept*="yukinomotion"]').setInputFiles(importedProject);
  await reopened.getByRole('button', { name: '定位本地模型', exact: true }).click();
  await reopened.getByLabel('模型文件', { exact: true }).setInputFiles({ ...modelFile, name: 'renamed-rig.gltf' });
  await reopened.getByLabel('glTF 依赖文件', { exact: true }).setInputFiles({ ...dependency, buffer: Buffer.from('wrong') });
  await reopened.getByRole('button', { name: '定位模型', exact: true }).click();
  await reopened.getByRole('alert').filter({ hasText: '指纹与工程记录不一致' }).waitFor();
  await reopened.getByLabel('glTF 依赖文件', { exact: true }).setInputFiles(dependency);
  await reopened.getByRole('button', { name: '定位模型', exact: true }).click();
  await waitForRig(reopened, 'local:bound-rig.gltf');
  evidence.modelImport = { emptyProjectCreated: true, missingDependencyRejected: true, importedRigMoved: true,
    changedDependencyRejected: true, relinkedRenamedFile: true };

  const posing = await open('/');
  await waitForRig(posing, 'yukino-04-v1');
  const diagram = posing.getByRole('region', { name: '身体姿势图', exact: true });
  const upperArm = diagram.getByRole('button', { name: '图上选择右上臂', exact: true });
  const wrist = diagram.getByRole('button', { name: '图上选择右手腕', exact: true });
  assert.equal(await diagram.locator('.body-pose-joint').count(), 23, 'Contour detail adds no synthetic rig controls');
  assert.equal(await diagram.locator('.body-pose-figure').count(), 18, 'The real rig supplies the detailed silhouette');
  await posing.getByRole('button', { name: '开始录制', exact: true }).click();
  await upperArm.click();
  await posing.getByRole('button', { name: '停止录制', exact: true }).click();
  await posing.getByRole('status').filter({ hasText: '这次没有捕捉到关节或表情输入' }).waitFor();
  assert.equal(await upperArm.getAttribute('aria-pressed'), 'true');

  await posing.getByRole('button', { name: '开始录制', exact: true }).click();
  const wristBefore = await wrist.getAttribute('style');
  const bounds = await upperArm.boundingBox();
  assert.ok(bounds);
  const armX = bounds.x + bounds.width / 2;
  const armY = bounds.y + bounds.height / 2;
  await posing.mouse.move(armX, armY);
  await posing.mouse.down();
  await posing.mouse.move(armX + 52, armY - 9, { steps: 8 });
  await posing.mouse.up();
  await posing.waitForFunction(() => Math.abs(window.motionSnapshot().pose.rotations.rightUpperArm[2]) > 0.25);
  assert.equal(await diagram.locator('.body-pose-selection').textContent(), '右上臂');
  assert.notEqual(await wrist.getAttribute('style'), wristBefore, 'The schematic limb follows the applied rotation');
  await posing.screenshot({ path: join(artifacts, '10-body-pose.png') });
  await posing.getByRole('button', { name: '停止录制', exact: true }).click();
  const poseProject = JSON.parse(await readFile(await save(posing, '保存', 'body-pose.yukinomotion'), 'utf8'));
  assert.equal(poseProject.modules.length, 1);
  assert.deepEqual(poseProject.modules[0].channels.map(({ key }) => key), ['rightUpperArm']);
  evidence.bodyPose = { selectionIgnoredByRecorder: true, draggedJointMoved: true, diagramLimbMoved: true, recordedChannel: 'rightUpperArm' };

  await selectOption(posing.getByRole('combobox', { name: '角色模型', exact: true }), 'yukino-07-v1');
  await waitForRig(posing, 'yukino-07-v1');
  await posing.getByRole('button', { name: '动作示例', exact: true }).click();
  await posing.getByRole('button', { name: '关节与表情', exact: true }).click();
  await posing.getByRole('button', { name: '全身根节点', exact: true }).click();
  await posing.getByRole('button', { name: '局部位移', exact: true }).click();
  const rootPosition = posing.getByRole('spinbutton', { name: /位移 X/ });
  await rootPosition.fill('15');
  await rootPosition.press('Enter');
  await posing.getByRole('button', { name: '写入关键帧', exact: true }).click();
  await scrubEditor(posing, 15);
  await posing.waitForFunction(() => window.motionSnapshot().pose.translations.root[0] > 0.1);
  const exportedRoot = await posing.evaluate(() => window.motionSnapshot().pose.translations.root[0]);
  await scrubEditor(posing, 45);
  const sampleSchool = () => window.motionSnapshot().pose.expressions.smile > 0.6
    && Math.abs(window.motionSnapshot().pose.rotations.head[2]) > 0.08;
  await posing.waitForFunction(sampleSchool);
  const exportedPose = await posing.evaluate(() => window.motionSnapshot().pose);
  await posing.getByRole('button', { name: '文件', exact: true }).click();
  const [download] = await Promise.all([
    posing.waitForEvent('download', { timeout: 60000 }),
    posing.getByRole('menuitem', { name: '导出带动画的 GLB', exact: true }).click(),
  ]);
  const glbPath = join(artifacts, 'scene-baked.glb');
  await download.saveAs(glbPath);
  const glbBytes = await readFile(glbPath);
  assert.equal(glbBytes.toString('ascii', 0, 4), 'glTF');
  assert.equal(glbBytes.readUInt32LE(4), 2);
  const glb = JSON.parse(glbBytes.toString('utf8', 20, 20 + glbBytes.readUInt32LE(12)));
  assert.equal(glb.cameras?.length ?? 0, 0);
  assert.ok(glb.skins.length > 0 && glb.images.length > 0);
  assert.equal(glb.animations.length, 1);
  const paths = [...new Set(glb.animations[0].channels.map(({ target }) => target.path))];
  assert.deepEqual(paths.sort(), ['rotation', 'translation', 'weights']);
  assert.deepEqual(await posing.evaluate(() => window.motionSnapshot().pose), exportedPose);

  const glbPreview = await open('/');
  await glbPreview.getByRole('button', { name: '导入模型', exact: true }).click();
  await glbPreview.getByLabel('模型文件', { exact: true }).setInputFiles(glbPath);
  await glbPreview.getByRole('button', { name: '载入模型', exact: true }).click();
  await glbPreview.getByRole('dialog').waitFor({ state: 'hidden' });
  await waitForRig(glbPreview, 'local:scene-baked.glb');
  await glbPreview.getByRole('button', { name: '动作模块', exact: true }).click();
  await glbPreview.getByRole('button', { name: '雪乃 · 动作示例', exact: true }).click();
  await scrubEditor(glbPreview, 45);
  await glbPreview.waitForFunction(sampleSchool);
  const reloadedPose = await glbPreview.evaluate(() => window.motionSnapshot().pose);
  assert.ok(nearlyEqualRotation(exportedPose.rotations.head, reloadedPose.rotations.head));
  assert.ok(Math.abs(exportedPose.expressions.smile - reloadedPose.expressions.smile) < 1e-5);
  await glbPreview.screenshot({ path: join(artifacts, '11-reloaded-glb.png') });
  await scrubEditor(glbPreview, 15);
  await glbPreview.waitForFunction(() => window.motionSnapshot().pose.translations.root[0] > 0.1);
  const reloadedRoot = await glbPreview.evaluate(() => window.motionSnapshot().pose.translations.root[0]);
  assert.ok(Math.abs(reloadedRoot - exportedRoot) < 1e-5);
  evidence.standardGlb = { channelPaths: paths, binaryBytes: glbBytes.length, cameraCount: 0, reloadedAtSeconds: 1.5,
    smile: reloadedPose.expressions.smile, headRotationMatched: true, rootTranslationMatched: true };

  assert.deepEqual(errors, []);
  await writeFile(join(artifacts, 'report.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
}

try {
  await run();
} finally {
  try {
    await context.close();
    for (const [name, video] of videos) {
      await video.saveAs(join(artifacts, name));
      await video.delete();
    }
  } finally {
    await browser.close();
  }
}
