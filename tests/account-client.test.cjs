'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const http = require('node:http');
const {AccountClient, AccountError, validateBase} = require('../electron/account-client.cjs');

function serve(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({
      server,
      base: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise((done) => { server.closeAllConnections?.(); server.close(done); }),
    }));
  });
}

test('base URL validation allows HTTPS and loopback HTTP only', () => {
  assert.equal(validateBase('https://yukino-api.fqxxzyw.workers.dev'), 'https://yukino-api.fqxxzyw.workers.dev');
  assert.equal(validateBase('http://127.0.0.1:8787'), 'http://127.0.0.1:8787');
  assert.throws(() => validateBase('http://example.com'), /HTTPS/);
  assert.throws(() => validateBase('ftp://example.com'), /HTTPS/);
});

test('client parses JSON, surfaces server error codes and exposes retryAfter', async () => {
  const target = await serve((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      if (request.url === '/api/v1/auth/login') {
        response.writeHead(200, {'content-type': 'application/json'});
        response.end(JSON.stringify({user: {id: '1'}, accessToken: 'a', refreshToken: 'r'}));
      } else if (request.url === '/api/v1/progress') {
        response.writeHead(429, {'content-type': 'application/json'});
        response.end(JSON.stringify({error: {code: 'rate_limited', message: '操作太频繁', retryAfter: 42}}));
      } else {
        response.writeHead(401, {'content-type': 'application/json'});
        response.end(JSON.stringify({error: {code: 'missing_token', message: '请登录'}}));
      }
      void body;
    });
  });
  try {
    const real = new AccountClient({baseUrl: target.base, fetcher: (url, options) => globalThis.fetch(url, options)});
    const login = await real.request('/api/v1/auth/login', {method: 'POST', body: {email: 'a@example.com'}});
    assert.equal(login.accessToken, 'a');
    await assert.rejects(
      () => real.request('/api/v1/progress', {token: 'a'}),
      (error) => error instanceof AccountError && error.status === 429 && error.code === 'rate_limited' && error.retryAfter === 42,
    );
    await assert.rejects(() => real.request('/api/v1/me'), (error) => error.status === 401 && error.code === 'missing_token');
  } finally {
    await target.close();
  }
});

test('network failures and timeouts are classified as unreachable, not credentials errors', async () => {
  const target = await serve(() => {
    // Intentionally never respond; the client must time out and close it.
  });
  try {
    const client = new AccountClient({baseUrl: target.base, fetcher: (url, options) => globalThis.fetch(url, options), timeoutMs: 50});
    await assert.rejects(
      () => client.request('/api/v1/me'),
      (error) => error instanceof AccountError && error.code === 'timeout' && error.network === true && error.status === 0,
    );
  } finally {
    await target.close();
  }
  const closed = new AccountClient({baseUrl: 'http://127.0.0.1:1', fetcher: (url, options) => globalThis.fetch(url, options), timeoutMs: 500});
  await assert.rejects(() => closed.request('/api/v1/me'), (error) => error.network === true && error.code === 'network_error');
});
