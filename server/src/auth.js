import {audit, consumeRate, first, run} from './db.js';
import {burnPasswordCheck, CURRENT_PARAMS, hashPassword, verifyPassword} from './password.js';
import {accountRequestEmail, mailConfigured, securityNoticeEmail, verificationEmail} from './mail.js';
import {authenticate, createSession, listSessions, readRefreshCookie, refreshCookie, revokeFamily, revokeSession, revokeUserSessions, rotateSession, signAccessToken, SESSION_IDLE_MS} from './session.js';
import {
  ApiError,
  fail,
  hmacSha256,
  json,
  randomDigits,
  randomToken,
  readJson,
  sha256Hex,
  timingSafeEqual,
  userAgent,
} from './util.js';
import {maskEmail, normalizeEmail, normalizeNickname, requirePassword} from './validation.js';

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_RESEND_MS = 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const RESET_TTL_MS = 10 * 60 * 1000;
export const MAX_EMAILS_PER_DAY = 90;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function config(env) {
  const otpSecret = env.OTP_SECRET;
  if (typeof otpSecret !== 'string' || otpSecret.length < 32) fail(503, 'server_misconfigured', '验证码服务尚未完成安全配置。');
  return {
    otpSecret,
    secureCookie: env.APP_ENV === 'production',
    allowedOrigins: String(env.ALLOWED_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean),
  };
}

export function clientKind(request, body = {}) {
  const header = (request.headers.get('x-client') || '').toLowerCase();
  if (header === 'desktop' || body.client === 'desktop') return 'desktop';
  return 'web';
}

function codeHmac(secret, {challengeId, email, purpose, code}) {
  return hmacSha256(secret, `${challengeId}:${email}:${purpose}:${code}`);
}

async function rate(db, key, limit, windowMs, now) {
  const result = await consumeRate(db, key, {limit, windowMs, now});
  if (!result.allowed) throw new ApiError(429, 'rate_limited', '操作太频繁，请稍后再试。', {retryAfter: result.retryAfter});
  return result;
}

async function dailyMailBudget(db, now) {
  const day = new Date(now).toISOString().slice(0, 10);
  const result = await consumeRate(db, `mail:day:${day}`, {limit: MAX_EMAILS_PER_DAY, windowMs: DAY, now});
  if (!result.allowed) throw new ApiError(429, 'mail_budget_exhausted', '今日验证码发送次数已达上限，请稍后再试。', {retryAfter: result.retryAfter});
}

