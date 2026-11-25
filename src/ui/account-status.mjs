import {outfitRuleById} from '../../shared/outfit-rules.mjs';

const LEGACY_NAMES = {
  'yukino-01-v1': '白色两件泳装',
  'yukino-02-v1': '蓝色开衫贝雷帽',
  'yukino-03-v1': '白色连体泳装 · 蓝蝴蝶结',
  'yukino-04-v1': '蓝色花纹和服',
  'yukino-05-v1': '黑色蕾丝裙',
  'yukino-06-v1': '黑白女仆 · 红蝴蝶结',
  'yukino-07-v1': '原校服黄背心',
};

export function nicknameInitial(nickname) {
  const text = (nickname || '旅人').trim();
  return new Intl.Segmenter('zh', {granularity:'grapheme'}).segment(text)[Symbol.iterator]().next().value?.segment || '旅';
}

export function skinName(id) {
  return outfitRuleById(id)?.label || LEGACY_NAMES[id] || String(id || '').replace(/-v1$/, '');
}

export function accountModeLabel(account) {
  if (!account || account.mode === 'guest') return '游客模式';
  return account.profile?.nickname || account.profile?.email || '已登录账号';
}

export function accountStatus(account) {
  if (!account || account.mode === 'guest') return {tone: 'guest', label: '游客 · 进度保存在本机'};
  if (account.status === 'reauth-required') return {tone: 'reauth', label: '需要重新登录 · 本地功能仍可用'};
  if (account.status === 'authenticated-offline' || account.reachable === false) return {tone: 'offline', label: '账号服务暂不可用 · 已继续本地使用'};
  if (account.sync === 'pending' || account.pendingCount > 0) return {tone: 'pending', label: `已连接 · ${account.pendingCount} 条进度待同步`};
  return {tone: 'online', label: '账号服务可用 · 进度已同步'};
}

export function accountResultError(result) {
  return result?.error?.message || '账号操作没有完成，请稍后再试。';
}

export function accountErrorMessage(error) {
  const message = String(error?.message || error || '账号操作没有完成，请稍后再试。');
  if (/net::|ECONNREFUSED|ENOTFOUND|fetch failed|timeout|超时/i.test(message)) {
    return '暂时无法连接账号服务。本地功能仍可继续使用，稍后会自动重试。';
  }
  return message;
}

export function accountStatusTone(account) {
  return accountStatus(account).tone;
}
