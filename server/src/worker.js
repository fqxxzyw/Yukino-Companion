import {createApi} from './app.js';
import {createMailer} from './mail.js';

const apis = new WeakMap();
function apiFor(env) {
  let api = apis.get(env);
  if (!api) {
    api = createApi({env, db: env.DB});
    apis.set(env, api);
  }
  return api;
}

const HTML_HEADERS = {
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'geolocation=(), camera=(), microphone=()',
};

function isDocument(request) {
  const accept = request.headers.get('accept') || '';
  return !accept || accept.includes('text/html') || accept.includes('*/*');
}

async function staticAsset(request, env) {
  const url = new URL(request.url);
  let response = await env.ASSETS.fetch(request);
  // SPA deep links (/login, /register, /account) must survive a reload, while
  // missing assets and unknown API paths must not be swallowed.
  if (response.status === 404 && isDocument(request) && !url.pathname.startsWith('/api/') && !/\.[a-z0-9]+$/i.test(url.pathname)) {
    response = await env.ASSETS.fetch(new Request(new URL('/index.html', url), {method: 'GET', headers: request.headers}));
  }
  const headers = new Headers(response.headers);
  if ((headers.get('content-type') || '').includes('text/html')) {
    for (const [key, value] of Object.entries(HTML_HEADERS)) headers.set(key, value);
    headers.set('cache-control', 'no-cache');
  } else if (url.pathname.startsWith('/assets/')) {
    headers.set('cache-control', 'public, max-age=86400, stale-while-revalidate=604800');
  }
  return new Response(response.body, {status: response.status, headers});
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return apiFor(env).handle(request);
    if (!env.ASSETS) return new Response('Static assets binding is not configured.', {status: 503});
    return staticAsset(request, env);
  },

  async scheduled(_event, env, ctx) {
    const db = env.DB;
    const now = Date.now();
    const work = (async () => {
      await db.batch([
        db.prepare('DELETE FROM email_challenges WHERE created_at < ?').bind(now - 24 * 60 * 60 * 1000),
        db.prepare('DELETE FROM password_resets WHERE created_at < ?').bind(now - 24 * 60 * 60 * 1000),
        db.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(now - 2 * 24 * 60 * 60 * 1000),
        db.prepare('DELETE FROM sessions WHERE absolute_expires_at < ?').bind(now - 30 * 24 * 60 * 60 * 1000),
        db.prepare('DELETE FROM mail_outbox WHERE status = ? AND updated_at < ?').bind('sent', now - 30 * 24 * 60 * 60 * 1000),
        db.prepare('DELETE FROM audit_events WHERE created_at < ?').bind(now - 180 * 24 * 60 * 60 * 1000),
      ]);
      // Retry only queued security notices (never OTP messages, which are not
      // stored). A bounded batch prevents a mail outage from becoming a storm.
      if (env.MAIL_PROVIDER !== 'local') {
        const mailer = createMailer({env});
        const pending = await db.prepare('SELECT * FROM mail_outbox WHERE status = ? ORDER BY created_at LIMIT 5').bind('pending').all();
        for (const row of pending?.results || []) {
          try {
            await mailer.send({to: row.recipient, subject: row.subject, text: row.text_body});
            await db.prepare('UPDATE mail_outbox SET status = ?, attempts = attempts + 1, updated_at = ? WHERE id = ?').bind('sent', Date.now(), row.id).run();
          } catch (error) {
            await db.prepare('UPDATE mail_outbox SET attempts = attempts + 1, last_error = ?, updated_at = ? WHERE id = ?')
              .bind(String(error?.message || 'send-failed').slice(0, 200), Date.now(), row.id).run();
          }
        }
      }
    })();
    ctx.waitUntil(work);
  },
};
