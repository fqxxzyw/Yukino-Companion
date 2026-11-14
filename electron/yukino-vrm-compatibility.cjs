'use strict';

const {createHash} = require('node:crypto');
const {isDeepStrictEqual} = require('node:util');

const approvedYukinoBases = Object.freeze({
  beret: '03dbd98f767d8214bea7ee3bcfface63a44934bcd635637e0fcec22a34e98fd8',
  'black-qipao': '1cd18dad58c0ca03485235ad0cfa7101060410d4ba662deca8a0df28eca042e1',
  kimono: 'b8b26e8c49fff87f2797d3e12b9f7d8d5042de01ce204ce81c1a24492ea70b54',
  'summer-uniform': 'dd2cd3c0ccba9af80ba74531e8f32364e696d271db14fed8242e17f583b6b168',
  swimsuit: 'b6bf109f5e754d1a73e9a139079c52255cea2b3279b12894d90302353efbaead',
  'twin-tail': '30598576bc3fdcf52c6b399a2f818ba78ff602d3479e0c65f37e94eb0adc82d6',
  'winter-uniform': '6e5103b41d415628daf1c61bf932f4a9cfbed3e17fe38bf9bdbc6822285a7e6b',
});
const maxModelBytes = 128 * 1024 ** 2;
const supportedExtensions = new Set([
  'KHR_materials_anisotropy', 'KHR_materials_clearcoat', 'KHR_materials_emissive_strength',
  'KHR_materials_ior', 'KHR_materials_sheen', 'KHR_materials_specular', 'KHR_materials_unlit',
  'KHR_texture_transform', 'VRMC_materials_mtoon', 'VRMC_node_constraint', 'VRMC_springBone',
  'VRMC_vrm',
]);
const sha256 = value => createHash('sha256').update(value).digest('hex');

function check(condition, message) {
  if (!condition) throw Error(`雪乃模型兼容检查失败：${message}`);
}

function readVrm(bytes) {
  const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  check(data.length >= 28 && data.length <= maxModelBytes &&
    data.readUInt32LE(0) === 0x46546c67 && data.readUInt32LE(4) === 2 &&
    data.readUInt32LE(8) === data.length && data.readUInt32LE(16) === 0x4e4f534a, '需要完整的 GLB 2.0 容器');
  const jsonLength = data.readUInt32LE(12);
  const binHeader = 20 + jsonLength;
  check(jsonLength > 0 && jsonLength <= 8 * 1024 ** 2 && jsonLength % 4 === 0 &&
    binHeader + 8 <= data.length && data.readUInt32LE(binHeader + 4) === 0x004e4942 &&
    data.readUInt32LE(binHeader) === data.length - binHeader - 8, 'GLB 区块不完整');
  const json = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(data.subarray(20, binHeader)));
  check(json.asset?.version === '2.0' && json.extensions?.VRMC_vrm?.specVersion === '1.0', '需要 VRM 1.0');
  const buffer = json.buffers?.[0];
  const available = data.length - binHeader - 8;
  check(json.buffers?.length === 1 && buffer.uri === undefined && Number.isSafeInteger(buffer.byteLength) &&
    buffer.byteLength > 0 && buffer.byteLength <= available && available - buffer.byteLength <= 3, '缓冲必须内嵌');
  check(Array.isArray(json.nodes) && json.nodes.length <= 4096 && Array.isArray(json.meshes) &&
    json.meshes.length <= 256 && Array.isArray(json.skins) && json.skins.length <= 64 &&
    Array.isArray(json.bufferViews) && json.bufferViews.length <= 8192 &&
    Array.isArray(json.accessors) && json.accessors.length <= 8192, '模型清单缺项或超出限制');
  const bin = data.subarray(binHeader + 8, binHeader + 8 + buffer.byteLength);
  for (const view of json.bufferViews) {
    const start = view.byteOffset ?? 0;
    check(view.buffer === 0 && Number.isSafeInteger(start) && start >= 0 &&
      Number.isSafeInteger(view.byteLength) && view.byteLength > 0 && start + view.byteLength <= bin.length,
      '缓冲区引用越界');
  }
  let visited = 0;
  function inspect(value, depth = 0) {
    check(++visited <= 1000000 && depth <= 64, '模型清单过大');
    if (typeof value === 'number') check(Number.isFinite(value), '模型含无效数值');
    if (!value || typeof value !== 'object') return;
    for (const [key,item] of Object.entries(value)) {
      if (key === 'uri') check(typeof item === 'string' && /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(item), '模型含外部资源');
      if (key === 'extensions') check(Object.keys(item).every(name => supportedExtensions.has(name)), '模型包含未验证的扩展');
      inspect(item, depth + 1);
    }
  }
  inspect(json);
  check([...(json.extensionsUsed ?? []), ...(json.extensionsRequired ?? [])].every(name => supportedExtensions.has(name)), '模型包含未验证的扩展');

  const parents = new Map();
  for (const [index,node] of json.nodes.entries()) {
    for (const child of node.children ?? []) {
      check(Number.isSafeInteger(child) && json.nodes[child] && !parents.has(child), '节点父级无效');
      parents.set(child,index);
    }
  }
  const roots = json.scenes?.[json.scene ?? 0]?.nodes;
  check(Array.isArray(roots) && roots.length > 0 && roots.every(root => json.nodes[root] && !parents.has(root)), '默认场景无效');
  const active = new Set();
  function visit(index,depth) {
    check(!active.has(index) && depth <= 128, '默认场景包含重复或嵌套过深的节点');
    active.add(index);
    for (const child of json.nodes[index].children ?? []) visit(child,depth + 1);
  }
  roots.forEach(root => visit(root,0));
  return {json,bin,parents,active};
}

