import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestApp, cookieHeader} from './helpers.mjs';

const EMAIL = 'yukino@example.com';
const PASSWORD = 'Correct-Horse-Battery-123!';

test('registration sends a bound code, consumes it once and auto-creates a session', async () => {
  const app = await createTestApp();
  const requested = await app.call('/api/v1/auth/register/request-code', {method: 'POST', body: {email: EMAIL, client: 'desktop'}});
  assert.equal(requested.status, 200);
  assert.equal(requested.data.delivery, 'accepted-by-provider');
  const code = app.lastCode();
  assert.match(code, /^\d{6}$/);

  const wrong = await app.call('/api/v1/auth/register', {
    method: 'POST', body: {email: EMAIL, nickname: '雪乃测试', password: PASSWORD, code: code === '000000' ? '111111' : '000000', challengeId: requested.data.challengeId, client: 'desktop'},
  });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.data.error.code, 'invalid_code');

  const created = await app.call('/api/v1/auth/register', {
    method: 'POST', body: {email: EMAIL, nickname: '雪乃测试', password: PASSWORD, code, challengeId: requested.data.challengeId, client: 'desktop'},
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.autoLogin, true);
  assert.ok(created.data.accessToken);
  assert.ok(created.data.refreshToken);
  assert.equal(created.data.user.email, 'yu****@example.com');

  const me = await app.call('/api/v1/me', {token: created.data.accessToken});
  assert.equal(me.status, 200);
  assert.equal(me.data.user.emailHint, EMAIL);

  // The consumed challenge cannot be replayed.
  const replay = await app.call('/api/v1/auth/register', {
    method: 'POST', body: {email: EMAIL, nickname: '雪乃测试', password: PASSWORD, code, challengeId: requested.data.challengeId, client: 'desktop'},
  });
  assert.ok([400, 409].includes(replay.status));
});

test('duplicate registration and concurrent registration cannot create two accounts', async () => {
  const app = await createTestApp();
  const first = await app.register(EMAIL, PASSWORD);
  app.advance(61000);
  const secondRequest = await app.call('/api/v1/auth/register/request-code', {method: 'POST', body: {email: EMAIL}});
  assert.equal(secondRequest.status, 200);
  const secondCode = app.lastCode();
  const duplicate = await app.call('/api/v1/auth/register', {
    method: 'POST', body: {email: EMAIL, nickname: '雪乃测试', password: 'Another-Long-Password-456!', code: secondCode, challengeId: secondRequest.data.challengeId, client: 'desktop'},
  });
  assert.ok([400, 409].includes(duplicate.status));
  const count = await app.db.prepare('SELECT COUNT(*) AS total FROM users').first();
  assert.equal(Number(count.total), 1);

  const parallelApp = await createTestApp();
  const requests = await Promise.all([1, 2].map(async () => {
    const requested = await parallelApp.call('/api/v1/auth/register/request-code', {method: 'POST', body: {email: 'race@example.com'}});
    const code = [...parallelApp.mailbox].reverse().map((item) => /验证码：(\d{6})/.exec(item.text)?.[1]).find(Boolean);
    return {requested, code};
  }));
  const results = await Promise.all(requests.map(({requested, code}) => parallelApp.call('/api/v1/auth/register', {
    method: 'POST', body: {email: 'race@example.com', nickname: '并发测试', password: PASSWORD, code, challengeId: requested.data.challengeId, client: 'desktop'},
  })));
  assert.equal(results.filter((result) => result.status === 201).length, 1);
  assert.ok(results.filter((result) => result.status !== 201).every((result) => [400, 409].includes(result.status)));
  void first;
});

test('login is generic for wrong email/password and succeeds with correct credentials', async () => {
  const app = await createTestApp();
  await app.register(EMAIL, PASSWORD);
  const missing = await app.call('/api/v1/auth/login', {method: 'POST', body: {email: 'nobody@example.com', password: PASSWORD}});
  const wrong = await app.call('/api/v1/auth/login', {method: 'POST', body: {email: EMAIL, nickname: '雪乃测试', password: 'wrong password long enough'}});
  assert.equal(missing.status, 401);
  assert.equal(wrong.status, 401);
  assert.equal(missing.data.error.message, wrong.data.error.message);
  const ok = await app.call('/api/v1/auth/login', {method: 'POST', body: {email: EMAIL, nickname: '雪乃测试', password: PASSWORD, client: 'desktop'}});
  assert.equal(ok.status, 200);
  assert.ok(ok.data.refreshToken);
});

