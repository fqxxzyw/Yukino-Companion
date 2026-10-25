// Minimal ZIP reader for a pinned, single-weight archive. Never extracts paths
// chosen by the archive; the catalog supplies both the member and destination.
const fs = require('node:fs/promises');
const { createReadStream, createWriteStream } = require('node:fs');
const { createInflateRaw } = require('node:zlib');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { createHash } = require('node:crypto');
const path = require('node:path');

async function readAt(handle, bytes, position) {
  const data = Buffer.alloc(bytes);
  if ((await handle.read(data, 0, bytes, position)).bytesRead !== bytes) throw Error('语音 ZIP 数据不完整');
  return data;
}
async function locateMember(archive, wanted) {
  const handle = await fs.open(archive, 'r');
  try {
    const { size } = await handle.stat();
    if (size < 22) throw Error('无效语音 ZIP');
    const tail = await readAt(handle, Math.min(size, 65557), Math.max(0, size - 65557));
    let end = -1;
    for (let n = tail.length - 22; n >= 0; n--) {
      if (tail.readUInt32LE(n) === 0x06054b50 && n + 22 + tail.readUInt16LE(n + 20) === tail.length) { end = n; break; }
    }
    if (end < 0 || tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6)) throw Error('不支持分卷语音 ZIP');
    const count = tail.readUInt16LE(end + 10), centralSize = tail.readUInt32LE(end + 12), centralOffset = tail.readUInt32LE(end + 16);
    if (count < 1 || count > 64 || count !== tail.readUInt16LE(end + 8) || centralSize > 65536 || centralOffset + centralSize > size - 22) throw Error('无效语音 ZIP 目录');
    const central = await readAt(handle, centralSize, centralOffset);
    let offset = 0, selected;
    for (let n = 0; n < count; n++) {
      if (offset + 46 > central.length || central.readUInt32LE(offset) !== 0x02014b50) throw Error('无效语音 ZIP 条目');
      const flags = central.readUInt16LE(offset + 8), method = central.readUInt16LE(offset + 10);
      const compressed = central.readUInt32LE(offset + 20), bytes = central.readUInt32LE(offset + 24);
      const nameLen = central.readUInt16LE(offset + 28), extraLen = central.readUInt16LE(offset + 30), commentLen = central.readUInt16LE(offset + 32);
      const attrs = central.readUInt32LE(offset + 38), localOffset = central.readUInt32LE(offset + 42);
      if (offset + 46 + nameLen + extraLen + commentLen > central.length) throw Error('语音 ZIP 条目越界');
      const name = central.subarray(offset + 46, offset + 46 + nameLen).toString('utf8');
      if (!name || name.includes('\\') || name.includes('\0') || name.startsWith('/') || name.split('/').includes('..') || /^[a-z]:/i.test(name) || ((attrs >>> 16) & 0xf000) === 0xa000) throw Error('语音 ZIP 包含不安全路径');
      if (flags & 1 || ![0, 8].includes(method) || localOffset >= centralOffset) throw Error('不支持的语音 ZIP 编码');
      if (name === wanted) {
        if (selected) throw Error('语音 ZIP 包含重复权重');
        selected = { flags, method, compressed, bytes, localOffset, name };
      } else if (!name.endsWith('/')) throw Error('语音 ZIP 包含未登记文件');
      offset += 46 + nameLen + extraLen + commentLen;
    }
    if (offset !== central.length || !selected) throw Error('语音 ZIP 缺少已登记权重');
    const header = await readAt(handle, 30, selected.localOffset);
    if (header.readUInt32LE(0) !== 0x04034b50 || header.readUInt16LE(6) !== selected.flags || header.readUInt16LE(8) !== selected.method) throw Error('语音 ZIP 本地条目不一致');
    const localName = await readAt(handle, header.readUInt16LE(26), selected.localOffset + 30);
    if (localName.toString('utf8') !== wanted) throw Error('语音 ZIP 文件名不一致');
    selected.start = selected.localOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
    if (selected.start + selected.compressed > centralOffset) throw Error('语音 ZIP 数据越界');
    return selected;
  } finally { await handle.close(); }
}

async function extractPinnedWeight({ archive, member, destination, bytes, digest, signal }) {
  signal?.throwIfAborted();
  const entry = await locateMember(archive, member);
  if (entry.bytes !== bytes || bytes < 1 || bytes > 512 * 1024 * 1024 || entry.compressed < 1) throw Error('语音权重解压长度不符');
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const part = destination + '.extract-part', hash = createHash('sha256');
  let written = 0;
  const meter = new Transform({ transform(chunk, encoding, done) {
    written += chunk.length;
    if (written > bytes) return done(Error('语音权重解压超出限制'));
    hash.update(chunk); done(null, chunk);
  }});
  try {
    const streams = [createReadStream(archive, { start: entry.start, end: entry.start + entry.compressed - 1 })];
    if (entry.method === 8) streams.push(createInflateRaw());
    streams.push(meter, createWriteStream(part, { flags: 'w' }));
    await pipeline(...streams, { signal });
    if (written !== bytes || hash.digest('hex') !== digest) throw Error('解压后的语音权重校验失败');
    signal?.throwIfAborted();
    await fs.rm(destination, { force: true });
    await fs.rename(part, destination);
  } catch (e) { await fs.rm(part, { force: true }); throw e; }
}
module.exports = { locateMember, extractPinnedWeight };
