'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {randomBytes} = require('node:crypto');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');

const SCENE_EXTENSIONS = Object.freeze(['glb', 'gltf', 'blend', 'obj', 'fbx', 'stl', 'ply', 'json', 'js', 'mjs']);
const MAX_SCENE_BYTES = 128 * 1024 * 1024;
const sceneIdPattern = /^custom-[a-f0-9]{64}$/;
const execFileAsync = promisify(execFile);

async function readFileBounded(file, limit, message, prefix) {
  const entry = await fs.lstat(file);
  if (!entry.isFile() || !entry.size || entry.size > limit) throw Error(message);
  const handle = await fs.open(file, 'r');
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== entry.dev || opened.ino !== entry.ino || opened.size !== entry.size) throw Error(message);
    const data = Buffer.allocUnsafeSlow(Math.min(opened.size, prefix ?? opened.size));
    for (let offset = 0; offset < data.length;) {
      const {bytesRead} = await handle.read({buffer:data, offset, length:data.length - offset});
      if (!bytesRead) throw Error(message);
      offset += bytesRead;
    }
    if ((await handle.stat()).size !== opened.size) throw Error(message);
    return data;
  } finally {
    await handle.close();
  }
}

const readSceneFile = (file, prefix) => readFileBounded(file, MAX_SCENE_BYTES, '场景文件必须小于或等于 128 MiB。', prefix);

