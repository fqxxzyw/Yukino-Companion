'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

const scheme = 'yukino-live2d';
const live2dScheme = { scheme, privileges: { standard: true, secure: true, supportFetchAPI: true } };
const viewer = `${scheme}://local/index.html`;
const fixedFiles = new Map([
  ['/index.html', 'text/html; charset=utf-8'],
  ['/parameters.json', 'application/json'],
  ['/viewer-bridge.js', 'text/javascript; charset=utf-8'],
  ['/runtime/live2dcubismcore.min.js', 'text/javascript; charset=utf-8'],
  ['/runtime/renderer.js', 'text/javascript; charset=utf-8'],
]);
const modelFiles = new Map([['.json', 'application/json'], ['.moc3', 'application/octet-stream'], ['.png', 'image/png']]);
const maxBytes = 32 * 1024 ** 2;
const csp = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'";

function live2dAssetRequest(value) {
  const url = URL.parse(value);
  if (!url || url.protocol !== `${scheme}:` || url.host !== 'local' || url.username || url.password) return null;
  const name = url.pathname;
  const type = fixedFiles.get(name)
    || (/^\/runtime\/Shaders\/WebGL\/[a-z0-9]+\.(?:vert|frag)$/.test(name) && 'text/plain; charset=utf-8')
    || (/^\/model(?:\/[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*)+$/.test(name) && modelFiles.get(path.extname(name)));
  return type ? { name: name.slice(1), type } : null;
}

async function findAsset(root, name) {
  try {
    const [actualRoot, actualFile] = await Promise.all([fs.realpath(root), fs.realpath(path.join(root, name))]);
    const relative = path.relative(actualRoot, actualFile);
    if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) return null;
    const stat = await fs.stat(actualFile);
    return stat.isFile() && stat.size > 0 && stat.size <= maxBytes ? actualFile : null;
  } catch { return null; }
}

function createLive2DAssets({ app, session, env = process.env }) {
  let initialized = false;
  const root = () => env.YUKINO_LIVE2D_DIR
    ? path.isAbsolute(env.YUKINO_LIVE2D_DIR) ? env.YUKINO_LIVE2D_DIR : null
    : path.join(app.getPath('userData'), 'live2d');

  function initialize() {
    if (initialized || !session.defaultSession?.protocol) return;
    session.defaultSession.protocol.handle(scheme, async (request) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 });
      const directory = root();
      const asset = live2dAssetRequest(request.url);
      if (!directory || !asset) return new Response(null, { status: 404 });
      const file = await findAsset(directory, asset.name);
      if (!file) return new Response(null, { status: 404 });
      try {
        const bytes = request.method === 'HEAD' ? null : await fs.readFile(file);
        if (bytes && bytes.length > maxBytes) return new Response(null, { status: 404 });
        return new Response(bytes, { headers: {
          'content-type': asset.type, 'content-security-policy': csp,
          'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
        } });
      } catch { return new Response(null, { status: 404 }); }
    });
    initialized = true;
  }

  async function viewerUrl() {
    const directory = root();
    if (!initialized || !directory) return null;
    const required = [...fixedFiles.keys(), '/model/Yukino.model3.json'];
    const ready = await Promise.all(required.map(name => findAsset(directory, name.slice(1))));
    return ready.every(Boolean) ? viewer : null;
  }

  return { initialize, viewerUrl };
}

module.exports = { createLive2DAssets, live2dAssetRequest, live2dScheme };
