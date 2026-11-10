import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const manifestPath = new URL('../docs/asset-manifest.json', import.meta.url);
const read = (path) => readFileSync(join(root, path));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hashJson = (value) => sha256(JSON.stringify(value));
const version = 1;

function listFiles(directory) {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return listFiles(path);
    return entry.isFile() ? [path] : [];
  }).sort();
}

function describeGlb(bytes, rigHierarchies) {
  const containerVersion = bytes.readUInt32LE(4);
  if (bytes.toString('ascii', 0, 4) !== 'glTF' || containerVersion !== 2 || bytes.readUInt32LE(8) !== bytes.length) {
    throw new Error('Invalid GLB 2.0 container');
  }
  const jsonLength = bytes.readUInt32LE(12);
  const binHeader = 20 + jsonLength;
  if (bytes.toString('ascii', 16, 20) !== 'JSON' || bytes.toString('ascii', binHeader + 4, binHeader + 8) !== 'BIN\0') {
    throw new Error('Expected GLB JSON and BIN chunks');
  }
  const gltf = JSON.parse(bytes.toString('utf8', 20, binHeader));
  const binary = bytes.subarray(binHeader + 8);
  const { nodes, accessors } = gltf;
  const viewHashes = new Map();
  function bufferViewHash(index) {
    if (!viewHashes.has(index)) {
      const { byteOffset = 0, byteLength } = gltf.bufferViews[index];
      viewHashes.set(index, sha256(binary.subarray(byteOffset, byteOffset + byteLength)));
    }
    return viewHashes.get(index);
  }
  function accessorContent(index) {
    const { bufferView, sparse, ...description } = accessors[index];
    return {
      ...description,
      content: bufferView === undefined ? undefined : bufferViewHash(bufferView),
      stride: gltf.bufferViews[bufferView]?.byteStride,
      sparse: sparse && {
        count: sparse.count,
        indices: { ...sparse.indices, bufferView: bufferViewHash(sparse.indices.bufferView) },
        values: { ...sparse.values, bufferView: bufferViewHash(sparse.values.bufferView) },
      },
    };
  }
  const jointIndices = [...new Set(gltf.skins.flatMap((skin) => skin.joints))];
  const parentIndices = new Map(nodes.flatMap((node, index) => (node.children ?? []).map((child) => [child, index])));
  const hierarchy = jointIndices.map((index) => [nodes[index].name, nodes[parentIndices.get(index)]?.name ?? null]);
  const hierarchyId = hashJson(hierarchy);
  rigHierarchies[hierarchyId] = hierarchy;
  const primitives = gltf.meshes.flatMap((mesh) => mesh.primitives);
  const positions = primitives.map((primitive) => accessors[primitive.attributes.POSITION]);
  const min = [0, 1, 2].map((axis) => Math.min(...positions.map((position) => position.min[axis])));
  const max = [0, 1, 2].map((axis) => Math.max(...positions.map((position) => position.max[axis])));
  const eyes = hierarchy.map(([name]) => name).filter((name) => /eye|lid|blink/i.test(name));
  const morphs = [...new Set(gltf.meshes.flatMap((mesh) => mesh.extras?.targetNames ?? []))];
  const localRestPose = jointIndices.map((index) => {
    const { name, translation, rotation, scale, matrix } = nodes[index];
    return { name, translation, rotation, scale, matrix };
  });
  return {
    containerVersion,
    ...gltf.asset,
    extensionsUsed: gltf.extensionsUsed ?? [],
    extensionsRequired: gltf.extensionsRequired ?? [],
    sceneRoots: gltf.scenes[gltf.scene ?? 0].nodes.map((index) => nodes[index].name),
    meshNodes: nodes.filter((node) => node.mesh !== undefined).map((node) => ({ name: node.name, skinned: node.skin !== undefined })),
    primitiveCount: primitives.length,
    eightWeightPrimitiveCount: primitives.filter(({ attributes }) => attributes.JOINTS_1 !== undefined && attributes.WEIGHTS_1 !== undefined).length,
    meshLocalBounds: { min, max, size: max.map((value, axis) => value - min[axis]) },
    jointCount: jointIndices.length,
    hierarchyId,
    eyeJoints: eyes,
    physicsNamedJoints: hierarchy.map(([name]) => name).filter((name) => /hair|cloth|skirt|spring/i.test(name)),
    localRestPoseSha256: hashJson(localRestPose),
    rootRestPose: localRestPose.find(({ name }) => name === 'Root'),
    inverseBindSha256: hashJson(gltf.skins.map(({ inverseBindMatrices }) => accessorContent(inverseBindMatrices))),
    materials: gltf.materials.length,
    textures: gltf.textures.length,
    images: gltf.images.map((image) => ({ mimeType: image.mimeType, uri: image.uri, sha256: image.bufferView === undefined ? undefined : bufferViewHash(image.bufferView) })),
    externalBuffers: gltf.buffers.flatMap(({ uri }) => uri ? [uri] : []),
    materialSha256: hashJson(gltf.materials),
    meshAppearanceSha256: hashJson(primitives.map((primitive) => ({
      material: primitive.material,
      mode: primitive.mode,
      indices: accessorContent(primitive.indices),
      attributes: Object.fromEntries(Object.entries(primitive.attributes).map(([name, index]) => [name, accessorContent(index)])),
    }))),
    morphs,
    morphContentSha256: hashJson(gltf.meshes.map((mesh) => ({
      names: mesh.extras?.targetNames,
      weights: mesh.weights,
      primitives: mesh.primitives.map(({ targets }) => targets?.map((target) => (
        Object.fromEntries(Object.entries(target).map(([name, index]) => [name, accessorContent(index)]))
      ))),
    }))),
    animations: (gltf.animations ?? []).map((clip) => ({
      name: clip.name,
      duration: Math.max(...clip.samplers.map(({ input }) => accessors[input].max[0])) - Math.min(...clip.samplers.map(({ input }) => accessors[input].min[0])),
      channelCount: clip.channels.length,
      channels: Object.fromEntries([...new Set(clip.channels.map(({ target }) => target.path))].sort().map((path) => [
        path, clip.channels.filter(({ target }) => target.path === path).length,
      ])),
    })),
  };
}

