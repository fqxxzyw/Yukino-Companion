// Opt-in cloud memory. Only text is stored; no files, audio, images or full
// state.json. Every query is scoped by the authenticated user id, never by a
// client-supplied owner id. Plain UTF-8 in D1: not end-to-end encrypted.
import {all, audit, first, run} from './db.js';
import {authenticate} from './session.js';
import {fail, json} from './util.js';

export const MEMORY_MAX_CHARS = 12000;
export const CHAT_MAX_MESSAGES = 2000;
export const CHAT_MAX_TEXT = 4000;
export const PAGE_MAX = 50;
const HOUR = 60 * 60 * 1000;
const CHARACTER_ID = /^[A-Za-z0-9_-]{1,64}$/;

function characterId(value) {
  if (typeof value !== 'string' || !CHARACTER_ID.test(value)) fail(400, 'invalid_character', '角色编号无效。');
  return value;
}

function textValue(value, max, field) {
  if (typeof value !== 'string') fail(400, 'invalid_text', `${field}格式不正确。`);
  if (Array.from(value).length > max) fail(413, 'text_too_large', `${field}最多 ${max} 个字符。`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value)) fail(400, 'invalid_text', `${field}包含控制字符。`);
  return value;
}

async function settingsRow(db, userId) {
  return first(db, 'SELECT sync_memory, sync_chat, updated_at FROM cloud_memory_settings WHERE user_id = ?', userId);
}

function settingsView(row) {
  return {
    syncMemory: Boolean(Number(row?.sync_memory || 0)),
    syncChat: Boolean(Number(row?.sync_chat || 0)),
    updatedAt: Number(row?.updated_at || 0),
  };
}

export async function getSettings({request, env, db, now = Date.now()}) {
  const {user} = await authenticate(request, env, db, now);
  return json({settings: settingsView(await settingsRow(db, user.id))});
}

export async function putSettings({request, env, db, body, now = Date.now()}) {
  const {user} = await authenticate(request, env, db, now);
  const syncMemory = body.syncMemory === true;
  const syncChat = body.syncChat === true;
  await run(db, `INSERT INTO cloud_memory_settings(user_id, sync_memory, sync_chat, updated_at)
    VALUES(?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET sync_memory = excluded.sync_memory,
      sync_chat = excluded.sync_chat, updated_at = excluded.updated_at`,
  user.id, syncMemory ? 1 : 0, syncChat ? 1 : 0, now);
  await audit(db, user.id, 'memory-settings', `${syncMemory ? 'memory' : ''}${syncChat ? '+chat' : ''}`, now);
  return json({settings: {syncMemory, syncChat, updatedAt: now}});
}

export async function listMemories({request, env, db, url, now = Date.now()}) {
  const {user} = await authenticate(request, env, db, now);
  const limit = Math.max(1, Math.min(PAGE_MAX, Number(url.searchParams.get('limit')) || 20));
  const before = Number(url.searchParams.get('before')) || 0;
  const rows = await all(db, `SELECT character_id, text, version, updated_at
    FROM cloud_memories WHERE user_id = ? AND deleted_at IS NULL
      ${before ? 'AND updated_at < ?' : ''}
    ORDER BY updated_at DESC LIMIT ?`,
  ...(before ? [user.id, before, limit] : [user.id, limit]));
  const memories = rows.map((row) => ({
    characterId: row.character_id,
    characters: Array.from(String(row.text || '')).length,
    version: Number(row.version || 0),
    updatedAt: Number(row.updated_at || 0),
  }));
  return json({memories, nextBefore: memories.length === limit ? memories.at(-1).updatedAt : null});
}

export async function getMemory({request, env, db, character, now = Date.now()}) {
  const {user} = await authenticate(request, env, db, now);
  const id = characterId(character);
  const row = await first(db, 'SELECT text, version, updated_at, deleted_at FROM cloud_memories WHERE user_id = ? AND character_id = ?', user.id, id);
  return json({characterId: id, memory: row ? {
    text: row.deleted_at ? '' : String(row.text || ''),
    version: Number(row.version || 0),
    updatedAt: Number(row.updated_at || 0),
    deleted: Boolean(row.deleted_at),
  } : {text: '', version: 0, updatedAt: 0, deleted: false}});
}

async function syncEnabled(db, userId) {
  const settings = settingsView(await settingsRow(db, userId));
  if (!settings.syncMemory) fail(403, 'memory_sync_disabled', '请先在个人记忆中开启云端同步。');
  return settings;
}