function storedAccessor({json,bin}, index, type, width, componentTypes) {
  const accessor = json.accessors[index];
  const view = json.bufferViews[accessor?.bufferView];
  const offset = accessor?.byteOffset ?? 0;
  const size = width * ({5121:1, 5123:2, 5125:4, 5126:4})[accessor?.componentType];
  check(accessor?.type === type && componentTypes.includes(accessor.componentType) && !accessor.sparse &&
    !accessor.normalized && view && Number.isSafeInteger(accessor.count) && accessor.count > 0 &&
    Number.isSafeInteger(offset) && offset >= 0, '关键访问器缺失或格式发生变化');
  const stride = view.byteStride ?? size;
  check(Number.isSafeInteger(stride) && stride >= size && offset + (accessor.count - 1) * stride + size <= view.byteLength,
    '关键访问器的范围无效');
  const start = (view.byteOffset ?? 0) + offset;
  return {
    count: accessor.count, componentType: accessor.componentType,
    row: row => bin.subarray(start + row * stride, start + row * stride + size),
  };
}

function assertSameAccessor(before, after) {
  check(before.count === after.count && before.componentType === after.componentType, '关键网格的顶点或索引格式已变更');
  for (let row = 0; row < before.count; row++) {
    check(before.row(row).equals(after.row(row)), '贝雷帽或独立眼球网格发生变更，需要重新验收');
  }
}

function hasPositionDelta(accessor) {
  let visible = false;
  for (let index = 0; index < accessor.count; index++) {
    const position = accessor.row(index);
    for (let offset = 0; offset < 12; offset += 4) {
      const value = position.readFloatLE(offset);
      check(Number.isFinite(value), '面部形变包含无效数值');
      visible ||= Math.abs(value) > 1e-8;
    }
  }
  return visible;
}

function jointMatrices(model, skin) {
  const joints = skin.joints;
  check(Array.isArray(joints) && joints.length > 0 && joints.length <= 256 && new Set(joints).size === joints.length, '蒙皮关节清单无效');
  const rows = storedAccessor(model, skin.inverseBindMatrices, 'MAT4', 16, [5126]);
  check(rows.count === joints.length, '逆绑定矩阵数量不符');
  const matrices = new Map();
  for (const [row,index] of joints.entries()) {
    const name = model.json.nodes[index]?.name;
    check(typeof name === 'string' && name && !matrices.has(name) && model.active.has(index), '关节名称不唯一或未出现在场景');
    matrices.set(name,{index,bytes:rows.row(row)});
  }
  return matrices;
}

