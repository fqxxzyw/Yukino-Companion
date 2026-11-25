import {
  changePassword,
  health,
  login,
  logout,
  logoutAll,
  me,
  refresh,
  register,
  requestCode,
  requestReset,
  resetPassword,
  revokeOwnSession,
  sessions,
  updateNickname,
  verifyReset,
} from './auth.js';
import {createMailer} from './mail.js';
import {checkIn, getProgress, submitEvents, skins} from './progress.js';
import {downloadRoute} from './downloads.js';
import {listCharacters, saveCharacter} from './character-profiles.js';
import {deleteChat, deleteMemory, getChat, getMemory, getSettings, listMemories, postChat, putMemory, putSettings} from './memory.js';
import {publicJwkFromEnv} from './entitlement.js';
import {ApiError, clientIp, errorResponse, fail, json, originOf, readJson} from './util.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function allowedOrigins(env, request) {
  const configured = String(env.ALLOWED_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean);
  try {
    const self = new URL(request.url);
    configured.push(self.origin);
  } catch { /* request URL is always valid under fetch */ }
  return [...new Set(configured)];
}

function corsHeaders(origin, allowed) {
  if (!origin || !allowed.includes(origin)) return new Headers();
  return new Headers({
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type,x-client',
    'access-control-max-age': '600',
    'vary': 'Origin',
  });
}

function mergeHeaders(base, extra) {
  for (const [key, value] of extra.entries()) base.set(key, value);
  return base;
}

function securityHeaders(headers) {
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-frame-options', 'DENY');
  headers.set('referrer-policy', 'no-referrer');
  headers.set('permissions-policy', 'geolocation=(), camera=(), microphone=()');
  return headers;
}

