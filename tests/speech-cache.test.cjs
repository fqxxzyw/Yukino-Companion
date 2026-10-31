const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { SpeechCache, MAX_AUDIO_BYTES } = require('../electron/speech-cache.cjs');

const DAY = 86400000;
const KEY = 'a'.repeat(64);
const SECOND = 'b'.repeat(64);
const filename = key => `yukino-speech-v1-${key}.wav`;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const ioError = code => Object.assign(new Error(`private transcript C:/private/conversation (${code})`), { code });

function chunk(name, data) {
  const header = Buffer.alloc(8); header.write(name); header.writeUInt32LE(data.length, 4);
  return Buffer.concat([header, data, ...(data.length & 1 ? [Buffer.alloc(1)] : [])]);
}
function wave({ format = 1, bits = 16, extensible = false, extra = false, sample = 12 } = {}) {
  const fmt = Buffer.alloc(extensible ? 40 : 16);
  fmt.writeUInt16LE(extensible ? 0xfffe : format); fmt.writeUInt16LE(1, 2); fmt.writeUInt32LE(24000, 4);
  fmt.writeUInt32LE(24000 * bits / 8, 8); fmt.writeUInt16LE(bits / 8, 12); fmt.writeUInt16LE(bits, 14);
  if (extensible) {
    fmt.writeUInt16LE(22, 16); fmt.writeUInt16LE(bits, 18); fmt.writeUInt32LE(format, 24);
    Buffer.from('00001000800000aa00389b71', 'hex').copy(fmt, 28);
  }
  const header = Buffer.from('RIFF0000WAVE');
  const parts = [header, chunk('fmt ', fmt)];
  if (extra) parts.push(chunk('JUNK', Buffer.from([1, 2, 3])));
  parts.push(chunk('data', Buffer.alloc(bits / 8 * 8, sample)));
  const audio = Buffer.concat(parts); audio.writeUInt32LE(audio.length - 8, 4);
  return audio;
}
async function fixture(t, { enabled = true } = {}) {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'yukino-speech-cache-test-'));
  const root = path.join(sandbox, 'audio-cache');
  let time = 1800000000000;
  const cache = new SpeechCache({ root, now: () => time });
  t.after(() => fs.rm(sandbox, { recursive: true, force: true }));
  if (enabled) assert.equal((await cache.configure({ enabled: true })).error, null);
  return { sandbox, root, cache, advance: value => { time += value; }, get time() { return time; } };
}
async function names(root) { return (await fs.readdir(root)).sort(); }
async function age(file, milliseconds) { const time = new Date(milliseconds); await fs.utimes(file, time, time); }

// These tests use only fresh OS temporary directories and synthetic WAV bytes.
test('off by default: status/read/write/prune/disabled configuration never create root', async t => {
  const { root, cache } = await fixture(t, { enabled: false });
  assert.deepEqual(await cache.status(), { enabled: false, retentionDays: 7, root, files: 0, bytes: 0, error: null });
  assert.equal(await cache.read(KEY), null);
  assert.equal(await cache.write(KEY, wave()), false);
  assert.deepEqual(await cache.prune(), { removed: 0, error: null });
  assert.equal((await cache.configure({ enabled: false, retentionDays: 30 })).retentionDays, 30);
  await assert.rejects(fs.lstat(root), { code: 'ENOENT' });
});

test('enabled getter is read-only and performs no filesystem work on the disabled synthesis hot path', async t => {
  const { cache } = await fixture(t, { enabled: false });
  let calls = 0;
  t.mock.method(fs, 'lstat', async () => { calls++; throw ioError('EIO'); });
  for (let n = 0; n < 100; n++) assert.equal(cache.enabled, false);
  assert.equal(calls, 0);
  const descriptor = Object.getOwnPropertyDescriptor(SpeechCache.prototype, 'enabled');
  assert.equal(typeof descriptor.get, 'function'); assert.equal(descriptor.set, undefined);
});

test('constructor and configuration reject invalid paths, options and retention without modifying config', async t => {
  assert.throws(() => new SpeechCache({ root: 'relative-cache' }), TypeError);
  assert.throws(() => new SpeechCache({ root: path.parse(process.cwd()).root }), TypeError);
  assert.throws(() => new SpeechCache({ root: path.resolve('cache'), now: 4 }), TypeError);
  const { cache, root } = await fixture(t, { enabled: false });
  for (const retentionDays of [0, 31, 1.5, NaN, '7', null]) await assert.rejects(cache.configure({ enabled: true, retentionDays }), TypeError);
  for (const enabled of ['true', null, 1]) await assert.rejects(cache.configure({ enabled }), TypeError);
  for (const options of [null, true, []]) await assert.rejects(cache.configure(options), TypeError);
  assert.equal((await cache.status()).enabled, false);
  await assert.rejects(fs.lstat(root), { code: 'ENOENT' });
});

