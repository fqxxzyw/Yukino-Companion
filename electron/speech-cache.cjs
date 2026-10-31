const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

const MAX_AUDIO_BYTES = 32 * 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;
const KEY = /^[a-f0-9]{64}$/;
const PREFIX = 'yukino-speech-v1-';
const OWN_FILE = /^yukino-speech-v1-[a-f0-9]{64}(?:\.wav|\.[a-f0-9]{32}\.tmp)$/;
const noFollow = constants.O_NOFOLLOW || 0;
const failure = code => Object.assign(new Error(code), { code });
const identity = (a, b) => a.dev === b.dev && a.ino === b.ino;
const unchanged = (a, b) => identity(a, b) && a.size === b.size && a.mtimeMs === b.mtimeMs;
const plainFile = stat => stat.isFile() && !stat.isSymbolicLink();
const regular = stat => plainFile(stat) && stat.nlink === 1;

// Deliberately accepts only bounded, structurally complete uncompressed WAVE.
// Synthesis failures, HTTP error bodies and truncated RIFF headers are not audio.
function validWave(audio) {
  if (!Buffer.isBuffer(audio) || audio.length < 44 || audio.length > MAX_AUDIO_BYTES ||
      audio.toString('latin1', 0, 4) !== 'RIFF' || audio.toString('latin1', 8, 12) !== 'WAVE' ||
      audio.readUInt32LE(4) !== audio.length - 8) return false;
  let offset = 12, alignment = 0, dataBytes = 0, chunks = 0;
  while (offset < audio.length) {
    if (++chunks > 1024 || offset + 8 > audio.length) return false;
    const name = audio.toString('latin1', offset, offset + 4), length = audio.readUInt32LE(offset + 4);
    const start = offset + 8, end = start + length;
    if (end + (length & 1) > audio.length) return false;
    if (name === 'fmt ') {
      if (alignment || length < 16 || (length !== 16 && (length < 18 || audio.readUInt16LE(start + 16) + 18 > length))) return false;
      let format = audio.readUInt16LE(start);
      const channels = audio.readUInt16LE(start + 2), sampleRate = audio.readUInt32LE(start + 4);
      const byteRate = audio.readUInt32LE(start + 8), block = audio.readUInt16LE(start + 12), bits = audio.readUInt16LE(start + 14);
      if (format === 0xfffe) {
        if (length < 40 || audio.readUInt16LE(start + 16) < 22 ||
            audio.readUInt16LE(start + 18) < 1 || audio.readUInt16LE(start + 18) > bits ||
            audio.subarray(start + 28, start + 40).toString('hex') !== '00001000800000aa00389b71') return false;
        format = audio.readUInt32LE(start + 24);
      }
      if (channels < 1 || channels > 8 || sampleRate < 1 || sampleRate > 384000 ||
          !(format === 1 ? [8, 16, 24, 32] : format === 3 ? [32, 64] : []).includes(bits) ||
          block !== channels * bits / 8 || byteRate !== sampleRate * block) return false;
      alignment = block;
    } else if (name === 'data') {
      if (!alignment || dataBytes || !length || length % alignment) return false;
      dataBytes = length;
    }
    offset = end + (length & 1);
  }
  return offset === audio.length && alignment > 0 && dataBytes > 0;
}

function safeError(error) {
  const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,39}$/.test(error.code) ? error.code : 'CACHE_IO';
  const messages = {
    EACCES: '缓存目录不可读写；请检查安装目录权限。', EPERM: '缓存目录不可读写；请检查安装目录权限。',
    EROFS: '安装位置为只读，无法写入音频缓存。', ENOSPC: '磁盘空间不足，无法写入音频缓存。',
    ENOENT: '指定的缓存目录或其父目录不存在。', ENOTDIR: '指定的缓存位置不是文件夹。',
    UNSAFE_PATH: '缓存路径含符号链接或非文件夹，已拒绝访问。', ROOT_CHANGED: '缓存目录已被替换，已拒绝访问。',
    UNSAFE_FILE: '缓存条目不是独立普通文件，已拒绝访问。', FILE_CHANGED: '缓存条目发生变化，已跳过。',
    INVALID_KEY: '音频缓存标识无效。', INVALID_AUDIO: '音频不是受支持的完整 WAV，已跳过缓存。',
    INVALID_CLOCK: '无法确定缓存保留时间。',
  };
  // Never expose raw filesystem messages: they can contain a path or user data.
  return { code, message: messages[code] || '音频缓存操作失败；原始语音仍可正常播放。' };
}