export function createApi({env, db, fetchImpl = globalThis.fetch, mailer, now = () => Date.now()}) {
  if (!['local', 'test'].includes(env.APP_ENV) && (env.MAIL_PROVIDER === 'local' || env.MAIL_PROVIDER === 'mock')) {
    throw new Error('生产环境拒绝本地测试发件方式。');
  }
  const activeMailer = mailer || createMailer({env, fetchImpl, now: () => now()});
  const MAX_BODY = 64 * 1024;

  async function handle(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const origin = originOf(request);
    const allowed = allowedOrigins(env, request);
    const cors = corsHeaders(origin, allowed);

    if (request.method === 'OPTIONS') {
      if (origin && !allowed.includes(origin)) return new Response(null, {status: 403, headers: securityHeaders(cors)});
      return new Response(null, {status: 204, headers: securityHeaders(cors)});
    }
    if (!path.startsWith('/api/')) return new Response('Not Found', {status: 404});
    if (origin && !allowed.includes(origin)) {
      return json({error: {code: 'origin_denied', message: '请求来源不被允许。'}}, {status: 403, headers: securityHeaders(cors)});
    }

    const context = {
      request,
      env,
      db,
      mailer: activeMailer,
      fetchImpl,
      now: now(),
      ip: clientIp(request),
    };
    request.ip = context.ip;
    request.now = context.now;

    try {
      const response = await route({path, method: request.method, request, context});
      const headers = securityHeaders(mergeHeaders(new Headers(response.headers), cors));
      // Only API JSON leaves this handler. Auth responses are never cached.
      if (path.startsWith('/api/v1/public/downloads')) {
        headers.set('cache-control', response.headers.get('cache-control') || 'public, max-age=300');
      } else {
        headers.set('cache-control', 'no-store');
      }
      return new Response(response.body, {status: response.status, headers});
    } catch (error) {
      return errorResponse(error, securityHeaders(cors));
    }
  }

  async function route({path, method, request, context}) {
    if (path === '/api/v1/health' && method === 'GET') return health(context);
    if (path === '/api/v1/public/downloads' && method === 'GET') return downloadRoute(context);
    if (path === '/api/v1/public/entitlement-key' && method === 'GET') {
      const jwk = publicJwkFromEnv(env);
      return json({alg: 'ES256', keyId: env.SNAPSHOT_KEY_ID || 'dev-2026-11', publicJwk: jwk || null});
    }

    if (path === '/api/v1/auth/register/request-code' && method === 'POST') {
      return requestCode({...context, body: await readJson(request, MAX_BODY), purpose: 'register'});
    }
    if (path === '/api/v1/auth/register' && method === 'POST') {
      return register({...context, body: await readJson(request, MAX_BODY)});
    }
    if (path === '/api/v1/auth/login' && method === 'POST') {
      return login({...context, body: await readJson(request, MAX_BODY)});
    }
    if (path === '/api/v1/auth/refresh' && method === 'POST') {
      return refresh({...context, body: await readJson(request, MAX_BODY)});
    }
    if (path === '/api/v1/auth/logout' && method === 'POST') return logout(context);
    if (path === '/api/v1/auth/logout-all' && method === 'POST') return logoutAll(context);
    if (path === '/api/v1/auth/password/change' && method === 'POST') {
      return changePassword({...context, body: await readJson(request, MAX_BODY)});
    }
    if (path === '/api/v1/auth/password/forgot' && method === 'POST') {
      return requestReset({...context, body: await readJson(request, MAX_BODY)});
    }
    if (path === '/api/v1/auth/password/verify-reset' && method === 'POST') {
      return verifyReset({...context, body: await readJson(request, MAX_BODY)});
    }
    if (path === '/api/v1/auth/password/reset' && method === 'POST') {
      return resetPassword({...context, body: await readJson(request, MAX_BODY)});
    }
    if (path === '/api/v1/me' && method === 'GET') return me(context);
    if (path === '/api/v1/characters' && method === 'GET') return listCharacters(context);
    const character = /^\/api\/v1\/characters\/([a-zA-Z0-9_-]{1,100})$/.exec(path);
    if (character && character[1] !== 'yukino' && method === 'PUT') {
      return saveCharacter({...context, id: character[1], body: await readJson(request, MAX_BODY)});
    }
    if (path === '/api/v1/me' && method === 'PATCH') {
      return updateNickname({...context, body: await readJson(request, MAX_BODY)});
    }
    if (path === '/api/v1/sessions' && method === 'GET') return sessions(context);
    const sessionMatch = /^\/api\/v1\/sessions\/([0-9a-f-]{36})$/i.exec(path);
    if (sessionMatch && method === 'DELETE') return revokeOwnSession({...context, sessionId: sessionMatch[1]});
    if (path === '/api/v1/memory' && method === 'GET') return listMemories({...context, url: new URL(request.url)});
    if (path === '/api/v1/memory/settings' && method === 'GET') return getSettings(context);
    if (path === '/api/v1/memory/settings' && method === 'PUT') {
      return putSettings({...context, body: await readJson(request, MAX_BODY)});
    }
    const memoryMatch = /^\/api\/v1\/memory\/([A-Za-z0-9_-]{1,64})$/.exec(path);
    if (memoryMatch && method === 'GET') return getMemory({...context, character: memoryMatch[1]});
    if (memoryMatch && method === 'PUT') {
      return putMemory({...context, character: memoryMatch[1], body: await readJson(request, MAX_BODY)});
    }
    if (memoryMatch && method === 'DELETE') {
      return deleteMemory({...context, character: memoryMatch[1]});
    }
    const chatMatch = /^\/api\/v1\/memory\/([A-Za-z0-9_-]{1,64})\/chat$/.exec(path);
    if (chatMatch && method === 'GET') return getChat({...context, character: chatMatch[1], url: new URL(request.url)});
    if (chatMatch && method === 'POST') {
      return postChat({...context, character: chatMatch[1], body: await readJson(request, MAX_BODY)});
    }
    if (chatMatch && method === 'DELETE') {
      return deleteChat({...context, character: chatMatch[1], body: await readJson(request, MAX_BODY).catch(() => ({}))});
    }
    if (path === '/api/v1/progress' && method === 'GET') return getProgress(context);
    if (path === '/api/v1/progress/check-in' && method === 'POST') return checkIn(context);
    if (path === '/api/v1/progress/events' && method === 'POST') {
      return submitEvents({...context, body: await readJson(request, MAX_BODY)});
    }
    if (path === '/api/v1/skins' && method === 'GET') return skins(context);

    // Unknown API paths must not fall through to the SPA asset handler.
    fail(404, 'not_found', '接口不存在。');
  }

  return {handle};
}

export {MUTATING};
