// MailProvider boundary. Business logic never imports Gmail details directly.
// Production refuses the local/mock provider; the local development server
// writes messages to a loopback-only test inbox instead.
import {base64url, fail} from './util.js';
import {maskEmail} from './validation.js';

const GMAIL_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GMAIL_SEND_ENDPOINT = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
let tokenCache = {key: '', value: '', expiresAt: 0};

function toBase64(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

function encodeHeader(value) {
  return `=?UTF-8?B?${toBase64(String(value))}?=`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
}

export function mailConfigured(env) {
  const mode = env.MAIL_PROVIDER || (env.APP_ENV === 'local' ? 'local' : 'gmail');
  if (mode === 'gmail') {
    return Boolean(env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN && (env.MAIL_FROM_EMAIL || 'fqxxzyw@gmail.com'));
  }
  return mode === 'local';
}

export function createMailer({env, fetchImpl = globalThis.fetch, localSink = null, now = () => Date.now()}) {
  const mode = env.MAIL_PROVIDER || (env.APP_ENV === 'local' ? 'local' : 'gmail');
  const fromEmail = env.MAIL_FROM_EMAIL || 'fqxxzyw@gmail.com';
  const fromName = env.MAIL_FROM_NAME || 'Yukino Companion';

  if (mode === 'local') {
    if (!['local', 'test'].includes(env.APP_ENV)) {
      throw new Error('拒绝在生产环境启动本地测试发件器。');
    }
    if (!localSink) throw new Error('本地测试发件器需要本地收件箱。');
    return {
      kind: 'local',
      fromEmail,
      async send({to, subject, text, html}) {
        if (typeof to !== 'string' || !to.includes('@') || typeof subject !== 'string' || typeof text !== 'string') throw new Error('invalid local mail');
        if (env.APP_ENV !== 'local' && env.APP_ENV !== 'test') throw new Error('production mock refused');
        return localSink({to, subject, text, html: html || `<pre>${escapeHtml(text)}</pre>`, from: fromEmail, at: now()});
      },
    };
  }

  if (mode === 'none') {
    return {
      kind: 'none', fromEmail,
      async send() { fail(503, 'mail_not_configured', '邮件服务尚未配置，验证码无法发送。'); },
    };
  }

  if (mode !== 'gmail') throw new Error(`未知发件方式：${mode}`);
  const {GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN} = env;
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
    return {
      kind: 'gmail-unconfigured', fromEmail,
      async send() { fail(503, 'mail_not_configured', 'Gmail 授权尚未配置，验证码无法发送。'); },
    };
  }

  async function accessToken() {
    const key = `${GMAIL_CLIENT_ID}:${GMAIL_REFRESH_TOKEN.slice(-12)}`;
    if (tokenCache.key === key && tokenCache.value && tokenCache.expiresAt > now() + 30000) return tokenCache.value;
    const body = new URLSearchParams({
      client_id: GMAIL_CLIENT_ID,
      client_secret: GMAIL_CLIENT_SECRET,
      refresh_token: GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    });
    const response = await fetchImpl(GMAIL_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {'content-type': 'application/x-www-form-urlencoded'},
      body,
      signal: AbortSignal.timeout(12000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.access_token) {
      // Never include the OAuth response body: it can contain sensitive hints.
      throw Object.assign(new Error('Gmail OAuth 刷新失败，请重新授权。'), {mailCode: 'gmail_oauth_failed'});
    }
    tokenCache = {key, value: result.access_token, expiresAt: now() + Math.max(60, Number(result.expires_in) || 3600) * 1000};
    return result.access_token;
  }

  async function sendRaw(raw) {
    let token = await accessToken();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetchImpl(GMAIL_SEND_ENDPOINT, {
        method: 'POST',
        headers: {'authorization': `Bearer ${token}`, 'content-type': 'application/json'},
        body: JSON.stringify({raw}),
        signal: AbortSignal.timeout(15000),
      });
      if (response.status === 401 && attempt === 0) { tokenCache = {key: '', value: '', expiresAt: 0}; token = await accessToken(); continue; }
      if (!response.ok) {
        throw Object.assign(new Error('Gmail 未接受本次发信请求。'), {mailCode: `gmail_http_${response.status}`});
      }
      return response.json().catch(() => ({}));
    }
    throw Object.assign(new Error('Gmail 未接受本次发信请求。'), {mailCode: 'gmail_failed'});
  }

  return {
    kind: 'gmail',
    fromEmail,
    async send({to, subject, text, html}) {
      if (typeof to !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error('invalid recipient');
      if (typeof subject !== 'string' || subject.length > 160 || typeof text !== 'string' || text.length > 20000) throw new Error('invalid message');
      const boundary = `yukino-${crypto.randomUUID()}`;
      const plain = String(text).replace(/\r?\n/g, '\r\n');
      const rich = html || `<pre style="font:14px/1.7 ui-sans-serif,system-ui,sans-serif;white-space:pre-wrap">${escapeHtml(plain)}</pre>`;
      const raw = [
        `From: ${encodeHeader(fromName)} <${fromEmail}>`,
        `To: <${to}>`,
        `Subject: ${encodeHeader(subject)}`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset="UTF-8"',
        'Content-Transfer-Encoding: base64',
        '',
        toBase64(plain).replace(/(.{76})/g, '$1\r\n'),
        `--${boundary}`,
        'Content-Type: text/html; charset="UTF-8"',
        'Content-Transfer-Encoding: base64',
        '',
        toBase64(rich).replace(/(.{76})/g, '$1\r\n'),
        `--${boundary}--`,
        '',
      ].join('\r\n');
      const result = await sendRaw(base64url(new TextEncoder().encode(raw)));
      // Gmail accepted the message; this is not proof it reached the inbox.
      return {accepted: true, providerId: result.id || '', acceptedAt: now()};
    },
  };
}

// Use a fixed project-owned image URL; the adjacent brand text remains visible
// when an email client blocks remote images. No secrets belong in this URL.
const LOGO_URL = 'https://yukino-api.fqxxzyw.workers.dev/assets/icon-192.png';

function mailLayout({title, content}) {
  return `<div style="margin:0;padding:24px 12px;background:#f3f6fa;color:#233042;font-family:Arial,'Microsoft YaHei',sans-serif">
    <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;max-width:560px;margin:0 auto;border-collapse:collapse;background:#ffffff;border:1px solid #e0e7ef;border-radius:14px">
      <tr><td style="padding:24px 24px 18px;border-bottom:1px solid #edf1f5">
        <table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse"><tr>
          <td style="vertical-align:middle;padding-right:10px"><img src="${LOGO_URL}" width="36" height="36" alt="" style="display:block;border:0;border-radius:9px"></td>
          <td style="vertical-align:middle;color:#27384b;font-size:16px;font-weight:700">Yukino Companion</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:24px;color:#233042;font-size:15px;line-height:1.8">
        <h1 style="margin:0 0 16px;color:#1d2b3c;font-size:21px;line-height:1.4">${escapeHtml(title)}</h1>
        ${content}
      </td></tr>
      <tr><td style="padding:16px 24px 22px;border-top:1px solid #edf1f5;color:#66778b;font-size:12px;line-height:1.7">
        这是一封自动发送的账号服务邮件。请妥善保管你的账号信息。
      </td></tr>
    </table>
  </div>`;
}

export function verificationEmail({purpose, code, minutes = 10, email}) {
  const register = purpose === 'register';
  const action = register ? '注册 Yukino Companion 账号' : '重置 Yukino Companion 密码';
  const title = register ? '确认你的注册' : '确认重置密码';
  const account = maskEmail(email);
  const text = [
    `你正在${action}。`,
    '',
    `验证码：${code}`,
    `有效期：${minutes} 分钟`,
    '',
    '请在应用或官网的对应页面输入此验证码。请勿向任何人透露验证码。',
    '如果不是你本人操作，请忽略本邮件。Yukino Companion 不会通过邮件、聊天或电话索要你的密码或验证码。',
    '',
    `账号邮箱：${account}`,
    'Yukino Companion 账号服务',
  ].join('\n');
  const html = mailLayout({title, content: `
    <p style="margin:0 0 16px">你正在${escapeHtml(action)}。请在应用或官网的对应页面输入下方验证码：</p>
    <p style="margin:0 0 14px;padding:16px;color:#244664;font-family:Consolas,monospace;font-size:28px;font-weight:700;letter-spacing:5px;text-align:center;background:#f0f6fb;border:1px solid #d9e6f1;border-radius:10px">${escapeHtml(code)}</p>
    <p style="margin:0 0 16px">有效期 <strong>${escapeHtml(minutes)} 分钟</strong>。请勿向任何人透露验证码。</p>
    <p style="margin:0 0 14px;color:#52657a">如果不是你本人操作，请忽略本邮件。Yukino Companion 不会通过邮件、聊天或电话索要你的密码或验证码。</p>
    <p style="margin:0;color:#718196;font-size:13px">账号邮箱：${escapeHtml(account)}</p>`});
  return {subject: `Yukino Companion · ${register ? '注册验证码' : '密码重置验证码'}`, text, html};
}

export function securityNoticeEmail({kind, email}) {
  const label = kind === 'password-changed' ? '密码已修改' : '密码已重置';
  const account = maskEmail(email);
  const text = [
    `你的 Yukino Companion 账号${label}。`,
    '',
    `账号邮箱：${account}`,
    '',
    '如果是你本人操作，无需采取其他行动。',
    '如果这不是你本人的操作，请打开 Yukino Companion 应用或官网，使用“忘记密码”重置密码，并检查账号中的登录设备。',
    '本邮件不会包含密码或验证码。',
    '',
    'Yukino Companion 账号服务',
  ].join('\n');
  const html = mailLayout({title: `账号安全提醒：${label}`, content: `
    <p style="margin:0 0 16px">你的 Yukino Companion 账号<strong>${escapeHtml(label)}</strong>。</p>
    <p style="margin:0 0 16px;color:#52657a">账号邮箱：${escapeHtml(account)}</p>
    <p style="margin:0 0 14px">如果是你本人操作，无需采取其他行动。</p>
    <p style="margin:0 0 14px;padding:14px 16px;background:#f4f7fa;border-left:3px solid #8aa8c5">如果这不是你本人的操作，请打开 Yukino Companion 应用或官网，使用“忘记密码”重置密码，并检查账号中的登录设备。</p>
    <p style="margin:0;color:#52657a">本邮件不会包含密码或验证码。</p>`});
  return {subject: `Yukino Companion · ${label}`, text, html};
}
