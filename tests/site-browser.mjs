// End-to-end website test against the local development server
// (npm run api:dev). Uses the loopback test mailbox; never sends real email.
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';

const BASE = process.env.YUKINO_LOCAL_SITE || 'http://127.0.0.1:8787';
const email = `site-${Date.now()}@example.com`;
const password = 'Site-Test-Password-123!';
const nextPassword = 'New-Site-Passphrase-456!';

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
  assert.equal(await page.locator('#register-nickname').getAttribute('required'), null);
  await page.click('#register-send-code');
  await page.locator('.form-notice').waitFor({state: 'visible'});
  const registerCode = await codeFor(email, '注册验证码');
  await page.fill('#register-code', registerCode);
  await page.fill('#register-password', password);
  await page.fill('#register-confirm', password);
  await Promise.all([page.waitForURL('**/account'), page.click('#register-submit')]);
  await page.locator('.account-center, .account-head').first().waitFor({state: 'visible'});
  assert.match(await page.locator('body').innerText(), /陪伴进度/);
  const newName = `🌙晚风 · ${Date.now().toString(36).slice(-4)}`;
  const nickname = page.locator('#nickname-input');
  if (await nickname.isHidden()) await page.click('#edit-nickname');
  await nickname.fill(newName);
  await page.click('#nickname-submit');
  await page.waitForFunction(name => document.querySelector('.ac-identity h1')?.textContent === name, newName);
  assert.deepEqual(await page.locator('.ac-avatar,.header-user-avatar').allTextContents(), ['🌙','🌙','🌙']);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(name => document.querySelector('.ac-identity h1')?.textContent === name, newName);
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({path:'build/account-review/site-account-390.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
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

  const cookies = await context.cookies();
  const refreshCookie = cookies.find(({name}) => name === 'yk_refresh');
  assert.ok(refreshCookie?.httpOnly);
  assert.ok(refreshCookie.expires > Date.now() / 1000);

  const refreshPath = '**/api/v1/auth/refresh';
  await page.route(refreshPath, (route) => route.fulfill({status: 503, json: {}}), {times: 1});
  await page.goto(`${BASE}/login/`, {waitUntil: 'domcontentloaded'});
  await page.locator('#retry-account').waitFor({state: 'visible'});
  assert.equal(await page.locator('#login-form').count(), 0);

  // Restore the account even if another tab is briefly rotating the cookie.
  await page.route(refreshPath, (route) => route.fulfill({
    status: 409, json: {error: {code: 'refresh_in_progress', retryAfter: 1}},
  }), {times: 1});
  await Promise.all([page.waitForURL('**/account', {timeout: 6000}), page.click('#retry-account')]);
  await page.locator('.account-head').waitFor({state: 'visible'});

  // A brief service outage shows retry without taking the user to sign-in.
  await page.route(refreshPath, (route) => route.fulfill({status: 503, json: {}}), {times: 1});
  await page.reload({waitUntil: 'domcontentloaded'});
  await page.locator('#retry-account').waitFor({state: 'visible'});
  assert.equal(new URL(page.url()).pathname, '/account');
  await page.click('#retry-account');
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
  const restoredAccount = mobile.locator('#header-account[href="/account"]');
  await restoredAccount.waitFor({state: 'attached'});
  assert.equal(await restoredAccount.locator('.header-user-avatar').textContent(), '🌙');
  await mobile.click('#nav-toggle');
  assert.equal(await mobile.locator('#header-nav').evaluate((node) => getComputedStyle(node).display !== 'none'), true);
  await mobile.screenshot({path: 'build/account-review/site-home-390.png', fullPage: true});

  assert.deepEqual(errors, []);
  console.log('PASS website: downloads, registration, password reset, remembered login, refresh retries, deep links, mobile nav');
} finally {
  await browser.close();
}
