import * as THREE from 'three';

// This adapter deliberately targets the pinned WebGL renderer, not WebGPU/TSL.
// r185 GLTFLoader retains JOINTS_1/WEIGHTS_1 as joints_1/weights_1 but normalizes
// WEIGHTS_0 in isolation. Recover BOTH original sets before enabling this shader.
// Sources: github.com/mrdoob/three.js/tree/r185/src/renderers/shaders/ShaderChunk
// and examples/jsm/loaders/GLTFLoader.js at the same tag.
const REVISION = '185';
const KEY = 'yukino-eight-weight-r185-v1';
const patchedMaterials = new WeakMap();
const adaptedMeshes = new WeakMap();
const MAX_VERTICES = 2_000_000;
const COMPONENTS = {
  5121: {size: 1, read: 'getUint8', max: 255},
  5123: {size: 2, read: 'getUint16', max: 65535},
  5125: {size: 4, read: 'getUint32', max: 4294967295},
  5126: {size: 4, read: 'getFloat32', max: 1},
};
function fail(message) { throw new Error(`骨骼权重校验失败：${message}`); }
function integer(value, name, min = 0) {
  if (!Number.isSafeInteger(value) || value < min) fail(`${name}无效。`);
  return value;
}
function pinnedRevision() {
  if (THREE.REVISION !== REVISION) fail('八权重适配器需要重新验证当前 Three.js 版本。');
}
function binaryChunk(bytes, json) {
  if (!(bytes instanceof ArrayBuffer)) fail('需要 ArrayBuffer GLB 数据。');
  const view = new DataView(bytes);
  if (bytes.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67 ||
      view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.byteLength) fail('GLB 头无效。');
  let bin;
  for (let at = 12; at < bytes.byteLength;) {
    if (at + 8 > bytes.byteLength) fail('GLB 数据块头越界。');
    const length = view.getUint32(at, true), type = view.getUint32(at + 4, true);
    if (length % 4 || at + 8 + length > bytes.byteLength) fail('GLB 数据块越界或未对齐。');
    if (at === 12 && type !== 0x4e4f534a) fail('GLB 首个数据块不是 JSON。');
    if (type === 0x004e4942) {
      if (bin) fail('GLB 包含重复 BIN 数据块。');
      bin = {offset: at + 8, length};
    }
    at += 8 + length;
  }
  const buffer = json.buffers?.[0];
  if (!bin || !buffer || buffer.uri || !Number.isSafeInteger(buffer.byteLength) ||
      buffer.byteLength < 0 || buffer.byteLength > bin.length || bin.length - buffer.byteLength > 3) {
    fail('骨骼数据必须位于完整内嵌的 GLB BIN 缓冲区。');
  }
  return {view, offset: bin.offset, length: buffer.byteLength};
}
function viewRange(json, bin, index, offset, count, width, size, strided = true) {
  integer(index, 'bufferView 索引');
  const bv = json.bufferViews?.[index];
  if (!bv || bv.buffer !== 0) fail('骨骼 bufferView 必须引用内嵌缓冲区 0。');
  if (Object.keys(bv.extensions || {}).some(name => /meshopt|compression/i.test(name))) {
    fail('压缩骨骼访问器尚未支持；请导出未压缩 GLB。');
  }
  const start = integer(bv.byteOffset ?? 0, 'bufferView 偏移');
  const length = integer(bv.byteLength, 'bufferView 长度');
  const relative = integer(offset ?? 0, '访问器偏移');
  const stride = bv.byteStride === undefined || !strided ? width : integer(bv.byteStride, '访问器步长', 1);
  if ((!strided && bv.byteStride !== undefined) || stride < width || stride % size ||
      (bv.byteStride !== undefined && (stride > 252 || stride % 4)) ||
      start % size || relative % size || start + length > bin.length ||
      relative + (count ? (count - 1) * stride + width : 0) > length) fail('访问器范围、对齐或步长无效。');
  return {start: bin.offset + start + relative, stride};
}
function readVec4(json, bin, index, kind) {
  integer(index, `${kind}访问器索引`);
  const a = json.accessors?.[index];
  if (!a || a.type !== 'VEC4') fail(`${kind}必须是 VEC4。`);
  const count = integer(a.count, '顶点数量', 1);
  if (count > MAX_VERTICES) fail('单个图元超过 200 万个骨骼顶点的安全限制。');
  const type = COMPONENTS[a.componentType];
  if (!type || (kind === 'JOINTS' ? ![5121, 5123].includes(a.componentType) || !!a.normalized :
      ![5121, 5123, 5126].includes(a.componentType) || (a.componentType !== 5126 && a.normalized !== true) ||
      (a.componentType === 5126 && !!a.normalized))) fail(`${kind}分量类型或归一化标志无效。`);
  const values = kind === 'JOINTS' ? new Uint16Array(count * 4) : new Float32Array(count * 4);
  const read = at => bin.view[type.read](at, true) / (a.normalized ? type.max : 1);
  if (a.bufferView !== undefined) {
    const range = viewRange(json, bin, a.bufferView, a.byteOffset, count, type.size * 4, type.size);
    for (let row = 0; row < count; row++) for (let c = 0; c < 4; c++) values[row * 4 + c] = read(range.start + row * range.stride + c * type.size);
  } else if (a.byteOffset) fail('无 bufferView 的访问器不能设置偏移。');
  if (a.sparse) {
    const n = integer(a.sparse.count, '稀疏访问器数量', 1);
    if (n > count) fail('稀疏访问器数量超过顶点数量。');
    const indices = a.sparse.indices, sparseValues = a.sparse.values;
    const indexType = COMPONENTS[indices?.componentType];
    if (!indices || !sparseValues || ![5121, 5123, 5125].includes(indices.componentType)) fail('稀疏索引类型无效。');
    const ir = viewRange(json, bin, indices.bufferView, indices.byteOffset, n, indexType.size, indexType.size, false);
    const vr = viewRange(json, bin, sparseValues.bufferView, sparseValues.byteOffset, n, type.size * 4, type.size, false);
    let last = -1;
    for (let row = 0; row < n; row++) {
      const vertex = bin.view[indexType.read](ir.start + row * ir.stride, true);
      if (vertex <= last || vertex >= count) fail('稀疏索引必须严格递增且位于顶点范围内。');
      for (let c = 0; c < 4; c++) values[vertex * 4 + c] = read(vr.start + row * vr.stride + c * type.size);
      last = vertex;
    }
  }
  return {values, count, quantum: a.normalized ? 1 / type.max : 0};
}

