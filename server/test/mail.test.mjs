import test from 'node:test';
import assert from 'node:assert/strict';
import {createMailer, securityNoticeEmail, verificationEmail} from '../src/mail.js';

const LOGO = 'https://yukino-api.fqxxzyw.workers.dev/assets/icon-192.png';

test('registration and reset emails include the usable code, expiry, and image-independent branding', () => {
  for (const [purpose, label] of [['register', '注册验证码'], ['reset', '密码重置验证码']]) {
    const mail = verificationEmail({purpose, code: '012345', minutes: 10, email: 'alice@example.com'});
    assert.match(mail.subject, new RegExp(label));
    assert.match(mail.text, /验证码：012345/);
    assert.match(mail.text, /有效期：10 分钟/);
    assert.match(mail.text, /请勿向任何人透露验证码/);
    assert.ok(mail.html.includes('012345'));
    assert.ok(mail.html.includes(LOGO));
    assert.ok(mail.html.includes('Yukino Companion'));
    assert.ok(!mail.text.includes('alice@example.com'));
    assert.ok(!mail.html.includes('alice@example.com'));
    assert.ok(mail.html.includes('al***@example.com'));
  }
});

test('security notices describe both outcomes without a code and escape dynamic HTML', () => {
  for (const [kind, label] of [['password-changed', '密码已修改'], ['password-reset', '密码已重置']]) {
    const mail = securityNoticeEmail({kind, email: 'alice@example.com'});
    assert.match(mail.subject, new RegExp(label));
    assert.ok(mail.text.includes('忘记密码'));
    assert.ok(mail.html.includes('忘记密码'));
    assert.ok(mail.html.includes('Yukino Companion'));
    assert.ok(mail.html.includes(LOGO));
    assert.ok(!mail.text.includes('alice@example.com'));
  }
  const mail = verificationEmail({purpose: 'register', code: '<script>alert(1)</script>', minutes: '<img>', email: 'a@example.com'});
  assert.ok(!mail.html.includes('<script>'));
  assert.ok(!mail.html.includes('<img>'));
  assert.ok(mail.html.includes('&lt;script&gt;'));
  assert.ok(mail.html.includes('&lt;img&gt;'));
});

test('Gmail MIME preserves both plain-text and HTML templates', async () => {
  let raw;
  const fetchImpl = async (url, init) => {
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({access_token: 'synthetic-access', expires_in: 3600});
    assert.equal(url, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
    raw = Buffer.from(JSON.parse(init.body).raw, 'base64url').toString('utf8');
    return Response.json({id: 'synthetic-id'});
  };
  const mailer = createMailer({env: {APP_ENV: 'test', MAIL_PROVIDER: 'gmail', GMAIL_CLIENT_ID: 'synthetic', GMAIL_CLIENT_SECRET: 'synthetic', GMAIL_REFRESH_TOKEN: 'synthetic'}, fetchImpl});
  const template = verificationEmail({purpose: 'register', code: '012345', email: 'alice@example.com'});
  assert.equal((await mailer.send({to: 'alice@example.com', ...template})).accepted, true);
  const extract = (type) => {
    const match = raw.match(new RegExp(`Content-Type: ${type}; charset="UTF-8"\\r\\nContent-Transfer-Encoding: base64\\r\\n\\r\\n([A-Za-z0-9+/=\\r\\n]+)`));
    assert.ok(match, `${type} MIME part`);
    return Buffer.from(match[1].replace(/\s/g, ''), 'base64').toString('utf8');
  };
  assert.equal(extract('text/plain'), template.text.replace(/\r?\n/g, '\r\n'));
  assert.equal(extract('text/html'), template.html);
});