async function sendChallengeMail({db, mailer, to, purpose, code, now, userId = null}) {
  await dailyMailBudget(db, now);
  const template = verificationEmail({purpose, code, minutes: Math.round(OTP_TTL_MS / 60000), email: to});
  try {
    const result = await mailer.send({to, ...template});
    if (result?.accepted !== true) throw new Error('mail-not-accepted');
    return true;
  } catch (error) {
    // Queue a retry record without the OTP; the challenge is invalidated by the
    // caller so a failed send never leaves a "successful" UI state.
    await run(
      db,
      `INSERT INTO mail_outbox(user_id, kind, recipient, subject, text_body, status, attempts, last_error, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
      userId,
      `verification-${purpose}`,
      to,
      template.subject,
      '验证码邮件未能由发件服务接受。验证码不会写入重试队列，请重新申请。',
      'failed',
      1,
      String(error?.mailCode || error?.message || 'send-failed').slice(0, 200),
      now,
      now,
    );
    fail(503, 'mail_failed', '验证码邮件未能发送，请稍后重试。');
  }
}

async function queueSecurityNotice({db, mailer, user, kind, now}) {
  const template = securityNoticeEmail({kind, email: user.email});
  try {
    const result = await mailer.send({to: user.email, ...template});
    if (result?.accepted !== true) throw new Error('mail-not-accepted');
    await run(
      db,
      `INSERT INTO mail_outbox(user_id, kind, recipient, subject, text_body, status, attempts, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?)`,
      user.id, `notice-${kind}`, user.email, template.subject, template.text, 'sent', 1, now, now,
    );
  } catch (error) {
    await run(
      db,
      `INSERT INTO mail_outbox(user_id, kind, recipient, subject, text_body, status, attempts, last_error, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
      user.id, `notice-${kind}`, user.email, template.subject, template.text,
      'pending', 1, String(error?.mailCode || error?.message || 'send-failed').slice(0, 200), now, now,
    );
  }
}

async function loadChallenge(db, {id, email, purpose, now = Date.now()}) {
  const challenge = await first(
    db,
    'SELECT * FROM email_challenges WHERE id = ? AND email = ? AND purpose = ?',
    id, email, purpose,
  );
  if (!challenge) fail(400, 'invalid_challenge', '验证码不正确或已过期。');
  if (challenge.consumed_at) fail(400, 'invalid_challenge', '验证码不正确或已过期。');
  if (Number(challenge.expires_at) <= now) fail(400, 'challenge_expired', '验证码已过期，请重新获取。');
  if (Number(challenge.attempts) >= OTP_MAX_ATTEMPTS) fail(429, 'challenge_locked', '尝试次数过多，请重新获取验证码。');
  return challenge;
}

async function verifyChallengeCode({db, env, challenge, code, now}) {
  const expected = await codeHmac(config(env).otpSecret, {
    challengeId: challenge.id, email: challenge.email, purpose: challenge.purpose, code,
  });
  if (!timingSafeEqual(expected, challenge.code_hmac)) {
    await run(
      db,
      'UPDATE email_challenges SET attempts = attempts + 1 WHERE id = ? AND consumed_at IS NULL AND attempts < ?',
      challenge.id, OTP_MAX_ATTEMPTS,
    );
    await audit(db, null, 'otp-failed', `${challenge.purpose}:${challenge.id.slice(0, 8)}`, now);
    fail(400, 'invalid_code', '验证码不正确或已过期。');
  }
  const consumed = await run(
    db,
    'UPDATE email_challenges SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL AND attempts < ? AND expires_at > ?',
    now, challenge.id, OTP_MAX_ATTEMPTS, now,
  );
  if (consumed.changes !== 1) fail(400, 'invalid_challenge', '验证码不正确或已过期。');
}

function newChallenge({email, purpose, now}) {
  return {
    id: crypto.randomUUID(),
    email,
    purpose,
    code: randomDigits(6),
    createdAt: now,
  };
}

export async function requestCode({request, env, db, mailer, body, purpose, now = Date.now()}) {
  const email = normalizeEmail(body.email);
  const ipKey = await sha256Hex(`ip:${request.ip}`);
  await rate(db, `otp:ip:${ipKey}`, purpose === 'register' ? 10 : 6, HOUR, now);
  await rate(db, `otp:email:${await sha256Hex(email)}:${purpose}`, 4, HOUR, now);
  await rate(db, `otp:resend:${await sha256Hex(`${email}:${purpose}`)}`, 1, OTP_RESEND_MS, now);

  const challenge = newChallenge({email, purpose, now});
  challenge.hmac = await codeHmac(config(env).otpSecret, {challengeId: challenge.id, email, purpose, code: challenge.code});
  const user = await first(db, 'SELECT * FROM users WHERE email = ?', email);

  // Invalidate previous unconsumed challenges for this mailbox/purpose. The UI
  // tells the user to use the newest code, never an older one.
  await run(
    db,
    'UPDATE email_challenges SET consumed_at = ? WHERE email = ? AND purpose = ? AND consumed_at IS NULL',
    now, email, purpose,
  );
  await run(
    db,
    `INSERT INTO email_challenges(id, email, purpose, code_hmac, created_at, expires_at, resend_after, last_sent_at, send_status)
     VALUES(?,?,?,?,?,?,?,?,?)`,
    challenge.id, email, purpose, challenge.hmac, now, now + OTP_TTL_MS, now + OTP_RESEND_MS, now, 'pending',
  );

  if (!mailConfigured(env) || mailer.kind === 'none' || mailer.kind === 'gmail-unconfigured') {
    await run(db, 'DELETE FROM email_challenges WHERE id = ?', challenge.id);
    fail(503, 'mail_not_configured', '邮件服务尚未配置，暂时无法发送验证码。');
  }

  try {
    if ((purpose === 'reset' && !user) || (purpose === 'register' && user)) {
      // Only the mailbox owner sees whether this address has an account.
      await dailyMailBudget(db, now);
      await mailer.send({to: email, ...accountRequestEmail({purpose})});
    } else {
      await sendChallengeMail({db, mailer, to: email, purpose, code: challenge.code, now, userId: user?.id || null});
    }
    await run(db, 'UPDATE email_challenges SET send_status = ? WHERE id = ?', 'sent', challenge.id);
  } catch (error) {
    await run(db, 'UPDATE email_challenges SET consumed_at = ? WHERE id = ?', now, challenge.id);
    if (error instanceof ApiError) throw error;
    fail(503, 'mail_failed', '验证码邮件未能发送，请稍后重试。');
  }

  return json({
    ok: true,
    challengeId: challenge.id,
    expiresIn: Math.round(OTP_TTL_MS / 1000),
    retryAfter: Math.round(OTP_RESEND_MS / 1000),
    // Gmail acceptance is not inbox delivery. The UI must say “已发送请求”.
    delivery: 'accepted-by-provider',
  });
}

function userView(user) {
  return {
    id: user.id,
    email: maskEmail(user.email),
    emailHint: user.email,
    nickname: typeof user.nickname === 'string' ? user.nickname : '',
    createdAt: Number(user.created_at || 0),
    passwordChangedAt: Number(user.password_changed_at || 0),
  };
}

function sessionResponse({user, session, env, request, now, client}) {
  return signAccessToken({userId: user.id, sessionId: session.sessionId, securityVersion: user.security_version}, env, now).then((accessToken) => ({
    ok: true,
    user: userView(user),
    accessToken,
    expiresIn: 900,
    refreshToken: client === 'desktop' ? session.refreshToken : undefined,
    refreshExpiresAt: session.refreshExpiresAt,
    persistent: session.persistent !== false,
    sessionId: session.sessionId,
  }));
}

function setCookieHeaders(response, token, request, env, {maxAgeSeconds = Math.floor(SESSION_IDLE_MS / 1000), persistent = true} = {}) {
  const secure = config(env).secureCookie || new URL(request.url).protocol === 'https:';
  response.headers.append('set-cookie', refreshCookie(token, {maxAge: maxAgeSeconds, secure, persistent}));
  return response;
}

function clearCookie(response, request, env) {
  const secure = config(env).secureCookie || new URL(request.url).protocol === 'https:';
  response.headers.append('set-cookie', refreshCookie('', {maxAge: 0, secure}));
  return response;
}

export async function register({request, env, db, mailer, body, now = Date.now()}) {
  const email = normalizeEmail(body.email);
  const password = requirePassword(body.password);
  const suggested = body.nickname == null || (typeof body.nickname === 'string' && !body.nickname.trim());
  const {nickname, key: nicknameKey} = normalizeNickname(suggested ? '旅人·' + crypto.randomUUID().replaceAll('-', '').slice(0, 16) : body.nickname);
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  const challengeId = typeof body.challengeId === 'string' ? body.challengeId : '';
  if (!/^\d{6}$/.test(code) || !/^[0-9a-f-]{36}$/i.test(challengeId)) fail(400, 'invalid_code', '验证码不正确或已过期。');
  await rate(db, `register:ip:${await sha256Hex(`ip:${request.ip}`)}`, 10, HOUR, now);

  const challenge = await loadChallenge(db, {id: challengeId, email, purpose: 'register', now});
  await verifyChallengeCode({db, env, challenge, code, now});
  const existing = await first(db, 'SELECT id FROM users WHERE email = ?', email);
  if (existing) fail(409, 'email_unavailable', '该邮箱无法完成注册。如已有账号，请直接登录或找回密码。');
  const nicknameExisting = await first(db, 'SELECT id FROM users WHERE nickname_key = ?', nicknameKey);
  if (nicknameExisting) fail(409, 'nickname_unavailable', '昵称不可用，请换一个。');

  const passwordHash = await hashPassword(password);
  const user = {
    id: crypto.randomUUID(),
    email,
    nickname,
    nickname_key: nicknameKey,
    password_hash: passwordHash,
    verified_at: now,
    status: 'active',
    security_version: 1,
    created_at: now,
    updated_at: now,
  };
  const client = clientKind(request, body);
  const session = {
    sessionId: crypto.randomUUID(),
    familyId: crypto.randomUUID(),
    refreshToken: randomToken(48),
    refreshExpiresAt: now + SESSION_IDLE_MS,
    persistent: true,
  };
  const refreshHash = await sha256Hex(session.refreshToken);
  const {initial, version} = await import('../../shared/progress-rules.mjs').then((module) => ({initial: module.PROGRESS_RULES.affection.initial, version: module.PROGRESS_RULES.version}));

  try {
    await db.batch([
      db.prepare(`INSERT INTO users(id, email, password_hash, nickname, nickname_key, verified_at, status, security_version, created_at, updated_at, password_changed_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(user.id, user.email, user.password_hash, user.nickname, user.nickname_key, now, 'active', 1, now, now, now),
      db.prepare('UPDATE email_challenges SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL').bind(now, challenge.id),
      db.prepare('INSERT INTO user_progress(user_id, affection, version, rules_version, updated_at) VALUES(?,?,?,?,?)')
        .bind(user.id, initial, 1, version, now),
      db.prepare(`INSERT INTO sessions(id, user_id, client, refresh_hash, family_id, parent_id, created_at, last_used_at, idle_expires_at, absolute_expires_at, user_agent, device_label, persistent)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(session.sessionId, user.id, client, refreshHash, session.familyId, null, now, now,
          now + SESSION_IDLE_MS, now + SESSION_IDLE_MS * 6, userAgent(request),
          client === 'desktop' ? '桌面端' : '网页端', 1),
    ]);
  } catch (error) {
    // A concurrent registration can hit either unique key. Keep the nickname
    // response distinct so the page never says the email is already registered.
    const message = String(error?.message || '');
    if (/nickname/i.test(message)) fail(409, 'nickname_unavailable', '昵称不可用，请换一个。');
    if (/unique|constraint/i.test(message)) {
      const clash = await first(db, 'SELECT id FROM users WHERE nickname_key = ?', nicknameKey).catch(() => null);
      if (clash) fail(409, 'nickname_unavailable', '昵称不可用，请换一个。');
      fail(409, 'email_unavailable', '该邮箱无法完成注册。如已有账号，请直接登录或找回密码。');
    }
    throw error;
  }
  await audit(db, user.id, 'register', client, now);
  const response = await sessionResponse({user, session, env, request, now, client});
  const result = json({...response, autoLogin: true}, {status: 201});
  return client === 'web' ? setCookieHeaders(result, session.refreshToken, request, env, {persistent: true}) : result;
}

export async function login({request, env, db, body, now = Date.now()}) {
  const email = normalizeEmail(body.email);
  if (typeof body.password !== 'string' || body.password.length > 512) fail(400, 'invalid_credentials', '邮箱或密码不正确。');
  const emailKey = await sha256Hex(email);
  await rate(db, `login:ip:${await sha256Hex(`ip:${request.ip}`)}`, 20, 15 * 60 * 1000, now);
  await rate(db, `login:email:${emailKey}`, 10, 15 * 60 * 1000, now);
  const user = await first(db, 'SELECT * FROM users WHERE email = ?', email);
  if (!user) {
    await burnPasswordCheck(body.password);
    fail(401, 'invalid_credentials', '邮箱或密码不正确。');
  }
  const verified = await verifyPassword(body.password, user.password_hash);
  if (!verified.ok) {
    await audit(db, user.id, 'login-failed', '', now);
    fail(401, 'invalid_credentials', '邮箱或密码不正确。');
  }
  if (user.status !== 'active') fail(403, 'account_unavailable', '账号当前不可用，请联系支持。');
  if (verified.needsRehash) {
    const upgraded = await hashPassword(body.password);
    const changed = await run(db, `UPDATE users SET password_hash = ?, updated_at = ?
      WHERE id = ? AND status = 'active' AND password_hash = ? AND security_version = ?`,
    upgraded, now, user.id, user.password_hash, user.security_version);
    if (changed.changes !== 1) fail(401, 'invalid_credentials', '邮箱或密码不正确。');
    user.password_hash = upgraded;
  }
  const client = clientKind(request, body);
  const persistent = body.remember !== false;
  const session = await createSession(db, {userId: user.id, client, request, now, persistent,
    expectedPasswordHash: user.password_hash, expectedSecurityVersion: user.security_version});
  await audit(db, user.id, 'login', `${client}:${persistent ? 'persistent' : 'session'}`, now);
  const response = await sessionResponse({user, session, env, request, now, client});
  const result = json(response);
  return client === 'web' ? setCookieHeaders(result, session.refreshToken, request, env, {persistent}) : result;
}

export async function refresh({request, env, db, body, now = Date.now()}) {
  const client = clientKind(request, body);
  await rate(db, `refresh:ip:${await sha256Hex(`ip:${request.ip}`)}`, 60, 15 * 60 * 1000, now);
  const token = client === 'desktop' ? body.refreshToken : readRefreshCookie(request);
  if (!token) fail(401, 'invalid_refresh', '登录状态已失效，请重新登录。');
  let rotated;
  try {
    rotated = await rotateSession(db, {refreshToken: token, client, request, env, now});
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      const response = json({error: {code: error.code, message: error.message}} , {status: 401});
      return client === 'web' ? clearCookie(response, request, env) : response;
    }
    throw error;
  }
  const response = await sessionResponse({
    user: rotated.user,
    session: {sessionId: rotated.sessionId, refreshToken: rotated.refreshToken, refreshExpiresAt: rotated.refreshExpiresAt, persistent: rotated.persistent},
    env, request, now, client,
  });
  const result = json(response);
  return client === 'web' ? setCookieHeaders(result, rotated.refreshToken, request, env, {persistent: rotated.persistent}) : result;
}

export async function logout({request, env, db, now = Date.now()}) {
  const {user, session} = await authenticate(request, env, db, now);
  await revokeSession(db, session.id, now);
  await audit(db, user.id, 'logout', session.client, now);
  return clearCookie(json({ok: true}), request, env);
}

export async function logoutAll({request, env, db, now = Date.now()}) {
  const {user} = await authenticate(request, env, db, now);
  const revoked = await revokeUserSessions(db, user.id, {now});
  await audit(db, user.id, 'logout-all', String(revoked), now);
  return clearCookie(json({ok: true, revoked}), request, env);
}

export async function me({request, env, db, now = Date.now()}) {
  const {user, session} = await authenticate(request, env, db, now);
  return json({
    user: userView(user),
    session: {id: session.id, client: session.client},
  });
}

export async function updateNickname({request, env, db, body, now = Date.now()}) {
  const {user} = await authenticate(request, env, db, now);
  await rate(db, `nickname-change:${user.id}`, 10, HOUR, now);
  const {nickname, key} = normalizeNickname(body.nickname);
  const duplicate = await first(db, 'SELECT id FROM users WHERE nickname_key = ? AND id <> ?', key, user.id);
  if (duplicate) fail(409, 'nickname_unavailable', '昵称不可用，请换一个。');
  try {
    const result = await run(db, `UPDATE users SET nickname = ?, nickname_key = ?, updated_at = ?
      WHERE id = ? AND status = 'active'`, nickname, key, now, user.id);
    if (Number(result?.changes || 0) !== 1) fail(400, 'account_unavailable', '账号当前不可用，请联系支持。');
  } catch (error) {
    if (/unique|constraint/i.test(String(error?.message || ''))) fail(409, 'nickname_unavailable', '昵称不可用，请换一个。');
    throw error;
  }
  await audit(db, user.id, 'nickname-changed', '', now);
  return json({ok: true, user: userView({...user, nickname})});
}

export async function sessions({request, env, db, now = Date.now()}) {
  const {user, session} = await authenticate(request, env, db, now);
  return json({sessions: await listSessions(db, user.id, session.id, now)});
}

export async function revokeOwnSession({request, env, db, sessionId, now = Date.now()}) {
  const {user, session} = await authenticate(request, env, db, now);
  if (typeof sessionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(sessionId)) fail(400, 'invalid_session', '会话编号无效。');
  if (sessionId === session.id) fail(400, 'current_session', '请在账号中心使用“退出当前设备”。');
  const target = await first(db, 'SELECT id, user_id FROM sessions WHERE id = ?', sessionId);
  if (!target || target.user_id !== user.id) fail(404, 'session_not_found', '未找到该会话。');
  await revokeSession(db, sessionId, now);
  await audit(db, user.id, 'session-revoked', sessionId.slice(0, 8), now);
  return json({ok: true});
}

export async function changePassword({request, env, db, mailer, body, now = Date.now()}) {
  const {user, session} = await authenticate(request, env, db, now);
  await rate(db, `password-change:${user.id}`, 5, HOUR, now);
  if (typeof body.currentPassword !== 'string' || body.currentPassword.length > 512) fail(400, 'invalid_password', '当前密码不正确。');
  const newPassword = requirePassword(body.newPassword);
  const verified = await verifyPassword(body.currentPassword, user.password_hash);
  if (!verified.ok) fail(400, 'invalid_current_password', '当前密码不正确。');
  if (body.currentPassword === newPassword) fail(400, 'password_reused', '新密码不能与当前密码相同。');
  const hash = await hashPassword(newPassword);
  const nextSecurityVersion = Number(user.security_version) + 1;
  const client = session.client;
  const nextSession = {
    sessionId: crypto.randomUUID(),
    familyId: crypto.randomUUID(),
    refreshToken: randomToken(48),
    refreshExpiresAt: now + SESSION_IDLE_MS,
    persistent: session.persistent !== 0 && session.persistent !== false,
  };
  const refreshHash = await sha256Hex(nextSession.refreshToken);
  // Bind the update to the password and session we authenticated. The random
  // new hash identifies this transaction's winner for the following statements.
  const results = await db.batch([
    db.prepare(`UPDATE users SET password_hash = ?, security_version = ?, password_changed_at = ?, updated_at = ?
      WHERE id = ? AND status = 'active' AND password_hash = ? AND security_version = ?
      AND EXISTS (SELECT 1 FROM sessions WHERE id = ? AND user_id = ? AND revoked_at IS NULL
        AND idle_expires_at > ? AND absolute_expires_at > ?)`)
      .bind(hash, nextSecurityVersion, now, now, user.id, user.password_hash, user.security_version,
        session.id, user.id, now, now),
    db.prepare(`UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL
      AND EXISTS (SELECT 1 FROM users WHERE id = ? AND password_hash = ? AND security_version = ?)`)
      .bind(now, user.id, user.id, hash, nextSecurityVersion),
    db.prepare(`INSERT INTO sessions(id, user_id, client, refresh_hash, family_id, parent_id, created_at, last_used_at, idle_expires_at, absolute_expires_at, user_agent, device_label, persistent)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND password_hash = ? AND security_version = ?)`)
      .bind(nextSession.sessionId, user.id, client, refreshHash, nextSession.familyId, null, now, now, now + SESSION_IDLE_MS, now + SESSION_IDLE_MS * 6, userAgent(request), session.device_label || '', nextSession.persistent ? 1 : 0, user.id, hash, nextSecurityVersion),
  ]);
  if (Number(results?.[0]?.meta?.changes || 0) !== 1) fail(401, 'credentials_changed', '登录状态已失效，请重新登录。');
  await audit(db, user.id, 'password-changed', client, now);
  // Notification failure never rolls back a successful password change.
  await queueSecurityNotice({db, mailer, user, kind: 'password-changed', now});
  const response = await sessionResponse({user: {...user, security_version: nextSecurityVersion}, session: nextSession, env, request, now, client});
  const result = json({...response, otherSessionsRevoked: true});
  return client === 'web' ? setCookieHeaders(result, nextSession.refreshToken, request, env, {persistent: nextSession.persistent}) : result;
}

export async function requestReset({request, env, db, mailer, body, now = Date.now()}) {
  return requestCode({request, env, db, mailer, body, purpose: 'reset', now});
}

export async function verifyReset({request, env, db, body, now = Date.now()}) {
  const email = normalizeEmail(body.email);
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  const challengeId = typeof body.challengeId === 'string' ? body.challengeId : '';
  if (!/^\d{6}$/.test(code) || !/^[0-9a-f-]{36}$/i.test(challengeId)) fail(400, 'invalid_code', '验证码不正确或已过期。');
  await rate(db, `reset-verify:ip:${await sha256Hex(`ip:${request.ip}`)}`, 10, HOUR, now);
  const challenge = await loadChallenge(db, {id: challengeId, email, purpose: 'reset', now});
  await verifyChallengeCode({db, env, challenge, code, now});
  const user = await first(db, 'SELECT id FROM users WHERE email = ?', email);
  const token = randomToken(32);
  if (user) {
    const tokenHash = await sha256Hex(token);
    await db.batch([
      db.prepare('UPDATE password_resets SET consumed_at = ? WHERE user_id = ? AND consumed_at IS NULL').bind(now, user.id),
      db.prepare('INSERT INTO password_resets(token_hash, user_id, challenge_id, created_at, expires_at) VALUES(?,?,?,?,?)')
        .bind(tokenHash, user.id, challenge.id, now, now + RESET_TTL_MS),
    ]);
    await audit(db, user.id, 'reset-verified', challenge.id.slice(0, 8), now);
  }
  // Unknown mailboxes receive a token that is intentionally not stored; the
  // response shape stays uniform and cannot be used to change any password.
  return json({ok: true, resetToken: token, expiresIn: Math.round(RESET_TTL_MS / 1000)});
}

export async function resetPassword({request, env, db, mailer, body, now = Date.now()}) {
  const token = typeof body.resetToken === 'string' ? body.resetToken : '';
  if (!/^[A-Za-z0-9_-]{32,120}$/.test(token)) fail(400, 'invalid_reset', '重置授权已失效，请重新申请。');
  const newPassword = requirePassword(body.newPassword);
  await rate(db, `reset-ip:${await sha256Hex(`ip:${request.ip}`)}`, 10, HOUR, now);
  const tokenHash = await sha256Hex(token);
  const row = await first(db, 'SELECT * FROM password_resets WHERE token_hash = ?', tokenHash);
  if (!row || row.consumed_at || Number(row.expires_at) <= now) fail(400, 'invalid_reset', '重置授权已失效，请重新申请。');
  const user = await first(db, 'SELECT * FROM users WHERE id = ?', row.user_id);
  if (!user || user.status !== 'active') fail(400, 'invalid_reset', '重置授权已失效，请重新申请。');
  const hash = await hashPassword(newPassword);
  try {
    // D1 executes the batch in one transaction. Every mutation checks the
    // still-live token, which is consumed last: a competing request that read
    // it before hashing cannot change the password or revoke a newer session.
    const liveToken = `EXISTS (SELECT 1 FROM password_resets
      WHERE token_hash = ? AND user_id = ? AND consumed_at IS NULL AND expires_at > ?)
      AND EXISTS (SELECT 1 FROM users WHERE id = ? AND status = 'active')`;
    const tokenArgs = [tokenHash, user.id, now, user.id];
    const results = await db.batch([
      db.prepare(`UPDATE users SET password_hash = ?, security_version = security_version + 1, password_changed_at = ?, updated_at = ? WHERE id = ? AND ${liveToken}`)
        .bind(hash, now, now, user.id, ...tokenArgs),
      db.prepare(`UPDATE password_resets SET consumed_at = ? WHERE user_id = ? AND token_hash <> ? AND consumed_at IS NULL AND ${liveToken}`)
        .bind(now, user.id, tokenHash, ...tokenArgs),
      db.prepare(`UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND ${liveToken}`)
        .bind(now, user.id, ...tokenArgs),
      db.prepare(`UPDATE password_resets SET consumed_at = ? WHERE token_hash = ? AND user_id = ? AND consumed_at IS NULL AND expires_at > ?
        AND EXISTS (SELECT 1 FROM users WHERE id = ? AND status = 'active')`)
        .bind(now, tokenHash, user.id, now, user.id),
    ]);
    if (Number(results?.[0]?.meta?.changes || 0) !== 1) fail(400, 'invalid_reset', '重置授权已失效，请重新申请。');
  } catch (error) {
    if (/unique|constraint/i.test(String(error?.message || ''))) fail(400, 'invalid_reset', '重置授权已失效，请重新申请。');
    throw error;
  }
  await audit(db, user.id, 'password-reset', '', now);
  await queueSecurityNotice({db, mailer, user, kind: 'password-reset', now});
  return clearCookie(json({ok: true, loginRequired: true}), request, env);
}

export async function health({env, db, now = Date.now()}) {
  let database = 'unavailable';
  try {
    await first(db, 'SELECT 1 AS ok');
    database = 'ok';
  } catch { database = 'unavailable'; }
  return json({
    ok: database === 'ok',
    service: 'yukino-api',
    database,
    mail: mailConfigured(env) ? 'configured' : 'not-configured',
    time: now,
    // No secrets, bindings, account counts or environment dumps.
  }, {status: database === 'ok' ? 200 : 503});
}