/** Validate raw GLB skinning before GLTFLoader can normalize its first set.
 * Supports interleaved and sparse unsigned-byte/short joints and normalized
 * integer or float weights. Rejects >8 influences (including all-zero sets 2+),
 * compressed skin accessors and external/data-URI skin buffers explicitly.
 * Returns original weights ONLY for primitives needing the eight-weight path.
 */
export function inspectGlbSkinning(json, bytes) {
  const bin = binaryChunk(bytes, json);
  const skinCounts = new Map();
  for (const node of json.nodes || []) if (node.mesh !== undefined && node.skin !== undefined) {
    const skin = json.skins?.[node.skin];
    if (!skin || !Array.isArray(skin.joints) || !skin.joints.length ||
        skin.joints.some(index => !Number.isSafeInteger(index) || index < 0 || !json.nodes[index]) ||
        new Set(skin.joints).size !== skin.joints.length) fail('skin.joints 列表无效。');
    skinCounts.set(node.mesh, Math.min(skinCounts.get(node.mesh) ?? Infinity, skin.joints.length));
  }
  const primitives = [];
  let verticesWithExtraWeights = 0, maxInfluences = 0, validatedPrimitives = 0;
  for (const [meshIndex, mesh] of (json.meshes || []).entries()) for (const [primitiveIndex, primitive] of (mesh.primitives || []).entries()) {
    const attrs = primitive.attributes || {};
    if (Object.keys(attrs).some(name => /^(JOINTS|WEIGHTS)_/.test(name) && !/^(JOINTS|WEIGHTS)_[01]$/.test(name))) fail('当前最多支持八个骨骼影响（JOINTS/WEIGHTS_0 和 _1）。');
    const has0 = attrs.JOINTS_0 !== undefined || attrs.WEIGHTS_0 !== undefined;
    const has1 = attrs.JOINTS_1 !== undefined || attrs.WEIGHTS_1 !== undefined;
    if (!has0 && !has1) {
      if (skinCounts.has(meshIndex)) fail('绑定骨架的图元缺少 JOINTS_0/WEIGHTS_0。');
      continue;
    }
    if (!has0 || attrs.JOINTS_0 === undefined || attrs.WEIGHTS_0 === undefined ||
        (has1 && (attrs.JOINTS_1 === undefined || attrs.WEIGHTS_1 === undefined))) fail('JOINTS 与 WEIGHTS 必须成对提供。');
    if (primitive.extensions?.KHR_draco_mesh_compression) fail('压缩骨骼图元尚未支持；请导出未压缩 GLB。');
    const jointCount = skinCounts.get(meshIndex);
    if (!jointCount) fail('骨骼属性没有关联的 skin.joints 列表。');
    const j0 = readVec4(json, bin, attrs.JOINTS_0, 'JOINTS'), w0 = readVec4(json, bin, attrs.WEIGHTS_0, 'WEIGHTS');
    const j1 = has1 ? readVec4(json, bin, attrs.JOINTS_1, 'JOINTS') : null;
    const w1 = has1 ? readVec4(json, bin, attrs.WEIGHTS_1, 'WEIGHTS') : null;
    const position = json.accessors?.[attrs.POSITION];
    if (!position || position.type !== 'VEC3' || [j0, w0, j1, w1].filter(Boolean).some(a => a.count !== position.count)) fail('骨骼属性与 POSITION 顶点数量不一致。');
    // Quantized weights can differ from one by up to half an LSB per component.
    const tolerance = 1e-4 + 2 * (w0.quantum + (w1?.quantum || 0));
    let extraVertices = 0;
    for (let row = 0; row < position.count; row++) {
      let sum = 0, influences = 0, extra = false;
      for (const [joints, weights, second] of [[j0, w0, false], ...(has1 ? [[j1, w1, true]] : [])]) for (let c = 0; c < 4; c++) {
        const at = row * 4 + c, weight = weights.values[at];
        if (!Number.isFinite(weight) || weight < 0 || weight > 1) fail('权重必须为 0–1 范围的有限数值。');
        if (joints.values[at] >= jointCount) fail('骨骼索引超出 skin.joints 列表。');
        sum += weight;
        if (weight > 0) { influences++; extra ||= second; }
      }
      if (!Number.isFinite(sum) || Math.abs(sum - 1) > tolerance) fail('每个顶点的全部骨骼权重之和必须接近 1。');
      maxInfluences = Math.max(maxInfluences, influences);
      if (extra) extraVertices++;
      // Normalize both sets together, never the first four independently.
      if (has1) for (let c = 0; c < 4; c++) { w0.values[row * 4 + c] /= sum; w1.values[row * 4 + c] /= sum; }
    }
    validatedPrimitives++;
    verticesWithExtraWeights += extraVertices;
    if (extraVertices) primitives.push({meshIndex, primitiveIndex, vertexCount: position.count, jointCount,
      joints0: j0.values, weights0: w0.values, joints1: j1.values, weights1: w1.values, extraVertices});
  }
  return {primitives, validatedPrimitives, verticesWithExtraWeights, maxInfluences};
}

