import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {randomBytes} from 'node:crypto';

export default defineConfig(({command}) => {
  const nonce = randomBytes(18).toString('base64');
  return {
    base:'./',
    plugins:[react(), {
      name:'development-refresh-csp', apply:'serve',
      transformIndexHtml:{order:'pre', handler:html=>html.replace("script-src 'self'", `script-src 'self' 'nonce-${nonce}'`)},
    }],
    ...(command === 'serve' ? {html:{cspNonce:nonce}} : {}),
    server:{host:'127.0.0.1',port:5173,strictPort:true},
    build:{rollupOptions:{input:{main:'index.html',model:'model-window.html',visual:'visual-window.html'}}},
  };
});
