import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestApp} from './helpers.mjs';
import {verifySnapshot} from '../src/entitlement.js';

const EMAIL = 'progress@example.com';
const PASSWORD = 'Correct-Horse-Battery-123!';

test('check-in counts once per Asia/Shanghai business day and awards server-side progress', async () => {
  const app = await createTestApp();
  app.setNow(Date.parse('2026-11-17T15:59:00.000Z')); // 23:59 in Shanghai
  const user = await app.register(EMAIL, PASSWORD);
  const first = await app.call('/api/v1/progress/check-in', {method: 'POST', token: user.accessToken});
  assert.equal(first.status, 200);
  assert.equal(first.data.counted, true);
  assert.equal(first.data.loginDays, 1);
  assert.equal(first.data.affection, 37);
  assert.equal(first.data.businessDate, '2026-11-17');

  const again = await app.call('/api/v1/progress/check-in', {method: 'POST', token: user.accessToken});
  assert.equal(again.data.counted, false);
  assert.equal(again.data.loginDays, 1);
  assert.equal(again.data.affection, 37);

  app.advance(2 * 60 * 1000); // 00:01 next day in Shanghai
  const nextDay = await app.call('/api/v1/progress/check-in', {method: 'POST', token: user.accessToken});
  assert.equal(nextDay.data.counted, true);
  assert.equal(nextDay.data.businessDate, '2026-11-18');
  assert.equal(nextDay.data.loginDays, 2);
  assert.equal(nextDay.data.affection, 39);
});

test('concurrent check-ins from two devices still count one day', async () => {
  const app = await createTestApp();
  const user = await app.register(EMAIL, PASSWORD);
  const [a, b] = await Promise.all([
    app.call('/api/v1/progress/check-in', {method: 'POST', token: user.accessToken}),
    app.call('/api/v1/progress/check-in', {method: 'POST', token: user.accessToken}),
  ]);
  assert.equal([a.data.counted, b.data.counted].filter(Boolean).length, 1);
  const progress = await app.call('/api/v1/progress', {token: user.accessToken});
  assert.equal(progress.data.loginDays, 1);
  assert.equal(progress.data.affection, 37);
});

test('events are idempotent, capped per type and globally, and ignore client reward values', async () => {
  const app = await createTestApp();
  const user = await app.register(EMAIL, PASSWORD);
  const events = Array.from({length: 10}, (_, index) => ({
    eventId: `message-event-${index}`,
    type: 'message',
    affection: 9999,
    loginDays: 9999,
  }));
  const submitted = await app.call('/api/v1/progress/events', {method: 'POST', token: user.accessToken, body: {events, affection: 100, loginDays: 999}});
  assert.equal(submitted.status, 200);
  assert.equal(submitted.data.outcomes.filter((item) => item.status === 'accepted').length, 8);
  assert.equal(submitted.data.outcomes.filter((item) => item.status === 'capped').length, 2);
  assert.equal(submitted.data.affection, 43);
  assert.equal(submitted.data.loginDays, 0);

  const replay = await app.call('/api/v1/progress/events', {method: 'POST', token: user.accessToken, body: {events: [{eventId: 'message-event-0', type: 'message'}]}});
  assert.equal(replay.data.outcomes[0].status, 'duplicate');
  assert.equal(replay.data.affection, 43);

  const pet = await app.call('/api/v1/progress/events', {
    method: 'POST', token: user.accessToken,
    body: {events: Array.from({length: 6}, (_, index) => ({eventId: `pet-event-${index}`, type: 'pet-interaction'}))},
  });
  assert.equal(pet.data.affection, 47); // global cap 12: 8 message + 4 pet
  assert.equal(pet.data.outcomes.filter((item) => item.status === 'accepted').length, 4);
});

test('unknown event types and forged identity are rejected', async () => {
  const app = await createTestApp();
  const user = await app.register(EMAIL, PASSWORD);
  const bad = await app.call('/api/v1/progress/events', {
    method: 'POST', token: user.accessToken,
    body: {events: [{eventId: 'evil-event-001', type: 'admin-grant', amount: 1000}], userId: 'someone-else'},
  });
  assert.equal(bad.status, 200);
  assert.equal(bad.data.outcomes[0].status, 'rejected');
  const noAuth = await app.call('/api/v1/progress/events', {method: 'POST', body: {events: []}});
  assert.equal(noAuth.status, 401);
});

