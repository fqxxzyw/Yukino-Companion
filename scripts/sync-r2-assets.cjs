'use strict';
/**
 * Sync Yukino Companion release assets, 4 GiB shared resources, and CUDA wheel
 * mirror to Cloudflare R2 via S3-compatible SigV4 API (with multipart upload
 * and strict SHA-256/SHA-1 verification).
 *
 * Credentials are read strictly from environment variables (never hardcoded):
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET (default: yukino-downloads)
 */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '';
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const BUCKET = process.env.R2_BUCKET || 'yukino-downloads';
const ENDPOINT = `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`;
const PART_SIZE = 32 * 1024 * 1024; // 32 MiB multipart chunks
const MULTIPART_THRESHOLD = 48 * 1024 * 1024; // 48 MiB
const RELEASE_VERSION = process.env.R2_RELEASE_VERSION || '0.4.5';

if (!ACCOUNT_ID || !ACCESS_KEY_ID || !SECRET_ACCESS_KEY) {
  console.error('Missing R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY');
  process.exit(1);
}

const sha256Hex = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

function encodeS3Key(key) {
  return key.split('/').map(seg => encodeURIComponent(seg).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())).join('/');
}

function signRequest({ method, key, query = {}, headers = {}, payloadHash = 'UNSIGNED-PAYLOAD' }) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const host = `${ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${BUCKET}/${encodeS3Key(key)}`;
  const queryEntries = Object.entries(query)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  const canonicalQuery = queryEntries
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');

  const hdrs = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  for (const [k, v] of Object.entries(headers)) {
    if (v !== undefined && v !== null) hdrs[k.toLowerCase()] = String(v).trim();
  }
  const sortedKeys = Object.keys(hdrs).sort();
  const canonicalHeaders = sortedKeys.map(k => `${k}:${hdrs[k]}\n`).join('');
  const signedHeaders = sortedKeys.join(';');
  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n');

  const kDate = hmac(`AWS4${SECRET_ACCESS_KEY}`, dateStamp);
  const kRegion = hmac(kDate, 'auto');
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const auth = `AWS4-HMAC-SHA256 Credential=${ACCESS_KEY_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const reqHeaders = { ...hdrs, authorization: auth };
  delete reqHeaders.host;
  const url = `${ENDPOINT}${canonicalUri}${canonicalQuery ? '?' + canonicalQuery : ''}`;
  return { url, headers: reqHeaders };
}

async function s3Request({ method, key, query, headers, body, payloadHash, retries = 4 }) {
  const hash = payloadHash || (body ? sha256Hex(body) : sha256Hex(''));
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const signed = signRequest({ method, key, query, headers, payloadHash: hash });
      const res = await fetch(signed.url, {
        method,
        headers: signed.headers,
        body,
        signal: AbortSignal.timeout(180000),
      });
      if (res.status >= 500 || res.status === 429) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise(r => setTimeout(r, 1500 * attempt));
    }
  }
  throw lastErr;
}

async function headObject(key) {
  const res = await s3Request({ method: 'HEAD', key });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HEAD ${key} failed: HTTP ${res.status}`);
  return {
    size: Number(res.headers.get('content-length') || 0),
    sha256: res.headers.get('x-amz-meta-sha256') || '',
    etag: res.headers.get('etag') || '',
  };
}