const registryPath = 'resources/character-models.json';
const registry = JSON.parse(read(registryPath));
const metadataPaths = [
  'characters/NOTICE_CMU_WALK.txt',
  'electron/companion-view/video-preview/UPSTREAM_V6_RUNTIME_METADATA.json',
  registryPath,
  'resources/character-dialogue07-v1.json',
  'resources/character-walk07-v6.json',
];
const paths = [...new Set([
  ...metadataPaths,
  ...listFiles('public/characters'),
  ...listFiles('resources/character-source'),
  ...listFiles('src/ui/garments/profiles'),
])].sort();
const rigHierarchies = {};
const files = paths.map((path) => {
  const bytes = read(path);
  const hash = sha256(bytes);
  const format = extname(path).slice(1).toLowerCase();
  const registryEntry = registry.models.find((model) => model.url === `./${path.replace(/^public\//, '')}`);
  return {
    path,
    format,
    bytes: bytes.length,
    sha256: hash,
    ...registryEntry && { registry: {
      id: registryEntry.id,
      label: registryEntry.label,
      status: registryEntry.status,
      matches: registryEntry.bytes === bytes.length && registryEntry.sha256 === hash,
    } },
    ...format === 'glb' && { glb: describeGlb(bytes, rigHierarchies) },
  };
});

const manifest = { version, files, rigHierarchies };
const action = process.argv[2];
if (action === '--write') {
  if (files.some(({ registry: entry }) => entry && !entry.matches)) throw new Error('Refusing to snapshot assets that differ from the source registry');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
} else if (action === undefined || action === '--verify') {
  const baseline = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const expected = new Map(baseline.files.map((file) => [file.path, file]));
  for (const file of files) {
    const old = expected.get(file.path);
    if (old?.sha256 !== file.sha256 || old?.bytes !== file.bytes) {
      console.error(`${file.path} ${old ? 'changed' : 'added'}`);
      process.exitCode = 1;
    }
    expected.delete(file.path);
  }
  for (const path of expected.keys()) {
    console.error(`${path} missing`);
    process.exitCode = 1;
  }
  if (!process.exitCode && JSON.stringify(baseline) !== JSON.stringify(manifest)) {
    console.error('File digests match, but the extracted audit metadata differs.');
    process.exitCode = 1;
  }
} else {
  throw new Error('Usage: node scripts/audit-assets.mjs [--verify | --write]');
}
if (!process.exitCode) console.log(`${files.length} local source files, ${files.filter(({ glb }) => glb).length} GLBs verified.`);