function replaceExactly(source, token, replacement) {
  if (source.split(token).length !== 2) fail(`着色器接口已改变：${token}`);
  return source.replace(token, replacement);
}
/** Public for shader contract tests; modifies only skinning chunks. Morphs,
 * displacement, projection, toon lighting and alpha handling stay in order. */
export function patchEightWeightShader(shader) {
  pinnedRevision();
  const chunks = THREE.ShaderChunk;
  let source = shader.vertexShader;
  const pars = replaceExactly(chunks.skinning_pars_vertex, '#ifdef USE_SKINNING',
    '#ifdef USE_SKINNING\nattribute vec4 skinIndex1;\nattribute vec4 skinWeight1;');
  const base = replaceExactly(chunks.skinbase_vertex, '#endif', `
  mat4 boneMatE = getBoneMatrix( skinIndex1.x );
  mat4 boneMatF = getBoneMatrix( skinIndex1.y );
  mat4 boneMatG = getBoneMatrix( skinIndex1.z );
  mat4 boneMatH = getBoneMatrix( skinIndex1.w );
#endif`);
  const position = replaceExactly(chunks.skinning_vertex, '\ttransformed =', `
  skinned += boneMatE * skinVertex * skinWeight1.x;
  skinned += boneMatF * skinVertex * skinWeight1.y;
  skinned += boneMatG * skinVertex * skinWeight1.z;
  skinned += boneMatH * skinVertex * skinWeight1.w;
  transformed =`);
  const normal = replaceExactly(chunks.skinnormal_vertex, '\tskinMatrix = bindMatrixInverse', `
  skinMatrix += skinWeight1.x * boneMatE;
  skinMatrix += skinWeight1.y * boneMatF;
  skinMatrix += skinWeight1.z * boneMatG;
  skinMatrix += skinWeight1.w * boneMatH;
  skinMatrix = bindMatrixInverse`);
  for (const [name, replacement] of [['skinning_pars_vertex', pars], ['skinbase_vertex', base], ['skinning_vertex', position]]) {
    source = replaceExactly(source, `#include <${name}>`, replacement);
  }
  if (source.includes('#include <skinnormal_vertex>')) source = replaceExactly(source, '#include <skinnormal_vertex>', normal);
  shader.vertexShader = source;
  return shader;
}
export function patchEightWeightMaterial(material) {
  pinnedRevision();
  if (!material?.isMaterial || material.isRawShaderMaterial || material.isShaderMaterial) fail('八权重仅支持 Three.js 内置 WebGL 材质。');
  if (patchedMaterials.has(material)) return material;
  const previousCompile = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  // Freeze the original key before wrapping onBeforeCompile, whose source is the
  // default key. Retain explicit application cache keys through a bound callback.
  const defaultKey = previousKey === THREE.Material.prototype.customProgramCacheKey;
  const originalKey = defaultKey ? previousKey.call(material) : null;
  material.onBeforeCompile = function (shader, renderer) {
    previousCompile.call(this, shader, renderer);
    patchEightWeightShader(shader);
  };
  material.customProgramCacheKey = function () { return `${defaultKey ? originalKey : previousKey.call(this)}|${KEY}`; };
  material.needsUpdate = true;
  patchedMaterials.set(material, {previousCompile, previousKey});
  return material;
}
function clonePatched(material) {
  const clone = material.clone();
  // Material.clone() intentionally does not copy shader callbacks.
  const prior = patchedMaterials.get(material);
  clone.onBeforeCompile = prior?.previousCompile || material.onBeforeCompile;
  clone.customProgramCacheKey = prior?.previousKey || material.customProgramCacheKey;
  return patchEightWeightMaterial(clone);
}
function component(attribute, row, c) { return attribute.getComponent(row, c); }
/** Install on an already adapted geometry (also use for newly created outlines).
 * The caller owns material/geometry disposal; the helper owns custom shadows.
 * Call again after replacing main materials. Do not use scene.overrideMaterial
 * with an unpatched material on these meshes. Multi-material arrays are rejected;
 * export separate glTF primitives instead (as GLTFLoader normally creates). */
