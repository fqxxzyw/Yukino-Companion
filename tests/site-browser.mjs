// End-to-end website test against the local development server
// (npm run api:dev). Uses the loopback test mailbox; never sends real email.
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';

const BASE = process.env.YUKINO_LOCAL_SITE || 'http://127.0.0.1:8787';
const email = `site-${Date.now()}@example.com`;
const password = 'correct horse battery staple 123';
const nextPassword = 'a new website passphrase 456';

async function mailbox() {
  const response = await fetch(`${BASE}/dev/mailbox.json`);
  assert.equal(response.status, 200, 'local test mailbox must be running');
  return response.json();
}
async function codeFor(address, purpose) {
  const box = await mailbox();
  const message = box.messages.find((item) => item.to === address && item.subject.includes(purpose));
  assert.ok(message, `expected a ${purpose} mail for ${address}`);
  const match = /验证码：(\d{6})/.exec(message.text);
  assert.ok(match, 'mail must contain a six-digit code');
  return match[1];
}

await fetch(`${BASE}/dev/reset-limits`, {method: 'POST'}).catch(() => {});
const browser = await chromium.launch({channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true});
const context = await browser.newContext({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce'});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  await page.goto(`${BASE}/`, {waitUntil: 'domcontentloaded'});
  await page.waitForFunction(() => /releases\/download\//.test(document.querySelector('#download-button')?.getAttribute('href') || ''), null, {timeout: 20000}).catch(() => {});
  const downloads = await (await fetch(`${BASE}/api/v1/public/downloads`)).json();
  const downloadHref = await page.locator('#download-button').getAttribute('href');
  if (downloads.latest?.asset?.url) assert.equal(downloadHref, downloads.latest.asset.url);
  else assert.match(downloadHref, /github\.com\/fqxxzyw\/Yukino-Companion\/releases/);

  // Register through the real website; code comes from the loopback mailbox.
  await page.goto(`${BASE}/register`, {waitUntil: 'domcontentloaded'});
  await page.fill('#register-email', email);
  await page.click('#register-send-code');
  await page.locator('.form-notice').waitFor({state: 'visible'});
  const registerCode = await codeFor(email, '注册验证码');
  await page.fill('#register-code', registerCode);
  await page.fill('#register-password', password);
  await page.fill('#register-confirm', password);
  await Promise.all([page.waitForURL('**/account'), page.click('#register-submit')]);
  await page.locator('.account-center, .account-head').first().waitFor({state: 'visible'});
  assert.match(await page.locator('body').innerText(), /已确认进度/);
  assert.match(await page.locator('body').innerText(), /网页端/);
  const accountScreenshot = 'build/account-review/site-account-1440.png';
  await page.screenshot({path: accountScreenshot, fullPage: true});

  // Session cleanup then password reset through the website.
  await context.clearCookies();
  await page.goto(`${BASE}/forgot`, {waitUntil: 'domcontentloaded'});
  await page.fill('#forgot-email', email);
  await page.click('#forgot-send');
  await page.locator('[data-step="2"]').waitFor({state: 'visible'});
  const resetCode = await codeFor(email, '密码重置验证码');
  await page.fill('#forgot-code', resetCode);
  await page.fill('#forgot-password', nextPassword);
  await page.fill('#forgot-confirm', nextPassword);
  await Promise.all([page.waitForURL('**/login'), page.click('#forgot-reset')]);
  assert.match(await page.locator('body').innerText(), /密码已重置/);

  // New password works, old password does not.
  await page.fill('#login-email', email);
  await page.fill('#login-password', password);
  await page.click('#login-submit');
  await page.locator('.form-error').waitFor({state: 'visible'});
  await page.fill('#login-password', nextPassword);
  await Promise.all([page.waitForURL('**/account'), page.click('#login-submit')]);
  await page.locator('.account-head').waitFor({state: 'visible'});

  // Deep links and unknown API behavior.
  await page.goto(`${BASE}/account`, {waitUntil: 'domcontentloaded'});
  await page.waitForTimeout(800);
  assert.equal(await page.locator('#home').isHidden(), true);
  const unknown = await fetch(`${BASE}/api/v1/does-not-exist`, {headers: {accept: 'application/json'}});
  assert.equal(unknown.status, 404);
  assert.match(unknown.headers.get('content-type') || '', /application\/json/);

  // Mobile navigation is real and accessible.
  const mobile = await context.newPage();
  await mobile.setViewportSize({width: 390, height: 844});
  await mobile.goto(`${BASE}/`, {waitUntil: 'domcontentloaded'});
  await mobile.click('#nav-toggle');
  assert.equal(await mobile.locator('#header-nav').evaluate((node) => getComputedStyle(node).display !== 'none'), true);
  await mobile.screenshot({path: 'build/account-review/site-home-390.png', fullPage: true});

  assert.deepEqual(errors, []);
  console.log('PASS website: real download link, register + auto-login, password reset, login, deep link, mobile nav');
} finally {
  await browser.close();
}
