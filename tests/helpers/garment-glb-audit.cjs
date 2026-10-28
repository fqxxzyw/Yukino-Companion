const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..'),catalog=require('../../resources/character-models.json');
const WIDTHS = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16};
const TYPES = {5120: ['getInt8', 1], 5121: ['getUint8', 1], 5122: ['getInt16', 2], 5123: ['getUint16', 2], 5125: ['getUint32', 4], 5126: ['getFloat32', 4]};
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function entry(id) {
  const value = catalog.models.find(model => model.id === id);
  assert.ok(value, 'Expected separately registered model: ' + id);
  return value;
}
function load(id) {
  const model = entry(id), file = path.join(root, 'public', model.url.slice(2)), bytes = fs.readFileSync(file);
  assert.equal(bytes.length, model.bytes, id + ' byte length');
  assert.equal(sha(bytes), model.sha256, id + ' digest');
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  let json, bin;
  for (let offset = 12; offset < bytes.length;) {
    const length = bytes.readUInt32LE(offset), type = bytes.readUInt32LE(offset + 4);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    assert.equal(chunk.length, length);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
    if (type === 0x004e4942) bin = chunk;
    offset += length + 8;
  }
  assert.ok(json && bin);
  return {model, bytes, json, bin};
}
function viewBytes(asset, viewIndex, count, itemBytes, localOffset = 0) {
  const view = asset.json.bufferViews[viewIndex];
  assert.equal(view.buffer || 0, 0, 'Embedded BIN only');
  const stride = view.byteStride || itemBytes, out = Buffer.alloc(count * itemBytes);
  assert.ok(stride >= itemBytes);
  for (let index = 0; index < count; index++) {
    const offset = (view.byteOffset || 0) + localOffset + index * stride;
    assert.ok(offset + itemBytes <= (view.byteOffset || 0) + view.byteLength);
    asset.bin.copy(out, index * itemBytes, offset, offset + itemBytes);
  }
  return out;
}
function accessor(asset, index) {
  const item = asset.json.accessors[index], type = TYPES[item.componentType], width = WIDTHS[item.type];
  assert.ok(type && width, 'Supported authored accessor');
  const itemBytes = type[1] * width;
  const bytes = item.bufferView === undefined ? Buffer.alloc(item.count * itemBytes) : viewBytes(asset, item.bufferView, item.count, itemBytes, item.byteOffset || 0);
  if (item.sparse) {
    const {count, indices, values} = item.sparse, [read, stride] = TYPES[indices.componentType];
    const indexBytes = viewBytes(asset, indices.bufferView, count, stride, indices.byteOffset || 0);
    const indexView = new DataView(indexBytes.buffer, indexBytes.byteOffset, indexBytes.byteLength);
    const valueBytes = viewBytes(asset, values.bufferView, count, itemBytes, values.byteOffset || 0);
    for (let n = 0; n < count; n++) {
      const offset = indexView[read](n * stride, true);
      assert.ok(offset < item.count);
      valueBytes.copy(bytes, offset * itemBytes, n * itemBytes, (n + 1) * itemBytes);
    }
  }
  return {componentType: item.componentType, type: item.type, count: item.count, normalized: !!item.normalized, bytes};
}
function numbers(asset, index) {
  const value = accessor(asset, index), [read, stride] = TYPES[value.componentType];
  const view = new DataView(value.bytes.buffer, value.bytes.byteOffset, value.bytes.byteLength);
  return Array.from({length: value.bytes.length / stride}, (_, n) => view[read](n * stride, true));
}
function channelName(asset, channel) { return asset.json.nodes[channel.target.node].name + ':' + channel.target.path; }
function compareAccessor(before, beforeIndex, after, afterIndex, label) {
  assert.deepEqual(accessor(after, afterIndex), accessor(before, beforeIndex), label);
}


module.exports={load,accessor,numbers,compareAccessor};
