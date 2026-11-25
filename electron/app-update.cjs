'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {spawn} = require('node:child_process');
const {once} = require('node:events');
const {Readable} = require('node:stream');
const yaml = require('js-yaml');
const {limitedBody, planDownload, transfer, verifyFile} = require('./update-blockmap.cjs');

const REPO = 'https://github.com/fqxxzyw/Yukino-Companion';
const API = 'https://api.github.com/repos/fqxxzyw/Yukino-Companion/releases/latest';
const stable = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
function newer(a, b) {
  const left = stable.exec(a), right = stable.exec(b);
  if (!left || !right) return false;
  for (let i = 1; i < 4; i++) {
    if (left[i] !== right[i]) return BigInt(left[i]) > BigInt(right[i]);
  }
  return false;
}

const assetUrl = (tag, name) => REPO + '/releases/download/' + tag + '/' + name;
const installerName = version => 'Yukino-Companion-' + version + '-Base-Setup.exe';
function releaseNotes(body) {
  if (typeof body !== 'string') return '';
  const lines = body.slice(0, 65536).replace(/\r\n?/g, '\n').split('\n');
  const heading = lines.findIndex(line => /^ {0,3}##\s+更新内容\s*#*\s*$/.test(line));
  let section = heading < 0 ? lines : lines.slice(heading + 1);
  if (heading >= 0) {
    const end = section.findIndex(line => /^ {0,3}#{1,2}(?:\s|$)/.test(line));
    if (end >= 0) section = section.slice(0, end);
  }
  // Deliver plain text only. The renderer displays this as a React text node.
  const notes = section.join('\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim();
  return notes.length > 2000 ? notes.slice(0,1999)+'…' : notes;
}
function trustedAsset(asset, tag, name) {
  return !!asset && stable.test(tag) && asset.name === name && asset.browser_download_url === assetUrl(tag, name) &&
    Number.isSafeInteger(asset.size) && asset.size > 0 && asset.size < 2 * 1024 ** 3;
}

// Electron's net.fetch rejects manual redirects before exposing Location.
// net.request lets us inspect each hop while retaining Chromium's system
// proxy/PAC support. Surface it as the same bounded stream as fetch.
function electronFetch(net, url, {signal, headers}) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const req = net.request({url:String(url), method:'GET', redirect:'manual', credentials:'omit', headers});
    const abort = () => {req.abort(); reject(signal.reason);};
    signal.addEventListener('abort', abort, {once:true});
    req.once('close', () => signal.removeEventListener('abort', abort));
    req.on('error', reject);
    req.once('redirect', (status, _method, location) => {
      resolve(new Response(null, {status, headers:{location}}));
      req.abort();
    });
    req.once('response', message => {
      message.once('aborted', () => message.destroy(Error('更新下载中断')));
      if ([204,205,304].includes(message.statusCode)) {
        message.resume();
        resolve(new Response(null, {status:message.statusCode, headers:message.headers}));
        return;
      }
      const body = Readable.toWeb(message, {strategy:{highWaterMark:128*1024, size:chunk=>chunk.byteLength}});
      message.once('close', () => {if (!message.readableEnded) req.abort();});
      resolve(new Response(body, {status:message.statusCode, headers:message.headers}));
    });
    req.end();
  });
}