async function blenderExecutable() {
  if (process.env.YUKINO_BLENDER_PATH && path.isAbsolute(process.env.YUKINO_BLENDER_PATH)) return process.env.YUKINO_BLENDER_PATH;
  if (process.platform === 'win32') {
    const roots = [process.env.ProgramW6432, process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
    for (const root of new Set(roots)) {
      const directory = path.join(root, 'Blender Foundation');
      const entries = await fs.readdir(directory).catch(() => []);
      for (const entry of entries.filter(value => /^Blender(?: |$)/i.test(value)).sort((a, b) => b.localeCompare(a, undefined, {numeric:true}))) {
        const executable = path.join(directory, entry, 'blender.exe');
        if ((await fs.stat(executable).catch(() => null))?.isFile()) return executable;
      }
    }
  } else if (process.platform === 'darwin') {
    const executable = '/Applications/Blender.app/Contents/MacOS/Blender';
    if ((await fs.stat(executable).catch(() => null))?.isFile()) return executable;
  }
  return 'blender';
}

async function convertBlend(input, output) {
  // Pass fixed code and file arguments separately. Disable embedded drivers
  // and startup scripts before Blender opens the imported scene.
  const expression = 'import bpy, sys; result = bpy.ops.export_scene.gltf(filepath=sys.argv[-1], export_format="GLB", export_lights=True); assert "FINISHED" in result';
  const executable = await blenderExecutable();
  try {
    await execFileAsync(executable, [
      '--background', '--factory-startup', '--disable-autoexec', input,
      '--python-exit-code', '1', '--python-expr', expression, '--', output,
    ], {cwd:path.dirname(input), windowsHide:true, timeout:120000, maxBuffer:2 * 1024 * 1024});
  } catch (error) {
    if (error.code === 'ENOENT') throw Error('导入 .blend 需要安装 Blender。便携版可加入 PATH，或通过 YUKINO_BLENDER_PATH 指定可执行文件。');
    if (error.killed) throw Error('Blender 转换超时，请简化场景或在 Blender 中导出 GLB 后再导入。');
    throw Error('Blender 未能转换场景。请在 Blender 中打包外部资源，或导出为 GLB 后再导入。');
  }
}

async function removeEntry(directory, names) {
  for (const name of names) {
    await fs.unlink(path.join(directory, name)).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  await fs.rmdir(directory);
}

class SceneImportStore {
  constructor(dataRoot, {convert=convertBlend}={}) {
    this.root = path.join(dataRoot, 'imported-scenes');
    this.convert = convert;
    this.importing = false;
  }

  async checkRoot(create=false) {
    if (create) await fs.mkdir(this.root, {recursive:true});
    const entry = await fs.lstat(this.root).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (entry && !entry.isDirectory()) throw Error('自定义场景目录无效。');
    return Boolean(entry);
  }

  async entry(id) {
    if (typeof id !== 'string' || !sceneIdPattern.test(id)) throw Error('自定义场景编号无效。');
    if (!await this.checkRoot()) return null;
    const directory = path.join(this.root, id);
    const stat = await fs.lstat(directory).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!stat) return null;
    if (!stat.isDirectory()) throw Error('自定义场景目录无效。');
    return directory;
  }

  async metadata(directory, id) {
    const raw = await readFileBounded(path.join(directory, 'scene.json'), 4096, '自定义场景资料无效。');
    const {label, extension, sourceExtension} = JSON.parse(raw.toString('utf8'));
    if (typeof label !== 'string' || !label.trim() || label.length > 120 ||
        !SCENE_EXTENSIONS.includes(sourceExtension) || extension !== (sourceExtension === 'blend' ? 'glb' : sourceExtension)) {
      throw Error('自定义场景资料无效。');
    }
    return {id, label, extension, sourceExtension};
  }

  async list() {
    if (!await this.checkRoot()) return [];
    const directories = await fs.readdir(this.root, {withFileTypes:true});
    const scenes = [];
    for (const directory of directories) {
      if (!directory.isDirectory() || !sceneIdPattern.test(directory.name)) continue;
      try {
        const target = await this.entry(directory.name);
        if (target) scenes.push(await this.metadata(target, directory.name));
      } catch {
        // A damaged entry should not hide the rest of the library.
      }
    }
    return scenes.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  }

  async import(file) {
    if (this.importing) throw Error('正在导入场景，请稍后再试。');
    this.importing = true;
    let temporary;
    try {
      const sourceExtension = path.extname(file).slice(1).toLowerCase();
      if (!SCENE_EXTENSIONS.includes(sourceExtension)) throw Error('不支持此场景文件格式。');
      const extension = sourceExtension === 'blend' ? 'glb' : sourceExtension;
      const label = path.basename(file, path.extname(file)).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120) || '自定义场景';
      const id = `custom-${randomBytes(32).toString('hex')}`;
      const scene = {id, label, extension, sourceExtension};
      const data = await readSceneFile(file);
      await this.checkRoot(true);
      temporary = await fs.mkdtemp(path.join(this.root, '.import-'));
      const asset = path.join(temporary, 'asset');
      if (sourceExtension === 'blend') {
        const input = path.join(temporary, 'input.blend');
        const output = path.join(temporary, 'output.glb');
        await fs.writeFile(input, data, {flag:'wx'});
        await this.convert(input, output);
        const converted = await readSceneFile(output, 4).catch(() => {
          throw Error('Blender 没有生成有效的 GLB 文件，或转换后的场景超过 128 MiB。');
        });
        if (converted.toString('ascii', 0, 4) !== 'glTF') throw Error('Blender 没有生成有效的 GLB 文件。');
        await fs.unlink(input);
        await fs.rename(output, asset);
      } else {
        await fs.writeFile(asset, data, {flag:'wx'});
      }
      await fs.writeFile(path.join(temporary, 'scene.json'), JSON.stringify(scene), {flag:'wx'});
      await fs.rename(temporary, path.join(this.root, id));
      temporary = null;
      return scene;
    } finally {
      this.importing = false;
      if (temporary) await removeEntry(temporary, ['input.blend', 'output.glb', 'asset', 'scene.json']).catch(() => {});
    }
  }

  async read(id) {
    const directory = await this.entry(id);
    if (!directory) throw Error('找不到此自定义场景，请重新导入。');
    const {extension} = await this.metadata(directory, id);
    const data = await readSceneFile(path.join(directory, 'asset'));
    return {extension, data:new Uint8Array(data.buffer, data.byteOffset, data.byteLength)};
  }

  async remove(id) {
    const directory = await this.entry(id);
    if (!directory) return false;
    const removed = path.join(this.root, `.removed-${randomBytes(16).toString('hex')}`);
    try {
      await fs.rename(directory, removed);
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
    await removeEntry(removed, ['asset', 'scene.json']).catch(() => {});
    return true;
  }
}

module.exports = {SceneImportStore, SCENE_EXTENSIONS, MAX_SCENE_BYTES};