test('desktop refresh rotates, allows a short concurrent grace window, then detects reuse', async () => {
  const app = await createTestApp();
  const user = await app.register(EMAIL, PASSWORD);
  const first = await app.call('/api/v1/auth/refresh', {method: 'POST', body: {refreshToken: user.refreshToken, client: 'desktop'}});
  assert.equal(first.status, 200);
  assert.notEqual(first.data.refreshToken, user.refreshToken);

  const grace = await app.call('/api/v1/auth/refresh', {method: 'POST', body: {refreshToken: user.refreshToken, client: 'desktop'}});
  assert.equal(grace.status, 409);
  assert.equal(grace.data.error.code, 'refresh_in_progress');
  const retry = await app.call('/api/v1/auth/refresh', {method: 'POST', body: {refreshToken: first.data.refreshToken, client: 'desktop'}});
  assert.equal(retry.status, 200);

  app.advance(60 * 1000);
  const reuse = await app.call('/api/v1/auth/refresh', {method: 'POST', body: {refreshToken: first.data.refreshToken, client: 'desktop'}});
  assert.equal(reuse.status, 401);
  const familyDead = await app.call('/api/v1/auth/refresh', {method: 'POST', body: {refreshToken: retry.data.refreshToken, client: 'desktop'}});
  assert.equal(familyDead.status, 401);
});

test('web session uses HttpOnly cookie and never returns the refresh token in JSON', async () => {
  const app = await createTestApp();
  const requested = await app.call('/api/v1/auth/register/request-code', {method: 'POST', body: {email: EMAIL, client: 'web'}});
  const code = app.lastCode();
  const created = await app.call('/api/v1/auth/register', {
    method: 'POST', body: {email: EMAIL, nickname: '雪乃测试', password: PASSWORD, code, challengeId: requested.data.challengeId, client: 'web'},
    headers: {origin: 'http://127.0.0.1:8787'},
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.refreshToken, undefined);
  const setCookie = created.headers.get('set-cookie') || '';
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.doesNotMatch(setCookie, /Secure/); // local HTTP development
  const refreshed = await app.call('/api/v1/auth/refresh', {
    method: 'POST', body: {client: 'web'}, cookie: cookieHeader(setCookie), headers: {origin: 'http://127.0.0.1:8787'},
  });
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.data.refreshToken, undefined);
});

test('password change revokes other sessions and immediately invalidates old access tokens', async () => {
  const app = await createTestApp();
  const user = await app.register(EMAIL, PASSWORD);
  const second = await app.call('/api/v1/auth/login', {method: 'POST', body: {email: EMAIL, nickname: '雪乃测试', password: PASSWORD, client: 'desktop'}});
  assert.equal(second.status, 200);

  const changed = await app.call('/api/v1/auth/password/change', {
    method: 'POST', token: user.accessToken,
    body: {currentPassword: PASSWORD, newPassword: 'A-Brand-New-Passphrase-987!'},
  });
  assert.equal(changed.status, 200);
  assert.ok(changed.data.accessToken);
  assert.equal(changed.data.otherSessionsRevoked, true);

  const oldAccess = await app.call('/api/v1/me', {token: user.accessToken});
  assert.equal(oldAccess.status, 401);
  const secondAccess = await app.call('/api/v1/me', {token: second.data.accessToken});
  assert.equal(secondAccess.status, 401);
  const newAccess = await app.call('/api/v1/me', {token: changed.data.accessToken});
  assert.equal(newAccess.status, 200);
  const oldLogin = await app.call('/api/v1/auth/login', {method: 'POST', body: {email: EMAIL, nickname: '雪乃测试', password: PASSWORD}});
  assert.equal(oldLogin.status, 401);
  const newLogin = await app.call('/api/v1/auth/login', {method: 'POST', body: {email: EMAIL, nickname: '雪乃测试', password: 'A-Brand-New-Passphrase-987!'}});
  assert.equal(newLogin.status, 200);
  assert.ok(app.mailbox.some((message) => /密码已修改/.test(message.subject)));
});

