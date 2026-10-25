// Inspect the packaged files without launching the executable or running weights.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const asar = require('@electron/asar');
const {verifyCharacterPackage} = require('./verify-character-package.cjs');
const translationManifest = require('../translation/model-manifest.json');
const SOVITS_REVISION = 'b4570b876f5c086819ba84e3215472733c6a7b70';
const REQUIRED_ASAR = [
  'package.json', 'dist/index.html', 'electron/main.cjs', 'electron/preload.cjs', 'electron/persona.cjs',
  'electron/bilingual.cjs', 'electron/translation.cjs', 'electron/speech.cjs',
  'electron/voice-resources.cjs', 'electron/voice-archive.cjs',
  'electron/bundled-voice.cjs', 'electron/companions.cjs', 'electron/usage.cjs',
  'electron/companion-preload.cjs', 'electron/companion-view/index.html',
  'electron/companion-view/view.js', 'electron/companion-view/view.css',
  'electron/companion-view/assets/provenance.json',
  'electron/companion-view/assets/spritesheet.png',
  'electron/companion-view/assets/walking-left.png',
  'electron/companion-view/assets/walking-right.png',
  'electron/companion-view/THIRD-PARTY-NOTICES.txt',
  'resources/voice-models.json', 'resources/translation-models.json',
  'translation/model-manifest.json',
];
const REQUIRED_EXTERNAL = [
  'inference/worker.py', 'translation/worker.py', 'translation/model-manifest.json',
  'translation/LICENSE-HY-MT2.txt', 'translation/LICENSE-LLAMA-CPP-PYTHON.txt',
  'translation/LICENSE-LLAMA-CPP.txt', 'inference-engine/yukino-runtime.json',
  'inference-engine/GPT_SoVITS/TTS_infer_pack/TTS.py',
  'python-runtime/python.exe', 'python-runtime/python312.dll',
  'python-runtime/python312.zip', 'python-runtime/python312._pth',
  'python-runtime/ffmpeg.exe', 'python-runtime/yukino-runtime-build.json',
  'python-runtime/requirements-resolved.txt',
  'python-runtime/Lib/site-packages/llama_cpp/__init__.py',
  'python-runtime/Lib/site-packages/torch/__init__.py',
  'python-runtime/Lib/site-packages/torchaudio/__init__.py',
  'python-runtime/Lib/site-packages/transformers/__init__.py',
];

function inside(root, relative) {
  if (typeof relative !== 'string' || relative.includes('\\') || path.posix.isAbsolute(relative)
      || relative.split('/').some(part => part === '..' || part === '.')) throw Error(`资源路径无效：${relative}`);
  const target = path.resolve(root, ...relative.split('/'));
  if (!target.startsWith(path.resolve(root) + path.sep)) throw Error(`资源路径越界：${relative}`);
  return target;
}
async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
function asarRead(archive, relative) {
  return asar.extractFile(archive, path.join(...relative.split('/')));
}
async function verifyFile(root, item) {
  const file = inside(root, item.path);
  const stat = await fsp.stat(file);
  if (!stat.isFile() || stat.size !== (item.size ?? item.bytes)) throw Error(`资源长度不符：${item.path}`);
  if (await sha256(file) !== item.sha256) throw Error(`资源 SHA-256 不符：${item.path}`);
  return stat.size;
}
async function verifyOfflinePackage(resources, {expectedManifest = translationManifest, iconRelative = 'dist/yukino-icon.png'} = {}) {
  resources = path.resolve(resources);
  const archive = path.join(resources, 'app.asar');
  const character = verifyCharacterPackage(archive);
  const listed = new Set(asar.listPackage(archive).map(name => name.replaceAll('\\', '/').replace(/^\//, '')));
  for (const relative of [...REQUIRED_ASAR, iconRelative]) {
    if (!listed.has(relative) || !asarRead(archive, relative).length) throw Error(`安装包缺少资源：${relative}`);
  }
  const icon = asarRead(archive, iconRelative);
  if (icon.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw Error('应用图标不是有效 PNG');
  const sourceManifest = JSON.stringify(expectedManifest);
  for (const candidate of [JSON.parse(asarRead(archive, 'translation/model-manifest.json')),
    JSON.parse(await fsp.readFile(path.join(resources, 'translation/model-manifest.json'), 'utf8'))]) {
    if (JSON.stringify(candidate) !== sourceManifest) throw Error('内外翻译资源清单与发布源码不一致');
  }
  const artwork = JSON.parse(asarRead(archive, 'electron/companion-view/assets/provenance.json'));
  for (const item of artwork.files.filter(item => item.path.endsWith('.png'))) {
    const data = asarRead(archive, 'electron/companion-view/' + item.path);
    if (data.length !== item.bytes || crypto.createHash('sha256').update(data).digest('hex') !== item.sha256) throw Error(`桌宠素材校验失败：${item.path}`);
  }
  for (const relative of REQUIRED_EXTERNAL) {
    const stat = await fsp.stat(inside(resources, relative));
    if (!stat.isFile() || stat.size === 0) throw Error(`安装包缺少外部资源：${relative}`);
  }
  const runtime = JSON.parse(await fsp.readFile(path.join(resources, 'python-runtime/yukino-runtime-build.json'), 'utf8'));
  if (!['cpu', 'cu124'].includes(runtime.flavor) || runtime.revision !== SOVITS_REVISION
      || runtime.translationRuntime !== 'llama-cpp-python-0.3.36' || !/^[a-f0-9]{64}$/.test(runtime.inputFingerprint || '')) throw Error('内嵌推理运行环境版本或构建指纹无效');
  const pth = await fsp.readFile(path.join(resources, 'python-runtime/python312._pth'), 'utf8');
  if (!pth.includes('Lib/site-packages') || !/^import site\s*$/m.test(pth)) throw Error('内嵌 Python 无法读取自己的依赖');
  const engineRoot = path.join(resources, 'inference-engine');
  const engine = JSON.parse(await fsp.readFile(path.join(engineRoot, 'yukino-runtime.json'), 'utf8'));
  if (engine.revision !== SOVITS_REVISION || !Array.isArray(engine.files) || !engine.files.length) throw Error('GPT-SoVITS 组件清单无效');
  for (const item of engine.files) await verifyFile(engineRoot, item);
  const modelRoot = inside(resources, 'translation-models/' + expectedManifest.directory);
  let modelBytes = 0;
  for (const item of expectedManifest.files) modelBytes += await verifyFile(modelRoot, item);
  const pkg = JSON.parse(asarRead(archive, 'package.json'));
  return {version:pkg.version, characterVersion:character.version, runtime:runtime.flavor,
    model:expectedManifest.modelId, modelBytes, artwork:artwork.files.filter(item => item.path.endsWith('.png')).length,
    audioSynthesisValidated:false, sourceFilesVerified:engine.files.length};
}
if (require.main === module) {
  verifyOfflinePackage(process.argv[2] || 'release/win-unpacked/resources')
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = {verifyOfflinePackage, verifyFile, inside, sha256, REQUIRED_ASAR, REQUIRED_EXTERNAL, SOVITS_REVISION};
