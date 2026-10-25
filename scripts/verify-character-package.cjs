const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');

function verifyCharacterPackage(archive) {
  if (!fs.existsSync(archive)) throw Error(`找不到打包产物：${archive}`);
  const prefix = 'characters/yukino/';
  function read(relative) {
    if (typeof relative !== 'string' || relative.includes('\\') || path.posix.isAbsolute(relative) || path.posix.normalize(relative).startsWith('../')) throw Error('角色包包含无效路径');
    const value = asar.extractFile(archive, prefix + relative).toString('utf8');
    if (!value.trim()) throw Error(`角色包资源为空：${relative}`);
    return value;
  }
  const manifest = JSON.parse(read('manifest.json'));
  if (manifest.schema_version !== 2 || manifest.id !== 'yukino') throw Error('角色包 manifest 不兼容');
  const required = [manifest.runtime_path, manifest.compact_path, manifest.bible_path, manifest.training_path, manifest.evidence_path];
  required.forEach(read);
  const listed = asar.listPackage(archive).map(item => item.replaceAll('\\', '/').replace(/^\//, ''));
  if (listed.some(item => /^characters\/yukino\/(?:stages\/|core\.md$|(?:compact|training)\/(?:early|middle|late)\.md$)/.test(item))) throw Error('打包产物含旧版分阶段资源，请清理后重新构建');
  for (const runtime of ['electron/persona.cjs', 'electron/main.cjs', 'electron/preload.cjs']) {
    if (!listed.includes(runtime)) throw Error(`打包产物缺少运行模块：${runtime}`);
  }
  return { archive, version: manifest.version, resources: required.length + 1 };
}

if (require.main === module) {
  try {
    const result = verifyCharacterPackage(path.resolve(process.argv[2] || 'release/win-unpacked/resources/app.asar'));
    console.log(`角色包校验通过：v${result.version}，${result.resources} 个资源，${result.archive}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { verifyCharacterPackage };