test('valid PCM is written atomically under a hash-only name and round-trips exact bytes', async t => {
  const { cache, root } = await fixture(t);
  const audio = wave();
  assert.equal(await cache.write(KEY, audio), true);
  assert.deepEqual(await cache.read(KEY), audio);
  assert.deepEqual(await names(root), [filename(KEY)]);
  const status = await cache.status();
  assert.equal(status.files, 1); assert.equal(status.bytes, audio.length); assert.equal(status.error, null);
});

test('supported padded chunks, PCM 8/24/32-bit, float and extensible formats validate', async t => {
  const { cache } = await fixture(t);
  const options = [{ extra: true }, { bits: 8 }, { bits: 24 }, { bits: 32 }, { format: 3, bits: 32 }, { format: 3, bits: 64 }, { extensible: true }, { format: 3, bits: 32, extensible: true }];
  for (let index = 0; index < options.length; index++) {
    const key = index.toString(16).padStart(64, '0'), audio = wave(options[index]);
    assert.equal(await cache.write(key, audio), true, JSON.stringify(options[index]));
    assert.deepEqual(await cache.read(key), audio);
  }
});

test('write snapshots its input Buffer rather than retaining mutable caller audio', async t => {
  const { cache } = await fixture(t);
  const audio = wave(), expected = Buffer.from(audio);
  const result = cache.write(KEY, audio); audio.fill(0);
  assert.equal(await result, true); assert.deepEqual(await cache.read(KEY), expected);
});

test('key must be exactly 64 lowercase hexadecimal characters; no traversal or coercion', async t => {
  const { cache, root } = await fixture(t);
  for (const key of ['../outside', 'A'.repeat(64), 'a'.repeat(63), 'g'.repeat(64), `${KEY}/x`, null, { toString: () => KEY }]) {
    assert.equal(await cache.write(key, wave()), false);
    assert.equal(await cache.read(key), null);
  }
  assert.deepEqual(await names(root), []);
  assert.equal((await cache.status()).error.code, 'INVALID_KEY');
});

test('malformed, unsupported, truncated and oversized audio never reaches disk', async t => {
  const { cache, root } = await fixture(t);
  const mismatch = wave(); mismatch.writeUInt32LE(1, 4);
  const chunkOverflow = wave(); chunkOverflow.writeUInt32LE(0xffffffff, 40);
  const noFmt = wave(); noFmt.write('JUNK', 12);
  const badRate = wave(); badRate.writeUInt32LE(1, 28);
  const badAlign = wave(); badAlign.writeUInt16LE(7, 32);
  const highBitHeader = wave(); highBitHeader[0] |= 128;
  const zeroData = wave(); zeroData.writeUInt32LE(0, 40);
  const badExt = wave({ extensible: true }); badExt[48] = 255;
  for (const audio of [null, 'RIFF', new Uint8Array(wave()), Buffer.from('HTTP synthesis failed'), wave().subarray(0, 43), mismatch, chunkOverflow, noFmt, badRate, badAlign, highBitHeader, zeroData, badExt, wave({ format: 6 }), Buffer.alloc(MAX_AUDIO_BYTES + 1)]) {
    assert.equal(await cache.write(KEY, audio), false);
  }
  assert.equal((await cache.status()).error.code, 'INVALID_AUDIO');
  assert.deepEqual(await names(root), []);
});

test('neither existing audio nor unrelated pre-existing bytes are overwritten', async t => {
  const { cache, root, time } = await fixture(t);
  const first = wave({ sample: 1 });
  assert.equal(await cache.write(KEY, first), true);
  assert.equal(await cache.write(KEY, wave({ sample: 2 })), false);
  assert.deepEqual(await cache.read(KEY), first);
  const unknown = Buffer.from('not our audio');
  await fs.writeFile(path.join(root, filename(SECOND)), unknown);
  await age(path.join(root, filename(SECOND)), time);
  assert.equal(await cache.write(SECOND, wave()), false);
  assert.deepEqual(await fs.readFile(path.join(root, filename(SECOND))), unknown);
  assert.deepEqual(await names(root), [filename(KEY), filename(SECOND)]);
});

