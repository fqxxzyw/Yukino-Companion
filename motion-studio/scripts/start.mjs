import { spawn } from 'node:child_process';
import { startServer } from './serve.mjs';

const port = Number(process.env.YUKINO_MOTION_PORT || 5197);
const server = await startServer(port);
const url = `http://127.0.0.1:${server.address().port}/`;
console.log(`动作编辑器 · ${url}`);
if (process.argv.includes('--open') && process.platform === 'win32') {
  const browser = spawn('explorer.exe', [url], { detached: true, stdio: 'ignore', windowsHide: true });
  browser.on('error', (error) => console.error(error.message));
  browser.unref();
}
