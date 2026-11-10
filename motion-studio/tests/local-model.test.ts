import assert from 'node:assert/strict';
import test from 'node:test';
import { readLocalModel, validateGlb } from '../src/local-model.ts';

function binaryManifest(manifest: Record<string, unknown>): ArrayBuffer {
  const json = new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0' }, ...manifest }));
  const size = Math.ceil(json.length / 4) * 4;
  const bytes = new ArrayBuffer(20 + size);
  const header = new DataView(bytes);
  header.setUint32(0, 0x46546c67, true);
  header.setUint32(4, 2, true);
  header.setUint32(8, bytes.byteLength, true);
  header.setUint32(12, size, true);
  header.setUint32(16, 0x4e4f534a, true);
  const chunk = new Uint8Array(bytes, 20);
  chunk.fill(0x20);
  chunk.set(json);
  return bytes;
}

test('dispatches local binary models by manifest and preserves hash-based relinking', async () => {
  const bytes = binaryManifest({ extensions: { VRMC_vrm: { specVersion: '1.0' } } });
  const input = (name: string) => ({ model: new File([bytes], name), dependencies: [] });
  const source = await readLocalModel(input('角色.vrm'));
  assert.equal(source.format, 'vrm');
  assert.equal(source.label, '角色');
  const renamed = await readLocalModel(input('改名.glb'), { id: source.id, sha256: source.asset.sha256 });
  assert.equal(renamed.format, 'vrm');
  assert.equal(renamed.id, source.id);
  assert.equal(renamed.asset.sha256, source.asset.sha256);
  assert.equal(validateGlb(binaryManifest({ extensions: { VRM: { specVersion: '0.0' } } })), 'vrm');
  assert.equal(validateGlb(binaryManifest({})), 'glb');
});

test('rejects unrelated binaries and VRM files with external or unsupported required resources', async () => {
  await assert.rejects(readLocalModel({ model: new File([binaryManifest({})], 'plain.vrm'), dependencies: [] }), /没有有效的 VRM/);
  assert.throws(() => validateGlb(binaryManifest({
    extensionsUsed: ['VRMC_springBone'],
  })), /缺少完整的 VRM/);
  assert.throws(() => validateGlb(binaryManifest({
    extensions: { VRMC_vrm: {}, VRMC_springBone_limit: {} }, extensionsRequired: ['VRMC_springBone_limit'],
  })), /无法读取的 VRM 扩展/);
  assert.throws(() => validateGlb(binaryManifest({
    extensions: { VRMC_vrm: {} }, images: [{ uri: 'https://example.invalid/texture.png' }],
  })), /引用外部资源/);
});
