'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { gunzipSync } = require('node:zlib');
const { computeOperations, OperationKind } = require('electron-updater/out/differentialDownloader/downloadPlanBuilder');

async function limitedBody(response, limit) {
  const parts = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > limit) throw Error('更新元数据过大');
    parts.push(chunk);
  }
  return Buffer.concat(parts);
}

function parseBlockmap(bytes, fileSize) {
  const map = JSON.parse(gunzipSync(bytes, { maxOutputLength: 32 * 1024 ** 2 }));
  const file = map.files?.[0];
  if (String(map.version) !== '2' || map.files.length !== 1 || file.name !== 'file' || file.offset !== 0 ||
      !Array.isArray(file.sizes) || !Array.isArray(file.checksums) || file.sizes.length !== file.checksums.length ||
      !file.sizes.every(size => Number.isSafeInteger(size) && size > 0) ||
      !file.checksums.every(hash => typeof hash === 'string' && /^[a-zA-Z0-9+/]{24}$/.test(hash)) ||
      file.sizes.reduce((sum, size) => sum + size, 0) !== fileSize) {
    throw Error('区块表无效');
  }
  return map;
}

async function fetchMap(urlOrUrls, size, get, signal) {
  const urls = (Array.isArray(urlOrUrls) ? urlOrUrls : [urlOrUrls]).filter(Boolean);
  let lastError;
  for (const url of urls) {
    signal?.throwIfAborted();
    try {
      const data = await limitedBody(await get(url, {signal}), 8 * 1024 ** 2);
      return {data, map: parseBlockmap(data, size)};
    } catch (error) {
      signal?.throwIfAborted();
      lastError = error;
    }
  }
  throw lastError || Error('无法获取区块表');
}

async function verifyFile(filename, {size, sha512}) {
  if ((await fsp.stat(filename)).size !== size) throw Error('安装包大小不符');
  const hash = createHash('sha512');
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
  if (hash.digest('base64') !== sha512) throw Error('安装包 SHA-512 校验失败，请重新下载。');
}

async function planDownload({cache, release, oldMapUrl, get, signal}) {
  const oldFile = path.join(cache, 'installer.exe');
  const oldSize = (await fsp.stat(oldFile)).size;
  let previous;
  const cachedMap = path.join(cache, 'current.blockmap');
  try {
    if ((await fsp.stat(cachedMap)).size > 8 * 1024 ** 2) throw Error('原区块表过大');
    previous = parseBlockmap(await fsp.readFile(cachedMap), oldSize);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const old = await fetchMap(oldMapUrl, oldSize, get, signal);
    previous = old.map;
    await fsp.writeFile(cachedMap, old.data, {flag:'wx'});
  }
  const next = await fetchMap([release.mapUrl, release.fallbackMapUrl], release.size, get, signal);
  const operations = computeOperations(previous, next.map, {info(){}, warn(){}});
  const total = operations.reduce((sum, op) => sum + (op.kind === OperationKind.DOWNLOAD ? op.end - op.start : 0), 0);
  if (total >= release.size) throw Error('没有可复用的区块');
  return {oldFile, operations, total, blockmap:next.data};
}

// Stream copy and network ranges through one bounded writer. A server ignoring
// Range must never turn a partial operation into an unbounded full transfer.
async function transfer({part, plan, release, get, signal, progress}) {
  const total = plan?.total ?? release.size;
  const differential = !!plan;
  const sources = [...new Set([release.url, release.fallbackUrl].filter(Boolean))];
  let sourceIndex = 0;
  let bytes = 0, last = 0, written = 0;
  const notify = () => progress({bytes, total, differential, fullSize:release.size, percent:total ? 100 * bytes / total : 100});
  notify();
  const handle = await fsp.open(part, 'wx');
  const hash = createHash('sha512');
  try {
    const operations = plan?.operations || [{kind:OperationKind.DOWNLOAD, start:0, end:release.size}];
    for (const op of operations) {
      signal.throwIfAborted();
      const download = op.kind === OperationKind.DOWNLOAD;
      const count = op.end - op.start;
      let input;
      if (download) {
        const headers = plan ? {Range:'bytes=' + op.start + '-' + (op.end-1)} : {};
        let response;
        while (true) {
          signal.throwIfAborted();
          try {
            response = await get(sources[sourceIndex], {headers, signal, timeout:30*60*1000});
            if (plan && (response.status !== 206 || response.headers.get('content-range') !== 'bytes '+op.start+'-'+(op.end-1)+'/'+release.size)) {
              await response.body?.cancel();
              throw Error('服务器不支持所需的 Range 请求');
            }
            break;
          } catch (error) {
            signal.throwIfAborted();
            if (sourceIndex + 1 < sources.length) {
              sourceIndex += 1;
              continue;
            }
            throw error;
          }
        }
        input = response.body;
      } else {
        input = fs.createReadStream(plan.oldFile, {start:op.start, end:op.end-1, signal});
      }
      let consumed = 0;
      for await (const chunk of input) {
        signal.throwIfAborted();
        consumed += chunk.length;
        if (consumed > count) throw Error('安装包大小不符');
        hash.update(chunk);
        await handle.writeFile(chunk);
        if (download) {
          bytes += chunk.length;
          if (Date.now() - last >= 200) { notify(); last = Date.now(); }
        }
      }
      if (consumed !== count) throw Error('安装包大小不符，下载可能被中断');
      written += consumed;
    }
    if (written !== release.size) throw Error('安装包大小不符');
    if (hash.digest('base64') !== release.sha512) throw Error('安装包 SHA-512 校验失败，请重新下载。');
    await handle.sync();
    notify();
    return {bytes, total, fullSize:release.size, differential};
  } finally {
    await handle.close();
  }
}

module.exports = {limitedBody, planDownload, verifyFile, transfer};