test('permanent skins unlock by server login days and affection, and the snapshot verifies', async () => {
  const app = await createTestApp();
  const user = await app.register(EMAIL, PASSWORD);
  let refreshToken = user.refreshToken;
  let accessToken = user.accessToken;
  for (let day = 0; day < 7; day += 1) {
    await app.call('/api/v1/progress/check-in', {method: 'POST', token: accessToken});
    app.advance(24 * 60 * 60 * 1000);
    const refreshed = await app.call('/api/v1/auth/refresh', {method: 'POST', body: {refreshToken, client: 'desktop'}});
    assert.equal(refreshed.status, 200);
    refreshToken = refreshed.data.refreshToken;
    accessToken = refreshed.data.accessToken;
  }
  const progress = await app.call('/api/v1/progress', {token: accessToken});
  assert.equal(progress.data.loginDays, 7);
  assert.ok(progress.data.skins.find((skin) => skin.id === 'summer-uniform-v2').unlocked);
  assert.ok(progress.data.skins.find((skin) => skin.id === 'winter-uniform-v2').unlocked);
  assert.ok(progress.data.skins.find((skin) => skin.id === 'swimsuit-v2').unlocked);
  assert.ok(progress.data.skins.find((skin) => skin.id === 'twin-tail-v2').unlocked);
  assert.equal(progress.data.entitlement.alg, 'ES256');
  const valid = await verifySnapshot(progress.data.entitlement, JSON.parse(app.env.SNAPSHOT_PUBLIC_JWK));
  assert.equal(valid, true);
  const tampered = JSON.parse(JSON.stringify(progress.data.entitlement));
  tampered.snapshot.affection = 100;
  const invalid = await verifySnapshot(tampered, JSON.parse(app.env.SNAPSHOT_PUBLIC_JWK));
  assert.equal(invalid, false);

  const skins = await app.call('/api/v1/skins', {token: accessToken});
  assert.equal(skins.status, 200);
  assert.ok(skins.data.skins.find((skin) => skin.id === 'beret-v2').unlocked);
});

test('day 2 and day 3 logins unlock their outfits, and legacy confirmed rows keep mapped V2 rights', async () => {
  const app = await createTestApp();
  app.setNow(Date.parse('2026-11-17T15:59:00.000Z')); // 23:59 in Shanghai
  const user = await app.register(EMAIL, PASSWORD);
  const day = 24 * 60 * 60 * 1000;
  const first = await app.call('/api/v1/progress/check-in', {method: 'POST', token: user.accessToken});
  assert.equal(first.data.loginDays, 1);
  assert.equal(first.data.skins.find((skin) => skin.id === 'swimsuit-v2').unlocked, false);
  assert.equal(first.data.skins.find((skin) => skin.id === 'twin-tail-v2').unlocked, false);

  app.advance(2 * 60 * 1000); // 00:01 on the next Shanghai day
  const second = await app.call('/api/v1/progress/check-in', {method: 'POST', token: user.accessToken});
  assert.equal(second.data.loginDays, 2);
  assert.equal(second.data.skins.find((skin) => skin.id === 'swimsuit-v2').unlocked, true);
  assert.equal(second.data.skins.find((skin) => skin.id === 'twin-tail-v2').unlocked, false);

  app.advance(day);
  const refreshed = await app.call('/api/v1/auth/refresh', {method: 'POST', body: {refreshToken: user.refreshToken, client: 'desktop'}});
  assert.equal(refreshed.status, 200);
  const third = await app.call('/api/v1/progress/check-in', {method: 'POST', token: refreshed.data.accessToken});
  assert.equal(third.data.loginDays, 3);
  assert.equal(third.data.skins.find((skin) => skin.id === 'twin-tail-v2').unlocked, true);

  // Simulate a row written by the previous V1 catalogue. It must stay in the
  // database and grant the matching V2 outfit, without being deleted.
  await app.db.prepare(`INSERT INTO skin_unlocks(user_id, skin_id, reason, rules_version, unlocked_at)
    VALUES(?,?,?,?,?)`).bind(user.user.id, 'yukino-04-v1', 'server-confirmed', '2026-11-17.1', app.now()).run();
  const progress = await app.call('/api/v1/progress', {token: refreshed.data.accessToken});
  assert.equal(progress.data.skins.find((skin) => skin.id === 'kimono-v2').unlocked, true);
  const persisted = await app.db.prepare('SELECT skin_id FROM skin_unlocks WHERE user_id = ? AND skin_id = ?').bind(user.user.id, 'yukino-04-v1').first();
  assert.equal(persisted.skin_id, 'yukino-04-v1');
  assert.ok(progress.data.entitlement.snapshot.skinIds.includes('kimono-v2'));
});

test('health exposes no secrets and production refuses the local mailer', async () => {
  const app = await createTestApp();
  const health = await app.call('/api/v1/health');
  assert.equal(health.status, 200);
  const text = JSON.stringify(health.data);
  assert.doesNotMatch(text, /secret|token|jwk|gmail/i);
  assert.equal(health.data.mail, 'configured');

  const {createApi} = await import('../src/app.js');
  assert.throws(() => createApi({
    env: {APP_ENV: 'production', MAIL_PROVIDER: 'local', ACCESS_TOKEN_SECRET: 'x'.repeat(40)},
    db: app.db,
  }), /生产环境拒绝/);
});
