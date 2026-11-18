import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/backend-worker.js';

function fakeDb() {
  const statements = [];
  const batches = [];
  return {
    statements, batches,
    prepare(sql) {
      statements.push(sql);
      return {bind() {return this;}, async first() {return {ok: 1};}, async all() {return {results: []};}};
    },
    async batch(items) {batches.push(items); return [];},
  };
}

test('backend-only Worker preserves the existing placeholder and routes API requests', async () => {
  const db = fakeDb();
  const env = {DB: db, APP_ENV: 'production', MAIL_PROVIDER: 'gmail'};
  for (const path of ['/', '/login', '/assets/icon-192.png']) {
    const response = await worker.fetch(new Request(`https://example.test${path}`), env, {});
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/plain/);
    assert.equal(await response.text(), 'Hello World!');
  }
  const health = await worker.fetch(new Request('https://example.test/api/v1/health'), env, {});
  assert.equal(health.status, 200);
  assert.equal((await health.json()).database, 'ok');
  const missing = await worker.fetch(new Request('https://example.test/api/v1/not-real'), env, {});
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get('content-type'), /^application\/json/);
});

test('backend-only Worker delegates scheduled maintenance', async () => {
  const db = fakeDb();
  let work;
  worker.scheduled({}, {DB: db, MAIL_PROVIDER: 'gmail'}, {waitUntil(promise) {work = promise;}});
  assert.ok(work instanceof Promise);
  await work;
  assert.equal(db.batches.length, 1);
  assert.equal(db.batches[0].length, 6);
  assert.ok(db.statements.some((sql) => sql.includes('mail_outbox')));
});