function compareRig(before, after) {
  check(before.json.skins.length === 1 && after.json.skins.length === 1, '修订版需要沿用同一套蒙皮骨架');
  const original = jointMatrices(before,before.json.skins[0]);
  const proposed = jointMatrices(after,after.json.skins[0]);
  check(original.size === proposed.size, '关节数量发生变更');
  const remap = new Map();
  for (const [name,{index,bytes}] of original) {
    const target = proposed.get(name);
    check(target && bytes.equals(target.bytes), `关节 ${name} 的逆绑定矩阵发生变更`);
    remap.set(index,target.index);
  }
  function jointLineage(oldIndex,newIndex) {
    const original = before.json.nodes[oldIndex], revised = after.json.nodes[newIndex];
    check(original?.name === revised?.name && original && revised, '关节父级名称发生变更');
    for (const [property,fallback] of [['matrix',null], ['translation',[0,0,0]], ['rotation',[0,0,0,1]], ['scale',[1,1,1]]]) {
      check(isDeepStrictEqual(original[property] ?? fallback,revised[property] ?? fallback), `关节 ${original.name} 的 ${property} 发生变更`);
    }
    const oldParent = before.parents.get(oldIndex), newParent = after.parents.get(newIndex);
    check((oldParent === undefined) === (newParent === undefined), `关节 ${original.name} 的层级发生变更`);
    if (oldParent !== undefined) {
      if (remap.has(oldParent)) check(remap.get(oldParent) === newParent, `关节 ${original.name} 的父级发生变更`);
      jointLineage(oldParent,newParent);
    }
  }
  for (const [oldIndex,newIndex] of remap) jointLineage(oldIndex,newIndex);
  const humanoid = model => Object.fromEntries(Object.entries(model.json.extensions.VRMC_vrm.humanoid?.humanBones ?? {})
    .map(([role,{node}]) => [role, model.json.nodes[node]?.name]));
  check(isDeepStrictEqual(humanoid(before),humanoid(after)), 'VRM 人形骨映射发生变更');
  return remap;
}

function activeMesh(model,name) {
  const matches = [...model.active].filter(index => model.json.nodes[index]?.name === name && model.json.nodes[index]?.mesh !== undefined);
  check(matches.length === 1, `无法唯一定位网格 ${name}`);
  const index = matches[0], node = model.json.nodes[index];
  const mesh = model.json.meshes[node.mesh];
  check(Array.isArray(mesh?.primitives) && mesh.primitives.length > 0 && mesh.primitives.length <= 128, `网格 ${name} 无有效图元`);
  return {index,node,mesh};
}

function compareFace(before,after,pack) {
  const originalNode = before.json.nodes[pack.faceNode];
  const original = activeMesh(before,originalNode?.name);
  const revised = activeMesh(after,originalNode?.name);
  const names = original.mesh.extras?.targetNames;
  const revisedNames = revised.mesh.extras?.targetNames;
  check(original.index === pack.faceNode && original.node.skin === 0 && revised.node.skin === 0 &&
    Array.isArray(names) && Array.isArray(revisedNames) &&
    names.length === new Set(names).size && revisedNames.length === new Set(revisedNames).size &&
    names.every(name => typeof name === 'string' && name && revisedNames.includes(name)), '面部形变通道发生变更');
  const originalMaterials = original.mesh.primitives.map(primitive => before.json.materials?.[primitive.material]?.name);
  const revisedMaterials = revised.mesh.primitives.map(primitive => after.json.materials?.[primitive.material]?.name);
  check(originalMaterials.every(name => name && revisedMaterials.filter(candidate => candidate === name).length === 1), '面部材质槽发生变更');
  const required = new Set(pack.clips.flatMap(clip => clip.face.map(channel => channel.name)));
  check([...required].every(name => names.includes(name)), '原动作包引用了不存在的面部形变');
  for (const primitive of revised.mesh.primitives) {
    const vertexCount = after.json.accessors[primitive.attributes?.POSITION]?.count;
    check(Number.isSafeInteger(vertexCount) && vertexCount > 0 && primitive.targets?.length === revisedNames.length,
      '面部形变与图元布局不符');
    for (const name of names) {
      const target = storedAccessor(after,primitive.targets[revisedNames.indexOf(name)]?.POSITION,'VEC3',3,[5126]);
      check(target.count === vertexCount, `面部形变 ${name} 的访问器无效`);
    }
  }
  for (const [index,primitive] of original.mesh.primitives.entries()) {
    const updated = revised.mesh.primitives[revisedMaterials.indexOf(originalMaterials[index])];
    for (const [slot,name] of names.entries()) {
      const oldTarget = storedAccessor(before,primitive.targets[slot]?.POSITION,'VEC3',3,[5126]);
      const newTarget = storedAccessor(after,updated.targets[revisedNames.indexOf(name)]?.POSITION,'VEC3',3,[5126]);
      if (hasPositionDelta(oldTarget)) check(hasPositionDelta(newTarget), `面部形变 ${name} 的有效位移丢失`);
    }
  }
  return revised.index;
}

