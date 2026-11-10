import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const editor = fileURLToPath(new URL('../motion-studio/', import.meta.url));
const outDir = fileURLToPath(new URL('../dist/motion-editor/', import.meta.url));
process.chdir(editor);
await build({ root: editor, build: { outDir, emptyOutDir: true } });
