import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestApp} from './helpers.mjs';
import {CURRENT_PARAMS, hashPassword, verifyPassword} from '../src/password.js';

const EMAIL = 'secure@example.com';
const PASSWORD = 'Correct-Horse-Battery-123!';

test('password policy requires six characters and all four character classes', async () => {
  const app = await createTestApp();
  const requested = await app.call('/api/v1/auth/register/request-code', {method: 'POST', body: {email: EMAIL}});
  const challengeId = requested.data.challengeId;
  const base = {email: EMAIL, nickname: '安全测试昵称', code: app.lastCode(), challengeId, client: 'desktop'};
  for (const password of ['Ab1!', 'abc123!', 'ABC123!', 'Abcdef!', 'Abc1234']) {
    const weak = await app.call('/api/v1/auth/register', {method: 'POST', body: {...base, password}});
    assert.equal(weak.status, 400);
    assert.equal(weak.data.error.code, 'invalid_password');
  }
  const created = await app.call('/api/v1/auth/register', {method: 'POST', body: {...base, password: 'Abc123!'}});
  assert.equal(created.status, 201);
  assert.equal(created.data.user.nickname, '安全测试昵称');
  const login = await app.call('/api/v1/auth/login', {method: 'POST', body: {email: EMAIL, nickname: '雪乃测试', password: 'Abc123!'}});
  assert.equal(login.status, 200);
  const tooLong = await app.call('/api/v1/auth/login', {method: 'POST', body: {email: EMAIL, nickname: '雪乃测试', password: 'x'.repeat(513)}});
  assert.equal(tooLong.status, 400);
  // Existing accounts are verified against their stored hash; login never
  // applies the new composition rule to an old password.
  const legacyHash = await hashPassword('legacy old password');
  await app.db.prepare('UPDATE users SET password_hash = ? WHERE email = ?').bind(legacyHash, EMAIL).run();
  const legacyLogin = await app.call('/api/v1/auth/login', {method: 'POST', body: {email: EMAIL, nickname: '雪乃测试', password: 'legacy old password'}});
  assert.equal(legacyLogin.status, 200);
});

test('PBKDF2 encoded values carry algorithm/parameters and reject tampering', async () => {
  const hash = await hashPassword('a passphrase of adequate length');
  assert.match(hash, /^pbkdf2-sha256\$v=1\$10000\$/);
  assert.equal(CURRENT_PARAMS.iterations, 10000);
  assert.equal((await verifyPassword('a passphrase of adequate length', hash)).ok, true);
  assert.equal((await verifyPassword('wrong passphrase of adequate length', hash)).ok, false);
  const tampered = hash.replace(/\$[^$]+$/, '$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  assert.equal((await verifyPassword('a passphrase of adequate length', tampered)).ok, false);
  assert.equal((await verifyPassword('anything', 'md5$salt$hash')).ok, false);
  const tooFewIterations = hash.replace('$10000$', '$9999$');
  assert.deepEqual(await verifyPassword('a passphrase of adequate length', tooFewIterations), {ok: false, needsRehash: false});
});

test('a stronger existing password hash verifies without being downgraded on login', async () => {
  const app = await createTestApp();
  const requested = await app.call('/api/v1/auth/register/request-code', {method: 'POST', body: {email: EMAIL}});
  const created = await app.call('/api/v1/auth/register', {
    method: 'POST', body: {email: EMAIL, nickname: '雪乃测试', password: PASSWORD, code: app.lastCode(), challengeId: requested.data.challengeId, client: 'desktop'},
  });
  assert.equal(created.status, 201);
  for (const iterations of [100000, 600000]) {
    const legacyHash = await hashPassword(PASSWORD, {iterations});
    await app.db.prepare('UPDATE users SET password_hash = ? WHERE email = ?').bind(legacyHash, EMAIL).run();
    assert.deepEqual(await verifyPassword(PASSWORD, legacyHash), {ok: true, needsRehash: false});
    const login = await app.call('/api/v1/auth/login', {method: 'POST', body: {email: EMAIL, nickname: '雪乃测试', password: PASSWORD}});
    assert.equal(login.status, 200);
    const user = await app.db.prepare('SELECT password_hash FROM users WHERE email = ?').bind(EMAIL).first();
    assert.equal(user.password_hash, legacyHash);
  }
});

test('verification code resend, expiry, attempt limits and purpose isolation', async () => {
  const app = await createTestApp();
  const first = await app.call('/api/v1/auth/register/request-code', {method: 'POST', body: {email: EMAIL}});
  assert.equal(first.status, 200);
  const firstCode = app.lastCode();
  const resendTooSoon = await app.call('/api/v1/auth/register/request-code', {method: 'POST', body: {email: EMAIL}});
  assert.equal(resendTooSoon.status, 429);
  assert.ok(resendTooSoon.data.error.retryAfter >= 1);

  app.advance(61 * 1000);
  const second = await app.call('/api/v1/auth/register/request-code', {method: 'POST', body: {email: EMAIL}});
  assert.equal(second.status, 200);
  const secondCode = app.lastCode();
  assert.notEqual(firstCode, secondCode);
  const oldCode = await app.call('/api/v1/auth/register', {
    method: 'POST', body: {email: EMAIL, nickname: '雪乃测试', password: PASSWORD, code: firstCode, challengeId: first.data.challengeId, client: 'desktop'},
  });
  assert.equal(oldCode.status, 400, 'resend invalidates the older challenge');

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const wrong = await app.call('/api/v1/auth/register', {
      method: 'POST', body: {email: EMAIL, nickname: '雪乃测试', password: PASSWORD, code: '000000', challengeId: second.data.challengeId, client: 'desktop'},
    });
    assert.equal(wrong.status, 400);
  }
  const locked = await app.call('/api/v1/auth/register', {
    method: 'POST', body: {email: EMAIL, nickname: '雪乃测试', password: PASSWORD, code: secondCode, challengeId: second.data.challengeId, client: 'desktop'},
  });
  assert.equal(locked.status, 429);

  app.advance(61 * 1000);
  const third = await app.call('/api/v1/auth/register/request-code', {method: 'POST', body: {email: EMAIL}});
  app.advance(11 * 60 * 1000);
  const expired = await app.call('/api/v1/auth/register', {
    method: 'POST', body: {email: EMAIL, nickname: '雪乃测试', password: PASSWORD, code: app.lastCode(), challengeId: third.data.challengeId, client: 'desktop'},
  });
  assert.equal(expired.status, 400);
  assert.equal(expired.data.error.code, 'challenge_expired');
});

