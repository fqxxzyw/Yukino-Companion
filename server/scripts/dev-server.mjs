// Local end-to-end server: same API modules as the Worker, Node's SQLite via a
// D1-compatible adapter, a loopback-only test mailbox, and the real website
// static files. It never talks to the production Worker.
import {createServer} from 'node:http';
import {readFile, writeFile, mkdir, stat, readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {NodeD1, migrate} from '../dev/node-d1.mjs';
import {createApi} from '../src/app.js';

const serverRoot = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = path.dirname(serverRoot);
// Optional override keeps the local API server usable with the merged website
// layout (website/public) without copying production files into the repo.
const websiteRoot = process.env.YUKINO_SITE_ROOT
  ? path.resolve(process.env.YUKINO_SITE_ROOT)
  : path.join(repoRoot, 'website');
const dataDir = path.join(serverRoot, '.data');
const mailboxDir = path.join(serverRoot, '.local-mailbox');
const messages = [];
const reset = process.argv.includes('--reset');

function parseVars(text) {
  const values = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index < 1) continue;
    values[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return values;
}

let env;
try {
  env = {...parseVars(await readFile(path.join(serverRoot, '.dev.vars'), 'utf8')), APP_ENV: 'local', MAIL_PROVIDER: 'local'};
} catch {
  console.error('缺少 server/.dev.vars。请先运行：npm run api:secrets');
  process.exit(1);
}
if (!env.ACCESS_TOKEN_SECRET || !env.OTP_SECRET || !env.SNAPSHOT_PRIVATE_JWK) {
  console.error('server/.dev.vars 缺少 ACCESS_TOKEN_SECRET、OTP_SECRET 或 SNAPSHOT_PRIVATE_JWK。');
  process.exit(1);
}

await mkdir(dataDir, {recursive: true});
await mkdir(mailboxDir, {recursive: true});
const databaseFile = path.join(dataDir, 'dev.db');
if (reset) {
  const {rm} = await import('node:fs/promises');
  await rm(databaseFile, {force: true});
  await rm(`${databaseFile}-wal`, {force: true});
  await rm(`${databaseFile}-shm`, {force: true});
}
const db = new NodeD1(databaseFile);
const migrationDir = path.join(serverRoot, 'migrations');
const migrations = await Promise.all((await readdir(migrationDir)).filter((name) => name.endsWith('.sql')).sort().map(async (name) => ({
  name: name.replace(/\.sql$/, ''),
  sql: await readFile(path.join(migrationDir, name), 'utf8'),
})));
migrate(db, migrations);

const mailboxFile = path.join(mailboxDir, 'messages.jsonl');
async function localSink(message) {
  messages.push(message);
  if (messages.length > 100) messages.shift();
  await writeFile(mailboxFile, `${JSON.stringify({...message, html: undefined})}\n`, {flag: 'a'});
  return {accepted: true, providerId: `local-${Date.now()}`, acceptedAt: Date.now()};
}

export const api = createApi({
  env,
  db,
  fetchImpl: globalThis.fetch,
  mailer: (await import('../src/mail.js')).createMailer({env, localSink}),
});

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function safePath(root, pathname) {
  const decoded = decodeURIComponent(pathname);
  const target = path.resolve(root, `.${decoded}`);
  return target === root || target.startsWith(root + path.sep) ? target : null;
}

const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; font-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self' https://github.com; frame-ancestors 'self'";
const COMMUNITY_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://avatars.githubusercontent.com; media-src 'self'; connect-src 'self' https://api.github.com; object-src 'none'; base-uri 'none'; form-action 'self' https://github.com; frame-src 'none'; frame-ancestors 'none'";

function htmlEscape(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
}

function mailboxResponse(jsonMode) {
  const rows = [...messages].reverse();
  if (jsonMode) {
    return new Response(JSON.stringify({
      mode: 'local-test-mailbox',
      warning: '仅用于本机开发，不代表 Gmail 真实送达。',
      messages: rows.map(({html, ...rest}) => rest),
    }, null, 2), {headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}});
  }
  const items = rows.map((message) => `<article>
    <header><strong>${htmlEscape(message.subject)}</strong><span>${new Date(message.at).toLocaleString('zh-CN')} · ${htmlEscape(message.to)}</span></header>
    <pre>${htmlEscape(message.text)}</pre>
  </article>`).join('') || '<p>还没有测试邮件。</p>';
  return new Response(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>本地测试收件箱</title>
  <style>body{font:14px/1.7 ui-sans-serif,system-ui,"Segoe UI",sans-serif;background:#f1f6fc;color:#202c3c;max-width:760px;margin:40px auto;padding:0 20px}header{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}article{background:#fff;border:1px solid #d8e4f3;border-radius:14px;padding:18px;margin:14px 0;box-shadow:0 8px 30px #1e35521a}article header{color:#5f7086}pre{white-space:pre-wrap;margin:12px 0 0}.warn{background:#fff6e4;border:1px solid #efd39b;border-radius:10px;padding:10px 14px}</style></head>
  <body><h1>本地测试收件箱</h1><p class="warn">这是本地开发专用页面，不是 Gmail 收件箱，也不代表真实邮件已送达。生产构建不会包含此入口。</p>${items}</body></html>`,
    {headers: {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': CSP}});
}

async function serveWebsite(pathname, request) {
  let target = safePath(websiteRoot, pathname === '/' ? '/index.html' : pathname);
  if (!target) return new Response('Bad path', {status: 400});
  let info;
  try { info = await stat(target); } catch { info = null; }
  if (info?.isDirectory()) {
    target = path.join(target, 'index.html');
    try { info = await stat(target); } catch { info = null; }
  }
  if (!info?.isFile()) {
    // SPA deep links (/login, /register, /account) and extensionless routes.
    if (!path.extname(pathname) && (!request.headers.accept || String(request.headers.accept).includes('text/html') || String(request.headers.accept).includes('*/*'))) {
      target = path.join(websiteRoot, 'index.html');
      try { info = await stat(target); } catch { info = null; }
    }
  }
  if (!info?.isFile()) return new Response('Not Found', {status: 404});
  const body = await readFile(target);
  const isLive2d = pathname === '/live2d' || pathname.startsWith('/live2d/');
  const isCommunity = pathname === '/community' || pathname.startsWith('/community/');
  const headers = new Headers({
    'content-type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
    'x-content-type-options': 'nosniff',
    'x-frame-options': isLive2d ? 'SAMEORIGIN' : 'DENY',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'cache-control': pathname.startsWith('/assets/') ? 'public, max-age=60' : 'no-cache',
  });
  if (target.endsWith('.html')) {
    if (isLive2d) {
      const scope = new URL('/live2d/', `http://${request.headers.host || '127.0.0.1:8787'}`).href;
      headers.set('content-security-policy', `default-src 'none'; script-src ${scope} 'wasm-unsafe-eval'; style-src ${scope}; connect-src ${scope}; img-src ${scope}; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`);
    } else {
      headers.set('content-security-policy', isCommunity ? COMMUNITY_CSP : CSP);
    }
  }
  return new Response(body, {headers});
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    request.on('data', (chunk) => {
      total += chunk.length;
      if (total > 128 * 1024) { reject(new Error('body too large')); request.destroy(); return; }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

const server = createServer(async (request, response) => {
  try {
    const local = request.socket.remoteAddress === '127.0.0.1' || request.socket.remoteAddress === '::1' || request.socket.remoteAddress === '::ffff:127.0.0.1';
    if (!local) { response.writeHead(403); response.end('loopback only'); return; }
    const url = new URL(request.url, 'http://127.0.0.1:8787');
    if (url.pathname === '/dev/mailbox' || url.pathname === '/dev/mailbox.json') {
      const result = mailboxResponse(url.pathname.endsWith('.json'));
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(Buffer.from(await result.arrayBuffer()));
      return;
    }
    if (url.pathname === '/dev/reset-limits' && request.method === 'POST') {
      // Loopback-only test convenience. Production has no such route.
      db.exec('DELETE FROM rate_limits');
      db.exec('DELETE FROM email_challenges');
      db.exec('DELETE FROM password_resets');
      response.writeHead(204, {'cache-control': 'no-store'});
      response.end();
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      const body = ['POST', 'PUT', 'PATCH'].includes(request.method) ? await readBody(request) : undefined;
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (value === undefined) continue;
        if (key === 'host' || key === 'connection' || key === 'content-length') continue;
        headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      }
      headers.set('x-forwarded-for', '127.0.0.1');
      const apiRequest = new Request(url, {method: request.method, headers, body});
      const result = await api.handle(apiRequest);
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(Buffer.from(await result.arrayBuffer()));
      return;
    }
    const result = await serveWebsite(url.pathname, request);
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(Buffer.from(await result.arrayBuffer()));
  } catch (error) {
    console.error('[dev-api]', error?.message || error);
    if (!response.headersSent) response.writeHead(500, {'content-type': 'text/plain; charset=utf-8'});
    response.end('Local development server error');
  }
});

const port = Number(process.env.PORT || 8787);
server.listen(port, '127.0.0.1', () => {
  console.log(`Yukino local API + website: http://127.0.0.1:${port}/`);
  console.log(`Local test mailbox:        http://127.0.0.1:${port}/dev/mailbox`);
  console.log(`SQLite data:               ${path.relative(process.cwd(), databaseFile)}`);
  console.log('仅本机开发：测试验证码不会出现在生产环境中。');
});

function shutdown() {
  server.close(() => { db.close(); process.exit(0); });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
