// One-time local OAuth authorization for the Gmail sender account.
// Scope: gmail.send only. Run from a trusted local terminal; the refresh token
// is written to an ignored file and is never printed to stdout.
import {createHash, randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import {writeFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openBrowser} from './oauth-open-browser.mjs';

const serverRoot = fileURLToPath(new URL('..', import.meta.url));
const clientId = process.env.GMAIL_CLIENT_ID || '';
const clientSecret = process.env.GMAIL_CLIENT_SECRET || '';
if (!clientId || !clientSecret) {
  console.error('请先在本机设置 GMAIL_CLIENT_ID 与 GMAIL_CLIENT_SECRET，然后重新运行。不要把值发到聊天。');
  process.exit(1);
}
const scope = 'https://www.googleapis.com/auth/gmail.send';
const redirectUri = 'http://127.0.0.1:8765/oauth2callback';
const state = randomBytes(24).toString('base64url');
const verifier = randomBytes(48).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.search = new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: 'code',
  scope,
  access_type: 'offline',
  prompt: 'consent',
  include_granted_scopes: 'true',
  state,
  code_challenge: challenge,
  code_challenge_method: 'S256',
}).toString();

async function exchange(code) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {'content-type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.refresh_token) {
    throw new Error('授权交换失败。请确认 OAuth 客户端类型为“桌面应用”、scope 为 gmail.send，并重新授权。');
  }
  return data.refresh_token;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, redirectUri);
    if (url.pathname !== '/oauth2callback') { response.writeHead(404); response.end(); return; }
    if (url.searchParams.get('state') !== state) { response.writeHead(400); response.end('state mismatch'); return; }
    const error = url.searchParams.get('error');
    if (error) { response.writeHead(400); response.end(`authorization error: ${error}`); return; }
    const code = url.searchParams.get('code') || '';
    if (!code) { response.writeHead(400); response.end('missing code'); return; }
    const refreshToken = await exchange(code);
    await mkdir(path.join(serverRoot), {recursive: true});
    const target = path.join(serverRoot, '.gmail-refresh-token.txt');
    await writeFile(target, refreshToken + '\n', {encoding: 'utf8', mode: 0o600});
    response.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
    response.end('<!doctype html><meta charset="utf-8"><title>授权完成</title><body style="font:16px system-ui;padding:40px">授权完成。请回到终端继续。<br>不要把 <code>.gmail-refresh-token.txt</code> 提交到 Git 或发送到聊天。</body>');
    console.log(`授权完成，refresh token 已写入 ${path.relative(process.cwd(), target)}。`);
    console.log('下一步：在 server 目录执行 npx wrangler secret put GMAIL_REFRESH_TOKEN，然后把 token 文件作为输入。');
    server.close();
  } catch (error) {
    console.error(error.message);
    response.writeHead(500, {'content-type': 'text/plain; charset=utf-8'});
    response.end('authorization failed');
    server.close();
    process.exitCode = 1;
  }
});

server.listen(8765, '127.0.0.1', () => {
  console.log('正在打开 Google 授权页。若浏览器没有自动打开，请手动打开：');
  console.log(authUrl.toString());
  openBrowser(authUrl.toString());
});
setTimeout(() => {
  console.error('授权等待超时（5 分钟）。重新运行脚本即可。');
  server.close();
  process.exitCode = 1;
}, 5 * 60 * 1000).unref();
