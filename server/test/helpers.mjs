import {readFile, readdir} from 'node:fs/promises';
import {NodeD1, migrate} from '../dev/node-d1.mjs';
import {createApi} from '../src/app.js';
import {createMailer} from '../src/mail.js';
import {generateKeyPair} from '../src/entitlement.js';

let migrationCache;
async function migrationSql() {
  if (!migrationCache) {
    const dir = new URL('../migrations/', import.meta.url);
    const names = (await readdir(dir)).filter((name) => name.endsWith('.sql')).sort();
    migrationCache = await Promise.all(names.map(async (name) => ({
      name: name.replace(/\.sql$/, ''),
      sql: await readFile(new URL(name, dir), 'utf8'),
    })));
  }
  return migrationCache;
}

export async function createTestApp({env: overrides = {}} = {}) {
  const keys = await generateKeyPair();
  const env = {
    APP_ENV: 'test',
    MAIL_PROVIDER: 'local',
    ACCESS_TOKEN_SECRET: 'test-access-secret-'.padEnd(48, 'x'),
    OTP_SECRET: 'test-otp-secret-'.padEnd(48, 'y'),
    SNAPSHOT_PRIVATE_JWK: JSON.stringify(keys.privateJwk),
    SNAPSHOT_PUBLIC_JWK: JSON.stringify(keys.publicJwk),
    SNAPSHOT_KEY_ID: 'test-key',
    ALLOWED_ORIGINS: 'http://127.0.0.1:8787',
    MAIL_FROM_EMAIL: 'fqxxzyw@gmail.com',
    ...overrides,
  };
  const db = new NodeD1(':memory:');
  migrate(db, await migrationSql());
  const mailbox = [];
  let clock = Date.now();
  const mailer = createMailer({
    env,
    localSink: async (message) => {
      mailbox.push(message);
      return {accepted: true, providerId: `test-${mailbox.length}`, acceptedAt: clock};
    },
    now: () => clock,
  });
  const api = createApi({
    env,
    db,
    mailer,
    now: () => clock,
    fetchImpl: overrides.fetchImpl,
  });
  async function call(path, {method = 'GET', body, token, cookie, headers = {}} = {}) {
    const merged = new Headers(headers);
    if (token) merged.set('authorization', `Bearer ${token}`);
    if (cookie) merged.set('cookie', cookie);
    if (body !== undefined) merged.set('content-type', 'application/json');
    const request = new Request(`http://127.0.0.1:8787${path}`, {
      method,
      headers: merged,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const response = await api.handle(request);
    let data = null;
    try { data = await response.clone().json(); } catch { data = null; }
    return {status: response.status, data, headers: response.headers, response};
  }
  function lastCode() {
    for (let index = mailbox.length - 1; index >= 0; index -= 1) {
      const match = /验证码：(\d{6})/.exec(mailbox[index].text);
      if (match) return match[1];
    }
    return '';
  }
  async function register(email = 'user@example.com', password = 'correct horse battery staple', {client = 'desktop'} = {}) {
    const requested = await call('/api/v1/auth/register/request-code', {method: 'POST', body: {email, client}});
    if (requested.status !== 200) throw new Error(`request-code ${requested.status} ${JSON.stringify(requested.data)}`);
    const code = lastCode();
    const result = await call('/api/v1/auth/register', {
      method: 'POST',
      body: {email, password, code, challengeId: requested.data.challengeId, client},
    });
    if (result.status !== 201) throw new Error(`register ${result.status} ${JSON.stringify(result.data)}`);
    return {email, password, ...result.data, setCookie: result.headers.get('set-cookie') || ''};
  }
  return {
    env, db, api, mailbox, call, register, lastCode,
    setNow(value) { clock = value; },
    advance(ms) { clock += ms; },
    now() { return clock; },
    keys,
  };
}

export function cookieHeader(setCookie) {
  return String(setCookie || '').split(';')[0];
}