export function installEightWeightMesh(mesh) {
  pinnedRevision();
  const geometry = mesh.geometry;
  if (!mesh.isSkinnedMesh || !geometry?.getAttribute('skinIndex1') || !geometry.getAttribute('skinWeight1')) fail('八权重网格缺少附加属性。');
  if (!mesh.skeleton?.bones?.length) fail('八权重网格缺少骨架。');
  // A glTF primitive is single-material. Shared custom shadow materials cannot
  // safely switch per-group texture uniforms in r185; require split primitives
  // rather than claim unsupported grouped-material shadow correctness.
  if (Array.isArray(mesh.material)) fail('八权重暂不支持多材质组网格；请导出分离的 glTF 图元。');
  patchEightWeightMaterial(mesh.material);
  if (adaptedMeshes.has(mesh)) {
    const owned = adaptedMeshes.get(mesh);
    owned.depth.needsUpdate = owned.distance.needsUpdate = true;
    return mesh;
  }
  const depth = mesh.customDepthMaterial ? clonePatched(mesh.customDepthMaterial) : patchEightWeightMaterial(new THREE.MeshDepthMaterial());
  const distance = mesh.customDistanceMaterial ? clonePatched(mesh.customDistanceMaterial) : patchEightWeightMaterial(new THREE.MeshDistanceMaterial());
  const priorDepth = mesh.customDepthMaterial, priorDistance = mesh.customDistanceMaterial;
  const priorBeforeShadow = mesh.onBeforeShadow, shadowFeatureKeys = new WeakMap();
  const beforeShadow = function (renderer, object, camera, shadowCamera, geometry, material, group) {
    priorBeforeShadow.call(this, renderer, object, camera, shadowCamera, geometry, material, group);
    // WebGLShadowMap copies the surface map/alpha/displacement settings
    // onto a custom shadow material without invalidating its program. Detect
    // those changes AFTER that copy, including texture UV-channel changes.
    const key = JSON.stringify([material.map?.id, material.map?.channel, material.map?.colorSpace,
      material.alphaMap?.id, material.alphaMap?.channel, material.displacementMap?.id, material.displacementMap?.channel,
      material.displacementScale !== 0, material.alphaTest, material.alphaHash, material.side, material.wireframe,
      material.clippingPlanes?.length || 0, material.clipIntersection, material.clipShadows]);
    if (shadowFeatureKeys.get(material) !== key) {
      material.needsUpdate = true;
      shadowFeatureKeys.set(material, key);
    }
  };
  mesh.onBeforeShadow = beforeShadow;
  mesh.customDepthMaterial = depth;
  mesh.customDistanceMaterial = distance;
  const base = new THREE.Vector4(), term = new THREE.Vector4(), sum = new THREE.Vector4(), matrix = new THREE.Matrix4();
  mesh.applyBoneTransform = function (index, target) {
    base.set(target.x, target.y, target.z, target.isVector4 ? target.w : 1).applyMatrix4(this.bindMatrix);
    sum.set(0, 0, 0, 0);
    for (const [jName, wName] of [['skinIndex', 'skinWeight'], ['skinIndex1', 'skinWeight1']]) {
      const joints = this.geometry.getAttribute(jName), weights = this.geometry.getAttribute(wName);
      for (let c = 0; c < 4; c++) {
        const weight = component(weights, index, c);
        if (weight === 0) continue;
        const joint = component(joints, index, c);
        matrix.multiplyMatrices(this.skeleton.bones[joint].matrixWorld, this.skeleton.boneInverses[joint]);
        sum.addScaledVector(term.copy(base).applyMatrix4(matrix), weight);
      }
    }
    sum.applyMatrix4(this.bindMatrixInverse);
    if (target.isVector4) target.copy(sum); else target.set(sum.x, sum.y, sum.z);
    return target;
  };
  mesh.normalizeSkinWeights = function () {
    const a = this.geometry.getAttribute('skinWeight'), b = this.geometry.getAttribute('skinWeight1');
    for (let row = 0; row < a.count; row++) {
      let sum = 0;
      for (const attr of [a, b]) for (let c = 0; c < 4; c++) {
        const weight = component(attr, row, c);
        if (!Number.isFinite(weight) || weight < 0) fail('八权重网格的权重无效。');
        sum += weight;
      }
      if (!sum) fail('八权重网格包含零权重顶点。');
      for (const attr of [a, b]) for (let c = 0; c < 4; c++) attr.setComponent(row, c, component(attr, row, c) / sum);
    }
    a.needsUpdate = b.needsUpdate = true;
  };
  mesh.boundingBox = mesh.boundingSphere = null;
  adaptedMeshes.set(mesh, {depth, distance, priorDepth, priorDistance, priorBeforeShadow, beforeShadow});
  return mesh;
}

