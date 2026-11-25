// MailProvider boundary. Business logic never imports Gmail details directly.
// Production refuses the local/mock provider; the local development server
// writes messages to a loopback-only test inbox instead.
import {base64url, fail} from './util.js';
import {maskEmail} from './validation.js';
import {MAIL_LOGO_PNG_BASE64} from './mail-logo.js';

const GMAIL_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GMAIL_SEND_ENDPOINT = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const LOGO_DATA_URL = `data:image/png;base64,${MAIL_LOGO_PNG_BASE64}`;
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

function mimePart(headers, base64) {
  return [...headers, 'Content-Transfer-Encoding: base64', '', base64.match(/.{1,76}/g)?.join('\r\n') || ''];
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
      const messageId = crypto.randomUUID();
      const boundary = `yukino-alternative-${messageId}`;
      const related = `yukino-related-${messageId}`;
      const plain = String(text).replace(/\r?\n/g, '\r\n');
      const rich = html || `<pre style="font:14px/1.7 ui-sans-serif,system-ui,sans-serif;white-space:pre-wrap">${escapeHtml(plain)}</pre>`;
      const hasLogo = rich.includes(LOGO_DATA_URL);
      const logoId = `yukino-logo.${messageId}@${fromEmail.split('@').at(-1)}`;
      const htmlPart = mimePart(['Content-Type: text/html; charset="UTF-8"'], toBase64(rich.replaceAll(LOGO_DATA_URL, `cid:${logoId}`)));
      const raw = [
        `From: ${encodeHeader(fromName)} <${fromEmail}>`,
        `To: <${to}>`,
        `Subject: ${encodeHeader(subject)}`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        ...mimePart(['Content-Type: text/plain; charset="UTF-8"'], toBase64(plain)),
        `--${boundary}`,
        ...(hasLogo ? [
          `Content-Type: multipart/related; boundary="${related}"; type="text/html"`,
          '',
          `--${related}`,
          ...htmlPart,
          `--${related}`,
          ...mimePart([
            'Content-Type: image/png; name="yukino-mark.png"',
            `Content-ID: <${logoId}>`,
            'Content-Disposition: inline; filename="yukino-mark.png"',
          ], MAIL_LOGO_PNG_BASE64),
          `--${related}--`,
        ] : htmlPart),
        `--${boundary}--`,
        '',
      ].join('\r\n');
      const result = await sendRaw(base64url(new TextEncoder().encode(raw)));
      // Gmail accepted the message; this is not proof it reached the inbox.
      return {accepted: true, providerId: result.id || '', acceptedAt: now()};
    },
  };
}

function mailLayout({title, content}) {
  return `<div style="margin:0;padding:24px 12px;background:#f3f6fa;color:#233042;font-family:Arial,'Microsoft YaHei',sans-serif">
    <table role="presentation" align="center" cellspacing="0" cellpadding="0" style="width:100%;max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e0e7ef;border-radius:14px">
      <tr><td style="padding:24px 24px 18px;border-bottom:1px solid #edf1f5">
        <table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse"><tr>
          <td style="vertical-align:middle;padding-right:10px"><img src="${LOGO_DATA_URL}" width="36" height="36" alt="" style="display:block;border:0"></td>
          <td style="vertical-align:middle;color:#27384b;font-size:16px;font-weight:700">Yukino Companion</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:24px;color:#233042;font-size:15px;line-height:1.8">
        <h1 style="margin:0 0 16px;color:#1d2b3c;font-size:21px;line-height:1.4">${escapeHtml(title)}</h1>
        ${content}
      </td></tr>
    </table>
  </div>`;
}

export function verificationEmail({purpose, code, minutes = 10, email}) {
  const register = purpose === 'register';
  const title = register ? '注册验证码' : '密码重置验证码';
  const instruction = `请在应用或官网的${register ? '注册' : '密码重置'}页面输入下方验证码。`;
  const security = '请勿向任何人透露验证码。如果这不是你的操作，请忽略这封邮件。';
  const account = maskEmail(email);
  const text = [
    instruction,
    '',
    `验证码：${code}`,
    `有效期：${minutes} 分钟`,
    '',
    security,
    '',
    `账号邮箱：${account}`,
    'Yukino Companion 账号服务',
  ].join('\n');
  const html = mailLayout({title, content: `
    <p style="margin:0 0 16px">${instruction}</p>
    <p style="margin:0 0 8px;padding:14px;color:#244664;font-family:Consolas,monospace;font-size:30px;font-weight:700;letter-spacing:4px;text-align:center;background:#f0f6fb;border:1px solid #d9e6f1;border-radius:10px">${escapeHtml(code)}</p>
    <p style="margin:0 0 18px;color:#52657a;font-size:14px;text-align:center">验证码在 <strong>${escapeHtml(minutes)} 分钟</strong>内有效</p>
    <p style="margin:0 0 14px;color:#52657a">${security}</p>
    <p style="margin:0;color:#718196;font-size:13px">账号邮箱：${escapeHtml(account)}</p>`});
  return {subject: `Yukino Companion · ${title}`, text, html};
}

export function accountRequestEmail({purpose}) {
  const register = purpose === 'register';
  const title = register ? '账号已存在' : '密码重置请求';
  const summary = register
    ? '这个邮箱已经注册过 Yukino Companion。'
    : '我们收到了密码重置请求，这个邮箱没有对应的 Yukino Companion 账号。';
  const nextStep = register
    ? '请直接登录。如果忘记密码，可以使用“忘记密码”功能。'
    : '如果你已注册，请核对填写的邮箱地址。';
  const ignore = '如果这不是你的操作，请忽略这封邮件。';
  return {
    subject: `Yukino Companion · ${title}`,
    text: [summary, nextStep, '', ignore, '', 'Yukino Companion 账号服务'].join('\n'),
    html: mailLayout({title, content: `
      <p style="margin:0 0 12px">${summary}</p>
      <p style="margin:0 0 12px">${nextStep}</p>
      <p style="margin:0;color:#52657a">${ignore}</p>`}),
  };
}

export function securityNoticeEmail({kind, email}) {
  const label = kind === 'password-changed' ? '密码已修改' : '密码已重置';
  const account = maskEmail(email);
  const nextStep = '如果这不是你的操作，请在 Yukino Companion 应用或官网使用“忘记密码”重置密码，并检查登录设备。';
  const text = [
    `你的 Yukino Companion 账号${label}。`,
    '',
    `账号邮箱：${account}`,
    '',
    '如果是你的操作，无需处理。',
    nextStep,
    '',
    'Yukino Companion 账号服务',
  ].join('\n');
  const html = mailLayout({title: label, content: `
    <p style="margin:0 0 16px">如果是你的操作，无需处理。</p>
    <p style="margin:0 0 14px;padding:14px 16px;background:#f4f7fa;border-left:3px solid #8aa8c5">${nextStep}</p>
    <p style="margin:0;color:#52657a;font-size:13px">账号邮箱：${escapeHtml(account)}</p>`});
  return {subject: `Yukino Companion · ${label}`, text, html};
}
