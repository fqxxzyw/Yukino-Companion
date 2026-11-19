import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestApp} from './helpers.mjs';

const PASSWORD = 'Nickname-Test-123!';

async function request(app, email) {
  const response = await app.call('/api/v1/auth/register/request-code', {method: 'POST', body: {email}});
  assert.equal(response.status, 200);
  return {challengeId: response.data.challengeId, code: app.lastCode()};
}

test('registration requires a nickname and rejects duplicates across case, spaces and NFKC', async () => {
  const app = await createTestApp();
  const first = await request(app, 'first@example.com');
  const missing = await app.call('/api/v1/auth/register', {
    method: 'POST',
    body: {email: 'first@example.com', password: PASSWORD, code: first.code, challengeId: first.challengeId, client: 'desktop'},
  });
  assert.equal(missing.status, 400);
  assert.equal(missing.data.error.code, 'invalid_nickname');

  const created = await app.call('/api/v1/auth/register', {
    method: 'POST',
    body: {email: 'first@example.com', nickname: '雪乃', password: PASSWORD, code: first.code, challengeId: first.challengeId, client: 'desktop'},
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.user.nickname, '雪乃');

  const assertReserved = async (email, nickname) => {
    const second = await request(app, email);
    const result = await app.call('/api/v1/auth/register', {
      method: 'POST',
      body: {email, nickname, password: PASSWORD, code: second.code, challengeId: second.challengeId, client: 'desktop'},
    });
    assert.equal(result.status, 409, `${nickname} should be reserved`);
    assert.equal(result.data.error.code, 'nickname_unavailable');
    assert.equal(result.data.error.message, '昵称不可用，请换一个。');
  };
  await assertReserved('space-case@example.com', ' 雪乃 ');
  const latin = await request(app, 'latin@example.com');
  const latinCreated = await app.call('/api/v1/auth/register', {
    method: 'POST',
    body: {email: 'latin@example.com', nickname: 'Yukino', password: PASSWORD, code: latin.code, challengeId: latin.challengeId, client: 'desktop'},
  });
  assert.equal(latinCreated.status, 201);
  await assertReserved('full-width@example.com', 'Ｙｕｋｉｎｏ');
  await assertReserved('lower-case@example.com', ' yukino ');

  const me = await app.call('/api/v1/me', {token: created.data.accessToken});
  assert.equal(me.status, 200);
  assert.equal(me.data.user.nickname, '雪乃');
});

test('an existing account without a nickname can set one from the account center', async () => {
  const app = await createTestApp();
  const user = await app.register('legacy@example.com', PASSWORD, {nickname: '临时昵称'});
  await app.db.prepare('UPDATE users SET nickname = NULL, nickname_key = NULL WHERE email = ?').bind(user.email).run();
  const before = await app.call('/api/v1/me', {token: user.accessToken});
  assert.equal(before.data.user.nickname, '');

  const updated = await app.call('/api/v1/me', {
    method: 'PATCH', token: user.accessToken, body: {nickname: '  新的 昵称  '},
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.user.nickname, '新的 昵称');
  const after = await app.call('/api/v1/me', {token: user.accessToken});
  assert.equal(after.data.user.nickname, '新的 昵称');
});

test('concurrent registrations cannot claim the same nickname', async () => {
  const app = await createTestApp();
  const a = await request(app, 'race-a@example.com');
  const b = await request(app, 'race-b@example.com');
  const [one, two] = await Promise.all([
    app.call('/api/v1/auth/register', {method: 'POST', body: {email: 'race-a@example.com', nickname: 'Same-Name', password: PASSWORD, code: a.code, challengeId: a.challengeId, client: 'desktop'}}),
    app.call('/api/v1/auth/register', {method: 'POST', body: {email: 'race-b@example.com', nickname: ' same-name ', password: PASSWORD, code: b.code, challengeId: b.challengeId, client: 'desktop'}}),
  ]);
  assert.deepEqual([one.status, two.status].sort(), [201, 409]);
  const failed = one.status === 409 ? one : two;
  assert.equal(failed.data.error.code, 'nickname_unavailable');
});