/** Apply after GLTFLoader and material conversion, BEFORE computing bounds.
 * Four-weight geometry/materials are left byte-for-byte and identity unchanged.
 * This does not change catalog readiness or grant approval to held models. */
export function applyEightWeightSkinning(gltf, inspection) {
  if (!inspection?.primitives?.length) return {meshes: 0, verticesWithExtraWeights: 0};
  pinnedRevision();
  if (!gltf.parser?.associations) fail('GLTFLoader 图元关联缺失。');
  const records = new Map(inspection.primitives.map(record => [`${record.meshIndex}/${record.primitiveIndex}`, record]));
  const seen = new Set();
  let count = 0;
  for (const scene of gltf.scenes || [gltf.scene]) scene.traverse(mesh => {
    if (!mesh.isMesh || seen.has(mesh)) return;
    seen.add(mesh);
    const ref = gltf.parser.associations.get(mesh);
    const record = records.get(`${ref?.meshes}/${ref?.primitives}`);
    if (!record) {
      const extra = mesh.geometry?.getAttribute('weights_1');
      if (extra) for (let row = 0; row < extra.count; row++) for (let c = 0; c < 4; c++) if (component(extra, row, c) !== 0) fail('含附加权重的图元缺少原始数据关联。');
      return;
    }
    if (adaptedMeshes.has(mesh)) { count++; return; }
    if (!mesh.isSkinnedMesh || mesh.geometry.getAttribute('position')?.count !== record.vertexCount ||
        mesh.skeleton?.bones?.length < record.jointCount) fail('加载后的骨架或顶点数量不匹配。');
    // Clone to avoid changing a geometry/material also used by a four-weight mesh.
    mesh.geometry = mesh.geometry.clone();
    for (const [name, array] of [['skinIndex', record.joints0], ['skinWeight', record.weights0], ['skinIndex1', record.joints1], ['skinWeight1', record.weights1]]) {
      mesh.geometry.setAttribute(name, new THREE.BufferAttribute(array.slice(), 4));
    }
    if (Array.isArray(mesh.material)) fail('八权重暂不支持多材质组网格；请导出分离的 glTF 图元。');
    mesh.material = clonePatched(mesh.material);
    installEightWeightMesh(mesh);
    count++;
  });
  if (!count) fail('未找到需要八权重适配的已加载图元。');
  return {meshes: count, verticesWithExtraWeights: inspection.verticesWithExtraWeights};
}
/** Call from the avatar disposer; geometry, ordinary materials and textures are
 * still disposed by its existing traversal. Safe to call more than once. */
export function disposeEightWeightSkinning(root) {
  root?.traverse(mesh => {
    const owned = adaptedMeshes.get(mesh);
    if (!owned) return;
    owned.depth.dispose();
    owned.distance.dispose();
    if (mesh.customDepthMaterial === owned.depth) mesh.customDepthMaterial = owned.priorDepth;
    if (mesh.customDistanceMaterial === owned.distance) mesh.customDistanceMaterial = owned.priorDistance;
    if (mesh.onBeforeShadow === owned.beforeShadow) mesh.onBeforeShadow = owned.priorBeforeShadow;
    adaptedMeshes.delete(mesh);
  });
}
