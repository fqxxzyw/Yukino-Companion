import {createServer} from 'vite';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {watch} from 'node:fs';
import {readFile, readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer as createHTTPServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import readline from 'node:readline';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const desktop = process.argv.includes('--desktop');
const portIndex = process.argv.indexOf('--port');
const port = portIndex < 0 ? (desktop ? 5174 : 5173) : Number(process.argv[portIndex + 1]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('无效开发端口（1024–65535）');
const url = `http://127.0.0.1:${port}/`;
let server, httpServer, child, watcher, input, debounce, stopping = false, pending = false;
let restarting = Promise.resolve();
const expectedExits = new WeakSet();
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function stopElectron() {
  const owned = child;
  if (!owned || owned.exitCode !== null || owned.signalCode !== null) return;
  const exited = new Promise(resolve => owned.once('exit', resolve));
  try { if (owned.connected) owned.send({type:'yukino:quit'}, () => {}); } catch {}
  let timer;
  const clean = await Promise.race([
    exited.then(() => true),
    new Promise(resolve => { timer = setTimeout(() => resolve(false), 7000); }),
  ]);
  clearTimeout(timer);
  if (!clean && owned.exitCode === null && owned.signalCode === null) {
    console.warn(`[dev] Electron ${owned.pid} 未及时退出，仅终止本次创建的进程树。`);
    if (process.platform === 'win32') {
      await new Promise(resolve => {
        const killer = spawn('taskkill', ['/PID', String(owned.pid), '/T', '/F'], {stdio:'ignore'});
        killer.once('error', resolve); killer.once('exit', resolve);
      });
    } else {
      try { process.kill(-owned.pid, 'SIGKILL'); } catch {}
    }
    await Promise.race([exited, wait(2000)]);
  }
  if (child === owned) child = null;
}

function launchElectron() {
  if (stopping) return;
  const env = {...process.env, YUKINO_DEV_SERVER_URL:url};
  // VS Code terminals can inherit this variable; Electron must remain a GUI app.
  delete env.ELECTRON_RUN_AS_NODE;
  const args = ['.'];
  // Only explicit test/debug invocations expose CDP, bound to loopback.
  const debugIndex = process.argv.indexOf('--inspect-renderer');
  if (debugIndex >= 0) {
    const debugPort = Number(process.argv[debugIndex + 1]);
    if (!Number.isInteger(debugPort) || debugPort < 1024 || debugPort > 65535) throw Error('无效调试端口');
    args.unshift('--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${debugPort}`);
  }
  const owned = spawn(require('electron'), args, {
    cwd:root, env, stdio:['ignore', 'inherit', 'inherit', 'ipc'],
    detached:process.platform !== 'win32',
  });
  child = owned;
  console.log(`[dev] Electron starting pid=${owned.pid}`);
  owned.on('message', message => {
    if (message?.type === 'yukino:ready') console.log(`[dev] Electron ready pid=${message.pid} ${message.url}`);
  });
  owned.once('error', error => { console.error(error); void shutdown(1); });
  owned.once('exit', (code, signal) => {
    console.log(`[dev] Electron exited pid=${owned.pid} code=${code} signal=${signal}`);
    if (child === owned) {
      child = null;
      if (!expectedExits.has(owned)) void shutdown(code || 0);
    }
  });
}

function requestRestart() {
  if (stopping || pending) return;
  pending = true;
  restarting = restarting.then(async () => {
    pending = false;
    if (stopping) return;
    console.log('[dev] Restarting Electron (saving development state)…');
    if (child) expectedExits.add(child);
    await stopElectron();
    if (!stopping) launchElectron();
  }).catch(error => { console.error(error); setImmediate(() => { void shutdown(1); }); });
}

async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  clearTimeout(debounce); watcher?.close(); input?.close();
  process.stdin.pause();
  process.stdin.unref?.();
  await restarting;
  await stopElectron();
  await server?.close();
  if (httpServer?.listening) {
    httpServer.closeAllConnections();
    await new Promise(resolve => httpServer.close(resolve));
  }
  console.log('[dev] Stopped; owned processes and Vite released.');
  process.exitCode = code;
}

process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
process.on('uncaughtException', error => { console.error(error); void shutdown(1); });
process.on('unhandledRejection', error => { console.error(error); void shutdown(1); });

try {
  console.log(`[dev] Starting ${desktop ? 'desktop' : 'web'}…`);
  // Own the HTTP lifecycle. Vite's standalone mode exits the whole process on
  // stdin EOF/SIGTERM, which would bypass Electron's state flush and cleanup.
  httpServer = createHTTPServer();
  server = await createServer({root, server:{host:'127.0.0.1', port, strictPort:true,
    middlewareMode:true, ws:{server:httpServer, host:'127.0.0.1', clientPort:port}}});
  httpServer.on('request', server.middlewares);
  if (!stopping) await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, '127.0.0.1', resolve);
  });
  if (!stopping) {
    console.log(`[dev] Vite ready ${url}`);
    if (desktop) {
      const sourceRoot = path.join(root, 'electron');
      const sourcePattern = /\.(?:cjs|js|json|html|css)$/;
      const digest = bytes => createHash('sha256').update(bytes).digest('hex');
      const sources = await readdir(sourceRoot, {recursive:true, withFileTypes:true});
      const hashes = new Map(await Promise.all(sources.filter(entry => entry.isFile() && sourcePattern.test(entry.name)).map(async entry => {
        const file = path.join(entry.parentPath, entry.name);
        return [file, digest(await readFile(file))];
      })));
      // Windows can emit metadata/duplicate notifications. Only changed source
      // bytes (including additions/deletions) warrant a destructive GUI restart.
      watcher = watch(sourceRoot, {recursive:true}, (_event, filename) => {
        if (!filename || !sourcePattern.test(filename)) return;
        const file = path.join(sourceRoot, filename);
        void readFile(file).then(digest, error => {
          if (error.code === 'ENOENT') return null;
          throw error;
        }).then(hash => {
          if (stopping || hashes.get(file) === hash) return;
          hashes.set(file, hash);
          console.log(`[dev] Source changed: ${filename}`);
          clearTimeout(debounce); debounce = setTimeout(requestRestart, 400);
        }).catch(error => console.warn(`[dev] Source watch: ${error.message}`));
      });
      launchElectron();
      console.log('[dev] React/CSS: hot update. Electron/preload: debounced restart. Type r + Enter to restart, q + Enter to stop.');
    }
    if (process.stdin.isTTY || process.argv.includes('--control-stdin')) {
      input = readline.createInterface({input:process.stdin, terminal:false});
      input.on('line', line => {
        if (line.trim() === 'q') void shutdown();
        if (desktop && line.trim() === 'r') requestRestart();
      });
    }
  } else await server.close();
} catch (error) {
  console.error(`[dev] ${error.message}`);
  await shutdown(1);
}
