import {all, first, run} from './db.js';
import {
  ApiError,
  base64url,
  canonicalJson,
  fail,
  fromBase64url,
  hmacSha256,
  randomToken,
  sha256Hex,
  timingSafeEqual,
  userAgent,
} from './util.js';

export const ACCESS_TTL_SECONDS = 15 * 60;
export const SESSION_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 180 * 24 * 60 * 60 * 1000;
export const REFRESH_REUSE_GRACE_MS = 45 * 1000;
export const REFRESH_COOKIE = 'yk_refresh';

function accessSecret(env) {
  const secret = env.ACCESS_TOKEN_SECRET;
  if (typeof secret !== 'string' || secret.length < 32) fail(503, 'server_misconfigured', '账号服务尚未完成安全配置。');
  return secret;
}

function encodeSegment(value) {
  return base64url(new TextEncoder().encode(value));
}

export async function signAccessToken({userId, sessionId, securityVersion}, env, now = Date.now()) {
  const header = encodeSegment(canonicalJson({alg: 'HS256', typ: 'JWT'}));
  const payload = encodeSegment(canonicalJson({
    sub: userId,
    sid: sessionId,
    sv: Number(securityVersion) || 1,
    iss: 'yukino-api',
    aud: 'yukino-client',
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + ACCESS_TTL_SECONDS,
  }));
  const signature = await hmacSha256(accessSecret(env), `${header}.${payload}`);
  return `${header}.${payload}.${signature}`;
}

function decodeSegment(segment) {
  return JSON.parse(new TextDecoder().decode(fromBase64url(segment)));
}

export async function verifyAccessToken(token, env, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 4096) fail(401, 'invalid_token', '登录状态已失效，请重新登录。');
  const parts = token.split('.');
  if (parts.length !== 3) fail(401, 'invalid_token');
  let header, payload;
  try { header = decodeSegment(parts[0]); payload = decodeSegment(parts[1]); }
  catch { fail(401, 'invalid_token'); }
  if (header?.alg !== 'HS256' || header?.typ !== 'JWT') fail(401, 'invalid_token');
  const expected = await hmacSha256(accessSecret(env), `${parts[0]}.${parts[1]}`);
  if (!timingSafeEqual(expected, parts[2])) fail(401, 'invalid_token');
  if (payload?.iss !== 'yukino-api' || payload?.aud !== 'yukino-client') fail(401, 'invalid_token');
  const nowSeconds = Math.floor(now / 1000);
  if (!Number.isFinite(payload.exp) || payload.exp <= nowSeconds) fail(401, 'token_expired');
  if (!Number.isFinite(payload.iat) || payload.iat > nowSeconds + 60) fail(401, 'invalid_token');
  if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') fail(401, 'invalid_token');
  return payload;
}

export async function createSession(db, {userId, client, request, now = Date.now(), familyId, parentId = null, persistent = true, expectedPasswordHash, expectedSecurityVersion}) {
  const id = crypto.randomUUID();
  const family = familyId || crypto.randomUUID();
  const refreshToken = randomToken(48);
  const refreshHash = await sha256Hex(refreshToken);
  // The password must still be the one verified by the login request. A
  // password reset or change may have committed while the hash was computed.
  const inserted = await run(
    db,
    `INSERT INTO sessions(id, user_id, client, refresh_hash, family_id, parent_id,
       created_at, last_used_at, idle_expires_at, absolute_expires_at, user_agent, device_label, persistent)
     SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (
       SELECT 1 FROM users WHERE id = ? AND status = 'active'
       AND password_hash = ? AND security_version = ?
     )`,
    id,
    userId,
    client,
    refreshHash,
    family,
    parentId,
    now,
    now,
    now + SESSION_IDLE_MS,
    now + SESSION_ABSOLUTE_MS,
    userAgent(request),
    client === 'desktop' ? '桌面端' : '网页端',
    persistent ? 1 : 0,
    userId,
    expectedPasswordHash,
    expectedSecurityVersion,
  );
  if (inserted.changes !== 1) fail(401, 'invalid_credentials', '邮箱或密码不正确。');
  return {sessionId: id, familyId: family, refreshToken, refreshExpiresAt: now + SESSION_IDLE_MS, absoluteExpiresAt: now + SESSION_ABSOLUTE_MS, persistent};
}