class SpeechCache {
  constructor({ root, now = Date.now } = {}) {
    if (typeof root !== 'string' || !root || !path.isAbsolute(root) || path.dirname(path.resolve(root)) === path.resolve(root)) {
      throw new TypeError('SpeechCache requires an absolute dedicated root directory');
    }
    if (typeof now !== 'function') throw new TypeError('SpeechCache now must be a function');
    this.root = path.resolve(root);
    this._now = now;
    this._enabled = false;
    this._retentionDays = 7;
    this._generation = 0;
    this._rootIdentity = null;
    this._error = null;
    this._tail = Promise.resolve();
  }

  // Fast opt-in check for the synthesis hot path; no filesystem access.
  get enabled() { return this._enabled; }

  _run(work, fallback) {
    const result = this._tail.then(async () => {
      try { return await work(); }
      catch (error) { this._error = safeError(error); return fallback(); }
    });
    this._tail = result.then(() => undefined, () => undefined);
    return result;
  }

  _snapshot(files = 0, bytes = 0) {
    return { enabled: this._enabled, retentionDays: this._retentionDays, root: this.root, files, bytes, error: this._error && { ...this._error } };
  }

  _time() {
    const value = this._now();
    if (!Number.isFinite(value) || value < 0 || value > 8640000000000000) throw failure('INVALID_CLOCK');
    return value;
  }

  _active(generation) { return this._enabled && generation === this._generation; }
  _filename(key) { return path.join(this.root, `${PREFIX}${key}.wav`); }
  _temporary(key = '0'.repeat(64)) { return path.join(this.root, `${PREFIX}${key}.${randomBytes(16).toString('hex')}.tmp`); }

  // Do not recurse through symlinks/junctions, including an ancestor of root.
  // The main process must own/trust the installation directory: portable Node
  // has no dirfd/openat API to defend against a hostile process swapping parents
  // between filesystem syscalls. Identity checks also fail closed on replacement.
  async _directory(create = false) {
    const parsed = path.parse(this.root);
    const parts = this.root.slice(parsed.root.length).split(path.sep).filter(Boolean);
    let current = parsed.root, stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw failure('UNSAFE_PATH');
    for (let index = 0; index < parts.length; index++) {
      current = path.join(current, parts[index]);
      try { stat = await fs.lstat(current); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        if (!create) return null;
        if (this._rootIdentity) throw failure('ROOT_CHANGED');
        try { await fs.mkdir(current, { mode: 0o700 }); }
        catch (reason) { if (reason.code !== 'EEXIST') throw reason; }
        stat = await fs.lstat(current);
      }
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw failure('UNSAFE_PATH');
    }
    if (this._rootIdentity && !identity(this._rootIdentity, stat)) throw failure('ROOT_CHANGED');
    this._rootIdentity = stat;
    return stat;
  }

  async _file(filename) {
    const before = await fs.lstat(filename);
    if (!regular(before)) throw failure('UNSAFE_FILE');
    const handle = await fs.open(filename, constants.O_RDONLY | noFollow);
    try {
      const opened = await handle.stat(), after = await fs.lstat(filename);
      if (!regular(opened) || !regular(after) || !unchanged(before, opened) || !unchanged(opened, after)) throw failure('FILE_CHANGED');
      await this._directory();
      return { handle, stat: opened };
    } catch (error) { await handle.close(); throw error; }
  }

