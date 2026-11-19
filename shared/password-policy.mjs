// Shared password and nickname text rules. The Worker and the desktop UI import
// this exact module, so the hint shown to the user is the rule the server
// enforces. Existing accounts are always verified against their stored hash;
// these composition rules apply when creating or changing a password.
export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 512;
export const NICKNAME_MAX = 32;

export const PASSWORD_LIMITS = Object.freeze({min: PASSWORD_MIN, max: PASSWORD_MAX});

export function passwordPolicyError(password) {
  if (typeof password !== 'string') return '密码格式不正确。';
  const length = Array.from(password).length;
  if (length < PASSWORD_MIN) return `密码至少需要 ${PASSWORD_MIN} 个字符。`;
  if (length > PASSWORD_MAX) return `密码最多 ${PASSWORD_MAX} 个字符。`;
  if (!/\p{Lu}/u.test(password)) return '密码至少需要一个大写字母。';
  if (!/\p{Ll}/u.test(password)) return '密码至少需要一个小写字母。';
  if (!/\p{Nd}/u.test(password)) return '密码至少需要一个数字。';
  if (!/[\p{P}\p{S}]/u.test(password)) return '密码至少需要一个符号。';
  return '';
}

export function nicknamePolicyError(value, field = '昵称') {
  if (typeof value !== 'string') return `${field}格式不正确。`;
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(value)) return `${field}不能包含控制字符。`;
  const nickname = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  if (!nickname) return `请输入${field}。`;
  if (Array.from(nickname).length > NICKNAME_MAX) return `${field}最多 ${NICKNAME_MAX} 个字符。`;
  return '';
}

export function normalizeNickname(value) {
  return typeof value === 'string' ? value.normalize('NFKC').replace(/\s+/gu, ' ').trim() : '';
}