test('cache miss and corrupt/oversized on-disk entries return null, never synthetic fallback audio', async t => {
  const { cache, root, time } = await fixture(t);
  assert.equal(await cache.read(KEY), null);
  await fs.writeFile(path.join(root, filename(KEY)), 'RIFF not audio');
  await age(path.join(root, filename(KEY)), time);
  assert.equal(await cache.read(KEY), null);
  assert.equal((await cache.status()).error.code, 'INVALID_AUDIO');
  const big = path.join(root, filename(SECOND));
  await fs.writeFile(big, ''); await fs.truncate(big, MAX_AUDIO_BYTES + 1); await age(big, time);
  assert.equal(await cache.read(SECOND), null);
  assert.equal((await fs.stat(big)).size, MAX_AUDIO_BYTES + 1);
});

test('reading does not refresh age; expiration is enforced at the exact retention boundary', async t => {
  const f = await fixture(t);
  await f.cache.write(KEY, wave());
  const target = path.join(f.root, filename(KEY)), initial = await fs.stat(target);
  f.advance(7 * DAY - 1);
  assert.ok(await f.cache.read(KEY));
  assert.equal((await fs.stat(target)).mtimeMs, initial.mtimeMs);
  f.advance(1); assert.equal(await f.cache.read(KEY), null);
  assert.deepEqual(await f.cache.prune(), { removed: 1, error: null });
  assert.deepEqual(await names(f.root), []);
});

test('pruning deletes only expired exact owned names, not unrelated files, directories or recent entries', async t => {
  const f = await fixture(t);
  const old = path.join(f.root, filename(KEY));
  const temporary = path.join(f.root, `yukino-speech-v1-${KEY}.${'c'.repeat(32)}.tmp`);
  const unknown = ['notes.txt', `${KEY}.wav`, `yukino-speech-v1-${KEY}.wav.backup`, `yukino-speech-v1-${KEY}.tmp`];
  for (const name of [filename(KEY), path.basename(temporary), ...unknown]) {
    const file = path.join(f.root, name); await fs.writeFile(file, 'keep or expire'); await age(file, f.time - 8 * DAY);
  }
  await fs.mkdir(path.join(f.root, filename(SECOND)));
  const currentKey = 'c'.repeat(64); await f.cache.write(currentKey, wave()); // write performs automatic cleanup
  assert.deepEqual(await f.cache.prune(), { removed: 0, error: null });
  await assert.rejects(fs.lstat(old), { code: 'ENOENT' });
  await assert.rejects(fs.lstat(temporary), { code: 'ENOENT' });
  assert.deepEqual(await names(f.root), [...unknown, filename(SECOND), filename(currentKey)].sort());
});

test('enable, status refresh, shorter retention and writing each run automatic cleanup', async t => {
  const f = await fixture(t);
  await f.cache.write(KEY, wave()); f.advance(2 * DAY);
  assert.equal((await f.cache.configure({ retentionDays: 1 })).files, 0);
  await f.cache.write(KEY, wave()); f.advance(DAY);
  assert.equal((await f.cache.status()).files, 0);
  await f.cache.write(KEY, wave()); await f.cache.configure({ enabled: false }); f.advance(DAY);
  assert.equal((await f.cache.status()).files, 1, 'disabled refresh does not prune');
  assert.deepEqual(await f.cache.prune(), { removed: 0, error: null });
  assert.equal((await f.cache.configure({ enabled: true })).files, 0);
});

test('closing cache preserves files but stops cache hits and writes', async t => {
  const { cache, root } = await fixture(t);
  const audio = wave(); await cache.write(KEY, audio);
  const status = await cache.configure({ enabled: false, retentionDays: 2 });
  assert.equal(status.files, 1); assert.equal(status.bytes, audio.length);
  assert.equal(await cache.read(KEY), null); assert.equal(await cache.write(SECOND, audio), false);
  assert.deepEqual(await fs.readFile(path.join(root, filename(KEY))), audio);
});

