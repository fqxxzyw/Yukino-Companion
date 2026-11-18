import {fail} from './util.js';
import {passwordPolicyError} from './password.js';

const EMAIL_MAX = 254;
// Deliberately conservative ASCII mailbox validation. No provider-specific dot
// or plus rewriting is applied to any domain.
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export function normalizeEmail(value) {
  if (typeof value !== 'string') fail(400, 'invalid_email', '请输入有效邮箱地址。');
  const email = value.trim().toLowerCase();
  if (!email || email.length > EMAIL_MAX || email.split('@').some((part) => !part) || !EMAIL_RE.test(email)) {
    fail(400, 'invalid_email', '请输入有效邮箱地址。');
  }
  return email;
}

export function requirePassword(value, field = '密码') {
  const message = passwordPolicyError(value);
  if (message) fail(400, 'invalid_password', message, {field});
  return value;
}

export function maskEmail(email) {
  const [local, domain] = String(email || '').split('@');
  if (!local || !domain) return '';
  const visible = local.length <= 2 ? 1 : Math.min(3, Math.ceil(local.length / 3));
  return `${local.slice(0, visible)}${'*'.repeat(Math.max(2, local.length - visible))}@${domain}`;
}

export function enumValue(value, allowed, field) {
  if (!allowed.includes(value)) fail(400, 'invalid_field', `${field}格式不正确。`);
  return value;
}

export function clampText(value, max = 200) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}
