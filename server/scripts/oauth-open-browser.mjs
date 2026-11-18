import {spawn} from 'node:child_process';

// Pass the complete URL directly to the OS. In particular, cmd.exe's `start`
// parses ampersands in an OAuth query string as command separators.
export function openBrowser(url, {platform = process.platform, spawnProcess = spawn} = {}) {
  const command = platform === 'win32' ? 'rundll32.exe' : platform === 'darwin' ? 'open' : 'xdg-open';
  const args = platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawnProcess(command, args, {stdio: 'ignore', detached: true, windowsHide: true});
  child.on('error', () => console.error('无法自动打开浏览器，请使用上方显示的授权网址。'));
  child.unref();
}
