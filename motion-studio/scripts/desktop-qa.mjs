import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright-core';
import { selectOption } from './select-qa.mjs';

const localPath = (path) => fileURLToPath(new URL(path, import.meta.url));
const evidence = localPath('../artifacts/desktop-qa/');
await mkdir(evidence, { recursive: true });
const profile = await mkdtemp(join(evidence, 'profile-'));
const executablePath = localPath('../artifacts/MotionEditor-win/Motion Editor.exe');
const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--user-data-dir=${profile}`];
const launch = () => _electron.launch({ executablePath, args, env: { ...process.env, MOTION_EDITOR_QA_HIDDEN: '1' } });
let app = await launch();
const origin = 'yukino-studio://local';
const storageKey = 'yukino-motion-workspace-v1';
const verifiedSampleModels = [];

async function waitForModel(page) {
  await page.waitForFunction(() => window.motionSnapshot?.().rendered && window.motionSnapshot().triangles > 10_000);
}

try {
  const page = await app.firstWindow();
  await page.locator('.topbar').waitFor();
  await page.goto(`${origin}/?qa=1`);
  await waitForModel(page);
  assert.equal(await page.title(), '动作编辑器');
  const logo = await page.locator('.brand-icon').evaluate((image) => image.complete && image.naturalWidth);
  assert.ok(logo, 'The application uses the actual packaged Companion icon');
  assert.ok(await page.evaluate(() => isSecureContext && !!crypto.subtle));
  const bounds = await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    return { outer: window.getBounds(), content: window.getContentBounds(), visible: window.isVisible() };
  });
  assert.equal(bounds.visible, false, 'The test window stays hidden');
  assert.ok(Math.abs(bounds.outer.y - bounds.content.y) <= 2, 'The native caption must not inset the renderer');

  await page.getByRole('button', { name: '开始录制', exact: true }).click();
  const canvas = await page.locator('canvas[aria-label="角色三维视窗"]').boundingBox();
  assert.ok(canvas);
  const before = await page.evaluate(() => window.motionSnapshot().camera);
  await page.mouse.move(canvas.x + canvas.width * 0.6, canvas.y + canvas.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width * 0.7, canvas.y + canvas.height * 0.45, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction((original) => window.motionSnapshot().camera.some((value, index) => Math.abs(value - original[index]) > 0.1), before);
  const afterOrbit = await page.evaluate(() => window.motionSnapshot().camera);
  await page.mouse.wheel(0, -320);
  await page.waitForFunction((original) => window.motionSnapshot().camera.some((value, index) => Math.abs(value - original[index]) > 0.1), afterOrbit);
  assert.equal(await page.locator('.stage-time').textContent(), '00:00:00');
  await page.getByRole('button', { name: '停止录制', exact: true }).click();
  assert.equal(await page.locator('.clip-label').count(), 0);
  await page.getByRole('button', { name: '适合窗口', exact: true }).click();

  await page.getByRole('button', { name: '切换主题' }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await waitForModel(page);
  const [player] = await Promise.all([
    app.waitForEvent('window'),
    page.getByRole('link', { name: '独立播放器' }).click(),
  ]);
  await player.waitForURL(`${origin}/player.html`);
  assert.ok(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every((window) => !window.isVisible())));
  await player.getByLabel('动作包文件').setInputFiles(localPath('../examples/school-wave.motion.json'));
  await player.getByRole('button', { name: '播放', exact: true }).click();
  await player.getByRole('button', { name: '暂停', exact: true }).waitFor();
  await player.getByRole('button', { name: '关闭窗口' }).click();

  await page.locator('body').evaluate(() => (document.activeElement instanceof HTMLElement) && document.activeElement.blur());
  await page.keyboard.press('Control+n');
  const project = page.getByRole('dialog');
  await project.getByRole('textbox', { name: '新工程名称' }).fill('桌面导入验证');
  await selectOption(project.getByRole('combobox', { name: '起始模型' }), 'import-local');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    project.getByLabel('模型文件').click(),
  ]);
  await chooser.setFiles(localPath('../../public/characters/Yukino04_UVPartsClean_PORTABLE.glb'));
  await project.getByRole('button', { name: '创建工程' }).click();
  await project.waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('textbox', { name: '工程名称', exact: true }).inputValue(), '桌面导入验证');
  await waitForModel(page);

  await page.getByRole('button', { name: '文件', exact: true }).click();
  const projectFile = join(evidence, 'saved-project.motionproject.json');
  await app.evaluate(({ BrowserWindow }, savePath) => {
    const session = BrowserWindow.getAllWindows()[0].webContents.session;
    globalThis.editorDownload = new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(null), 10_000);
      session.once('will-download', (_event, item) => {
        const filename = item.getFilename();
        item.setSavePath(savePath);
        item.once('done', (_event, state) => {
          clearTimeout(timeout);
          resolve({ filename, state });
        });
      });
    });
  }, projectFile);
  await page.getByRole('menuitem', { name: '保存工程 JSON' }).click();
  const saved = await app.evaluate(() => globalThis.editorDownload);
  assert.equal(saved?.state, 'completed', 'The desktop session downloads the project JSON');
  assert.match(saved.filename, /\.motionproject\.json$/);
  assert.equal(JSON.parse(await readFile(projectFile, 'utf8')).format, 'yukino-motion-project');

  if (process.env.MOTION_KIMONO_DIR) {
    const names = ['Yukino_Kimono_Unified_Hair_RESEARCH.vrm', 'Yukino_Kimono_Unified_Demo_v4_SkirtCorrection_REVIEW.glb'];
    for (const name of names) {
      await page.getByRole('button', { name: '导入模型', exact: true }).click();
      await page.getByRole('dialog').getByLabel('模型文件').setInputFiles(resolve(process.env.MOTION_KIMONO_DIR, name));
      await page.getByRole('button', { name: '载入模型', exact: true }).click();
      await page.waitForFunction((name) => {
        const scene = window.motionSnapshot?.();
        return scene?.modelId === `local:${name}` && scene.rendered && scene.triangles > 10000;
      }, name, { timeout: 30000 });
      await page.locator('.inspector').getByRole('button', { name: '表情', exact: true }).click();
      await page.getByRole('button', { name: '闭上双眼', exact: true }).click();
      await page.waitForFunction(() => {
        const { blinkLeft, blinkRight } = window.motionSnapshot().pose.expressions;
        return blinkLeft > 0.999 && blinkRight > 0.999;
      });
      verifiedSampleModels.push(name);
    }
  }

  const workspace = page.locator('.dock-workspace');
  const initialLayout = await page.evaluate((key) => localStorage.getItem(key), storageKey);
  await workspace.getByRole('button', { name: '移动属性面板' }).click();
  await selectOption(workspace.getByRole('combobox', { name: '停靠位置' }), 'top');
  await workspace.getByRole('button', { name: '移动', exact: true }).click();
  await page.waitForFunction(({ key, initial }) => localStorage.getItem(key) !== initial, { key: storageKey, initial: initialLayout });
  const savedLayout = await page.evaluate((key) => localStorage.getItem(key), storageKey);
  assert.ok(savedLayout);
  await waitForModel(page);
  await app.close();

  app = await launch();
  const restarted = await app.firstWindow();
  await restarted.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  assert.equal(await restarted.evaluate((key) => localStorage.getItem(key), storageKey), savedLayout);
  const results = { bounds, backgroundQA: true, companionIcon: true, darkThemePersists: true, layoutPersists: true,
    cameraExcludedFromRecording: true, projectJsonSavedFromMenu: true, desktopPickerWorked: true, playerPlayed: true, verifiedSampleModels };
  await writeFile(join(evidence, 'report.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally {
  await app.close();
}