async function hashFile(filePath, algorithm = 'sha256', expectedSize = null) {
  const hash = crypto.createHash(algorithm);
  if (algorithm === 'sha1') {
    const size = expectedSize ?? (await fsp.stat(filePath)).size;
    hash.update(`blob ${size}\0`);
  }
  for await (const chunk of fs.createReadStream(filePath, { highWaterMark: 4 * 1024 * 1024 })) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

function contentTypeFor(key) {
  if (key.endsWith('.html')) return 'text/html; charset=utf-8';
  if (key.endsWith('.json')) return 'application/json; charset=utf-8';
  if (key.endsWith('.yml') || key.endsWith('.yaml')) return 'text/yaml; charset=utf-8';
  if (key.endsWith('.txt') || key.endsWith('.md')) return 'text/plain; charset=utf-8';
  if (key.endsWith('.exe')) return 'application/x-msdownload';
  if (key.endsWith('.zip') || key.endsWith('.whl')) return 'application/zip';
  return 'application/octet-stream';
}

function cacheControlFor(key) {
  if (key.endsWith('latest.yml') || key.endsWith('latest.json') || key.endsWith('index.html')) {
    return 'public, max-age=300';
  }
  return 'public, max-age=31536000, immutable';
}

async function uploadBuffer({ key, buffer, sha256, contentType }) {
  const digest = sha256 || sha256Hex(buffer);
  const existing = await headObject(key);
  if (existing && existing.size === buffer.length && existing.sha256 === digest) {
    console.log(`  [SKIP] ${key} (${buffer.length} B, sha256 verified)`);
    return { key, bytes: buffer.length, sha256: digest, skipped: true };
  }
  const res = await s3Request({
    method: 'PUT',
    key,
    headers: {
      'content-type': contentType || contentTypeFor(key),
      'cache-control': cacheControlFor(key),
      'x-amz-meta-sha256': digest,
    },
    body: buffer,
    payloadHash: digest,
  });
  if (!res.ok) throw new Error(`PUT ${key} failed: HTTP ${res.status} ${await res.text()}`);
  console.log(`  [PUT]  ${key} (${buffer.length} B)`);
  return { key, bytes: buffer.length, sha256: digest, skipped: false };
}

async function uploadFile({ key, filePath, expectedBytes, expectedSha256 }) {
  const stat = await fsp.stat(filePath);
  if (expectedBytes && stat.size !== expectedBytes) {
    throw new Error(`Size mismatch for ${key}: got ${stat.size}, expected ${expectedBytes}`);
  }
  const sha256 = expectedSha256 || await hashFile(filePath, 'sha256');
  const existing = await headObject(key);
  if (existing && existing.size === stat.size && existing.sha256 === sha256) {
    console.log(`  [SKIP] ${key} (${(stat.size / 1048576).toFixed(2)} MiB, already verified in R2)`);
    return { key, bytes: stat.size, sha256, skipped: true };
  }

  if (stat.size <= MULTIPART_THRESHOLD) {
    const buffer = await fsp.readFile(filePath);
    return uploadBuffer({ key, buffer, sha256 });
  }

  // S3 Multipart Upload for large files (> 48 MiB)
  const initRes = await s3Request({
    method: 'POST',
    key,
    query: { uploads: '' },
    headers: {
      'content-type': contentTypeFor(key),
      'cache-control': cacheControlFor(key),
      'x-amz-meta-sha256': sha256,
    },
  });
  const initXml = await initRes.text();
  if (!initRes.ok) throw new Error(`InitiateMultipart ${key} failed: HTTP ${initRes.status} ${initXml}`);
  const match = /<UploadId>([^<]+)<\/UploadId>/.exec(initXml);
  if (!match) throw new Error(`Missing UploadId for ${key}: ${initXml}`);
  const uploadId = match[1];

  const totalParts = Math.ceil(stat.size / PART_SIZE);
  const etags = new Array(totalParts);
  const fh = await fsp.open(filePath, 'r');
  try {
    let nextPart = 0;
    const concurrency = 4;
    const worker = async () => {
      while (true) {
        const idx = nextPart++;
        if (idx >= totalParts) return;
        const partNumber = idx + 1;
        const offset = idx * PART_SIZE;
        const length = Math.min(PART_SIZE, stat.size - offset);
        const buf = Buffer.allocUnsafe(length);
        let readTotal = 0;
        while (readTotal < length) {
          const r = await fh.read(buf, readTotal, length - readTotal, offset + readTotal);
          if (!r.bytesRead) throw new Error(`Unexpected EOF reading ${filePath}`);
          readTotal += r.bytesRead;
        }
        const partHash = sha256Hex(buf);
        const partRes = await s3Request({
          method: 'PUT',
          key,
          query: { partNumber, uploadId },
          headers: { 'content-length': length },
          body: buf,
          payloadHash: partHash,
        });
        if (!partRes.ok) {
          throw new Error(`UploadPart ${key} #${partNumber} failed: HTTP ${partRes.status} ${await partRes.text()}`);
        }
        const etag = partRes.headers.get('etag');
        if (!etag) throw new Error(`Missing ETag for ${key} part ${partNumber}`);
        etags[idx] = { partNumber, etag };
        process.stdout.write(`    ${key}: part ${partNumber}/${totalParts} (${((offset + length) / 1048576).toFixed(1)}/${(stat.size / 1048576).toFixed(1)} MiB)\r`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, totalParts) }, worker));
    process.stdout.write('\n');

    const completeXml =
      '<CompleteMultipartUpload>' +
      etags.map(p => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${p.etag}</ETag></Part>`).join('') +
      '</CompleteMultipartUpload>';
    const completeBuf = Buffer.from(completeXml, 'utf8');
    const compRes = await s3Request({
      method: 'POST',
      key,
      query: { uploadId },
      headers: { 'content-type': 'application/xml' },
      body: completeBuf,
      payloadHash: sha256Hex(completeBuf),
    });
    const compBody = await compRes.text();
    if (!compRes.ok || compBody.includes('<Error>')) {
      throw new Error(`CompleteMultipart ${key} failed: HTTP ${compRes.status} ${compBody}`);
    }
    console.log(`  [MPU]  ${key} (${(stat.size / 1048576).toFixed(2)} MiB, ${totalParts} parts)`);
    return { key, bytes: stat.size, sha256, skipped: false };
  } catch (err) {
    await s3Request({ method: 'DELETE', key, query: { uploadId } }).catch(() => {});
    throw err;
  } finally {
    await fh.close();
  }
}

async function downloadToTemp(urls, destPath, { expectedBytes, algorithm = 'sha256', expectedDigest }) {
  for (const url of urls) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const partPath = destPath + '.part';
      try {
        console.log(`  [DL]   ${url} (attempt ${attempt})`);
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Yukino-R2-Sync/0.4.5' },
          signal: AbortSignal.timeout(600000),
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        await fsp.mkdir(path.dirname(destPath), { recursive: true });
        const out = fs.createWriteStream(partPath);
        const hash = crypto.createHash(algorithm);
        if (algorithm === 'sha1' && expectedBytes) hash.update(`blob ${expectedBytes}\0`);
        let received = 0;
        let lastLog = Date.now();
        for await (const chunk of res.body) {
          const buf = Buffer.from(chunk);
          received += buf.length;
          if (expectedBytes && received > expectedBytes) throw new Error('Exceeds expected size');
          hash.update(buf);
          if (!out.write(buf)) await new Promise(r => out.once('drain', r));
          if (Date.now() - lastLog > 4000) {
            lastLog = Date.now();
            process.stdout.write(`    downloading ${(received / 1048576).toFixed(1)}${expectedBytes ? '/' + (expectedBytes / 1048576).toFixed(1) : ''} MiB\r`);
          }
        }
        await new Promise((resEnd, rejEnd) => { out.on('error', rejEnd); out.end(resEnd); });
        process.stdout.write('\n');
        if (expectedBytes && received !== expectedBytes) throw new Error(`Size mismatch: ${received} != ${expectedBytes}`);
        const got = hash.digest('hex');
        if (expectedDigest && got !== expectedDigest) throw new Error(`Digest mismatch (${algorithm}): ${got} != ${expectedDigest}`);
        await fsp.rename(partPath, destPath);
        const sha256 = algorithm === 'sha256' ? got : await hashFile(destPath, 'sha256');
        return { filePath: destPath, bytes: received, sha256 };
      } catch (err) {
        await fsp.rm(partPath, { force: true }).catch(() => {});
        console.warn(`  [WARN] Failed ${url} attempt ${attempt}: ${err.message}`);
        if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt));
      }
    }
  }
  throw new Error(`All download sources failed for ${destPath}`);
}

function buildResourceList() {
  const voice = JSON.parse(fs.readFileSync(path.join(ROOT, 'resources/voice-models.json'), 'utf8'));
  const translation = JSON.parse(fs.readFileSync(path.join(ROOT, 'translation/model-manifest.json'), 'utf8'));
  const packs = JSON.parse(fs.readFileSync(path.join(ROOT, 'resources/resource-packs.json'), 'utf8'));
  const runtime = JSON.parse(fs.readFileSync(path.join(ROOT, 'resources/runtime-catalog.json'), 'utf8'));
  const appData = path.join(process.env.APPDATA || '', 'yukino-companion');

  const items = [];
  const seen = new Set();
  const add = (asset, item, localCandidates = []) => {
    if (seen.has(asset)) return;
    seen.add(asset);
    const ghMirror = `https://github.com/fqxxzyw/Yukino-Companion/releases/download/v0.4.0-resources.1/${asset}`;
    items.push({
      key: `resources/v0.4.0-resources.1/${asset}`,
      asset,
      bytes: item.bytes,
      algorithm: item.algorithm || 'sha256',
      digest: item.digest,
      urls: [ghMirror, item.url].filter((u, i, a) => u && a.indexOf(u) === i),
      localCandidates,
    });
  };

  for (const pack of Object.values(voice.packs)) {
    for (const file of pack.files) {
      const asset = 'voice__' + file.path.replace(/\//g, '__');
      add(asset, file, [path.join(appData, 'speech-models', file.path)]);
    }
  }
  for (const file of translation.files) {
    const asset = 'translation__' + file.path.replace(/\//g, '__');
    add(asset, {
      url: `${translation.baseUrl}/${file.path}`,
      bytes: file.size,
      algorithm: 'sha256',
      digest: file.sha256,
    }, [path.join(appData, 'translation-runtime', 'models', translation.directory || translation.id, file.path)]);
  }
  add('chat__Yukino-Local-1.5B-Persona-0.4.0.zip', {
    url: packs.packs.chat.url,
    bytes: packs.packs.chat.bytes,
    algorithm: 'sha256',
    digest: packs.packs.chat.sha256,
  });
  add('pet__YukinoVoices.zip', {
    url: packs.packs.pet.url,
    bytes: packs.packs.pet.bytes,
    algorithm: 'sha256',
    digest: packs.packs.pet.sha256,
  });
  for (const part of runtime.variants.cpu.parts) {
    add('runtime__' + part.path.replace(/\//g, '__'), part);
  }
  return items;
}

async function findVerifiedLocal(candidates, bytes, algorithm, digest) {
  for (const candidate of candidates) {
    try {
      const st = await fsp.stat(candidate);
      if (!st.isFile() || st.size !== bytes) continue;
      const got = await hashFile(candidate, algorithm, bytes);
      if (got === digest) {
        const sha256 = algorithm === 'sha256' ? got : await hashFile(candidate, 'sha256');
        return { filePath: candidate, sha256 };
      }
    } catch {}
  }
  return null;
}

async function main() {
  const mode = process.argv[2] || 'all';
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'yukino-r2-sync-'));
  const summary = { uploaded: 0, skipped: 0, totalBytes: 0, keys: [] };
  const record = (r) => {
    if (r.skipped) summary.skipped++; else summary.uploaded++;
    summary.totalBytes += r.bytes;
    summary.keys.push({ key: r.key, bytes: r.bytes, sha256: r.sha256 });
  };

  try {
    // 1. Release 0.4.5 assets (local release/0.4.5/)
    if (mode === 'all' || mode === 'release') {
      console.log(`\n=== [1/4] Syncing release v${RELEASE_VERSION} ===`);
      const releaseDir = path.join(ROOT, 'release', RELEASE_VERSION);
      const files = await fsp.readdir(releaseDir);
      for (const name of files.sort()) {
        const full = path.join(releaseDir, name);
        const st = await fsp.stat(full);
        if (!st.isFile()) continue;
        const sha256 = await hashFile(full, 'sha256');
        record(await uploadFile({ key: `releases/v${RELEASE_VERSION}/${name}`, filePath: full, expectedBytes: st.size, expectedSha256: sha256 }));
      }
      // Also sync tiny historical blockmaps for 0.4.2 / 0.4.3 / 0.4.4 so R2-only incremental deltas work
      for (const oldVer of ['0.4.2', '0.4.3', '0.4.4']) {
        const bmName = `Yukino-Companion-${oldVer}-Base-Setup.exe.blockmap`;
        const bmKey = `releases/v${oldVer}/${bmName}`;
        const existing = await headObject(bmKey);
        if (existing && existing.size > 1000) {
          console.log(`  [SKIP] ${bmKey} (${existing.size} B, already in R2)`);
          record({ key: bmKey, bytes: existing.size, sha256: existing.sha256, skipped: true });
          continue;
        }
        const bmUrl = `https://github.com/fqxxzyw/Yukino-Companion/releases/download/v${oldVer}/${bmName}`;
        const r = await fetch(bmUrl, { headers: { 'User-Agent': 'Yukino-R2-Sync/0.4.5' }, signal: AbortSignal.timeout(60000) });
        if (!r.ok) { console.warn(`  [WARN] Could not fetch ${bmUrl}: HTTP ${r.status}`); continue; }
        const buf = Buffer.from(await r.arrayBuffer());
        record(await uploadBuffer({ key: bmKey, buffer: buf }));
      }
    }

    // 2. Shared 4.24 GiB resources (v0.4.0-resources.1)
    if (mode === 'all' || mode === 'resources') {
      console.log('\n=== [2/4] Syncing shared 4.24 GiB resources (v0.4.0-resources.1) ===');
      const items = buildResourceList();
      for (const item of items) {
        const existing = await headObject(item.key);
        if (existing && existing.size === item.bytes && (item.algorithm !== 'sha256' || existing.sha256 === item.digest)) {
          console.log(`  [SKIP] ${item.key} (${(item.bytes / 1048576).toFixed(2)} MiB, already verified in R2)`);
          record({ key: item.key, bytes: item.bytes, sha256: existing.sha256, skipped: true });
          continue;
        }
        const local = await findVerifiedLocal(item.localCandidates, item.bytes, item.algorithm, item.digest);
        if (local) {
          console.log(`  [LOCAL] Reusing verified local copy for ${item.asset}`);
          record(await uploadFile({ key: item.key, filePath: local.filePath, expectedBytes: item.bytes, expectedSha256: local.sha256 }));
          continue;
        }
        const tmpFile = path.join(tempRoot, item.asset);
        try {
          const dl = await downloadToTemp(item.urls, tmpFile, {
            expectedBytes: item.bytes,
            algorithm: item.algorithm,
            expectedDigest: item.digest,
          });
          record(await uploadFile({ key: item.key, filePath: dl.filePath, expectedBytes: item.bytes, expectedSha256: dl.sha256 }));
        } finally {
          await fsp.rm(tmpFile, { force: true }).catch(() => {});
        }
      }
      // Upload provenance notice
      const notice = Buffer.from(
        'Yukino Companion R2 resource mirror (v0.4.0-resources.1)\n' +
        'Bytes are copied unchanged and digest-verified from their pinned upstream URLs.\n',
        'utf8'
      );
      record(await uploadBuffer({ key: 'resources/v0.4.0-resources.1/RESOURCE-SOURCES.txt', buffer: notice }));
    }

    // 3. CUDA 12.4 llama-cpp-python wheel + PEP 503 index
    if (mode === 'all' || mode === 'wheels') {
      console.log('\n=== [3/4] Syncing CUDA 12.4 llama-cpp-python wheel mirror ===');
      const whlName = 'llama_cpp_python-0.3.36-py3-none-win_amd64.whl';
      const whlSha = '7086b98420cf9cca5e3f14181edc4332038bfb0a0e380370a693806bb527911f';
      const whlBytes = 511381574;
      const whlKey = `wheels/cu124/llama-cpp-python/${whlName}`;
      const existing = await headObject(whlKey);
      if (existing && existing.size === whlBytes && existing.sha256 === whlSha) {
        console.log(`  [SKIP] ${whlKey} (${(whlBytes / 1048576).toFixed(2)} MiB, already verified in R2)`);
        record({ key: whlKey, bytes: whlBytes, sha256: whlSha, skipped: true });
      } else {
        const tmpWhl = path.join(tempRoot, whlName);
        try {
          const dl = await downloadToTemp([
            `https://github.com/abetlen/llama-cpp-python/releases/download/v0.3.36-cu124/${whlName}`,
          ], tmpWhl, { expectedBytes: whlBytes, algorithm: 'sha256', expectedDigest: whlSha });
          record(await uploadFile({ key: whlKey, filePath: dl.filePath, expectedBytes: whlBytes, expectedSha256: whlSha }));
        } finally {
          await fsp.rm(tmpWhl, { force: true }).catch(() => {});
        }
      }
      const rootIndex = Buffer.from(
        '<!DOCTYPE html>\n<html><head><title>Yukino CUDA 12.4 Wheel Mirror</title></head><body>\n' +
        '<a href="llama-cpp-python/">llama-cpp-python</a><br/>\n</body></html>\n',
        'utf8'
      );
      const pkgIndex = Buffer.from(
        '<!DOCTYPE html>\n<html><head><title>Links for llama-cpp-python</title></head><body>\n' +
        `<a href="${whlName}#sha256=${whlSha}">${whlName}</a><br/>\n</body></html>\n`,
        'utf8'
      );
      record(await uploadBuffer({ key: 'wheels/cu124/index.html', buffer: rootIndex }));
      record(await uploadBuffer({ key: 'wheels/cu124/llama-cpp-python/index.html', buffer: pkgIndex }));
    }

    // 4. Write summary manifest
    if (mode === 'all' || mode === 'release') {
      console.log('\n=== [4/4] Publishing R2 latest release manifest ===');
      const setupPath = path.join(ROOT, 'release', RELEASE_VERSION, `Yukino-Companion-${RELEASE_VERSION}-Base-Setup.exe`);
      const portablePath = path.join(ROOT, 'release', RELEASE_VERSION, `Yukino-Companion-${RELEASE_VERSION}-Portable.exe`);
      const latestYmlPath = path.join(ROOT, 'release', RELEASE_VERSION, 'latest.yml');
      const notesPath = path.join(ROOT, 'docs', 'releases', `v${RELEASE_VERSION}.md`);
      const setupSize = (await fsp.stat(setupPath)).size;
      const portableSize = (await fsp.stat(portablePath)).size;
      const body = fs.existsSync(notesPath) ? await fsp.readFile(notesPath, 'utf8') : '';
      const latestYml = await fsp.readFile(latestYmlPath, 'utf8');
      const releaseDateMatch = /releaseDate:\s*'([^']+)'/.exec(latestYml);
      const manifest = {
        schemaVersion: 1,
        tag_name: `v${RELEASE_VERSION}`,
        version: RELEASE_VERSION,
        name: `Yukino Companion ${RELEASE_VERSION}`,
        draft: false,
        prerelease: false,
        published_at: releaseDateMatch ? releaseDateMatch[1] : new Date().toISOString(),
        body,
        assets: [
          {
            name: `Yukino-Companion-${RELEASE_VERSION}-Base-Setup.exe`,
            size: setupSize,
            browser_download_url: `https://dl.yukino.fqxxzyw.cn/releases/v${RELEASE_VERSION}/Yukino-Companion-${RELEASE_VERSION}-Base-Setup.exe`,
            github_download_url: `https://github.com/fqxxzyw/Yukino-Companion/releases/download/v${RELEASE_VERSION}/Yukino-Companion-${RELEASE_VERSION}-Base-Setup.exe`,
            content_type: 'application/x-msdownload',
          },
          {
            name: `Yukino-Companion-${RELEASE_VERSION}-Portable.exe`,
            size: portableSize,
            browser_download_url: `https://dl.yukino.fqxxzyw.cn/releases/v${RELEASE_VERSION}/Yukino-Companion-${RELEASE_VERSION}-Portable.exe`,
            github_download_url: `https://github.com/fqxxzyw/Yukino-Companion/releases/download/v${RELEASE_VERSION}/Yukino-Companion-${RELEASE_VERSION}-Portable.exe`,
            content_type: 'application/x-msdownload',
          },
          {
            name: 'latest.yml',
            size: Buffer.byteLength(latestYml, 'utf8'),
            browser_download_url: `https://dl.yukino.fqxxzyw.cn/releases/v${RELEASE_VERSION}/latest.yml`,
            github_download_url: `https://github.com/fqxxzyw/Yukino-Companion/releases/download/v${RELEASE_VERSION}/latest.yml`,
            content_type: 'text/yaml; charset=utf-8',
          },
        ],
      };
      record(await uploadBuffer({ key: 'releases/latest.json', buffer: Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8') }));
    }

    console.log('\n=== R2 SYNC COMPLETE ===');
    console.log(JSON.stringify({
      uploaded: summary.uploaded,
      skipped: summary.skipped,
      totalGiB: Number((summary.totalBytes / 1073741824).toFixed(3)),
      totalBytes: summary.totalBytes,
      objectCount: summary.keys.length,
    }, null, 2));
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch(err => {
  console.error('SYNC FAILED:', err);
  process.exit(1);
});
