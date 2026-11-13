'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {SceneImportStore, MAX_SCENE_BYTES} = require('../electron/scene-imports.cjs');

async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'yukino-scene-'));
  t.after(() => fs.rm(directory, {recursive:true, force:true}));
  return directory;
}

test('scene import keeps private copies and independent IDs across restarts', async t => {
  const directory = await temporaryDirectory(t);
  const input = path.join(directory, '小花园.MJS');
  const data = Buffer.from('export default {"object":{"type":"Scene"}};');
  await fs.writeFile(input, data);
  const store = new SceneImportStore(directory);
  assert.deepEqual(await store.list(), []);
  const first = await store.import(input);
  const second = await store.import(input);
  await fs.unlink(input);
  assert.match(first.id, /^custom-[a-f0-9]{64}$/);
  assert.notEqual(first.id, second.id);
  assert.equal(first.label, '小花园');
  assert.equal(first.extension, 'mjs');

  const reopened = new SceneImportStore(directory);
  assert.deepEqual(new Set(await reopened.list()), new Set([first, second]));
  const imported = await reopened.read(first.id);
  assert.deepEqual(imported, {extension:'mjs', data:new Uint8Array(data)});
  assert.equal(imported.data.buffer.byteLength, data.length);
  assert.equal(await reopened.remove(first.id), true);
  assert.equal(await reopened.remove(first.id), false);
  await assert.rejects(reopened.read(first.id), /找不到/);
  assert.deepEqual(await reopened.read(second.id), {extension:'mjs', data:new Uint8Array(data)});
  await assert.rejects(reopened.read('../private'), /编号/);
  await assert.rejects(reopened.remove('../private'), /编号/);
});

test('unsupported or oversized files are never persisted', async t => {
  const directory = await temporaryDirectory(t);
  const store = new SceneImportStore(directory);
  const unsupported = path.join(directory, 'scene.txt');
  await fs.writeFile(unsupported, 'scene');
  await assert.rejects(store.import(unsupported), /格式/);
  const tooLarge = path.join(directory, 'scene.glb');
  await fs.writeFile(tooLarge, 'scene');
  await fs.truncate(tooLarge, MAX_SCENE_BYTES + 1);
  await assert.rejects(store.import(tooLarge), /128 MiB/);
  assert.deepEqual(await store.list(), []);
});

test('Blender imports publish only converted GLB and clean up failed conversions', async t => {
  const directory = await temporaryDirectory(t);
  const input = path.join(directory, '庭院.blend');
  const blend = Buffer.from('BLENDER');
  const glb = Buffer.from('glTF0000');
  await fs.writeFile(input, blend);
  let shouldFail = true;
  const store = new SceneImportStore(directory, {convert:async (staged, target) => {
    assert.notEqual(staged, input);
    assert.deepEqual(await fs.readFile(staged), blend);
    await fs.writeFile(target, shouldFail ? 'invalid' : glb);
  }});
  await assert.rejects(store.import(input), /有效的 GLB/);
  assert.deepEqual(await fs.readdir(store.root), []);
  shouldFail = false;
  const entry = await store.import(input);
  assert.equal(entry.sourceExtension, 'blend');
  assert.equal(entry.extension, 'glb');
  assert.deepEqual(await store.read(entry.id), {extension:'glb', data:new Uint8Array(glb)});
  assert.deepEqual((await fs.readdir(path.join(store.root, entry.id))).sort(), ['asset', 'scene.json']);
});
