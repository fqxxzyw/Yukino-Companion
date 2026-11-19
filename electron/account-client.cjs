'use strict';
// Minimal desktop account transport. Tokens stay in the main process; the
// renderer only receives account state and session summaries.
const DEFAULT_BASE = 'https://yukino-api.fqxxzyw.workers.dev';
const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

class AccountError extends Error {
  constructor(message, {code = 'account_error', status = 0, retryAfter = 0, network = false, data = null} = {}) {
    super(message);
    this.name = 'AccountError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
    this.network = network;
    this.data = data;
  }
}

function validateBase(value) {
  if (!value) return DEFAULT_BASE;
  let url;
  try { url = new URL(value); } catch { throw new AccountError('账号服务地址无效。', {code: 'invalid_base'}); }
  const loopback = LOOPBACK.test(url.origin);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new AccountError('账号服务必须使用 HTTPS（本机调试除外）。', {code: 'invalid_base'});
  }
  return url.origin;
}

class AccountClient {
  constructor({fetcher, baseUrl = DEFAULT_BASE, timeoutMs = 9000, now = Date.now} = {}) {
    if (typeof fetcher !== 'function') throw new TypeError('AccountClient requires a fetch implementation');
    this.fetcher = fetcher;
    this.baseUrl = validateBase(baseUrl);
    this.timeoutMs = timeoutMs;
    this.now = now;
  }

  setBase(value) {
    this.baseUrl = validateBase(value);
    return this.baseUrl;
  }

  async request(path, {method = 'GET', body, token, timeoutMs} = {}) {
    if (typeof path !== 'string' || !path.startsWith('/api/v1/')) throw new AccountError('账号接口路径无效。', {code: 'invalid_path'});
    const headers = {'x-client': 'desktop', 'accept': 'application/json'};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs || this.timeoutMs);
    let response;
    try {
      response = await this.fetcher(this.baseUrl + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = error?.name === 'AbortError' || /aborted|timeout/i.test(String(error?.message || ''));
      throw new AccountError(aborted ? '账号服务响应超时，已继续使用本地档案。' : '无法连接账号服务，已继续使用本地档案。', {
        code: aborted ? 'timeout' : 'network_error',
        network: true,
      });
    } finally {
      clearTimeout(timeout);
    }
    let data = null;
    try { data = await response.json(); } catch { data = null; }
    if (!response.ok) {
      const detail = data?.error || {};
      throw new AccountError(detail.message || '账号请求没有完成，请稍后再试。', {
        code: detail.code || `http_${response.status}`,
        status: response.status,
        retryAfter: Number(detail.retryAfter || 0),
        data: detail.remote ? {remote: detail.remote} : null,
      });
    }
    return data || {};
  }
}

module.exports = {AccountClient, AccountError, DEFAULT_BASE, validateBase, LOOPBACK};
