// Generates local development secrets or a production secrets checklist.
// Secrets are written to ignored files in server/ and are never printed to the
// chat. Run with --dev for the local server, or without arguments for a
// production checklist you can apply with `wrangler secret put`.
import {randomBytes} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dev = process.argv.includes('--dev');
const force = process.argv.includes('--force');

async function keyPair() {
  const pair = await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign', 'verify']);
  return {
    privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey),
    publicJwk: await crypto.subtle.exportKey('jwk', pair.publicKey),
  };
}

function token(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

async function writeOnce(file, content) {
  if (!force) {
    try {
      await readFile(file, 'utf8');
      console.error(`${path.relative(process.cwd(), file)} 已存在；如需覆盖请加 --force。`);
      return false;
    } catch { /* missing is expected */ }
  }
  await mkdir(path.dirname(file), {recursive: true});
  await writeFile(file, content, {encoding: 'utf8', mode: 0o600});
  return true;
}

if (dev) {
  const keys = await keyPair();
  const values = {
    APP_ENV: 'local',
    MAIL_PROVIDER: 'local',
    ACCESS_TOKEN_SECRET: token(48),
    OTP_SECRET: token(48),
    SNAPSHOT_PRIVATE_JWK: JSON.stringify(keys.privateJwk),
    SNAPSHOT_PUBLIC_JWK: JSON.stringify(keys.publicJwk),
    SNAPSHOT_KEY_ID: `local-${new Date().toISOString().slice(0, 10)}`,
    ALLOWED_ORIGINS: 'http://127.0.0.1:8787,http://localhost:8787',
    MAIL_FROM_EMAIL: 'fqxxzyw@gmail.com',
    MAIL_FROM_NAME: 'Yukino Companion',
  };
  const target = path.join(root, '.dev.vars');
  if (await writeOnce(target, Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n')) {
    console.log(`已写入 ${path.relative(process.cwd(), target)}（仅本机开发，已被 git 忽略）。`);
  }
} else {
  const keys = await keyPair();
  const values = {
    ACCESS_TOKEN_SECRET: token(48),
    OTP_SECRET: token(48),
    SNAPSHOT_PRIVATE_JWK: JSON.stringify(keys.privateJwk),
    SNAPSHOT_PUBLIC_JWK: JSON.stringify(keys.publicJwk),
    SNAPSHOT_KEY_ID: `prod-${new Date().toISOString().slice(0, 10)}`,
    MAIL_PROVIDER: 'gmail',
    MAIL_FROM_EMAIL: 'fqxxzyw@gmail.com',
    GMAIL_CLIENT_ID: '<从 Google Cloud OAuth 客户端复制>',
    GMAIL_CLIENT_SECRET: '<从 Google Cloud OAuth 客户端复制>',
    GMAIL_REFRESH_TOKEN: '<完成本人授权后由 you 工具或脚本写入，不要发到聊天>',
  };
  const target = path.join(root, '.secrets.production.txt');
  const content = [
    '# Yukino production secrets checklist',
    '# 不要提交此文件，不要把内容粘贴到聊天、截图或日志。',
    '# 在 server/ 目录逐项执行：',
    ...Object.entries(values).map(([key, value]) => `npx wrangler secret put ${key}   # 值：${value}`),
    '',
    '# SNAPSHOT_PUBLIC_JWK 不是秘密；把它写入 shared/entitlement-public-key.mjs',
    '# 或作为 VITE_YUKINO_SNAPSHOT_PUBLIC_KEY 构建变量，供客户端验证快照。',
    `SNAPSHOT_PUBLIC_JWK=${values.SNAPSHOT_PUBLIC_JWK}`,
    '',
    '# 生成后请立即转移到密码管理器，并删除此文件：',
    `# ${path.relative(process.cwd(), target)}`,
  ].join('\n');
  if (await writeOnce(target, content)) {
    console.log(`已写入 ${path.relative(process.cwd(), target)}。请按文件中的命令在受信任终端执行，完成后删除该文件。`);
  }
}