test('a stale login cannot create a refresh session after a password reset', async () => {
  const app = await createTestApp();
  await app.register(EMAIL, PASSWORD);
  const requested = await app.call('/api/v1/auth/password/forgot', {method: 'POST', body: {email: EMAIL}});
  const verified = await app.call('/api/v1/auth/password/verify-reset', {
    method: 'POST', body: {email: EMAIL, code: app.lastCode(), challengeId: requested.data.challengeId},
  });
  assert.equal(verified.status, 200);
  let signalReached, release;
  const reached = new Promise((resolve) => { signalReached = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const originalPrepare = app.db.prepare.bind(app.db);
  app.db.prepare = (sql) => {
    const statement = originalPrepare(sql);
    if (/INSERT INTO sessions/i.test(sql) && /SELECT 1 FROM users/i.test(sql)) {
      const originalRun = statement.run.bind(statement);
      statement.run = async () => { signalReached(); await gate; return originalRun(); };
    }
    return statement;
  };
  const staleLogin = app.call('/api/v1/auth/login', {method: 'POST', body: {email: EMAIL, nickname: '雪乃测试', password: PASSWORD, client: 'desktop'}});
  await reached;
  const reset = await app.call('/api/v1/auth/password/reset', {
    method: 'POST', body: {resetToken: verified.data.resetToken, newPassword: 'Reset-Password-Winner-123!'},
  });
  assert.equal(reset.status, 200);
  release();
  assert.equal((await staleLogin).status, 401);
  app.db.prepare = originalPrepare;
  const active = await app.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE revoked_at IS NULL').first();
  assert.equal(active.n, 0);
  assert.equal((await app.call('/api/v1/auth/login', {method: 'POST', body: {email: EMAIL, nickname: '雪乃测试', password: 'Reset-Password-Winner-123!'}})).status, 200);
});

test('a stale password change cannot overwrite a completed reset or create a session', async () => {
  const app = await createTestApp();
  const original = await app.register(EMAIL, PASSWORD);
  const requested = await app.call('/api/v1/auth/password/forgot', {method: 'POST', body: {email: EMAIL}});
  const verified = await app.call('/api/v1/auth/password/verify-reset', {
    method: 'POST', body: {email: EMAIL, code: app.lastCode(), challengeId: requested.data.challengeId},
  });
  assert.equal(verified.status, 200);
  let signalReached, release;
  const reached = new Promise((resolve) => { signalReached = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const originalBatch = app.db.batch.bind(app.db);
  app.db.batch = async (statements) => {
    if (statements.some((statement) => /UPDATE users SET password_hash/i.test(statement.sql) && /idle_expires_at/i.test(statement.sql))) {
      signalReached();
      await gate;
    }
    return originalBatch(statements);
  };
  const staleChange = app.call('/api/v1/auth/password/change', {
    method: 'POST', token: original.accessToken, body: {currentPassword: PASSWORD, newPassword: 'Stale-Password-Loser-123!'},
  });
  await reached;
  const reset = await app.call('/api/v1/auth/password/reset', {
    method: 'POST', body: {resetToken: verified.data.resetToken, newPassword: 'Reset-Password-Winner-123!'},
  });
  assert.equal(reset.status, 200);
  release();
  assert.equal((await staleChange).status, 401);
  app.db.batch = originalBatch;
  const active = await app.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE revoked_at IS NULL').first();
  assert.equal(active.n, 0);
  assert.equal(app.mailbox.filter((message) => /密码已修改/.test(message.subject)).length, 0);
  assert.equal((await app.call('/api/v1/auth/login', {method: 'POST', body: {email: EMAIL, nickname: '雪乃测试', password: 'Stale-Password-Loser-123!'}})).status, 401);
  assert.equal((await app.call('/api/v1/auth/login', {method: 'POST', body: {email: EMAIL, nickname: '雪乃测试', password: 'Reset-Password-Winner-123!'}})).status, 200);
});

test('forgot-password uses a separate purpose, one-time reset token and revokes sessions', async () => {
  const app = await createTestApp();
  const user = await app.register(EMAIL, PASSWORD);
  app.advance(61000);
  const registerChallenge = await app.call('/api/v1/auth/register/request-code', {method: 'POST', body: {email: EMAIL}});
  const registerCode = app.lastCode();

  const requested = await app.call('/api/v1/auth/password/forgot', {method: 'POST', body: {email: EMAIL}});
  assert.equal(requested.status, 200);
  const resetCode = app.lastCode();
  const misuse = await app.call('/api/v1/auth/password/verify-reset', {
    method: 'POST', body: {email: EMAIL, code: registerCode, challengeId: requested.data.challengeId},
  });
  assert.equal(misuse.status, 400);
  assert.ok(registerChallenge.data.challengeId);

  const verified = await app.call('/api/v1/auth/password/verify-reset', {
    method: 'POST', body: {email: EMAIL, code: resetCode, challengeId: requested.data.challengeId},
  });
  assert.equal(verified.status, 200);
  assert.ok(verified.data.resetToken);

  const reset = await app.call('/api/v1/auth/password/reset', {
    method: 'POST', body: {resetToken: verified.data.resetToken, newPassword: 'Reset-Passphrase-456!'},
  });
  assert.equal(reset.status, 200);
  assert.equal(reset.data.loginRequired, true);
  const replay = await app.call('/api/v1/auth/password/reset', {
    method: 'POST', body: {resetToken: verified.data.resetToken, newPassword: 'Reset-Passphrase-789!'},
  });
  assert.equal(replay.status, 400);
  const oldAccess = await app.call('/api/v1/me', {token: user.accessToken});
  assert.equal(oldAccess.status, 401);
  const login = await app.call('/api/v1/auth/login', {method: 'POST', body: {email: EMAIL, nickname: '雪乃测试', password: 'Reset-Passphrase-456!'}});
  assert.equal(login.status, 200);
  assert.ok(app.mailbox.some((message) => /密码已重置/.test(message.subject)));
});

test('concurrent uses of a reset token change the password only once', async () => {
  const app = await createTestApp();
  const original = await app.register(EMAIL, PASSWORD);
  const requested = await app.call('/api/v1/auth/password/forgot', {method: 'POST', body: {email: EMAIL}});
  const verified = await app.call('/api/v1/auth/password/verify-reset', {
    method: 'POST', body: {email: EMAIL, code: app.lastCode(), challengeId: requested.data.challengeId},
  });
  assert.equal(verified.status, 200);

  // Hold both requests after they have read the live token and derived their
  // hashes. Serialize their batches as D1 transactions, without relying on
  // timing or the local adapter's lack of concurrent transaction support.
  const originalBatch = app.db.batch.bind(app.db);
  let arrived = 0;
  let release;
  const ready = new Promise((resolve) => { release = resolve; });
  let previous = Promise.resolve();
  app.db.batch = async (statements) => {
    if (!statements.some((statement) => /UPDATE users SET password_hash/.test(statement.sql))) return originalBatch(statements);
    arrived += 1;
    if (arrived === 2) release();
    await ready;
    const batch = previous.then(() => originalBatch(statements));
    previous = batch.catch(() => {});
    return batch;
  };

  const passwords = ['First-Replacement-123!', 'Second-Replacement-456!'];
  const results = await Promise.all(passwords.map((newPassword) => app.call('/api/v1/auth/password/reset', {
    method: 'POST', body: {resetToken: verified.data.resetToken, newPassword},
  })));
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 400]);
  assert.equal(results.find((result) => result.status === 400).data.error.code, 'invalid_reset');
  assert.equal((await app.db.prepare('SELECT security_version FROM users WHERE email = ?').bind(EMAIL).first()).security_version, 2);
  assert.equal((await app.call('/api/v1/me', {token: original.accessToken})).status, 401);
  assert.equal(app.mailbox.filter((message) => /密码已重置/.test(message.subject)).length, 1);

  const winner = passwords[results.findIndex((result) => result.status === 200)];
  const loser = passwords[results.findIndex((result) => result.status === 400)];
  const login = await app.call('/api/v1/auth/login', {method: 'POST', body: {email: EMAIL, nickname: '雪乃测试', password: winner, client: 'desktop'}});
  assert.equal(login.status, 200);
  assert.equal((await app.call('/api/v1/auth/login', {method: 'POST', body: {email: EMAIL, nickname: '雪乃测试', password: loser}})).status, 401);
  const replay = await app.call('/api/v1/auth/password/reset', {
    method: 'POST', body: {resetToken: verified.data.resetToken, newPassword: 'Third-Replacement-789!'},
  });
  assert.equal(replay.status, 400);
  assert.equal((await app.call('/api/v1/me', {token: login.data.accessToken})).status, 200);
});

test('reset request hides whether an account exists and cannot reset an unknown mailbox', async () => {
  const app = await createTestApp();
  await app.register(EMAIL, PASSWORD);
  const known = await app.call('/api/v1/auth/password/forgot', {method: 'POST', body: {email: EMAIL}});
  const unknown = await app.call('/api/v1/auth/password/forgot', {method: 'POST', body: {email: 'ghost@example.com'}});
  assert.equal(known.status, unknown.status);
  assert.equal(known.data.ok, unknown.data.ok);
  assert.equal(typeof known.data.challengeId, 'string');
  assert.equal(typeof unknown.data.challengeId, 'string');
  assert.equal(known.data.expiresIn, unknown.data.expiresIn);
  const code = app.lastCode();
  const verified = await app.call('/api/v1/auth/password/verify-reset', {
    method: 'POST', body: {email: 'ghost@example.com', code, challengeId: unknown.data.challengeId},
  });
  if (verified.status === 200) {
    const reset = await app.call('/api/v1/auth/password/reset', {
      method: 'POST', body: {resetToken: verified.data.resetToken, newPassword: 'Unused-Passphrase-123!'},
    });
    assert.equal(reset.status, 400);
  }
});

test('session listing and revocation are scoped to the authenticated user', async () => {
  const app = await createTestApp();
  const a = await app.register('a@example.com', PASSWORD);
  const b = await app.register('b@example.com', PASSWORD);
  const aList = await app.call('/api/v1/sessions', {token: a.accessToken});
  assert.equal(aList.status, 200);
  assert.ok(aList.data.sessions.some((session) => session.current));
  const bSession = (await app.call('/api/v1/sessions', {token: b.accessToken})).data.sessions.find((session) => session.current);
  const cross = await app.call(`/api/v1/sessions/${bSession.id}`, {method: 'DELETE', token: a.accessToken});
  assert.equal(cross.status, 404);
  const own = aList.data.sessions.find((session) => !session.current);
  assert.equal(own, undefined);
});

test('remember-me off creates a browser-session cookie and keeps the flag across refresh', async () => {
  const app = await createTestApp();
  await app.register(EMAIL, PASSWORD);
  const login = await app.call('/api/v1/auth/login', {
    method: 'POST', headers: {origin: 'http://127.0.0.1:8787'},
    body: {email: EMAIL, nickname: '雪乃测试', password: PASSWORD, remember: false, client: 'web'},
  });
  assert.equal(login.status, 200);
  assert.equal(login.data.persistent, false);
  const cookie = login.headers.get('set-cookie') || '';
  assert.doesNotMatch(cookie, /Max-Age/);
  assert.match(cookie, /HttpOnly/);
  const refreshed = await app.call('/api/v1/auth/refresh', {
    method: 'POST', headers: {origin: 'http://127.0.0.1:8787'},
    body: {client: 'web'}, cookie: cookieHeader(cookie),
  });
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.data.persistent, false);
  assert.doesNotMatch(refreshed.headers.get('set-cookie') || '', /Max-Age/);
});
