import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { serveModels } from './scripts/local-assets.mjs';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'studio-local-models',
      configureServer(server) { server.middlewares.use(serveModels); },
      configurePreviewServer(server) { server.middlewares.use(serveModels); },
    },
  ],
  server: { fs: { strict: true } },
  build: {
    rollupOptions: {
      input: { studio: resolve('index.html'), player: resolve('player.html') },
    },
  },
});
