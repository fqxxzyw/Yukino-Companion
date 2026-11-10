import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const modelDir = resolve(process.env.YUKINO_MOTION_MODELS || fileURLToPath(new URL('../../public/characters/', import.meta.url)));
const filenames = /^Yukino(?:0[1-7])_[A-Za-z0-9_]+\.glb$/;

export function serveModels(request, response, next) {
  const pathname = (request.url || '').split('?')[0];
  if (!pathname.startsWith('/models/')) return next();
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  const name = pathname.slice('/models/'.length);
  if (!filenames.test(name)) {
    response.writeHead(404).end();
    return;
  }
  const path = resolve(modelDir, name);
  stat(path).then((info) => {
    if (!info.isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'model/gltf-binary',
      'Content-Length': info.size,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    if (request.method === 'HEAD') return response.end();
    const stream = createReadStream(path);
    response.on('close', () => stream.destroy());
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  }).catch(() => response.writeHead(404).end('本地模型文件不存在'));
}
