import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, join } from 'node:path';
import { serveModels } from './local-assets.mjs';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};

function serveStatic(request, response) {
  const pathname = (request.url || '').split('?')[0];
  if (!['GET', 'HEAD'].includes(request.method)) return response.writeHead(405).end();
  const name = pathname === '/' ? '/index.html' : pathname;
  if (!/^\/(?:index\.html|player\.html|assets\/[a-zA-Z0-9_.-]+)$/.test(name)) {
    return response.writeHead(404).end();
  }
  const file = join(dist, name);
  stat(file).then((info) => {
    if (!info.isFile()) return response.writeHead(404).end();
    response.writeHead(200, {
      'Content-Type': types[extname(file)] || 'application/octet-stream',
      'Content-Length': info.size,
      'X-Content-Type-Options': 'nosniff',
    });
    if (request.method === 'HEAD') return response.end();
    const stream = createReadStream(file);
    response.on('close', () => stream.destroy());
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  }).catch(() => response.writeHead(404).end());
}

export async function startServer(port = 5197) {
  await stat(join(dist, 'index.html')).catch(() => { throw new Error('请先执行 npm run build'); });
  const server = createServer((request, response) => serveModels(request, response, () => serveStatic(request, response)));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}
