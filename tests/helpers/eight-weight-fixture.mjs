// Browser- and Node-compatible synthetic asset. No external files or textures.
export function encodeGlb(json, binary) {
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(encoded.length / 4) * 4;
  const binLength = Math.ceil(binary.byteLength / 4) * 4;
  const out = new Uint8Array(28 + jsonLength + binLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, out.length, true);
  view.setUint32(12, jsonLength, true); view.setUint32(16, 0x4e4f534a, true);
  out.fill(32, 20, 20 + jsonLength); out.set(encoded, 20);
  view.setUint32(20 + jsonLength, binLength, true); view.setUint32(24 + jsonLength, 0x004e4942, true);
  out.set(new Uint8Array(binary.buffer || binary, binary.byteOffset || 0, binary.byteLength), 28 + jsonLength);
  return out.buffer;
}
export function createEightWeightFixture({eight = true, sparse = false, quantized = false, interleaved = false} = {}) {
  const json = {asset: {version: '2.0'}, buffers: [{byteLength: 0}], bufferViews: [], accessors: [],
    materials: [{name: 'SharedMainAndFourWeight', pbrMetallicRoughness: {baseColorFactor: [.6, .35, .2, 1], metallicFactor: 0, roughnessFactor: 1}}],
    meshes: [], nodes: [], skins: [{joints: Array.from({length: 8}, (_, i) => i + 3)}], scenes: [{nodes: Array.from({length: 11}, (_, i) => i)}], scene: 0};
  const chunks = [];
  let offset = 0;
  function bufferView(array, stride) {
    const padding = (4 - offset % 4) % 4;
    if (padding) {chunks.push(new Uint8Array(padding)); offset += padding;}
    const index = json.bufferViews.length;
    json.bufferViews.push({buffer: 0, byteOffset: offset, byteLength: array.byteLength, ...(stride ? {byteStride: stride} : {})});
    chunks.push(new Uint8Array(array.buffer, array.byteOffset, array.byteLength)); offset += array.byteLength;
    return index;
  }
  function attribute(array, type, componentType, count = 3, normalized = false) {
    const accessor = {bufferView: bufferView(array), componentType, count, type, ...(normalized ? {normalized: true} : {})};
    json.accessors.push(accessor); return json.accessors.length - 1;
  }
  const pos = attribute(new Float32Array([-.45,-.4,0,.45,-.4,0,0,.45,0]), 'VEC3', 5126);
  Object.assign(json.accessors[pos], {min: [-.45,-.4,0], max: [.45,.45,0]});
  const normal = attribute(new Float32Array([0,0,1,0,0,1,0,0,1]), 'VEC3', 5126);
  const tangent = attribute(new Float32Array([1,0,0,1,1,0,0,1,1,0,0,1]), 'VEC4', 5126);
  const morph = attribute(new Float32Array([.15,0,0,.15,0,0,.15,0,0]), 'VEC3', 5126);
  Object.assign(json.accessors[morph], {min: [.15,0,0], max: [.15,0,0]});
  const j0 = attribute(new Uint16Array([0,1,2,3,0,1,2,3,0,1,2,3]), 'VEC4', 5123);
  const j1 = attribute(new Uint16Array([4,5,6,7,4,5,6,7,4,5,6,7]), 'VEC4', 5123);
  const QuantizedArray = quantized === 16 ? Uint16Array : Uint8Array;
  const quantizedWeight = quantized === 16 ? 8192 : 32, quantizedType = quantized === 16 ? 5123 : 5121;
  const weights = quantized ? new QuantizedArray(12).fill(quantizedWeight) : new Float32Array(12).fill(eight ? .125 : .25);
  const w0 = attribute(weights, 'VEC4', quantized ? quantizedType : 5126, 3, quantized);
  const w1 = attribute(quantized ? new QuantizedArray(12).fill(quantizedWeight) : new Float32Array(12).fill(.125), 'VEC4', quantized ? quantizedType : 5126, 3, quantized);
  if (sparse) {
    const a = json.accessors[w1];
    delete a.bufferView;
    a.sparse = {count: 3, indices: {bufferView: bufferView(new Uint8Array([0,1,2])), componentType: 5121},
      values: {bufferView: bufferView(quantized ? new QuantizedArray(12).fill(quantizedWeight) : new Float32Array(12).fill(.125))}};
  }
  if (interleaved) {
    const data = quantized ? new QuantizedArray(24) : new Float32Array(24);
    for (let row = 0; row < 3; row++) for (let c = 0; c < 4; c++) data[row * 8 + 4 + c] = quantized ? quantizedWeight : .125;
    Object.assign(json.accessors[w0], {bufferView: bufferView(data, data.BYTES_PER_ELEMENT * 8), byteOffset: data.BYTES_PER_ELEMENT * 4});
  }
  const four = attribute(new Float32Array(12).fill(.25), 'VEC4', 5126);
  const attrs = {POSITION: pos, NORMAL: normal, TANGENT: tangent, JOINTS_0: j0, WEIGHTS_0: w0};
  if (eight) Object.assign(attrs, {JOINTS_1: j1, WEIGHTS_1: w1});
  json.meshes = [{name: 'Eight', primitives: [{attributes: attrs, material: 0, targets: [{POSITION: morph}]}], extras: {targetNames: ['MouthOpen']}, weights: [0]},
    {name: 'Four', primitives: [{attributes: {...attrs, JOINTS_1: undefined, WEIGHTS_1: undefined, WEIGHTS_0: four}, material: 0}]}];
  json.nodes = [{name: 'Main', mesh: 0, skin: 0}, {name: 'Outline', mesh: 0, skin: 0}, {name: 'Four', mesh: 1, skin: 0},
    ...Array.from({length: 8}, (_, i) => ({name: `Bone${i}`}))];
  json.buffers[0].byteLength = offset;
  const bin = new Uint8Array(offset);
  let at = 0; for (const chunk of chunks) {bin.set(chunk, at); at += chunk.length;}
  // Remove JS undefined keys, exactly as GLB JSON serialization does.
  const clean = JSON.parse(JSON.stringify(json));
  return {json: clean, bin, bytes: encodeGlb(clean, bin), indices: {pos, normal, tangent, morph, j0, j1, w0, w1, four}};
}
