import {handleApi} from './account-proxy.mjs';
export default {
  async fetch(request, env) {
    const path=new URL(request.url).pathname;
    if (path==='/api' || path.startsWith('/api/')) return handleApi(request);
    if (!['GET','HEAD'].includes(request.method)) return new Response('Method not allowed',{status:405,headers:{allow:'GET, HEAD'}});
    if (!env.ASSETS) return new Response('Site assets are temporarily unavailable.',{status:503,headers:{'cache-control':'no-store'}});
    if (path==='/community' || path.startsWith('/community/')) {
      const asset=await env.ASSETS.fetch(request);
      if (!/^text\/html/i.test(asset.headers.get('Content-Type')||'') || !asset.ok) return asset;
      const headers=new Headers(asset.headers);
      headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://avatars.githubusercontent.com; media-src 'self'; connect-src 'self' https://api.github.com; object-src 'none'; base-uri 'none'; form-action 'self'; frame-src 'none'; frame-ancestors 'none'");
      headers.set('X-Content-Type-Options','nosniff');
      return new Response(asset.body,{status:asset.status,statusText:asset.statusText,headers});
    }
    if (path==='/live2d' || path.startsWith('/live2d/')) {
      const asset=await env.ASSETS.fetch(request);
      const headers=new Headers(asset.headers);
      headers.set('X-Content-Type-Options','nosniff');
      headers.set('Referrer-Policy','no-referrer');
      headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
      headers.set('Cache-Control','private, max-age=0, must-revalidate');
      if (/^text\/html/i.test(headers.get('Content-Type')||'')) {
        const scope=new URL('/live2d/',request.url).href;
        headers.set('Content-Security-Policy',`default-src 'none'; script-src ${scope} 'wasm-unsafe-eval'; style-src ${scope}; connect-src ${scope}; img-src ${scope}; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`);
        headers.set('X-Frame-Options','SAMEORIGIN');
      }
      return new Response(asset.body,{status:asset.status,statusText:asset.statusText,headers});
    }
    return env.ASSETS.fetch(request);
  }
};
