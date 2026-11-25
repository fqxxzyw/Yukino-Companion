import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/backend-worker.js';

function fakeDb(pending = []) {
  const statements = [];
  const batches = [];
  const updates = [];
  return {
    statements, batches, updates,
    prepare(sql) {
      statements.push(sql);
      return {
        bind(...args) { this.args = args; return this; },
        async first() { return {ok: 1}; },
        async all() { return {results: pending}; },
        async run() { updates.push({sql, args: this.args}); },
      };
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

test('scheduled mail retries restore security notice HTML and preserve stored copy', async (t) => {
  const pending = [
    {id: 1, kind: 'notice-password-changed', recipient: 'alice@example.com', subject: 'Stored change subject', text_body: 'Stored change body'},
    {id: 2, kind: 'notice-password-reset', recipient: 'alice@example.com', subject: 'Stored reset subject', text_body: 'Stored reset body'},
    {id: 3, kind: 'legacy', recipient: 'alice@example.com', subject: 'Stored legacy subject', text_body: 'Stored legacy body'},
  ];
  const db = fakeDb(pending);
  const messages = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({access_token: 'synthetic-access', expires_in: 3600});
    assert.equal(url, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
    messages.push(Buffer.from(JSON.parse(init.body).raw, 'base64url').toString('utf8'));
    return Response.json({id: 'synthetic-id'});
  });
  const env = {
    DB: db,
    APP_ENV: 'test',
    MAIL_PROVIDER: 'gmail',
    GMAIL_CLIENT_ID: 'scheduled-retry-test',
    GMAIL_CLIENT_SECRET: 'synthetic',
    GMAIL_REFRESH_TOKEN: 'synthetic',
  };
  let work;
  worker.scheduled({}, env, {waitUntil(promise) {work = promise;}});
  await work;

  assert.equal(messages.length, pending.length);
  const decodePart = (message, type) => {
    const match = message.match(new RegExp(`Content-Type: text/${type}; charset="UTF-8"\\r\\nContent-Transfer-Encoding: base64\\r\\n\\r\\n([A-Za-z0-9+/=\\r\\n]+)`));
    assert.ok(match, `${type} MIME part`);
    return Buffer.from(match[1], 'base64').toString('utf8');
  };
  for (const [index, row] of pending.entries()) {
    assert.ok(messages[index].includes(`Subject: =?UTF-8?B?${Buffer.from(row.subject).toString('base64')}?=`));
    assert.equal(decodePart(messages[index], 'plain'), row.text_body);
  }
  const changedHtml = decodePart(messages[0], 'html');
  const resetHtml = decodePart(messages[1], 'html');
  assert.match(changedHtml, /密码已修改/);
  assert.match(resetHtml, /密码已重置/);
  for (const html of [changedHtml, resetHtml]) {
    assert.match(html, /<img\b/);
    assert.ok(html.includes('al***@example.com'));
  }
  assert.match(decodePart(messages[2], 'html'), />Stored legacy body<\/pre>/);
  assert.deepEqual(db.updates.map(({args}) => [args[0], args[2]]), [['sent', 1], ['sent', 2], ['sent', 3]]);
});
