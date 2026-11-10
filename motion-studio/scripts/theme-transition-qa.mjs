import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const executablePath = process.env.MOTION_CHROMIUM || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const css = await readFile(fileURLToPath(new URL('../src/theme-transition.css', import.meta.url)), 'utf8');
const browser = await chromium.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(`<style>${css}
    :root{--bg:#f1f6fc}.app{--bg:#f1f6fc;background:var(--bg);transition:grid-template-columns .24s ease}
    #editor{background:var(--bg);width:100px;height:100px}</style><div id="editor"></div><div class="app">Companion</div>`);
  const read = () => page.evaluate(() => ({
    editor: getComputedStyle(document.querySelector('#editor')).backgroundColor,
    companion: getComputedStyle(document.querySelector('.app')).backgroundColor,
  }));
  const before = await read();
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--bg', '#111b2c');
    document.querySelector('.app').style.setProperty('--bg', '#111b2c');
  });
  await page.evaluate(() => {
    for (const node of [document.documentElement, document.querySelector('.app')]) {
      getComputedStyle(node).getPropertyValue('--bg');
      const animation = node.getAnimations().find((item) => item.transitionProperty === '--bg');
      if (!animation) throw new Error('Theme color transition was not created');
      animation.pause(); animation.currentTime = 180;
    }
  });
  const midway = await read();
  await page.evaluate(() => {
    for (const node of [document.documentElement, document.querySelector('.app')]) {
      node.getAnimations().find((item) => item.transitionProperty === '--bg').finish();
    }
  });
  const after = await read();
  assert.notEqual(midway.editor, before.editor, 'Editor begins changing');
  assert.notEqual(midway.editor, after.editor, 'Editor interpolates instead of switching immediately');
  assert.notEqual(midway.companion, before.companion, 'Companion begins changing');
  assert.notEqual(midway.companion, after.companion, 'Companion interpolates instead of switching immediately');
  assert.equal(after.editor, 'rgb(17, 27, 44)');
  assert.equal(after.companion, after.editor);
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--bg', '#f1f6fc');
    document.querySelector('.app').style.setProperty('--bg', '#f1f6fc');
    for (const node of [document.documentElement, document.querySelector('.app')]) {
      getComputedStyle(node).getPropertyValue('--bg');
      const animation = node.getAnimations().find((item) => item.transitionProperty === '--bg');
      if (!animation) throw new Error('Reverse theme transition was not created');
      animation.pause(); animation.currentTime = 180;
    }
  });
  const reverse = await read();
  assert.notEqual(reverse.editor, after.editor, 'Editor lightens gradually');
  assert.notEqual(reverse.editor, before.editor, 'Editor does not jump to light');
  assert.notEqual(reverse.companion, after.companion, 'Companion lightens gradually');
  assert.notEqual(reverse.companion, before.companion, 'Companion does not jump to light');
  await page.evaluate(() => {
    for (const node of [document.documentElement, document.querySelector('.app')]) {
      node.getAnimations().find((item) => item.transitionProperty === '--bg').finish();
    }
  });
  await page.evaluate(() => {
    document.documentElement.dataset.reducedMotion = 'true';
    document.querySelector('.app').classList.add('reduce');
    document.documentElement.style.setProperty('--bg', '#111b2c');
    document.querySelector('.app').style.setProperty('--bg', '#111b2c');
  });
  assert.deepEqual(await read(), after, 'In-app reduced motion skips both transitions');
  await page.evaluate(() => {
    delete document.documentElement.dataset.reducedMotion;
    document.querySelector('.app').classList.remove('reduce');
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--bg', '#f1f6fc');
    document.querySelector('.app').style.setProperty('--bg', '#f1f6fc');
  });
  await page.waitForTimeout(20);
  assert.deepEqual(await read(), before, 'Reduced motion changes colors immediately');
  console.log(JSON.stringify({ before, midway, after, reverse, reducedMotion: true }));
} finally {
  await browser.close();
}