function compareBeret(before,after,headName) {
  for (const [name,primitiveIndex] of [[headName,0],['Hair.001',1]]) {
    const original = activeMesh(before,name), revised = activeMesh(after,name);
    const base = original.mesh.primitives[primitiveIndex], candidate = revised.mesh.primitives[primitiveIndex];
    check(original.node.skin === 0 && revised.node.skin === 0 && base && candidate, '贝雷帽或眼球图元发生变更');
    const compare = (a,b,type,width,components) =>
      assertSameAccessor(storedAccessor(before,a,type,width,components),storedAccessor(after,b,type,width,components));
    compare(base.attributes.POSITION,candidate.attributes?.POSITION,'VEC3',3,[5126]);
    compare(base.indices,candidate.indices,'SCALAR',1,[5121,5123,5125]);
    if (name === 'Hair.001') {
      // Hat drag uses an index prefix and a rigid head weight, so validate
      // the authored hat skin as well as the split between hat and accessories.
      const names = model => model.json.skins[0].joints.map(index => model.json.nodes[index].name);
      check(isDeepStrictEqual(names(before),names(after)), '帽子拖拽所依赖的关节顺序发生变更');
      compare(base.attributes.JOINTS_0,candidate.attributes?.JOINTS_0,'VEC4',4,[5121,5123]);
      compare(base.attributes.WEIGHTS_0,candidate.attributes?.WEIGHTS_0,'VEC4',4,[5126]);
    }
  }
}

function verifyCompatibleVrm(baseBytes,nextBytes,baseActionPack,style) {
  const originalSha = sha256(baseBytes);
  check(Object.hasOwn(approvedYukinoBases,style) && originalSha === approvedYukinoBases[style], '基准模型未经过验收');
  check(baseActionPack?.schema === 'yukino.local-actions.v1' && baseActionPack.modelId === style &&
    baseActionPack.modelSha256 === originalSha && Array.isArray(baseActionPack.standing) &&
    Array.isArray(baseActionPack.clips), '基准动作包与服装不匹配');
  const before = readVrm(baseBytes), after = readVrm(nextBytes);
  check(!after.json.animations?.length, '请保持模型和独立动作分开');
  const map = compareRig(before,after);
  const faceNode = compareFace(before,after,baseActionPack);
  if (style === 'beret') compareBeret(before,after,before.json.nodes[baseActionPack.faceNode].name);
  const rebind = (channel,name) => {
    const node = map.get(channel.node);
    check(node !== undefined && (name === undefined || after.json.nodes[node]?.name === name), '动作关节不存在或名称已变更');
    return {...channel,node};
  };
  return {
    ...baseActionPack, modelSha256:sha256(nextBytes), faceNode,
    standing:baseActionPack.standing.map(channel => rebind(channel,channel.name)),
    clips:baseActionPack.clips.map(clip => ({...clip,bones:clip.bones.map(channel => rebind(channel))})),
  };
}

module.exports = {approvedYukinoBases,verifyCompatibleVrm};