test('concurrent writes publish exactly once per key and serialize safely with cleanup', async t => {
  const { cache, root } = await fixture(t);
  const same = await Promise.all(Array.from({ length: 16 }, (_, index) => cache.write(KEY, wave({ sample: index }))));
  assert.equal(same.filter(Boolean).length, 1);
  const pending = Array.from({ length: 12 }, (_, index) => cache.write(index.toString(16).padStart(64, '0'), wave()));
  pending.push(cache.prune(), cache.status()); await Promise.all(pending);
  assert.equal((await cache.status()).files, 13);
  assert.equal((await names(root)).filter(name => name.endsWith('.tmp')).length, 0);
});

test('immediate opt-out invalidates queued writes without even creating a directory', async t => {
  const { cache, root } = await fixture(t, { enabled: false });
  const enable = cache.configure({ enabled: true });
  const writes = Array.from({ length: 8 }, () => cache.write(KEY, wave()));
  const disable = cache.configure({ enabled: false });
  await enable; assert.deepEqual(await Promise.all(writes), Array(8).fill(false));
  assert.equal((await disable).enabled, false);
  await assert.rejects(fs.lstat(root), { code: 'ENOENT' });
});

test('opt-out during an in-flight write leaves no published or temporary audio', async t => {
  const { cache, root } = await fixture(t);
  const entered = deferred(), release = deferred(), original = fs.open;
  t.mock.method(fs, 'open', async function (file, ...args) {
    const handle = await original.call(this, file, ...args);
    if (String(file).endsWith('.tmp')) { entered.resolve(); await release.promise; }
    return handle;
  });
  const write = cache.write(KEY, wave()); await entered.promise;
  const disable = cache.configure({ enabled: false }); release.resolve();
  assert.equal(await write, false); assert.equal((await disable).enabled, false);
  assert.deepEqual(await names(root), []);
});

test('opt-out prevents an in-flight read from returning audio while preserving its existing disk file', async t => {
  const { cache, root } = await fixture(t);
  await cache.write(KEY, wave());
  const entered = deferred(), release = deferred(), original = fs.open;
  const target = path.join(root, filename(KEY));
  t.mock.method(fs, 'open', async function (file, ...args) {
    const handle = await original.call(this, file, ...args);
    if (file === target) { entered.resolve(); await release.promise; }
    return handle;
  });
  const read = cache.read(KEY); await entered.promise;
  const disable = cache.configure({ enabled: false }); release.resolve();
  assert.equal(await read, null); assert.equal((await disable).files, 1);
  assert.deepEqual(await fs.readFile(target), wave());
});

test('opt-out during atomic publication rolls back only the newly published file', async t => {
  const { cache, root } = await fixture(t);
  const entered = deferred(), release = deferred(), original = fs.link;
  t.mock.method(fs, 'link', async function (...args) {
    await original.apply(this, args); entered.resolve(); await release.promise;
  });
  const write = cache.write(KEY, wave()); await entered.promise;
  const disable = cache.configure({ enabled: false }); release.resolve();
  assert.equal(await write, false); await disable;
  assert.deepEqual(await names(root), []);
});

test('opt-out while pruning prevents the pending deletion', async t => {
  const f = await fixture(t);
  await f.cache.write(KEY, wave()); f.advance(8 * DAY);
  const target = path.join(f.root, filename(KEY));
  const entered = deferred(), release = deferred(), original = fs.lstat;
  let intercepted = false;
  t.mock.method(fs, 'lstat', async function (file, ...args) {
    const stat = await original.call(this, file, ...args);
    if (file === target && !intercepted) { intercepted = true; entered.resolve(); await release.promise; }
    return stat;
  });
  const prune = f.cache.prune(); await entered.promise;
  const disable = f.cache.configure({ enabled: false }); release.resolve();
  assert.equal((await prune).removed, 0); await disable;
  assert.ok(await fs.lstat(target));
});

test('a fully flushed temporary file is invisible at the final pathname until publication', async t => {
  const { cache, root } = await fixture(t);
  const entered = deferred(), release = deferred(), original = fs.open;
  t.mock.method(fs, 'open', async function (file, ...args) {
    const handle = await original.call(this, file, ...args);
    if (!String(file).endsWith('.tmp')) return handle;
    return new Proxy(handle, { get(target, name) {
      if (name === 'sync') return async () => { await target.sync(); entered.resolve(); await release.promise; };
      const value = Reflect.get(target, name, target); return typeof value === 'function' ? value.bind(target) : value;
    } });
  });
  const write = cache.write(KEY, wave()); await entered.promise;
  await assert.rejects(fs.readFile(path.join(root, filename(KEY))), { code: 'ENOENT' });
  assert.equal((await names(root)).length, 1); assert.ok((await names(root))[0].endsWith('.tmp'));
  release.resolve(); assert.equal(await write, true);
  assert.deepEqual(await fs.readFile(path.join(root, filename(KEY))), wave());
});

