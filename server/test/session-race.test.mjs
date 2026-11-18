import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestApp} from './helpers.mjs';

const email = 'session-race@example.com';
const password = 'correct horse battery staple 123';

function isRotation(statements) {
  return statements.some((statement) => /UPDATE sessions SET revoked_at = \?, replaced_by = \?/i.test(statement.sql));
}

test('concurrent refreshes create only the winning successor', async () => {
  const app = await createTestApp();
  const initial = await app.register(email, password);
  const originalBatch = app.db.batch.bind(app.db);
  let arrived = 0;
  let release;
  const bothReady = new Promise((resolve) => {release = resolve;});
  let previous = Promise.resolve();
  app.db.batch = async (statements) => {
    if (!isRotation(statements)) return originalBatch(statements);
    if (++arrived === 2) release();
    await bothReady;
    const batch = previous.then(() => originalBatch(statements));
    previous = batch.catch(() => {});
    return batch;
  };
  const refresh = () => app.call('/api/v1/auth/refresh', {method: 'POST', body: {refreshToken: initial.refreshToken, client: 'desktop'}});
  const results = await Promise.all([refresh(), refresh()]);
  assert.deepEqual(results.map((item) => item.status).sort(), [200, 409]);
  assert.equal(results.find((item) => item.status === 409).data.error.code, 'refresh_in_progress');
  const rows = (await app.db.prepare('SELECT id, parent_id, replaced_by, revoked_at FROM sessions ORDER BY created_at, id').all()).results;
  assert.equal(rows.length, 2, 'failed rotation must not create an unreachable session');
  const root = rows.find((row) => !row.parent_id);
  const successor = rows.find((row) => row.parent_id === root.id);
  assert.ok(root.revoked_at);
  assert.equal(root.replaced_by, successor.id);
  assert.equal(successor.revoked_at, null);
  const winningToken = results.find((item) => item.status === 200).data.refreshToken;
  assert.equal((await app.call('/api/v1/auth/refresh', {method: 'POST', body: {refreshToken: winningToken, client: 'desktop'}})).status, 200);
});

test('a session revoked before rotation commits cannot gain a successor', async () => {
  const app = await createTestApp();
  const initial = await app.register(email, password);
  const originalBatch = app.db.batch.bind(app.db);
  app.db.batch = async (statements) => {
    if (isRotation(statements)) {
      await app.db.prepare('UPDATE sessions SET revoked_at = ? WHERE revoked_at IS NULL').bind(app.now()).run();
    }
    return originalBatch(statements);
  };
  const result = await app.call('/api/v1/auth/refresh', {method: 'POST', body: {refreshToken: initial.refreshToken, client: 'desktop'}});
  assert.equal(result.status, 409);
  const rows = (await app.db.prepare('SELECT revoked_at, replaced_by FROM sessions').all()).results;
  assert.equal(rows.length, 1);
  assert.ok(rows[0].revoked_at);
  assert.equal(rows[0].replaced_by, null);
});

test('a security version changed during refresh prevents rotation', async () => {
  const app = await createTestApp();
  const initial = await app.register(email, password);
  const originalBatch = app.db.batch.bind(app.db);
  app.db.batch = async (statements) => {
    if (isRotation(statements)) {
      await app.db.prepare('UPDATE users SET security_version = security_version + 1 WHERE email = ?').bind(email).run();
    }
    return originalBatch(statements);
  };
  const result = await app.call('/api/v1/auth/refresh', {method: 'POST', body: {refreshToken: initial.refreshToken, client: 'desktop'}});
  assert.equal(result.status, 409);
  const rows = (await app.db.prepare('SELECT revoked_at, replaced_by FROM sessions').all()).results;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].revoked_at, null);
  assert.equal(rows[0].replaced_by, null);
  assert.equal((await app.call('/api/v1/me', {token: initial.accessToken})).status, 401);
});