test('CORS and Origin checks reject unknown sites and never use a wildcard', async () => {
  const app = await createTestApp();
  const blocked = await app.call('/api/v1/health', {headers: {origin: 'https://evil.example'}});
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.error.code, 'origin_denied');
  const allowed = await app.call('/api/v1/health', {headers: {origin: 'http://127.0.0.1:8787'}});
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://127.0.0.1:8787');
  assert.equal(allowed.headers.get('access-control-allow-credentials'), 'true');
  assert.notEqual(allowed.headers.get('access-control-allow-origin'), '*');
  const preflight = await app.call('/api/v1/auth/login', {method: 'OPTIONS', headers: {origin: 'https://evil.example', 'access-control-request-method': 'POST'}});
  assert.equal(preflight.status, 403);
});

test('SQL-injection-shaped input is rejected without damaging the database', async () => {
  const app = await createTestApp();
  const response = await app.call('/api/v1/auth/login', {
    method: 'POST', body: {email: "x' OR 1=1 --@example.com", password: "' OR '1'='1"},
  });
  assert.equal(response.status, 400);
  const health = await app.call('/api/v1/health');
  assert.equal(health.status, 200);
  const count = await app.db.prepare('SELECT COUNT(*) AS total FROM users').first();
  assert.equal(Number(count.total), 0);
});

test('auth responses are no-store and carry anti-framing/nosniff headers', async () => {
  const app = await createTestApp();
  const response = await app.call('/api/v1/health');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');

  const missing = await app.call('/api/v1/does-not-exist', {headers: {origin: 'http://127.0.0.1:8787'}});
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get('x-frame-options'), 'DENY');
  assert.equal(missing.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(missing.headers.get('access-control-allow-origin'), 'http://127.0.0.1:8787');
  assert.equal(missing.headers.get('access-control-allow-credentials'), 'true');
});

test('large request bodies are rejected before JSON parsing', async () => {
  const app = await createTestApp();
  const response = await app.call('/api/v1/auth/login', {
    method: 'POST', body: {email: EMAIL, nickname: '雪乃测试', password: 'x'.repeat(100000)},
  });
  assert.equal(response.status, 413);
});

test('a failed mail provider never reports a successful code send', async () => {
  const app = await createTestApp({
    env: {
      APP_ENV: 'test',
      MAIL_PROVIDER: 'none',
    },
  });
  const response = await app.call('/api/v1/auth/register/request-code', {method: 'POST', body: {email: EMAIL}});
  assert.equal(response.status, 503);
  assert.equal(response.data.error.code, 'mail_not_configured');
});
