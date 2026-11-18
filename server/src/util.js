const encoder = new TextEncoder();

export function nowMs() {
  return Date.now();
}

export function json(body, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.set('x-content-type-options', 'nosniff');
  return new Response(JSON.stringify(body), {...init, headers});
}

const PUBLIC_ERRORS = new Map([
  [400, '请求格式不正确。'],
  [401, '登录状态已失效，请重新登录。'],
  [403, '没有权限执行此操作。'],
  [404, '请求的资源不存在。'],
  [405, '不支持的请求方式。'],
  [409, '操作发生冲突，请重试。'],
  [413, '请求内容过大。'],
  [429, '操作太频繁，请稍后再试。'],
  [503, '账号服务暂时不可用，请稍后再试。'],
]);

export class ApiError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message || PUBLIC_ERRORS.get(status) || '请求失败。');
    this.status = status;
    this.code = code || `http_${status}`;
    this.extra = extra;
    this.public = true;
  }
}

export function fail(status, code, message, extra) {
  throw new ApiError(status, code, message, extra);
}

export function errorResponse(error, headers = {}) {
  const status = error instanceof ApiError ? error.status : 500;
  const body = {
    error: {
      code: error instanceof ApiError ? error.code : 'internal_error',
      message: error instanceof ApiError ? error.message : '服务器暂时无法处理请求。',
      ...(error instanceof ApiError ? error.extra : {}),
    },
  };
  // Server-side details stay in logs; the response never echoes SQL, secrets or
  // stack traces.
  if (!(error instanceof ApiError)) console.error('[api] unhandled', error?.message || error);
  return json(body, {headers, status});
}

export async function readJson(request, maxBytes = 32 * 1024) {
  const contentType = request.headers.get('content-type') || '';
  if (!/^application\/json\b/i.test(contentType)) fail(415, 'content_type', '请求必须使用 JSON。');
  const declared = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > maxBytes) fail(413, 'body_too_large', '请求内容过大。');
  const text = await request.text();
  if (encoder.encode(text).byteLength > maxBytes) fail(413, 'body_too_large', '请求内容过大。');
  let value;
  try { value = JSON.parse(text); } catch { fail(400, 'invalid_json', '请求内容不是有效 JSON。'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'invalid_body', '请求内容格式不正确。');
  return value;
}

export function assertString(value, {field, min = 0, max = 1024, pattern} = {}) {
  if (typeof value !== 'string') fail(400, 'invalid_field', `${field || '字段'}格式不正确。`);
  if (value.length < min || value.length > max) fail(400, 'invalid_field', `${field || '字段'}长度不正确。`);
  if (pattern && !pattern.test(value)) fail(400, 'invalid_field', `${field || '字段'}格式不正确。`);
  return value;
}

export function optionalString(value, {field, max = 256} = {}) {
  if (value === undefined || value === null || value === '') return '';
  return assertString(value, {field, max});
}

export function originOf(request) {
  const origin = request.headers.get('origin');
  if (!origin) return '';
  try {
    const url = new URL(origin);
    return url.origin === origin ? origin : '';
  } catch { return ''; }
}

export function clientIp(request) {
  // Cloudflare overwrites CF-Connecting-IP. The local dev server sets
  // X-Forwarded-For from the socket address; user headers are never trusted on
  // production requests because only CF-Connecting-IP is consulted there.
  const cf = request.headers.get('cf-connecting-ip');
  if (cf && /^[0-9a-fA-F:.]{2,64}$/.test(cf)) return cf;
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded && /^(127\.0\.0\.1|::1)(,\s*[\d.]+)*$/.test(forwarded)) return forwarded.split(',')[0].trim();
  return 'unknown';
}

export function userAgent(request) {
  return (request.headers.get('user-agent') || '').slice(0, 200);
}

export function base64url(bytes) {
  const binary = typeof bytes === 'string' ? bytes : String.fromCharCode(...new Uint8Array(bytes));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64url(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function randomToken(length = 32) {
  return base64url(randomBytes(length));
}

export function randomDigits(length = 6) {
  let value = '';
  while (value.length < length) {
    const buffer = new Uint32Array(1);
    crypto.getRandomValues(buffer);
    // Reject values above the largest exact multiple of 10 to avoid modulo bias.
    const limit = Math.floor(0xffffffff / 10) * 10;
    if (buffer[0] >= limit) continue;
    value += String(buffer[0] % 10);
  }
  return value;
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(String(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256Base64url(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(String(value)));
  return base64url(digest);
}

export async function hmacSha256(key, value) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(key), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', material, encoder.encode(value));
  return base64url(signature);
}

export function timingSafeEqual(a, b) {
  const left = encoder.encode(String(a));
  const right = encoder.encode(String(b));
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) diff |= (left[index] || 0) ^ (right[index] || 0);
  return diff === 0;
}

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export function safeLog(event, details = {}) {
  // Only stable identifiers and outcome codes are logged. Passwords, OTPs,
  // tokens, refresh cookies and raw bodies are never passed here.
  console.log(JSON.stringify({event, at: new Date().toISOString(), ...details}));
}