test('write failures clean temporary data and expose sanitized errors without changing original playback bytes', async t => {
  const { cache, root } = await fixture(t);
  const audio = wave(), expected = Buffer.from(audio), original = fs.open;
  t.mock.method(fs, 'open', async function (file, ...args) {
    const handle = await original.call(this, file, ...args);
    return new Proxy(handle, { get(target, name) {
      if (name === 'sync') return async () => { throw ioError('EIO'); };
      const value = Reflect.get(target, name, target); return typeof value === 'function' ? value.bind(target) : value;
    } });
  });
  assert.equal(await cache.write(KEY, audio), false);
  assert.deepEqual(audio, expected); assert.deepEqual(await names(root), []);
  const status = await cache.status();
  assert.equal(status.error.code, 'EIO'); assert.doesNotMatch(JSON.stringify(status.error), /private|transcript|conversation/);
});

test('unwritable installation root is reported, not silently redirected elsewhere', async t => {
  const { cache, root, sandbox } = await fixture(t, { enabled: false });
  t.mock.method(fs, 'open', async () => { throw ioError('EACCES'); });
  const result = await cache.configure({ enabled: true });
  assert.equal(result.root, root); assert.equal(result.error.code, 'EACCES');
  assert.match(result.error.message, /权限/);
  assert.doesNotMatch(JSON.stringify(result.error), /private|transcript|conversation/);
  assert.equal(await cache.write(KEY, wave()), false);
  assert.deepEqual(await names(sandbox), ['audio-cache']); assert.deepEqual(await names(root), []);
});

test('an existing file at root fails closed and is never replaced', async t => {
  const { cache, root } = await fixture(t, { enabled: false });
  await fs.writeFile(root, 'existing user file');
  assert.equal((await cache.configure({ enabled: true })).error.code, 'UNSAFE_PATH');
  assert.equal(await cache.write(KEY, wave()), false);
  assert.equal(await fs.readFile(root, 'utf8'), 'existing user file');
});

test('root and ancestor directory symlinks/junctions are refused without touching their targets', async t => {
  const { sandbox } = await fixture(t, { enabled: false });
  const outside = path.join(sandbox, 'outside'); await fs.mkdir(outside);
  const link = path.join(sandbox, 'redirect');
  try { await fs.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip('directory symlinks unavailable'); throw error; }
  for (const root of [link, path.join(link, 'nested-cache')]) {
    const cache = new SpeechCache({ root });
    assert.equal((await cache.configure({ enabled: true })).error.code, 'UNSAFE_PATH');
    assert.equal(await cache.write(KEY, wave()), false); assert.equal(await cache.read(KEY), null);
    assert.equal((await cache.prune()).error.code, 'UNSAFE_PATH');
  }
  assert.deepEqual(await names(outside), []);
});

