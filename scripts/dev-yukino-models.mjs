import {createRequire} from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {CharacterModelStore} = require('../electron/character-models.cjs');
const {localYukinoOutfits} = require('../electron/local-yukino-outfits.cjs');
const builtins = require('../resources/character-models.json');

const route = '/__yukino-preview/models';
const assetRoute = /^\/([a-z0-9-]+)\/(model|actions)$/;

function send(response, status, type, data) {
  response.writeHead(status, {
    'Content-Type':type,
    'Content-Length':Buffer.byteLength(data),
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff',
    'Cross-Origin-Resource-Policy':'same-origin',
  });
  response.end(data);
}

export function devYukinoModels() {
  return {
    name:'development-yukino-models',
    apply:'serve',
    configureServer(server) {
      const appData = process.env.APPDATA;
      const store = appData && path.isAbsolute(appData)
        ? new CharacterModelStore({dataRoot:path.join(appData, 'yukino-companion-development')})
        : null;

      server.middlewares.use(async (request, response, next) => {
        const pathname = request.url?.split('?', 1)[0];
        if (pathname !== route && !pathname?.startsWith(route+'/')) return next();

        const {localPort, remoteAddress} = request.socket;
        const {host, origin, 'sec-fetch-site':site} = request.headers;
        if (remoteAddress !== '127.0.0.1' || ![`127.0.0.1:${localPort}`, `localhost:${localPort}`].includes(host) ||
            (origin && origin !== `http://${host}`) || (site && site !== 'same-origin' && site !== 'none')) {
          return send(response, 403, 'text/plain; charset=utf-8', 'Only local preview requests are allowed.');
        }
        if (request.method !== 'GET') {
          response.setHeader('Allow', 'GET');
          return send(response, 405, 'text/plain; charset=utf-8', 'Only GET is allowed.');
        }

        const asset = pathname === route ? null : assetRoute.exec(pathname.slice(route.length));
        if (pathname !== route && !asset) return send(response, 404, 'text/plain; charset=utf-8', 'Preview model not found.');

        try {
          const models = store ? await localYukinoOutfits(store.outfitRoot, builtins.models) : builtins.models;
          if (!asset) return send(response, 200, 'application/json; charset=utf-8', JSON.stringify({...builtins, models}));

          const [, id, part] = asset;
          const entry = models.find(model => model.runtimeCandidate && model.id === id);
          if (!entry) return send(response, 404, 'text/plain; charset=utf-8', 'Preview model not found.');
          const actions = part === 'actions';
          const data = await store.readCandidate(entry, actions);
          return send(response, 200, actions ? 'application/json; charset=utf-8' : 'model/gltf-binary', data);
        } catch {
          return send(response, 500, 'text/plain; charset=utf-8', 'Preview model could not be verified or read.');
        }
      });
    },
  };
}