  async _remove(filename, expected, allowLinked = false, generation) {
    if (!await this._directory()) throw failure('ROOT_CHANGED');
    let actual;
    try { actual = await fs.lstat(filename); }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    if (!(allowLinked ? plainFile(actual) : regular(actual)) || !unchanged(actual, expected)) throw failure('FILE_CHANGED');
    if (generation !== undefined && !this._active(generation)) return false;
    await fs.unlink(filename);
    return true;
  }

  async _probe(generation) {
    if (!this._active(generation)) return;
    if (!await this._directory()) throw failure('ROOT_CHANGED');
    const filename = this._temporary();
    let handle, stat;
    try {
      handle = await fs.open(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow, 0o600);
      stat = await handle.stat();
      await handle.close(); handle = null;
    } finally {
      if (handle) await handle.close();
      if (stat) await this._remove(filename, stat);
    }
  }

  async _prune(generation) {
    if (!this._active(generation) || !await this._directory()) return 0;
    const cutoff = this._time() - this._retentionDays * DAY_MS;
    let removed = 0;
    for (const entry of await fs.readdir(this.root, { withFileTypes: true })) {
      if (!this._active(generation)) break;
      if (!OWN_FILE.test(entry.name) || !entry.isFile()) continue;
      const filename = path.join(this.root, entry.name);
      let stat;
      try { stat = await fs.lstat(filename); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      if (!plainFile(stat) || stat.mtimeMs > cutoff) continue;
      if (!this._active(generation)) break;
      // Unlinking our own name never follows or alters another hardlink. This
      // also expires a final/temp pair left by a crash between link and unlink.
      if (await this._remove(filename, stat, true, generation)) removed++;
    }
    return removed;
  }

  async _status() {
    let files = 0, bytes = 0;
    if (!await this._directory()) return this._snapshot();
    for (const entry of await fs.readdir(this.root, { withFileTypes: true })) {
      if (!OWN_FILE.test(entry.name) || !entry.isFile()) continue;
      try {
        const stat = await fs.lstat(path.join(this.root, entry.name));
        if (plainFile(stat)) { files++; bytes += stat.size; }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return this._snapshot(files, bytes);
  }

  async _statusAfterFailure() {
    try { return await this._status(); }
    catch { return this._snapshot(); }
  }

  configure(options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) return Promise.reject(new TypeError('cache configuration must be an object'));
    const enabled = options.enabled === undefined ? this._enabled : options.enabled;
    const retentionDays = options.retentionDays === undefined ? this._retentionDays : options.retentionDays;
    if (typeof enabled !== 'boolean' || !Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 30) {
      return Promise.reject(new TypeError('enabled must be boolean; retentionDays must be an integer from 1 to 30'));
    }
    // Immediate generation invalidation stops queued/in-flight reads and writes
    // from publishing after an opt-out. Await configure before acknowledging it.
    this._enabled = enabled;
    this._retentionDays = retentionDays;
    const generation = ++this._generation;
    return this._run(async () => {
      this._error = null;
      if (this._active(generation)) {
        await this._directory(true);
        await this._probe(generation);
        await this._prune(generation);
      }
      return this._status();
    }, () => this._statusAfterFailure());
  }

  status() {
    const generation = this._generation;
    return this._run(async () => {
      if (this._active(generation)) {
        await this._directory(true);
        await this._probe(generation);
        await this._prune(generation);
      }
      return this._status();
    }, () => this._statusAfterFailure());
  }

  read(key) {
    const generation = this._generation;
    return this._run(async () => {
      if (!this._active(generation)) return null;
      if (typeof key !== 'string' || !KEY.test(key)) throw failure('INVALID_KEY');
      if (!await this._directory()) return null;
      let opened;
      try { opened = await this._file(this._filename(key)); }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
      const { handle, stat } = opened;
      try {
        if (stat.mtimeMs <= this._time() - this._retentionDays * DAY_MS) return null;
        if (stat.size < 44 || stat.size > MAX_AUDIO_BYTES) throw failure('INVALID_AUDIO');
        const audio = Buffer.alloc(stat.size);
        let offset = 0;
        while (offset < audio.length) {
          const { bytesRead } = await handle.read(audio, offset, audio.length - offset, offset);
          if (!bytesRead) throw failure('INVALID_AUDIO');
          offset += bytesRead;
        }
        if (!unchanged(stat, await handle.stat())) throw failure('FILE_CHANGED');
        if (!validWave(audio)) throw failure('INVALID_AUDIO');
        if (!await this._directory()) throw failure('ROOT_CHANGED');
        if (!this._active(generation)) return null;
        this._error = null;
        return audio;
      } finally { await handle.close(); }
    }, () => null);
  }

  write(key, audio) {
    const generation = this._generation;
    if (!this._active(generation)) return Promise.resolve(false);
    if (typeof key !== 'string' || !KEY.test(key) || !validWave(audio)) {
      return this._run(() => { throw failure(typeof key !== 'string' || !KEY.test(key) ? 'INVALID_KEY' : 'INVALID_AUDIO'); }, () => false);
    }
    const copy = Buffer.from(audio);
    return this._run(async () => {
      if (!this._active(generation)) return false;
      await this._directory(true);
      await this._prune(generation);
      if (!this._active(generation)) return false;
      const target = this._filename(key), temporary = this._temporary(key);
      let handle, temporaryStat, publishedStat, committed = false;
      try {
        if (!await this._directory()) throw failure('ROOT_CHANGED');
        handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow, 0o600);
        temporaryStat = await handle.stat();
        if (!this._active(generation)) return false;
        await handle.writeFile(copy);
        if (!this._active(generation)) return false;
        const time = new Date(this._time());
        await handle.utimes(time, time);
        await handle.sync();
        temporaryStat = await handle.stat();
        await handle.close(); handle = null;
        if (!this._active(generation)) return false;
        if (!await this._directory()) throw failure('ROOT_CHANGED');
        const beforePublish = await fs.lstat(temporary);
        if (!regular(beforePublish) || !unchanged(beforePublish, temporaryStat)) throw failure('FILE_CHANGED');
        // link is an atomic no-replace publication; rename would overwrite an
        // existing file on POSIX. Unsupported/readonly filesystems fail closed.
        try { await fs.link(temporary, target); }
        catch (error) { if (error.code === 'EEXIST') return false; throw error; }
        publishedStat = temporaryStat;
        const actual = await fs.lstat(temporary);
        if (!plainFile(actual) || !unchanged(actual, publishedStat)) throw failure('FILE_CHANGED');
        // Delete the temporary link first so the final file has nlink === 1.
        await fs.unlink(temporary); temporaryStat = null;
        if (!this._active(generation)) return false;
        this._error = null;
        committed = true;
        return true;
      } finally {
        try {
          if (handle) await handle.close();
          if (temporaryStat && await this._directory()) {
            // A crash/failed unlink can leave two links. Remove only the exact
            // temporary inode we created, never a replacement directory entry.
            const actual = await fs.lstat(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
            if (actual && identity(actual, temporaryStat) && plainFile(actual)) await fs.unlink(temporary);
          }
        } finally {
          // Roll back our own publication on cancellation or any post-link error,
          // even if temporary cleanup failed. Never remove an existing target.
          if (publishedStat && !committed) await this._remove(target, publishedStat, true);
        }
      }
    }, () => false);
  }

  prune() {
    const generation = this._generation;
    return this._run(async () => {
      const removed = await this._prune(generation);
      this._error = null;
      return { removed, error: null };
    }, () => ({ removed: 0, error: this._error && { ...this._error } }));
  }
}

module.exports = { SpeechCache, MAX_AUDIO_BYTES };
