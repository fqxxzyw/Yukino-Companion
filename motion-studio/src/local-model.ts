import { models } from './model-catalog.ts';

export const modelFileAccept = '.glb,.gltf,.vrm';
export type ModelFormat = 'glb' | 'gltf' | 'vrm';

export interface ModelFiles {
  model: File;
  dependencies: File[];
}

interface Resource {
  uri?: string;
}

interface ModelManifest {
  asset?: { version?: string };
  buffers?: Resource[];
  images?: Resource[];
  meshes?: { primitives: { attributes: Record<string, number> }[] }[];
  extensions?: Record<string, unknown>;
  extensionsUsed?: string[];
  extensionsRequired?: string[];
}

export interface ModelSource {
  data: ArrayBuffer | string;
  format: ModelFormat;
  id: string;
  label: string;
  asset: { filename: string; sha256: string; path?: string };
  release?: () => void;
}

export async function digest(bytes: BufferSource) {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (part) => part.toString(16).padStart(2, '0')).join('');
}

const supportedVrmExtensions = new Set([
  'VRM', 'VRMC_vrm', 'VRMC_springBone', 'VRMC_springBone_extended_collider',
  'VRMC_materials_mtoon', 'VRMC_materials_hdr_emissiveMultiplier', 'VRMC_node_constraint',
]);

function isVrm(json: ModelManifest) {
  const v0 = Object.hasOwn(json.extensions ?? {}, 'VRM');
  const v1 = Object.hasOwn(json.extensions ?? {}, 'VRMC_vrm');
  if (v0 && v1) throw new Error('模型同时声明了 VRM 0.x 和 1.0，无法确定使用哪套绑定。');
  return v0 || v1;
}

function parseManifest(text: string): ModelManifest {
  let json: ModelManifest;
  try { json = JSON.parse(text.replace(/^\uFEFF/, '')) as ModelManifest; }
  catch { throw new Error('模型清单无法读取，请检查 GLB 或 glTF 文件。'); }
  if (json?.asset?.version !== '2.0') throw new Error('请选择 glTF 2.0 或 GLB 2.0 模型。');
  const extensions = [...Object.keys(json.extensions ?? {}), ...(json.extensionsUsed ?? []), ...(json.extensionsRequired ?? [])];
  if (!isVrm(json) && extensions.some((extension) => /^(?:VRM$|VRMC_)/.test(extension))) {
    throw new Error('文件声明了 VRM 专用数据，但缺少完整的 VRM 模型绑定。');
  }
  const unsupported = json.extensionsRequired?.find((extension) => /^(?:VRM$|VRMC_)/.test(extension) && !supportedVrmExtensions.has(extension));
  if (unsupported) {
    throw new Error(`模型要求此版本无法读取的 VRM 扩展：${unsupported}。`);
  }
  if (extensions.some((extension) => ['KHR_draco_mesh_compression', 'KHR_texture_basisu', 'EXT_meshopt_compression'].includes(extension))) {
    throw new Error('模型使用压缩网格或纹理。请导出未压缩的 glTF 2.0 或 GLB 2.0。');
  }
  if (json.meshes?.some(({ primitives }) => primitives.some(({ attributes }) => Object.keys(attributes).some((key) => /^(JOINTS|WEIGHTS)_[1-9]/.test(key))))) {
    throw new Error('模型使用多组蒙皮权重。当前预览支持每顶点最多四个骨骼权重。');
  }
  return json;
}

const externalResources = (json: ModelManifest) => [...(json.buffers ?? []), ...(json.images ?? [])]
  .filter((resource): resource is { uri: string } => typeof resource.uri === 'string' && !/^data:/i.test(resource.uri));

export function validateGlb(bytes: ArrayBuffer) {
  const view = new DataView(bytes);
  if (view.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== view.byteLength) {
    throw new Error('请选择完整的 GLB 2.0 或 VRM 文件。');
  }
  const length = view.getUint32(12, true);
  if (length + 20 > view.byteLength || view.getUint32(16, true) !== 0x4e4f534a) throw new Error('GLB 清单无效。');
  const json = parseManifest(new TextDecoder().decode(new Uint8Array(bytes, 20, length)));
  if (externalResources(json).length) throw new Error('此 GLB 引用外部资源，请重新导出资源完整内嵌的 GLB，或导入 glTF 及其依赖。');
  return isVrm(json) ? 'vrm' : 'glb';
}