async function githubGet(url, {signal, headers, timeout=30000} = {}, request=fetch, rangeCache) {
  // GitHub redirects public asset downloads to short-lived signed CDN URLs.
  // Follow only that chain and never expose those URLs in errors or logs.
  const deadline = AbortSignal.timeout(timeout);
  const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const useCache = !!headers?.Range && !!rangeCache;
  const cached = useCache && rangeCache.source === url && rangeCache.until > Date.now();
  let next = new URL(cached ? rangeCache.location : url);
  for (let i = 0; i < 6; i++) {
    if (next.protocol !== 'https:' || next.username || next.password || next.port ||
        !['api.github.com','github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(next.hostname)) {
      throw Error('更新来源校验失败');
    }
    const response = await request(next, {headers:{'User-Agent':'Yukino-Companion', ...headers}, signal:requestSignal, redirect:'manual'});
    if ([301,302,303,307,308].includes(response.status)) {
      await response.body?.cancel();
      const target = response.headers.get('location');
      if (!target) throw Error('GitHub 重定向无效');
      next = new URL(target, next);
      if (!['release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(next.hostname)) throw Error('更新来源校验失败');
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (cached && i === 0 && [401,403,404].includes(response.status)) {
        rangeCache.source = null;
        next = new URL(url);
        continue;
      }
      throw Object.assign(Error('GitHub 请求失败（HTTP ' + response.status + '）'), {status:response.status});
    }
    if (useCache && next.href !== url && !cached) {
      Object.assign(rangeCache, {source:url, location:next.href, until:Date.now()+2*60*1000});
    }
    return response;
  }
  throw Error('GitHub 重定向过多');
}

async function discover(current, get) {
  let response;
  try {
    response = await get(API);
  } catch (error) {
    if (error.status !== 404) throw error;
    // An empty, accessible repository has no /latest yet. A missing/private
    // repository must still produce a visible HTTP error.
    const releases = await get(API.replace('/latest', '?per_page=1'));
    if (Array.isArray(JSON.parse(await limitedBody(releases, 1024 ** 2)))) return null;
    throw error;
  }
  const r = JSON.parse(await limitedBody(response, 4 * 1024 ** 2));
  if (r.draft !== false || r.prerelease !== false || !newer(r.tag_name, current)) return null;
  const tag = r.tag_name, version = tag.replace(/^v/, ''), name = installerName(version);
  const asset = (n) => r.assets?.find(a => trustedAsset(a, tag, n));
  const setup = asset(name), metadata = asset('latest.yml');
  if (!setup || !metadata || metadata.size > 256 * 1024) throw Error('正式版缺少可信的基础安装包或 latest.yml，请前往 GitHub。');
  const info = yaml.load((await limitedBody(await get(metadata.browser_download_url), 256 * 1024)).toString('utf8'), {schema:yaml.JSON_SCHEMA});
  const file = info?.files?.find(entry => entry.url === name);
  if (info?.version !== version || !file || file.size !== setup.size || !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512)) {
    throw Error('latest.yml 的版本、安装包大小或 SHA-512 无效');
  }
  return {name, tag, releaseNotes:releaseNotes(r.body), size:setup.size, sha512:file.sha512, url:setup.browser_download_url, mapUrl:assetUrl(tag,name+'.blockmap')};
}

async function launchInstaller(filename, directory) {
  // NSIS consumes the entire unquoted remainder of the command line after /D=.
  const child = spawn(filename, ['--updated', '/S', '--force-run', '/D='+directory], {stdio:'ignore', detached:true, windowsHide:true, windowsVerbatimArguments:true});
  await once(child, 'spawn');
  child.unref();
}

function createUpdater({app, dialog, shell, send, beforeInstall, net, get, launch=launchInstaller,
  cacheDir, isPortable=Boolean(process.env.PORTABLE_EXECUTABLE_FILE || process.env.YUKINO_PORTABLE_LAUNCHER)}) {
  const portable = isPortable || !app.isPackaged;
  const cache = portable ? null : cacheDir || path.join(process.env.LOCALAPPDATA, 'yukino-companion-updater');
  const pending = cache && path.join(cache, 'pending');
  const rangeCache = {};
  const request = net ? (url, init) => electronFetch(net, url, init) : fetch;
  get ??= (url, options) => githubGet(url, options, request, rangeCache);
  let selected, ready, checking, controller, installing = false;
  const snapshot = () => selected ? {version:selected.tag, releaseNotes:selected.releaseNotes, downloadable:true, portable, native:!portable, fullSize:selected.size, ...(ready && {ready})} : null;

  async function readRelease() {
    const release = await discover(app.getVersion(), get);
    let restored;
    if (!portable && release) {
      const filename = path.join(pending, release.name);
      try {
        await verifyFile(filename, release);
        restored = ready?.version === release.tag ? ready : {ready:true, fromCache:true, version:release.tag, portable:false, fullSize:release.size, bytes:0, total:0};
      } catch (error) {
        if (error.code !== 'ENOENT') await fs.rm(filename, {force:true});
      }
    }
    selected = release;
    ready = restored;
    return snapshot();
  }

  function check() {
    if (controller || installing) return Promise.resolve(snapshot());
    if (!checking) checking = readRelease().finally(() => {checking = null;});
    return checking;
  }

  async function download() {
    if (checking) await checking;
    if (controller || installing) throw Error('更新操作进行中');
    if (!selected) throw Error('请先检查更新');
    if (ready) return ready;
    const release = selected;
    controller = new AbortController();
    const {signal} = controller;
    let part;
    try {
      let filename;
      if (portable) {
        const choice = await dialog.showSaveDialog({title:'保存完整更新安装包', defaultPath:path.join(app.getPath('downloads'), release.name), filters:[{name:'Windows 安装程序', extensions:['exe']}]});
        if (choice.canceled || !choice.filePath) return {cancelled:true};
        filename = choice.filePath;
      } else {
        await fs.mkdir(pending, {recursive:true});
        filename = path.join(pending, release.name);
      }
      part = filename + '.' + randomUUID() + '.part';
      const progress = info => send('app-update-progress', info);
      const options = {part, release, get, signal, progress};
      let result, fallbackReason;
      if (!portable) {
        try {
          const old = app.getVersion();
          const plan = await planDownload({cache, release, get, signal, oldMapUrl:assetUrl('v'+old, installerName(old)+'.blockmap')});
          result = await transfer({...options, plan});
          await fs.writeFile(path.join(pending, release.name+'.blockmap'), plan.blockmap);
        } catch (error) {
          signal.throwIfAborted();
          fallbackReason = error.code === 'ENOENT' ? '缺少可复用的安装缓存' : '区块表或差分重建不可用';
          await fs.rm(part, {force:true});
          result = null;
        }
      }
      if (!result) {
        result = await transfer({...options, progress:info => progress({...info, fallbackReason})});
      }
      signal.throwIfAborted();
      await fs.rename(part, filename);
      if (portable) {
        shell.showItemInFolder(filename);
        return {...result, saved:true, portable:true};
      }
      ready = {...result, ready:true, version:release.tag, portable:false, fallbackReason};
      return ready;
    } catch (error) {
      if (signal.aborted) return {cancelled:true};
      throw error;
    } finally {
      try { if (part) await fs.rm(part, {force:true}); }
      finally { controller = null; }
    }
  }

  async function install() {
    if (checking) await checking;
    if (portable || !ready || installing || controller) throw Error('请先下载并校验更新。');
    installing = true;
    try {
      const filename = path.join(pending, selected.name);
      try { await verifyFile(filename, selected); }
      catch (error) { ready = null; await fs.rm(filename, {force:true}); throw error; }
      await beforeInstall?.();
      try { await launch(filename, path.dirname(process.execPath)); }
      catch (error) { throw Error('安装程序启动失败，请重试（'+(error.code || 'Windows')+'）'); }
      app.quit();
      return {installing:true};
    } catch (error) {
      installing = false;
      throw error;
    }
  }
  return {portable, check, download, install, cancel:() => {controller?.abort(); return !!controller;}, open:() => shell.openExternal(REPO+'/releases')};
}

module.exports = {createUpdater, newer, trustedAsset, githubGet, electronFetch};