function conflict(row) {
  fail(409, 'memory_conflict', '云端记忆已在其他设备更新，请先合并。', {
    remote: {
      text: row?.deleted_at ? '' : String(row?.text || ''),
      version: Number(row?.version || 0),
      updatedAt: Number(row?.updated_at || 0),
      deleted: Boolean(row?.deleted_at),
    },
  });
}

export async function putMemory({request, env, db, body, character, now = Date.now()}) {
  const {user} = await authenticate(request, env, db, now);
  await syncEnabled(db, user.id);
  const id = characterId(character);
  const text = textValue(body.text, MEMORY_MAX_CHARS, '记忆');
  if (!text.trim()) fail(400, 'empty_memory', '记忆不能为空；如需删除请使用删除操作。');
  const baseVersion = Number(body.baseVersion);
  if (!Number.isSafeInteger(baseVersion) || baseVersion < 0) fail(400, 'invalid_version', '记忆版本无效。');
  const current = await first(db, 'SELECT text, version, updated_at, deleted_at FROM cloud_memories WHERE user_id = ? AND character_id = ?', user.id, id);
  if (current && !current.deleted_at && Number(current.version) !== baseVersion) conflict(current);
  // The version only moves forward. A deleted row may be recreated by an older
  // client that still has baseVersion 0, but it must not reuse an old version.
  const version = Math.max(baseVersion, Number(current?.version || 0)) + 1;
  let changed = 0;
  if (current && !current.deleted_at) {
    // Compare-and-swap: two devices applying the same baseVersion cannot both
    // win, even though both read the old row above.
    ({changes: changed} = await run(db, `UPDATE cloud_memories SET text = ?, version = ?, updated_at = ?, deleted_at = NULL
      WHERE user_id = ? AND character_id = ? AND version = ? AND deleted_at IS NULL`,
    text, version, now, user.id, id, current.version));
  } else if (current) {
    ({changes: changed} = await run(db, `UPDATE cloud_memories SET text = ?, version = ?, updated_at = ?, deleted_at = NULL
      WHERE user_id = ? AND character_id = ? AND version = ? AND deleted_at IS NOT NULL`,
    text, version, now, user.id, id, current.version));
  } else {
    ({changes: changed} = await run(db, `INSERT INTO cloud_memories(user_id, character_id, text, version, updated_at, deleted_at)
      VALUES(?,?,?,?,?,NULL) ON CONFLICT(user_id, character_id) DO NOTHING`,
    user.id, id, text, version, now));
  }
  if (!changed) {
    const fresh = await first(db, 'SELECT text, version, updated_at, deleted_at FROM cloud_memories WHERE user_id = ? AND character_id = ?', user.id, id);
    if (!fresh) fail(409, 'memory_conflict', '云端记忆状态已变化，请重试。');
    conflict(fresh);
  }
  await audit(db, user.id, 'memory-saved', id, now);
  return json({characterId: id, memory: {text, version, updatedAt: now, deleted: false}});
}

export async function deleteMemory({request, env, db, character, now = Date.now()}) {
  const {user} = await authenticate(request, env, db, now);
  const id = characterId(character);
  const current = await first(db, 'SELECT version FROM cloud_memories WHERE user_id = ? AND character_id = ?', user.id, id);
  if (current) {
    await run(db, 'UPDATE cloud_memories SET text = ?, version = version + 1, updated_at = ?, deleted_at = ? WHERE user_id = ? AND character_id = ?', '', now, now, user.id, id);
  }
  await audit(db, user.id, 'memory-deleted', id, now);
  return json({ok: true, characterId: id, deleted: true});
}

export async function getChat({request, env, db, url, character, now = Date.now()}) {
  const {user} = await authenticate(request, env, db, now);
  const id = characterId(character);
  const limit = Math.max(1, Math.min(PAGE_MAX, Number(url.searchParams.get('limit')) || 30));
  const before = Number(url.searchParams.get('before')) || 0;
  const conversation = url.searchParams.get('conversationId') || '';
  if (conversation && !CHARACTER_ID.test(conversation) && !/^[A-Za-z0-9_-]{1,80}$/.test(conversation)) fail(400, 'invalid_conversation', '会话编号无效。');
  const where = conversation ? 'AND conversation_id = ?' : '';
  const rows = await all(db, `SELECT id, conversation_id, role, text, created_at
    FROM cloud_chat_messages WHERE user_id = ? AND character_id = ? AND deleted_at IS NULL
      ${where} ${before ? 'AND created_at < ?' : ''}
    ORDER BY created_at DESC LIMIT ?`,
  ...(conversation
    ? (before ? [user.id, id, conversation, before, limit] : [user.id, id, conversation, limit])
    : (before ? [user.id, id, before, limit] : [user.id, id, limit])));
  const messages = rows.reverse().map((row) => ({
    id: row.id, conversationId: row.conversation_id, role: row.role, text: row.text, createdAt: Number(row.created_at),
  }));
  return json({characterId: id, messages, nextBefore: rows.length === limit ? rows[0]?.created_at || null : null});
}

