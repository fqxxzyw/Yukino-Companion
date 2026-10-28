import {defineConfig} from 'vite';
export default defineConfig({base:'./',build:{rollupOptions:{input:{main:'index.html',model:'model-window.html',visual:'visual-window.html'}}}});
