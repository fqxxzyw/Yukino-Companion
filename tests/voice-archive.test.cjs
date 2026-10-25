const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { deflateRawSync } = require('node:zlib');
const { createHash } = require('node:crypto');
const { extractPinnedWeight } = require('../electron/voice-archive.cjs');
const { VoiceResources } = require('../electron/voice-resources.cjs');

function zip(name, content) {
  const nameBytes = Buffer.from(name), compressed = deflateRawSync(content);
  const local = Buffer.alloc(30), central = Buffer.alloc(46), end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(content.length, 22); local.writeUInt16LE(nameBytes.length, 26);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(0x800, 8); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(content.length, 24); central.writeUInt16LE(nameBytes.length, 28);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + nameBytes.length, 12); end.writeUInt32LE(local.length + nameBytes.length + compressed.length, 16);
  return Buffer.concat([local, nameBytes, compressed, central, nameBytes, end]);
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function setup(t, name = 'weights/雪乃.pth') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-zip-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const content = Buffer.from('test weight bytes'), archive = path.join(root, 'test.zip');
  await fs.writeFile(archive, zip(name, content));
  return { root, content, options: { archive, member: name, destination: path.join(root, 'selected.pth'), bytes: content.length, digest: digest(content) } };
}

test('pinned UTF-8 ZIP weight extracts and verifies, never executes checkpoint', async t => {
  const { content, options } = await setup(t); await extractPinnedWeight(options);
  assert.deepEqual(await fs.readFile(options.destination), content);
});
test('archive traversal is rejected even when member was requested explicitly', async t => {
  const { options } = await setup(t, '../outside.pth');
  await assert.rejects(extractPinnedWeight(options), /不安全路径/);
  await assert.rejects(fs.access(options.destination));
});
test('missing member, output length, hash, truncated ZIP never publish weights', async t => {
  const { options } = await setup(t);
  await assert.rejects(extractPinnedWeight({ ...options, member: 'wrong.pth' }), /未登记/);
  await assert.rejects(extractPinnedWeight({ ...options, bytes: 1 }), /长度/);
  await assert.rejects(extractPinnedWeight({ ...options, digest: '0'.repeat(64) }), /校验/);
  await assert.rejects(fs.access(options.destination));
  await fs.truncate(options.archive, 20); await assert.rejects(extractPinnedWeight(options), /ZIP/);
});
test('cancelled extraction preserves previous selected weight', async t => {
  const { options } = await setup(t); await fs.writeFile(options.destination, 'previous');
  const abort = new AbortController(); abort.abort();
  await assert.rejects(extractPinnedWeight({ ...options, signal: abort.signal }));
  assert.equal(await fs.readFile(options.destination, 'utf8'), 'previous');
});
test('voice pack selection returns only its voice paths and reuses shared verified archive', async t => {
  const { root, content } = await setup(t); const archive = zip('weights/雪乃.pth', content), gpt = Buffer.from('gpt');
  const item = { path: 'archive.zip', bytes: archive.length, algorithm: 'sha256', digest: digest(archive), url: 'https://example.test/zip',
    extract: { member: 'weights/雪乃.pth', path: 'selected.pth', bytes: content.length, digest: digest(content) } };
  const gptItem = { path: 'selected.ckpt', bytes: gpt.length, algorithm: 'sha256', digest: digest(gpt), url: 'https://example.test/gpt' };
  let downloads = 0;
  const installer = new VoiceResources({ root, catalog: { packs: { e1: { kind: 'voice', label: 'e1', version: 'v1', requiresReference: true,
    paths: { gpt: 'selected.ckpt', sovits: 'selected.pth' }, files: [gptItem, item] } } }, fetcher: async url => { downloads++; return new Response(url.endsWith('/gpt') ? gpt : archive); } });
  const result = await installer.install('e1');
  assert.deepEqual(result, { gpt: path.join(root, 'selected.ckpt'), sovits: path.join(root, 'selected.pth'), version: 'v1', textLang: 'all_ja' });
  await installer.install('e1'); assert.equal(downloads, 2);
  assert.equal(installer.summary().packs[0].requiresReference, true);
});