export async function postChat({request, env, db, body, character, now = Date.now()}) {
  const {user} = await authenticate(request, env, db, now);
  const settings = settingsView(await settingsRow(db, user.id));
  if (!settings.syncChat) fail(403, 'chat_sync_disabled', '请先在个人记忆中开启云端文字对话同步。');
  const id = characterId(character);
  const conversationId = typeof body.conversationId === 'string' ? body.conversationId.trim() : '';
  if (!conversationId || !/^[A-Za-z0-9_-]{1,80}$/.test(conversationId)) fail(400, 'invalid_conversation', '会话编号无效。');
  if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 50) fail(400, 'invalid_messages', '一次最多同步 50 条文字消息。');
  const messages = body.messages.map((message) => {
    if (!message || typeof message.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(message.id)) fail(400, 'invalid_message', '消息编号无效。');
    if (message.role !== 'user' && message.role !== 'assistant') fail(400, 'invalid_message', '消息角色无效。');
    const text = textValue(String(message.text || ''), CHAT_MAX_TEXT, '消息');
    if (!text.trim()) fail(400, 'invalid_message', '消息不能为空。');
    const createdAt = Number(message.createdAt);
    if (!Number.isSafeInteger(createdAt) || createdAt <= 0) fail(400, 'invalid_message', '消息时间无效。');
    return {id: message.id, role: message.role, text, createdAt};
  });
  if (new Set(messages.map((message) => message.id)).size !== messages.length) fail(400, 'invalid_messages', '同一次同步中包含重复消息编号。');
  const placeholders = messages.map(() => '?').join(',');
  const existing = await all(db, `SELECT id, character_id, deleted_at FROM cloud_chat_messages
    WHERE user_id = ? AND id IN (${placeholders})`, user.id, ...messages.map((message) => message.id));
  const foreign = existing.find((row) => row.character_id !== id);
  if (foreign) fail(409, 'message_conflict', '消息编号已被其他角色使用，请重新生成消息编号。');
  const activeIds = new Set(existing.filter((row) => !row.deleted_at).map((row) => row.id));
  const newMessages = messages.filter((message) => !activeIds.has(message.id)).length;
  const count = await first(db, 'SELECT COUNT(*) AS total FROM cloud_chat_messages WHERE user_id = ? AND deleted_at IS NULL', user.id);
  // A retry of an already-saved batch adds no rows, so it must still succeed at
  // the limit; only messages that will become newly active count against quota.
  if (Number(count?.total || 0) + newMessages > CHAT_MAX_MESSAGES) {
    fail(413, 'chat_quota_exceeded', '云端文字对话已达到上限，请先删除部分云端对话。');
  }
  for (const message of messages) {
    await run(db, `INSERT INTO cloud_chat_messages(user_id, id, character_id, conversation_id, role, text, created_at, deleted_at)
      VALUES(?,?,?,?,?,?,?,NULL)
      ON CONFLICT(user_id, id) DO UPDATE SET text = excluded.text, role = excluded.role,
        conversation_id = excluded.conversation_id, created_at = excluded.created_at, deleted_at = NULL
      WHERE cloud_chat_messages.character_id = excluded.character_id`,
    user.id, message.id, id, conversationId, message.role, message.text, message.createdAt);
  }
  await audit(db, user.id, 'chat-saved', `${id}:${messages.length}`, now);
  return json({ok: true, accepted: messages.map((message) => message.id)});
}

export async function deleteChat({request, env, db, body, character, now = Date.now()}) {
  const {user} = await authenticate(request, env, db, now);
  const id = characterId(character);
  const conversationId = typeof body.conversationId === 'string' ? body.conversationId.trim() : '';
  if (conversationId) {
    await run(db, 'UPDATE cloud_chat_messages SET deleted_at = ? WHERE user_id = ? AND character_id = ? AND conversation_id = ? AND deleted_at IS NULL', now, user.id, id, conversationId);
  } else {
    await run(db, 'UPDATE cloud_chat_messages SET deleted_at = ? WHERE user_id = ? AND character_id = ? AND deleted_at IS NULL', now, user.id, id);
  }
  await audit(db, user.id, 'chat-deleted', id, now);
  return json({ok: true, characterId: id, deleted: true});
}
