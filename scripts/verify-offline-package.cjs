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
  'electron/local-chat.cjs', 'electron/runtime-manager.cjs', 'electron/setup.cjs', 'electron/providers.cjs', 'electron/pet-features.cjs',
  'electron/bundled-voice.cjs', 'electron/companions.cjs', 'electron/usage.cjs',
  'electron/companion-preload.cjs', 'electron/companion-view/index.html',
  'electron/companion-view/view.js', 'electron/companion-view/view.css',
  'electron/companion-view/assets/provenance.json', 'electron/companion-view/assets/voices.json', 'electron/companion-view/quotes.json',
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
  'translation/LICENSE-LLAMA-CPP.txt', 'local-chat/desktop_worker.py',
  'runtime-catalog.json', 'local-model/yukino-1.5b-persona-q4/manifest.json', 'voice-models/preset.json',
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
async function verifyOfflinePackage(resources, {expectedManifest = translationManifest, iconRelative = 'dist/yukino-icon.png', expectedPetVoiceCount = 2391} = {}) {
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
  // Runtime binaries are downloaded once by onboarding. Their pinned merged
  // catalog must ship, while both language models and the usable voice ship here.
  for (const name of ['python-runtime', 'inference-engine']) {
    if (fs.existsSync(path.join(resources, name))) throw Error('共享 Python 运行环境不应重复内嵌：' + name);
  }
  const runtime = JSON.parse(await fsp.readFile(path.join(resources, 'runtime-catalog.json'), 'utf8'));
  if (runtime.schemaVersion !== 1 || runtime.version !== '0.4.0') throw Error('运行环境下载清单版本无效');
  if (!runtime.variants || typeof runtime.variants !== 'object' || Array.isArray(runtime.variants) || !Object.hasOwn(runtime.variants, 'cpu')) throw Error('运行环境下载清单必须提供有效 CPU 环境');
  const runtimeVariants = Object.keys(runtime.variants).sort();
  if (runtimeVariants.some(flavor => !['cpu', 'cu124'].includes(flavor))) throw Error('运行环境下载清单包含未知类型');
  for (const flavor of runtimeVariants) {
    const variant = runtime.variants?.[flavor];
    if (variant?.id !== `windows-x64-${flavor}` || !/^[a-f0-9]{64}$/.test(variant?.archiveSha256 || '') || !Number.isSafeInteger(variant.unpackedBytes) || variant.unpackedBytes < 1 || variant.unpackedBytes > 16 * 1024 ** 3 || !Array.isArray(variant.parts) || !variant.parts.length) throw Error('运行环境下载清单缺少有效分卷：' + flavor);
    let bytes = 0;
    for (const [index, part] of variant.parts.entries()) {
      const filename = `Yukino-Runtime-0.4.0-windows-x64-${flavor}.zip.part${String(index + 1).padStart(3, '0')}`;
      if (part?.path !== filename || part.algorithm !== 'sha256' || !/^[a-f0-9]{64}$/.test(part.digest || '') || !Number.isSafeInteger(part.bytes) || part.bytes < 1 || part.bytes > 900 * 1024 ** 2 || typeof part.url !== 'string' || !part.url.startsWith('https://github.com/fqxxzyw/Yukino-Companion/releases/download/') || !part.url.endsWith('/' + filename)) throw Error('运行环境分卷清单不完整');
      bytes += part.bytes;
    }
    if (!Number.isSafeInteger(variant.bytes) || variant.bytes !== bytes) throw Error('运行环境总长度不符');
  }
  const localRoot = path.join(resources, 'local-model/yukino-1.5b-persona-q4');
  const local = JSON.parse(await fsp.readFile(path.join(localRoot, 'manifest.json'), 'utf8'));
  if (typeof local.file !== 'string' || path.basename(local.file) !== local.file || !local.file.endsWith('.gguf') || !local.name || !local.training || typeof local.training !== 'object' || !/^[a-f0-9]{64}$/.test(local.sha256 || '')) throw Error('本地对话模型清单不完整');
  const localModelBytes = await verifyFile(localRoot, {path:local.file, bytes:local.bytes, sha256:local.sha256});
  const localHandle = await fsp.open(path.join(localRoot, local.file), 'r');
  try { const magic=Buffer.alloc(4);await localHandle.read(magic,0,4,0);if(magic.toString()!=='GGUF')throw Error('本地对话权重不是 GGUF'); } finally { await localHandle.close(); }
  const preset = JSON.parse(await fsp.readFile(path.join(resources, 'voice-models/preset.json'), 'utf8'));
  if (preset.schemaVersion !== 1 || !preset.promptText?.trim() || !['ja', 'all_ja'].includes(preset.promptLang) || !Array.isArray(preset.files) || preset.files.length !== 3) throw Error('内置日语音色预设不完整');
  let voiceBytes = 0;
  for (const kind of ['gpt', 'sovits', 'reference']) {
    const item = preset.files.find(file => file.kind === kind);
    if (!item || !/^[a-f0-9]{64}$/.test(item.sha256 || '')) throw Error('内置音色缺少权重或参考音频：' + kind);
    voiceBytes += await verifyFile(path.join(resources, 'voice-models'), item);
  }
  const voices = JSON.parse(asarRead(archive, 'electron/companion-view/assets/voices.json'));
  if (voices.count !== expectedPetVoiceCount || voices.files?.length !== expectedPetVoiceCount) throw Error('桌宠预录音频数量不完整');
  const seen = new Set();
  for (const item of voices.files) {
    if (!/^[A-Za-z0-9_-]+\.ogg$/.test(item.file) || seen.has(item.file)) throw Error('桌宠预录音频名称无效');
    seen.add(item.file);
    const data = asarRead(archive, 'electron/companion-view/assets/voices/' + item.file);
    if (data.length !== item.bytes || crypto.createHash('sha256').update(data).digest('hex') !== item.sha256) throw Error('桌宠预录音频校验失败：' + item.file);
  }
  const modelRoot = inside(resources, 'translation-models/' + expectedManifest.directory);
  let modelBytes = 0;
  for (const item of expectedManifest.files) modelBytes += await verifyFile(modelRoot, item);
  const pkg = JSON.parse(asarRead(archive, 'package.json'));
  return {version:pkg.version, characterVersion:character.version, runtime:'downloadable-' + runtimeVariants.join('-'), localModel:local.name, localModelBytes, voiceBytes, petVoiceCount:voices.count,
    model:expectedManifest.modelId, modelBytes, artwork:artwork.files.filter(item => item.path.endsWith('.png')).length,
    audioSynthesisValidated:false, runtimeVariants};
}
if (require.main === module) {
  verifyOfflinePackage(process.argv[2] || 'release/win-unpacked/resources')
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = {verifyOfflinePackage, verifyFile, inside, sha256, REQUIRED_ASAR, REQUIRED_EXTERNAL, SOVITS_REVISION};