test('symlink cache entries are never read, counted, overwritten or pruned', async t => {
  const f = await fixture(t);
  const outside = path.join(f.sandbox, 'outside.wav'); await fs.writeFile(outside, wave()); await age(outside, f.time - 8 * DAY);
  const target = path.join(f.root, filename(KEY));
  try { await fs.symlink(outside, target, 'file'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip('file symlinks unavailable'); throw error; }
  assert.equal(await f.cache.read(KEY), null); assert.equal(await f.cache.write(KEY, wave()), false);
  assert.equal((await f.cache.status()).files, 0);
  assert.equal((await f.cache.prune()).removed, 0);
  assert.ok((await fs.lstat(target)).isSymbolicLink()); assert.deepEqual(await fs.readFile(outside), wave());
});

test('hardlinked entries are never read or overwritten; expiry unlinks only the cache name without touching external audio', async t => {
  const f = await fixture(t);
  const outside = path.join(f.sandbox, 'outside.wav'), target = path.join(f.root, filename(KEY));
  await fs.writeFile(outside, wave()); await age(outside, f.time); await fs.link(outside, target);
  assert.equal(await f.cache.read(KEY), null); assert.equal(await f.cache.write(KEY, wave()), false);
  assert.equal((await f.cache.status()).files, 1);
  await age(target, f.time - 8 * DAY);
  assert.equal((await f.cache.prune()).removed, 1);
  assert.deepEqual(await fs.readFile(outside), wave());
  await assert.rejects(fs.lstat(target), { code: 'ENOENT' });
});

test('expired hardlink publication pairs left by a crash are both cleaned instead of retained forever', async t => {
  const f = await fixture(t);
  const final = path.join(f.root, filename(KEY));
  const temporary = path.join(f.root, `yukino-speech-v1-${KEY}.${'d'.repeat(32)}.tmp`);
  await fs.writeFile(temporary, wave()); await fs.link(temporary, final); await age(temporary, f.time - 8 * DAY);
  assert.equal((await f.cache.prune()).removed, 2);
  assert.deepEqual(await names(f.root), []);
});

test('a temporary-unlink error after publication rolls back the final name and cleans both links', async t => {
  const { cache, root } = await fixture(t);
  const original = fs.unlink; let failed = false;
  t.mock.method(fs, 'unlink', async function (file, ...args) {
    if (!failed && String(file).endsWith('.tmp')) { failed = true; throw ioError('EIO'); }
    return original.call(this, file, ...args);
  });
  assert.equal(await cache.write(KEY, wave()), false);
  assert.deepEqual(await names(root), []);
});

test('replacing an established root directory fails closed instead of using the replacement', async t => {
  const { cache, root, sandbox } = await fixture(t);
  await cache.write(KEY, wave());
  const previous = path.join(sandbox, 'previous-cache'); await fs.rename(root, previous); await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'unrecognized.txt'), 'preserve');
  assert.equal(await cache.read(KEY), null); assert.equal(await cache.write(SECOND, wave()), false);
  assert.equal((await cache.status()).error.code, 'ROOT_CHANGED');
  assert.deepEqual(await names(root), ['unrecognized.txt']); assert.deepEqual(await names(previous), [filename(KEY)]);
});

test('two independent instances still cannot replace one another during atomic publish', async t => {
  const { cache, root, time } = await fixture(t);
  const other = new SpeechCache({ root, now: () => time }); await other.configure({ enabled: true });
  const results = await Promise.all([cache.write(KEY, wave({ sample: 1 })), other.write(KEY, wave({ sample: 2 }))]);
  assert.equal(results.filter(Boolean).length, 1);
  const audio = await cache.read(KEY);
  assert.ok(audio.equals(wave({ sample: 1 })) || audio.equals(wave({ sample: 2 })));
  assert.deepEqual(await names(root), [filename(KEY)]);
});

test('nested root is created one checked directory at a time only after explicit enable', async t => {
  const { sandbox } = await fixture(t, { enabled: false });
  const root = path.join(sandbox, 'cache', 'speech', 'audio');
  const cache = new SpeechCache({ root });
  assert.equal((await cache.status()).error, null);
  await assert.rejects(fs.lstat(path.join(sandbox, 'cache')), { code: 'ENOENT' });
  assert.equal((await cache.configure({ enabled: true })).error, null);
  assert.equal(await cache.write(KEY, wave()), true);
  assert.deepEqual(await names(root), [filename(KEY)]);
});

test('write-permission errors still report existing cache counts instead of claiming the directory is empty', async t => {
  const { cache, root } = await fixture(t);
  const audio = wave(); await cache.write(KEY, audio);
  t.mock.method(fs, 'open', async () => { throw ioError('EROFS'); });
  const status = await cache.status();
  assert.equal(status.error.code, 'EROFS'); assert.equal(status.files, 1); assert.equal(status.bytes, audio.length);
  assert.deepEqual(await names(root), [filename(KEY)]);
});

test('independent install roots never discover or reuse old-install audio', async t => {
  const { cache, sandbox } = await fixture(t);
  await cache.write(KEY, wave());
  const root = path.join(sandbox, 'new-install', 'speech-cache');
  const current = new SpeechCache({ root });
  assert.equal((await current.status()).files, 0);
  assert.equal((await current.configure({ enabled: true })).root, root);
  assert.equal(await current.read(KEY), null);
  assert.equal((await current.status()).files, 0);
  assert.ok(await cache.read(KEY));
});

test('invalid injected clock cannot cause writes or expiration guesses', async t => {
  const { root } = await fixture(t, { enabled: false });
  const cache = new SpeechCache({ root, now: () => NaN });
  assert.equal((await cache.configure({ enabled: true })).error.code, 'INVALID_CLOCK');
  assert.equal(await cache.write(KEY, wave()), false);
  assert.deepEqual(await names(root), []);
});
