import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestApp} from './helpers.mjs';

const PASSWORD = 'Memory-Test-123!';

async function account(app, email, nickname) {
  return app.register(email, PASSWORD, {nickname});
}

test('cloud memory is opt-in, versioned and isolated per authenticated user', async () => {
  const app = await createTestApp();
  const first = await account(app, 'memory-a@example.com', '记忆甲');
  const second = await account(app, 'memory-b@example.com', '记忆乙');
  const auth = {token: first.accessToken};

  const off = await app.call('/api/v1/memory/settings', auth);
  assert.equal(off.status, 200);
  assert.deepEqual(off.data.settings, {syncMemory: false, syncChat: false, updatedAt: 0});
  const disabled = await app.call('/api/v1/memory/yukino', {method: 'PUT', ...auth, body: {text: '喜欢蓝色', baseVersion: 0}});
  assert.equal(disabled.status, 403);
  assert.equal(disabled.data.error.code, 'memory_sync_disabled');

  const enabled = await app.call('/api/v1/memory/settings', {method: 'PUT', ...auth, body: {syncMemory: true}});
  assert.equal(enabled.status, 200);
  assert.equal(enabled.data.settings.syncMemory, true);

  const saved = await app.call('/api/v1/memory/yukino', {method: 'PUT', ...auth, body: {text: '喜欢蓝色，正在学习 NLP。', baseVersion: 0}});
  assert.equal(saved.status, 200);
  assert.equal(saved.data.memory.version, 1);
  assert.equal(saved.data.memory.text, '喜欢蓝色，正在学习 NLP。');

  const conflict = await app.call('/api/v1/memory/yukino', {method: 'PUT', ...auth, body: {text: '另一台设备的覆盖', baseVersion: 0}});
  assert.equal(conflict.status, 409);
  assert.equal(conflict.data.error.code, 'memory_conflict');
  assert.equal(conflict.data.error.remote.text, '喜欢蓝色，正在学习 NLP。');
  assert.equal(conflict.data.error.remote.version, 1);
  assert.ok(conflict.data.error.remote.updatedAt > 0, 'the conflict must include the remote timestamp');

  const read = await app.call('/api/v1/memory/yukino', auth);
  assert.equal(read.data.memory.version, 1);
  assert.equal(read.data.memory.text, '喜欢蓝色，正在学习 NLP。');

  const isolated = await app.call('/api/v1/memory/yukino', {token: second.accessToken});
  assert.equal(isolated.data.memory.text, '');
  const list = await app.call('/api/v1/memory', auth);
  assert.equal(list.data.memories.length, 1);
  assert.equal(list.data.memories[0].characterId, 'yukino');

  const removed = await app.call('/api/v1/memory/yukino', {method: 'DELETE', ...auth});
  assert.equal(removed.status, 200);
  const after = await app.call('/api/v1/memory/yukino', auth);
  assert.equal(after.data.memory.deleted, true);
  assert.equal(after.data.memory.text, '');
  assert.equal((await app.call('/api/v1/memory', auth)).data.memories.length, 0);
  assert.equal((await app.call('/api/v1/memory/yukino')).status, 401);
});

test('cloud chat is text-only, opt-in and idempotent', async () => {
  const app = await createTestApp();
  const user = await account(app, 'memory-chat@example.com', '对话测试');
  const auth = {token: user.accessToken};
  const disabled = await app.call('/api/v1/memory/yukino/chat', {
    method: 'POST', ...auth, body: {conversationId: 'conv-1', messages: [{id: 'm1', role: 'user', text: '你好', createdAt: 1}]},
  });
  assert.equal(disabled.status, 403);
  await app.call('/api/v1/memory/settings', {method: 'PUT', ...auth, body: {syncMemory: true, syncChat: true}});
  const payload = {conversationId: 'conv-1', messages: [
    {id: 'm1', role: 'user', text: '你好', createdAt: 1000},
    {id: 'm2', role: 'assistant', text: '你好，今天想聊什么？', createdAt: 2000},
  ]};
  const first = await app.call('/api/v1/memory/yukino/chat', {method: 'POST', ...auth, body: payload});
  assert.equal(first.status, 200);
  assert.deepEqual(first.data.accepted, ['m1', 'm2']);
  const again = await app.call('/api/v1/memory/yukino/chat', {method: 'POST', ...auth, body: payload});
  assert.equal(again.status, 200);
  const read = await app.call('/api/v1/memory/yukino/chat?conversationId=conv-1', auth);
  assert.equal(read.status, 200);
  assert.deepEqual(read.data.messages.map((message) => message.text), ['你好', '你好，今天想聊什么？']);
  const other = await account(app, 'memory-chat-b@example.com', '对话乙');
  assert.equal((await app.call('/api/v1/memory/yukino/chat', {token: other.accessToken})).data.messages.length, 0);
  const removed = await app.call('/api/v1/memory/yukino/chat', {method: 'DELETE', ...auth, body: {conversationId: 'conv-1'}});
  assert.equal(removed.status, 200);
  assert.equal((await app.call('/api/v1/memory/yukino/chat?conversationId=conv-1', auth)).data.messages.length, 0);
});

test('cloud chat retries stay idempotent at the quota boundary and reject cross-character ids', async () => {
  const app = await createTestApp();
  const user = await account(app, 'memory-quota@example.com', '额度测试');
  const auth = {token: user.accessToken};
  const userId = user.user.id;
  await app.call('/api/v1/memory/settings', {method: 'PUT', ...auth, body: {syncMemory: true, syncChat: true}});
  app.db.exec(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 1998)
    INSERT INTO cloud_chat_messages(user_id, id, character_id, conversation_id, role, text, created_at, deleted_at)
    SELECT '${userId}', 'seed-' || n, 'yukino', 'seed', 'user', 'seed', n, NULL FROM seq;`);
  const payload = {conversationId: 'conv-limit', messages: [
    {id: 'limit-1', role: 'user', text: '第一条', createdAt: 3000},
    {id: 'limit-2', role: 'assistant', text: '第二条', createdAt: 3001},
  ]};
  const first = await app.call('/api/v1/memory/yukino/chat', {method: 'POST', ...auth, body: payload});
  assert.equal(first.status, 200);
  const retry = await app.call('/api/v1/memory/yukino/chat', {method: 'POST', ...auth, body: payload});
  assert.equal(retry.status, 200, 'retrying an already saved batch must not count twice');
  const over = await app.call('/api/v1/memory/yukino/chat', {method: 'POST', ...auth, body: {conversationId: 'conv-limit', messages: [
    {id: 'limit-3', role: 'user', text: '第三条', createdAt: 3002},
  ]}});
  assert.equal(over.status, 413);
  assert.equal(over.data.error.code, 'chat_quota_exceeded');
  const moved = await app.call('/api/v1/memory/another-character/chat', {method: 'POST', ...auth, body: payload});
  assert.equal(moved.status, 409);
  assert.equal(moved.data.error.code, 'message_conflict');
});
