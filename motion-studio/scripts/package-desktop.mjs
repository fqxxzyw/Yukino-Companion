import { cp, mkdir, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') throw new Error('桌面打包需要 Windows');
const require = createRequire(import.meta.url);
const electron = require('electron');
const rcedit = require('rcedit');
const folder = fileURLToPath(new URL('../artifacts/MotionEditor-win/', import.meta.url));
const app = join(folder, 'resources', 'app');
const executable = join(folder, 'Motion Editor.exe');

await cp(dirname(electron), folder, { recursive: true });
await mkdir(join(app, 'scripts'), { recursive: true });
await cp(new URL('../dist/', import.meta.url), join(app, 'dist'), { recursive: true });
for (const file of ['desktop.cjs', 'desktop-preload.cjs', 'serve.mjs', 'local-assets.mjs']) {
  await cp(new URL(file, import.meta.url), join(app, 'scripts', file));
}
await writeFile(join(app, 'package.json'), JSON.stringify({
  name: 'yukino-motion-studio',
  productName: 'Motion Editor',
  version: '0.1.0',
  main: 'scripts/desktop.cjs',
  type: 'module',
}));
await rcedit(join(folder, 'electron.exe'), {
  icon: fileURLToPath(new URL('../branding/companion-icon.ico', import.meta.url)),
  'version-string': { FileDescription: 'Motion Editor', ProductName: 'Motion Editor', OriginalFilename: 'Motion Editor.exe' },
});
await rename(join(folder, 'electron.exe'), executable);
console.log(executable);