export async function readCatalogModel(id: string, signal?: AbortSignal): Promise<ModelSource> {
  const model = models.find((item) => item.id === id);
  if (!model) throw new Error(`找不到已登记模型 ${id}，请重新导入模型文件。`);
  const response = await fetch(model.url, { signal });
  if (!response.ok) throw new Error(`本地模型文件不可读取。请导入 ${model.filename}。`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== model.bytes || await digest(bytes) !== model.sha256) {
    throw new Error(`本地模型校验失败，请检查 ${model.filename}。`);
  }
  const format = validateGlb(bytes);
  return { data: bytes, format, id, label: model.label, asset: { filename: model.filename, sha256: model.sha256, path: model.path } };
}

function relativePath(uri: string) {
  let path: string;
  try { path = decodeURIComponent(uri); }
  catch { throw new Error(`glTF 的资源路径无法解析：${uri}`); }
  const parts = path.replace(/\\/g, '/').split('/');
  if (!parts[0] || parts.includes('..') || /[:?#]/.test(path) || [...path].some((char) => char.charCodeAt(0) < 32)) throw new Error(`glTF 仅支持选中的本地资源：${uri}`);
  return parts.filter((part) => part && part !== '.').join('/');
}

export async function readLocalModel(files: ModelFiles, expected?: { id: string; sha256?: string }): Promise<ModelSource> {
  const { model, dependencies } = files;
  const bytes = await model.arrayBuffer();
  let sha256 = await digest(bytes);
  let data: ArrayBuffer | string = bytes;
  let format: ModelFormat;
  const urls: string[] = [];
  const release = () => urls.forEach((url) => URL.revokeObjectURL(url));
  try {
    if (/\.gltf$/i.test(model.name)) {
      const json = parseManifest(new TextDecoder().decode(bytes));
      if (isVrm(json)) throw new Error('请选择原始二进制 .vrm 文件，以保留其 VRM 绑定与物理。');
      format = 'gltf';
      const resources = externalResources(json);
      const selected = new Map<string, File>();
      const directory = (model.webkitRelativePath || '').split('/').slice(0, -1).join('/');
      for (const resource of resources) {
        const path = relativePath(resource.uri);
        if (selected.has(path)) continue;
        const relative = directory ? `${directory}/${path}` : path;
        const exact = dependencies.filter((file) => file.webkitRelativePath === relative || file.webkitRelativePath?.endsWith(`/${relative}`));
        const basename = path.split('/').at(-1);
        const matches = exact.length ? exact : dependencies.filter((file) => file.name === basename);
        if (matches.length !== 1) throw new Error(`${matches.length ? '同名文件有多个' : '缺少依赖文件'}：${path}。请选择模型随附的 .bin 和贴图。`);
        selected.set(path, matches[0]);
      }
      if (selected.size) {
        const hashes = await Promise.all([...selected.keys()].sort().map(async (path) => [path, await digest(await selected.get(path)!.arrayBuffer())]));
        sha256 = await digest(new TextEncoder().encode(JSON.stringify([sha256, hashes])));
        const byPath = new Map([...selected].map(([path, file]) => {
          const url = URL.createObjectURL(file);
          urls.push(url);
          return [path, url];
        }));
        for (const resource of resources) resource.uri = byPath.get(relativePath(resource.uri))!;
      }
      data = JSON.stringify(json);
    } else if (/\.(glb|vrm)$/i.test(model.name)) {
      format = validateGlb(bytes);
      if (/\.vrm$/i.test(model.name) && format !== 'vrm') throw new Error('此文件没有有效的 VRM 模型绑定。');
    } else throw new Error('请选择 .glb、.gltf 或 .vrm 模型文件。');

    if (expected?.sha256 && sha256 !== expected.sha256) throw new Error('模型文件或依赖的指纹与工程记录不一致。');
    const registered = models.find((entry) => entry.sha256 === sha256);
    const localId = `local:${model.name}`;
    const id = expected?.id ?? registered?.id ?? localId;
    if (expected && !expected.sha256 && id !== localId && id !== registered?.id) throw new Error('请选择工程原来引用的模型。');
    const matching = registered?.id === id ? registered : undefined;
    return { data, format, id, label: matching?.label ?? model.name.replace(/\.(glb|gltf|vrm)$/i, ''),
      asset: { filename: matching?.filename ?? model.name, sha256, path: matching?.path }, release };
  } catch (error) {
    release();
    throw error;
  }
}