export async function rotateSession(db, {refreshToken, client, request, env, now = Date.now()}) {
  if (typeof refreshToken !== 'string' || refreshToken.length < 32 || refreshToken.length > 200) fail(401, 'invalid_refresh');
  const hash = await sha256Hex(refreshToken);
  const row = await first(db, 'SELECT * FROM sessions WHERE refresh_hash = ?', hash);
  if (!row) fail(401, 'invalid_refresh');
  if (row.client !== client) fail(401, 'invalid_refresh');
  if (row.revoked_at) {
    const since = now - Number(row.revoked_at);
    // A normal multi-tab refresh can race another rotation. Give the loser a
    // short, explicit retry instead of destroying the whole session family.
    if (row.replaced_by && since >= 0 && since < REFRESH_REUSE_GRACE_MS) {
      throw new ApiError(409, 'refresh_in_progress', '登录状态正在更新，请稍后重试。', {retryAfter: 1});
    }
    await revokeFamily(db, row.family_id, now, 'refresh-reuse');
    fail(401, 'session_revoked', '登录状态已失效，请重新登录。');
  }
  if (Number(row.idle_expires_at) <= now || Number(row.absolute_expires_at) <= now) {
    await run(db, 'UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', now, row.id);
    fail(401, 'session_expired');
  }
  const user = await first(db, 'SELECT id, email, status, security_version FROM users WHERE id = ?', row.user_id);
  if (!user || user.status !== 'active') fail(401, 'account_unavailable');

  const nextId = crypto.randomUUID();
  const nextToken = randomToken(48);
  const nextHash = await sha256Hex(nextToken);
  // D1 batches execute in a transaction. Only the caller that successfully
  // claims this exact live session may create its successor. Re-check the
  // user's security version so a concurrent password reset cannot resurrect a
  // session after revocation.
  const results = await db.batch([
    db.prepare(`UPDATE sessions SET revoked_at = ?, replaced_by = ?
      WHERE id = ? AND revoked_at IS NULL AND idle_expires_at > ? AND absolute_expires_at > ?
      AND EXISTS (SELECT 1 FROM users WHERE id = ? AND status = 'active' AND security_version = ?)`)
      .bind(now, nextId, row.id, now, now, row.user_id, user.security_version),
    db.prepare(
      `INSERT INTO sessions(id, user_id, client, refresh_hash, family_id, parent_id,
         created_at, last_used_at, idle_expires_at, absolute_expires_at, user_agent, device_label, persistent)
       SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (
         SELECT 1 FROM sessions WHERE id = ? AND revoked_at = ? AND replaced_by = ?
       )`,
    ).bind(nextId, row.user_id, client, nextHash, row.family_id, row.id, now, now,
      now + SESSION_IDLE_MS, Math.min(now + SESSION_ABSOLUTE_MS, Number(row.absolute_expires_at)),
      userAgent(request), row.device_label || (client === 'desktop' ? '桌面端' : '网页端'), Number(row.persistent) === 0 ? 0 : 1,
      row.id, now, nextId),
  ]);
  if (Number(results?.[0]?.meta?.changes || 0) !== 1 || Number(results?.[1]?.meta?.changes || 0) !== 1) {
    throw new ApiError(409, 'refresh_in_progress', '登录状态正在更新，请稍后重试。', {retryAfter: 1});
  }
  return {
    sessionId: nextId,
    familyId: row.family_id,
    refreshToken: nextToken,
    refreshExpiresAt: now + SESSION_IDLE_MS,
    absoluteExpiresAt: Math.min(now + SESSION_ABSOLUTE_MS, Number(row.absolute_expires_at)),
    persistent: Number(row.persistent) !== 0,
    user,
  };
}

export async function revokeSession(db, sessionId, now = Date.now()) {
  return run(db, 'UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', now, sessionId);
}

export async function revokeFamily(db, familyId, now = Date.now(), reason = '') {
  const result = await run(db, 'UPDATE sessions SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL', now, familyId);
  return {revoked: result.changes, reason};
}

export async function revokeUserSessions(db, userId, {exceptSessionId, now = Date.now()} = {}) {
  const result = exceptSessionId
    ? await run(db, 'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL', now, userId, exceptSessionId)
    : await run(db, 'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', now, userId);
  return result.changes;
}

export async function authenticate(request, env, db, now = Date.now()) {
  const header = request.headers.get('authorization') || '';
  if (!/^Bearer\s+/i.test(header)) fail(401, 'missing_token');
  const payload = await verifyAccessToken(header.replace(/^Bearer\s+/i, ''), env, now);
  const session = await first(db, 'SELECT * FROM sessions WHERE id = ?', payload.sid);
  if (!session || session.revoked_at || Number(session.absolute_expires_at) <= now) fail(401, 'session_revoked');
  if (Number(session.idle_expires_at) <= now) fail(401, 'session_expired');
  const user = await first(db, 'SELECT * FROM users WHERE id = ?', payload.sub);
  if (!user || user.status !== 'active') fail(401, 'account_unavailable');
  if (Number(user.security_version) !== Number(payload.sv)) fail(401, 'credentials_changed');
  if (session.user_id !== user.id) fail(401, 'invalid_token');
  // Rolling idle expiry keeps "remember me" sessions alive when actually used.
  // It is not extended beyond the absolute deadline.
  if (now - Number(session.last_used_at) > 5 * 60 * 1000) {
    await run(db, 'UPDATE sessions SET last_used_at = ?, idle_expires_at = MIN(?, absolute_expires_at) WHERE id = ?',
      now, now + SESSION_IDLE_MS, session.id);
  }
  return {user, session, payload};
}

export async function listSessions(db, userId, currentSessionId, now = Date.now()) {
  const rows = await all(
    db,
    `SELECT id, client, created_at, last_used_at, idle_expires_at, absolute_expires_at, revoked_at, device_label
     FROM sessions WHERE user_id = ? AND absolute_expires_at > ? AND revoked_at IS NULL
     ORDER BY last_used_at DESC LIMIT 50`,
    userId,
    now,
  );
  return rows.map((row) => ({
    id: row.id,
    client: row.client,
    deviceLabel: row.device_label || (row.client === 'desktop' ? '桌面端' : '网页端'),
    createdAt: Number(row.created_at),
    lastUsedAt: Number(row.last_used_at),
    expiresAt: Math.min(Number(row.idle_expires_at), Number(row.absolute_expires_at)),
    revoked: Boolean(row.revoked_at),
    current: row.id === currentSessionId,
  }));
}

export function refreshCookie(token, {maxAge, secure = true, path = '/api/v1/auth', persistent = true} = {}) {
  const parts = [`${REFRESH_COOKIE}=${encodeURIComponent(token || '')}`, `Path=${path}`, 'HttpOnly', 'SameSite=Lax'];
  if (persistent) parts.push(`Max-Age=${Math.max(0, Math.floor(maxAge || 0))}`);
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function readRefreshCookie(request) {
  const header = request.headers.get('cookie') || '';
  for (const item of header.split(';')) {
    const [name, ...rest] = item.trim().split('=');
    if (name === REFRESH_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return '';
}
